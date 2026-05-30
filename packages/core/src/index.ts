// @holon/core - thin CLI-manager core exports.

import './token-storage-adapter.js';

export { loadFixtures, _resetFixtureCacheForTests } from './fixture-store.js';
export type { Fixtures } from './fixture-store.js';

export {
  clearMutableStore,
  listJobs,
  deleteJob,
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
  listRegistry,
  listInstalled,
  installPlugin,
  setPluginEnabled,
  uninstallPlugin,
  mcpPluginId,
  type InstalledMcpPlugin,
  type McpPluginConfig,
} from './plugin-store.js';

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
  listTmuxSessions,
  type CliStatus,
  type DiscoveredTmuxSession,
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
  listA2APeers,
  getA2APeer,
  upsertA2APeer,
  removeA2APeer,
  normalizeA2ABaseUrl,
  type A2APeerRecord,
} from './a2a-peer-store.js';
export {
  bossMemoryRoot,
  ownerMemoryRoot,
  projectMemoryRoot,
  projectArchiveRoot,
  readBossMemory,
  readBossMemoryLog,
  writeBossMemory,
  parseFrontmatter,
  DEFAULT_SCOPE_BUDGET,
  type BossMemoryRead,
  type BossMemoryWrite,
  type BossMemoryFrontmatter,
  type BossMemoryBudgetExceeded,
} from './boss-memory-service.js';
export {
  harvestEmployeeRetire,
  harvestProjectRetire,
  setBossMemoryHarvestDispatcher,
  type HarvestEmployeeInput,
  type HarvestProjectInput,
  type HarvestResult,
  type HarvestDispatcher,
} from './boss-memory-harvest-service.js';
export {
  getOrCreateSecretaryStaff,
  ensureSecretaryCliSession,
} from './secretary-service.js';
export {
  getOrCreateMemoryManagerStaff,
  dispatchMemoryConsolidationTask,
} from './memory-manager-service.js';
export {
  writeBossMemoryWithRecovery,
  setBossMemoryRecoveryDispatcher,
  type RecoveryDispatcher,
} from './boss-memory-recovery-service.js';
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
  TEAM_PACKS,
  getTeamPack,
  type TeamPack,
  type TeamPackStaff,
} from './team-pack-catalog.js';

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
  deleteDeliverable,
  setDeliverableStatus,
  type ListDeliverablesQueryInput,
} from './deliverables-service.js';

export {
  transcribeAudio,
  type TranscribeAudioInput,
  type TranscribeResult,
} from './voice-transcription-service.js';

export {
  synthesizeSpeech,
  synthesizeEdgeTts,
  type SynthesizeSpeechInput,
  type SynthesizeSpeechResult,
  type EdgeTtsSynthesisInput,
} from './voice-synthesis-service.js';

export {
  sendMessagingTest,
  type MessagingChannel,
  type MessagingCfg,
  type MessagingSendResult,
} from './messaging-service.js';

export {
  type ReceiveTransport,
  type IncomingChannelMessage,
  type MessagingChannelAdapter,
  channelAccountPath,
  registerChannelAdapter,
  getChannelAdapter,
  listChannelAdapters,
  _resetChannelRegistryForTests,
  WeChatAdapter,
  TelegramAdapter,
  LineAdapter,
  KakaoAdapter,
} from './messaging-channels.js';

// Feedback / bug-report (ported from holon-engineering main)
export {
  startBugWatcher, stopBugWatcher, bugWatcherStatus,
  listBugsWithStatus, reprocessBug,
  type BugStatus,
} from './bug-watcher.js';

// Phase 1 — WorkQueueItem todos service (fixture-backed, project_id filter)
export {
  listTodos as listWorkQueueTodos,
  type ListTodosInput,
} from './todos-service.js';

// Phase 1 — project store
export {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
  clearProjectStore,
  slugify,
  type CreateProjectInput,
  type UpdateProjectInput,
} from './project-store.js';

// Boss backlog — 待分配 todo store (SQLite-backed, mutable)
export {
  listTodos,
  addTodo,
  updateTodo,
  deleteTodo,
  _resetTodoStoreForTest,
} from './todo-store.js';

// Claude token-usage stats (local log parser)
export {
  readClaudeUsage,
  readClaudeUsageByAgent,
  type ClaudeUsage,
} from './usage-stats.js';

// Chat transcript store — desk-shared source of truth for cross-device sync
export {
  appendChatMessage,
  readChatTranscript,
  clearChatTranscript,
  type TranscriptMessage,
} from './chat-transcript-store.js';

// Secretary projects service (multi-project / multi-secretary UI)
export {
  listSecretaryProjects,
  getSecretaryProject,
  createSecretaryProject,
  updateSecretaryProject,
  deleteSecretaryProject,
  secretaryProjectThreadId,
  _resetSecretaryProjectMigrationForTests,
  type SecretaryProject,
  type CreateSecretaryProjectInput,
} from './secretary-projects-service.js';

// Meeting rooms service
export {
  listRooms,
  getRoom,
  createRoom,
  renameRoom,
  deleteRoom,
  listMembers,
  addMember,
  removeMember,
  clearRoomsStore,
  getOrCreateDefaultTeamRoom,
  DEFAULT_TEAM_ROOM_ID,
  type CreateRoomInput,
  type MemberSeed,
  type AddMemberInput,
} from './rooms-service.js';

// TTS preprocessing (shared by desk + mobile)
export { sanitizeForTts } from './sanitize-for-tts.js';
