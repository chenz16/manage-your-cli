# ADR: Static Connectors vs. Dynamic MCP-Plugin Model

- Status: Proposed
- Date: 2026-05-24
- Context owner: Chen Zhang
- Decision driver (owner's words, paraphrased): *"I designed 'connectors' that connect
  to many things, but it's dummy — I must pre-connect each one manually. OpenClaw instead
  can self-install extra plugins dynamically. Does the plugin approach change my current
  architecture, and is my philosophy wrong?"*

> Research-only ADR. No product code was modified. The parent agent will commit this doc.

---

## 1. Current state (what we actually have today)

There is **not one connector concept in this repo — there are three overlapping ones**,
each at a different maturity. This is itself a finding: the "connector" word is overloaded,
which is part of why it feels "dummy."

### 1a. The display catalogue — `CONNECTORS_MANIFEST` (static, manifest-shaped)
`packages/api-contract/src/manifests/connectors.ts`

- A hardcoded `Record<string, ConnectorManifest>` with one `active` entry (`gmail`) and
  three `coming_soon` stubs (`github`, `google_drive`, `huggingface`, all with empty
  `tools: []`).
- Each manifest already carries: `id`, `name`, `logo`, `category`, `status`, `description`,
  and a `tools[]` list with per-tool `{ id, label, risk: 'read'|'write', description }`.
- The file's own header admits the design intent: *"to mirror Claude.ai's Connectors panel"*
  and *"They live here (not behind a feature flag) so the UI shows breadth honestly."*
- Per-tool enable/policy is **localStorage-only** today (`holon-connector-tool-*` keys);
  a `TODO(V1.1)` says migrate to BFF + SQLite.

**This object is already a plugin manifest in all but name.** It has identity + capability
list + risk metadata. What it lacks is an *install/registry* lifecycle — it is a fixed
literal, edited by hand.

### 1b. The working channels — webhook/token senders (truly static, hardcoded-per-type)
`packages/core/src/messaging-service.ts` + `apps/web/app/connectors/page.tsx`

- Slack / Discord / Telegram are **bespoke per-type code**: a `MessagingChannel` union, a
  hand-written `if (channel === 'slack') …` ladder in `sendMessagingTest`, three explicit
  config fields, and a hand-built UI panel per channel in `page.tsx`.
- Voice (STT/TTS: whisper_cpp, sensevoice, faster_whisper, cosyvoice, openai) and A2A peer
  ping are wired the same hand-coded way on the same page.
- The page title is literally **"Voice & Messaging"**, and its subtitle says *"CLI agents
  are created from chat or the Team page — not here."* So this page is **not** an agent-tool
  surface; it is a notifications/voice surface.
- **Adding a new channel here = a code change in three places** (service union + UI panel +
  owner-config field) **+ a redeploy.** This is the part of the owner's instinct that is
  *correct*: this layer is static and does not scale by configuration.

### 1c. Owner-level integrations — `IntegrationLink` (the latent plugin registry)
`packages/api-contract/src/entities/owner-assistant.ts`

- `OwnerAssistant.integrations: IntegrationLink[]` — a discriminated union over
  `IntegrationKind = ['gmail','slack','email','webhook','mcp','discord','feishu','google_meet']`.
- **Crucially, `'mcp'` is already a first-class integration kind**, and every non-Gmail
  kind already has the exact plugin shape: `{ kind, label, config, enabled: boolean }`.
- Design note in the file: *"authorization to external tools lives at the CEO layer; staff
  inherit every integration unless explicitly denied."* So enable/disable + inheritance
  semantics already exist at the data layer.
- `packages/core/src/audit.ts` is explicitly **kind-agnostic** — its comment says *"adding
  `'asana'` to IntegrationKind needs no edit here."* The audit path is already plugin-ready.

### 1d. The MCP wiring that already exists (the decisive fact)
`packages/core/src/cli-memory-scaffold.ts`, `packages/holon-mcp/src/scaffold-secretary.ts`

- Every CLI agent workspace gets a generated **`.mcp.json`** with an `mcpServers` block:
  ```json
  { "mcpServers": { "holon": { "type": "stdio", "command": "corepack",
                                "args": ["pnpm","-C",repoRoot,"-F","holon-mcp","start"] } } }
  ```
- `scaffold-secretary.ts` even emits the exact install commands:
  `claude mcp add --transport stdio holon -- …` and `codex mcp add holon -- …`.
- `packages/holon-mcp/src/server.ts` is a real MCP server (`McpServer` + stdio transport)
  exposing self-describing tools (`list_live_agents`, `dispatch`, `create_agent`,
  `read_memory`, …) with zod input schemas — i.e. **we already author and ship an MCP
  server, and we already inject MCP servers into our employees by writing one config file.**

### Verdict on the owner's premise
**Accurate, with a sharpening.** Layer **1b** (Slack/Discord/Telegram/voice) is genuinely
static, hardcoded-per-type, and each addition is a code change + bespoke UI — exactly the
"dummy, pre-connect-each-one-manually" the owner describes. But layers **1a** and **1c/1d**
show the codebase is *already ~70% of the way to a plugin model* and didn't notice: a
manifest shape, an `enabled` flag, an `mcp` kind, a kind-agnostic audit, and a live
mechanism (`.mcp.json`) for injecting MCP servers into the CLI employees. **The philosophy
isn't wrong; the implementation just stopped halfway and grew a parallel hardcoded layer.**

---

## 2. OSS / community patterns (what "dynamic plugin" means in 2026)

The pattern is consistent across every mature tool: **manifest + registry + install +
enable/disable + self-describing capabilities**, vs. our hardcoded-per-type.

### OpenClaw (the system the owner pointed at)
- `openclaw plugins install <npm-spec>` → npm pack → extract into
  `~/.openclaw/extensions/<id>/` → auto-enable in config.
- `openclaw plugins enable|disable <id>` toggles `plugins.entries.<id>.enabled`.
- `openclaw channels add --channel telegram --token …` and `openclaw config set/unset`
  for per-plugin credentials (e.g. `plugins.entries.brave.config.webSearch.apiKey`).
- Bundled opt-in plugins **auto-activate when config names one of their surfaces**.
- Sources: OpenClaw docs — Plugins, CLI Reference, Configure, Building plugins.

This is *exactly* our `IntegrationLink { kind, config, enabled }` + a registry/install step.
OpenClaw's "plugin" ≈ our latent integration; OpenClaw's "channel" ≈ our 1b messaging.

### MCP (Model Context Protocol) — the emerging industry standard, and the crux for us
- **Official MCP Registry** (`registry.modelcontextprotocol.io`, preview since 2025-09, API
  frozen at v0.1): "an app store for MCP servers," a source-of-truth catalog consumed by
  downstream marketplaces via a REST/OpenAPI spec.
- An MCP server is the **installable unit**; its tools are **self-describing** (name +
  schema + description), discovered at connect time — no per-tool hardcoding by the host.
- Hosts add servers via `claude mcp add` / `codex mcp add` (which **we already emit**).
- **Auth model (decisive for our North Star):** auth lives at the *transport* layer.
  - **stdio (local) servers**: the spec says pull credentials **from the environment**, not
    via any in-protocol flow. The server process inherits env from the client and handles
    its own upstream auth (GitHub token, DB creds, etc.).
  - **remote (Streamable HTTP) servers**: OAuth 2.1 — the host is the OAuth *client*, the
    server validates tokens it never issues.
- **Security caveat (must design around):** third-party MCP servers are arbitrary code.
  A CVSS 9.6 RCE in `mcp-remote` let malicious servers run OS commands via the OAuth flow.
  Guidance: "never trust URLs from remote MCP servers," pin versions, validate metadata.

### Claude Code plugins (our employees' native host)
- Manifest = `.claude-plugin/plugin.json` declaring skills + **MCP servers** + hooks.
- `/plugin install <name>` or `github:user/repo`; install **scopes** (user/project/local);
  `/reload-plugins` hot-reloads MCP servers without restart.
- Marketplaces: official `claude-plugins-official` (always present) + community
  `anthropics/claude-plugins-community` (safety-screened). "Add the store, then choose apps."
- Sources: Claude Code docs (Discover plugins, plugins.md), community marketplace writeups.

### Cursor / Continue / Cline (breadth)
- All converged on **MCP** as the extension substrate for tools/connectors (Cursor
  documents OAuth + API-key + secure stdio config for MCP servers). Editor "extensions"
  are the IDE shell; **the agent's tools are MCP servers**.

**Extracted pattern:** _catalog (registry) → install (fetch a self-describing unit) →
enable/disable (config flag) → the agent discovers capabilities at runtime._ Nobody
hardcodes per-tool host code anymore. **And the unit everyone standardized on is the MCP
server.**

---

## 3. The key architectural insight (pressure-tested)

> **Because our "employees" are CLIs (Claude Code, Codex, Gemini, Qwen) that already
> consume MCP, the most natural connector = "an MCP server the user installs/enables."**

This is **not** adopting a foreign idea — it is finishing the one we already started:

| Plugin-model primitive            | What we already have                                    |
|-----------------------------------|----------------------------------------------------------|
| Manifest (identity + capabilities)| `CONNECTORS_MANIFEST` shape (1a); `IntegrationLink` (1c)  |
| enable/disable flag               | `IntegrationLink.enabled: boolean` (1c)                   |
| "MCP" as a connector kind         | `IntegrationKind` already contains `'mcp'` (1c)          |
| Install/inject into the agent     | generated `.mcp.json` per agent cwd (1d)                  |
| We author MCP servers             | `packages/holon-mcp` is a shipping MCP server (1d)       |
| Registry/marketplace              | **missing** — this is the only genuinely new piece       |

### Does this violate the North Star? No — it is the *purest* expression of it.
The North Star (CLAUDE.md §13–18): *"Thin shell. All intelligence is the CLI's. We add only
(1) context/prompt and (2) memory… any 'smart' layer must justify itself — default no…
Subscription-only — no API keys."*

- An MCP connector adds **zero intelligence to our shell.** The CLI calls the tool; the MCP
  server executes; we never parse, route, or "reason." We only manage **which `mcpServers`
  entries are written into `.mcp.json`** — pure config, the thinnest possible shell. This is
  *more* North-Star-compliant than layer 1b, where we hand-wrote a Slack/Discord/Telegram
  sender (that *is* a bespoke smart-ish layer we own and must maintain).

### The no-API-keys tension — squared, honestly
The North Star's "no API keys" is about **not holding the LLM/chat-runtime credential** —
we ride the user's CLI *subscription* login, never an Anthropic/OpenAI API key. It was never
a claim that no external tool may ever need its own secret (we already store Slack webhooks,
Telegram bot tokens, OpenAI *voice* keys, and Gmail OAuth refresh tokens — see
`owner-assistant.ts`).

MCP fits this distinction cleanly:
- **Local stdio MCP servers** (the default, and our own `holon-mcp` model) take credentials
  **from their own environment** — *the server's concern, not our shell's*. We don't handle
  the key; the user populates the server's env, exactly as OpenClaw does
  (`config set plugins.entries.X.config.apiKey`). Our "no API keys" rule is untouched.
- **Remote MCP servers** use OAuth 2.1 where **the CLI itself is the OAuth client** — again
  not us. We never mint or hold a token.

So the rule should be **restated precisely** (recommend updating CLAUDE.md): *"We never hold
the **model/runtime** credential — subscription-only. A connector (MCP server) may carry its
own service auth, scoped to that server, never the chat runtime."* This is a clarification,
not a loosening.

### Honest pros/cons

**Static connectors (today)**
- Pro: dead simple; the few first-party channels (Slack/voice) work *now* and are well
  understood; no third-party-code trust surface; nothing to install at runtime.
- Con: every new integration = code + bespoke UI + redeploy (owner's "dummy" complaint);
  breadth is faked with `coming_soon` stubs; doesn't compose with the CLIs' native tooling;
  we re-implement what MCP servers already provide.

**Dynamic MCP-plugin connectors**
- Pro: connectors become **data, not code**; the catalog grows without our redeploys; rides
  the entire MCP ecosystem (hundreds of existing servers) for free; maximally thin shell;
  aligns the product with where Claude Code / Codex / Cursor already are; our `holon-mcp`
  is just the first such plugin.
- Con: **trust/security** of installing third-party code (CVSS-9.6 precedent — needs an
  allowlist/curation + version pinning); **mobile** thin client can't run stdio servers
  locally (needs a desk-runs-it model); a registry is net-new surface; over-broad tool
  access if risk-gating (the `risk: read|write` we already model) isn't enforced.

---

## 4. Options

### Option A — Keep static connectors
Leave 1b as the model; keep hand-coding each channel. **Rejected.** It directly is the
problem the owner raised, contradicts the thin-shell ideal (we maintain bespoke senders),
and ignores that the CLIs already speak MCP.

### Option B — Full MCP-plugin/registry model (rip-and-replace)
Turn `/connectors` into a plugin manager: browse a registry → install → enable/disable MCP
servers; everything (including Slack notifications) becomes an MCP server. **Rejected as a
big-bang** — it would break the *working* Slack/Gmail/voice today, and outbound *push
notifications* (1b) are a genuinely different concern from *agent tools* (a Slack webhook the
desk posts to is not naturally an MCP server the CLI calls). Right destination, wrong blast
radius.

### Option C — Hybrid (RECOMMENDED)
1. **Keep the few first-party push channels (1b) exactly as-is.** Slack/Discord/Telegram/
   voice are *outbound notification + I/O*, not agent tools. They work; they carry no
   third-party-code risk; leave them on the "Voice & Messaging" page. (Optionally rename the
   page to make the split explicit.)
2. **Promote `IntegrationLink`/`'mcp'` (1c/1d) into a real plugin layer** — a Connectors →
   **Plugin Manager**: a curated **registry** of MCP servers (start: our own `holon-mcp`,
   Gmail-MCP, GitHub-MCP, Drive-MCP, HF-MCP — the very entries already stubbed as
   `coming_soon` in `CONNECTORS_MANIFEST`), each **install → enable/disable** writing into
   the agents' `.mcp.json` via the mechanism we already have in `cli-memory-scaffold.ts`.
3. **Converge the three connector concepts onto one manifest shape** so 1a's manifest, 1c's
   `IntegrationLink`, and the registry catalog are the same type.

This is the only option that (a) matches the owner's instinct, (b) doesn't break what ships
today, and (c) costs the least because **we're finishing, not starting.**

---

## 5. Recommendation

**Adopt Option C.** The owner's instinct is right that the *static* part is limiting — and
the cleanest fix is also the most North-Star-pure one: **a connector = an MCP server the user
enables.** We are already authoring MCP servers and already injecting them via `.mcp.json`;
the missing 30% is a registry/catalog + an install/enable UI + collapsing the duplicate
connector types. Keep the working first-party push channels (Slack/voice) as a separate,
honest "notifications" concern rather than forcing them into MCP.

This is *long-term-clean over fast-now* (per the owner's stated preference): it removes the
hand-coded-per-type tax permanently and lands the product on the industry-standard substrate
its own employees already use.

---

## 6. Architecture impact (for Option C)

**Reusable as-is (do not rebuild):**
- `IntegrationLink { kind:'mcp', label, config, enabled }` — the storage record for an
  installed plugin. Already persisted on `OwnerAssistant.integrations`.
- `.mcp.json` generation in `cli-memory-scaffold.ts` — the inject mechanism. Generalize from
  the single hardcoded `holon` server to "iterate enabled `mcp` integrations."
- `packages/holon-mcp` — becomes "the first bundled plugin," proof the path works.
- `CONNECTORS_MANIFEST` shape + `risk: read|write` per-tool model — becomes the **registry
  entry** type and the consent/risk-gate UI.
- Kind-agnostic `audit.ts` — already logs connector enable/disable with no edits.

**Changes:**
- **`/connectors` page** → split into "Notifications" (keep 1b verbatim) + "Plugins" (new
  manager: browse registry → install → enable/disable, show each server's self-described
  tools with the existing read/write risk gate).
- **Registry source** (net-new, small): a static JSON catalog file first (curated allowlist
  of trusted MCP servers — directly answers the CVSS-9.6 trust risk), with an optional later
  bridge to the official MCP Registry's OpenAPI feed.
- **Inject step**: when an `mcp` integration is `enabled`, merge its
  `{ command/url, args/env }` into every agent's `.mcp.json` (and on disable, remove it).
  Add a "reload" akin to Claude Code's `/reload-plugins`.
- **owner-config fields**: no schema change needed for the registry itself — `integrations`
  already holds it. (Optional: tighten the `mcp` branch's `config` from `LooseConfig` to a
  typed `{ transport, command?, url?, args?, env? }`.)
- **CLAUDE.md**: restate the "no API keys" rule per §3 (runtime credential vs. per-connector
  service auth).

**Mobile thin-client implication:** stdio MCP servers run on the **desk**, not the phone.
The phone stays a thin client that toggles enable/disable; the desk process owns the
`.mcp.json` and the running servers. This matches the existing desk-relay model (per memory:
"mobile reads WeChat via desk relay") — no new mobile runtime.

---

## 7. Phased migration (does NOT break today's Slack/Gmail/voice)

- **Phase 0 (doc/decision):** this ADR + restate CLAUDE.md's no-keys rule. ~0.25 day.
- **Phase 1 (unify types):** make `CONNECTORS_MANIFEST` entry, registry entry, and
  `IntegrationLink` share one manifest type; tighten the `mcp` `config` branch. No behavior
  change. ~0.5 day.
- **Phase 2 (inject from data):** generalize `cli-memory-scaffold.ts` to emit `.mcp.json`
  from *enabled `mcp` integrations* instead of the single hardcoded `holon` block (holon
  stays, now as the first registry entry). Verify employees still get holon-mcp. ~1 day.
- **Phase 3 (curated registry + Plugin Manager UI):** static allowlist JSON (holon, gmail-,
  github-, drive-, hf- MCP servers — the existing `coming_soon` set); `/connectors` gains a
  "Plugins" section: install → enable/disable → re-inject → reload. Reuse the read/write
  risk gate. ~2–3 days.
- **Phase 4 (optional):** bridge to the official MCP Registry OpenAPI feed for discovery
  beyond the allowlist; per-staff `denied_integrations`. ~2 days, deferrable.

Slack/Discord/Telegram/voice (1b) are untouched through every phase.

**Rough effort:** ~4–5 dev-days for Phases 0–3 (a usable plugin manager), Phase 4 optional.
Low risk because the storage, inject mechanism, audit, and our own MCP server already exist.

---

## 8. Risks / unknowns

- **Third-party MCP-server trust (highest):** installing arbitrary servers = arbitrary code
  (CVSS-9.6 `mcp-remote` precedent). Mitigation: ship a **curated allowlist** registry
  first; pin versions; surface the read/write risk per tool; never auto-trust remote URLs.
- **Per-connector auth vs. "no API keys":** resolved in principle (§3) — server-owned env
  for stdio, OAuth-client-is-the-CLI for remote — but requires the CLAUDE.md restatement to
  avoid future "we said no keys" confusion.
- **Mobile:** no local server runtime on phone; desk-runs-servers model required (already
  our pattern, but must be explicit so enable/disable from mobile drives the desk).
- **Notifications vs. tools conflation:** keep them separate; resist the temptation to force
  Slack-push into MCP just for uniformity.
- **`.mcp.json` per-agent merge correctness:** must add/remove cleanly without clobbering an
  agent's own config; needs a small merge + reload routine and a test.

---

## 9. Sources

- MCP Registry (preview): https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/ ·
  https://modelcontextprotocol.io/registry/about · https://registry.modelcontextprotocol.io/ ·
  https://github.com/modelcontextprotocol/registry
- MCP authorization / auth: https://modelcontextprotocol.io/docs/tutorials/security/authorization ·
  https://www.truefoundry.com/blog/mcp-authentication-in-cursor-oauth-api-keys-and-secure-configuration ·
  https://workos.com/blog/introduction-to-mcp-authentication
- Claude Code plugins/marketplaces: https://code.claude.com/docs/en/discover-plugins ·
  https://code.claude.com/docs/en/plugins.md · https://claudemarketplaces.com/
- OpenClaw plugins/channels/config: https://docs.openclaw.ai/tools/plugin ·
  https://docs.openclaw.ai/cli/index · https://docs.openclaw.ai/cli/configure ·
  https://docs.openclaw.ai/plugins/building-plugins
- Internal: `packages/api-contract/src/manifests/connectors.ts`,
  `packages/api-contract/src/entities/owner-assistant.ts`,
  `packages/core/src/messaging-service.ts`, `packages/core/src/cli-memory-scaffold.ts`,
  `packages/core/src/audit.ts`, `packages/holon-mcp/src/server.ts`,
  `packages/holon-mcp/src/scaffold-secretary.ts`, `apps/web/app/connectors/page.tsx`,
  `CLAUDE.md`.
