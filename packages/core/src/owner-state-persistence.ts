/**
 * TD-011 V1.0 — SQLite-backed overlay for owner config that must survive
 * Next.js dev/prod restarts.
 *
 * Why a separate file from `mutable-store.ts`: keeps the in-memory store
 * the source of truth at runtime (no per-read I/O), and lets us hide all
 * the better-sqlite3 + filesystem branching here. mutable-store calls
 * `hydrateOwnerState()` once on module init, and `writeOwnerOverrides()`
 * / `writeIntegrationsTokens()` after every mutation.
 *
 * Scope (V1.0 ship-blocker only — see TD-011 in TECH-DEBT.md):
 *   • ownerOverrides (owner_name, owner_role, owner_intro, system_prompt,
 *     integrations[], …)
 *   • integrationTokens (opaque encrypted blobs keyed by `${kind}:${owner_id}`)
 *
 * Deliberately deferred to V1.1+:
 *   • dynamicStaff, staffOverrides, dismissedStaffIds — bigger blast radius
 *   • dynamicChatThreads — ephemeral by design
 *   • At-rest encryption of this DB file — V1.2 work (the token blobs are
 *     already AES-256-GCM encrypted by `@holon/auth`; only the ownerOverrides
 *     JSON is plaintext, and it contains nothing more secret than the
 *     OAuth refresh-token *reference* + the user's name / role).
 *
 * Storage location (override with `HOLON_DB_PATH` for tests):
 *   • Linux dev:  $XDG_DATA_HOME/holon/owner.sqlite, else $HOME/.holon/owner.sqlite
 *   • Windows:    %LOCALAPPDATA%\Holon\owner.sqlite
 *   • Fallback:   ./.holon/owner.sqlite (relative to process.cwd())
 *
 * Failure posture: every read/write is try/caught — a SQLite error must
 * NEVER throw past the mutable-store API surface, because that would
 * convert "your config didn't persist" into "your /api/v1/me request
 * returned 500". The audit log is the canary; tests assert on it.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';

import type { Mission, Staff } from '@holon/api-contract';
import { Mission as MissionSchema, Staff as StaffSchema } from '@holon/api-contract';

/* ── Lazy SQLite singleton ────────────────────────────────────────────── */

// better-sqlite3 is a native module. We require() it lazily so that a
// missing native build (e.g. on a fresh CI clone before `pnpm install
// --frozen-lockfile` runs) degrades to in-memory-only mode rather than
// crashing the whole Next.js boot. The audit log line tells the operator
// what happened.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BetterSqliteDatabase = any;
let _db: BetterSqliteDatabase | null = null;
let _dbInitFailed = false;
const requireFn = createRequire(import.meta.url);

function resolveDbPath(): string {
  if (process.env.HOLON_DB_PATH) return process.env.HOLON_DB_PATH;
  if (platform() === 'win32') {
    const base = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    return join(base, 'Holon', 'owner.sqlite');
  }
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg ? join(xdg, 'holon') : join(homedir(), '.holon');
  return join(base, 'owner.sqlite');
}

