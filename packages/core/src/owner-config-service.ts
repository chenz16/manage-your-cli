/**
 * Owner-config service — exposes the OwnerAssistant record with any
 * in-memory user edits applied on top of the fixture baseline.
 *
 * iter-007 step 6. The /me page reads via this; the PATCH endpoint
 * writes via mutable-store.patchOwnerOverrides.
 *
 * iter-009: `applyPersona` lets the owner switch the owner-role bundle
 * (role + intro + system_prompt + tool_scope) in one click, then refine
 * via inline-edit + ✨ Polish.
 *
 * D3 (refactor): applyPersona now routes all substrate writes through
 * updateOwner() — the single authoritative write path for OwnerAssistant
 * state. Previously applyPersona called patchOwnerOverrides() directly
 * (from mutable-store), creating a second write path that could diverge
 * from the service layer. Now there is exactly ONE code path that writes
 * substrate for OwnerAssistant updates: updateOwner().
 */

import { randomBytes } from 'node:crypto';
import type { ChatThread, Staff } from '@holon/api-contract';
import type { OwnerAssistant } from '@holon/api-contract';
import { loadFixtures } from './fixture-store.js';
import {
  addDynamicStaff,
  dismissStaff,
  getActivePersonaId,
  getOwnerOverrides,
  isStaffDismissed,
  listDynamicStaff,
  patchOwnerOverrides,
  removeDynamicChatThread,
  setActivePersonaId,
  upsertDynamicChatThread,
  type OwnerAssistantPatch,
} from './mutable-store.js';
import { getPersona, personaToolScope, type PersonaPreset, type StarterStaffSeed } from './persona-catalog.js';

export function getOwner(): OwnerAssistant {
  const fx = loadFixtures();
  return { ...fx.owner_assistant, ...getOwnerOverrides() };
}

export function updateOwner(patch: OwnerAssistantPatch): OwnerAssistant {
  patchOwnerOverrides(patch);
  return getOwner();
}

/**
 * Apply a persona preset onto the OwnerAssistant — overwrites
 * owner_role, owner_intro, system_prompt, and substrate.tool_scope.
 * Everything else (owner_name, workspace, budget, integrations, skills,
 * upstream peer) is preserved so the owner doesn't lose their identity
 * when switching roles.
 *
 * iter-012 Pass #4: additionally seeds the persona's `starter_staff[]`
 * onto desk.staff (tagged `'suggested'`) and posts the `starter_greeting`
 * to the chat thread as the Desk AI's first message. Per Pass #7 audit
 * § 6 (bundled fixtures gap): first-launch customer should not see an
 * empty roster + empty chat. Idempotent — re-applying skips staff seeds
 * whose role_name already exists (so persona-flip doesn't duplicate),
 * and replaces the greeting thread in place.
 */
export interface ApplyPersonaResult {
  ok: boolean;
  owner?: OwnerAssistant;
  reason?: string;
  /** L-053 — prior persona that was replaced (null on first-apply or
   *  re-applying the same persona). */
  replaced_persona?: { id: string; name: string } | null;
  /** Count of `suggested`-tagged staff archived because they belonged
   *  to the replaced persona. Zero on first-apply / re-apply. */
  archived_staff_count?: number;
  /** True iff the replaced persona's starter chat thread was removed. */
  archived_greeting_thread?: boolean;
}

export function applyPersona(persona_id: string): ApplyPersonaResult {
  const p = getPersona(persona_id);
  if (!p) return { ok: false, reason: 'unknown persona_id' };

  // L-053 — if switching to a different persona, archive the prior
  // persona's seeded staff + greeting thread BEFORE seeding the new
  // one, so role-name collisions can't accidentally keep an old seed.
  const priorId = getActivePersonaId();
  let replaced: { id: string; name: string } | null = null;
  let archivedStaffCount = 0;
  let archivedGreetingThread = false;
  if (priorId && priorId !== persona_id) {
    const prior = getPersona(priorId);
    if (prior) {
      replaced = { id: prior.id, name: prior.name };
      archivedStaffCount = archivePriorStarterStaff(prior);
      archivedGreetingThread = removeDynamicChatThread(`chat_starter_${prior.id}`);
    }
  }

  const current = getOwner();
  // D3: route through updateOwner() — the single authoritative write path
  // for OwnerAssistant state — instead of calling patchOwnerOverrides()
  // from mutable-store directly. This kills the dual-substrate-write footgun.
  updateOwner({
    owner_role: p.owner_role,
    owner_intro: p.owner_intro,
    system_prompt: p.system_prompt,
    substrate: {
      ...current.substrate,
      tool_scope: personaToolScope(p),
    },
  });

  // Seed starter staff (idempotent on role_name).
  const seededStaff = seedStarterStaff(p);

  // Post starter greeting to a deterministic Desk AI chat thread.
  const greetingThread = seedStarterGreetingThread(p);
  setActivePersonaId(persona_id);

  console.log(JSON.stringify({
    audit: 'owner.persona.applied',
    persona_id,
    persona_name: p.name,
    staff_seeded: seededStaff.length,
    greeting_posted: Boolean(greetingThread),
    replaced_persona_id: replaced?.id ?? null,
    archived_staff_count: archivedStaffCount,
    archived_greeting_thread: archivedGreetingThread,
    ts: new Date().toISOString(),
  }));
  return {
    ok: true,
    owner: getOwner(),
    replaced_persona: replaced,
    archived_staff_count: archivedStaffCount,
    archived_greeting_thread: archivedGreetingThread,
  };
}

