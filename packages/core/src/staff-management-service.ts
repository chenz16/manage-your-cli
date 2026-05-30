/**
 * Staff management service — create / update / dismiss virtual staff
 * from chat. iter-007 step 7.
 *
 * Engineering rules (CLAUDE.md):
 *   - Rule 1: Holon owns the roster — CLI agents are executors.
 *   - Rule 5: flat-roster invariant — these tools create staff on the
 *     OWNER's desk, never under another staff record. Enforced by
 *     parsing `desk_id = primary_desk_id`.
 *   - Rule 6: owner-mediated authority — the only path that calls this
 *     is the desk-AI's tool surface, invoked by the owner from chat.
 *   - Rule 8: post-emit audit — every mutation logs an `audit:` event.
 */

import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Staff } from '@holon/api-contract';
import { loadFixtures } from './fixture-store.js';
import {
  addDynamicStaff, getDynamicStaff, listDynamicStaff,
  patchStaffOverride, getStaffOverride,
  dismissStaff as markDismissed, isStaffDismissed,
  type StaffPatch,
} from './mutable-store.js';
import { getCliAdapter } from './cli-adapters.js';
import { ensureAgentMemoryFile } from './cli-memory-scaffold.js';
import { readDynamicStaff } from './owner-state-persistence.js';

/** Mint a staff_<…> id matching the ID_SUFFIX_RE regex (20–30 alnum).
 *  9-char base36 timestamp + 16 hex chars = 25-char suffix, ALWAYS in range.
 *  The old Math.random().toString(36) suffix was variable-length and dropped
 *  below 20 chars ~0.7% of the time → an invalid id that crashed /members +
 *  /api/v1/staff via Zod. (Matches mintMissionId in wechat-paste.service.) */
function mintStaffId(): string {
  const ts = Date.now().toString(36).padStart(9, '0');
  const rnd = randomBytes(8).toString('hex');
  return `staff_${ts}${rnd}`;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeCrockford(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

function mintStaffUuidV7LikeId(): string {
  const bytes = randomBytes(16);
  const now = BigInt(Date.now());
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = Number((now >> BigInt((5 - i) * 8)) & 0xffn);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return `staff_${encodeCrockford(bytes).slice(0, 26)}`;
}

function agentsHome(): string {
  return process.env.HOLON_AGENTS_HOME?.trim() || join(homedir(), 'holon-agents');
}

export interface CreateCliAgentInput {
  role: string;
  lifecycle?: 'short' | 'long';
  binary?: string;
}

export function createCliAgentStaff(input: CreateCliAgentInput): Staff {
  const fx = loadFixtures();
  const role = input.role.trim();
  if (!role) throw new Error('role is required');
  const lifecycle = input.lifecycle ?? 'short';
  const binary = input.binary?.trim() || process.env.HOLON_AGENT_BINARY?.trim() || 'claude';
  const roleName = role.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '') || 'cli_agent';
  const id = mintStaffUuidV7LikeId();
  const cwd = join(agentsHome(), id);
  const staff: Staff = {
    id,
    desk_id: fx.primary_desk_id,
    name: role,
    role_name: roleName,
    role_label: role,
    substrate: {
      kind: 'cli_agent',
      binary,
      args_template: getCliAdapter(binary).interactiveArgs,
      approval_rules: [],
      lifecycle,
      cwd,
      auto_launch: true,
    },
    autonomy_level: 'Supervised',
    governance_mode: 'graduated',
    status: 'active',
    current_jobs: 0,
    max_concurrent_jobs: 1,
    cultivation_maturity: 0,
    system_prompt: `You are a ${role}. Do the assigned work in your CLI session. Durable memory lives in the boss memory store; use MCP read_memory/write_memory when context or training is needed.`,
    created_at: new Date().toISOString(),
    denied_skills: [],
    tags: lifecycle === 'long' ? ['long_term'] : ['short_term'],
    project_ids: [],
  };
  addDynamicStaff(staff);
  if (lifecycle === 'long') ensureAgentMemoryFile(cwd, staff, binary);
  console.log(JSON.stringify({
    audit: 'cli_agent.created',
    staff_id: staff.id,
    role,
    lifecycle,
    binary,
    ts: staff.created_at,
  }));
  return staff;
}

export interface CreateStaffInput {
  name: string;
  role_label: string;
  role_name?: string;            // snake_case; auto-derived from role_label if absent
  system_prompt?: string;
  max_concurrent_jobs?: number;  // default 1
  agent_profile_id?: string;     // default 'local_ai_generic_v1'
  tool_scope?: string[];          // default ['web_search', 'read_file']
  /** Free-form tag labels (e.g. ['task_group:选题&研究', 'pack:youtube-creator']).
   *  Defaults to [] when not provided. */
  tags?: string[];
  /** Explicit substrate override — used by the connectors flow to create
   *  cli_agent staff for Claude Code / Codex without going through chat.
   *  When present, overrides all substrate-related defaults (agent_profile_id
   *  / tool_scope are ignored). Must be a valid Substrate discriminated union. */
  substrate?: import('@holon/api-contract').Substrate;
}

export function createStaff(input: CreateStaffInput): Staff {
  const fx = loadFixtures();
  const name = input.name.trim();
  const role_label = input.role_label.trim();
  if (!name) throw new Error('name is required');
  if (!role_label) throw new Error('role_label is required');

  const role_name = (input.role_name ?? role_label)
    .toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '') || 'staff';

  const substrate: Staff['substrate'] = input.substrate ?? {
    kind: 'local_ai',
    agent_profile_id: input.agent_profile_id ?? 'local_ai_generic_v1',
    tool_scope: input.tool_scope ?? ['web_search', 'read_file'],
  };

  const staff: Staff = {
    id: mintStaffId(),
    desk_id: fx.primary_desk_id, // Rule 5: owner's desk only
    name,
    role_name,
    role_label,
    substrate,
    autonomy_level: 'Supervised',
    governance_mode: 'graduated',
    status: 'active',
    current_jobs: 0,
    max_concurrent_jobs: input.max_concurrent_jobs ?? 1,
    cultivation_maturity: 0,
    system_prompt: input.system_prompt?.trim(),
    created_at: new Date().toISOString(),
    // iter-009: deny-list authorization model — newly created staff
    // inherits everything the CEO has access to.
    denied_skills: [],
    // iter-012 Pass #4: free-form labels. Owner-created staff via chat
    // get no tags (only persona-seeded "suggested" staff carry one).
    // Team-pack imports may supply tags like ['task_group:X', 'pack:Y'].
    tags: input.tags ?? [],
    // Phase 1: no project affiliation by default (shared/cross-project).
    project_ids: [],
  };

  addDynamicStaff(staff);
  console.log(JSON.stringify({
    audit: 'staff.created', staff_id: staff.id, name, role_label, ts: staff.created_at,
  }));
  return staff;
}

