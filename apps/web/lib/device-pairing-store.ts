import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir, networkInterfaces, platform, type NetworkInterfaceInfo } from 'node:os';
import { dirname, join } from 'node:path';

const PAIRED_DEVICES_KEY = 'paired_devices';
const PAIR_CODE_TTL_MS = 5 * 60 * 1000;

export interface PairedDevice {
  id: string;
  token_hash: string;
  label: string;
  paired_at: string;
  last_seen_at?: string;
}

interface PendingPairing {
  code: string;
  token: string;
  deviceId: string;
  expiresAt: number;
  createdAt: string;
}

interface PairingState {
  pending: Map<string, PendingPairing>;
}

const G = globalThis as unknown as { __holonPairing?: PairingState };
if (!G.__holonPairing) G.__holonPairing = { pending: new Map() };
const STATE = G.__holonPairing;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BetterSqliteDatabase = any;
let db: BetterSqliteDatabase | null = null;
let dbInitFailed = false;

function resolveDbPath(): string {
  if (process.env.HOLON_DB_PATH) return process.env.HOLON_DB_PATH;
  const stateRoot = process.env.HOLON_STATE_ROOT?.trim();
  if (stateRoot) return join(stateRoot, 'owner.sqlite');
  if (platform() === 'win32') {
    const base = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    return join(base, 'Holon', 'owner.sqlite');
  }
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg ? join(xdg, 'holon') : join(homedir(), '.holon');
  return join(base, 'owner.sqlite');
}

function ensureDb(): BetterSqliteDatabase | null {
  if (db) return db;
  if (dbInitFailed) return null;
  try {
    const dbPath = resolveDbPath();
    const parent = dirname(dbPath);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createRequire } = require('node:module') as typeof import('node:module');
    const requireFn = createRequire(import.meta.url);
    const Database = requireFn('better-sqlite3') as new (path: string) => BetterSqliteDatabase;
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS owner_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    return db;
  } catch (err) {
    dbInitFailed = true;
    console.error(JSON.stringify({
      audit: 'pairing.persistence_open_failed',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return null;
  }
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}

function readPairedDevices(): PairedDevice[] {
  const sqlite = ensureDb();
  if (!sqlite) return [];
  try {
    const row = sqlite
      .prepare('SELECT value FROM owner_state WHERE key = ?')
      .get(PAIRED_DEVICES_KEY) as { value: string } | undefined;
    if (!row) return [];
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d): d is PairedDevice => (
      d &&
      typeof d === 'object' &&
      typeof d.id === 'string' &&
      typeof d.token_hash === 'string' &&
      typeof d.label === 'string' &&
      typeof d.paired_at === 'string'
    ));
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'pairing.persistence_read_failed',
      key: PAIRED_DEVICES_KEY,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return [];
  }
}

