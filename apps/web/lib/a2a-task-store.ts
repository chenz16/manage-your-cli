/**
 * a2a-task-store — process-local in-memory store for A2A task lifecycle.
 *
 * Tracks tasks created by message/send and message/stream so tasks/get and
 * tasks/cancel can look them up. Process-local is intentional for v1 (same
 * pattern as warm-agent's AGENTS registry).
 *
 * ADR: docs/adr/ADR-A2A-interconnect.md  Slice C
 */

export type TaskState = 'submitted' | 'working' | 'completed' | 'failed' | 'canceled';

export interface A2ATaskRecord {
  id: string;
  contextId: string;
  state: TaskState;
  text: string;           // accumulated artifact text (may be partial while working)
  abort?: AbortController;
  updatedAt: string;      // ISO timestamp
}

// ---------------------------------------------------------------------------
// Module-level store (survives HMR via globalThis trick, same as warm-agent)
// ---------------------------------------------------------------------------

const G = globalThis as unknown as { __holonA2ATaskStore?: Map<string, A2ATaskRecord> };
if (!G.__holonA2ATaskStore) G.__holonA2ATaskStore = new Map();
const STORE = G.__holonA2ATaskStore;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function createTask(id: string, contextId: string): A2ATaskRecord {
  const record: A2ATaskRecord = {
    id,
    contextId,
    state: 'submitted',
    text: '',
    updatedAt: new Date().toISOString(),
  };
  STORE.set(id, record);
  return record;
}

export function getTask(id: string): A2ATaskRecord | undefined {
  return STORE.get(id);
}

export function updateTask(id: string, patch: Partial<Pick<A2ATaskRecord, 'state' | 'text'>>): A2ATaskRecord | undefined {
  const record = STORE.get(id);
  if (!record) return undefined;
  if (patch.state !== undefined) record.state = patch.state;
  if (patch.text !== undefined) record.text = patch.text;
  record.updatedAt = new Date().toISOString();
  return record;
}

export function setAbort(id: string, ctrl: AbortController): void {
  const record = STORE.get(id);
  if (record) record.abort = ctrl;
}
