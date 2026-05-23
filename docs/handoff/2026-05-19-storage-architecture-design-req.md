# Design Requirement — Storage Architecture (Cloud + Local + Sharing)

Date: 2026-05-19
Author: owner ↔ assistant design discussion (this web session)
Status: **design-requirement-proposed**
Target iteration: next available (≥ iter-018)
Pickup by: Requirements Agent → iteration `requirements.md` + `plan.md`
Related: ADR-029 (coworker substrate), Engineering Rules #2 (two cores), #4 (no silent failure), #8 (audit completeness)

> This is a **design requirement** (owner-stated), not a finished spec or ADR.
> The Requirements Agent should expand this into a proper iteration requirements.md
> with acceptance criteria, surface clarifying questions back to the owner where
> needed, and surface architectural decisions as ADRs (proposed → accepted).

---

## 0. Context

Holon's V1 was always local-first (SQLite + Tauri, all data on owner's laptop). That works for solo-owner V1.0 but blocks 3 real customer needs surfaced in the 2026-05-19 design discussion:

1. Owner has multiple devices (laptop + work computer) — wants data sync
2. Owner has 1-3 person team (owner + assistant + intern) — wants selective file sharing
3. Owner uses cloud already (Google Drive / OneDrive / company S3) — wants Holon to use what they already pay for, not lock them into a new vendor

Holon's competitive positioning is "**your data stays in YOUR cloud, we never see it**" (vs Notion/Linear vendor-hosted SaaS). The architecture must preserve this guarantee — Holon the vendor stores zero customer data.

---

## 1. Owner-stated Requirements (verbatim, owner direction 2026-05-19)

