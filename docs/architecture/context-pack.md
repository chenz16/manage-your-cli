# Context Pack Specification

Status: draft v0.1
Date: 2026-05-15
Owner: design
Position: The context pack is the bounded bundle of information that travels with a handoff (or stays bound to a local assignment). Referenced by `handoff-design.md` § Context Pack (which sketches the concept but defers schema here), `runtime-adapter-interface.md` § RuntimeJobConfig (which receives a `ContextPackRef`), and `data-model.md` § 4.7 (`handoffs.context_pack_id`).

## 1. What A Context Pack Is

A context pack is the **deliberately scoped slice of information** the sender wants the receiver / runtime to have access to for one piece of work. It is not "everything I know"; it is "exactly what's needed for this specific assignment."

Three principles:

1. **Scoped by intent, not by reachability.** The sender picks the items. The receiver MUST NOT pull additional items beyond the pack. Runtime adapters enforce this.
2. **Bounded in size and lifetime.** Packs have caps on bytes, item count, and persistence duration. They are not durable knowledge bases; they are work briefs.
3. **Authority-tagged.** Each item declares what the receiver may DO with it (read, cite, transform, redistribute). The handoff's authority scope (per `handoff-design.md` § Authority Scope) sets the ceiling; per-item tags can attenuate further.

## 2. Pack Composition

A context pack is a flat list of items plus a small set of pack-level fields.

```typescript
interface ContextPack {
  id: ContextPackId;
  deskId: DeskId;
  
  // Items the receiver/runtime can see
  items: ContextPackItem[];
  
  // Pack-level metadata
  intent: string;                        // "what is this pack for"; markdown
  defaultAuthority: ItemAuthority;       // applied to items that don't override
  
  // Lifecycle
  status: "drafting" | "frozen" | "expired" | "withdrawn";
  createdAt: string;
  frozenAt?: string;                     // when sender locked the pack
  expiresAt?: string;                    // optional auto-expiry
  
  // Provenance
  templateId?: ContextPackTemplateId;    // if instantiated from a template
  
  // Size accounting
  totalBytes: number;                    // sum of all items
  itemCount: number;
}
```

### 2.1 `ContextPackItem`

Discriminated union; six item kinds.

```typescript
type ContextPackItem =
  | FileItem
  | MemoryItem
  | SnippetItem
  | UrlItem
  | DeliverableRefItem
  | StructuredItem;

interface BaseItem {
  id: ItemId;
  position: number;                      // ordering within pack
  caption?: string;                      // human-readable label
  authority?: ItemAuthority;             // overrides pack default
  bytes: number;                         // counted toward pack size
  addedAt: string;
  addedBy: { kind: "human" | "ai_controller" | "template"; id: string };
}

interface FileItem extends BaseItem {
  kind: "file";
  fileRef: FileStorageRef;               // per deliverable-spec.md § 4
  filename: string;
  mimeType: string;
  contentHash: string;
  excerpt?: TextRange;                   // optional: only this range, not the whole file
}

interface MemoryItem extends BaseItem {
  kind: "memory";
  memoryRef: string;                     // pointer into the cultivation profile
  excerpt: string;                       // the actual memory content (denormalized for portability)
  topic?: string;
}

interface SnippetItem extends BaseItem {
  kind: "snippet";
  text: string;                          // inline text
  format: "markdown" | "plain" | "code";
  language?: string;                     // for code snippets
  origin?: string;                       // where it came from (free-form)
}

interface UrlItem extends BaseItem {
  kind: "url";
  url: string;
  fetchedSnapshot?: {                    // optional pre-fetched snapshot at pack creation time
    fetchedAt: string;
    contentHash: string;
    storageRef: FileStorageRef;
  };
  fetchPolicy: "snapshot" | "live" | "forbid";
}

interface DeliverableRefItem extends BaseItem {
  kind: "deliverable_ref";
  deliverableId: DeliverableId;
  remoteOriginDeskId?: DeskId;          // for cross-desk deliverable references
  scope: "title_only" | "summary" | "full";  // how much to include
}

interface StructuredItem extends BaseItem {
  kind: "structured";
  schemaId: string;
  data: unknown;                         // validated against schemaId
}
```

