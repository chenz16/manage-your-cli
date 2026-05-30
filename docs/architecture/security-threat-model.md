# Security Threat Model

Status: draft v0.1
Date: 2026-05-15
Owner: design + security
Position: Consolidates the threats and mitigations scattered across `auth-and-identity.md` § 11, `peer-communication-architecture.md` § 14, `handoff-taxonomy.md`, and `reliability-and-testing.md`. The single document a security reviewer reads to understand Holon's posture.

## 1. Scope

Threats we model:

- adversaries on the network between desks
- adversaries with access to the cloud relay
- adversaries with access to a single compromised desk
- adversaries who have stolen a credential
- adversaries on a peer desk that's been paired in good faith
- accidental owner mistakes that have security consequences

Out of scope (V1):

- nation-state adversaries with full physical / supply-chain access
- quantum-computer attacks (no post-quantum primitives until standards converge)
- side-channel attacks on OS keychains / secure enclaves (relies on OS hardening)
- coercion of the human owner (a coerced legitimate user produces legitimate signatures)

## 2. Trust Boundaries

```
   ┌─────────────────────────────────────────────┐
   │  Owner's device (TRUSTED)                   │
   │  ┌──────────────────────────────────────┐   │
   │  │  Holon desk app                      │   │
   │  │  - has device key (in OS keychain)   │   │
   │  │  - has desk JWT (in memory + cache)  │   │
   │  │  - has connection signing keys       │   │
   │  └──────────────────────────────────────┘   │
   │            ↕ HTTPS (TLS) + HMAC             │
   └────────────┼─────────────────────────────────┘
                │
                ↕  (untrusted network — TLS protects in-flight)
                │
   ┌────────────┼─────────────────────────────────┐
   │  Cloud relay (SEMI-TRUSTED)                 │
   │  - sees envelopes; cannot forge signatures   │
   │  - holds JWT denylist                        │
   │  - routes person → desks                     │
   │  - holds idempotency cache                   │
   │  - V2: blind to encrypted bodies             │
   └────────────┼─────────────────────────────────┘
                │
                ↕  (untrusted network)
                │
   ┌────────────┼─────────────────────────────────┐
   │  Peer's device (TRUSTED-FOR-CONTRACT)       │
   │  - we trust them to honor handoff form       │
   │  - we don't trust them with anything beyond  │
   │    the context pack we sent                  │
   └─────────────────────────────────────────────┘
```

Trust gradient:
- **Owner's device**: trusted with the owner's keys and data (the owner manages it).
- **Peer's device**: trusted to perform what the handoff contract specifies, no more.
- **Cloud relay**: trusted for routing/availability; not trusted with payload contents (V2 E2E).
- **Network**: untrusted; rely on TLS + per-message HMAC.

## 3. Threat Catalog

Each threat: name, attacker capability, what they could achieve, mitigation, severity (Critical / High / Medium / Low).

### 3.1 Network-level threats

#### T01 — Passive eavesdropping

- **Attacker**: monitors network traffic between desks and relay
- **Achievement**: read handoff payloads, deliverables, audit events
- **Mitigation**: HTTPS / TLS 1.3 mandatory for all traffic. V2: end-to-end encrypted payload bodies (relay sees envelopes only).
- **Severity**: Medium (TLS is mature; V2 E2E closes residual relay-vis risk)

#### T02 — Active man-in-the-middle (TLS stripping)

- **Attacker**: intercepts and modifies traffic
- **Achievement**: alter handoff payloads in flight
- **Mitigation**: TLS 1.3 enforced; HSTS preload; certificate pinning for relay (V2). HMAC signature on every cross-desk RPC verifies tamper-detection at the application layer (TLS-independent).
- **Severity**: Low (TLS + HMAC layered defense)

#### T03 — Replay attack

- **Attacker**: captures a valid signed request and replays it later
- **Achievement**: duplicate effects (e.g., send the same mission twice)
- **Mitigation**: 5-minute replay window enforced by signature timestamp; idempotency cache keyed by `(senderDeskId, requestId)` for 24h returns cached response on replay.
- **Severity**: Low (mitigation is structural)

### 3.2 Credential theft