/** L-053 — dismiss any `'suggested'`-tagged dynamic staff whose
 *  role_name matches a seed in the replaced persona. Built-in fixture
 *  staff are NOT dismissed even if role_name matches — only staff that
 *  were materialized via prior applyPersona calls (which always carry
 *  the `'suggested'` tag) are eligible for soft-archive. */
function archivePriorStarterStaff(prior: PersonaPreset): number {
  const targetRoleNames = new Set(prior.starter_staff.map((s) => s.role_name));
  let n = 0;
  for (const s of listDynamicStaff()) {
    if (isStaffDismissed(s.id)) continue;
    if (!s.tags?.includes('suggested')) continue;
    if (!targetRoleNames.has(s.role_name)) continue;
    dismissStaff(s.id);
    n++;
  }
  return n;
}

/* ── iter-012 Pass #4 — starter-staff + starter-greeting seeders ─────── */

/** Mint a staff_<…> id matching ID_SUFFIX_RE (20-30 alnum chars).
 *  Mirrors staff-management-service.mintStaffId; duplicated locally so
 *  this module doesn't create a circular import. */
function mintStaffId(): string {
  const ts = Date.now().toString(36).padStart(9, '0');
  const rnd = randomBytes(8).toString('hex');
  return `staff_${ts}${rnd}`;
}

/** Seed the persona's starter_staff into the dynamic-staff store.
 *  Skips any seed whose role_name already exists in fixture or dynamic
 *  staff (post-dismissal) — keeps persona-flip idempotent without
 *  spawning duplicates.
 *
 *  Customer-build gate (owner directive 2026-05-20): seeding is skipped
 *  unless HOLON_SEED_DEMO_STAFF=1 is set in the environment. The customer
 *  release build leaves this env var unset so a fresh install always
 *  starts with an empty team roster. The test/dev profile sets it to
 *  retain the demo-staff UX for internal testing. Skills, templates, and
 *  references are stored in their own catalogs and are NOT affected by
 *  this gate. */
function seedStarterStaff(p: PersonaPreset): Staff[] {
  // Skip demo-staff seeding in the customer build (env var absent or != '1').
  if (process.env.HOLON_SEED_DEMO_STAFF !== '1') return [];
  const fx = loadFixtures();
  const existingRoleNames = new Set<string>([
    ...fx.staff.filter((s) => !isStaffDismissed(s.id)).map((s) => s.role_name),
    ...listDynamicStaff().filter((s) => !isStaffDismissed(s.id)).map((s) => s.role_name),
  ]);
  const out: Staff[] = [];
  for (const seed of p.starter_staff) {
    if (existingRoleNames.has(seed.role_name)) continue;
    const s = materializeSeed(seed, fx.primary_desk_id);
    addDynamicStaff(s);
    out.push(s);
  }
  return out;
}

function materializeSeed(seed: StarterStaffSeed, desk_id: string): Staff {
  return {
    id: mintStaffId(),
    desk_id,
    name: seed.name,
    role_name: seed.role_name,
    role_label: seed.role_label,
    substrate: {
      kind: 'local_ai',
      agent_profile_id: 'local_ai_generic_v1',
      tool_scope: seed.tool_scope,
    },
    autonomy_level: 'Supervised',
    governance_mode: 'graduated',
    status: 'active',
    current_jobs: 0,
    max_concurrent_jobs: 1,
    cultivation_maturity: 0,
    system_prompt: seed.system_prompt,
    created_at: new Date().toISOString(),
    denied_skills: [],
    tags: ['suggested'],
  };
}

/** Post the persona's starter_greeting to a chat thread between the
 *  owner and the Desk AI. Thread id is deterministic per persona so
 *  re-applying the same persona replaces the greeting in place rather
 *  than fanning out duplicate threads. */
function seedStarterGreetingThread(p: PersonaPreset): ChatThread | null {
  const fx = loadFixtures();
  const owner = fx.owner_assistant;
  // ts in HH:MM (per ChatMessage schema — fixtures use clock-time, not ISO).
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const thread: ChatThread = {
    id: `chat_starter_${p.id}`,
    participant_name: owner.name ?? 'Desk AI',
    participant_role: p.owner_role,
    staff_id: owner.id,
    messages: [
      { role: 'agent', ts: `${hh}:${mm}`, body: p.starter_greeting },
    ],
  };
  upsertDynamicChatThread(thread);
  return thread;
}