### 2.2 `ItemAuthority`

What the receiver/runtime may do with an item:

```typescript
type ItemAuthority =
  | "read_only"                          // may read, may not cite (fully invisible to deliverable)
  | "cite_only"                          // may read, must cite if used
  | "transform"                          // may modify and emit modified version
  | "redistribute";                      // may include in deliverable verbatim or modified
```

Default per item kind:
- `file`, `url` snapshot, `memory`: `cite_only` (citation expected)
- `snippet` (small inline): `redistribute` (sender added it specifically for use)
- `deliverable_ref`: `cite_only`
- `structured`: `transform` (data is meant to be processed)

These are defaults; sender may override per item.

## 3. Size And Bound Limits

| Limit | V1 default | Configurable per desk |
|---|---|---|
| Maximum items per pack | 50 | yes |
| Maximum total pack bytes | 10 MB | yes |
| Maximum single item bytes (inline) | 256 KB | yes |
| Maximum file item by-reference size | 100 MB (matches deliverable-spec) | yes |
| Maximum URL fetched snapshot size | 5 MB | yes |
| Maximum pack lifetime after freeze | 90 days | yes |

Exceeding limits returns `VALIDATION_FAILED` with specific reason. The UI guides the sender to chunk, drop, or by-reference items.

### 3.1 Why Caps

- **Receiver storage cost** — a pack travels by-value into the receiver's database. Unbounded packs would let one sender impose unbounded storage on receivers.
- **Runtime context window cost** — packs are loaded into runtime context per `runtime-adapter-interface.md`. Unbounded packs would blow context budget.
- **Cognitive load on receiver owner** — the inbox UI displays pack contents; a 200-item pack is impossible to review.
- **Audit weight** — packs are part of the handoff's audit record; small packs are auditable.

The right way to ship "lots of context" is by-reference items + selective excerpts, not enormous packs.

## 4. Lifecycle

```
drafting → frozen → expired | withdrawn
```

| Transition | When |
|---|---|
| `drafting → frozen` | Sender finalizes the pack (typically when handoff is sent) |
| `frozen → expired` | `expiresAt` reached or parent handoff terminal |
| `frozen → withdrawn` | Sender explicitly retracts (per Axis 5 revocation; the pack disappears from receiver) |

