/**
 * In-memory mutable store for v1 — holds runtime state that doesn't
 * belong in the fixture snapshot (jobs queued by the owner, deliverables
 * produced by workers, etc.).
 *
 * Lives in @holon/core so service modules (jobs-service,
 * deliverables-service) can read/write through a single typed surface.
 * The admin reset endpoint clears this; a real DB takes over in a later
 * iter.
 *
 * Process-scoped, single instance — fine for dev / single-user. When
 * we move to multi-tenant SaaS this becomes a per-desk DB table.
 */

import type { ChatThread, Deliverable, Mission, OwnerAssistant, Staff } from '@holon/api-contract';
import type { TemplateDescriptor } from './template-catalog.js';
import type { ReferenceDescriptor } from './reference-catalog.js';
import type { SkillDescriptor } from './skill-catalog.js';
import {
  clearAllStaffPersistence,
  hydrateOwnerState,
  readDismissedStaffIds,
  readDynamicMissions,
  readDynamicStaff,
  readStaffOverrides,
  writeDismissedStaffIds,
  writeDynamicMissions,
  writeDynamicStaff,
  writeIntegrationTokens,
  writeOwnerOverrides,
  writeStaffOverrides,
} from './owner-state-persistence.js';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface Job {
  id: string;
  staff_id: string;
  brief: string;
  status: JobStatus;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  deliverable_id?: string;
  error?: string;
}

/** Patch shape: any subset of OwnerAssistant fields the user has edited. */
export type OwnerAssistantPatch = Partial<OwnerAssistant>;

/** Subset of Staff fields the owner agent can patch via update_staff. */
export type StaffPatch = Partial<Pick<Staff,
  | 'name' | 'role_label' | 'role_name' | 'status'
  | 'system_prompt' | 'autonomy_level' | 'governance_mode'
  | 'max_concurrent_jobs' | 'avatar_data'
  | 'denied_skills' | 'monthly_budget_millicents' | 'proxy_staff_id'
  | 'tts_voice' | 'tts_style' | 'reply_language'>>;

interface StoreState {
  jobs: Map<string, Job>;
  deliverables: Map<string, Deliverable>;
  /** Field-level overrides on top of the fixture owner_assistant. v1
   *  in-memory; survives process lifetime but is wiped by reset. */
  ownerOverrides: OwnerAssistantPatch;
  /** Staff created via chat (create_staff tool). Keyed by id. */
  dynamicStaff: Map<string, Staff>;
  /** Field-level overrides on top of fixture or dynamic staff. */
  staffOverrides: Map<string, StaffPatch>;
  /** Soft-delete tombstones — staff_ids hidden from list/get. */
  dismissedStaffIds: Set<string>;
  /** User-created templates (kind etc.) — created via create_template. */
  dynamicTemplates: Map<string, TemplateDescriptor>;
  /** Field-level overrides on top of built-in template descriptors. */
  templateOverrides: Map<string, Partial<TemplateDescriptor>>;
  /** Tombstones — built-in template ids hidden from list/get.
   *  User-defined templates are deleted by removal from dynamicTemplates. */
  deletedTemplateIds: Set<string>;
  /** User-created references — created via create_reference. */
  dynamicReferences: Map<string, ReferenceDescriptor>;
  /** Field-level overrides on top of built-in reference descriptors. */
  referenceOverrides: Map<string, Partial<ReferenceDescriptor>>;
  /** Tombstones — built-in reference ids hidden from list/get. */
  deletedReferenceIds: Set<string>;
  /** User-created skills — created via create_skill. */
  dynamicSkills: Map<string, SkillDescriptor>;
  /** Field-level overrides on top of built-in skill descriptors. */
  skillOverrides: Map<string, Partial<SkillDescriptor>>;
  /** Tombstones — built-in skill ids hidden from list/get.
   *  User-defined skills are deleted by removal from dynamicSkills. */
  deletedSkillIds: Set<string>;
  /** iter-010 Pass #3 — append-only cost ledger. Each row records the
   *  token spend of one completed job. Bounded to last 5000 entries
   *  (oldest evicted FIFO) so the in-memory state doesn't grow without
   *  bound; a real DB takes over in a later iter. */
  staffCostLedger: CostLedgerEntry[];
  /** iter-011 Pass #1 — encrypted OAuth tokens keyed by `${kind}:${owner_id}`.
   *  Values are opaque base64-encoded AES-256-GCM blobs produced by
   *  @holon/auth. mutable-store treats them as opaque strings — it does
   *  NOT know about the encryption layer (one-way dep rule per ADR-022). */
  integrationTokens: Map<string, string>;
  /** iter-022 Phase 1, Pass #3 — Missions created via WeChat paste
   *  (or other non-fixture inbound paths). Keyed by mission id.
   *  Merged into listMissions() + getMission() results alongside fixture
   *  missions. Newest-first in the merge (sorted by created_at desc). */
  dynamicMissions: Map<string, Mission>;
  /** iter-012 Pass #4 — chat threads seeded at runtime (e.g. by
   *  apply-persona posting the starter_greeting as the Desk AI's first
   *  message). Fixture chat_threads + dynamic merge in chat-service.
   *  Keyed by thread id. */
  dynamicChatThreads: Map<string, ChatThread>;
  /** L-053 — id of the persona last applied via applyPersona, so a
   *  subsequent switch can archive the prior persona's seeded staff +
   *  greeting thread (rather than silently stacking both teams). */
  activePersonaId: string | null;
}

