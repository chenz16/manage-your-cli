// @holon/api-contract - thin CLI-manager schemas.

export * from './primitives.js';
export * from './enums.js';

export * from './entities/desk.js';
export * from './entities/person.js';
export * from './entities/staff.js';
export * from './entities/connection.js';
export * from './entities/mission.js';
export * from './entities/deliverable.js';
export * from './entities/work-queue-item.js';
export * from './entities/chat-thread.js';
export * from './entities/recent-event.js';
export * from './entities/owner-assistant.js';
export * from './entities/skill.js';

export * from './endpoints/members.js';
export * from './endpoints/chat.js';
export * from './endpoints/today.js';
export * from './endpoints/deliverables.js';

export { registry } from './registry.js';
export * from './manifests/connectors.js';
export * from './manifests/plugins.js';