function ensureDb(): BetterSqliteDatabase | null {
  if (_db) return _db;
  if (_dbInitFailed) return null;
  try {
    const dbPath = resolveDbPath();
    const parent = dirname(dbPath);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    // Dynamic createRequire so missing native binary doesn't ESM-import-fail the
    // whole module graph; createRequire keeps it CJS-compatible for the
    // bundler.
    const Database = requireFn('better-sqlite3') as new (
      path: string,
    ) => BetterSqliteDatabase;
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS owner_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    _db = db;
    console.log(JSON.stringify({
      audit: 'persistence.opened',
      path: dbPath,
      ts: new Date().toISOString(),
    }));
    return _db;
  } catch (err) {
    _dbInitFailed = true;
    console.error(JSON.stringify({
      audit: 'persistence.open_failed',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return null;
  }
}

/* ── Read / hydrate ────────────────────────────────────────────────────── */

export interface HydratedOwnerState {
  ownerOverrides: Record<string, unknown> | null;
  /** Array of `[key, base64Blob]` tuples — serialized form of a Map. */
  integrationTokens: Array<[string, string]> | null;
}

/** One-shot read on module init. Returns whatever's in the DB (or null
 *  per field if the row is absent / DB is unavailable / JSON parse fails). */
export function hydrateOwnerState(): HydratedOwnerState {
  const out: HydratedOwnerState = { ownerOverrides: null, integrationTokens: null };
  const db = ensureDb();
  if (!db) return out;
  try {
    const stmt = db.prepare('SELECT key, value FROM owner_state WHERE key IN (?, ?)');
    const rows = stmt.all('ownerOverrides', 'integrationTokens') as Array<{
      key: string;
      value: string;
    }>;
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.value);
        if (row.key === 'ownerOverrides' && parsed && typeof parsed === 'object') {
          out.ownerOverrides = parsed as Record<string, unknown>;
        } else if (row.key === 'integrationTokens' && Array.isArray(parsed)) {
          out.integrationTokens = parsed as Array<[string, string]>;
        }
      } catch (parseErr) {
        console.error(JSON.stringify({
          audit: 'persistence.read_parse_failed',
          key: row.key,
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
          ts: new Date().toISOString(),
        }));
      }
    }
    console.log(JSON.stringify({
      audit: 'persistence.hydrated',
      keys: rows.map((r) => r.key),
      ts: new Date().toISOString(),
    }));
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'persistence.hydrate_failed',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
  }
  return out;
}

/* ── Write-through ─────────────────────────────────────────────────────── */