/** iter-010 Pass #3 — single row in the staff cost ledger. Stored
 *  process-wide (with the rest of the mutable store) until V3 moves to
 *  a real cost-events table. Millicents = 1/100,000 USD (so $0.001 = 100mc). */
export interface CostLedgerEntry {
  job_id: string;
  staff_id: string;
  token_in: number;
  token_out: number;
  /** Per-row cost in millicents — precomputed at insert so the MTD sum
   *  doesn't need to re-multiply price constants on every read. */
  cost_mc: number;
  /** ISO timestamp of when the spend was recorded. */
  ts: string;
  /** True iff the token counts were estimated (char_count / 4 fallback)
   *  rather than reported by the LLM provider. Surfaced in MTD summary
   *  so the UI can show a confidence hint. */
  estimated: boolean;
}

/** Cap the ledger so old rows can't pin unbounded memory. Sized for
 *  ~5 mo of one job/min before churn — well above the per-process
 *  lifetime of the v1 dev server. */
const COST_LEDGER_MAX = 5000;

const G = globalThis as unknown as { __holonMutable?: Partial<StoreState> };
if (!G.__holonMutable) G.__holonMutable = {};
// Backfill any missing fields on each module load. Important for HMR /
// process-survival: if an older version of this module created the
// global without the new template/reference fields, accessing them
// would explode. Each defaulter only runs when the field is missing,
// so existing data survives.
const M = G.__holonMutable;
if (!M.jobs) M.jobs = new Map();
if (!M.deliverables) M.deliverables = new Map();
if (!M.ownerOverrides) M.ownerOverrides = {};
if (!M.dynamicStaff) M.dynamicStaff = new Map();
if (!M.staffOverrides) M.staffOverrides = new Map();
if (!M.dismissedStaffIds) M.dismissedStaffIds = new Set();
if (!M.dynamicTemplates) M.dynamicTemplates = new Map();
if (!M.templateOverrides) M.templateOverrides = new Map();
if (!M.deletedTemplateIds) M.deletedTemplateIds = new Set();
if (!M.dynamicReferences) M.dynamicReferences = new Map();
if (!M.referenceOverrides) M.referenceOverrides = new Map();
if (!M.deletedReferenceIds) M.deletedReferenceIds = new Set();
if (!M.dynamicSkills) M.dynamicSkills = new Map();
if (!M.skillOverrides) M.skillOverrides = new Map();
if (!M.deletedSkillIds) M.deletedSkillIds = new Set();
if (!M.staffCostLedger) M.staffCostLedger = [];
if (!M.integrationTokens) M.integrationTokens = new Map();
if (!M.dynamicMissions) M.dynamicMissions = new Map();
if (!M.dynamicChatThreads) M.dynamicChatThreads = new Map();
if (M.activePersonaId === undefined) M.activePersonaId = null;
const S = M as StoreState;