export function getStaffMerged(id: string): Staff | null {
  if (isStaffDismissed(id)) return null;
  const fx = loadFixtures();
  // Mirror listStaffMerged: dynamic staff created by a SEPARATE process (the
  // Secretary's Holon MCP create_agent) live only in the DB — the in-memory Map
  // is hydrated once at boot. Without the DB fallback, getStaffMerged returns
  // null for those (404), so they show in the roster but can't be opened/chatted
  // ("staff 不能私聊"). DB is authoritative for cross-process creates.
  const base = fx.staff.find((s) => s.id === id)
    ?? getDynamicStaff(id)
    ?? readDynamicStaff().find((s) => s.id === id)
    ?? null;
  if (!base) return null;
  const ov = getStaffOverride(id);
  return ov ? { ...base, ...ov } : base;
}

export function listStaffMerged(): Staff[] {
  const fx = loadFixtures();
  // Apply overrides to fixture rows, plus all dynamic staff, minus
  // anything in the dismissed set. Dismissed dynamic staff get hidden
  // too; dismissed fixture staff stay hidden until reset.
  const fromFixture = fx.staff
    .filter((s) => !isStaffDismissed(s.id))
    .map((s) => {
      const ov = getStaffOverride(s.id);
      return ov ? { ...s, ...ov } : s;
    });
  // Re-read dynamic staff from the persistent DB each call so staff created by a
  // SEPARATE process (e.g. the Secretary's Holon MCP via create_agent) show up in
  // the web roster — the in-memory Map is only hydrated once at boot. DB is
  // authoritative (also reflects cross-process retire); union with in-memory by id.
  const dynById = new Map<string, Staff>();
  for (const s of listDynamicStaff()) dynById.set(s.id, s);
  for (const s of readDynamicStaff()) dynById.set(s.id, s);
  const fromDynamic = [...dynById.values()]
    .filter((s) => !isStaffDismissed(s.id))
    .map((s) => {
      const ov = getStaffOverride(s.id);
      return ov ? { ...s, ...ov } : s;
    });
  return [...fromFixture, ...fromDynamic];
}

export function updateStaff(id: string, patch: StaffPatch): Staff | null {
  if (!getStaffMerged(id)) return null; // missing or dismissed
  patchStaffOverride(id, patch);
  const updated = getStaffMerged(id);
  console.log(JSON.stringify({
    audit: 'staff.updated', staff_id: id, fields: Object.keys(patch),
    ts: new Date().toISOString(),
  }));
  return updated;
}

export function dismissStaffById(id: string): { ok: boolean; reason?: string } {
  const s = getStaffMerged(id);
  if (!s) return { ok: false, reason: 'not_found_or_dismissed' };
  // Refuse to dismiss CLI / peer / owner-assistant — those are structural,
  // not "virtual employees the owner hired". Owner can edit them another
  // way later (config sheet for peer/CLI lands in iter-008+).
  if (s.substrate.kind !== 'local_ai') {
    return { ok: false, reason: `cannot dismiss substrate=${s.substrate.kind}` };
  }
  markDismissed(id);
  console.log(JSON.stringify({
    audit: 'staff.dismissed', staff_id: id, name: s.name,
    ts: new Date().toISOString(),
  }));
  return { ok: true };
}

export function retireCliAgentStaff(id: string): { ok: boolean; lifecycle?: 'short' | 'long'; staff?: Staff; reason?: string } {
  const s = getStaffMerged(id);
  if (!s) return { ok: false, reason: 'not_found_or_dismissed' };
  if (s.substrate.kind !== 'cli_agent' && s.substrate.kind !== 'cli') {
    return { ok: false, reason: `substrate_not_cli_agent (${s.substrate.kind})` };
  }
  const lifecycle = s.substrate.kind === 'cli_agent' ? s.substrate.lifecycle ?? 'short' : 'short';
  if (lifecycle === 'short') {
    patchStaffOverride(id, { status: 'archived' });
    markDismissed(id);
    console.log(JSON.stringify({
      audit: 'cli_agent.archived_short',
      staff_id: id,
      lifecycle,
      ts: new Date().toISOString(),
    }));
    return { ok: true, lifecycle, staff: s };
  }
  patchStaffOverride(id, { status: 'archived' });
  const updated = getStaffMerged(id);
  console.log(JSON.stringify({
    audit: 'cli_agent.archived_long',
    staff_id: id,
    lifecycle,
    ts: new Date().toISOString(),
  }));
  return { ok: true, lifecycle, staff: updated ?? s };
}