Once `frozen`, items cannot be added, removed, or modified. To change the pack, sender creates a new pack and a new handoff (or revises the handoff per its form's rules).

### 4.1 Drafting

While `drafting`, the sender's UI lets them:

- add / remove / reorder items
- preview total bytes and item count against limits
- preview what the receiver will see (the "receiver view")
- adjust per-item authority
- save as template for future reuse

Drafts persist locally; nothing leaves the desk yet.

### 4.2 Freezing

When the sender clicks "send handoff":

1. Pack is validated against limits.
2. `status: frozen`, `frozenAt: now`.
3. `contentHash` computed over canonical serialization (for tamper detection — see § 6).
4. Pack ID is included in the handoff packet.
5. By-value items are inlined in the wire payload (or by-reference items have signed URLs minted).

### 4.3 Expiry

Packs auto-expire either:
- When the parent handoff reaches a terminal state (default).
- When `expiresAt` is set explicitly (e.g., for long-lived handoffs that should rotate context).

Expired packs are kept for audit but cannot be loaded into runtime context any more. The owner can extend or refresh by sending a new handoff.

### 4.4 Withdrawal

Sender invokes withdrawal. The pack is purged from the receiver's accessible storage (audit retains a tombstone); receiver UI shows "context withdrawn by sender."

This cuts off any in-flight work that depended on the pack: the runtime's next read of withdrawn items returns `RUNTIME_CONTEXT_UNAVAILABLE` (per `reliability-and-testing.md` § 3).

## 5. Templates

Repeated handoffs benefit from pack templates.

```typescript
interface ContextPackTemplate {
  id: ContextPackTemplateId;
  deskId: DeskId;
  name: string;
  description: string;
  
  // Variables the template exposes
  variables: Array<{
    name: string;
    kind: "file_ref" | "snippet" | "url" | "deliverable_ref" | "freetext";
    required: boolean;
    description: string;
  }>;
  
  // The skeleton — items with placeholder substitution
  skeletonItems: ContextPackItem[];
  
  // Defaults
  defaultIntent: string;
  defaultAuthority: ItemAuthority;
  
  createdAt: string;
  archivedAt?: string;
}
```

Templates are local to a desk. Common patterns:

- "Code review template" — variables: PR diff URL, target branch context, style guide file
- "Research brief template" — variables: topic snippet, prior research deliverable refs, competitor list
- "Customer escalation template" — variables: customer record, conversation history file, related tickets

Instantiating a template fills variables and creates a draft pack the sender can refine.

## 6. Tamper Detection

The pack's `contentHash` (SHA-256 of canonical serialization) is computed at freeze time and stored in the handoff record (`handoffs.axes_hash` per `data-model.md` § 4.7 includes the pack hash in its computation).

Receiver verifies on receipt:
- Unmarshal pack
- Recompute hash
- Compare to handoff record's expected value
- If mismatch: emit `HANDOFF_AXES_HASH_MISMATCH` (security event, per `reliability-and-testing.md`)

Tamper detection covers in-transit modification AND post-receipt modification of the receiver's local copy. Audit replay can re-verify any historical pack against its hash.

## 7. Cross-Desk Transfer

When a handoff carries a pack to a remote desk:

### 7.1 By-Value Items

Inlined in the handoff packet's `params.handoff.contextPack` (per `peer-communication-architecture.md` § 5.3). Subject to the wire-level packet size limit (1 MB inline; larger packs must use by-reference for large items).

### 7.2 By-Reference Items

For files/snapshots that exceed inline budget:

- Sender uploads to relay-managed object storage, gets signed URL.
- The pack item carries the signed URL with TTL.
- Receiver fetches on demand.
- If sender revokes the pack (or the handoff), signed URL is invalidated.

### 7.3 Memory Items

Memory items carry their text inline (denormalized from the cultivation profile). The receiver does NOT get access to the cultivation profile itself — only the specific memory excerpts the sender included.

### 7.4 Deliverable References

Cross-desk deliverable refs:
- If the deliverable is local to sender, sender includes it as a `deliverable_ref` with `scope` (title / summary / full). Sender's desk fetches the appropriate slice and inlines it.
- If the deliverable is itself from a remote desk, the sender may need permission to re-share — depending on the original receiver's policy. V2 will formalize sharing chains.

### 7.5 Storage On Receiver

Receiver writes the pack to its local `context_packs` table (schema in § 9). Items become locally addressable; they are bound to the inbound mission and get the same lifecycle.

## 8. Runtime Integration

The runtime adapter receives a `ContextPackRef` in `RuntimeJobConfig.contextPack` (per `runtime-adapter-interface.md`). The adapter:

1. Resolves the ref to the actual pack contents (local lookup).
2. Loads items into the runtime's context window in priority order (sender's `position` ordering).
3. Honors per-item authority — e.g., on `cite_only` items, the runtime tracks usage and ensures the deliverable's citations include the item.
4. Tracks which items were actually accessed (emits `context_retrieved` events per `runtime-adapter-interface.md` § RuntimeEvent).
5. Refuses requests to fetch items NOT in the pack (returns `RUNTIME_CONTEXT_UNAVAILABLE`).

The pack is the SOLE source of work-context for the runtime. The runtime cannot pull from the desk's broader DB, file system, or prior assignments unless they are explicitly included in the pack.

## 9. Persistence

