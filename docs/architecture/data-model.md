# Data Model

Status: draft v0.1
Date: 2026-05-15
Owner: design
Position: This is the persistent data layer for both Cores. Every other architecture doc references entities; this doc defines them — fields, types, foreign keys, indexes, idempotency keys, retention.

## 1. Scope

This document specifies the relational schema for a Holon node's local database. The cloud relay has its own (smaller) schema covered in `peer-communication-architecture.md` and is not duplicated here.

What this doc covers:

- the 14 core entities and their fields
- foreign-key relationships
- indexes for the load-bearing query patterns
- idempotency key strategy
- soft-delete vs. hard-delete rules
- multi-tenant boundary enforcement
- audit / event schema
- retention and archival
- migration strategy
- Postgres-first, SQLite-compatibility notes
- mibusy V3 carry-forward at field level

What this doc does NOT cover:

- application-layer caching → component docs
- search / full-text index → V2
- analytics warehouse schema → V2
- the cloud relay's own schema → `peer-communication-architecture.md`

## 2. Foundational Decisions

### 2.1 Database

- **Postgres** for cloud-hosted nodes and for production local installs (PostgreSQL 16+).
- **SQLite** for packaged desktop / single-user installs (SQLite 3.40+ with JSON1 enabled).
- All tables defined with both backends in mind. Postgres-specific features (e.g., `JSONB`, `GENERATED ALWAYS AS IDENTITY`) are flagged; SQLite equivalents (`TEXT` with JSON validation, `INTEGER PRIMARY KEY AUTOINCREMENT`) are listed.
- No vendor-locked features (no Postgres extensions beyond `uuid-ossp` / `pgcrypto`).

### 2.2 Identifiers

- All primary keys are **UUIDv7** strings (sortable by creation time; cache-friendly indexes; matches the wire-protocol idempotency key choice in `peer-communication-architecture.md` § 9.1).
- Stored as `TEXT` (Postgres `UUID` would also work; chosen `TEXT` for SQLite compatibility and human readability in tooling).
- Format: `{entity_prefix}_{base32-encoded-uuidv7}` for human readability — e.g., `staff_01HKQ8...`, `mission_01HKQ8...`.
- The entity prefix is informational; the canonical identifier is the suffix.

### 2.3 Time

- All timestamps stored as `TEXT` in ISO-8601 UTC with millisecond precision (e.g., `2026-05-15T14:23:01.123Z`).
- Application enforces UTC. UI presents in user's local timezone but DB never holds local times.
- (Postgres alternative: `TIMESTAMPTZ`. Chose `TEXT` for SQLite uniformity.)

### 2.4 Tenant Boundary

- Single-desk install: one Postgres database / SQLite file per desk. No tenant column needed. (V1 default.)
- Multi-desk install (one Postgres serves multiple desks for hosted Holon): every row in every table carries `desk_id TEXT NOT NULL`. Every query filters by `desk_id`. Application enforces; row-level security policy in Postgres adds defense-in-depth.
- Tenant boundary is never a column on a parent table that "implies" the tenant of children. It is duplicated explicitly on every row. This makes accidental cross-tenant leaks structurally hard.

### 2.5 Soft Delete vs Hard Delete

- **Soft delete** (set `archived_at TIMESTAMPTZ`) for: staff, connections, missions, assignments, deliverables, audit events. Reason: history matters; a staff member's past assignments must remain queryable even after the staff is gone.
- **Hard delete** for: ephemeral session tokens, expired idempotency cache entries, retry queue entries past abandonment.
- Soft-deleted rows are excluded from default queries via a `WHERE archived_at IS NULL` predicate (or an index-friendly partial index).

### 2.6 JSON Columns

- Used sparingly for fields whose schema evolves quickly or is naturally polymorphic (e.g., `Substrate` discriminated union from `local-agent-management.md`).
- Postgres: `JSONB` with explicit `CHECK` constraints validating top-level structure.
- SQLite: `TEXT` with JSON1 validation and an application-layer schema check.
- Never used as a substitute for proper columns when the field is queryable, indexed, or part of a constraint.

### 2.7 Versioning

- Schema version stored in a `_meta_schema_version` table (single row, monotonically incremented integer).
- Migrations are forward-only; rollback is achieved by writing a new forward migration that undoes the change.
- See § 13 for migration strategy.

## 3. Entity Inventory

| # | Entity | Purpose | Lifecycle |
|---|---|---|---|
| 1 | `desks` | The desk itself (one per install in V1; many per DB in hosted) | Long-lived |
| 2 | `persons` | A human (or org in V2) who owns one or more desks | Long-lived |
| 3 | `roles` | Job descriptions for staff | Long-lived |
| 4 | `staff` | Members of the local team | Created, optionally archived |
| 5 | `cultivation_profiles` | The "raised by human" record per staff | Lifecycle tied to staff |
| 6 | `connections` | Enduring peer-desk relationships | Created at pairing, possibly revoked |
| 7 | `handoffs` | One cross-desk work arrangement | Single-engagement; goes through lifecycle states |
| 8 | `missions` | Inbound work from another desk | Goes through lifecycle states |
| 9 | `assignments` | Local work owned by this desk | Goes through lifecycle states |
| 10 | `deliverables` | Durable outputs of work | Append-only writes; soft-delete possible |
| 11 | `audit_events` | Append-only event log | Forever (with archival policy in V2) |
| 12 | `retry_queue` | Pending retries managed by reliability layer | Hard-delete when settled |
| 13 | `idempotency_cache` | Wire-layer dedup cache | TTL: 24h |
| 14 | `runtime_jobs` | In-flight runtime adapter jobs | Hard-delete on terminal state (audit retains record) |

## 4. Schema

Postgres syntax shown; SQLite differences noted inline.

### 4.1 `desks`

```sql
CREATE TABLE desks (
  id                TEXT PRIMARY KEY,                  -- desk_<uuidv7>
  person_id         TEXT NOT NULL REFERENCES persons(id),
  display_name      TEXT NOT NULL,
  device_kind       TEXT NOT NULL,                     -- 'laptop' | 'phone' | 'desktop' | 'server' | 'other'
  device_key_pub    TEXT NOT NULL,                     -- Ed25519 public key (base64)
  capabilities      JSONB NOT NULL DEFAULT '[]',       -- declared capabilities; SQLite: TEXT
  presence          TEXT NOT NULL DEFAULT 'unknown',   -- 'online' | 'background' | 'offline' | 'unknown'
  is_primary        BOOLEAN NOT NULL DEFAULT FALSE,
  span_of_control_cap INTEGER NOT NULL DEFAULT 7,      -- per local-agent-management.md § 3
  created_at        TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL,
  archived_at       TEXT,
  CHECK (device_kind IN ('laptop','phone','desktop','server','other')),
  CHECK (presence IN ('online','background','offline','unknown')),
  CHECK (span_of_control_cap BETWEEN 1 AND 50)
);

CREATE INDEX idx_desks_person ON desks(person_id) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX uniq_desks_primary_per_person ON desks(person_id) WHERE is_primary AND archived_at IS NULL;
```

Notes:
- One person, at most one primary desk (enforced by partial unique index).
- `span_of_control_cap` is the per-desk override of the default 7.

