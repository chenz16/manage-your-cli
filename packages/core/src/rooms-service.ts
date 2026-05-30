/**
 * rooms-service — meeting room store + operations.
 *
 * Persists rooms and members under the same SQLite KV store used by
 * owner-state-persistence (key 'rooms' → Room[], 'roomMembers' → RoomMember[]).
 * Thread messages live in the chat-transcript-store under threadId 'room:<roomId>'.
 *
 * v1: host_desk_id = local desk's primary_desk_id; all members kind='ai_agent'.
 * Schema includes kind + host_desk_id so v2/v3 (cross-desk, human members)
 * require no migration.
 *
 * Persistence failure posture (mirrors TD-011): every read/write is try/caught.
 * A SQLite error MUST NEVER throw past the public API surface. Errors are
 * audit-logged; the caller receives a graceful fallback (empty array / noop).
 */

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Room, RoomMember } from '@holon/api-contract';
import { loadFixtures } from './fixture-store.js';
import { listStaffMerged } from './staff-management-service.js';

// ── Lazy SQLite singleton (mirrors chat-transcript-store) ─────────────────────

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
    const Database = requireFn('better-sqlite3') as new (path: string) => BetterSqliteDatabase;
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
    return _db;
  } catch (err) {
    _dbInitFailed = true;
    console.error(JSON.stringify({
      audit: 'rooms_service.db_open_failed',
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return null;
  }
}

function readKey<T>(key: string, fallback: T): T {
  const db = ensureDb();
  if (!db) return fallback;
  try {
    const row = db.prepare('SELECT value FROM owner_state WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    if (!row) return fallback;
    const parsed = JSON.parse(row.value) as unknown;
    return parsed as T;
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'rooms_service.read_failed',
      key,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return fallback;
  }
}

function writeKey(key: string, value: unknown): void {
  const db = ensureDb();
  if (!db) return;
  try {
    const json = JSON.stringify(value);
    db.prepare(
      'INSERT OR REPLACE INTO owner_state (key, value, updated_at) VALUES (?, ?, ?)',
    ).run(key, json, Date.now());
    console.log(JSON.stringify({
      audit: 'rooms_service.write',
      key,
      bytes: json.length,
      ts: new Date().toISOString(),
    }));
  } catch (err) {
    console.error(JSON.stringify({
      audit: 'rooms_service.write_failed',
      key,
      error: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
  }
}

// ── In-process cache (globalThis pattern — survives HMR) ─────────────────────

interface RoomsCache {
  rooms: Map<string, Room>;
  members: Map<string, RoomMember[]>; // roomId → members
  hydrated: boolean;
}

const G = globalThis as unknown as { __holonRoomsCache?: RoomsCache };
if (!G.__holonRoomsCache) {
  G.__holonRoomsCache = { rooms: new Map(), members: new Map(), hydrated: false };
}
const C = G.__holonRoomsCache;

function ensureHydrated(): void {
  if (C.hydrated) return;
  C.hydrated = true;
  try {
    const roomsArr = readKey<Room[]>('rooms', []);
    for (const r of roomsArr) C.rooms.set(r.id, r);
  } catch (err) {
    console.warn('[rooms-service] rooms hydrate failed:', err);
  }
  try {
    const membersArr = readKey<RoomMember[]>('roomMembers', []);
    // Group by room_id
    for (const m of membersArr) {
      const existing = C.members.get(m.room_id) ?? [];
      existing.push(m);
      C.members.set(m.room_id, existing);
    }
  } catch (err) {
    console.warn('[rooms-service] roomMembers hydrate failed:', err);
  }
}

function persistRooms(): void {
  try {
    writeKey('rooms', Array.from(C.rooms.values()));
  } catch (err) {
    console.warn('[rooms-service] rooms persist failed:', err);
  }
}

function persistMembers(): void {
  try {
    const all: RoomMember[] = [];
    for (const ms of C.members.values()) all.push(...ms);
    writeKey('roomMembers', all);
  } catch (err) {
    console.warn('[rooms-service] roomMembers persist failed:', err);
  }
}

// ── ID helpers ────────────────────────────────────────────────────────────────

function mintRoomId(): string {
  const ts = Date.now().toString(36).padStart(9, '0');
  const rnd = randomBytes(4).toString('hex');
  return `room_${ts}${rnd}`;
}

function mintPartyId(): string {
  const ts = Date.now().toString(36).padStart(9, '0');
  const rnd = randomBytes(4).toString('hex');
  return `party_${ts}${rnd}`;
}

// ── Local desk id ─────────────────────────────────────────────────────────────

function localDeskId(): string {
  try {
    const fx = loadFixtures();
    return fx.primary_desk_id;
  } catch {
    return 'desk_local';
  }
}

function localOwnerId(): string {
  try {
    const fx = loadFixtures();
    return fx.owner_assistant.id;
  } catch {
    return 'owner_local';
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function listRooms(): Room[] {
  ensureHydrated();
  return Array.from(C.rooms.values()).sort(
    (a, b) => b.created_at.localeCompare(a.created_at),
  );
}

export function getRoom(id: string): Room | null {
  ensureHydrated();
  return C.rooms.get(id) ?? null;
}

export interface MemberSeed {
  staff_id: string;
  display_name: string;
}

export interface CreateRoomInput {
  name: string;
  /** Staff seeds to add as ai_agent members immediately. */
  member_seeds?: MemberSeed[];
}

export function createRoom(input: CreateRoomInput): Room {
  ensureHydrated();
  const id = mintRoomId();
  const room: Room = {
    id,
    name: input.name.trim() || '未命名会议室',
    host_desk_id: localDeskId(),
    host_owner_id: localOwnerId(),
    created_at: new Date().toISOString(),
  };
  C.rooms.set(id, room);
  persistRooms();

  // Seed initial members if provided.
  if (input.member_seeds && input.member_seeds.length > 0) {
    const deskId = localDeskId();
    for (const seed of input.member_seeds) {
      const m: RoomMember = {
        room_id: id,
        party_id: mintPartyId(),
        kind: 'ai_agent',
        desk_id: deskId,
        ref_id: seed.staff_id,
        display_name: seed.display_name,
      };
      const existing = C.members.get(id) ?? [];
      existing.push(m);
      C.members.set(id, existing);
    }
    persistMembers();
  }

  console.log(JSON.stringify({
    audit: 'rooms_service.room_created',
    room_id: id,
    name: room.name,
    ts: new Date().toISOString(),
  }));
  return room;
}

export function renameRoom(id: string, name: string): Room | null {
  ensureHydrated();
  const room = C.rooms.get(id);
  if (!room) return null;
  const updated: Room = { ...room, name: name.trim() || room.name };
  C.rooms.set(id, updated);
  persistRooms();
  return updated;
}

export function deleteRoom(id: string): boolean {
  ensureHydrated();
  const had = C.rooms.delete(id);
  if (had) {
    C.members.delete(id);
    persistRooms();
    persistMembers();
    console.log(JSON.stringify({
      audit: 'rooms_service.room_deleted',
      room_id: id,
      ts: new Date().toISOString(),
    }));
  }
  return had;
}

export function listMembers(roomId: string): RoomMember[] {
  ensureHydrated();
  return C.members.get(roomId) ?? [];
}

export interface AddMemberInput {
  kind: 'ai_agent' | 'human';
  ref_id: string;
  display_name: string;
  desk_id?: string;
}

export function addMember(roomId: string, input: AddMemberInput): RoomMember {
  ensureHydrated();
  const m: RoomMember = {
    room_id: roomId,
    party_id: mintPartyId(),
    kind: input.kind,
    desk_id: input.desk_id ?? localDeskId(),
    ref_id: input.ref_id,
    display_name: input.display_name,
  };
  const existing = C.members.get(roomId) ?? [];
  existing.push(m);
  C.members.set(roomId, existing);
  persistMembers();
  console.log(JSON.stringify({
    audit: 'rooms_service.member_added',
    room_id: roomId,
    party_id: m.party_id,
    kind: m.kind,
    ref_id: m.ref_id,
    ts: new Date().toISOString(),
  }));
  return m;
}

export function removeMember(roomId: string, partyId: string): boolean {
  ensureHydrated();
  const existing = C.members.get(roomId);
  if (!existing) return false;
  const idx = existing.findIndex((m) => m.party_id === partyId);
  if (idx === -1) return false;
  existing.splice(idx, 1);
  C.members.set(roomId, existing);
  persistMembers();
  return true;
}

// ── Default team room ─────────────────────────────────────────────────────────

/** Stable id for the singleton v1 team meeting room. */
export const DEFAULT_TEAM_ROOM_ID = 'room_default_team';

/**
 * Idempotent: get-or-create the default team meeting room and SYNC its
 * member list to the current cli_agent staff (excluding the secretary).
 *
 * Rules:
 *  - Creates the room with id `DEFAULT_TEAM_ROOM_ID` if it doesn't exist.
 *  - For every cli_agent staff whose role_name !== 'secretary', ensures a
 *    member row with kind='ai_agent', ref_id=staff.id exists.
 *  - Removes member rows whose ref_id no longer maps to an active cli_agent
 *    non-secretary staff.
 *  - Returns the merged Room (reflecting the synced member list in the
 *    rooms cache; call listMembers(DEFAULT_TEAM_ROOM_ID) for member detail).
 */
export function getOrCreateDefaultTeamRoom(): Room {
  ensureHydrated();

  // Ensure the room row exists.
  let room = C.rooms.get(DEFAULT_TEAM_ROOM_ID);
  if (!room) {
    room = {
      id: DEFAULT_TEAM_ROOM_ID,
      name: '团队',
      host_desk_id: localDeskId(),
      host_owner_id: localOwnerId(),
      created_at: new Date().toISOString(),
    };
    C.rooms.set(DEFAULT_TEAM_ROOM_ID, room);
    persistRooms();
    console.log(JSON.stringify({
      audit: 'rooms_service.default_team_room_created',
      room_id: DEFAULT_TEAM_ROOM_ID,
      ts: new Date().toISOString(),
    }));
  }

  // Compute the desired member set: all cli_agent staff except the secretary.
  let allStaff: Array<{ id: string; name: string; role_name?: string; substrate?: { kind: string } }> = [];
  try {
    allStaff = listStaffMerged();
  } catch (err) {
    console.warn('[rooms-service] getOrCreateDefaultTeamRoom: listStaffMerged failed:', err);
  }
  const activeAgents = allStaff.filter(
    (s) => s.substrate?.kind === 'cli_agent' && s.role_name !== 'secretary',
  );
  const activeIds = new Set(activeAgents.map((s) => s.id));

  // Current members for this room.
  const existing = C.members.get(DEFAULT_TEAM_ROOM_ID) ?? [];
  const existingByRefId = new Map(existing.map((m) => [m.ref_id, m]));

  // Remove stale members (ref_id no longer in active agents).
  const toKeep = existing.filter((m) => activeIds.has(m.ref_id));
  const removed = existing.length - toKeep.length;

  // Add missing members.
  const deskId = localDeskId();
  const presentRefIds = new Set(toKeep.map((m) => m.ref_id));
  const toAdd: RoomMember[] = [];
  for (const s of activeAgents) {
    if (!presentRefIds.has(s.id)) {
      toAdd.push({
        room_id: DEFAULT_TEAM_ROOM_ID,
        party_id: mintPartyId(),
        kind: 'ai_agent',
        desk_id: deskId,
        ref_id: s.id,
        display_name: s.name,
      });
    } else {
      // Keep but update display_name if it drifted (staff rename).
      const m = existingByRefId.get(s.id);
      if (m && m.display_name !== s.name) {
        const idx = toKeep.findIndex((x) => x.party_id === m.party_id);
        if (idx !== -1) toKeep[idx] = { ...m, display_name: s.name };
      }
    }
  }

  const synced = [...toKeep, ...toAdd];
  C.members.set(DEFAULT_TEAM_ROOM_ID, synced);

  if (removed > 0 || toAdd.length > 0) {
    persistMembers();
    console.log(JSON.stringify({
      audit: 'rooms_service.default_team_room_synced',
      room_id: DEFAULT_TEAM_ROOM_ID,
      members_total: synced.length,
      added: toAdd.length,
      removed,
      ts: new Date().toISOString(),
    }));
  }

  return room;
}

/** Wipe all room data — used by admin reset. */
export function clearRoomsStore(): { rooms_cleared: number; members_cleared: number } {
  ensureHydrated();
  const rc = C.rooms.size;
  let mc = 0;
  for (const ms of C.members.values()) mc += ms.length;
  C.rooms.clear();
  C.members.clear();
  persistRooms();
  persistMembers();
  return { rooms_cleared: rc, members_cleared: mc };
}