#### T04 — JWT theft from network

- **Attacker**: captures a desk's JWT in transit
- **Achievement**: impersonate the desk for the JWT's lifetime (max 24h) until refresh
- **Mitigation**: HTTPS-only (T01 mitigation). Short JWT lifetime (24h). Revocation push via SSE (≤ 2s) per `auth-and-identity.md` § 6.3.
- **Severity**: Medium (24h exposure is bounded; mitigation requires owner detection)

#### T05 — JWT theft from disk

- **Attacker**: gains read access to the desk's local storage
- **Achievement**: same as T04
- **Mitigation**: JWT stored in OS keychain / secure enclave where available; encrypted file at rest as fallback. Same revocation path as T04.
- **Severity**: Medium

#### T06 — Device key theft

- **Attacker**: gains the desk's Ed25519 private key
- **Achievement**: mint new JWTs indefinitely (until detected and revoked)
- **Mitigation**: Device key stored in OS keychain / secure enclave (hardware-backed where possible). On detection, owner revokes the device per `auth-and-identity.md` § 6.4 — relay denylists the device key public half so no further JWTs can be minted.
- **Severity**: High (full impersonation possible until revocation)

#### T07 — Per-connection signing key theft

- **Attacker**: gains a connection's HMAC signing key
- **Achievement**: forge HMAC signatures on that specific connection's traffic
- **Mitigation**: Encrypted at rest (column-level encryption in DB). Owner-initiated key rotation per `auth-and-identity.md` § 5.4. Auto-rotation every 180 days.
- **Severity**: Medium (scope limited to one connection)

#### T08 — Refresh token theft

- **Attacker**: captures the refresh token (90d lifetime)
- **Achievement**: re-mint JWTs for up to 90 days even after the original JWT expires
- **Mitigation**: Refresh token bound to device key (refresh request must be signed by device key). If device key is also stolen, revocation per T06 chain. Force re-auth if refresh denied.
- **Severity**: High when combined with T06; Low otherwise

### 3.3 Authority and authorization threats

#### T09 — Confused deputy

- **Attacker**: low-authority sender uses a high-authority receiver to perform actions the sender couldn't perform alone
- **Achievement**: bypass authority constraints by going through a privileged receiver
- **Mitigation**: Authority attenuation per `functional-architecture.md` § 7.4. Receiver desks check that handoff packet's authority does not exceed sender's own authority before executing. Detected violations emit `HANDOFF_AUTHORITY_INSUFFICIENT` per `reliability-and-testing.md` § 3.1.
- **Severity**: High (capability-confusion class; structural mitigation required)

#### T10 — Sub-handoff scope creep

- **Attacker**: receiver of a Subcontracting handoff sub-delegates beyond the disclosed plan
- **Achievement**: hidden network of sub-handoffs the original sender never approved
- **Mitigation**: Per-form sub-delegation policy enforced at protocol layer per `handoff-taxonomy.md` Axis 6. Sub-handoffs above the disclosed count require sender re-approval. Audit logs every sub-handoff.
- **Severity**: Medium

#### T11 — AI controller capability escalation

- **Attacker**: AI controller with limited capabilities tries to perform actions outside its scope
- **Achievement**: act as the owner with broader privileges
- **Mitigation**: Capability-based access control on every desk API method. Controller token claims explicitly enumerate capabilities per `auth-and-identity.md` § 8.2. 403 on capability mismatch.
- **Severity**: Medium

#### T12 — Authority hash tampering

- **Attacker**: modifies a stored handoff's axes or authority scope post-creation
- **Achievement**: retroactively change what was agreed
- **Mitigation**: `axes_hash` (SHA-256 of canonical axes) stored at handoff creation per `handoff-taxonomy.md` § "Tamper Detection" + `data-model.md` § 4.7. Every read recomputes and verifies. Mismatch emits critical security event `HANDOFF_AXES_HASH_MISMATCH` per `reliability-and-testing.md` § 3.1.
- **Severity**: High (defeats post-hoc accountability if not caught)

### 3.4 Relay / infrastructure threats

#### T13 — Compromised relay