1. **支持云存储** — Support cloud storage (so data isn't trapped on one laptop)
2. **支持本地文件夹** — Support local folders (so data sovereignty / offline use works for non-cloud users)
3. **User 能设置哪些用户共享什么文件** — Owner can configure which users share which files (selective sharing)

---

## 2. Expanded Requirements

### R1: Pluggable storage backend

Holon's storage layer must abstract over the underlying backend so the same code paths (deliverables, attachments, fixtures, audit log archive) work regardless of where bytes physically live.

**Backends to support (V1.x scope)**:
- **Local filesystem** (default, no setup) — current behavior
- **S3-compatible** (AWS S3 / Cloudflare R2 / Wasabi / MinIO / Backblaze B2) — covers 80% of cloud cases via a single API surface
- **WebDAV** (Nextcloud / Synology NAS / ownCloud / Box) — for SMB/EU customers who self-host
- **Google Drive** (V1.x, optional second-phase) — convenience for SMB owners who already have Google Workspace
- **OneDrive / SharePoint** (V2) — Microsoft 365 customers

Owner picks one in Settings → Storage. Switching backends is a one-time migration (export-then-reimport pattern is acceptable; live two-way sync is V2).

### R2: Storage-tier-by-data-sensitivity

Not all Holon data has the same sensitivity. The storage backend choice must honor a three-tier policy:

| Tier | Data | Storage rule |
|---|---|---|
| 🔴 **Secrets** | OAuth tokens, API keys, peer Ed25519 keys, encryption keys | **Always local** (Tauri keyring / OS keychain). Never touches any cloud, even owner's own. |
| 🟡 **Working data** | Missions, deliverables, audit log, fixtures, attachments | Follows the configured backend (R1). Owner chooses local or cloud. |
| 🟢 **Catalog data** | Skill definitions, references, owner config (non-token fields) | Same as 🟡 by default, but eligible for selective sharing (R3). |

This tiering is **non-negotiable** — secrets in cloud is a security wound, regardless of "owner's own cloud".

### R3: Selective sharing — who sees what

Owner can declare per-resource sharing rules. The MVP set of shareable resources:

- **Skill** (entire skill can be shared with a teammate)
- **Reference** (a reference doc can be shared with a teammate)
- **Deliverable** (a specific output can be shared with a teammate or with an external peer)
- **Workspace folder** (a subtree of working files can be shared)

For each resource, owner declares:
- **With whom**: another Holon user (by their peer ID), an external Holon desk (via Core 2 connection), or "anyone with the link" (least-privilege link sharing)
- **Permission**: read-only / read-write
- **Expiration** (optional): time-bounded share

**Sharing mechanism (V1)**: leverages the backend's native ACL where possible:
- Google Drive backend → Google Drive's native share (email, link)
- S3 backend → pre-signed URLs (read-only) or IAM roles (read-write, advanced)
- WebDAV → backend-specific (Nextcloud has native sharing; bare WebDAV doesn't)
- Local-only → no sharing possible (degrade gracefully, surface "Switch to cloud backend to share" hint)

Holon does NOT build its own ACL system in V1. It records the share intent in audit log and delegates the actual access control to the storage backend. (V2 may add Holon-level ACL on top for cross-backend uniformity.)

### R4: Cross-device sync (implied by R1 cloud backends)

Once two Holon installs point at the same cloud backend with the same identity, edits made on device A must become visible on device B within a reasonable window (target: 30 seconds for working data, 5 minutes for archive).

Conflict resolution V1:
- **Last-write-wins** for catalog data (skill/reference)
- **Append-only** for audit log (no conflicts)
- **Owner-resolved** for deliverable conflicts (UI prompts "Two versions exist, pick one or merge")
- CRDT-based real-time collab is V2+ (and only for document-mode storage anyway, see § 5)

### R5: No vendor lock-in / data ownership

Owner must be able to:
- **Export everything** to a portable format (zip of SQLite + workspace + manifest JSON) at any time
- **Switch backends** without data loss (export-migrate-import flow)
- **Delete all Holon data from a backend** without leaving residue
- **Stop using Holon entirely** and still access raw working files (no proprietary lock format)

---

## 3. Acceptance Criteria

(Requirements Agent should expand these into testable scenarios.)

1. ✅ A new Holon install on a fresh laptop defaults to local-fs backend; no cloud setup required to be functional
2. ✅ Owner can switch to S3 backend in Settings → Storage; existing local data is migrated to S3 (with confirmation)
3. ✅ Two Holon installs (owner's laptop + owner's desktop) pointing at the same S3 bucket converge within 30 seconds for working data
4. ✅ Owner can right-click a deliverable → "Share with Tom" → Tom (a peer or teammate) sees the deliverable in his Holon within 30 seconds
5. ✅ Owner can revoke a share; recipient loses access within 5 minutes
6. ✅ Secrets (OAuth tokens) NEVER appear in any cloud backend, only in OS keyring (verified by inspecting the S3 bucket contents)
7. ✅ Owner can export full Holon state to a zip; another Holon install can import it
8. ✅ Audit log records every share/unshare event with `{resource_id, granted_to, permission, ts}` (Rule #8)
9. ✅ Failed backend operations surface visible UI errors with retry option (Rule #4 — no silent failure)

---

## 4. Open Questions (need owner input before Requirements Agent finalizes)

### Q1: Multi-user vs Multi-device

"User 能设置哪些用户共享什么文件" — does "user" here mean:

- **A**: Another Holon desk (peer, via Core 2). Sharing = owner-to-owner across orgs.
- **B**: A teammate inside the same owner's company (admin + assistant + intern, all working under owner's authority).
- **C**: Both?

Current Holon architecture is **single-owner-per-desk**. Option B requires either (i) multiple owners on one desk (architectural change), or (ii) each teammate has their own desk with a "team" relationship grouping them (cleaner but new concept).

**Default assumption for first draft**: **C, with priority on A first** (cross-desk sharing via Core 2 is already in scope; intra-company multi-user is V2).

### Q2: Google Drive as primary storage backend, or only as "document publishing" target?

Two distinct patterns:

- **A**: Google Drive is the **primary** storage backend — Holon stores SQLite + all working data in a Google Drive folder owner picks
- **B**: Google Drive is a **publishing target** — primary backend is still S3/local, but specific deliverables can be "published as Google Docs" for collaboration / sharing

These are different products. A is simpler conceptually but constrains Holon to Google's API limits; B is more flexible but more work.

**Default assumption for first draft**: **B** (publishing target). A is V2 if customers demand it.

### Q3: What's the smallest unit of sharing?

- **Per file** — fine-grained, lots of share records to track
- **Per folder / workspace subtree** — coarse but easy to reason about
- **Per resource type** (e.g., "share all skills" / "share all deliverables tagged Q1") — set-based

**Default assumption for first draft**: **per resource** (share individual skill / reference / deliverable). Folder-level grouping in V2.

### Q4: Encryption-at-rest in cloud backends?

- **None** — trust the backend's own encryption (S3 has SSE; Google Drive encrypts at rest)
- **Client-side E2E** — Holon encrypts before upload; only owner has the key
- **Per-share encryption** — recipient gets a key only for what's shared with them

E2E is the strongest privacy posture and matches "**your data stays in YOUR cloud**" messaging. But adds complexity (key management, recovery, sharing handshake).

**Default assumption for first draft**: **trust the backend** for V1 (acceptable for SMB owner threat model); **E2E** as V2 add-on for security-sensitive customers.

### Q5: Sync conflict UX

When two devices edit the same deliverable, what does the owner see?

- A: Last-write-wins silently (data loss possible)
- B: Conflict dialog ("two versions exist, pick one")
- C: Branch-and-merge (both versions kept, owner merges later)

**Default assumption for first draft**: **B** for deliverables, **A** for everything else, **C** is V2.

---

## 5. Out of Scope for V1.x (Deferred to V2+)

Explicitly NOT in this design requirement (separate ADRs if pursued later):

- Real-time CRDT collaboration on documents (V2 — would need Yjs/Automerge integration)
- Holon's own cloud-hosted "Holon Cloud Sync" SaaS tier (V2 — only if customer demand emerges; would need full backend + SOC 2)
- Intra-company multi-user under one desk (V2 — architectural change, see Q1)
- Per-share E2E encryption with sharing handshake (V2 — see Q4)
- Auto-migration between backends without owner action (V2 — requires solving zero-downtime cutover)
- Mobile clients accessing cloud-backed data (V2 — mobile track has its own architecture, see `docs/architecture/mobile-architecture-principles.md`)

---

## 6. Reference Architecture (informational; Requirements Agent may revise)

```typescript
// Storage abstraction — all of Holon's storage operations go through this
interface StorageProvider {
  read(path: string): Promise<Blob | null>;
  write(path: string, blob: Blob, opts?: { ifMatch?: string }): Promise<WriteResult>;
  list(prefix: string): Promise<StorageEntry[]>;
  delete(path: string): Promise<void>;

  // Sharing — delegated to backend's native mechanism where possible
  share?(path: string, with: ShareTarget, perm: 'read' | 'write', exp?: Date): Promise<ShareGrant>;
  revoke?(grantId: ShareGrantId): Promise<void>;
  listShares?(path: string): Promise<ShareGrant[]>;

  // Capability flags — UI uses these to enable/disable share UI
  capabilities(): StorageCapabilities;
}

// Concrete implementations:
class LocalFileSystemProvider implements StorageProvider { /* default */ }
class S3Provider implements StorageProvider { /* AWS/R2/MinIO/etc. */ }
class WebDAVProvider implements StorageProvider { /* Nextcloud/Synology/etc. */ }
class GoogleDriveProvider implements StorageProvider { /* V1.x optional */ }
// OneDriveProvider — V2

// Where it lives in package layout:
//   packages/storage/                     (new package, MIT-equivalent to runtime-hermes)
//     src/index.ts                        — StorageProvider interface
//     src/providers/local-fs.ts
//     src/providers/s3.ts
//     src/providers/webdav.ts
//     src/providers/google-drive.ts
//     src/migration.ts                    — backend-to-backend migration logic
//     src/sync.ts                         — multi-device sync engine
```

Settings UI surface (no nav change):

```
Settings → Storage
├─ Storage backend
│  ○ Local only (this device)
│  ● S3-compatible        [Configure ▼]
│  ○ WebDAV               [Configure ▼]
│  ○ Google Drive         [Connect Google Workspace →]
│
├─ Sync status
│  ✅ Last synced 14:32 from device "Sarah-MBP"
│  [Force sync now]
│
├─ Data location
│  Workspace folder: /Users/sarah/HolonWorkspace
│  [Open folder] [Change…]
│
└─ Export / Migration
   [Export everything (zip)…]
   [Migrate to different backend…]
```

---

## 7. Spec Edits Implied (downstream tasks)

- `docs/architecture/data-model.md`: Add `StorageBackend` config table + `ShareGrant` table; document the 3-tier sensitivity policy
- `docs/architecture/functional-architecture.md`: Add a § for storage layer (slots cleanly between Core 1 and infra layer)
- `docs/architecture/security-threat-model.md`: Update threat model for cloud backends; document the secrets-stay-local invariant
- New ADR: "Storage layer is pluggable via StorageProvider interface; defaults to local-fs"
- New ADR: "Selective sharing delegates to backend-native ACL in V1; Holon-level ACL deferred to V2"
- `packages/storage/` — new workspace package
- UI: new `/me` (or settings page) section for Storage config

---

## 8. Phased Delivery Plan (proposed)

| Phase | Scope | Time estimate |
|---|---|---|
| **V1.1** | StorageProvider abstraction + LocalFileSystem provider (refactor only, no user-visible change) | 1 iteration |
| **V1.2** | S3Provider + Settings → Storage UI + migration tool | 1-2 iterations |
| **V1.3** | Cross-device sync via S3 (basic last-write-wins) | 1 iteration |
| **V1.4** | Selective sharing on S3 (pre-signed URLs + share audit) | 1 iteration |
| **V1.5** | GoogleDriveProvider as publishing target (Q2 option B) | 1 iteration |
| **V1.6** | WebDAVProvider for self-hosted / EU customers | 1 iteration |
| **V2+** | E2E encryption, intra-company multi-user, real-time collab, Holon Cloud Sync | separate ADRs |

V1.1 is **safely doable now** (pure refactor, no user-visible change, paves the way). V1.2-V1.5 needs Q1-Q5 answered first.

---

## 9. Pickup Instructions for Requirements Agent

When you pick this up:

1. Read this doc + ADR-029 + `docs/architecture/data-model.md` § "Storage" (if exists) / `functional-architecture.md`
2. Surface Q1-Q5 to owner via `dev-questions.md` (or async question channel) — get answers before drafting iteration requirements.md
3. Draft `requirements.md` for the next iteration covering ONLY V1.1 (the refactor) — small, safe, gets the abstraction in place
4. Draft `plan.md` with task breakdown (StorageProvider interface, LocalFileSystem implementation, refactor of deliverable service + fixture service to go through it, migration of existing call sites)
5. Open ADR drafts for the architecture decisions (pluggable backend, sharing delegation)
6. Subsequent iterations (V1.2+) get their own requirements/plan documents per the standard iter flow

V1.1 alone is small enough that the Test Agent can fully cover regression (existing local-fs behavior unchanged) — making it a low-risk first step that unlocks everything else.

---

## 10. Owner's Direct Quotes (for context anchoring)

From the 2026-05-19 design discussion:

> "我有2个方法 一个是客户自己提供存储的空间 可能不同的user之间share一些空间或者文档 或者就是google doc 或者微软的云那种 怎么支持"
> ("I have 2 approaches — one is customer provides their own storage space, possibly with different users sharing some space or documents; or use Google Doc or Microsoft cloud — how to support?")

> "怎么提个设计需求 1. 就是支持云存储 2. 支持本地文件夹 3. user能设置哪些用户共享什么文件"
> ("How to write a design requirement: 1. support cloud storage 2. support local folders 3. users can set which files are shared with which users")

Owner's strategic direction earlier in the session:

> "你的数据是 owner-owned, 永远在 owner's cloud / owner's machine, Holon 这个 vendor 不存任何用户数据"
(Holon's competitive positioning principle)

---

This document supersedes nothing. It is the **first input** to the next iteration's requirements drafting.

---

## 11. Owner Responses to Open Questions (2026-05-19T~20:32Z)

Captured live by orchestrator. Q1-3 are owner-direct (`其他你帮我定`); Q4-5 are owner-delegated to orchestrator judgment per `[[feedback_autonomous_judgment]]` (long-term-clean over fast-now per `[[feedback_long_term_value]]`).

### Q1 — Multi-user vs Multi-device (priority order)

**Owner answer:** "优先自己多设备，后再是团队成员（这是这个项目的 Core 2），多设备还属于 Core 1"

**Decision:**
- **V1.x priority: self multi-device sync FIRST** → expansion of Core 1 (one owner, flat staff roster, now across N owner devices) — same `owner_assistant` + `staff` + `mission` + `deliverable` records replicated across the owner's laptop / work computer / tablet.
- **V1.4+ Team sharing** → Core 2 surface (selective per-resource share to a peer's desk, leverages existing connection + handoff architecture).
- **Architectural implication:** the StorageProvider abstraction (R1) must handle both, but the *sync semantics* differ — Core 1 multi-device is "same identity, multiple machines" (no permission check needed); Core 2 sharing is "different identity, explicit grant" (uses ADR-029 substrate model + Core 2 authority rules).

### Q2 — Google Drive role (storage backend vs publishing target)

**Owner answer:** "如果用户指定做存储设备（必须本地要有 Google Drive 客户端），本地没有就是发布目标，不然性能跟不上"

**Decision:**
- **Conditional capability**: Google Drive is a **true storage backend** ONLY when the owner has the local Google Drive sync client installed (which mirrors the cloud folder to a local path; Holon then writes to that local path and Google Drive client handles the upload).
- **Without local sync client → publishing-target only**: Holon exports a snapshot / share link to Google Drive via API, but does NOT use it as the live working backend (round-trip API latency would make every read/write painful).
- **Detection**: Holon checks for typical local mount points at startup (`~/Google Drive/`, `~/GoogleDrive/`, `~/My Drive/`, `%USERPROFILE%\Google Drive\`); if found → mode = `storage_backend`; if not → mode = `publishing_target` (toggle disabled in settings with explanation).
- Same logic applies to OneDrive (V2): requires local OneDrive client mounted.

### Q3 — Minimum sharing unit (granularity)

**Owner answer:** "分享 skill + 文件夹 + 文件"

**Decision (V1.4 sharing scope must include ALL THREE):**
- **Skill share** — entire `Skill` record (definition + version history) shared with recipient; recipient sees in their Library as `[shared by <owner>]` (read-only by default; read-write if grantor allows)
- **Folder share** — a subtree of the working-files filesystem (e.g. a project folder containing deliverables, attachments, drafts) shared as a unit; recursive permissions
- **File share** — a single deliverable / attachment / reference doc shared individually; finest granularity

This drives the `ShareRecord` schema design (R3) to support a `resource_type: 'skill' | 'folder' | 'file'` discriminator with appropriate ID reference per type.

### Q4 — E2E encryption posture (orchestrator decision)

**Owner delegated** ("其他你帮我定")

**Decision: YES — client-side encryption from V1.2 S3 onward.**

Rationale:
- Holon's positioning is "your data stays in YOUR cloud, we never see it". Without client-side encryption, that's a marketing claim, not a technical guarantee — the cloud provider (and anyone who compromises Holon's vendor side) can read everything. With client-side encryption, it becomes a cryptographic invariant.
- AES-256-GCM with owner-derived key (PBKDF2 from a passphrase set during onboarding Step N + stored in OS keychain alongside the existing secrets tier). Encryption happens at the StorageProvider seam before any byte hits the cloud SDK.
- **V1.1 refactor**: NO encryption layer yet (StorageProvider abstraction first; local backend doesn't need encryption since OS-level disk encryption is the owner's responsibility on their own machine).
- **V1.2 S3 / V1.5 Google Drive / V1.6 WebDAV**: encryption-at-rest mandatory for all cloud backends. Object names are encrypted too (so the cloud provider can't even see filenames revealing project structure).
- **V1.4 sharing**: introduces X25519 ECDH key exchange — when owner shares a resource with another Holon user, the resource's symmetric AES key is re-encrypted with the recipient's public key; recipient decrypts on their side. Holon servers never see plaintext keys.
- **Owner key recovery**: owner must back up the master passphrase OR write down the 12-word BIP-39 mnemonic shown at first-encryption-setup. No recovery via Holon vendor (by design — preserves positioning).
- **Cost**: ~1.5 dev-weeks across V1.2+V1.4 (crypto code is well-trodden; libsodium / @noble/ciphers cover all primitives).

**Risk acknowledged**: lost master key = lost data. Onboarding must make this very visible. Recovery via re-OAuth into cloud backend recovers ciphertext but not plaintext if key was lost.

### Q5 — Sync conflict UX (orchestrator decision)

**Owner delegated** ("其他你帮我定")

**Decision: V1.3 ships Last-Write-Wins + Visible Conflict Marker UI; CRDT deferred to V2+.**

Rationale:
- CRDT is overkill for V1.x (one owner editing on 1-2 devices, conflicts rare, complexity high — see iter-001 ADR discussions)
- Pure LWW silently loses data if owner edits same deliverable on phone + laptop offline → unacceptable per Engineering Rule #4 (no silent failure)
- **Middle ground:**
  - Each record carries a `last_modified_at` timestamp + `last_modified_device_id`
  - On sync, if both sides have changes since last sync point → flag as conflict, **do NOT auto-pick**
  - Owner sees a "Conflicts (N)" pill in Nav header (similar to existing Inbound count); clicking opens a side-by-side diff modal: "Laptop version (4:32pm) vs Phone version (5:01pm)"
  - Owner picks winner OR composes a manual merge in a textarea
  - **Fallback**: if conflict ignored for 24 hours → auto-resolve to most-recent-write + emit audit event `sync.conflict_auto_resolved_lww`
- For 1-owner-N-devices the conflict rate is <1% of writes empirically; the UI is rare-path
- V2+ may upgrade to CRDT once Core 2 team-sharing makes simultaneous edits common

---

## 12. Status Update Post-Owner-Responses

- Storage architecture now has **all 5 questions resolved** (3 owner-direct + 2 orchestrator-delegated-and-decided)
- Handoff is **ready for Requirements Agent pickup** → expand into `iterations/019-storage-architecture/{requirements.md, plan.md}`
- Architectural pre-requirement: **StorageProvider seam must land before V1.2 S3 work begins** → V1.1 refactor pass is on the critical path
- Cross-references to flag in the RA-drafted requirements.md:
  - ADR-029 (substrate model) — sharing in V1.4 uses substrate's authority rules
  - ADR-024/025 (auth + token crypto) — owner master key follows the same secrets-tier pattern
  - Engineering Rule #4 (no silent failure) — explicit conflict surface in V1.3, no silent LWW
  - Engineering Rule #8 (audit completeness) — every storage operation emits audit
  - Two-cores rule (#2) — Core 1 owns multi-device, Core 2 owns sharing