/* ── TD-011 V1.0 — SQLite hydrate on first import ──────────────────────
 * Runs exactly once per process (the `__holonHydrated` flag survives HMR
 * via the same globalThis trick that protects `__holonMutable` above).
 * Only fields persisted by `owner-state-persistence.ts` are restored:
 * ownerOverrides + integrationTokens. Everything else (dynamicStaff,
 * staffCostLedger, chatThreads, jobs) stays ephemeral — see TD-011 in
 * TECH-DEBT.md for the deferred-items list.
 *
 * Hydration is non-destructive: if the on-disk row is absent, we keep
 * whatever the in-memory defaulter already set (empty / fixture). This
 * means a missing / corrupt DB file degrades to the pre-TD-011 behavior
 * rather than wiping the user's session. */
const H = globalThis as unknown as { __holonHydrated?: boolean };
if (!H.__holonHydrated) {
  H.__holonHydrated = true;
  const hydrated = hydrateOwnerState();
  if (hydrated.ownerOverrides) {
    S.ownerOverrides = hydrated.ownerOverrides as OwnerAssistantPatch;
  }
  if (hydrated.integrationTokens) {
    for (const [k, v] of hydrated.integrationTokens) S.integrationTokens.set(k, v);
  }
  // TD-011 phase 2a — hydrate dynamicStaff (Staff[] on disk → Map in mem).
  // Read failures inside readDynamicStaff are audit-logged + return []; a
  // missing / corrupt row degrades to "no persisted staff" rather than
  // blocking module init.
  try {
    const persistedStaff = readDynamicStaff();
    for (const s of persistedStaff) S.dynamicStaff.set(s.id, s);
  } catch (err) {
    console.warn('[mutable-store] dynamicStaff hydrate failed:', err);
  }
  // TD-011 phase 2b — hydrate staffOverrides + dismissedStaffIds. Same
  // failure posture as phase 2a: read errors return empty (audit-logged
  // inside the reader), warn-and-continue on the unexpected throw so a
  // corrupt row never blocks boot. Phase 2b completes the staff-roster
  // persistence story; chatThreads + at-rest encryption remain TD-011
  // phase 3+ work.
  try {
    const persistedOverrides = readStaffOverrides();
    for (const [k, v] of persistedOverrides) S.staffOverrides.set(k, v as StaffPatch);
  } catch (err) {
    console.warn('[mutable-store] staffOverrides hydrate failed:', err);
  }
  try {
    const persistedDismissed = readDismissedStaffIds();
    for (const id of persistedDismissed) S.dismissedStaffIds.add(id);
  } catch (err) {
    console.warn('[mutable-store] dismissedStaffIds hydrate failed:', err);
  }
  // iter-022 Phase 1, Pass #3 — hydrate dynamicMissions (Mission[] on disk → Map in mem).
  // Same failure posture as dynamicStaff: read failures inside readDynamicMissions are
  // audit-logged + return []; unexpected throw degrades to "no persisted missions" rather
  // than blocking module init (per TD-011 non-destructive failure posture).
  try {
    const persistedMissions = readDynamicMissions();
    for (const m of persistedMissions) S.dynamicMissions.set(m.id, m);
  } catch (err) {
    console.warn('[mutable-store] dynamicMissions hydrate failed:', err);
  }
}

/* ── Jobs ──────────────────────────────────────────────────────────── */

function mintId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function createJob(input: { staff_id: string; brief: string }): Job {
  const job: Job = {
    id: mintId('job'),
    staff_id: input.staff_id,
    brief: input.brief,
    status: 'queued',
    created_at: new Date().toISOString(),
  };
  S.jobs.set(job.id, job);
  return job;
}