```sql
CREATE TABLE context_packs (
  id                 TEXT PRIMARY KEY,                -- ctx_<uuidv7>
  desk_id            TEXT NOT NULL REFERENCES desks(id),
  intent             TEXT NOT NULL,
  default_authority  TEXT NOT NULL DEFAULT 'cite_only',
  status             TEXT NOT NULL DEFAULT 'drafting',
  total_bytes        INTEGER NOT NULL DEFAULT 0,
  item_count         INTEGER NOT NULL DEFAULT 0,
  template_id        TEXT REFERENCES context_pack_templates(id),
  content_hash       TEXT,                            -- set when frozen
  created_at         TEXT NOT NULL,
  frozen_at          TEXT,
  expires_at         TEXT,
  withdrawn_at       TEXT,
  CHECK (status IN ('drafting','frozen','expired','withdrawn')),
  CHECK (default_authority IN ('read_only','cite_only','transform','redistribute'))
);

CREATE TABLE context_pack_items (
  id                 TEXT PRIMARY KEY,                -- ctxitem_<uuidv7>
  pack_id            TEXT NOT NULL REFERENCES context_packs(id),
  position           INTEGER NOT NULL,
  kind               TEXT NOT NULL,                   -- 'file' | 'memory' | 'snippet' | 'url' | 'deliverable_ref' | 'structured'
  caption            TEXT,
  authority          TEXT,                            -- nullable; falls back to pack.default_authority
  payload            JSONB NOT NULL,                  -- shape depends on kind
  bytes              INTEGER NOT NULL,
  added_at           TEXT NOT NULL,
  added_by_kind      TEXT NOT NULL,
  added_by_id        TEXT NOT NULL,
  CHECK (kind IN ('file','memory','snippet','url','deliverable_ref','structured')),
  UNIQUE (pack_id, position)
);

CREATE INDEX idx_context_pack_items_pack ON context_pack_items(pack_id, position);

CREATE TABLE context_pack_templates (
  id                 TEXT PRIMARY KEY,                -- ctxtmpl_<uuidv7>
  desk_id            TEXT NOT NULL REFERENCES desks(id),
  name               TEXT NOT NULL,
  description        TEXT NOT NULL,
  variables          JSONB NOT NULL DEFAULT '[]',
  skeleton_items     JSONB NOT NULL DEFAULT '[]',
  default_intent     TEXT NOT NULL,
  default_authority  TEXT NOT NULL DEFAULT 'cite_only',
  created_at         TEXT NOT NULL,
  archived_at        TEXT,
  UNIQUE (desk_id, name) WHERE archived_at IS NULL
);
```

These tables fit `data-model.md`'s overall conventions; should be added in the next data-model revision.

## 10. UI Surfaces

### 10.1 Pack Composer (Sender Side)

A drag-and-drop composer where the owner builds a pack:

- Source picker: "from this assignment", "from this deliverable", "upload file", "paste snippet", "fetch URL", "search memory"
- Item list view: each item with caption, byte count, authority badge
- Total tracker: items count / cap, total bytes / cap
- Preview pane: how the receiver will see this pack
- Authority editor: per-item override
- Template controls: save current pack as template; instantiate from template

### 10.2 Pack Viewer (Receiver Side)

When inspecting an inbound mission's context pack:

- Item list with caption + bytes + authority badge
- Click item to view content (with format-appropriate rendering)
- Citation tracker: what items the runtime/staff has cited so far
- Withdrawal alert: if sender withdraws, prominent banner; in-flight runtime emits `RUNTIME_CONTEXT_UNAVAILABLE`

### 10.3 Pack Hash Verification

A small badge near pack content shows hash verification status:
- ✓ verified — content matches sender's claimed hash
- ⚠ mismatch — security warning surfaced

## 11. Privacy And Sensitive Content

### 11.1 Sender-Side Marking

Items can be marked sensitive (`sensitive: true`). Sensitive items:

- show a warning before being inlined in cross-desk handoffs
- get extra audit weight on access
- may be excluded from cross-desk fan-out (e.g., not allowed in Subcontracting that goes beyond first hop)

