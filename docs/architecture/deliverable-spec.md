# Deliverable Specification

Status: draft v0.1
Date: 2026-05-15
Owner: design
Position: The deliverable is the durable artifact that work produces. This doc fully specifies its content model, storage, lifecycle, attribution, and cross-desk transfer mechanics. Referenced by `data-model.md` § 4.10 (table schema), `runtime-adapter-interface.md` (DeliverableDraft), `peer-communication-architecture.md` (callback payload), and `handoff-design.md` (return artifact).

## 1. What A Deliverable Is

A deliverable is the durable record of what was produced when work was performed. It is the unit Holon hands back to whoever asked for the work — the answer to "what came of that assignment / mission?"

Three principles shape the spec:

1. **A deliverable is not a chat transcript.** Conversations and runtime events are intermediate; the deliverable is the curated, attributed result. The transcript can be reconstructed from the audit log but is not itself the artifact.
2. **Every deliverable has identity, attribution, and provenance.** Not "here's some text" — "here's text written by Staff X on assignment Y, citing sources Z, signed by desk D."
3. **Deliverables flow back to their parent.** A deliverable always attaches to the assignment or mission that produced it. Orphan deliverables don't exist.

## 2. Body Kinds

Four content shapes. The body kind is set at deliverable creation and immutable thereafter (revisions create a new version; see § 5).

### 2.1 `markdown`

The most common. Free-form text with markdown formatting. Used for: research summaries, drafts, recommendations, status reports, code reviews — most knowledge work outputs.

```typescript
{
  kind: "markdown",
  text: string,                          // GFM-flavored markdown
  toc?: TableOfContentsHint,             // optional pre-computed ToC
  excerpt?: string                       // first-paragraph or model-generated summary
}
```

Length cap: 256 KB (text). Larger content uses files_only or chunked structured form.

### 2.2 `structured`

Schema-backed structured data. Used when the work product is intrinsically structured: a comparison table, a list of recommendations with scores, a JSON config, a parsed dataset.

```typescript
{
  kind: "structured",
  schemaId: string,                      // identifies the structure shape
  schemaVersion: string,                 // semver
  data: unknown,                         // validated against schema
  presentationHint?: PresentationHint    // table / list / chart / form
}
```

`schemaId` is one of:
- A standard schema shipped with Holon (`holon.comparison_table.v1`, `holon.scored_list.v1`, `holon.fact_extract.v1`, etc.)
- A custom schema registered with the desk (`custom:my_schema_id`)
- A schema declared in the assignment's `outputExpectation` (per `runtime-adapter-interface.md` § RuntimeJobConfig)

Receiver desks that don't recognize the schema show the raw JSON with a warning; sender desks that authored the schema can render it richly.

### 2.3 `files_only`

The deliverable is one or more files; no inline body text. Used when the artifact IS the file (a generated PDF, a video, a compiled binary, a data export). The `files` array on the parent deliverable is non-empty.

```typescript
{
  kind: "files_only",
  note?: string,                         // optional brief note from the producer
  primaryFileRef?: string                // which file is the "main" deliverable, if multiple
}
```

### 2.4 `sandbox_export`

A snapshot of work produced in a sandbox-mediated handoff (per `handoff-taxonomy.md` Axis 7). The sandbox is teardown-eligible after export; this body kind preserves what was in it.

```typescript
{
  kind: "sandbox_export",
  exportFormat: "tarball" | "git_bundle" | "ovf" | "container_image" | "raw_files",
  exportRef: string,                     // file ref pointing at the export blob
  manifest?: SandboxManifest,            // what was in the sandbox
  reproducibilityHint?: string           // human note: "to re-run, X"
}
```

Sandbox exports are typically large; storage strategy moves them to cold storage faster than other body kinds.

## 3. The Surrounding Fields

Independent of body kind, every deliverable carries:

```typescript
interface Deliverable {
  id: DeliverableId;
  deskId: DeskId;

  // Origin (exactly one)
  sourceAssignmentId?: AssignmentId;     // locally produced
  sourceMissionId?: MissionId;           // returned from remote

  // Identity
  title: string;                         // owner-visible; required (no "Untitled")

  // Body
  body: MarkdownBody | StructuredBody | FilesOnlyBody | SandboxExportBody;

  // Attached files
  files: DeliverableFile[];

  // Citations
  citations: Citation[];

  // Free-form notes from the producer (e.g., from runtime)
  runtimeNotes?: string;

  // Attribution
  attribution: Attribution;

  // Status
  status: "draft" | "submitted" | "accepted" | "rejected" | "partial" | "withdrawn";

  // Versioning
  version: number;                       // monotonic; revisions increment
  supersedesId?: DeliverableId;          // the previous version this replaces

  // Lifecycle
  createdAt: string;
  submittedAt?: string;
  acceptedAt?: string;
  rejectedAt?: string;
  archivedAt?: string;

  // Cross-desk transfer (when this deliverable was returned from remote)
  remoteOriginDeskId?: DeskId;
  remoteOriginDeliverableId?: DeliverableId;

  // Optional integrity
  contentHash?: string;                  // SHA-256 of canonical serialization
  signature?: string;                    // optional: producer-signed for non-repudiation
}
```

### 3.1 `DeliverableFile`

Files referenced by the deliverable. Stored separately from the deliverable record.

```typescript
interface DeliverableFile {
  id: FileId;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;                   // SHA-256
  storage: FileStorageRef;               // see § 4
  caption?: string;
  extractedAt?: string;                  // for files extracted from a sandbox
}
```

Files are content-addressed by `contentHash` so dedup is automatic across deliverables.

### 3.2 `Citation`

What sources the producer relied on. First-class so that "where did you get this" is answerable without parsing prose.

```typescript
interface Citation {
  refKind: "file" | "doc" | "memory" | "url" | "deliverable" | "context_pack_item";
  refId?: string;                        // local id when refKind is internal
  url?: string;                          // when refKind is "url"
  title?: string;                        // human-readable
  excerpt?: string;                      // the specific passage relied on (truncated to 1 KB)
  positionInBody?: TextRange;            // where in the deliverable the citation supports
  trustLevel?: "owner_provided" | "system_provided" | "discovered_during_work";
}
```

Citations enable: provenance auditing, fact-check tooling, "this passage relies on these sources" UX, and cross-desk trust ("Wang's deliverable cited Sources A, B, C").

### 3.3 `Attribution`

Who is on the hook for this deliverable.

```typescript
interface Attribution {
  // Primary author
  authorKind: "local_ai_staff" | "myself" | "cli_executor" | "remote_desk" | "owner";
  // Per ADR-002: "human_helper" → "myself" (mirrors Substrate.kind union)
  authorStaffId?: StaffId;               // when authorKind is local
  authorPersonId?: PersonId;             // when authorKind is "myself" or "owner" (the owner is the only person identity in V1)
  remoteDeskId?: DeskId;                 // when authorKind is remote_desk
  remoteAttribution?: Attribution;       // nested: what the remote side reported about its sub-author

  // Reviewers / approvers (for forms with approval steps)
  approvers: Array<{
    kind: "human" | "ai_controller" | "co_signer";
    id: string;
    approvedAt: string;
    approvalScope: "content" | "release" | "both";
  }>;

  // Production trail
  producedDuring: {
    runtimeJobId?: RuntimeJobId;         // for AI-staff-produced deliverables
    workSpanMs?: number;
    rounds?: number;                     // how many cycles of work (drafts, retries)
  };
}
```

Nested attribution matters for cascades: when Wang's desk returns a deliverable to Alice, Alice sees "from Wang's desk" — and Wang's local attribution (which AI staff actually wrote it) is preserved nested. Wang controls how much of the nested attribution is exposed — see § 8.

## 4. File Storage

### 4.1 Storage Backends

| Backend | When used | Where |
|---|---|---|
| Local filesystem | Single-user desktop install | `~/.holon/desks/{desk_id}/files/{content_hash[0:2]}/{content_hash}` |
| SQLite blob | Tiny installs only (V1 not recommended; V2 may add) | inside the same SQLite DB |
| S3-compatible object storage | Cloud-hosted Holon, large files, sandbox exports | bucket per tenant; key = `{desk_id}/{content_hash}` |
| Holon relay's content-addressed store | When file moves cross-desk via by-reference payload mode | relay-managed; signed-URL access |

The `FileStorageRef` discriminates:

```typescript
type FileStorageRef =
  | { kind: "local_fs"; absolutePath: string }
  | { kind: "object_storage"; bucket: string; key: string; provider: "s3" | "gcs" | "azure_blob" | "minio" }
  | { kind: "relay_store"; relayUrl: string; signedUrl: string; expiresAt: string }
  | { kind: "sandbox_blob"; sandboxId: string; pathInside: string };
```

### 4.2 Content-Addressed Dedup

Every file is keyed by its SHA-256 content hash. Two deliverables that reference the same file (e.g., the same source document) share storage. Dedup happens at upload time: if the hash already exists, the upload short-circuits.

### 4.3 File Lifecycle

| Stage | Behavior |
|---|---|
| Created | Hash computed; storage write (or dedup match); reference recorded on deliverable |
| Active | Read on demand; cache locally if remote |
| Cold | After 90 days no access, eligible for cold-tier move (V2) |
| Archived | Deliverable archived; file kept (other deliverables may reference it) |
| Garbage-collected | After all referencing deliverables are hard-deleted (rare); reference-count = 0 |

Reference-counting is per-storage-backend. Local filesystem uses a small lookup table; S3 uses a tags/metadata strategy.

### 4.4 Size Limits

| Limit | Default | Configurable |
|---|---|---|
| Max single file size | 100 MB (V1); 1 GB (V2 with chunked upload) | per desk |
| Max files per deliverable | 50 | per desk |
| Max total deliverable file bytes | 500 MB | per desk |

Exceeding limits returns `STORAGE_FILE_TOO_LARGE` (per `reliability-and-testing.md` § 3.1).

## 5. Versioning And Revisions

Deliverables are immutable once submitted; edits create a new version.

### 5.1 Version Number

`version` is a monotonic integer per logical deliverable (per `sourceAssignmentId` or `sourceMissionId`). The first version is 1. Each revision increments by 1.

### 5.2 Supersession

A new version sets `supersedesId` to the previous version's id. Queries can resolve "the current version of this deliverable" by following the chain to the highest version not itself superseded.

UI defaults to showing only the current version with a "view history" affordance.

### 5.3 Revision Triggers

- Owner edits an accepted deliverable (cleanup, formatting, additions)
- Receiver requests changes; sender re-submits
- Cultivation feedback indicates a correction; producer re-runs

### 5.4 Withdrawal

A deliverable can be marked `withdrawn` (e.g., contained an error, no longer accurate). Withdrawal:

- preserves the deliverable record in the audit log
- removes from default queries
- propagates to receivers if the deliverable was returned cross-desk (they see "withdrawn by author" badge)

Withdrawal is NOT deletion; the audit trail stays.

## 6. Status Lifecycle

```
draft → submitted → accepted | rejected | partial | withdrawn
```

| Status | Meaning |
|---|---|
| `draft` | Producer is still working; not yet handed back |
| `submitted` | Producer has finalized and submitted; awaits acceptance |
| `accepted` | Receiver has accepted; deliverable is the answer |
| `rejected` | Receiver rejected with reason; producer may revise (new version) |
| `partial` | Work stopped before completion but partial output preserved (per `reliability-and-testing.md` § 9.3) |
| `withdrawn` | Producer or owner explicitly withdrew |

State transitions emit audit events (`deliverable_*` per `data-model.md` § 4.11).

## 7. Cross-Desk Transfer

When a remote handoff completes, the receiving desk's deliverable callback (per `peer-communication-architecture.md` § 5.2 method `holon.handoff.deliver`) carries the deliverable.

### 7.1 Wire Format

The deliverable in the callback is mostly the same shape as a local deliverable, with three additions:

```typescript
interface CrossDeskDeliverable extends Deliverable {
  // Origin desk
  remoteOriginDeskId: DeskId;
  remoteOriginDeliverableId: DeliverableId;

  // Optional remote signature for non-repudiation
  remoteSignature?: {
    signerDeskId: DeskId;
    algorithm: "ed25519";
    signature: string;                   // over canonical content
    signedAt: string;
  };

  // Disclosure controls (sender's choice — see § 8)
  attributionDisclosure: "full" | "summary" | "anonymous";
}
```

### 7.2 Receiver-Side Storage

Receiver writes the cross-desk deliverable into its local `deliverables` table with:
- a NEW local `id` (the local desk owns its primary keys)
- `remoteOriginDeskId` and `remoteOriginDeliverableId` populated
- `attribution.authorKind = "remote_desk"`
- attached to the local assignment via `sourceAssignmentId`