export function listJobs(filter?: { staff_id?: string; status?: JobStatus }): Job[] {
  const all = Array.from(S.jobs.values());
  return all.filter((j) =>
    (!filter?.staff_id || j.staff_id === filter.staff_id) &&
    (!filter?.status   || j.status   === filter.status),
  ).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getJob(id: string): Job | null {
  return S.jobs.get(id) ?? null;
}

export function nextQueuedJob(): Job | null {
  for (const j of S.jobs.values()) if (j.status === 'queued') return j;
  return null;
}

export function markJobRunning(id: string): Job | null {
  const j = S.jobs.get(id);
  if (!j) return null;
  j.status = 'running';
  j.started_at = new Date().toISOString();
  return j;
}

export function markJobCompleted(id: string, deliverable_id: string): Job | null {
  const j = S.jobs.get(id);
  if (!j) return null;
  j.status = 'completed';
  j.completed_at = new Date().toISOString();
  j.deliverable_id = deliverable_id;
  return j;
}

export function markJobFailed(id: string, error: string): Job | null {
  const j = S.jobs.get(id);
  if (!j) return null;
  j.status = 'failed';
  j.completed_at = new Date().toISOString();
  j.error = error;
  return j;
}

/** Hard-delete a job from the in-memory store. Returns true if found + deleted. */
export function deleteJob(id: string): boolean {
  return S.jobs.delete(id);
}

/* ── Worker-produced deliverables ─────────────────────────────────── */

export function createDeliverable(input: Deliverable): Deliverable {
  S.deliverables.set(input.id, input);
  return input;
}

export function listMutableDeliverables(): Deliverable[] {
  return Array.from(S.deliverables.values())
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
}

export function getMutableDeliverable(id: string): Deliverable | null {
  return S.deliverables.get(id) ?? null;
}

/** Hard-delete a deliverable from the in-memory mutable store. Returns true if found + deleted. */
export function deleteMutableDeliverable(id: string): boolean {
  return S.deliverables.delete(id);
}

/** Update a deliverable's review status (accept/reject/etc.). Returns the updated
 *  row, or null if the id isn't in the mutable store (fixture rows are read-only). */
export function setMutableDeliverableStatus(id: string, status: Deliverable['status']): Deliverable | null {
  const d = S.deliverables.get(id);
  if (!d) return null;
  const updated: Deliverable = { ...d, status };
  S.deliverables.set(id, updated);
  return updated;
}

/* ── Owner-assistant field overrides (for /me inline edit) ────────── */

export function getOwnerOverrides(): OwnerAssistantPatch {
  return { ...S.ownerOverrides };
}

export function patchOwnerOverrides(patch: OwnerAssistantPatch): OwnerAssistantPatch {
  // Shallow merge — sufficient since OwnerAssistant has flat top-level
  // fields plus a few small objects (substrate, skills array). Editing
  // sub-fields of substrate isn't currently supported through this path.
  S.ownerOverrides = { ...S.ownerOverrides, ...patch };
  // TD-011: write-through to SQLite so owner_name / owner_role /
  // system_prompt / integrations[] survive a Next.js restart. Errors
  // are swallowed inside writeOwnerOverrides (audit-emitted, not thrown)
  // so a disk-full / permission failure does NOT turn this PATCH into a 500.
  writeOwnerOverrides(S.ownerOverrides as Record<string, unknown>);
  return { ...S.ownerOverrides };
}

/* ── Dynamic staff + overrides + soft-delete ──────────────────────── */

export function addDynamicStaff(s: Staff): Staff {
  S.dynamicStaff.set(s.id, s);
  // TD-011 phase 2a — write-through so chat-created staff survives restart.
  // try/catch + console.warn (NOT console.error / NOT thrown) per brief:
  // a persistence failure must NEVER block the in-memory mutation that
  // the caller observes via the returned Staff.
  try {
    writeDynamicStaff(Array.from(S.dynamicStaff.values()));
  } catch (err) {
    console.warn('[mutable-store] dynamicStaff write failed:', err);
  }
  return s;
}

export function getDynamicStaff(id: string): Staff | null {
  return S.dynamicStaff.get(id) ?? null;
}

export function listDynamicStaff(): Staff[] {
  return Array.from(S.dynamicStaff.values());
}

export function patchStaffOverride(id: string, patch: StaffPatch): StaffPatch {
  const existing = S.staffOverrides.get(id) ?? {};
  const merged = { ...existing, ...patch };
  S.staffOverrides.set(id, merged);
  // TD-011 phase 2b — write-through so per-staff field edits survive restart.
  // Same swallow-on-failure posture as phase 2a addDynamicStaff: a disk
  // failure must NEVER block the in-memory mutation the caller observes
  // via the returned merged patch.
  try {
    writeStaffOverrides(S.staffOverrides);
  } catch (err) {
    console.warn('[mutable-store] staffOverrides write failed:', err);
  }
  return merged;
}

export function getStaffOverride(id: string): StaffPatch | null {
  return S.staffOverrides.get(id) ?? null;
}

export function dismissStaff(id: string): void {
  S.dismissedStaffIds.add(id);
  // TD-011 phase 2b — write-through so soft-delete tombstones survive restart.
  try {
    writeDismissedStaffIds(S.dismissedStaffIds);
  } catch (err) {
    console.warn('[mutable-store] dismissedStaffIds write failed:', err);
  }
}

export function isStaffDismissed(id: string): boolean {
  return S.dismissedStaffIds.has(id);
}

/* ── Dynamic templates / overrides / soft-delete ──────────────────── */

export function addDynamicTemplate(t: TemplateDescriptor): TemplateDescriptor {
  S.dynamicTemplates.set(t.id, t);
  return t;
}

export function removeDynamicTemplate(id: string): boolean {
  return S.dynamicTemplates.delete(id);
}

export function getDynamicTemplate(id: string): TemplateDescriptor | null {
  return S.dynamicTemplates.get(id) ?? null;
}

export function getDynamicTemplates(): TemplateDescriptor[] {
  return Array.from(S.dynamicTemplates.values());
}

export function patchTemplateOverride(id: string, patch: Partial<TemplateDescriptor>): Partial<TemplateDescriptor> {
  const existing = S.templateOverrides.get(id) ?? {};
  const merged: Partial<TemplateDescriptor> = { ...existing, ...patch };
  S.templateOverrides.set(id, merged);
  return merged;
}

export function getTemplateOverride(id: string): Partial<TemplateDescriptor> | null {
  return S.templateOverrides.get(id) ?? null;
}

export function getTemplateOverrides(): Map<string, Partial<TemplateDescriptor>> {
  return S.templateOverrides;
}

export function markTemplateDeleted(id: string): void {
  S.deletedTemplateIds.add(id);
}

export function isTemplateDeleted(id: string): boolean {
  return S.deletedTemplateIds.has(id);
}

export function getDeletedTemplateIds(): Set<string> {
  return S.deletedTemplateIds;
}

/* ── Dynamic references / overrides / soft-delete ─────────────────── */

export function addDynamicReference(r: ReferenceDescriptor): ReferenceDescriptor {
  S.dynamicReferences.set(r.id, r);
  return r;
}

export function removeDynamicReference(id: string): boolean {
  return S.dynamicReferences.delete(id);
}

export function getDynamicReference(id: string): ReferenceDescriptor | null {
  return S.dynamicReferences.get(id) ?? null;
}

export function getDynamicReferences(): ReferenceDescriptor[] {
  return Array.from(S.dynamicReferences.values());
}

export function patchReferenceOverride(id: string, patch: Partial<ReferenceDescriptor>): Partial<ReferenceDescriptor> {
  const existing = S.referenceOverrides.get(id) ?? {};
  const merged: Partial<ReferenceDescriptor> = { ...existing, ...patch };
  S.referenceOverrides.set(id, merged);
  return merged;
}

export function getReferenceOverride(id: string): Partial<ReferenceDescriptor> | null {
  return S.referenceOverrides.get(id) ?? null;
}

export function getReferenceOverrides(): Map<string, Partial<ReferenceDescriptor>> {
  return S.referenceOverrides;
}

export function markReferenceDeleted(id: string): void {
  S.deletedReferenceIds.add(id);
}

export function isReferenceDeleted(id: string): boolean {
  return S.deletedReferenceIds.has(id);
}

export function getDeletedReferenceIds(): Set<string> {
  return S.deletedReferenceIds;
}

/* ── Dynamic skills / overrides / soft-delete ─────────────────────── */

export function addDynamicSkill(s: SkillDescriptor): SkillDescriptor {
  S.dynamicSkills.set(s.id, s);
  return s;
}

export function removeDynamicSkill(id: string): boolean {
  return S.dynamicSkills.delete(id);
}

export function getDynamicSkill(id: string): SkillDescriptor | null {
  return S.dynamicSkills.get(id) ?? null;
}

export function getDynamicSkills(): SkillDescriptor[] {
  return Array.from(S.dynamicSkills.values());
}

export function patchSkillOverride(id: string, patch: Partial<SkillDescriptor>): Partial<SkillDescriptor> {
  const existing = S.skillOverrides.get(id) ?? {};
  const merged: Partial<SkillDescriptor> = { ...existing, ...patch };
  S.skillOverrides.set(id, merged);
  return merged;
}

export function getSkillOverride(id: string): Partial<SkillDescriptor> | null {
  return S.skillOverrides.get(id) ?? null;
}

export function getSkillOverrides(): Map<string, Partial<SkillDescriptor>> {
  return S.skillOverrides;
}

export function markSkillDeleted(id: string): void {
  S.deletedSkillIds.add(id);
}

export function isSkillDeleted(id: string): boolean {
  return S.deletedSkillIds.has(id);
}

export function getDeletedSkillIds(): Set<string> {
  return S.deletedSkillIds;
}

/* ── iter-010 Pass #3 — staff cost ledger ─────────────────────────── */

/** Append a cost row. FIFO-bounded to `COST_LEDGER_MAX` so the array
 *  can't grow without bound on a long-running dev server. */
export function appendCostLedgerEntry(entry: CostLedgerEntry): void {
  S.staffCostLedger.push(entry);
  if (S.staffCostLedger.length > COST_LEDGER_MAX) {
    // Drop the oldest N entries in one splice — cheaper than repeated
    // shift() if the limit is ever increased dramatically.
    S.staffCostLedger.splice(0, S.staffCostLedger.length - COST_LEDGER_MAX);
  }
}

/** Read-only snapshot of the cost ledger. Callers must not mutate the
 *  returned array — it's the live store. (Service modules treat it as
 *  read-only; this is the same posture as `listDynamicStaff` etc.) */
export function getCostLedger(): readonly CostLedgerEntry[] {
  return S.staffCostLedger;
}

/* ── iter-011 Pass #1 — opaque encrypted integration tokens ────────── */

/** Read the opaque encrypted blob for `key`. mutable-store does NOT
 *  decrypt — that's @holon/auth's job (one-way dep per ADR-022). */
export function getIntegrationTokenBlob(key: string): string | null {
  return S.integrationTokens.get(key) ?? null;
}

/** Write the opaque encrypted blob for `key`. Caller (auth) has already
 *  encrypted. */
export function setIntegrationTokenBlob(key: string, blob: string): void {
  S.integrationTokens.set(key, blob);
  // TD-011: write-through. The blob is already AES-256-GCM-encrypted by
  // @holon/auth — at-rest column encryption on top would be belt-and-
  // suspenders. Deferred to V1.2 (see TD-011 § deferred items).
  writeIntegrationTokens(Array.from(S.integrationTokens.entries()));
}

/** Remove the entry. Returns true iff a row existed. */
export function deleteIntegrationTokenBlob(key: string): boolean {
  const removed = S.integrationTokens.delete(key);
  if (removed) writeIntegrationTokens(Array.from(S.integrationTokens.entries()));
  return removed;
}

/* ── iter-022 Phase 1, Pass #3 — dynamic missions (WeChat paste + future) ── */

/** Persist a runtime-created Mission so it survives HMR + Next.js restarts.
 *  Mirrors the addDynamicStaff pattern exactly: in-memory set first, then
 *  write-through to SQLite. A write failure MUST NOT block the in-memory
 *  mutation visible to the caller — warn-and-continue per TD-011 posture. */
export function addDynamicMission(m: Mission): Mission {
  S.dynamicMissions.set(m.id, m);
  try {
    writeDynamicMissions(Array.from(S.dynamicMissions.values()));
  } catch (err) {
    console.warn('[mutable-store] dynamicMissions write failed:', err);
  }
  return m;
}

export function getDynamicMission(id: string): Mission | null {
  return S.dynamicMissions.get(id) ?? null;
}

export function listDynamicMissions(): Mission[] {
  return Array.from(S.dynamicMissions.values());
}

/* ── iter-012 Pass #4 — dynamic chat threads (apply-persona greeting) ── */

export function upsertDynamicChatThread(t: ChatThread): ChatThread {
  S.dynamicChatThreads.set(t.id, t);
  return t;
}

export function getDynamicChatThread(id: string): ChatThread | null {
  return S.dynamicChatThreads.get(id) ?? null;
}

export function listDynamicChatThreads(): ChatThread[] {
  return Array.from(S.dynamicChatThreads.values());
}

export function removeDynamicChatThread(id: string): boolean {
  return S.dynamicChatThreads.delete(id);
}

/* ── L-053 — active persona pointer ───────────────────────────────── */

export function getActivePersonaId(): string | null {
  return S.activePersonaId;
}

export function setActivePersonaId(id: string | null): void {
  S.activePersonaId = id;
}

/* ── Reset (used by /api/v1/admin/reset) ──────────────────────────── */

export interface ResetCounts {
  jobs_cleared: number;
  deliverables_cleared: number;
  owner_overrides_cleared: number;
  dynamic_staff_cleared: number;
  staff_overrides_cleared: number;
  dismissed_staff_cleared: number;
  dynamic_templates_cleared: number;
  template_overrides_cleared: number;
  deleted_templates_cleared: number;
  dynamic_references_cleared: number;
  reference_overrides_cleared: number;
  deleted_references_cleared: number;
  dynamic_skills_cleared: number;
  skill_overrides_cleared: number;
  deleted_skills_cleared: number;
  cost_ledger_cleared: number;
  integration_tokens_cleared: number;
  dynamic_missions_cleared: number;
  dynamic_chat_threads_cleared: number;
}

export function clearMutableStore(): ResetCounts {
  const counts: ResetCounts = {
    jobs_cleared: S.jobs.size,
    deliverables_cleared: S.deliverables.size,
    owner_overrides_cleared: Object.keys(S.ownerOverrides).length,
    dynamic_staff_cleared: S.dynamicStaff.size,
    staff_overrides_cleared: S.staffOverrides.size,
    dismissed_staff_cleared: S.dismissedStaffIds.size,
    dynamic_templates_cleared: S.dynamicTemplates.size,
    template_overrides_cleared: S.templateOverrides.size,
    deleted_templates_cleared: S.deletedTemplateIds.size,
    dynamic_references_cleared: S.dynamicReferences.size,
    reference_overrides_cleared: S.referenceOverrides.size,
    deleted_references_cleared: S.deletedReferenceIds.size,
    dynamic_skills_cleared: S.dynamicSkills.size,
    skill_overrides_cleared: S.skillOverrides.size,
    deleted_skills_cleared: S.deletedSkillIds.size,
    cost_ledger_cleared: S.staffCostLedger.length,
    integration_tokens_cleared: S.integrationTokens.size,
    dynamic_missions_cleared: S.dynamicMissions.size,
    dynamic_chat_threads_cleared: S.dynamicChatThreads.size,
  };
  S.jobs.clear();
  S.deliverables.clear();
  S.ownerOverrides = {};
  S.dynamicStaff.clear();
  S.staffOverrides.clear();
  S.dismissedStaffIds.clear();
  S.dynamicTemplates.clear();
  S.templateOverrides.clear();
  S.deletedTemplateIds.clear();
  S.dynamicReferences.clear();
  S.referenceOverrides.clear();
  S.deletedReferenceIds.clear();
  S.dynamicSkills.clear();
  S.skillOverrides.clear();
  S.deletedSkillIds.clear();
  S.staffCostLedger.length = 0;
  S.integrationTokens.clear();
  S.dynamicMissions.clear();
  S.dynamicChatThreads.clear();
  S.activePersonaId = null;
  // TD-011: reset must also wipe the persisted layer, otherwise the next
  // process boot re-hydrates the just-cleared state.
  writeOwnerOverrides({});
  writeIntegrationTokens([]);
  // TD-011 phase 2b — also drop the staff-related rows (dynamicStaff +
  // staffOverrides + dismissedStaffIds + dynamicMissions) via a single
  // helper. Failures are audit-logged + swallowed inside clearAllStaffPersistence
  // so a stuck DELETE does not turn the admin reset into a 500.
  clearAllStaffPersistence();
  return counts;
}
