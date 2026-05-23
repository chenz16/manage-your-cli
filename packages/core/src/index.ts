// @holon/core - thin CLI-manager core exports.

import './token-storage-adapter.js';

export { loadFixtures, _resetFixtureCacheForTests } from './fixture-store.js';
export type { Fixtures } from './fixture-store.js';

export {
  clearMutableStore,
  type OwnerAssistantPatch,
  type StaffPatch,
} from './mutable-store.js';

export {
  emitIntegrationAudit,
  type IntegrationEvent,
  type IntegrationAuditInput,
} from './audit.js';

export { getOwner, updateOwner, applyPersona } from './owner-config-service.js';
export { getEffectiveLanguage } from './owner-language.js';

export {
  createStaff,
  updateStaff,
  dismissStaffById,
  getStaffMerged,
  listStaffMerged,
  createCliAgentStaff,
  retireCliAgentStaff,
  type CreateStaffInput,
  type CreateCliAgentInput,
} from './staff-management-service.js';

export {
  launchCliSession,
  sendKeys,
  killCliSession,
  getCliStatus,
  subscribeOutput,
  clearAllCliSessions,
  resizeCliSession,
  sendPrompt,
  paneCurrentCommand,
  captureCliOutput,
  type CliStatus,
} from './cli-session-service.js';
export {
  ensureAgentMemoryFile,
  ensureManagerWorkspace,
  ensureSecretaryWorkspace,
} from './cli-memory-scaffold.js';

export {
  dispatchCliTask,
  buildCliPreamble,
  looksLikeBareShell,
  type DispatchCliTaskInput,
  type DispatchCliTaskResult,
} from './cli-dispatch-service.js';
export {
  readCliStaffMemory,
  writeCliStaffMemory,
} from './owner-state-persistence.js';
export {
  bossMemoryRoot,
  readBossMemory,
  writeBossMemory,
  type BossMemoryRead,
  type BossMemoryWrite,
} from './boss-memory-service.js';
export {
  getOrCreateSecretaryStaff,
  ensureSecretaryCliSession,
} from './secretary-service.js';
export {
  createCliScreenFormatter,
  stripAnsi,
  type CliScreenFormatter,
  type CliScreenFormatterOptions,
} from './cli-screen-format.js';

export {
  ensureManagerStaff,
  runManagerTurn,
  extractManagerReply,
  type RunManagerTurnInput,
  type RunManagerTurnResult,
} from './manager-chat-service.js';

export {
  listPersonas,
  getPersona,
  personaToolScope,
  type PersonaPreset,
} from './persona-catalog.js';