Files referenced by the deliverable are either:
- transferred inline (small, by-value)
- fetched on demand via signed URLs (by-reference)
- accessed directly inside the sandbox (sandbox-mediated; deliverable carries sandbox export)

### 7.3 Trust And Verification

If `remoteSignature` is present, receiver verifies:
- signer's desk public key matches the connection's known device key
- signature is valid over the canonical serialization of the deliverable content
- timestamp is within an acceptable window

Verification failure surfaces as `HANDOFF_AXES_HASH_MISMATCH`-class event (security signal). The deliverable is NOT auto-rejected (the work might still be valid); the warning is shown prominently to the owner.

## 8. Attribution Disclosure

When work cascades A → B → C, the question is: what does A see about who actually did the work?

### 8.1 Three Disclosure Levels

Set at the time the deliverable returns up the chain:

| Level | What sender shows downstream |
|---|---|
| `full` | Complete nested attribution: "delivered by Wang's desk, executed by Wang's AI Researcher (CLI binary `claude`, role profile X), reviewed by Wang himself" |
| `summary` | Top-level only: "delivered by Wang's desk" — internal substrate hidden |
| `anonymous` | "delivered by your contracted partner" — even desk identity hidden, only the connection is named |

### 8.2 When To Use Which

- **`full`** — when both parties value transparency (mentor/mentee, audit relationships, when receiver needs to know exactly who to talk to about a question)
- **`summary`** (default) — most cases; receiver knows who's accountable but doesn't need to know how it was made
- **`anonymous`** — when the receiver shouldn't know the producer (anonymous reviewers, sealed evaluations)

Default is `summary`. Sender chooses; receiver MUST honor (no scraping for hidden attribution).

### 8.3 Audit Always Sees Full

Disclosure controls what the OTHER PARTY's UI shows. The producing desk's local audit log retains full attribution forever — necessary for the producer's own accountability and post-mortem.

## 9. Permissions And Access

### 9.1 Local Access

Owner has full access. AI controllers (per `auth-and-identity.md` § 8) have access scoped by their `deliverable.read` / `deliverable.write` capabilities.

### 9.2 Cross-Desk Access

When deliverable D is sent from desk A to desk B:

- Desk B can read D fully (it's their copy of the returned artifact).
- Desk B can NOT push edits back to desk A's copy. If B wants to revise D, B can create a new deliverable that supersedes (locally only).
- Desk B can fan D out further only by creating a new deliverable referencing it.

Files referenced by D follow the same access pattern: fetched once, cached locally, no live link back to A's storage.

### 9.3 Search / Discovery

V1: search within a desk's own deliverables (full-text on title, body markdown, citations).

V2: search across deliverables shared via certain connection types (e.g., enterprise-internal search, with respecting of authority scope and disclosure level).

## 10. Retention

Aligned with `data-model.md` § 10:

| Component | V1 | V2 |
|---|---|---|
| Deliverable record | Forever | Compress old metadata to summary after 1 year |
| Body content (markdown / structured) | Forever | Same |
| Files | Forever; cold-tier eligible after 90 days inactive | Optional aging policy per desk |
| Cross-desk return record | Forever | Same |

Owner can manually archive or hard-delete a deliverable at any time. Hard-delete cascades to file references (subject to ref-count > 0 keeping the file alive for other deliverables).

## 11. Cultivation Feedback Hooks

Per `local-agent-management.md` § 7, deliverables feed cultivation profiles.

When the owner reviews a deliverable, the available actions:

| Action | Cultivation effect |
|---|---|
| Approve as-is | No profile change |
| Approve with comment | Comment added to producer's standing instructions (after owner confirms) |
| Edit the deliverable text | Diff inferred as a style correction; suggestion surfaced |
| Reject | Deliverable marked as negative exemplar in producer's profile |
| Mark "great work" | Deliverable marked as positive exemplar |
| Withdraw | No automatic cultivation; owner can flag as "do not produce content like this again" |

These hooks are triggered by UI actions, not automatic. The owner is always in the loop on cultivation changes.

## 12. Schema Validation

Validation runs at three points:

1. **Producer side, on submission.** Body matches its declared kind; required fields populated; size within limits.
2. **Wire layer, on cross-desk transfer.** Same checks plus signature verification (if signed).
3. **Receiver side, on storage.** Same checks plus local policy (file size limits, accepted body kinds).

Validation failures surface as `VALIDATION_FAILED` (per `reliability-and-testing.md` § 3.1).

## 13. Special Cases

### 13.1 Deliverables Containing Other Deliverables

Subcontracting and Approval Chain may produce composite deliverables that themselves reference other deliverables (e.g., "the full report" cites three sub-research deliverables). Composite case:

- The parent deliverable's `citations` includes entries with `refKind: "deliverable"` referencing the child deliverable IDs.
- If children were produced cross-desk, citations may include `refDeskId` for traceability (subject to disclosure level).

### 13.2 Iterative / Streaming Deliverables (V2)

V1 deliverables are atomic — finalized then delivered. V2 may add streaming deliverables for shared-state payload mode (live document collaboration), where the deliverable IS the live store and "submission" means "freeze the current state."

### 13.3 Negotiated Deliverables

Per `handoff-taxonomy.md` Form 12 (Negotiated Handoff), the deliverable may be re-spec'd during negotiation. Once both parties agree on scope, the producer creates a deliverable matching the agreed `outputExpectation`. The negotiation history attaches as audit metadata.

### 13.4 Sandbox Snapshots As Deliverables

When a Sandbox-mediated handoff completes, the deliverable's body kind is `sandbox_export` (per § 2.4). The actual sandbox is torn down; the export blob persists. To "re-open" the work, owner can spin up a new sandbox seeded from the export (V2 feature).

## 14. Cross-References

- DB schema: `data-model.md` § 4.10
- Returned-from-runtime draft format: `runtime-adapter-interface.md` § DeliverableDraft
- Cross-desk callback wire format: `peer-communication-architecture.md` § 5.3 method `holon.handoff.deliver`
- Cultivation feedback loop: `local-agent-management.md` § 7
- Authority scope governing what can be cited: `handoff-design.md` § Authority Scope
- File storage error handling: `reliability-and-testing.md` § 3.1 STORAGE_* codes
- UI rendering of deliverables: `ui-architecture.md` § Deliverables screen

## 15. Open Decisions

1. **Standard structured schemas to ship.** Need an initial library: comparison_table, scored_list, fact_extract, recommendation_set, … which others? V1 ships the obvious ones; community / enterprise schemas come later.
2. **Signing for non-repudiation.** Optional in V1. When should it become mandatory (regulated industries V2)?
3. **File chunking strategy.** V1 caps at 100 MB single files. V2 chunked upload for larger. What chunking format — straight HTTP multipart, S3 multipart, custom?
4. **Cross-desk file replication policy.** Should files travel with the deliverable always (by-value) or be lazy-fetched (by-reference)? Currently: deliverable carries it, sender chooses. Default per file size?
5. **Composite deliverable rendering.** When deliverable A cites deliverables B and C, should the UI inline B/C content or just link? Affects perception and storage.
6. **Editable deliverables.** Are there deliverable kinds that should be editable post-submission without versioning (live notes pad)? Conflicts with immutability principle. V2 question.
7. **Deliverable templates.** Owner-defined templates that pre-fill structure. Useful for repetitive work. V2.
8. **Search index.** When to add full-text search. Sqlite FTS5 is cheap; Postgres full-text is built-in. V1 likely; V2 expands.

## 16. Acceptance Criteria

Implementation-ready for V1 when:

1. ✅ All four body kinds are specified with shapes
2. ✅ File model includes storage backends, dedup, lifecycle, size limits
3. ✅ Versioning / supersession rules are clear
4. ✅ Status lifecycle has all transitions enumerated
5. ✅ Cross-desk transfer mechanics specify wire shape, storage on receive, verification
6. ✅ Attribution disclosure has 3 levels with semantics
7. ✅ Permissions cover local + cross-desk access
8. ✅ Cultivation feedback hooks listed
9. ✅ Cross-references to all referencing docs
10. ⬜ Standard structured schema library exists (M0)
11. ⬜ File storage backend abstracted; tests pass with local_fs and S3-compatible (M1)
12. ⬜ Round-trip cross-desk deliverable verified end-to-end with signature verification (M2)