function readPairedDevicesOrThrow(): PairedDevice[] {
  const sqlite = ensureDb();
  if (!sqlite) throw new Error('pairing.persistence_unavailable: owner_state sqlite is unavailable');
  try {
    const row = sqlite
      .prepare('SELECT value FROM owner_state WHERE key = ?')
      .get(PAIRED_DEVICES_KEY) as { value: string } | undefined;
    if (!row) return [];
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d): d is PairedDevice => (
      d &&
      typeof d === 'object' &&
      typeof d.id === 'string' &&
      typeof d.token_hash === 'string' &&
      typeof d.label === 'string' &&
      typeof d.paired_at === 'string'
    ));
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'pairing.persistence_read_failed',
      key: PAIRED_DEVICES_KEY,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    throw new Error(`pairing.persistence_read_failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function writePairedDevices(devices: PairedDevice[]): void {
  const sqlite = ensureDb();
  if (!sqlite) {
    throw new Error('pairing.persistence_unavailable: owner_state sqlite is unavailable');
  }
  try {
    sqlite
      .prepare('INSERT OR REPLACE INTO owner_state (key, value, updated_at) VALUES (?, ?, ?)')
      .run(PAIRED_DEVICES_KEY, JSON.stringify(devices), Date.now());
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'pairing.persistence_write_failed',
      key: PAIRED_DEVICES_KEY,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    throw new Error(`pairing.persistence_write_failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function pruneExpired(now = Date.now()): void {
  for (const [code, pending] of STATE.pending.entries()) {
    if (pending.expiresAt <= now) STATE.pending.delete(code);
  }
}

function randomCode(): string {
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

function randomToken(): string {
  return `holon_device_${randomBytes(32).toString('base64url')}`;
}

export function createPairingStart(now = Date.now()): PendingPairing {
  pruneExpired(now);
  let code = randomCode();
  for (let i = 0; STATE.pending.has(code) && i < 10; i++) code = randomCode();
  if (STATE.pending.has(code)) throw new Error('pairing.code_collision: could not allocate pairing code');
  const pending: PendingPairing = {
    code,
    token: randomToken(),
    deviceId: `device_${randomBytes(10).toString('base64url')}`,
    expiresAt: now + PAIR_CODE_TTL_MS,
    createdAt: new Date(now).toISOString(),
  };
  STATE.pending.set(code, pending);
  return pending;
}

export type ClaimPairingResult =
  | { ok: true; device_token: string; device_id: string; paired_at: string }
  | { ok: false; reason: 'invalid_code' | 'expired_code' | 'persistence_failed' };

export function claimPairingCode(code: string, now = Date.now()): ClaimPairingResult {
  pruneExpired(now);
  const normalized = code.replace(/\D/g, '');
  const pending = STATE.pending.get(normalized);
  if (!pending) return { ok: false, reason: 'invalid_code' };
  if (pending.expiresAt <= now) {
    STATE.pending.delete(normalized);
    return { ok: false, reason: 'expired_code' };
  }

  const pairedAt = new Date(now).toISOString();
  const devices = readPairedDevices().filter((d) => d.id !== pending.deviceId);
  devices.push({
    id: pending.deviceId,
    token_hash: tokenHash(pending.token),
    label: 'Holon phone',
    paired_at: pairedAt,
  });

  try {
    writePairedDevices(devices);
  } catch {
    return { ok: false, reason: 'persistence_failed' };
  }

  STATE.pending.delete(normalized);
  return { ok: true, device_token: pending.token, device_id: pending.deviceId, paired_at: pairedAt };
}

export function validateDeviceToken(token: string | null | undefined): boolean {
  return validateDeviceTokenDetailed(token).ok;
}

export type DeviceTokenValidationResult =
  | { ok: true }
  | { ok: false; reason: 'missing_or_malformed' | 'invalid_token' | 'persistence_failed' };

export function validateDeviceTokenDetailed(token: string | null | undefined): DeviceTokenValidationResult {
  if (!token || token.length > 256) return { ok: false, reason: 'missing_or_malformed' };
  const presented = Buffer.from(tokenHash(token), 'utf8');
  let devices: PairedDevice[];
  try {
    devices = readPairedDevicesOrThrow();
  } catch {
    return { ok: false, reason: 'persistence_failed' };
  }
  for (const device of devices) {
    const expected = Buffer.from(device.token_hash, 'utf8');
    if (presented.length === expected.length && timingSafeEqual(presented, expected)) return { ok: true };
  }
  return { ok: false, reason: 'invalid_token' };
}

export interface LanUrlHint {
  lan_url: string;
  lan_candidates: string[];
}

interface LanIPv4Candidate {
  address: string;
  name: string;
  rangePriority: number;
  virtual: boolean;
}

export function getLanUrlHint(req: Request, code: string): string {
  return getLanUrlHintDetailed(req, code).lan_url;
}

export function getLanUrlHintDetailed(req: Request, code: string): LanUrlHint {
  const hostHeader = req.headers.get('host') ?? 'localhost:3000';
  const port = hostHeader.includes(':') ? hostHeader.split(':').at(-1) : '3000';
  const selection = selectLanIPv4();
  const ip = selection.selected ?? '127.0.0.1';
  return {
    lan_url: `http://${ip}:${port}/api/v1/pair/claim?code=${encodeURIComponent(code)}`,
    lan_candidates: selection.candidates,
  };
}

export function getFirstLanIPv4(): string | null {
  return getFirstNonInternalIPv4(networkInterfaces());
}

export function selectLanIPv4(
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): { selected: string | null; candidates: string[] } {
  const candidates = enumerateLanIPv4Candidates(interfaces);
  // Tailscale IPs (100.64.0.0/10 CGNAT, interface usually tailscale0) work from
  // BOTH home WiFi and cellular — so prefer them over LAN. Otherwise a phone
  // paired on WiFi can't reach the desk after switching to cellular.
  const tailscale = candidates.find((c) => isTailscaleCandidate(c));
  if (tailscale) {
    return {
      selected: tailscale.address,
      candidates: unique(candidates.map((c) => c.address)),
    };
  }
  const preferred = candidates
    .filter((candidate) => !candidate.virtual && candidate.rangePriority < 3)
    .sort((a, b) => a.rangePriority - b.rangePriority)[0];

  return {
    selected: preferred?.address ?? getFirstNonInternalIPv4(interfaces),
    candidates: unique(candidates.map((candidate) => candidate.address)),
  };
}

function isTailscaleCandidate(c: LanIPv4Candidate): boolean {
  if (c.name.toLowerCase().startsWith('tailscale')) return true;
  const parts = c.address.split('.').map((n) => Number.parseInt(n, 10));
  // 100.64.0.0 — 100.127.255.255 (CGNAT range used by Tailscale)
  return parts[0] === 100 && parts[1] !== undefined && parts[1] >= 64 && parts[1] <= 127;
}

function enumerateLanIPv4Candidates(
  interfaces: ReturnType<typeof networkInterfaces>,
): LanIPv4Candidate[] {
  const candidates: LanIPv4Candidate[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (!isUsableIPv4(entry)) continue;
      candidates.push({
        address: entry.address,
        name,
        rangePriority: privateRangePriority(entry.address),
        virtual: isKnownVirtualAdapter(name, entry.address),
      });
    }
  }
  return candidates.sort((a, b) => {
    if (a.virtual !== b.virtual) return a.virtual ? 1 : -1;
    return a.rangePriority - b.rangePriority;
  });
}

function getFirstNonInternalIPv4(interfaces: ReturnType<typeof networkInterfaces>): string | null {
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
}

function isUsableIPv4(entry: NetworkInterfaceInfo): boolean {
  return entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.');
}

function privateRangePriority(address: string): number {
  if (address.startsWith('192.168.')) return 0;
  if (address.startsWith('10.')) return 1;
  const parts = address.split('.').map((part) => Number.parseInt(part, 10));
  const first = parts[0];
  const second = parts[1];
  if (first === 172 && typeof second === 'number' && second >= 16 && second <= 31) return 2;
  return 3;
}

function isKnownVirtualAdapter(name: string, address: string): boolean {
  const normalizedName = name.toLowerCase();
  if (
    normalizedName.includes('wsl') ||
    normalizedName.includes('hyper-v') ||
    normalizedName.includes('hyperv') ||
    normalizedName.includes('vethernet') ||
    normalizedName.includes('virtualbox') ||
    normalizedName.includes('vboxnet') ||
    normalizedName.includes('vmware') ||
    normalizedName.includes('vmnet') ||
    normalizedName.includes('docker')
  ) {
    return true;
  }
  return address.startsWith('172.17.');
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

// ---------------------------------------------------------------------------
// Mobile-initiated pairing (4-digit code, phone requests → desk confirms)
// ---------------------------------------------------------------------------

const MOBILE_PAIR_REQUEST_TTL_MS = 2 * 60 * 1000; // 120 s

interface MobilePairingRequest {
  requestId: string;
  code: string;       // 4-digit string, e.g. "0742"
  deviceName: string;
  createdAt: string;
  expiresAt: number;
  consumed: boolean;
  token: string;
  deviceId: string;
}

interface MobilePairingState {
  requests: Map<string, MobilePairingRequest>;
}

const GM = globalThis as unknown as { __holonMobilePairing?: MobilePairingState };
if (!GM.__holonMobilePairing) GM.__holonMobilePairing = { requests: new Map() };
const MSTATE = GM.__holonMobilePairing;

function pruneMobileExpired(now = Date.now()): void {
  for (const [id, req] of MSTATE.requests.entries()) {
    if (req.expiresAt <= now) MSTATE.requests.delete(id);
  }
}

function randomRequestId(): string {
  return `mpr_${randomBytes(16).toString('base64url')}`;
}

function random4DigitCode(): string {
  return String(randomBytes(2).readUInt16BE(0) % 10000).padStart(4, '0');
}

export interface MobilePairingRequestPublic {
  requestId: string;
  code: string;
  deviceName: string;
  createdAt: string;
  expires_at: string;
}

export function createPairingRequest(deviceName: string, now = Date.now()): { requestId: string; expires_at: string } {
  pruneMobileExpired(now);
  const requestId = randomRequestId();
  const code = random4DigitCode();
  const expiresAt = now + MOBILE_PAIR_REQUEST_TTL_MS;
  const record: MobilePairingRequest = {
    requestId,
    code,
    deviceName: deviceName.slice(0, 64),
    createdAt: new Date(now).toISOString(),
    expiresAt,
    consumed: false,
    token: randomToken(),
    deviceId: `device_${randomBytes(10).toString('base64url')}`,
  };
  MSTATE.requests.set(requestId, record);
  console.log(JSON.stringify({
    audit: 'pairing.mobile_request_created',
    requestId,
    deviceName: record.deviceName,
    ts: new Date(now).toISOString(),
  }));
  return { requestId, expires_at: new Date(expiresAt).toISOString() };
}

export function listPendingPairingRequests(now = Date.now()): MobilePairingRequestPublic[] {
  pruneMobileExpired(now);
  const results: MobilePairingRequestPublic[] = [];
  for (const req of MSTATE.requests.values()) {
    if (!req.consumed && req.expiresAt > now) {
      results.push({
        requestId: req.requestId,
        code: req.code,
        deviceName: req.deviceName,
        createdAt: req.createdAt,
        expires_at: new Date(req.expiresAt).toISOString(),
      });
    }
  }
  return results;
}

export type ConfirmPairingRequestResult =
  | { ok: true; device_token: string; device_id: string; paired_at: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'bad_code' | 'persistence_failed' };

export function confirmPairingRequest(requestId: string, code: string, now = Date.now()): ConfirmPairingRequestResult {
  pruneMobileExpired(now);
  const req = MSTATE.requests.get(requestId);
  if (!req || req.consumed) return { ok: false, reason: 'not_found' };
  if (req.expiresAt <= now) {
    MSTATE.requests.delete(requestId);
    return { ok: false, reason: 'expired' };
  }
  // Constant-time safe string compare via timing-safe equal
  const normalizedCode = code.replace(/\D/g, '').padStart(4, '0').slice(0, 4);
  const expectedBuf = Buffer.from(req.code, 'utf8');
  const presentedBuf = Buffer.from(normalizedCode, 'utf8');
  const codeMatch =
    expectedBuf.length === presentedBuf.length &&
    timingSafeEqual(expectedBuf, presentedBuf);
  if (!codeMatch) return { ok: false, reason: 'bad_code' };

  const pairedAt = new Date(now).toISOString();
  const devices = readPairedDevices().filter((d) => d.id !== req.deviceId);
  devices.push({
    id: req.deviceId,
    token_hash: tokenHash(req.token),
    label: req.deviceName || 'Holon phone',
    paired_at: pairedAt,
  });

  try {
    writePairedDevices(devices);
  } catch {
    return { ok: false, reason: 'persistence_failed' };
  }

  req.consumed = true;
  MSTATE.requests.delete(requestId);
  console.log(JSON.stringify({
    audit: 'pairing.mobile_request_confirmed',
    requestId,
    deviceId: req.deviceId,
    deviceName: req.deviceName,
    ts: pairedAt,
  }));
  return { ok: true, device_token: req.token, device_id: req.deviceId, paired_at: pairedAt };
}

export function _resetPairingStateForTests(): void {
  STATE.pending.clear();
  MSTATE.requests.clear();
  if (db) {
    try { db.close(); } catch { /* ignore */ }
  }
  db = null;
  dbInitFailed = false;
}
