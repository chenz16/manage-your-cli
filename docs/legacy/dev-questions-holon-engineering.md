# Dev Questions (Superseded — sister-repo open questions)

> **Status: Superseded / legacy.** Originally a repo-level ship-blocker
> question log for [`holon-engineering`](https://github.com/chenz16/holon-engineering).
> The single question (Q-001, the bundled Hermes sidecar spawn bug) is
> entirely about that repo's V1 installer and does not apply to
> `manage-your-cli` (no Hermes runtime, no Tauri installer). Preserved
> here for historical context only.

Cross-iteration, ship-blocker questions live here. Per-iteration questions go
in `iterations/NNN-{slug}/dev-questions.md`. Questions here block a SHIP, not
just an iteration close-out.

---

## Q-001 — P0 ship-blocker: bundled Hermes sidecar binary is NOT what the BFF spawns

**Filed:** 2026-05-18 (hermes-sidecar-bundle branch · dev)
**Status:** open · blocks V1 ship of feature #2 (email delegation)
**Owner:** human (architecture call) → next Requirements Agent run drafts ADR if accepted

### Symptom

The hermes-sidecar-bundle branch successfully bundles the PyInstaller sidecar
into the Windows installer's `resources/hermes-sidecar/` tree (verified in CI
via `verify-installer-contents` job). The bundling pipe is end-to-end clean.

However, **the BFF does not spawn this bundled binary**. The runtime spawn
path in `apps/web/lib/hermes-acp-client.ts` (line ~123) is hard-wired to:

```
spawn('uv', ['run', 'hermes', 'acp'], { cwd: deps/hermes/, ... })
```

This will fail at customer-install time on any laptop without `uv` + a
checked-out `deps/hermes/` source tree (i.e., every customer laptop). The
end-to-end consequence: feature #2 (email delegation via 邮件小秘 → Gmail
plugin → Hermes) is DEAD on the shipped installer, even though feature #1
(Gmail OAuth, BFF-side) works.

### Root-cause shape

The bundled sidecar (`packages/hermes-plugin-holon-owner/sidecar_main.py`)
exposes an HTTP `/health` endpoint and explicitly documents itself as
**OUT of scope for actual BFF wiring** (line 22-23):

> OUT of V1 scope (deferred to Pass #3+ or later):
>   - Actually wiring the BFF to call this endpoint (today the BFF talks to
>     `hermes acp` via stdio; this binary is the PyInstaller-bundling proof).
>   - Full ACP stdio bridge inside the bundle (depends on full Hermes bundle —
>     Pass #2 just proves the plugin closure bundles).

So the bundled binary is a *bundling-pipe smoke test*, not a runtime-ready
Hermes ACP server. The BFF speaks ACP JSON-RPC over stdio; the bundle speaks
HTTP. They cannot talk.

ADR-023 § Implementation Notes step 4 calls out the intended end-state
("Sidecar IPC contract: spawns the Python sidecar via `Command::new_sidecar`
with a localhost-bound port arg; sidecar exposes the BFF interface the Node
`apps/web` BFF already uses") but iter-012 Pass #2 explicitly punted on
implementing it. The bundling work is done; the wiring work is not.

### What's needed for V1 ship

Three independent gaps must close BEFORE the V1 installer is customer-ready:

1. **Bundle the full Hermes runtime** (not just the holon-owner plugin
   closure). `deps/hermes/` is a vendored Hermes clone; today the bundle
   includes only `packages/hermes-plugin-holon-owner/` + its direct deps.
   The bundle needs to include the Hermes runtime itself OR the ACP server
   needs to be reimplemented as a thin shim inside `sidecar_main.py`.
   - Option 1a: vendor + PyInstaller-bundle the full `deps/hermes/` tree
     (likely +50-100 MB; needs Hermes upstream's __main__ entry as the
     PyInstaller entry point).
   - Option 1b: reimplement the minimal ACP-over-stdio protocol inside
     `sidecar_main.py` so the BFF can keep its current `@agentclientprotocol/
     sdk`-based client unchanged. Smaller bundle but more sidecar code.
   - Option 1c: rewrite the BFF Hermes client to speak HTTP to `sidecar_main
     .py`'s `/health`-style endpoints (would require defining a full chat /
     tool / session HTTP API on the sidecar side). Bigger BFF-side rewrite;
     drops the ACP SDK dependency.

2. **Tauri Rust glue spawns the sidecar at app boot** — mirroring the Node
   sidecar pattern in `apps/web/src-tauri/src/lib.rs` (lines 86-144). Needs
   to resolve the bundled binary path via `app.path().resolve("resources/
   hermes-sidecar/hermes-sidecar.exe", BaseDirectory::Resource)`, spawn it
   with a port arg, capture the "ready on port N" handshake, and stash the
   `CommandChild` for SIGTERM on window close.

3. **BFF discovers the sidecar's port** — `hermes-acp-client.ts` needs to
   read `HOLON_HERMES_URL` (or equivalent) from a Tauri-set env var instead
   of spawning `uv run` itself. The Rust glue passes the port discovered
   in step 2 to the Node sidecar's env, and the Node sidecar passes it
   through to the Hermes client at request time.

### Why the hermes-sidecar-bundle branch did NOT do all three

The branch's scope (per the human's brief) was strictly "wire the PyInstaller
sidecar into `tauri.conf.json` + CI verify". That work is done; the installer
will no longer ship hollow at the file-payload level. But the spawn-and-
connect runtime work is intentionally out of scope for this single-commit
ship-blocker fixup — it's a multi-pass iteration (likely iter-016 or a
dedicated pass appended to a current iter).

### Recommendation

**Open iter-016 (or appended pass) immediately** with these three gaps
as the explicit pass plan. Estimated 2-3 dev-days for Option 1b (smallest
delta from current code); 4-5 dev-days for Option 1a (largest bundle, most
mainstream); 5-7 dev-days for Option 1c (cleanest long-term, biggest rewrite).
Without this, the V1 installer ships with feature #2 dead, and the user
explicitly named feature #2 as one of the two ship-critical features at
2026-05-18T18:35Z.

### Decision needed from human

- **Which Option (1a / 1b / 1c) to pursue?** Each has different bundle-size,
  dev-time, and long-term-maintenance trade-offs. ADR-023 stayed agnostic
  on this sub-question (it solved packaging, not protocol).
- **Is V1 ship gated on this, or do we ship with feature #1 only and
  push feature #2 to V1.1?** If the latter, the current hermes-sidecar-bundle
  branch is still correct (puts the binary in the installer so a V1.1 patch
  release can light up the wiring without a re-bundle), but the V1 user
  comms need to be clear that "邮件小秘" is V1.1.

(End Q-001.)
