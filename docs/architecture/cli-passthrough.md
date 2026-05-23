# CLI Passthrough — tmux-Backed Sessions for CLI Staff

Status: draft (iter-008 phase 1 implementation status)
Date: 2026-05-16
Author: Requirements Agent
Position: Sibling of `owner-assistant-tools.md`, `worker-dispatcher.md`,
and `owner-config-service.md`. Documents the substrate-level surface
that lets the owner (and the owner_assistant) **see through to** a CLI
staff's running shell — the "monitor anytime, anywhere" affordance
per the 2026-05-16 user directive 本地也可以直接 access 我的 app 也
可以 access 就是透彻. Sits under `local-agent-management.md` § 5.2
(the `cli` substrate kind).

## 1. What This Doc Covers

The end-to-end path that backs the in-browser xterm panel and the
secretary's `cli_exec` tool (per `owner-assistant-tools.md` § 5.7):
the tmux session model, the five BFF endpoints, the xterm.js
dynamic-import SSR lesson, the transparency story (local +
multi-attach), and the open question on remote substrates.

NOT covered: the `cli_exec` tool surface itself (see
`owner-assistant-tools.md` § 5.7); the form-based CLI staff creation
flow (see `local-agent-management.md` § 6).

## 2. Architecture Overview

```text
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ Browser xterm panel          │      │ Owner's local terminal       │
│ apps/web/.../CliTerminal.tsx │      │ $ tmux a -t holon-<staff_id> │
│ (dynamic import, SSR off)    │      │ (parallel attach; no proxy)  │
└──────────────┬───────────────┘      └──────────────┬───────────────┘
               │ SSE + POST                          │ direct PTY
               ▼                                     │
┌───────────────────────────────────────────────────┐│
│ BFF: /api/v1/staff/:id/cli/{launch,input,stream,  ││
│      exec} + GET/DELETE on the root               ││
│ Thin shells over @holon/core/cli-session-service  ││
└──────────────┬────────────────────────────────────┘│
               ▼                                     │
┌───────────────────────────────────────────────────┴┐
│ @holon/core/cli-session-service                    │
│ - tmux new-session -d -s holon-<staff_id> …        │
│ - pipe-pane -O 'cat > <fifo>' for stream capture   │
│ - send-keys for input                              │
│ - 64 KB rolling scrollback per session             │
│ - globalThis.__holonCli singleton (Map<id,Session>)│
└──────────────┬─────────────────────────────────────┘
               │  spawnSync('tmux', …)
               ▼
┌────────────────────────────────────────────────────┐
│ tmux server (system-installed)                     │
│ Session: holon-<staff_id>;  pane: exec bash -l -i  │
│ Survives Node restarts; tail re-attaches on demand │
└────────────────────────────────────────────────────┘
```

Per the directive, **the browser panel and the local tmux attach are
coequal**. Neither proxies the other; both are tmux clients hanging
off the same session. This is the 透彻 property — switch terminals,
close the laptop, reattach elsewhere without losing pane state.

## 3. The Five Endpoints

All live under `apps/web/app/api/v1/staff/[id]/cli/`. Implementations
are thin shells; substantive code is in
`packages/core/src/cli-session-service.ts`.

| Endpoint | Method | Backing service | Purpose |
|---|---|---|---|
| `/cli/launch` | POST | `launchCliSession` | Start session if not running. Idempotent (`already_running: true` on second call). Returns `local_attach_cmd` for the toolbar clipboard button. |
| `/cli/input` | POST | `sendKeys` | Send keystrokes. `withEnter` defaults true; xterm uses false for char-by-char. |
| `/cli/stream` | GET (SSE) | `subscribeOutput` | Replays rolling scrollback on subscribe, then live-streams every tmux pane chunk until disconnect. |
| `/cli` | GET | `getCliStatus` | Cheap probe: running bool, subscriber count, buffer size, tmux name, local_attach_cmd. Drives the /members card badge. |
| `/cli` | DELETE | `killCliSession` | Owner-initiated kill of session + tail process. Re-launching yields a fresh shell. |
| `/cli/exec` | POST | composite | One-shot: launch-if-needed → `sendKeys` → wait `wait_ms` → return last ≤8 KB. Backs the secretary's `cli_exec` tool (ADR-021). |

### 3.1 Why Five Endpoints, Not One Websocket

SSE + POST is **proxy-friendly** (no upgrade handshake; works through
every dev-server / Tauri / Cloudflare layer we expect — Engineering
Rule 10's worst-case page-load failure mode beats trailing keystroke
latency); each endpoint is **independently auditable** (`cli.launched`,
`cli.input`, `cli.killed` are distinct Rule-8 audit lines per
ADR-007; a websocket would invent a sub-protocol to reproduce this);
and the status (GET) and kill (DELETE) probes are cheap cross-cutting
calls the /members UI uses without opening a stream.

### 3.2 Audit Posture

`launchCliSession`, `sendKeys`, and `killCliSession` each emit a
structured stdout audit line **after** the state change (per ADR-007
V1 post-emit posture):

```
{ audit: "cli.launched", staff_id, tmux, binary_hint, ts }
{ audit: "cli.input",    staff_id, bytes, with_enter, ts }
{ audit: "cli.killed",   staff_id, ts }
```

Subscribe and status (reads) are not audited.

