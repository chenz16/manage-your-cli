// @holon/core - thin CLI-manager core exports.

import './token-storage-adapter.js';

export { loadFixtures, _resetFixtureCacheForTests } from './fixture-store.js';
export type { Fixtures } from './fixture-store.js';

export {
  clearMutableStore,
  listJobs,
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
  ensureMemoryManagerWorkspace,
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
  readBossMemoryLog,
  writeBossMemory,
  type BossMemoryRead,
  type BossMemoryWrite,
} from './boss-memory-service.js';
export {
  getOrCreateSecretaryStaff,
  ensureSecretaryCliSession,
} from './secretary-service.js';
export {
  getOrCreateMemoryManagerStaff,
  dispatchMemoryConsolidationTask,
} from './memory-manager-service.js';
export {
  startMemoryConsolidationService,
  type MemoryConsolidationServiceState,
} from './memory-consolidation-service.js';
export {
  createCliScreenFormatter,
  stripAnsi,
  type CliScreenFormatter,
  type CliScreenFormatterOptions,
} from './cli-screen-format.js';

export {
  CLI_ADAPTERS,
  getCliAdapter,
  type CliAdapter,
} from './cli-adapters.js';

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

export {
  listSkills,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
  isBuiltInSkill,
  type SkillDescriptor,
  type SkillKind,
  type CreateSkillInput,
} from './skill-catalog.js';

export {
  listReferences,
  getReference,
  createReference,
  updateReference,
  deleteReference,
  isBuiltInReference,
  listPinnedFileReferences,
  type ReferenceDescriptor,
  type ReferenceKind,
  type CreateReferenceInput,
} from './reference-catalog.js';

export {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  isBuiltInTemplate,
  GENERAL_SECRETARY_MENTALITY_TEMPLATE_ID,
  GENERAL_SECRETARY_MENTALITY_BODY,
  isSecretaryInstructionTooThin,
  type TemplateDescriptor,
  type TemplateKind,
  type CreateTemplateInput,
} from './template-catalog.js';

export {
  getToday,
  getBucketDetail,
} from './today-service.js';

export {
  listDeliverables,
  getDeliverable,
  type ListDeliverablesQueryInput,
} from './deliverables-service.js';

export {
  transcribeAudio,
  type TranscribeAudioInput,
  type TranscribeResult,
} from './voice-transcription-service.js';

export {
  synthesizeSpeech,
  type SynthesizeSpeechInput,
  type SynthesizeSpeechResult,
} from './voice-synthesis-service.js';

// Feedback / bug-report (ported from holon-engineering main)
export {
  startBugWatcher, stopBugWatcher, bugWatcherStatus,
  listBugsWithStatus, reprocessBug,
  type BugStatus,
} from './bug-watcher.js';
