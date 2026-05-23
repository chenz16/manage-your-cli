# Authentication and Identity

Status: draft v0.1
Date: 2026-05-15
Owner: design
Position: Identity, credentials, pairing, and revocation for Holon. Referenced extensively by `peer-communication-architecture.md` (which defers token lifecycle and pairing details here) and by `local-agent-management.md` § 9 (controller authentication).

## 1. Scope

This document specifies how Holon establishes and maintains identity at every level:

- the identity hierarchy (Person → Desk → Connection)
- the three credential types each desk holds and how they are minted
- the initial pairing handshake between desks belonging to different people
- token lifecycle: issuance, refresh, rotation, revocation
- per-connection signing key derivation (HKDF)
- multi-device identity: how one person owns many desks without merging them
- AI controller authentication: how an AI assistant proves it acts on behalf of an owner
- V2 SSO path (swap relay's JWT issuer for external IdP)
- recovery flows: lost device, compromised key, transferred ownership
- threat model and mitigations

What this doc does NOT cover:

- wire format for cross-desk RPC → `peer-communication-architecture.md`
- handoff form taxonomy → `handoff-taxonomy.md`
- DB schema for credentials → `data-model.md` § 4.6 (`connections.signing_key`) and § 4.1 (`desks.device_key_pub`)

**Payment-related identity (V1 posture, per ADR-011).** Holon does not manage payment-related identity in V1. JWT claims (§ 3.2) carry desk identity, capabilities, and pairing state — no billing account, subscription state, or entitlement claims. V2 may add billing identity if a paid tier is introduced; that is deferred to V2 planning.

## 2. Identity Hierarchy

```
Person          (the human / org owning the account)
  ├── Desk #1   (Alice's laptop)
  ├── Desk #2   (Alice's phone)
  └── Desk #N   (Alice's work computer)
                ├── Connection → Bob's primary desk
                ├── Connection → Wang's desk
                └── Connection → Acme Corp admin desk
```

Three levels. Each level has its own identifier, its own credentials, and its own revocation domain.

| Level | Identifier | Credential | Revocation effect |
|---|---|---|---|
| **Person** | `person_<uuidv7>` | (no direct credential; identity is derived from an owned desk's credentials in V1) | Person archived → all owned desks invalidated |
| **Desk** | `desk_<uuidv7>` | Device key pair (Ed25519) + Desk JWT | Desk revoked → all its connections die; person retains other desks |
| **Connection** | `conn_<uuidv7>` | Per-connection HMAC signing key (derived) | Connection revoked → only this peer link dies; both desks otherwise unaffected |

The deliberate choice: identity claims always tie to a specific desk, never directly to a person. This prevents "compromise one device, become Alice everywhere" — each desk is its own bounded compromise blast radius.

## 3. The Three Credentials

Each desk holds three credentials with distinct purposes and lifecycles.

### 3.1 Device Key Pair

- **Type**: Ed25519 (sign + verify; small keys, fast, mature)
- **Generated**: at desk first-run, on-device, never leaves the device
- **Storage**: OS keychain / secure enclave where available (macOS Keychain, Windows DPAPI, iOS Keychain, Android Keystore); falls back to encrypted file at rest
- **Public half**: `desks.device_key_pub` — registered with the Holon relay at desk registration; visible to other desks during pairing
- **Used for**: signing the JWT-issuance request to the relay (proof-of-possession); signing pairing confirmations; signing connection revocation requests
- **Rotation**: on-demand by owner; automatically every 365 days; immediate on detected compromise
- **Lifetime**: indefinite; rotation creates a new key pair, old one is revoked

### 3.2 Desk JWT

- **Type**: JWT signed by the Holon relay using its server key
- **Issued**: by the relay's `/auth/desk/token` endpoint, in response to a request signed by the desk's device private key
- **Claims**:
  ```
  sub:           desk_id
  person:        person_id
  iss:           "holon-relay"   (V2: enterprise IdP)
  capabilities:  [...]            (what this desk can do)
  iat:           issued-at unix timestamp
  exp:           issued-at + 24h
  jti:           unique JWT ID (for revocation)
  ```
- **Storage**: in-memory + secure local cache; never logged
- **Lifetime**: 24 hours
- **Refresh**: silent refresh via refresh token (90-day lifetime, also signed by device key)
- **Used for**: every outbound RPC's `Authorization: Bearer <jwt>` header
- **Revocation**: relay maintains a JWT denylist by `jti`; checked on every relay request; revocations propagate to other desks via SSE

### 3.3 Per-Connection Signing Key

- **Type**: 256-bit symmetric secret (32 random bytes)
- **Derived**: at the moment two desks pair, via HKDF over a shared secret established by ECDH using both desks' device public keys (see § 4)
- **Storage**: encrypted at rest in `connections.signing_key` (column-level encryption with a desk-local data encryption key)
- **Used for**: HMAC-SHA256 signatures on every cross-desk RPC carrying that connection (per `peer-communication-architecture.md` § 6.1)
- **Lifetime**: indefinite until rotated or revoked
- **Rotation**: on-demand by either party; automatically every 180 days; immediate on detected compromise
- **Why HMAC not signature**: per-message digital signatures add CPU cost and bytes; HMAC over the per-connection symmetric key is cheap, mutually agreed, and sufficient for the threat model (relay-mediated traffic + bounded peer set per connection)

## 4. Initial Pairing Handshake

The first time Alice's desk and Wang's desk talk to each other, they must pair. Pairing requires explicit consent from BOTH sides — there is no "anyone with knowledge of your person id can send you missions." This prevents Holon's mission inbox from becoming a spam attractor.

### 4.1 Flow

```
Alice's desk                    Holon relay                    Wang's desk
─────────────                   ───────────                    ───────────
[1] POST /pair/initiate
    { target: <code>,
      myPubKey: <ed25519> }
                ─────────────►
                                [2] Create pairing intent
                                    Push notification to all
                                    of Wang's online desks
                                                    ─────────►
                                                                [3] All Wang's desks
                                                                    show inbound
                                                                    pairing request
                                                                [4] Wang accepts on
                                                                    one device
                                                                    POST /pair/accept
                                                                    { intent: <id>,
                                                                      myPubKey: <ed25519>,
                                                                      signature: <sig> }
                                                    ◄─────────
                                [5] Verify Wang's signature
                                    Compute shared secret via
                                    ECDH(Alice.pub, Wang.priv)
                                    Wait — actually:
                                    Both sides compute ECDH locally;
                                    relay only mediates pubkey exchange.
                                [6] Push pairing-complete to
                                    both sides (with the other's
                                    pubkey + a connection id)
                ◄─────────────                  ─────────►
[7] Compute ECDH shared secret              [7'] Same on this side
    Derive HMAC key via HKDF                     Derive HMAC key via HKDF
    Store connection record                     Store connection record
    Display "Connection established"            Display "Connection established"
```

### 4.2 Target Code

The `target` field in step [1] is HOW the initiator addresses the receiver. Three accepted forms:

- **Personal code** (V1 default): a 12-character base32 code each person can publish (`KQRX-MZJF-PQTV`). Looks human. Stable per person. Person can rotate it.
- **QR code** (V1 mobile): scan a QR generated by the receiver's desk. Encodes `holon://pair?code=<personal-code>`.
- **Direct deep link** (V1 desktop): a URL that opens the prospective receiver's desk and starts the accept flow.

All three resolve to the same `target_person_id` server-side. The receiver's desk decides whether to accept based on:

- the sender's identity (display name, optional ad-hoc note)
- the sender's claimed capabilities
- per-desk policy (auto-accept connections from known orgs in V2)

### 4.3 ECDH Shared Secret

Once both pubkeys are exchanged via the relay, each side independently computes:

```
shared_secret = X25519(my_priv_key, their_pub_key)
```

(Convert Ed25519 keys to X25519 for ECDH — standard practice via `ed25519_to_x25519`.)

The shared secret is identical on both sides without ever traveling over the wire. The relay only sees pubkeys; it cannot derive the shared secret.

### 4.4 HKDF To HMAC Key

```
hmac_key = HKDF-SHA256(
  ikm = shared_secret,
  salt = sorted([alice_desk_id, wang_desk_id]).join(":"),
  info = "holon-connection-hmac-v1",
  length = 32
)
```

Both sides derive the same `hmac_key` because they have the same `shared_secret`, `salt`, and `info`. Stored on each side as `connections.signing_key`.

### 4.5 Connection Record Created

Both sides write a `connections` row (per `data-model.md` § 4.6) and emit `connection_paired` audit event. UI surfaces the new connection in Connections screen.

### 4.6 Why Both Sides Must Confirm

If only the initiator's confirmation were needed, Holon's mission inbox would receive missions from anyone who guessed a personal code (or harvested it from leaked address books). The receiver-side accept step is what makes pairing a deliberate, audit-emitting act.

The accept step also lets the receiver attach connection-level policy: "accept only Direct Order and Advisory forms," "rate-limit to 10 missions/day," "auto-block at first failure." Set during step [4] above.

## 5. Token Lifecycle

### 5.1 Initial JWT Issuance

After pairing or at desk first-run:

1. Desk generates device key pair locally.
2. Desk requests JWT: `POST /auth/desk/token` with body containing `{desk_id, person_id, requested_capabilities}` and a signature using the device private key.
3. Relay verifies signature against the registered `device_key_pub`.
4. Relay mints JWT (24h) and refresh token (90d).
5. Desk caches both; uses JWT for outbound RPCs.

### 5.2 Refresh

Refresh is silent and happens transparently in the background:

1. Desk's HTTP client checks JWT `exp` before each request.
2. If `exp - now < 5 minutes`, kick off refresh.
3. Refresh: `POST /auth/desk/refresh` with `{refresh_token, desk_signature}`.
4. Relay verifies refresh token + signature; issues new JWT (and possibly new refresh token if old is approaching its 90d limit).
5. Desk replaces cached JWT.

If refresh fails (refresh token expired, network down for too long, etc.), the desk transitions to "needs re-auth" state; UI prompts the owner to re-confirm with device biometrics or password.

### 5.3 Rotation Of Device Key

Rotation is owner-initiated or automatic (every 365 days):

1. Desk generates a new device key pair.
2. Desk requests rotation: `POST /auth/desk/rotate-key` signed with the OLD private key, carrying the NEW public key.
3. Relay verifies old signature; updates `desks.device_key_pub` to the new key; emits `key_rotated` event.
4. Old key pair is destroyed locally.
5. New JWTs from this point use the new key for refresh.

Existing per-connection HMAC keys are NOT affected — they were derived from a snapshot of the OLD key during pairing, and rotating the device key does not invalidate them. (If desired, the owner can also rotate connection signing keys separately — see § 5.4.)

### 5.4 Rotation Of Per-Connection Signing Key

Rotation is owner-initiated or automatic (every 180 days):

1. Either desk initiates by sending `holon.connection.rotateKey` with a new ECDH ephemeral pubkey, signed with the current HMAC key.
2. Other side responds with its own ephemeral pubkey, signed with the current HMAC key.
3. Both sides compute new shared secret via ECDH on the ephemeral keys; HKDF to new HMAC key.
4. Both sides update `connections.signing_key` and start using the new key for future signatures.
5. Old key honored for a brief grace period (5 min) so in-flight requests can complete.

If either side fails to participate (e.g., offline), rotation is deferred and surfaces as a UI alert ("connection X needs key rotation; partner offline").

## 6. Revocation

Revocation must propagate fast (seconds, not minutes), be one-sided when needed (Alice can cut off Wang without Wang's cooperation), and be audit-emitting.

### 6.1 Revocation Targets

| Target | Effect | Triggered by |
|---|---|---|
| Desk JWT (`jti`) | This specific token rejected; refresh re-issues a new one | Detected JWT leak; routine token expiry doesn't count |
| Desk (entire) | All JWTs invalidated; all connections from this desk die; refresh tokens revoked; person can no longer use this device | Owner action ("revoke this device"), detected device compromise |
| Connection | Specific peer-link dies; both sides cannot transact further | Either party's owner action |
| Refresh token | Forces re-auth on next refresh attempt | Detected refresh token leak |
| Person (entire) | All owned desks invalidated; all connections die | Account closure |

### 6.2 Revocation Mechanism

1. Owner clicks "revoke" in UI.
2. Desk sends `holon.{desk,connection}.revoke` to relay (signed with device key for desk revocation; HMAC for connection revocation).
3. Relay validates and updates state:
   - For JWT/desk revocation: adds `jti`/`desk_id` to denylist; all subsequent requests from that JWT/desk receive 401.
   - For connection revocation: marks `connections.revoked_at` on the relay's mirror; refuses future relay-mediated traffic on that connection.
4. Relay pushes revocation event via SSE to:
   - the revoking desk (acknowledgment with audit trail)
   - the revoked entity if reachable (so the other side updates its UI immediately)
   - all of the revoking person's other desks (so they all reflect the revocation)
5. Each desk receiving the event updates its local `connections.revoked_at` (if connection-level) or local JWT cache (if JWT-level), and emits a local `connection_revoked` audit event.

### 6.3 Latency Target

End-to-end revocation propagation: p95 ≤ 2 seconds from owner click to remote desk's UI showing "revoked." If the remote desk is offline, revocation is queued at the relay and delivered on next reconnect.

### 6.4 Stolen / Compromised Device

Owner reports a device stolen via any of their other desks:

1. From any other desk, owner navigates to "Devices" and clicks "revoke this device."
2. Triggers a desk-level revocation (per § 6.2).
3. The stolen device's JWT is invalidated immediately; even if the attacker has the device key file, refresh attempts fail.
4. The device key public half is also denylisted at the relay so the attacker cannot use the key to mint a new JWT.

If the attacker had the device key AND the device is online before owner notices, they have until denylisting takes effect (seconds) to act. Mitigation in V2: stronger device binding (hardware attestation), step-up authentication for high-value actions.

## 7. Multi-Device Identity

A person owns multiple desks. The relay maintains a person → desks routing table (per `peer-communication-architecture.md` § 8.1). Identity-relevant facts:

- Each desk has its OWN device key, JWT, and per-connection HMAC keys. None are shared between Alice's laptop and Alice's phone.
- A connection paired by Alice's laptop with Wang is bound to that laptop. If Alice wants Wang to also be reachable from her phone, the phone must pair separately. (V2 may add "person-level connection inheritance" — TBD.)
- The relay knows which desks belong to the same person via the JWT's `person` claim.
- Cross-device routing decisions (UC-1 in `peer-communication-architecture.md` § 2) happen at the relay using the person → desks table; the desks themselves do not need to know each other's existence.

V2 may add per-person credential inheritance: pair once (as a person), available on all your devices. This requires shared key escrow or a per-person master key with derived per-device subkeys. V1 keeps it simple: each desk is its own pairing unit.

## 8. AI Controller Authentication

Per `local-agent-management.md` § 9, a desk may be controlled by a human, an AI assistant, or both (hybrid). The desk's API does not care which — but the API does care WHO sent each request, for audit.

### 8.1 Controller Token

An AI controller requests a Controller Token from the desk owner:

1. Owner installs/configures an AI controller (could be Holon-shipped, third-party, or self-built).
2. Controller's first request prompts owner: "AI controller X requests permission to act on your behalf with these capabilities: [...]". Owner reviews capabilities; approves or modifies scope.
3. Owner-initiated approval issues a Controller Token: a JWT signed by the desk's local key (NOT the relay's), claiming `{sub: controller_id, on_behalf_of: person_id, capabilities: [...], iat, exp}`.
4. Controller uses this token in `Authorization: Bearer <controller_token>` for desk API calls.

The Controller Token is desk-scoped; it does not authorize the controller to mint relay JWTs or interact directly with other desks. Cross-desk traffic always goes through the desk, which adds its own JWT.

### 8.2 Controller Capabilities

The owner specifies which capabilities the controller has:

```
- inbox.triage         (review and accept/reject inbound missions)
- assignments.create   (create new assignments)
- assignments.route    (re-route assignments to staff)
- staff.create         (create new staff — gated additionally by explicit owner UI step per local-agent-management.md § 6)
- staff.update         (modify staff config)
- staff.cultivate      (apply cultivation feedback)
- connections.review   (review connection health, propose pairings — pairing accept always requires human)
- (no capability)      (read-only; controller can advise but not act)
```

Capabilities are enforced at the desk's API boundary. A controller without `assignments.create` getting a 403 cannot work around it.

### 8.3 Controller Lifetime And Revocation

- Controller Tokens have configurable TTL (default: 30 days; high-stakes capabilities: shorter).
- Owner can revoke at any time from the Devices/Controllers screen.
- Controller can request renewal; owner approves or denies.
- Audit log records every controller action with both the controller id AND the person on whose behalf the action was taken.

### 8.4 Multi-Controller (V2)

V2 may allow multiple AI controllers + the human acting concurrently on the same desk. Open questions per `local-agent-management.md` § 14: how do controllers see each other's actions; can controller A grant a sub-scope to controller B; how is the audit trail enriched. Defer to V2.

## 9. V2 SSO

For enterprise V2, the relay's JWT issuer is swapped for an external Identity Provider (IdP) via OIDC.

### 9.1 Changes From V1

- The `iss` claim on the desk JWT becomes the IdP's URL instead of `"holon-relay"`.
- The `sub` claim becomes the IdP's user id; relay maintains a directory mapping IdP-sub → `person_id`.
- Refresh flow moves from relay's own refresh tokens to OIDC refresh tokens.
- Pairing within the same org may auto-accept based on org policy (e.g., "any desk in Acme Corp can pair with any other Acme desk").
- Revocation can be IdP-initiated (de-provisioning a user immediately invalidates their Holon access).

### 9.2 What Stays The Same

- The protocol surface (`peer-communication-architecture.md`) is identical.
- Per-connection HMAC keys still derived via ECDH/HKDF.
- Multi-device routing is identical.
- The desk's device key pair is unchanged.

V2 SSO is a relay configuration change + one new IdP integration adapter; no protocol redesign needed. This is the payoff for keeping V1 identity simple and well-bounded.

## 10. Recovery Flows

### 10.1 Lost Device, Owner Has Other Desks

Per § 6.4. Owner revokes the lost device from another of their desks. Loses no data because the lost device's data was its own copy; other desks have their own.

### 10.2 Lost Device, Owner Has No Other Desks

Owner has only the lost desk. Recovery requires the relay's account-recovery flow:

1. Owner contacts relay support (or self-service flow with strong identity proof).
2. Relay verifies owner identity through out-of-band means (recovery email, phone, security questions — TBD; balance security vs accessibility).
3. Relay creates a new desk record for the owner; owner installs Holon on a new device; pairs with their person account.
4. Old desk's JWTs/keys are revoked.
5. Connections from the old desk are NOT automatically re-paired — the owner must re-pair with each peer.

V1 is intentionally limited: account recovery exists but does not recover data or auto-re-pair. V2 may add backup/restore.

### 10.3 Compromised Connection Signing Key

Either party detects suspicious traffic on a specific connection (replay attempts, signature failures, or out-of-band intel that the other side was breached):

1. Detector revokes the connection (per § 6.2).
2. If still desired, the two parties re-pair from scratch — generating a fresh ECDH-derived signing key.
3. Audit log records the revocation and the re-pairing as separate events.

### 10.4 Compromised Person Account

Worst case: the owner's whole account is compromised. The attacker has either the owner's recovery channel or has obtained credentials for one of the owner's desks AND not been detected yet.

Mitigations are layered:

- Refresh tokens have 90d lifetime → attacker access bounded if owner re-establishes ownership within that.
- Step-up authentication (V2): high-value actions (revoking a device, pairing a new connection, changing recovery channels) require fresh re-authentication.
- Audit log retention forever lets owner reconstruct what attacker did.

## 11. Threat Model

### 11.1 Threats Considered

- **JWT theft from network**: mitigated by HTTPS-only transport.
- **JWT theft from disk**: mitigated by short TTL (24h), refresh-token rotation, OS keychain storage.
- **Device key theft from disk**: mitigated by OS keychain / secure enclave; recovery via revocation if detected.
- **Replay attack within signature window**: mitigated by 5-min replay window + idempotency cache (per `peer-communication-architecture.md` § 9.1).
- **Replay attack outside signature window**: signature verification fails (timestamp out of bounds).
- **Confused deputy** (sender escalates authority via receiver): mitigated by authority attenuation (per `functional-architecture.md` § 7.4) — handoff packet's authority cannot exceed sender's own.
- **Relay compromise**: relay can drop, delay, duplicate messages but cannot forge them (per-connection HMAC keys are only on the desks). Relay can see metadata. Mitigation: V2 E2E encryption on payload bodies.
- **Person-id enumeration**: mitigated by relay-side rate-limiting on pair-initiate calls; personal codes are 60-bit entropy (12-char base32).
- **Pairing intent flooding** (attacker sends thousands of pairing requests to harass a target): mitigated by per-source rate limit; receiver's UI dedups intents per person.

### 11.2 Threats Out Of Scope (V1)

- Quantum-computer attacks on Ed25519/X25519: not threat-modeled until standards converge on post-quantum primitives.
- Side-channel attacks on the device's secure enclave: relies on OS hardening.
- Coercion of the owner: outside of cryptographic scope (a user under coercion may legitimately produce a valid signature).

## 12. Schemas

```typescript
// Defined in @holon/auth-types

export interface DeskJWTClaims {
  sub: DeskId;
  person: PersonId;
  iss: "holon-relay" | string;            // relay URL or IdP URL in V2
  capabilities: Capability[];
  iat: number;                             // unix timestamp
  exp: number;
  jti: string;                             // for revocation
}

export interface ControllerTokenClaims {
  sub: ControllerId;                       // the AI controller id
  on_behalf_of: PersonId;
  desk: DeskId;                            // which desk this controller is on
  capabilities: ControllerCapability[];
  iat: number;
  exp: number;
  jti: string;
}

export type Capability =
  | "handoff.dispatch"
  | "handoff.receive"
  | "handoff.respond"
  | "connection.pair"
  | "connection.revoke"
  | "deliverable.read"
  | "deliverable.write"
  | "audit.read";

export type ControllerCapability =
  | "inbox.triage"
  | "assignments.create"
  | "assignments.route"
  | "staff.create"
  | "staff.update"
  | "staff.cultivate"
  | "connections.review"
  | "audit.read";

export interface PairingIntent {
  id: PairingIntentId;
  initiatorPersonId: PersonId;
  initiatorDeskId: DeskId;
  initiatorPubKey: string;                 // ed25519 base64
  initiatorDisplayName: string;
  targetCode: string;                      // personal code or QR-decoded
  resolvedTargetPersonId: PersonId;
  initiatorCapabilities: Capability[];
  initiatorNote?: string;                  // ad-hoc message to receiver
  expiresAt: string;                       // ISO-8601; intents are short-lived (e.g., 1h)
  status: "pending" | "accepted" | "declined" | "expired";
  acceptedByDeskId?: DeskId;               // which of the receiver's desks accepted
  acceptedPubKey?: string;
}

export interface ConnectionRevocationRequest {
  connectionId: ConnectionId;
  reason: string;                          // free-form; owner-provided
  revokedBy: { kind: "human" | "ai_controller"; id: string };
  signature: string;                       // HMAC over canonical request, using current connection key
  timestamp: string;
}

export interface DeskRotationRequest {
  deskId: DeskId;
  newPubKey: string;                       // ed25519 base64
  signature: string;                       // signed by OLD private key
  timestamp: string;
}
```

## 13. Cross-References

- Pairing surfaces in UI: `ui-architecture.md` § Connections screen
- Connection record persistence: `data-model.md` § 4.6
- Desk record (with `device_key_pub`): `data-model.md` § 4.1
- Audit events for pairing/revocation: `data-model.md` § 4.11 standard event kinds
- Authority attenuation invariant: `functional-architecture.md` § 7.4
- AI controller capability limits: `local-agent-management.md` § 9
- Wire-level signature mechanics: `peer-communication-architecture.md` § 6.1
- Token lifecycle integration with retry layer: `reliability-and-testing.md` (to be written)

## 14. Open Decisions

1. **Personal code entropy / format.** 12-char base32 (60 bits) is enough against random guessing but trivial against a leaked address book. Should personal codes have a per-recipient component (different code shown to different prospective contacts) for better revocation? Adds UX complexity.
2. **Recovery flow specifics.** What out-of-band identity proof is sufficient — recovery email + phone + security questions? Ties into compliance and "lost the device but had no other" UX. Defer to a focused recovery sub-doc.
3. **Connection key rotation cadence.** 180 days proposed; should it be configurable per-connection? Some connections (high-trust, high-volume) might want monthly rotation.
4. **Step-up authentication scope.** Which actions require fresh auth (re-confirming biometrics or password) beyond ambient JWT? Proposal: revoking a device, adding a new controller, exporting cultivation profiles, sending Direct Order to managed subordinates.
5. **Relay compromise containment.** V1 accepts that a compromised relay sees metadata and can DoS but cannot forge. Should V1 add envelope-level encryption (E2E for the body) at the cost of relay losing ability to inspect for abuse detection? V2 question, but the architectural decision affects audit-side reasoning.
6. **Multi-controller (V2) authentication model.** When N controllers + human all act on the same desk, do controllers see each other's tokens? Can controllers grant scoped tokens to other controllers (delegation chain)?
7. **OIDC mapping for V2 SSO.** If the IdP changes a user's email/sub, how does Holon track person continuity? Probably immutable Holon-internal `person_id` with a sub-mapping table.
8. **Refresh token storage location.** Same OS keychain as the device key, or a separate vault? Same keychain is simpler; separate vault adds defense in depth.

## 15. Acceptance Criteria

This spec is "implementation-ready" for V1 when:

1. ✅ All three credential types are specified (key type, lifetime, storage, rotation, revocation)
2. ✅ Pairing handshake is fully described with both protocol flow and crypto derivation
3. ✅ JWT lifecycle (issue, refresh, rotate, revoke) is concrete
4. ✅ Per-connection signing key derivation (ECDH + HKDF) is reproducible
5. ✅ Revocation propagation has a latency target and mechanism
6. ✅ AI controller authentication is specified with capability enumeration
7. ✅ Multi-device identity story is consistent with `peer-communication-architecture.md` § 8
8. ✅ V2 SSO migration path is sketched without protocol changes
9. ✅ Threat model enumerates considered threats and mitigations
10. ✅ Recovery flows cover the three common cases (lost device with backup, lost device without backup, compromised connection)
11. ⬜ Reference implementation of pairing handshake passes a crypto conformance test (verify in M2)
12. ⬜ Revocation propagation latency p95 ≤ 2s in load test (verify in M3)
13. ⬜ Controller token enforcement passes deny-by-default audit (verify in M2)