## 4. The xterm.js Dynamic-Import SSR Lesson

`CliTerminal.tsx` imports `xterm` and `xterm-addon-fit`. Both
packages reference `self` (the browser window) at module top level,
not lazily. Next.js's RSC pre-render therefore crashes at import time
with `ReferenceError: self is not defined` when SSR'ing `/members`.

`'use client'` alone is **not** the fix — the boundary marker still
lets the import resolve during server analysis. The right fix:

```tsx
// MembersClient.tsx
const CliTerminal = dynamic(
  () => import('./CliTerminal').then((m) => m.CliTerminal),
  { ssr: false }
);
```

`{ ssr: false }` tells Next to skip the server render. The first
browser render is when the import chain — and the `self` reference
— first executes. Failure mode is **silent in dev** (cryptic stack
trace at the bottom of the build log; page still hydrates after the
error scrolls off), and the obvious React fix does not address it.
Same shape as the `ChatRuntimeProvider` nav lesson recorded in
`owner-assistant-tools.md` § 10.8.

## 5. Transparency Story — Local + Multi-Attach

The owner's tmux session is **not** a sandbox the BFF owns; it is a
shared resource between the BFF and the owner.

| Attach path | Who | Read | Write | Notes |
|---|---|---|---|---|
| Browser xterm panel | owner, in /members | yes (SSE) | yes (POST /input) | Default surface. |
| Local `tmux a -t holon-<id>` | owner, on the host | yes (PTY) | yes (PTY) | First-class peer. Surfaced via the `📋 tmux attach` clipboard button. |
| Secretary's `cli_exec` | LLM, on owner's behalf | yes (8 KB tail) | yes (`send-keys`) | Wraps the same primitives; auto-launches if dormant. See ADR-021. |
| Mobile / multi-browser | any tab with the URL | yes | yes | Multi-attach for free. No per-tab auth in V1. |

Three Engineering-Rule implications:

- **Rule 6 (owner-mediated authority).** Every write path is owner-
  triggered (xterm input, local PTY, owner-issued chat turn the
  secretary translates into `cli_exec`). No external peer or
  delegate_task sub-agent can reach the tmux session — those paths
  do not import `cli-session-service`.
- **Rule 4 (no silent failure).** All five public functions return
  `{ ok: false, reason }` on failure (`staff_not_found`, `no_session`,
  `tmux new-session failed: …`). xterm renders inline; the secretary
  surfaces as a chat error per ADR-021.
- **Rule 8 (audit after state change).** Audit emit lives in the
  service, not the route handlers, so every entry point (browser,
  exec wrapper, future test harness) gets the same record.

## 6. Open Questions

1. **Remote substrate `endpoint_url`.** Today every CLI session is
   localhost. The CLI substrate (`local-agent-management.md` § 5.2)
   hints at a future `endpoint_url` so a CLI staff can wrap a shell
   on another machine. tmux does not generalise — we would need
   SSH-multiplex or a relay. Out of scope for V1; flag so the next
   pass knows the shape that has to break. ADR-020 § "Alternatives"
   B is the leading candidate.
2. **Per-attach authentication.** V1 assumes any browser tab pointed
   at `/members?cli=<id>` is owner-trusted (single-user desktop per
   ADR-005). Multi-user / shared-desk needs per-attach tokens;
   couples with auth-and-identity.
3. **Scrollback ceiling.** 64 KB rolling buffer (`MAX_BUFFER_BYTES`).
   Live `htop` or streaming log tails lose history for late
   joiners. V2 fix is tmux's own `capture-pane` instead of fifo
   tailing.
4. **Kill semantics on dismiss.** `dismiss_staff` (ADR-019) rejects
   non-`local_ai` substrates, so CLI dismissal from chat is blocked
   today. When that opens (ADR-019 Open Q 1), the dismiss path must
   call `killCliSession` or orphan the pane. Flag for iter-009.
5. **Tail-process leak on Node restart.** The `cat <fifo>` child is
   per-Node-process; hot-reload resets the singleton and spawns new
   tails against the same fifo. Old `cat` processes hang around
   until the fifo unlinks. Cheap in dev; flag for prod.

## 7. Cross-References

- `owner-assistant-tools.md` § 5.7 — `cli_exec` agent wrapper over
  `/cli/exec`; § 5.8 — @-mention recognition (how the secretary
  picks `cli_exec` vs sending the owner to this panel)
- `local-agent-management.md` § 5.2 — `cli` substrate kind
- `worker-dispatcher.md` § 5 — one-shot Hermes worker spawn
  (contrast: those exit when the brief is done; not tmux-backed)
- `admin-surfaces.md` § 3.1 — admin reset does NOT clear CLI sessions
  today (flag for the dismissal-widening pass)
- ADR-020 — why tmux over node-pty; ADR-021 — `cli_exec` vs
  interactive xterm; ADR-019 — runtime staff CRUD (the dismiss
  cross-ref); ADR-007 — V1 audit posture; ADR-013 — chat surface
- Implementation: `packages/core/src/cli-session-service.ts`,
  `apps/web/app/api/v1/staff/[id]/cli/{launch,input,stream,exec}/route.ts`,
  `apps/web/app/api/v1/staff/[id]/cli/route.ts`,
  `apps/web/app/members/_components/{CliTerminal,MembersClient}.tsx`