function writeKey(key: string, value: unknown): void {
  const db = ensureDb();
  if (!db) return;
  try {
    const json = JSON.stringify(value);
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO owner_state (key, value, updated_at) VALUES (?, ?, ?)',
    );
    stmt.run(key, json, Date.now());
    console.log(JSON.stringify({
      audit: 'persistence.write',
      key,
      bytes: json.length,
      ts: new Date().toISOString(),
    }));
  } catch (err) {
    // Per TD-011: must NOT throw — a write failure should not bork the
    // user-facing PATCH response. Audit + swallow.
    console.error(JSON.stringify({
      audit: 'persistence.write_failed',
      key,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
  }
}

export function writeOwnerOverrides(overrides: Record<string, unknown>): void {
  writeKey('ownerOverrides', overrides);
}

/** Serialized form of the integrationTokens Map. Map<string,string> →
 *  Array<[string,string]> so JSON-round-trip is identity. */
export function writeIntegrationTokens(entries: Array<[string, string]>): void {
  writeKey('integrationTokens', entries);
}

/* ── iter-018 Pass #2 — encrypted LLM provider keys blob ───────────────
 * Single opaque base64-encoded AES-256-GCM ciphertext (produced by
 * @holon/auth.encrypt) wrapping a JSON-serialized
 * `Record<ProviderId, LLMProviderConfig>` map. ONE row regardless of how
 * many providers the user configured. The plaintext NEVER touches this
 * module: caller (llm-provider-service) does the encrypt/decrypt + this
 * file only persists the opaque string. Same posture as integrationTokens
 * (one-way crypto dep per ADR-022/ADR-025). */

/** Read the opaque encrypted llm_provider_keys blob. Returns null when
 *  no row exists, the DB is unavailable, or the value isn't a string.
 *  Read errors are audit-logged + null is returned (degrade to "no
 *  configured providers" rather than block boot). */
export function readLlmProviderKeysBlob(): string | null {
  const db = ensureDb();
  if (!db) return null;
  try {
    const stmt = db.prepare('SELECT value FROM owner_state WHERE key = ?');
    const row = stmt.get('llm_provider_keys') as { value: string } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.value);
    if (typeof parsed !== 'string') return null;
    return parsed;
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'persistence.read_failed',
      key: 'llm_provider_keys',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return null;
  }
}

/** Write the opaque encrypted llm_provider_keys blob. Pass null to
 *  delete the row (used when the last provider is removed). Write
 *  failures are audit-logged + swallowed inside writeKey. */
export function writeLlmProviderKeysBlob(blob: string | null): void {
  if (blob === null) {
    const db = ensureDb();
    if (!db) return;
    try {
      const stmt = db.prepare('DELETE FROM owner_state WHERE key = ?');
      stmt.run('llm_provider_keys');
      console.log(JSON.stringify({
        audit: 'persistence.delete',
        key: 'llm_provider_keys',
        ts: new Date().toISOString(),
      }));
    } catch (err) {
      console.error(JSON.stringify({
        audit: 'persistence.delete_failed',
        key: 'llm_provider_keys',
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }));
    }
    return;
  }
  writeKey('llm_provider_keys', blob);
}

/* ── TD-011 phase 2a — dynamicStaff persistence ───────────────────────
 * Staff created via chat (`create_staff` tool) now survives Next.js
 * restart. Serialized as a flat Staff[] (each Staff has an `id`, so the
 * in-memory Map can be reconstructed by the caller). Mirrors the
 * read/write pair pattern of ownerOverrides above. staffOverrides and
 * dismissedStaffIds are still deferred — see TD-011 phase 2b. */

export function readDynamicStaff(): Staff[] {
  const db = ensureDb();
  if (!db) return [];
  try {
    const stmt = db.prepare('SELECT value FROM owner_state WHERE key = ?');
    const row = stmt.get('dynamicStaff') as { value: string } | undefined;
    if (!row) return [];
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    // Validate + SKIP (drop + audit) invalid staff records. A single malformed
    // record (e.g. a staff with an out-of-range `id` from the old buggy
    // mintStaffId) must not crash listStaff()/the /members page/the staff route
    // (Zod throws on a bad id). Rule #4: the skip is audited, not swallowed.
    const valid: Staff[] = [];
    for (const s of parsed as unknown[]) {
      const result = StaffSchema.safeParse(s);
      if (result.success) {
        valid.push(result.data);
      } else {
        console.error(JSON.stringify({
          audit: 'persistence.staff_skipped_invalid',
          id: (s as { id?: unknown })?.id ?? null,
          name: (s as { name?: unknown })?.name ?? null,
          error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          ts: new Date().toISOString(),
        }));
      }
    }
    return valid;
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'persistence.read_failed',
      key: 'dynamicStaff',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return [];
  }
}

export function writeDynamicStaff(staff: Staff[]): void {
  writeKey('dynamicStaff', staff);
}

/* ── TD-011 phase 2b — staffOverrides + dismissedStaffIds persistence ──
 * Completes the staff-roster persistence story started in phase 2a.
 * Both share the read-failure posture (audit-log + return empty) and the
 * write-failure posture (audit-log + swallow inside writeKey) of every
 * other persisted key. Map → [[k,v],...] tuple-array and Set → string[]
 * so JSON-round-trip is identity (same trick as integrationTokens). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readStaffOverrides(): Map<string, any> {
  const db = ensureDb();
  if (!db) return new Map();
  try {
    const stmt = db.prepare('SELECT value FROM owner_state WHERE key = ?');
    const row = stmt.get('staffOverrides') as { value: string } | undefined;
    if (!row) return new Map();
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return new Map();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Map(parsed as Array<[string, any]>);
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'persistence.read_failed',
      key: 'staffOverrides',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return new Map();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function writeStaffOverrides(m: Map<string, any>): void {
  writeKey('staffOverrides', Array.from(m.entries()));
}

export function readDismissedStaffIds(): Set<string> {
  const db = ensureDb();
  if (!db) return new Set();
  try {
    const stmt = db.prepare('SELECT value FROM owner_state WHERE key = ?');
    const row = stmt.get('dismissedStaffIds') as { value: string } | undefined;
    if (!row) return new Set();
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed as string[]);
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'persistence.read_failed',
      key: 'dismissedStaffIds',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return new Set();
  }
}

export function writeDismissedStaffIds(s: Set<string>): void {
  writeKey('dismissedStaffIds', Array.from(s));
}

/* ── iter-022 Phase 1, Pass #3 — dynamicMissions persistence ──────────────
 * Mirrors the dynamicStaff read/write pair exactly. Mission[] serialized as
 * a flat array (each Mission has an `id`, so the in-memory Map can be
 * reconstructed by the caller). Read failures return [] and are audit-logged;
 * write failures are swallowed inside writeKey per the TD-011 posture. */

export function readDynamicMissions(): Mission[] {
  const db = ensureDb();
  if (!db) return [];
  try {
    const stmt = db.prepare('SELECT value FROM owner_state WHERE key = ?');
    const row = stmt.get('dynamicMissions') as { value: string } | undefined;
    if (!row) return [];
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    // Strip explicit null values from optional fields before returning.
    // Zod's `.optional()` accepts `undefined` but NOT `null`; JSON round-trips
    // may write `null` for fields that were `undefined` at write time (JSON.stringify
    // omits undefined but writes null for null). This defensive strip prevents
    // Zod validation failures in listMissions() for missions with null triage_skill_id
    // or other optional fields. Pre-existing bug (iter-023 Pass 3 fix).
    // Validate each persisted mission against the schema and SKIP (drop +
    // audit) any that fail — one malformed/forward-version record (e.g. a
    // mission with an unknown `source` written by a divergent build/peer) must
    // not brick listMissions() and the whole /inbound prerender. Rule #4: the
    // skip is surfaced via an audit event, not silently swallowed.
    const valid: Mission[] = [];
    for (const m of parsed as Record<string, unknown>[]) {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(m)) {
        if (v !== null) clean[k] = v;
      }
      const result = MissionSchema.safeParse(clean);
      if (result.success) {
        valid.push(result.data);
      } else {
        console.error(JSON.stringify({
          audit: 'persistence.mission_skipped_invalid',
          id: (clean as { id?: unknown }).id ?? null,
          source: (clean as { source?: unknown }).source ?? null,
          error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          ts: new Date().toISOString(),
        }));
      }
    }
    return valid;
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'persistence.read_failed',
      key: 'dynamicMissions',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return [];
  }
}

