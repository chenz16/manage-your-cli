# ADR: Unified connection model (text surface · one-time connection registry · pluggable transport adapters)

Status: **Accepted** (2026-05-24). Supersedes the ad-hoc split between "connectors", "A2A peers", "WeChat bridge", and "MCP plugins" — they are all one thing: **connections**.

## Context

We kept inventing separate models for "things the desk connects to": MCP plugins, A2A peers, the WeChat/iLink bridge, and (future) OpenClaw / custom protocols. Each risked its own bespoke UI, storage, and establishment flow — and risked asking the user to set the same connection up more than once (e.g. once on the desk, again on mobile).

Owner's insight (verbatim spirit): *"All agents are ultimately text transport. The protocol underneath (OpenClaw, a custom one) is customizable. Establishing a connection is something the user does ONCE — never twice. A dropped-off file is just an address."*

## Decision — three layers

```
TOP    (user-facing)   everything is TEXT: messages + file ADDRESSES (URLs). One surface,
                       regardless of who/what is on the other side. The Secretary is the
                       common endpoint. (Files are passed as URIs/addresses, never raw bytes
                       — matches A2A FilePart-with-URI and WeChat's CDN URLs.)
MIDDLE (connection)    a PERSISTED "connections registry". A connection is ESTABLISHED ONCE
                       (a handshake that exchanges the other side's address/identity/token),
                       then stored and reused forever. The user never re-establishes.
BOTTOM (transport)     pluggable ADAPTERS: A2A, WeChat/iLink, OpenClaw, custom — each speaks
                       its wire protocol and carries text/JSON. Adding a protocol = adding an
                       adapter; TOP and MIDDLE do not change.
```

### Establishment (the MIDDLE layer), done ONCE — but the METHOD depends on the adapter
- **Remote A2A** (agents on other machines): one-time handshake = paste the other side's **agent-card URL**, or scan/upload a **QR code** that encodes that address ("scan to add", generically). Lower trust → identity is verified.
- **WeChat channel**: bound via **Tencent's WeChat QR** (Tencent-issued, WeChat-app-only, relay-mediated) — used ONLY by the WeChat adapter, cannot be repurposed for arbitrary agents.
- **Local peer-to-peer** (agents/desks on the **SAME machine**): **special and the simplest case** — transport is **loopback (127.0.0.1) JSON-RPC, no network, no relay**; trust is implicit (same machine = same trust domain, **no identity verification, no QR, no external URL**); establishment is **local discovery / loopback pairing**, and can be **automatic** (near-zero manual steps). This is `[[project_holon_share_desk]]`'s single-machine N-desk interconnect.
- **The remote QR is OUR generic QR** (encodes the agent-card URL), distinct from Tencent's WeChat QR. Local P2P needs no QR at all.
- Established connections are **persisted on the DESK** (address/token). The **mobile (微作) is a thin client that inherits and uses the desk's connections** — it never re-establishes. ⇒ the user sets up each connection exactly once, on the desk, and it works everywhere.

### Optional control plane (only when tracking work)
On top of the text-message surface, a **task** layer adds lifecycle (submitted → working → completed/failed), cancel, and progress — used only when delegating trackable work. It is itself just structured text/JSON. Plain "message + file-address" needs none of it.

## Mapping (everything is a connection)
| Today's name | = a connection with adapter | Establish once via |
|---|---|---|
| MCP plugin | stdio/remote MCP adapter | install/enable (registry) |
| A2A peer | A2A adapter | their agent-card URL / your generic QR |
| WeChat bridge | iLink adapter | Tencent WeChat QR (WeChat-only) |
| OpenClaw / custom | future adapter | adapter-specific |

## Consequences
- One mental model + one storage (the connections registry) for all external links.
- Pluggable protocols: new integrations = a new bottom-layer adapter; no churn above.
- **One-time establishment**, persisted on the desk, inherited by mobile — never twice.
- A unified text(+file-address) message surface; the Secretary is the single endpoint; `task` is the opt-in control layer.
- WeChat is just one adapter (Tencent-QR bound); A2A is the default agent↔agent adapter (generic-QR/URL bound).

See also: `docs/adr/connectors-vs-plugins.md`.