### 4.2 `persons`

```sql
CREATE TABLE persons (
  id              TEXT PRIMARY KEY,                    -- person_<uuidv7>
  display_name    TEXT NOT NULL,
  external_idp    TEXT,                                -- V2: SSO provider (null in V1)
  external_id     TEXT,                                -- V2: external person id at the IdP
  created_at      TEXT NOT NULL,
  archived_at     TEXT,
  UNIQUE (external_idp, external_id)                   -- V2 enterprise SSO uniqueness
);
```

V1 has one person row per install (the desk owner). V2 multi-tenant adds many.

### 4.3 `roles`

```sql
CREATE TABLE roles (
  id                          TEXT PRIMARY KEY,        -- role_<uuidv7>
  desk_id                     TEXT NOT NULL REFERENCES desks(id),
  name                        TEXT NOT NULL,           -- 'owner' | 'researcher' | ... | custom
  description                 TEXT NOT NULL,
  is_custom                   BOOLEAN NOT NULL,
  default_tool_scope          JSONB NOT NULL DEFAULT '[]',
  default_autonomy_level      TEXT NOT NULL DEFAULT 'Supervised',
  default_context_pack_template_id TEXT,               -- nullable; FK to context_pack_templates (V2)
  created_at                  TEXT NOT NULL,
  archived_at                 TEXT,
  CHECK (default_autonomy_level IN ('Supervised','Bounded','Autonomous')),  -- per ADR-004: 3-level enum
  UNIQUE (desk_id, name) WHERE archived_at IS NULL
);

CREATE INDEX idx_roles_desk ON roles(desk_id) WHERE archived_at IS NULL;
```

The 8 standard roles per `local-agent-management.md` § 4.2 (`owner`, `researcher`, `drafter`, `reviewer`, `planner`, `executor`, `communicator`, `archivist`) are seeded on desk creation. Custom roles can be added later.

### 4.4 `staff`

```sql
CREATE TABLE staff (
  id                       TEXT PRIMARY KEY,           -- staff_<uuidv7>
  desk_id                  TEXT NOT NULL REFERENCES desks(id),
  name                     TEXT NOT NULL,
  role_id                  TEXT NOT NULL REFERENCES roles(id),
  substrate                JSONB NOT NULL,             -- discriminated union per § 4.4.1
  autonomy_level           TEXT NOT NULL DEFAULT 'Supervised',
  governance_mode          TEXT NOT NULL DEFAULT 'graduated',
  status                   TEXT NOT NULL DEFAULT 'active',  -- 'paused' is the canonical inert mechanism (per ADR-004; staff with status='paused' takes no new assignments and retains its previously set autonomy_level for resume)
  max_concurrent_jobs      INTEGER NOT NULL DEFAULT 1,
  cultivation_profile_id   TEXT REFERENCES cultivation_profiles(id),
  created_at               TEXT NOT NULL,
  created_by_kind          TEXT NOT NULL,              -- 'human' | 'ai_controller'
  created_by_id            TEXT NOT NULL,              -- person_id or controller_id
  archived_at              TEXT,
  archived_reason          TEXT,
  CHECK (autonomy_level IN ('Supervised','Bounded','Autonomous')),  -- per ADR-004: collapsed from 6-level (L0..L5) to 3-level
  CHECK (governance_mode IN ('always_supervised','graduated')),
  CHECK (status IN ('active','paused','archived')),
  CHECK (max_concurrent_jobs BETWEEN 1 AND 100)
);

CREATE INDEX idx_staff_desk_active ON staff(desk_id, role_id) WHERE archived_at IS NULL;
CREATE INDEX idx_staff_substrate_kind ON staff((substrate->>'kind')) WHERE archived_at IS NULL;
```

#### 4.4.1 Substrate JSON shape

Validated by `CHECK` constraint (Postgres) or application layer (SQLite):

```json
// One of these three shapes (ADR-015: myself substrate removed):

{ "kind": "local_ai",
  "cli_binary": "claude",
  "agent_profile_id": "generic_v1",
  "tool_scope": ["read_file", "web_search"],
  "budget": { "max_tokens": 50000, "max_cost_millicents": 1000 },
  "mentors": [
    {
      "peer_id": "conn_xyz",
      "domain": "JP→EN translation",
      "invocation_policy": "owner_picks_per_task",
      "distillation_enabled": false
    }
  ]
}
// mentors[] is optional (per ADR-016). Only valid on local_ai.
// invocation_policy: "ai_decides" | "owner_picks_per_task" — V1 default: owner_picks_per_task
// distillation_enabled: V1 false; V2 true when distillation pipeline ships.

{ "kind": "cli",
  "binary": "/usr/local/bin/gh",
  "args_template": "${operation} ${args}",
  "approval_rules": [ { "operation_pattern": "delete*", "require_approval": true } ] }

{ "kind": "peer",
  "connection_id": "conn_xyz",
  "remote_staff_name": "Wang's Researcher" }
// Per ADR-003: renamed from "proxy" to disambiguate from the Proxy Engagement
// handoff form (handoff-taxonomy.md § 3, a distinct fiduciary concept).
```

Per ADR-015: the `myself` substrate is removed from the union. Owner manual work is not represented as a staff/member record. Tasks routed to the owner land in Today's personal queue section directly (via `target.kind == "owner"` routing).

The flat-roster invariant (per `local-agent-management.md` § 2) is structurally enforced: there is no `parent_staff_id` column. The schema cannot express staff-owns-staff.

#### 4.4.2 Extension fields (per ADR-019, iter-007 step 7)

Two **optional** fields were added to the `staff` shape in iter-007 step 7 (canonical source: `packages/api-contract/src/entities/staff.ts`):

```typescript
system_prompt?: string   // persona / system prompt for a local_ai staff;
                         // surfaced by the chat-CRUD path (create_staff /
                         // update_staff) per ADR-019. Free-form multi-line text.
created_at?: string      // ISO-8601 (loose), set at mint time by create_staff
                         // for chat-created staff. Backward-compatible: existing
                         // fixtures that omit this still parse.
```

Both fields are optional so that fixture rows predating iter-007 step 7 continue to parse unchanged. `created_at` is loose-ISO so that the `staff_<uuidv7>` time component remains the canonical creation timestamp; this field is a convenience surface for display.