export function writeDynamicMissions(missions: Mission[]): void {
  writeKey('dynamicMissions', missions);
}

/* ── ADR-040 slice 1 — per-CLI-staff manager-managed memory ────────────
 * A cli_agent staff is stateless muscle; Holon (the manager) owns its
 * persistent memory and injects it as context on each dispatch. Stored as a
 * single JSON object { [staffId]: memoryMarkdown } under one owner_state key.
 * Read returns '' on miss/parse-failure (audited). */
export function readCliStaffMemory(staffId: string): string {
  const db = ensureDb();
  if (!db) return '';
  try {
    const row = db.prepare('SELECT value FROM owner_state WHERE key = ?').get('cliStaffMemory') as { value: string } | undefined;
    if (!row) return '';
    const parsed = JSON.parse(row.value) as unknown;
    if (parsed && typeof parsed === 'object') {
      const v = (parsed as Record<string, unknown>)[staffId];
      if (typeof v === 'string') return v;
    }
    return '';
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'persistence.read_failed',
      key: 'cliStaffMemory',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return '';
  }
}

export function writeCliStaffMemory(staffId: string, memory: string): void {
  const db = ensureDb();
  if (!db) return;
  let all: Record<string, string> = {};
  try {
    const row = db.prepare('SELECT value FROM owner_state WHERE key = ?').get('cliStaffMemory') as { value: string } | undefined;
    if (row) {
      const parsed = JSON.parse(row.value) as unknown;
      if (parsed && typeof parsed === 'object') all = parsed as Record<string, string>;
    }
  } catch (err) {
    // Merge-read failed: log + proceed from empty rather than block the write.
    console.error(JSON.stringify({
      audit: 'persistence.read_failed',
      key: 'cliStaffMemory',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
  }
  all[staffId] = memory;
  writeKey('cliStaffMemory', all);
}

/* ── iter-022 Phase 2 — encrypted channel creds blob ───────────────────
 * Single opaque base64-encoded AES-256-GCM ciphertext (produced by
 * @holon/auth.encrypt, same HOLON_TOKEN_ENC_KEY substrate as the LLM
 * provider keys + Gmail OAuth tokens — ADR-025, do NOT add a new enc key)
 * wrapping a JSON-serialized `Record<IngressChannel, ChannelCredsRecord>`
 * map. ONE row regardless of how many channels the owner connected. The
 * plaintext NEVER touches this module: the ChannelConnectionManager does
 * the encrypt/decrypt; this file only persists the opaque string. Exact
 * mirror of readLlmProviderKeysBlob / writeLlmProviderKeysBlob. */

/** Read the opaque encrypted channel_creds blob. Returns null when no row
 *  exists, the DB is unavailable, or the value isn't a string. Read errors
 *  are audit-logged + null is returned (degrade to "no connected channels"
 *  rather than block boot). */
export function readChannelCredsBlob(): string | null {
  const db = ensureDb();
  if (!db) return null;
  try {
    const stmt = db.prepare('SELECT value FROM owner_state WHERE key = ?');
    const row = stmt.get('channel_creds') as { value: string } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.value);
    if (typeof parsed !== 'string') return null;
    return parsed;
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'persistence.read_failed',
      key: 'channel_creds',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return null;
  }
}

/** Write the opaque encrypted channel_creds blob. Pass null to delete the
 *  row (used when the last channel is disconnected). Write failures are
 *  audit-logged + swallowed inside writeKey. */
export function writeChannelCredsBlob(blob: string | null): void {
  if (blob === null) {
    const db = ensureDb();
    if (!db) return;
    try {
      const stmt = db.prepare('DELETE FROM owner_state WHERE key = ?');
      stmt.run('channel_creds');
      console.log(JSON.stringify({
        audit: 'persistence.delete',
        key: 'channel_creds',
        ts: new Date().toISOString(),
      }));
    } catch (err) {
      console.error(JSON.stringify({
        audit: 'persistence.delete_failed',
        key: 'channel_creds',
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }));
    }
    return;
  }
  writeKey('channel_creds', blob);
}

/** TD-011 phase 2b — wipe all 3 staff-related persisted rows in one shot.
 *  Called from `clearMutableStore` so the post-reset boot doesn't
 *  re-hydrate the just-cleared roster. Single DELETE per key (small N,
 *  no point in a transaction); each failure is audit-logged + swallowed
 *  inside its own try/catch so a stuck row doesn't block the others. */
export function clearAllStaffPersistence(): void {
  const db = ensureDb();
  if (!db) return;
  const keys = ['dynamicStaff', 'staffOverrides', 'dismissedStaffIds', 'dynamicMissions'];
  for (const key of keys) {
    try {
      const stmt = db.prepare('DELETE FROM owner_state WHERE key = ?');
      stmt.run(key);
      console.log(JSON.stringify({
        audit: 'persistence.delete',
        key,
        ts: new Date().toISOString(),
      }));
    } catch (err) {
      console.error(JSON.stringify({
        audit: 'persistence.delete_failed',
        key,
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }));
    }
  }
}

/* ── iter-025 — WeChat Read whitelist ─────────────────────────────────────
 * Simple string[] of wxids persisted under key 'wechat_whitelist'. The
 * same read/write pattern as every other key in this module: read returns
 * [] on DB-unavailable / parse-error (audit-logged); write swallows errors
 * inside writeKey so a disk failure does NOT block the BFF response. */

export function readWechatWhitelist(): string[] {
  const db = ensureDb();
  if (!db) return [];
  try {
    const stmt = db.prepare('SELECT value FROM owner_state WHERE key = ?');
    const row = stmt.get('wechat_whitelist') as { value: string } | undefined;
    if (!row) return [];
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    return parsed as string[];
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'persistence.read_failed',
      key: 'wechat_whitelist',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return [];
  }
}

export function writeWechatWhitelist(wxids: string[]): void {
  writeKey('wechat_whitelist', wxids);
}

/* ── iter-026 — WeChat contact list ───────────────────────────────────────
 * Persists the owner's WeChat contact list (synced from the Windows daemon
 * via wcferry get_contacts()) under key 'wechat_contacts'. The UI reads
 * this to populate the searchable whitelist picker.
 *
 * Same read/write pattern as wechat_whitelist above: read returns [] on
 * DB-unavailable / parse-error (audit-logged); write is non-fatal on
 * disk failure. */

export interface WechatContact {
  wxid: string;
  name: string;
  alias?: string;
}

export function readWechatContacts(): WechatContact[] {
  const db = ensureDb();
  if (!db) return [];
  try {
    const stmt = db.prepare('SELECT value FROM owner_state WHERE key = ?');
    const row = stmt.get('wechat_contacts') as { value: string } | undefined;
    if (!row) return [];
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    return parsed as WechatContact[];
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'persistence.read_failed',
      key: 'wechat_contacts',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return [];
  }
}

export function writeWechatContacts(contacts: WechatContact[]): void {
  writeKey('wechat_contacts', contacts);
}

/* ── A2A peer registry ─────────────────────────────────────────────────────
 * Persists the list of known A2A peer desks/agents under key 'a2a_peers'.
 * Each entry carries a stable `id` (= the normalized base URL) plus the full
 * agent-card snapshot at the time of connection. Upsert semantics: connecting
 * a known URL overwrites the prior card rather than duplicating it.
 *
 * Same read/write posture as every other key in this module: read returns []
 * on DB-unavailable / parse-error (audit-logged); write swallows errors
 * inside writeKey so a disk failure does NOT block the HTTP response. */

export interface A2APeerRecord {
  /** Stable identifier = normalized base URL (no trailing slash). */
  id: string;
  /** The agent-card data as fetched from /.well-known/agent-card.json. */
  card: Record<string, unknown>;
  /** ISO timestamp of first connect. */
  connected_at: string;
  /** ISO timestamp of last card refresh (may differ from connected_at on updates). */
  last_seen_at: string;
}

export function readA2APeers(): A2APeerRecord[] {
  const db = ensureDb();
  if (!db) return [];
  try {
    const stmt = db.prepare('SELECT value FROM owner_state WHERE key = ?');
    const row = stmt.get('a2a_peers') as { value: string } | undefined;
    if (!row) return [];
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    return parsed as A2APeerRecord[];
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'persistence.read_failed',
      key: 'a2a_peers',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return [];
  }
}

export function writeA2APeers(peers: A2APeerRecord[]): void {
  writeKey('a2a_peers', peers);
}

/* ── Test helper ───────────────────────────────────────────────────────── */

/** Vitest-only: drop the singleton + the table so `HOLON_DB_PATH` can be
 *  re-pointed between tests without process restart. NOT exported through
 *  packages/core/src/index.ts. */
export function _resetForTest(): void {
  if (_db) {
    try {
      _db.close();
    } catch (err) {
      console.warn(JSON.stringify({
        audit: 'persistence.test_reset_close_failed',
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }));
    }
  }
  _db = null;
  _dbInitFailed = false;
}