- **Attacker**: gains control of the cloud relay
- **Achievement**: drop, delay, duplicate messages; inspect envelopes (V1) and bodies (V1; V2 mitigates); deny service
- **Mitigations**:
  - Cannot forge signatures (per-connection HMAC keys are only on desks)
  - Cannot mint JWTs without server signing key (separate trust boundary)
  - Cannot read bodies in V2 (E2E encryption)
  - Operator-side: relay logs are immutable; relay code is audited; deployment chain is hardened
- **Severity**: Critical (V1 with body access); High (V2 with E2E); the broader DoS / metadata-leak surface is structurally hard to fully mitigate
- **Detection**: cross-desk audit-log discrepancies — sender's outbound log and receiver's inbound log can be cross-referenced

#### T14 — Relay routing table tampering

- **Attacker**: modifies the relay's person → desks routing table
- **Achievement**: misroute missions; route to attacker-controlled desk; suppress delivery
- **Mitigation**: Relay-internal access controls; immutable audit on routing table changes; cross-validation by desks (a desk that receives a mission can verify it was intended for it via the handoff packet's `toConnection`).
- **Severity**: High

#### T15 — Pairing intent flooding

- **Attacker**: sends thousands of pairing requests to one person
- **Achievement**: spam the receiver's pairing inbox; possibly social-engineer acceptance
- **Mitigation**: Per-source rate limit at relay (default 10 pairing intents per source per hour). Receiver UI dedups intents per source person. After N declines from a source, auto-block per session.
- **Severity**: Low (annoying; not breaking)

#### T16 — Person-id enumeration

- **Attacker**: tries to enumerate person identifiers to find pairing targets
- **Achievement**: build a directory of users
- **Mitigation**: Personal codes are 60-bit entropy (12-char base32) — not enumerable. The only exposed identifiers are randomly-generated UUIDs (not enumerable). Person → desks routing table is relay-internal and not query-able by external parties.
- **Severity**: Low

### 3.5 Peer / contract threats

#### T17 — Hostile peer (paired in good faith, then turns adversarial)

- **Attacker**: a desk that successfully paired with the victim and then begins to misbehave (sends malformed packets, attempts authority escalation, overshares context, etc.)
- **Achievement**: various, depending on what the victim trusts them with
- **Mitigation**:
  - Receiver-side validation refuses malformed packets (per `reliability-and-testing.md` § 7.7 adversarial tests)
  - Authority attenuation (T09)
  - Per-connection rate limits
  - Owner can revoke any connection at any time (≤ 2s propagation per T04 mitigation chain)
  - Audit log records every interaction for post-hoc review
- **Severity**: High (the most likely real-world attack profile)

#### T18 — Hostile peer triggers cascading work

- **Attacker**: paired peer sends a handoff that, when processed by the receiver's automated pipelines, causes cascading sub-handoffs (e.g., autonomous staff fan-out)
- **Achievement**: amplification attack on receiver's resources or downstream peers
- **Mitigation**: Per-form sub-delegation budget per `handoff-taxonomy.md` Axis 6. Per-staff `max_concurrent_jobs`. Owner-mediated authority on inbound (per `functional-architecture.md` § 7.2) means autonomous fan-out is a deliberate owner choice, not an automatic consequence.
- **Severity**: Medium

#### T19 — Hostile peer in a multi-hop chain

- **Attacker**: middle hop in an A → B → C cascade that misrepresents to either A or C
- **Achievement**: insert false claims; alter deliverables; act with delegated authority beyond what A intended
- **Mitigation**: Each hop's audit log is independent; cross-desk audit reconciliation can detect misrepresentation. Authority attenuation enforced at each hop. Disclosure level controls what info each hop reveals.
- **Severity**: Medium (structural mitigation requires post-hoc audit)

### 3.6 Internal / accidental threats

#### T20 — Owner accidentally reveals personal code

- **Attacker**: anyone who learns the personal code through accidental disclosure (screenshot, OCR'd photo, leaked address book)
- **Achievement**: can initiate a pairing intent
- **Mitigation**: Pairing requires receiver-side confirmation per `auth-and-identity.md` § 4.6 — code alone is not sufficient. Per-recipient personal codes (open decision in auth-and-identity § 14 #1) would further mitigate.
- **Severity**: Low (pairing handshake remains gated)

#### T21 — Owner approves a malicious handoff form unknowingly

- **Attacker**: hostile peer constructs a handoff with form chosen to exploit the owner's misunderstanding of consent UI
- **Achievement**: trick owner into accepting more authority than intended
- **Mitigation**: UI consent flow per `handoff-taxonomy.md` § "UI Consent Flow Per Form" is form-aware and surfaces implications in plain language. Owners are educated on form types via in-app explanations.
- **Severity**: Medium (depends on UX clarity)

#### T22 — AI controller turns adversarial (model-level adversary)

- **Attacker**: AI controller with valid token starts performing actions optimizing for goals other than the owner's
- **Achievement**: misuse of granted capabilities up to the controller's scope
- **Mitigation**: Capability-bounded scope per T11 mitigation. All controller actions audit-logged with controller identity. Owner can pause controller instantly. Step-up authentication (V2) gates high-value actions. Audit log review.
- **Severity**: Medium (scope-limited; detection-bounded)

#### T23 — Compromised dependency (CLI binaries / Node modules / system packages)

- **Attacker**: malicious code injected into a dependency
- **Achievement**: arbitrary execution within the desk process; access to keys and data
- **Mitigation**:
  - Dependency pinning + lockfiles
  - The user's CLI binaries (`claude`, `codex`, `gemini`, `qwen`) are installed by the user from their official vendors; `manage-your-cli` does not vendor them. *Sister-repo lineage: an earlier mitigation treated Hermes as a vendored upstream at `deps/hermes` — N/A here, no Hermes dependency.*
  - SBOM tracking (V2)
  - Renovate / Dependabot for known CVEs
- **Severity**: High (supply-chain attacks are a real and growing threat)

### 3.7 Operational threats

#### T24 — Disk full / DoS via storage exhaustion

- **Attacker**: peer sends large packets, file uploads, repeated handoffs
- **Achievement**: fill receiver's disk; halt operation
- **Mitigation**: Per-packet size limit (1 MB inline, larger by-reference); per-connection rate limit; per-deliverable size cap (500 MB); per-context-pack size cap (10 MB); storage-quota check on every write per `reliability-and-testing.md` § 4.5.
- **Severity**: Medium

#### T25 — Audit log tampering

- **Attacker**: with DB write access, modifies historical audit events
- **Achievement**: erase evidence of past actions; rewrite history
- **Mitigation**: Application-layer revoke of UPDATE/DELETE on `audit_events` table per `data-model.md` § 4.11. V2: append-only storage backend (e.g., S3 Object Lock) for high-compliance customers. V2: signed audit records.
- **Severity**: High (defeats post-hoc accountability)

#### T26 — Cloud relay key compromise

- **Attacker**: gains the relay's JWT signing key
- **Achievement**: mint arbitrary JWTs for any desk
- **Mitigation**: Key stored in HSM or KMS in production. Key rotation procedure documented. JWT verification can validate against multiple acceptable signing keys during rotation period. Detection via: anomalous JWT issuance patterns; cross-validation by desks.
- **Severity**: Critical

## 4. STRIDE Coverage

| STRIDE category | Holon threats covered |
|---|---|
| **Spoofing** | T04, T05, T06, T08, T13, T26 |
| **Tampering** | T02, T12, T13, T14, T17, T25 |
| **Repudiation** | T12, T19, T25 (mitigated by audit completeness) |
| **Information disclosure** | T01, T13, T16, T17 |
| **Denial of service** | T15, T24 |
| **Elevation of privilege** | T09, T10, T11, T18, T22, T23 |

## 5. Mitigation Layer Map

Where in the stack each mitigation lives:

| Layer | Mitigations |
|---|---|
| Transport (TLS) | T01, T02 partial |
| Wire protocol (HMAC, replay window, idempotency) | T02, T03 |
| Auth (JWT, device key, rotation, revocation) | T04–T08, T26 |
| Handoff layer (form, axes_hash, authority attenuation) | T09, T10, T12, T17 |
| Routing layer (rate limit, sub-delegation budget) | T15, T18, T24 |
| Storage (encryption at rest, append-only audit) | T05, T07, T25 |
| UI (consent flows, controller pause) | T21, T22 |
| Operations (HSM, audit immutability) | T13, T26 |
| Process (dependency pinning, vendor) | T23 |

## 6. Detection Catalog

Mitigation prevents; detection catches what slipped through.

| Detection | What it catches |
|---|---|
| `holon_invariant_violations_total > 0` | Any code path that violates a declared invariant — should never fire in production |
| `holon_wire_signature_failures_total` spike | Active attack (replay attempts, key compromise) or clock-skew issue |
| `HANDOFF_AXES_HASH_MISMATCH` event | Tampering with stored handoff |
| `HANDOFF_AUTHORITY_INSUFFICIENT` event | Confused-deputy attempt |
| Cross-desk audit reconciliation diff | Relay tampering or misrouting |
| Pairing intent rate spike | Flooding attack |
| Anomalous JWT issuance pattern | Relay key compromise |
| Connection health rapid state-thrashing | Hostile peer or network attack |

All detection events route to the audit bus; critical-severity events page on-call (V2 ops integration).

## 7. Compliance Posture

V1: foundation-only. V2 / V3 may target specific certifications.

| Standard | V1 readiness | V3 target |
|---|---|---|
| **SOC 2 Type II** | partial — audit completeness + access controls present; formal certification requires operational maturity | yes |
| **GDPR** | basic — data minimization, owner-controlled storage, audit trail | full — right-to-access, right-to-erasure, data-residency options |
| **HIPAA** | not targeted V1 | possible V3 with E2E encryption + BAAs |
| **FedRAMP** | not targeted V1 | possible V3 for government deployments |
| **ISO 27001** | not targeted V1 | possible V3 |

Per `roadmap-mvp-to-enterprise.md` § 5, compliance certifications are V3 work and depend on enterprise customer profiles.

## 8. Security Reviewer Checklist

For someone reviewing Holon's security posture:

1. ✓ All threats in this document have at least one mitigation listed
2. ✓ All mitigations link to a spec section that defines them
3. ✓ Detection catalog has at least one detection per Critical-severity threat
4. ✓ Audit log can reconstruct system state from a known starting point (per `functional-architecture.md` § 7.5)
5. ✓ All sensitive fields (signing keys, refresh tokens, deliverable contents) are excluded from logs
6. ✓ The runtime adapter does not leak adapter-specific types upward (per `runtime-adapter-interface.md` § 2 principle 6)
7. ✓ Forward-compatibility: V2/V3 security additions (E2E encryption, hardware attestation, SSO) layer on without breaking V1
8. ⬜ Annual security review (V2)
9. ⬜ Bug bounty program (V2)
10. ⬜ Independent penetration test (V3)

## 9. Open Decisions

1. **E2E encryption activation timing.** When does V2 ship E2E? Tied to specific customer needs vs ambient feature.
2. **Per-recipient personal codes.** Should personal codes be per-prospective-contact (different code per recipient), better for revocation? Adds UX complexity.
3. **Bug bounty scope.** When V2 launches publicly, what's in scope? Affects mitigation depth required.
4. **Quantum-resistant primitives.** Watch the standards space; plan transition timeline once NIST settles on PQC.
5. **Hardware attestation in V3.** TPM / Secure Enclave attestation for high-trust deployments — what's the threshold (which connections require it)?
6. **Compromised dependency response.** Standard process for SBOM scanning + emergency patch release. V2.
7. **Cross-desk audit reconciliation tooling.** A dedicated audit-diff tool for detecting relay misbehavior. V2.

## 10. Cross-References

- Auth specifics: `auth-and-identity.md` § 11 (the source of T04–T08, T20, T26 mitigations)
- Wire protocol security: `peer-communication-architecture.md` § 14
- Handoff form security implications: `handoff-taxonomy.md` § Axes 1, 5, 6
- Runtime adapter authority enforcement: `runtime-adapter-interface.md` § Error Model
- Audit completeness: `functional-architecture.md` § 7.5
- Error handling and detection: `reliability-and-testing.md`
- Compliance phasing: `roadmap-mvp-to-enterprise.md` § 5