In V2, both fields graduate to `NOT NULL` columns on the `staff` table (the V2 schema migration will backfill `created_at` from the staff id's UUIDv7 timestamp, and `system_prompt` will default to empty string for non-`local_ai` substrates).

Tangentially in the same pass: `Mission.assigned_staff_id` was made `.nullable()` in the `api-contract` Zod schema so fixtures emitting `null` for unassigned rows parse. This is a schema-shape alignment, not a column change.

#### 4.4.3 Mutable-store layering convention (V1 posture, per ADR-019)

In V1 the staff table is fixture-backed (a JSON snapshot under `src/ui-mock/_shared/fixtures.snapshot.json`) plus an in-memory mutable store (`packages/core/src/mutable-store.ts`) that layers three projections on top:

```
   fixture baseline             (read-only at runtime; fixture refresh only)
   ⊕ dynamicStaff               (Map<id, Staff>; chat-created rows)
   ⊕ staffOverrides             (Map<id, StaffPatch>; field-level edits on
                                 top of fixture or dynamic rows)
   − dismissedStaffIds          (Set<id>; soft-tombstone for chat-dismissed
                                 local_ai rows)
   ─────────────────────────────────────────────────────────────────────────
   = listStaffMerged() / getStaffMerged()   (single read view)
```

This mirrors the pattern used for the OwnerAssistant singleton (`owner-config-service.md` § 3) and worker deliverables (`worker-dispatcher.md` § 4.3) — **mutable wins**, fixture is the read-only baseline. `clearMutableStore()` wipes all three projections together and returns counts.

In V2 the three projections collapse into a single `staff` table with `archived_at` (existing column) carrying both fixture-archive and tombstone semantics; the dynamic/override Maps disappear in favor of regular row inserts and column updates. The chat-CRUD audit events (`staff.created`, `staff.updated`, `staff.dismissed`) are already defined to match the V2 row-event shape.

Cross-references: ADR-019 (chat-CRUD canonical ADR), ADR-007 (V1 audit posture: structured stdout lines), `local-agent-management.md` § 14.6 (the CRUD surface), `owner-assistant-tools.md` § 5.5 (the tool catalogue).

### 4.5 `cultivation_profiles`

```sql
CREATE TABLE cultivation_profiles (
  id                       TEXT PRIMARY KEY,           -- cult_<uuidv7>
  staff_id                 TEXT NOT NULL UNIQUE REFERENCES staff(id),
  standing_instructions    TEXT NOT NULL DEFAULT '',   -- markdown
  style_inferred           JSONB NOT NULL DEFAULT '{}',
  style_owner_overrides    JSONB NOT NULL DEFAULT '{}',
  tool_affinity            JSONB NOT NULL DEFAULT '[]',
  topic_memory             JSONB NOT NULL DEFAULT '[]',
  exemplars                JSONB NOT NULL DEFAULT '[]',
  last_updated_at          TEXT NOT NULL,
  created_at               TEXT NOT NULL
);
```

Cultivation profile is 1:1 with staff. Created when staff is created (empty); updated as the owner cultivates.

### 4.6 `connections`

```sql
CREATE TABLE connections (
  id                       TEXT PRIMARY KEY,           -- conn_<uuidv7>
  desk_id                  TEXT NOT NULL REFERENCES desks(id),  -- the local desk side
  remote_person_id         TEXT NOT NULL,              -- the other side's person id (opaque)
  remote_desk_capabilities JSONB NOT NULL DEFAULT '[]', -- declared at pairing
  display_name             TEXT NOT NULL,              -- "Wang" or "Acme Corp"
  signing_key              TEXT NOT NULL,              -- per-connection HMAC key (encrypted at rest in V2)
  health_state             TEXT NOT NULL DEFAULT 'unconfigured',
  last_successful_at       TEXT,
  last_failure_at          TEXT,
  last_failure_reason      TEXT,
  paired_at                TEXT NOT NULL,
  revoked_at               TEXT,
  revoked_reason           TEXT,
  policy                   JSONB NOT NULL DEFAULT '{}', -- accepted forms, rate limits, etc.
  CHECK (health_state IN ('unconfigured','healthy','degraded','offline','retrying','revoked','invalid_token'))
);

CREATE INDEX idx_connections_desk_health ON connections(desk_id, health_state) WHERE revoked_at IS NULL;
CREATE INDEX idx_connections_remote_person ON connections(desk_id, remote_person_id) WHERE revoked_at IS NULL;
```

Notes:
- `signing_key` is sensitive; production deployments encrypt at rest (column-level encryption or filesystem-level).
- `policy` JSONB carries connection-level filters per `peer-communication-architecture.md` § 9.3 (which handoff forms accepted, rate limits, etc.).

### 4.7 `handoffs`

The biggest table, because it carries the full handoff packet. Most fields cross-reference `handoff-design.md` and `handoff-taxonomy.md`.

```sql
CREATE TABLE handoffs (
  id                       TEXT PRIMARY KEY,           -- handoff_<uuidv7>
  desk_id                  TEXT NOT NULL REFERENCES desks(id),

  -- Direction & relationships
  direction                TEXT NOT NULL,              -- 'outbound' | 'inbound'
  connection_id            TEXT NOT NULL REFERENCES connections(id),
  parent_handoff_id        TEXT REFERENCES handoffs(id),  -- for sub-handoffs in chains/subcontracting
  source_assignment_id     TEXT REFERENCES assignments(id), -- outbound: which local assignment generated this
  target_mission_id        TEXT REFERENCES missions(id),    -- inbound: which mission this became locally

  -- Form & axes (per handoff-taxonomy.md)
  form                     TEXT NOT NULL,              -- 'direct_order' | 'direct_takeover' | ... 13 values
  axes                     JSONB NOT NULL,             -- full HandoffAxes object (8 axes)
  axes_hash                TEXT NOT NULL,              -- SHA-256 of canonical axes for tamper detection

  -- Context & authority
  context_pack_id          TEXT,                       -- FK to context_packs (separate table; not in V1 spec yet)
  authority_scope          JSONB NOT NULL,             -- per handoff-design.md § Authority Scope

  -- Lifecycle
  state                    TEXT NOT NULL DEFAULT 'draft',
  state_reason             TEXT,
  proposed_at              TEXT,
  sent_at                  TEXT,
  received_at              TEXT,
  accepted_at              TEXT,
  pending_cosign_at        TEXT,                       -- dual_authorization specific
  cosigned_at              TEXT,
  in_progress_at           TEXT,
  submitted_at             TEXT,
  done_at                  TEXT,
  expires_at               TEXT,                       -- from axes.duration when bounded/scheduled

  -- Composition (per handoff-taxonomy.md § Composition)
  escalation               JSONB,                      -- EscalationSpec or null
  planned_sub_handoffs     JSONB NOT NULL DEFAULT '[]',-- declared upfront

  -- Dual signatures (for dual_authorization form)
  signatures               JSONB,                      -- SignatureSet or null

  -- Proxy engagement (when form = proxy_engagement)
  proxy_of                 JSONB,                      -- PrincipalRef or null

  -- Audit linkage
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,

  CHECK (direction IN ('outbound','inbound')),
  CHECK (form IN (
    'direct_order','direct_takeover','proxy_engagement','dual_authorization',
    'approval_chain','observer_brief','advisory_consult','temporary_cover',
    'conditional_engagement','subcontracting','parallel_solicitation',
    'negotiated_handoff','watch_brief'
  )),
  CHECK (state IN (
    'draft','proposed','sent','received','pending_cosign','accepted',
    'in_progress','blocked','submitted','returned','done',
    'cancelled','rejected','expired','failed'
  ))
);

CREATE INDEX idx_handoffs_desk_state ON handoffs(desk_id, state);
CREATE INDEX idx_handoffs_connection ON handoffs(connection_id);
CREATE INDEX idx_handoffs_parent ON handoffs(parent_handoff_id) WHERE parent_handoff_id IS NOT NULL;
CREATE INDEX idx_handoffs_source_assignment ON handoffs(source_assignment_id) WHERE source_assignment_id IS NOT NULL;
CREATE INDEX idx_handoffs_target_mission ON handoffs(target_mission_id) WHERE target_mission_id IS NOT NULL;
CREATE INDEX idx_handoffs_expires ON handoffs(expires_at) WHERE expires_at IS NOT NULL AND state IN ('pending_cosign','accepted','in_progress');
CREATE INDEX idx_handoffs_form ON handoffs(form);
```

`axes_hash` lets later audits verify no field has been mutated since the handoff was sent — important for binding forms (Dual Authorization, Irrevocable).

### 4.8 `missions`

A mission is the receiver-side persisted record of an inbound handoff. The mission's lifecycle is the receiver's view of the work; the corresponding handoff record carries the cross-desk metadata.

```sql
CREATE TABLE missions (
  id                       TEXT PRIMARY KEY,           -- mission_<uuidv7>
  desk_id                  TEXT NOT NULL REFERENCES desks(id),
  inbound_handoff_id       TEXT NOT NULL UNIQUE REFERENCES handoffs(id),
  title                    TEXT NOT NULL,
  body                     TEXT NOT NULL,              -- markdown
  state                    TEXT NOT NULL DEFAULT 'queued',
  state_reason             TEXT,
  priority                 INTEGER NOT NULL DEFAULT 50,  -- 0-100; higher = more urgent
  deadline_at              TEXT,                         -- mirrors handoffs.expires_at when present
  accepted_at              TEXT,
  in_progress_at           TEXT,
  blocked_at               TEXT,
  submitted_at             TEXT,
  rejected_at              TEXT,
  expired_at               TEXT,
  returned_to_origin_at    TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  archived_at              TEXT,
  CHECK (state IN ('queued','accepted','in_progress','blocked','submitted','rejected','expired','returned_to_origin')),
  CHECK (priority BETWEEN 0 AND 100)
);

CREATE INDEX idx_missions_desk_state ON missions(desk_id, state, priority DESC) WHERE archived_at IS NULL;
CREATE INDEX idx_missions_deadline ON missions(deadline_at) WHERE deadline_at IS NOT NULL AND state IN ('queued','accepted','in_progress');
CREATE INDEX idx_missions_handoff ON missions(inbound_handoff_id);
```

### 4.9 `assignments`

A local unit of work owned by this desk. May be created from scratch (owner adds a todo), from a delegated mission (`source_mission_id`), or from a chained step.

```sql
CREATE TABLE assignments (
  id                       TEXT PRIMARY KEY,           -- assign_<uuidv7>
  desk_id                  TEXT NOT NULL REFERENCES desks(id),

  -- Where it came from
  source                   TEXT NOT NULL,              -- 'owner' | 'mission' | 'chain' | 'system'
  source_mission_id        TEXT REFERENCES missions(id),
  source_assignment_id     TEXT REFERENCES assignments(id),  -- chain
  source_handoff_id        TEXT REFERENCES handoffs(id),     -- when initiated by an inbound handoff

  -- What it's for
  title                    TEXT NOT NULL,
  body                     TEXT NOT NULL,
  output_expectation       JSONB,                      -- structured shape if needed

  -- Routing
  target                   JSONB NOT NULL,             -- AssignmentTarget union per local-agent-management.md § 11
  routing_decision         JSONB,                      -- recorded after router runs
  assigned_staff_id        TEXT REFERENCES staff(id),

  -- State
  state                    TEXT NOT NULL DEFAULT 'draft',
  state_reason             TEXT,

  -- Lifecycle
  created_at               TEXT NOT NULL,
  queued_at                TEXT,
  started_at               TEXT,
  blocked_at               TEXT,
  completed_at             TEXT,
  cancelled_at             TEXT,
  failed_at                TEXT,

  -- Linked outbound handoff (when target is a proxy)
  outbound_handoff_id      TEXT REFERENCES handoffs(id),

  archived_at              TEXT,

  CHECK (source IN ('owner','mission','chain','system')),
  CHECK (state IN ('draft','queued','running_local','waiting_remote','retrying','blocked','completed','cancelled','failed'))
);

CREATE INDEX idx_assignments_desk_state ON assignments(desk_id, state) WHERE archived_at IS NULL;
CREATE INDEX idx_assignments_staff ON assignments(assigned_staff_id) WHERE assigned_staff_id IS NOT NULL AND archived_at IS NULL;
CREATE INDEX idx_assignments_source_mission ON assignments(source_mission_id) WHERE source_mission_id IS NOT NULL;
CREATE INDEX idx_assignments_outbound ON assignments(outbound_handoff_id) WHERE outbound_handoff_id IS NOT NULL;
```

### 4.10 `deliverables`

```sql
CREATE TABLE deliverables (
  id                       TEXT PRIMARY KEY,           -- deliv_<uuidv7>
  desk_id                  TEXT NOT NULL REFERENCES desks(id),

  -- Origin (exactly one of these is non-null)
  source_assignment_id     TEXT REFERENCES assignments(id),  -- locally produced
  source_mission_id        TEXT REFERENCES missions(id),     -- returned remotely

  -- Content (per deliverable-spec.md, to be written)
  title                    TEXT NOT NULL,
  body_kind                TEXT NOT NULL,              -- 'markdown' | 'structured' | 'files_only'
  body                     JSONB NOT NULL,             -- shape depends on body_kind
  files                    JSONB NOT NULL DEFAULT '[]',
  citations                JSONB NOT NULL DEFAULT '[]',
  runtime_notes            TEXT,

  -- Attribution
  author_staff_id          TEXT REFERENCES staff(id),  -- nullable: returned deliverables have no local author
  author_remote_desk_id    TEXT,                       -- the remote desk for inbound deliverables
  attribution              JSONB NOT NULL,             -- full attribution including signing if available

  created_at               TEXT NOT NULL,
  archived_at              TEXT,

  CHECK (body_kind IN ('markdown','structured','files_only')),
  CHECK ((source_assignment_id IS NOT NULL) <> (source_mission_id IS NOT NULL))  -- exactly one
);

CREATE INDEX idx_deliverables_desk ON deliverables(desk_id, created_at DESC) WHERE archived_at IS NULL;
CREATE INDEX idx_deliverables_assignment ON deliverables(source_assignment_id) WHERE source_assignment_id IS NOT NULL;
CREATE INDEX idx_deliverables_mission ON deliverables(source_mission_id) WHERE source_mission_id IS NOT NULL;
CREATE INDEX idx_deliverables_author_staff ON deliverables(author_staff_id) WHERE author_staff_id IS NOT NULL;
```

### 4.11 `audit_events`

The comprehensive diagnostic event log. Subscribers (UI, retry logic, audit consumers) all read from here. In V1, state tables are canonical; the audit log is a queryable diagnostic record, not the primary source of truth. See ADR-007 for the V1 vs V3 audit posture. Retention: forever — diagnostic log retention; not source-of-truth retention. Cold storage after 1 year in V2.

```sql
CREATE TABLE audit_events (
  id                       TEXT PRIMARY KEY,           -- evt_<uuidv7>
  desk_id                  TEXT NOT NULL REFERENCES desks(id),

  -- Subject
  entity_kind              TEXT NOT NULL,              -- 'staff' | 'mission' | 'assignment' | 'deliverable' | 'handoff' | 'connection' | 'desk' | 'system'
  entity_id                TEXT,                       -- nullable for system-level events
  parent_entity_kind       TEXT,                       -- for hierarchical context
  parent_entity_id         TEXT,

  -- The event
  kind                     TEXT NOT NULL,              -- 'assignment_created' | 'handoff_sent' | 'runtime_event' | ...
  payload                  JSONB NOT NULL DEFAULT '{}',

  -- Provenance
  actor_kind               TEXT NOT NULL,              -- 'human' | 'ai_controller' | 'system' | 'remote_desk'
  actor_id                 TEXT,                       -- person_id, controller_id, or remote desk id

  -- Time (immutable)
  occurred_at              TEXT NOT NULL,
  recorded_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CHECK (entity_kind IN ('staff','mission','assignment','deliverable','handoff','connection','desk','system','runtime_job','retry')),
  CHECK (actor_kind IN ('human','ai_controller','system','remote_desk'))
);

CREATE INDEX idx_audit_desk_time ON audit_events(desk_id, occurred_at DESC);
CREATE INDEX idx_audit_entity ON audit_events(desk_id, entity_kind, entity_id);
CREATE INDEX idx_audit_kind ON audit_events(desk_id, kind, occurred_at DESC);
```

Append-only enforcement: revoke `UPDATE` and `DELETE` permission on this table for application roles in production. All mutations go through application-layer code that only `INSERT`s.

#### Standard event kinds (from `functional-architecture.md` § Event Model)

A non-exhaustive but core enumeration; new kinds can be added without schema migration:

```
desk_*: desk_created, desk_archived
staff_*: staff_created, staff_updated, staff_autonomy_promoted, staff_autonomy_demoted, staff_archived, cultivation_updated
connection_*: connection_paired, connection_health_changed, connection_revoked, connection_pinged, connection_failed, token_rotated
handoff_*: handoff_drafted, handoff_proposed, handoff_sent, handoff_received, handoff_accepted, handoff_rejected, handoff_pending_cosign, handoff_cosigned, handoff_in_progress, handoff_blocked, handoff_submitted, handoff_returned, handoff_done, handoff_cancelled, handoff_expired, handoff_failed, handoff_escalated, handoff_revoked
mission_*: mission_received, mission_accepted, mission_rejected, mission_in_progress, mission_blocked, mission_submitted, mission_returned_to_origin, mission_expired, mission_delegated_to_staff
assignment_*: assignment_created, assignment_queued, assignment_routed, assignment_started, assignment_blocked, assignment_completed, assignment_cancelled, assignment_failed
runtime_*: local_runtime_started, runtime_event, runtime_error, runtime_terminated
deliverable_*: deliverable_created, deliverable_attached, deliverable_archived
permission_*: permission_denied, permission_attenuated
retry_*: retry_scheduled, retry_attempted, retry_succeeded, retry_abandoned
```

### 4.12 `retry_queue`

Managed by the reliability layer (per `reliability-and-testing.md`, to be written). Pending operations the system will retry per the Stripe-pattern schedule.

```sql
CREATE TABLE retry_queue (
  id                       TEXT PRIMARY KEY,           -- retry_<uuidv7>
  desk_id                  TEXT NOT NULL REFERENCES desks(id),
  operation_kind           TEXT NOT NULL,              -- 'handoff_dispatch' | 'callback_deliver' | 'runtime_start' | ...
  operation_payload        JSONB NOT NULL,             -- enough to reconstruct the operation
  attempt_count            INTEGER NOT NULL DEFAULT 0,
  max_attempts             INTEGER NOT NULL DEFAULT 9,
  next_attempt_at          TEXT NOT NULL,
  last_attempt_at          TEXT,
  last_error               JSONB,
  created_at               TEXT NOT NULL,
  CHECK (attempt_count BETWEEN 0 AND max_attempts)
);

CREATE INDEX idx_retry_due ON retry_queue(desk_id, next_attempt_at) WHERE attempt_count < max_attempts;
```

Settled retries (succeeded or abandoned) are hard-deleted after writing the appropriate audit event.

### 4.13 `idempotency_cache`

Wire-layer dedup cache per `peer-communication-architecture.md` § 9.1. Lives on the relay primarily; nodes also cache for their own callback dedup.

```sql
CREATE TABLE idempotency_cache (
  request_id               TEXT PRIMARY KEY,           -- the X-Holon-Request-Id (UUIDv7)
  desk_id                  TEXT NOT NULL REFERENCES desks(id),
  sender_desk_id           TEXT NOT NULL,              -- the originating desk
  cached_response          JSONB NOT NULL,
  payload_hash             TEXT NOT NULL,              -- to detect "same key different payload" abuse
  expires_at               TEXT NOT NULL,              -- TTL: created + 24h
  created_at               TEXT NOT NULL
);

CREATE INDEX idx_idempotency_expires ON idempotency_cache(expires_at);
```

Background job sweeps expired entries.

### 4.14 `runtime_jobs`

In-flight jobs being executed by the runtime adapter. Hard-deleted on terminal state (`audit_events` retains the record forever).

```sql
CREATE TABLE runtime_jobs (
  id                       TEXT PRIMARY KEY,           -- job_<uuidv7>; matches RuntimeJobConfig.jobId
  desk_id                  TEXT NOT NULL REFERENCES desks(id),
  assignment_id            TEXT NOT NULL REFERENCES assignments(id),
  staff_id                 TEXT NOT NULL REFERENCES staff(id),
  adapter_id               TEXT NOT NULL,              -- 'cli:claude' | 'cli:codex' | 'cli:gemini' | 'cli:qwen' | 'dummy'
  status                   TEXT NOT NULL DEFAULT 'queued',  -- per runtime-adapter-interface.md JobStatus
  config                   JSONB NOT NULL,             -- the RuntimeJobConfig
  started_at               TEXT,
  paused_at                TEXT,
  resumed_at               TEXT,
  finished_at              TEXT,
  exit_kind                TEXT,                       -- 'done' | 'cancelled' | 'failed'
  cumulative_usage         JSONB,                      -- input/output tokens, cost
  created_at               TEXT NOT NULL,
  CHECK (status IN ('queued','starting','running','paused','finishing','done','cancelled','failed'))
);

CREATE INDEX idx_runtime_jobs_assignment ON runtime_jobs(assignment_id);
CREATE INDEX idx_runtime_jobs_desk_active ON runtime_jobs(desk_id, status) WHERE status NOT IN ('done','cancelled','failed');
```

### 4.15 Mentor Consultation Log (per ADR-016)

Mentor consultations are recorded as cultivation-log entries, not as separate first-class table rows (V1 posture). They appear as a special `kind` within the `cultivation_profiles` topic memory and are also surfaced in `audit_events`.

**Cultivation log entry shape for mentor consultations:**

```typescript
// A cultivation_profiles.topic_memory[] entry where kind = "mentor_consultation"
{
  kind: "mentor_consultation",           // distinguishes from regular topic memory entries
  mentor_peer_id: ConnectionId,          // the connection_id of the mentor peer
  mentor_display_name: string,           // e.g. "Wang"
  domain: string,                        // domain annotation from the mentors[] config
  assignment_ref: AssignmentId,          // the assignment that triggered the consultation
  consultation_summary: string,          // brief summary of what was discussed
  consulted_at: string,                  // ISO-8601 timestamp
  citation_suppressed: boolean           // true if owner overrode default citation
}
```

**Deliverable citation entry (per ADR-016 Q2 resolution):**

When a mentor is consulted and `citation_suppressed` is false, the resulting `deliverables.citations` array receives an entry:

```typescript
{
  refKind: "member",
  refId: "<mentor_peer_id>",             // connection_id of the mentor
  excerpt: "<consultation summary>"      // brief description of the mentor's contribution
}
```

The owner can suppress citation per-consultation at handoff time. Default is to include it.

**Audit event:** Each mentor consultation emits a `cultivation_updated` audit event with `payload.update_kind: "mentor_consultation"` and the consultation summary.

### 4.16 OwnerAssistant (singleton, per ADR-013 / ADR-017)

The `owner_assistant` is a **desk-level singleton**, not a row in the `staff` table. ADR-013 established it as the anchor of the chat surface (the "Myself dialog"); ADR-015 confirmed it is _not_ a flat-roster member (the human owner sits outside Members, and the assistant — while a real AI working for the owner — is exposed via the chat surface rather than the routing/dispatch path). ADR-017 extended its shape with owner-identity, persona, workspace + budget, skills, and an upstream peer link, so the /me screen can be a real desk-config surface with per-field click-to-edit.

In V1 the singleton lives in a file-backed store (one JSON document per desk, keyed by `desk_id`). When the singleton gets a row in V2, it will be a single `owner_assistants` table with `desk_id` PRIMARY KEY (1:1 with `desks`).

**Shape (`packages/api-contract/src/entities/owner-assistant.ts`):**

```typescript
{
  id:         StaffId,            // uses staff_ prefix even though not in the roster
  name:       string,             // assistant's display name (e.g. "Desk AI")
  role_name:  "owner_assistant",  // literal — the standard role from ADR-013
  role_label: string,             // human-readable role label
  substrate:  {                   // mirrors staff.substrate.local_ai
    kind:             "local_ai",
    agent_profile_id: string,
    tool_scope:       string[],
  },

  // ── Owner identity (the human — for chat-context injection) ──
  owner_name?:  string,           // e.g. "Chen Zhang"
  owner_role?:  string,           // e.g. "Director — E2E AV"
  owner_intro?: string,           // free-text self-intro

  // ── Assistant persona ──
  system_prompt?: string,         // shapes every reply via the pre_llm_call hook

  // ── Workspace + budget ──
  workspace_dir?:     string,     // absolute path the worker sandbox cd's into
  monthly_budget_mc?: number,     // monthly budget cap, millicents (1¢ = 1000 mc)

  // ── Skills (the assistant + all staff inherit) ──
  skills?: Array<{ name: string; description: string; body: string }>,

  // ── Upstream peer link (owner reports up to a higher-level desk) ──
  upstream_connection_id?: ConnId,
  upstream_display_name?:  string,
}
```

**Field rules:**

- **All extension fields are optional.** Old fixtures (with only `id` / `name` / `role_name` / `role_label` / `substrate`) keep parsing unchanged. This is load-bearing for incremental rollout.
- **Singleton, not staff row.** The `OwnerAssistant.id` uses the `staff_` prefix for tooling convenience but does NOT correspond to a `staff` row. The flat-roster invariant (per `local-agent-management.md` § 2) is preserved: the assistant is not in the routing/dispatch path; it is exposed only through the chat surface (per ADR-013) and the /me config screen.
- **Owner identity is per-desk, not per-person.** `owner_name` / `owner_role` / `owner_intro` describe the owner _as the assistant should perceive them on this desk_. The global identity row (`persons` § 4.2) stays minimal (name + SSO link); per-desk self-presentation lives here, by design.
- **Skills are inheritable.** Each skill is a small named markdown body. The chat-context builder injects all desk skills (this singleton's `skills[]`) into every chat session — both the owner_assistant chat and per-member chats — so staff inherit them without duplication.
- **Upstream peer link is label-only in V1.** `upstream_connection_id` may reference a `connections` row; today it is rendered in the UI and injected as context ("you report up to ${upstream_display_name}"), but no work routes to it. V2 will spec the routing semantics.
- **PII-free defaults (per ADR-018 / Engineering Rule 11).** The default fixture for OwnerAssistant ships with `owner_name: ""`, no real names, no hardcoded `workspace_dir` paths. Defaults must be safe to ship to any installer.

**Cross-references:**

- ADR-013 — establishes the singleton + chat surface anchoring.
- ADR-015 — confirms the singleton sits outside the Members roster.
- ADR-017 — defines the extended shape above.
- ADR-018 — PII-free defaults for the fields above.
- `local-agent-management.md` § 4.2 — `owner_assistant` standard role.

## 4.99 Filesystem-Backed State (Boss Memory, HR, Skills)

The relational schema above covers structured work objects. **Memory state
lives on the filesystem**, by deliberate choice — per `CLAUDE.md` § North
Star ("memory = files at the boss"; no vector DB; markdown only) and per
the System 0/1/2 hierarchy from the README. The boss-memory tree is part of
the canonical data model even though it is not in SQL.

### 4.99.1 Boss-memory tree

```
~/holon-agents/boss/
├── owner/                              # System 2 — owner-global
│   ├── INDEX.md
│   ├── MEMORY/                         # detail files; recall reads INDEX first
│   │   └── *.md
│   └── hr/                             # owner-HR (per ADR hr-evaluator)
│       ├── persona.md                  # owner-HR's role + rubric
│       ├── evaluations/<sproj_id>/
│       │   └── YYYY-MM-DD.md           # markdown checklist rubric, one row per scored turn
│       └── promotion-vetoes.json       # owner-rejected B→A promotions (rule-hash keyed)
├── projects/
│   └── <sproj_id>/                     # System 1 — per project
│       ├── INDEX.md
│       ├── MEMORY/
│       │   └── *.md
│       └── secretary/
│           ├── CLAUDE.md               # secretary's per-binary memory file
│           │   └── ## HR-Corrections   # managed section (HR Path A)
│           └── ...
└── _archived/<sproj_id>/               # retired projects (curator preserves; not active)
```

Per-employee memory files live at the employee's cwd (not centralized), and
their filename depends on the CLI binary backing the employee:

| Employee CLI | Memory file |
|---|---|
| `claude` | `CLAUDE.md` |
| `codex` | `AGENTS.md` |
| `gemini` | `GEMINI.md` |
| `qwen` | `QWEN.md` |

Materialization is owned by `packages/core/src/cli-memory-scaffold.ts`. See
`local-agent-management.md` § 14.7.

### 4.99.2 `## HR-Corrections` managed section

A managed markdown section in every per-CLI memory file, written by HR Path
A (`packages/core/src/hr-path-a.ts`). Format per the ADR § 4.3:

```markdown
## HR-Corrections
<!-- managed by owner-HR — do not hand-edit; owner can revert via the 🔴 line -->

- (2026-05-30) Always dispatch heavy work; do not execute it yourself.
- (2026-05-29) Use [[wikilinks]] for cross-references in memory files.
```

Properties:

- **Idempotent.** Keyed by a stable rule-hash (normalized text → SHA-256
  prefix). Re-runs of the same rule replace the dated entry in place, never
  append duplicates.
- **Sentinel-bracketed.** The HTML comment is detected by the writer to
  avoid clobbering a hand-written `## HR-Corrections` heading the owner
  created without the sentinel.
- **Per-binary.** Same rule, different file depending on which CLI the
  target runs (the HR-author and the HR-target may run on different CLIs;
  the file picked depends on the target's binary).

### 4.99.3 Promotion-veto JSON

`~/holon-agents/boss/owner/hr/promotion-vetoes.json` records owner-rejected
B→A auto-promotions per ADR § 4.4. Shape:

```json
{
  "vetoes": [
    {
      "rule_hash": "a3f9c0…",
      "target_agent": "secretary-acme",
      "rule_text": "Always dispatch heavy work; do not execute it yourself.",
      "vetoed_at": "2026-05-30T14:22:01.000Z"
    }
  ]
}
```

Future B-fires whose normalized rule-hash matches a vetoed entry never
re-promote (the entry stays in B-only or is suppressed entirely per
`hr-evaluator.md` § Promotion).

**Open question (ADR § 4.9):** if owner-HR is rebuilt from scratch
(re-scaffolded), vetoes here are lost. Either this file must live in owner
System 2 boss-memory proper (not just HR's own scratch), or scaffolding
must preserve it. Decide before HR ships at scale.

### 4.99.4 Why filesystem, not SQL

Three reasons consistent with `CLAUDE.md` § North Star:

1. **The owner can grep, edit, version, back up everything as plain text.**
   No DB dump, no migration, no opaque blob. Memory is portable across
   machines by `tar`.
2. **CLI-native.** Each CLI already reads its own `CLAUDE.md` / `AGENTS.md`
   / `GEMINI.md` / `QWEN.md` as part of its boot loop. Putting memory in
   SQL would require a tool call on every turn to fetch what the CLI would
   otherwise read for free.
3. **No vector DB temptation.** Forcing memory to be markdown forces us to
   keep it small and curated. Progressive disclosure (INDEX → 2–3 detail
   files, ~8k char budget) is enforced by the recall Skill
   (`holon-memory-recall` / `holon-owner-recall`).

See `memory-update-flow.md` for the read / harvest / HR flows that act on
this tree.

## 5. Relationship Map (Visual)

```
persons ─┬─< desks ─┬─< staff ─< cultivation_profiles
         │          ├─< roles
         │          ├─< connections ─< handoffs
         │          ├─< missions   ◀──┘ (inbound_handoff_id)
         │          ├─< assignments ─┬─< runtime_jobs
         │          │                ├─< deliverables (source_assignment_id)
         │          │                └─> handoffs (outbound_handoff_id)
         │          ├─< deliverables (source_mission_id from missions)
         │          ├─< audit_events
         │          ├─< retry_queue
         │          └─< idempotency_cache
```

## 6. Idempotency Strategy

Three layers of idempotency:

1. **Wire layer.** Every cross-desk RPC carries `X-Holon-Request-Id` (UUIDv7). Stored in `idempotency_cache` for 24h. A retry returns the cached response.
2. **Handoff layer.** Each handoff has a stable `id` (UUIDv7). Constructing a handoff with the same id (e.g., during resend) is detected by `handoffs` PRIMARY KEY constraint; receiver returns the existing record.
3. **Callback layer.** Receiver's deliverable callback carries `parent_assignment_id` (the sender's outbound handoff/assignment id). Sender's `assignments.outbound_handoff_id` lookup is idempotent — repeated callbacks update the same record without duplicating deliverables.

The mibusy V3 `peer_origin_id` UNIQUE pattern carries forward as `assignments.outbound_handoff_id` — same idea, formalized.

## 7. Indexing Philosophy

Indexes serve three categories of query:

### High-frequency read paths (must be indexed)

- "Today" view: open missions + active assignments + recent deliverables — covered by `idx_missions_desk_state`, `idx_assignments_desk_state`, `idx_deliverables_desk`.
- Inbound inbox: pending missions per desk by priority — `idx_missions_desk_state`.
- Connection health screen: connections + recent failures — `idx_connections_desk_health`.
- Live UI subscriptions: audit events for a specific entity — `idx_audit_entity`.
- Routing decisions: candidate staff by role + status — `idx_staff_desk_active`.
- Retry sweeper: due retries — `idx_retry_due`.

### Medium-frequency (indexed for snappy interaction)

- Audit timeline by event kind: `idx_audit_kind`.
- Handoff lookup by source assignment: `idx_handoffs_source_assignment`.
- Missions approaching deadline: `idx_missions_deadline`, `idx_handoffs_expires`.

### Low-frequency (no index; full scan acceptable)

- Historical search across archived rows.
- Audit replay from beginning.
- Schema migration scans.

## 8. Soft-Delete Conventions

Pattern: `archived_at TEXT` nullable. Standard query predicate: `WHERE archived_at IS NULL`. Partial indexes use the same predicate.

When a row is soft-deleted:
- Foreign-key references from other rows are preserved.
- Audit events about the row remain queryable.
- The row stops appearing in default lists/queries.
- The owner can "restore" by setting `archived_at = NULL` (subject to permission).

Hard-delete is reserved for: `idempotency_cache` (TTL), `retry_queue` (after settlement), `runtime_jobs` (after terminal state, audit retains record).

## 9. Multi-Tenant Boundary

V1 ships single-desk-per-DB. V2 hosted Holon may host multiple desks per Postgres database; in that case:

- Every table has `desk_id TEXT NOT NULL`. Already present above.
- Every query in application code filters by `desk_id` from the authenticated session.
- Postgres row-level security (RLS) enables defense-in-depth: a policy on each table restricting reads/writes to rows where `desk_id = current_setting('app.desk_id')`. Even bugs in app code can't leak across tenants.
- Tenant boundary policies are themselves audit-emitting (RLS denials get logged).

## 10. Retention And Archival

| Entity | V1 retention | V2 archival |
|---|---|---|
| `desks`, `persons`, `roles` | Forever | Forever |
| `staff` (active) | Forever | Forever |
| `staff` (archived) | Forever | Optional purge after N years |
| `cultivation_profiles` | Forever (tied to staff) | Forever |
| `connections` (active) | Forever | Forever |
| `connections` (revoked) | Forever | Optional purge after N years; audit retained |
| `handoffs` | Forever (audit-load-bearing) | Compress to summary after 1 year |
| `missions` | Forever | Compress to summary after 1 year |
| `assignments` | Forever | Compress to summary after 1 year |
| `deliverables` | Forever; files may move to cold storage | Forever for metadata; files cold-archive after 90 days inactive |
| `audit_events` | Forever (diagnostic log retention; not source-of-truth retention per ADR-007) | Move to append-only cold storage after 1 year |
| `retry_queue` | Hard-deleted on settlement | Same |
| `idempotency_cache` | TTL 24h | Same |
| `runtime_jobs` | Hard-deleted on terminal state | Same; replayable from audit |

Compression in V2: take cold rows and rewrite as a compact JSON summary, freeing rows for re-use; original detail moves to columnar cold storage (e.g., Parquet on object storage).

## 10.1 V2 Planned: `workspaces` Table (Sketch)

Per ADR-010, V2 introduces Shared Workspace as a multi-owner container above individual desks. V1 has no workspace table; V1 desks are implicitly single-person workspaces.

```sql
-- V2 PLANNED — not in V1 schema
CREATE TABLE workspaces (
  id              TEXT PRIMARY KEY,       -- ws_<uuidv7>
  name            TEXT NOT NULL,
  owner_persons   JSONB NOT NULL,         -- array of person_id strings; 1+ persons
  shared_audit    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TEXT NOT NULL,
  archived_at     TEXT                    -- nullable; workspace soft-delete
);

-- V2: desks and connections gain a nullable workspace_id FK
-- ALTER TABLE desks ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
-- ALTER TABLE connections ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
```

Full schema (permissions model, workspace-internal assignment records, shared deliverable visibility) deferred to `docs/architecture/workspace.md` in V2 planning. See ADR-010.

## 11. Mibusy V3 Carry-Forward (Field Level)

| Holon table.field | Mibusy V3 source | Status |
|---|---|---|
| `staff.id` | `virtual_agents.id` | Carry forward |
| `staff.substrate.kind` | `virtual_agents.agent_mode` (`ai`/`facade` only) | Evolve to 4-way union |
| `staff.cultivation_profile_id` | (does not exist) | New |
| `staff.autonomy_level` | (implicit; mibusy is mostly Supervised-equivalent) | New explicit field — 3-level enum (Supervised / Bounded / Autonomous) per ADR-004 |
| `connections.id` | `agent_connections.id` | Carry forward |
| `connections.signing_key` | `agent_connections.peer_token` | Evolve from bearer to derived HMAC |
| `connections.health_state` | (computed from `last_seen_at` only) | New explicit state |
| `handoffs.id` | (no first-class handoff record) | New (was implicit in mission/assignment fields) |
| `handoffs.form` + `axes` | (does not exist) | New |
| `handoffs.parent_handoff_id` | (no chain tracking) | New |
| `missions.inbound_handoff_id` | implicit via `assignments.peer_origin_id` | Make explicit FK |
| `assignments.outbound_handoff_id` | `assignments.peer_origin_id` | Rename, make FK |
| `assignments.source_mission_id` | (computed) | Make explicit FK |
| `audit_events.*` | (mibusy uses ad-hoc event records) | New unified schema |
| `retry_queue.*` | (mibusy has no retry layer) | New |
| `idempotency_cache.*` | (mibusy uses unique constraint on `peer_origin_id`) | Evolve to first-class cache |
| `runtime_jobs.*` | (mibusy runs synchronously) | New |
| `desks.id` | implicit via `MIBUSY_DESK_ID` env | Make first-class table |
| `persons.id` | (does not exist) | New |

## 12. SQLite Compatibility Notes

| Postgres | SQLite |
|---|---|
| `JSONB` | `TEXT` with JSON1 functions (`json_extract`, `json_each`) |
| `GENERATED ALWAYS AS IDENTITY` | `INTEGER PRIMARY KEY AUTOINCREMENT` (avoid; use UUIDv7) |
| `BOOLEAN` | `INTEGER` (0/1) |
| Partial indexes (`WHERE` clause) | Supported in SQLite 3.8+ |
| `CHECK` constraints | Supported but enforcement is lighter; application validates too |
| Row-level security | Not available; rely on application-layer filtering |
| `TIMESTAMPTZ` | `TEXT` with ISO-8601 (already chosen above for uniformity) |

The schema above uses Postgres syntax. A SQLite migration generator translates per the table.

## 13. Migration Strategy

- All schema changes live in numbered SQL files under `packages/db/migrations/0001_*.sql` (forward-only).
- A `_meta_schema_version` table tracks the highest applied migration.
- Application boots: check version; apply pending migrations in order; abort on error.
- Rollback = write a new forward migration that undoes the change. Never modify past migrations.
- Pre-deployment: run migrations in CI against a snapshot of production data; verify success before deploy.
- Migration timing: Postgres can lock tables; long migrations (e.g., adding a NOT NULL column to a large table) use the standard pattern (add nullable → backfill → enforce NOT NULL) to avoid lock storms.

## 14. Open Decisions

1. **Context pack table design.** `handoffs.context_pack_id` references a table not yet specced. Probably needs its own `context_packs` + `context_pack_items` tables. Defer to `deliverable-spec.md` and a context-pack sub-doc.
2. **Files / blob storage.** Deliverable files are referenced by `deliverables.files` JSON. Where do bytes live? Local filesystem (per-desk install)? Object storage (cloud)? S3-compatible API in both cases? Affects `deliverables` and possibly a `files` table.
3. **Cultivation profile schema specifics.** `cultivation_profiles.style_inferred` is currently `JSONB` blob; should `style_inferred.preferences` be a separate table for queryability? Probably yes when V1 adds "show all staff who prefer formal tone" type queries.
4. **Sandbox table.** Sandbox-mediated payload mode (handoff-taxonomy.md Axis 7) implies a `sandboxes` table. Not yet specced; V2 priority.
5. **Sandbox provisioning credential storage.** Should sandbox creds be in the handoff record (encrypted) or in a separate short-TTL `sandbox_credentials` table? Latter is cleaner.
6. **Schedule segments table.** `timeliness.scheduled_segment` carries `ScheduleSegment[]` JSON. If we want to query "which desks are active right now," indexed columns may be better than JSON. Defer to V2 when scheduled_segment ships.
7. **Negotiated handoff state.** During negotiation, both parties hold competing draft `axes`. Need a `handoff_proposals` table separate from `handoffs`? Or model as a sub-state with `proposal_history` JSON? Affects `handoffs` schema.
8. **Multi-controller authorship.** When V2 allows multiple AI controllers + a human acting concurrently, `audit_events.actor_kind` and `actor_id` may need to be richer (which controller? on whose behalf?).

## 15. Acceptance Criteria

This schema is "implementation-ready" for V1 when:

1. ✅ All entities from product/architecture docs have a table
2. ✅ All foreign-key relationships are explicit (no string-id implicit linkage)
3. ✅ All idempotency keys are documented with the strategy (§ 6)
4. ✅ All high-frequency queries from § 7 have a supporting index
5. ✅ Multi-tenant boundary is statable (§ 9)
6. ✅ Soft-delete vs hard-delete conventions are uniform (§ 8)
7. ✅ Mibusy carry-forward is field-level explicit (§ 11)
8. ✅ SQLite compatibility table exists (§ 12)
9. ⬜ A reference migration set (`0001_init.sql`) is generated from this spec (verify in M0)
10. ⬜ Round-trip end-to-end test through the full schema with both Postgres and SQLite (verify in M0)
11. ⬜ Audit log can fully reconstruct system state from a known starting point (verify in M3 — required by `functional-architecture.md` § 7.5)