### 11.2 Receiver-Side Handling

Sensitive items in received packs:

- shown with prominent badges in the receiver's UI
- runtime adapter logs every access
- cannot be cited verbatim in deliverables that disclosure-level `summary` or `anonymous` would propagate further

### 11.3 What's Out of Scope

Holon does NOT auto-detect PII or sensitive content. The owner marks items. V2 may add lightweight scanning hints.

## 12. Interaction With Cultivation

Per `local-agent-management.md` § 7, AI staff are cultivated over time. Cultivation profile items can become memory items in packs.

When the runtime accesses a memory item from a pack, it is NOT free to "remember" it persistently — accessing pack contents does not modify the cultivation profile. Cultivation changes happen only through the explicit feedback loop (per the deliverable feedback hooks in `deliverable-spec.md` § 11).

This separation matters: pack contents are scoped to the assignment; cultivation is the long-term identity of the staff. Mixing them would let one assignment's context permanently bleed into the staff's behavior.

## 13. Cross-References

- Authority scope on the parent handoff: `handoff-design.md` § Authority Scope (sets the ceiling for per-item authority)
- File storage backends and refs: `deliverable-spec.md` § 4
- Wire format for packs in handoffs: `peer-communication-architecture.md` § 5.3
- Runtime adapter receives pack via: `runtime-adapter-interface.md` § RuntimeJobConfig.contextPack
- Hash verification ties into: `handoff-design.md` § Handoff Packet (axes_hash includes pack hash)
- Audit events: `reliability-and-testing.md` § 5.4 (audit hooks)
- Data model schema: § 9 above (to be merged into `data-model.md`)

## 14. Open Decisions

1. **Pack-level encryption.** Should sensitive packs be encrypted in transit beyond TLS? V1 relies on TLS + relay being trustworthy; V2 may add E2E for sensitive marker.
2. **Live URL fetching.** `urlItem.fetchPolicy: "live"` lets receivers fetch the URL fresh — but this can leak receiver-side IP, racy content, etc. Default `snapshot` is safer; should `live` be allowed at all?
3. **Pack diffing for revisions.** When a handoff is revised (per Negotiated form), the pack may change. Show a diff UI? Or treat each revision as a fresh pack?
4. **Cultivation source items.** Should memory items in packs link back to their cultivation source (so the receiver knows "this came from staff X's accumulated experience"), or be presented as anonymous excerpts? Privacy/transparency tradeoff.
5. **Maximum pack lifetime after handoff completion.** Default deletes pack when handoff terminates. Should there be a "keep for evidence" mode for compliance scenarios?
6. **Cross-desk deliverable refs and re-sharing.** When sender includes a deliverable from a third-party desk, what permission model governs re-sharing? V2.
7. **Snippet de-dup.** Two pack items with identical text — automatic dedup, or user-facing as separate items? Probably auto-dedup with combined caption.
8. **Schema validation severity.** `structured` items have schemaIds. If schema fails to validate, hard reject or warning + accept? Current: hard reject.

## 15. Acceptance Criteria

V1 implementation-ready when:

1. ✅ Six item kinds specified with shapes
2. ✅ Pack-level metadata schema complete
3. ✅ Authority levels defined per item kind with defaults
4. ✅ Size and bound limits enumerated with rationale
5. ✅ Lifecycle states and transitions covered
6. ✅ Template mechanism specified
7. ✅ Tamper detection (hash) integrates with handoff axes_hash
8. ✅ Cross-desk transfer mechanics covered for all item kinds
9. ✅ Runtime integration with `ContextPackRef` resolution
10. ✅ Persistence schema slots into data-model.md
11. ✅ UI surfaces sketched for both sender and receiver
12. ⬜ Reference pack composer UI implemented (M1)
13. ⬜ Hash verification round-trip tested cross-desk (M2)
14. ⬜ Memory item bleed into runtime context verified bounded (M2)
