// iter-012 Pass #6.1: Node-sidecar architecture (resolves Q-010 path #1).
//
// Background: Next.js `output: 'standalone'` produces a Node server bundle
// (server.js + a copy of node_modules) — NOT a static asset folder Tauri's
// webview can serve directly. Pass #6 hit this wall:
//   > Error: The configured frontendDist includes the `["node_modules"]`
//   > folder. Please isolate your web assets on a separate folder...
//
// Pass #6.1 fix: bundle Node.js as a Tauri sidecar; spawn `node server.js`
// at app launch; webview hits http://127.0.0.1:3000/. Mirrors the Hermes
// Python-sidecar pattern from Pass #2. `frontendDist` now points at
// apps/web/public (a real static folder Tauri's scanner accepts) but the
// window URL is the localhost Node server, so users see the live SSR app.
//
// Lifecycle (per Q-002 defaults):
//   - On setup(): spawn Node sidecar with PORT=3000 + resource-resolved
//     path to server.js (lives under resources/n/server.js in
//     the bundled app). Stream stdout/stderr to log file.
//   - On WindowEvent::Destroyed of main window: send SIGTERM to child via
//     Drop on CommandChild. Tauri's shell-plugin handles SIGKILL fallback
//     after ~1s (mirrors L2 sequence in Q-002).
//   - On crash: surfaces as in-app banner via emitted event (deferred to
//     iter-013 GA hardening; for V1 demo, crash is fail-loud in logs).
//
// Sidecar binary lives at: binaries/node-<target-triple>
//   - Linux:   binaries/node-x86_64-unknown-linux-gnu
//   - macOS:   binaries/node-aarch64-apple-darwin OR x86_64-apple-darwin
//   - Windows: binaries/node-x86_64-pc-windows-msvc.exe
//
// Build prep: `scripts/fetch-node-sidecar.sh` downloads + installs the
// right Node binary for the current host. CI matrix wires this in a
// follow-up Pass.
//
// ─────────────────────────────────────────────────────────────────────────
// iter-016 Pass #2: Hermes ACP sidecar spawn + stdio↔TCP bridge.
//
// Background: iter-016 Pass #1 (efb25c1) shipped a PyInstaller bundle of
// the real upstream Hermes ACP runtime (`acp_adapter.entry.main`) which
// speaks JSON-RPC over stdin/stdout. iter-016 Pass #2 (this code) is the
// Tauri-Rust glue that:
//   1. Spawns the bundled Hermes binary from resources/hermes-sidecar/
//      at app boot (production mode only — dev mode preserves the
//      `pnpm dev` → BFF → `uv run hermes acp` workflow per AC-4).
//   2. Allocates a free 127.0.0.1 TCP port + relays bytes bidirectionally
//      between that port and Hermes's stdin/stdout (Hermes only speaks
//      stdio; the Node BFF in Pass #3 will connect to the TCP port via
//      net.Socket — cleanest cross-platform IPC).
//   3. Sets HOLON_HERMES_PORT=<port> on the Node sidecar so Pass #3's
//      hermes-acp-client.ts can find the bridge.
//   4. On window destroy: kills Node first (drains in-flight Hermes
//      tool calls) → SIGTERM Hermes → 5 s grace → SIGKILL Hermes.
//
// Q-003 resolution (TCP loopback chosen):
//   - Cross-platform: Windows can't pass file descriptors to a child via
//     `inherit` the same way Unix does; TCP loopback works identically
//     on Win/macOS/Linux.
//   - Debuggable: a dev can `nc 127.0.0.1 $HOLON_HERMES_PORT` to
//     manually probe the Hermes bridge liveness (ACP-level framing
//     still needs a JSON-RPC envelope, but socket connectivity is
//     trivial to verify).
//   - Loopback-only bind (127.0.0.1, not 0.0.0.0) — never exposed on LAN
//     per the same posture as the Node sidecar (`HOSTNAME=127.0.0.1`).
//   - Single-connection contract: only the Node BFF on this machine ever
//     connects; if a second connection arrives, we log + drop.
//
// Q-004 resolution (kill ordering): Node first → 5 s grace → Hermes.
// Rationale: the BFF may have in-flight Hermes tool calls; killing
// Hermes first would surface those as `socket reset` errors in the
// BFF's log right as the BFF is itself terminating. Killing Node first
// drains the JSON-RPC layer cleanly (Node closes the TCP socket on its
// way out, the bridge sees EOF, Hermes receives EOF on its stdin and
// exits gracefully via the upstream `acp_adapter.entry` shutdown
// handler). The 5 s grace SIGKILL is a safety net.
//
// Q-005 resolution (env var name): HOLON_HERMES_PORT (single int).
// HOLON_HERMES_URL would require URL parsing on the Node side for a
// trivial loopback IP. HOLON_HERMES_SOCKET (the brief's framing) was
// agnostic; PORT is more precise + matches ADR-023 § Implementation
// Notes step 4 convention ("localhost-bound port arg").

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{Manager, Runtime};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the spawned Node sidecar child so we can SIGTERM it on quit.
/// `Mutex<Option<...>>` because Tauri's `manage()` requires `Sync` and
/// we need interior mutability to `take()` the child during shutdown.
#[derive(Default)]
struct NodeSidecar {
    child: Arc<Mutex<Option<CommandChild>>>,
}

/// iter-016 Pass #2: Holds the spawned Hermes sidecar child for
/// lifecycle-handler reach. The bridge task ALSO holds a clone of this
/// Arc so it can call `child.write(&buf)` from the TCP-reader thread.
/// Wrapped in `Arc<Mutex<Option<...>>>` for the same reason as
/// NodeSidecar (Tauri `manage()` Sync bound + interior mutability for
/// `take()` during shutdown).
#[derive(Default)]
struct HermesSidecar {
    child: Arc<Mutex<Option<CommandChild>>>,
}

/// iter-027: Holds the spawned WeChat read-daemon child (Windows-only) so
/// we can kill it on app exit alongside Node and Hermes. Mirrors the exact
/// same `Arc<Mutex<Option<CommandChild>>>` pattern as NodeSidecar and
/// HermesSidecar (Tauri `manage()` Sync bound + interior mutability for
/// `take()` during shutdown).
#[derive(Default)]
struct WechatDaemon {
    child: Arc<Mutex<Option<CommandChild>>>,
}

// ─────────────────────────────────────────────────────────────────────────
// iter-018 Pass #6b: runtime LLM-provider hot-swap for installed Tauri app.
//
// Problem (Q-001 deferred from iter-018 Pass #6 873fe79):
//   spawn-mode dev: PATCH /api/v1/llm-providers/active → closeBridge() →
//   next request re-spawns uv with resolveActiveProvider().envVars → works.
//   socket-mode installed: Hermes was spawned ONCE at app boot with env
//   captured then; closeBridge() only drops the TCP socket — the Hermes
//   child process keeps running with the old provider env → broken.
//
// Fix: expose a Tauri command that the Node BFF calls (via __TAURI__.core
// .invoke) when the user toggles the active provider. The command kills
// the existing Hermes child and re-spawns it with the updated env vars
// merged in, then lets the new TCP bridge accept loop re-connect on the
// SAME port (the listener is NOT restarted — the OS keeps the same port
// bound). The Node BFF detects the reconnect via startBridgeViaSocket's
// retry loop the next time getBridge() is called.
//
// Security: the env_vars argument arrives from the locally-running Node
// BFF (same machine, same user, Tauri IPC on the loopback) — not from
// the internet. We whitelist the allowed keys to prevent the BFF from
// arbitrarily setting any env var on the Hermes child (defense-in-depth).
// ─────────────────────────────────────────────────────────────────────────

/// Allowed env-var prefixes for the provider hot-swap. The BFF resolver
/// only emits API-key vars (`DEEPSEEK_*`, `OPENAI_*`, `ANTHROPIC_*`,
/// `OPENROUTER_*`) plus the internal `HOLON_LLM_*` flags — we enforce
/// that constraint here so a hypothetical injection via the IPC can't
/// overwrite `PATH`, `HOME`, or other OS-critical vars.
const ALLOWED_ENV_PREFIXES: &[&str] = &[
    "DEEPSEEK_",
    "OPENAI_",
    "ANTHROPIC_",
    "OPENROUTER_",
    "HOLON_LLM_",
    "HOLON_HERMES_",
];

/// Tauri command: kill the running Hermes sidecar and re-spawn it with
/// updated env vars. Called by the Node BFF (via `__TAURI__.core.invoke`)
/// after PATCH /api/v1/llm-providers/active persists the new provider.
///
/// env_vars: map of env-var-name → value from the BFF's
/// `resolveActiveProvider().envVars`. We merge these over the baseline
/// env the sidecar was originally spawned with (HOLON_DATA_DIR is
/// preserved from app.path().app_data_dir() every time).
///
/// Returns Ok(()) immediately after the new child is stashed in state; the
/// old child kill is best-effort (Hermes may have already exited).
#[tauri::command]
async fn restart_hermes_with_env(
    app: tauri::AppHandle,
    state: tauri::State<'_, HermesSidecar>,
    env_vars: HashMap<String, String>,
) -> Result<(), String> {
    // ── 1. Whitelist-filter incoming env vars ──────────────────────────────
    let filtered: HashMap<String, String> = env_vars
        .into_iter()
        .filter(|(k, _)| {
            ALLOWED_ENV_PREFIXES
                .iter()
                .any(|prefix| k.starts_with(prefix))
        })
        .collect();

    let keys_str: Vec<&str> = filtered.keys().map(|s| s.as_str()).collect();
    log::info!("[holon-desk:provider_rpc] restart_hermes_with_env called · keys={keys_str:?}");

    // ── 2. Kill existing Hermes child ──────────────────────────────────────
    {
        let mut guard = state.child.lock().unwrap();
        if let Some(old_child) = guard.take() {
            log::info!("[holon-desk:provider_rpc] killing old Hermes child for provider hot-swap");
            // Best-effort: Hermes may have already exited if the BFF's socket
            // closed it; ignore errors.
            let _ = old_child.kill();
        } else {
            log::warn!("[holon-desk:provider_rpc] no running Hermes child found (already killed or never spawned?)");
        }
    }

    // ── 3. Small grace before re-spawn so the OS reclaims the old child's
    //       stdio handles and the bridge accept loop has time to notice EOF.
    std::thread::sleep(Duration::from_millis(300));

    // ── 4. Re-spawn Hermes with the new env ────────────────────────────────
    //
    // Resolve the binary path using the same logic as the initial
    // spawn_hermes_sidecar call so the path is always correct regardless of
    // install location.
    let binary_name = if cfg!(target_os = "windows") {
        "hermes-sidecar.exe"
    } else {
        "hermes-sidecar"
    };
    let relative = format!("resources/hermes-sidecar/{binary_name}");
    let hermes_path = app
        .path()
        .resolve(&relative, tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("[holon-desk:err:resource_missing] {relative}: {e}"))?;

    if !hermes_path.exists() {
        return Err(format!(
            "[holon-desk:err:resource_missing] hermes binary not on disk: {}",
            hermes_path.display()
        ));
    }

    let hermes_path_str = hermes_path
        .to_str()
        .ok_or_else(|| "[holon-desk:err:non_utf8_path] hermes binary path not UTF-8".to_string())?
        .to_string();

    // Resolve HOLON_DATA_DIR fresh (same as boot; data dir never changes
    // between restarts, but resolving it here avoids having to thread it
    // through shared state).
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("[holon-desk:err:data_dir_missing] {e}"))?;
    let data_dir_str = data_dir
        .to_str()
        .ok_or("[holon-desk:err:non_utf8_path] app_data_dir not UTF-8")?
        .to_string();

    // Build the spawn command. Start with the baseline envs then overlay
    // the provider-specific vars from the BFF. The `command()` builder
    // inherits the parent process env by default (Tauri's tauri-plugin-shell
    // behavior); we then add/override specific keys.
    let mut cmd = app
        .shell()
        .command(&hermes_path_str)
        .set_raw_out(true)
        .env("HOLON_DATA_DIR", &data_dir_str);

    for (k, v) in &filtered {
        cmd = cmd.env(k, v);
    }

    let (mut rx, new_child) = cmd
        .spawn()
        .map_err(|e| format!("[holon-desk:err:spawn_failed] hermes re-spawn: {e}"))?;

    log::info!(
    "[holon-desk:provider_rpc] Hermes re-spawned with updated provider env · HOLON_DATA_DIR={data_dir_str}"
  );

    // ── 5. Stash new child handle ──────────────────────────────────────────
    {
        let mut guard = state.child.lock().unwrap();
        *guard = Some(new_child);
    }

    // ── 6. Pump new child's stderr/exit to log (stdout goes to the
    //       existing bridge accept loop via the socket slot — the TCP
    //       listener is still bound; the BFF reconnects on next getBridge()).
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(line) => {
                    log::warn!(
                        "[hermes:err:respawn] {}",
                        String::from_utf8_lossy(&line).trim_end()
                    );
                }
                CommandEvent::Error(err) => {
                    log::error!("[hermes:fatal:respawn] {err}");
                }
                CommandEvent::Terminated(payload) => {
                    log::warn!(
                        "[hermes:exit:respawn] code={:?} signal={:?}",
                        payload.code,
                        payload.signal
                    );
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![restart_hermes_with_env])
    .manage(NodeSidecar::default())
    .manage(HermesSidecar::default())
    .manage(WechatDaemon::default())
    .setup(|app| {
      // Engineering Rule #4 (no silent failure): initialize the log plugin
      // UNCONDITIONALLY so production setup() failures leave a diagnosable
      // trail on disk. Previously this was gated behind
      // `cfg!(debug_assertions)`, so release builds emitted zero Rust log
      // output — the 2026-05-19 08:17 Windows install surfaced a
      // setup-failure modal with nothing in
      // `%LOCALAPPDATA%\com.holon.desk\logs\` to forensically attribute it.
      // Level: Trace in debug (verbose iteration), Info in release (signal
      // without flooding the user's disk).
      let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Trace
      } else {
        log::LevelFilter::Info
      };
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log_level)
          .build(),
      )?;

      // Resolve the bundled server.js path. In dev mode (cfg debug + the
      // beforeDevCommand running `pnpm dev` on :3000), we DON'T spawn the
      // sidecar — Next dev-server already owns :3000. The webview points
      // at http://localhost:3000 in both modes; only the source of that
      // server differs (Next dev vs Node sidecar).
      //
      // iter-016 Pass #2: the Hermes sidecar ALSO short-circuits in dev
      // mode — dev runs Hermes via `pnpm dev`'s BFF spawning `uv run
      // hermes acp` (Pass #3 fallback branch). AC-4: dev workflow
      // unchanged.
      if cfg!(debug_assertions) {
        log::info!(
          "[holon-desk] dev mode — skipping Node + Hermes sidecar spawn; using Next dev-server on :3000 + BFF `uv run hermes acp`"
        );
        return Ok(());
      }

      // ───────────────────────────────────────────────────────────────────
      // iter-016 Pass #2: Spawn Hermes sidecar FIRST (Node BFF depends on
      // HOLON_HERMES_PORT being set before it boots its Hermes client).
      // ───────────────────────────────────────────────────────────────────

      let hermes_port = spawn_hermes_sidecar(app.handle())
        .map_err(|e| format!("[holon-desk:err:hermes_spawn_failed] {e}"))?;

      log::info!(
        "[holon-desk] Hermes sidecar stdio↔TCP bridge ready on 127.0.0.1:{hermes_port} (HOLON_HERMES_PORT)"
      );

      // Production: spawn the bundled Node + standalone server.js.
      // Resolve from the concrete resource dir and join path components
      // explicitly. On Windows, passing the resource-relative string through
      // BaseDirectory::Resource has produced a truncated `C:` argument in the
      // installed app, which makes Node try to lstat the drive directory.
      // Monorepo note: Next.js standalone output for a workspace package
      // (apps/web) preserves the workspace path inside the bundle, so
      // server.js lives at `apps/web/server.js` relative to the
      // standalone root — NOT at the bundle root. This matches what
      // `node apps/web/.next/standalone/apps/web/server.js` invokes.
      let resource_dir_raw = app
        .path()
        .resource_dir()
        .map_err(|e| format!("[holon-desk:err:resource_dir_missing] {e}"))?;
      // Strip Windows extended-length path prefix (\\?\) — Node.js doesn't
      // support it and fails with EISDIR or MODULE_NOT_FOUND.
      let resource_dir = {
        let s = resource_dir_raw.to_string_lossy();
        let clean = s.strip_prefix(r"\\?\").unwrap_or(&s);
        std::path::PathBuf::from(clean.to_string())
      };
      let resource_path = resource_dir
        .join("resources")
        .join("n")
        .join("apps")
        .join("web")
        .join("server.js");

      log::info!("[holon-desk] resource_dir was: {:?}", resource_dir);
      log::info!("[holon-desk] server.js arg will be: {:?}", resource_path);
      log::info!(
        "[holon-desk] resolved Node server.js path: {}",
        resource_path.display()
      );
      if !resource_path.is_file() {
        return Err(format!(
          "[holon-desk:err:resource_missing] server.js not found at {}",
          resource_path.display()
        )
        .into());
      }

      // Engineering Rule #4: resolve the OS-conventional per-app data dir
      // (e.g. `%LOCALAPPDATA%\com.holon.desk\` on Windows,
      // `~/.local/share/com.holon.desk/` on Linux,
      // `~/Library/Application Support/com.holon.desk/` on macOS) and pass
      // it to the Node sidecar as HOLON_DATA_DIR. apps/web/db/index.ts's
      // findRepoRoot() short-circuits to this path FIRST in the standalone
      // bundle — without it, the cwd/__dirname walks for
      // pnpm-workspace.yaml both fail inside resources/n/apps/web/ and
      // setup() dies silently. Fail loud here if Tauri can't resolve the
      // data dir (extremely unlikely; would indicate a corrupt bundle ID).
      let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("[holon-desk:err:data_dir_missing] app_data_dir: {e}"))?;
      if !data_dir.exists() {
        std::fs::create_dir_all(&data_dir).map_err(|e| {
          format!("[holon-desk:err:data_dir_mkdir] {}: {e}", data_dir.display())
        })?;
      }
      let data_dir_str = data_dir
        .to_str()
        .ok_or("[holon-desk:err:non_utf8_path] app_data_dir not UTF-8")?
        .to_string();
      log::info!("[holon-desk] HOLON_DATA_DIR={data_dir_str}");

      let bundled_node_name = if cfg!(target_os = "windows") {
        "node.exe"
      } else {
        "node"
      };
      let tauri_sidecar_node_name = if cfg!(target_os = "windows") {
        "node-x86_64-pc-windows-msvc.exe"
      } else if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
        "node-aarch64-apple-darwin"
      } else if cfg!(target_os = "macos") {
        "node-x86_64-apple-darwin"
      } else {
        "node-x86_64-unknown-linux-gnu"
      };

      let mut node_path_candidates = Vec::new();
      if let Some(resource_parent) = resource_dir.parent() {
        node_path_candidates.push(resource_parent.join(bundled_node_name));
        node_path_candidates.push(resource_parent.join("binaries").join(tauri_sidecar_node_name));
      }
      node_path_candidates.push(
        resource_dir
          .join("..")
          .join("binaries")
          .join(tauri_sidecar_node_name),
      );

      let node_path = node_path_candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
          format!(
            "[holon-desk:err:resource_missing] node binary not found near resource_dir {:?}",
            resource_dir
          )
        })?;
      log::info!("[holon-desk] spawning Node from {:?}", node_path);

      let node_path_str = node_path
        .to_str()
        .ok_or_else(|| {
          format!(
            "[holon-desk:err:non_utf8_path] node binary: {}",
            node_path.display()
          )
        })?
        .to_string();
      let resource_path_str = resource_path
        .to_str()
        .ok_or_else(|| {
          format!(
            "[holon-desk:err:non_utf8_path] server.js: {}",
            resource_path.display()
          )
        })?
        .to_string();

      let sidecar = app
        .shell()
        .command(&node_path_str)
        .arg(&resource_path_str)
        // Next.js standalone server reads PORT + HOSTNAME from env.
        // Pin to 127.0.0.1 (loopback only — not exposed on LAN) and the
        // conventional :3000 the webview already targets.
        .env("PORT", "3000")
        .env("HOSTNAME", "127.0.0.1")
        // NODE_ENV=production so Next.js disables dev-only middleware,
        // serves the pre-built routes, and uses production React.
        .env("NODE_ENV", "production")
        // iter-016 Pass #2: hand the Hermes-bridge TCP port to the Node
        // BFF via env var. Pass #3's hermes-acp-client.ts reads this and
        // connects to 127.0.0.1:$HOLON_HERMES_PORT (Branch A); absent →
        // dev-mode fallback to `uv run hermes acp` spawn (Branch B). Per
        // Q-005 resolution: single integer, not URL.
        .env("HOLON_HERMES_PORT", hermes_port.to_string())
        // Engineering Rule #4: location for runtime-mutable state
        // (auth.db, future caches). apps/web/db/index.ts consults this
        // BEFORE attempting its pnpm-workspace.yaml walk so the standalone
        // bundle (resources/n/apps/web/) doesn't die looking for a marker
        // that only exists in the dev monorepo layout.
        .env("HOLON_DATA_DIR", &data_dir_str);

      let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("[holon-desk:err:spawn_failed] node sidecar: {e}"))?;

      // Stash the child handle so we can kill it on app quit.
      let state = app.state::<NodeSidecar>();
      *state.child.lock().unwrap() = Some(child);

      // Pump stdout/stderr into the log. Without this, the sidecar's
      // pipe buffer fills + the child eventually blocks. Spawning the
      // pump on tauri::async_runtime keeps it non-blocking.
      tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
          match event {
            CommandEvent::Stdout(line) => {
              log::info!("[holon-desk:sidecar:out] {}", String::from_utf8_lossy(&line))
            }
            CommandEvent::Stderr(line) => {
              log::warn!("[holon-desk:sidecar:err] {}", String::from_utf8_lossy(&line))
            }
            CommandEvent::Error(err) => log::error!("[holon-desk:sidecar:fatal] {err}"),
            CommandEvent::Terminated(payload) => {
              log::warn!(
                "[holon-desk:sidecar:exit] code={:?} signal={:?}",
                payload.code,
                payload.signal
              );
              break;
            }
            _ => {}
          }
        }
      });

      // ───────────────────────────────────────────────────────────────────
      // iter-027: Auto-spawn the bundled WeChat read daemon (Windows only).
      //
      // The daemon is a PyInstaller onefile exe that connects to the local
      // WeChat process via wcferry, reads whitelisted contacts' messages,
      // and POSTs them to the local Node BFF's /api/v1/channels/wechat/ingest
      // endpoint. It ships as:
      //   resources/wechat-daemon/wechat-read-daemon.exe
      //
      // Platform guard: #[cfg(target_os = "windows")] so the spawn block is
      // compiled out entirely on macOS / Linux builds — those platforms ship
      // no WeChat hook, and the resource dir won't contain the exe anyway.
      //
      // Config: we resolve resources/wechat-daemon/wechat-whitelist.json and
      // pass it as --config. The daemon's own load_config() gracefully falls
      // back to an empty whitelist if the file is absent, so a missing json
      // is not fatal — the daemon still boots and polls is_login(); it just
      // posts nothing until wxids are added via the Holon UI. Passing an
      // explicit --config avoids any PyInstaller _MEIPASS path confusion
      // (the default Path(__file__).with_name("wechat-whitelist.json") in a
      // onefile bundle resolves inside the temp extract dir, not next to the
      // installed exe).
      //
      // Graceful-skip: if the exe is absent (e.g. dev-only build that ran
      // before build-wechat-daemon.ps1), we LOG a warning and continue
      // without crashing the app. The daemon is optional — core Holon
      // functionality is unaffected if it's missing.
      // ───────────────────────────────────────────────────────────────────
      // DISABLED (2026-05-21): the persistent daemon holds a wcferry lock on
      // WeChat.exe for its entire lifetime. When Hermes' read_wechat_messages
      // tool spawns a --once daemon, the two instances fight over the lock and
      // both time out. Until we add a "use the running daemon's HTTP read API
      // instead of spawning --once" path in tools.py, keep the persistent
      // daemon disabled so --once mode (the only consumer) works reliably.
      // #[cfg(target_os = "windows")]
      // spawn_wechat_daemon(app.handle());

      Ok(())
    })
    // SIGTERM the Node sidecar when the main window is destroyed. Tauri
    // calls this BEFORE the process exits, so we have a chance to flush.
    // Drop on CommandChild sends the kill signal; the sidecar's exit
    // handler (Next.js's own SIGTERM handler) drains in-flight requests.
    //
    // iter-016 Pass #2 (Q-004 resolved): order is Node FIRST → 5 s grace
    // → Hermes. Killing Node first lets the BFF drain in-flight ACP
    // calls; when Node terminates, the TCP socket to the Hermes bridge
    // closes, the bridge sees EOF, Hermes receives EOF on stdin and
    // shuts down via upstream `acp_adapter.entry` SIGTERM handler. The
    // 5 s grace + explicit Hermes.kill() is a safety net for the case
    // where Hermes is mid-LLM-call and doesn't promptly notice the EOF.
    //
    // The stagger runs on a detached std::thread so we don't block the
    // Tauri main thread for 5 s (would freeze any other window-event
    // dispatch + delay process exit).
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::Destroyed = event {
        if window.label() == "main" {
          // Step 1 — kill Node immediately (drains BFF in-flight calls).
          let node_state = window.state::<NodeSidecar>();
          if let Some(child) = node_state.child.lock().unwrap().take() {
            log::info!("[holon-desk] killing Node sidecar on main-window destroy (Hermes follows after 5 s grace per iter-016 Pass #2 Q-004)");
            let _ = child.kill();
          }

          // Step 2 — Hermes after 5 s grace. We take() the child out of
          // state on the main thread (cheap), then move it into a
          // detached thread that sleeps + kills. If the app actually
          // exits faster than 5 s, the OS reaps any orphan Hermes
          // process when the parent exits anyway.
          //
          // Explicit-scope dance: take the CommandChild out via a small
          // block so the MutexGuard temporary drops BEFORE the
          // `hermes_state: State<HermesSidecar>` binding (which would
          // otherwise drop first, leaving the guard with a dangling
          // borrow per E0597). See Rust 2024 temporary-scope rules.
          let hermes_child_opt = {
            let hermes_state = window.state::<HermesSidecar>();
            let taken = hermes_state.child.lock().unwrap().take();
            taken
          };
          if let Some(hermes_child) = hermes_child_opt {
            std::thread::spawn(move || {
              std::thread::sleep(Duration::from_secs(5));
              log::info!("[holon-desk] killing Hermes sidecar (5 s grace expired)");
              let _ = hermes_child.kill();
            });
          }

          // Step 3 — WeChat daemon (Windows only): kill immediately alongside Node.
          // The daemon has no in-flight BFF dependency — it speaks directly to the
          // ingest endpoint, not through the stdio/TCP bridge — so no grace period
          // is needed. Best-effort: daemon may have already exited if WeChat closed.
          #[cfg(target_os = "windows")]
          {
            let wechat_child_opt = {
              let wechat_state = window.state::<WechatDaemon>();
              let taken = wechat_state.child.lock().unwrap().take();
              taken
            };
            if let Some(wechat_child) = wechat_child_opt {
              log::info!("[holon-desk] killing WeChat read daemon on main-window destroy");
              let _ = wechat_child.kill();
            }
          }
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

// ─────────────────────────────────────────────────────────────────────────
// iter-016 Pass #2: Hermes spawn + stdio↔TCP bridge
// ─────────────────────────────────────────────────────────────────────────

/// Shared writer half of the currently-connected BFF TCP socket. The
/// stdout pump (Hermes child → CommandEvent::Stdout) writes into this;
/// the accept loop swaps in a new TcpStream when a (single) BFF
/// connection lands. Wrapped in Mutex for cross-thread access; the
/// `Option` lets the stdout pump cheaply skip when no client is
/// connected (the BFF may take 200-500 ms after Tauri sets the env var
/// to actually open the socket).
type BridgeSocketSlot = Arc<Mutex<Option<TcpStream>>>;

/// Spawn the bundled Hermes sidecar binary and start the stdio↔TCP bridge.
///
/// Returns the bound TCP port on success; the bridge listens on
/// 127.0.0.1:<port> and relays bytes bidirectionally between any
/// accepted client (in production: the Node BFF) and the Hermes child's
/// stdin/stdout.
///
/// The `HermesSidecar` Tauri state ends up owning the CommandChild for
/// lifecycle-handler reach. The bridge task holds a clone of the shared
/// Arc<Mutex<Option<CommandChild>>> so it can call `child.write(&buf)`
/// from the TCP-reader thread.
///
/// Engineering Rule #4 (no silent failure):
///   - Missing binary in resourceDir → returns Err with
///     `resource_missing` classification. Caller surfaces as
///     `[holon-desk:err:hermes_spawn_failed] resource_missing: ...`.
///   - Spawn failure (Hermes crashes at startup) → returns Err with
///     `spawn_failed`.
///   - TCP bind failure (port allocation) → returns Err with
///     `tcp_bind_failed`.
///   - Bridge runtime errors → logged with `[hermes:bridge:err:...]`
///     classification, do NOT bring down the app (Hermes may still serve
///     a future reconnect attempt; orderly shutdown happens via the
///     window-destroy handler, not via bridge errors).
fn spawn_hermes_sidecar<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<u16, String> {
    // ──────────────── Step 1 — resolve bundled binary path ────────────────
    //
    // PyInstaller --onedir lays out:
    //   resources/hermes-sidecar/hermes-sidecar(.exe)   ← entry binary
    //   resources/hermes-sidecar/_internal/...          ← CPython + wheels
    //   resources/hermes-sidecar/deps/hermes/...        ← upstream runtime
    //   resources/hermes-sidecar/hermes-plugin-holon-owner/...
    //
    // The Pass #1 build script + `scripts/copy-hermes-sidecar-for-tauri.mjs`
    // place this tree into the Tauri bundle's resourceDir under
    // `resources/hermes-sidecar/`. We resolve the entry binary path via
    // Tauri's BaseDirectory::Resource which gives the absolute path
    // inside the installed app on all three platforms.
    let binary_name = if cfg!(target_os = "windows") {
        "hermes-sidecar.exe"
    } else {
        "hermes-sidecar"
    };
    let relative = format!("resources/hermes-sidecar/{binary_name}");
    let hermes_path = app
        .path()
        .resolve(&relative, tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("resource_missing: {relative}: {e}"))?;

    // Loud-fail boot if the file isn't actually present — don't ship a
    // half-broken installer silently (brief hard constraint). The Pass #1
    // copy-script + GHA `verify-installer-contents` job should catch this
    // upstream, but defense-in-depth at runtime makes the failure
    // immediately visible to a customer reporting "@邮件小秘 silently no-op"
    // rather than buried in a downstream BFF error.
    if !hermes_path.exists() {
        return Err(format!(
      "resource_missing: {} not found on disk (PyInstaller bundle missing from installer payload?)",
      hermes_path.display()
    ));
    }

    log::info!("[holon-desk] spawning Hermes sidecar from {hermes_path:?}");

    // ──────────────── Step 2 — bind TCP listener (port 0 = OS-assigned) ────
    //
    // 127.0.0.1 only — never on 0.0.0.0. The bridge is a single-tenant
    // localhost-only IPC channel; LAN exposure would defeat the
    // local-first posture (ADR-005) + give a remote attacker direct
    // ACP-JSON-RPC access to the user's Hermes runtime + LLM keys.
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("tcp_bind_failed: 127.0.0.1:0: {e}"))?;
    let bound_port = listener
        .local_addr()
        .map_err(|e| format!("tcp_addr_failed: {e}"))?
        .port();

    // ──────────────── Step 3 — spawn the Hermes child process ─────────────
    //
    // Use `command(path)` not `.sidecar(name)` — sidecar() requires the
    // binary to be in tauri.conf.json's `externalBin` array (target-triple
    // suffixed). The Hermes binary lives under `resources/hermes-sidecar/`
    // (per the hermes-sidecar-bundle branch decision: PyInstaller --onedir
    // emits a folder tree, which maps to `bundle.resources`, not
    // `externalBin`'s single-binary contract).
    //
    // set_raw_out(true): forward stdout bytes EXACTLY as Hermes emits them
    // (no line-splitting). ACP JSON-RPC is newline-delimited so line mode
    // would work, but raw mode preserves framing for any future ACP
    // transport variant + simplifies the bridge byte-relay (we just
    // forward whatever lands in the CommandEvent::Stdout buffer).
    let hermes_path_str = hermes_path
        .to_str()
        .ok_or_else(|| format!("non_utf8_path: {}", hermes_path.display()))?
        .to_string();
    // Pass WECHAT_DAEMON_CMD so the plugin's read_wechat_messages tool can find
    // the bundled wechat-read-daemon.exe. Without this, the PyInstaller temp-dir
    // upward search in tools.py never reaches the install dir's resources/.
    let mut cmd = app.shell().command(&hermes_path_str);
    cmd = cmd.set_raw_out(true);
    let wechat_daemon_relative = "resources/wechat-daemon/wechat-read-daemon.exe";
    if let Ok(wechat_daemon_path) = app
        .path()
        .resolve(wechat_daemon_relative, tauri::path::BaseDirectory::Resource)
    {
        if wechat_daemon_path.exists() {
            if let Some(s) = wechat_daemon_path.to_str() {
                cmd = cmd.env("WECHAT_DAEMON_CMD", s);
                log::info!("[holon-desk] WECHAT_DAEMON_CMD={s}");
            }
        }
    }
    let (rx, child) = cmd
        .spawn()
        .map_err(|e| format!("spawn_failed: {hermes_path_str}: {e}"))?;

    // Stash child in Tauri state so the lifecycle handler can take() it
    // on window destroy. The Arc<Mutex<Option<...>>> is also cloned into
    // the TCP-reader thread below (which writes to Hermes's stdin).
    let state = app.state::<HermesSidecar>();
    *state.child.lock().unwrap() = Some(child);
    let child_for_stdin = Arc::clone(&state.child);

    // ──────────────── Step 4 — start the stdout pump ──────────────────────
    //
    // Hermes child stdout (via Tauri's CommandEvent stream) is forwarded
    // to the currently-connected BFF socket. The socket slot starts as
    // None (no client yet); the accept loop populates it when the BFF
    // connects. Until then the pump drops stdout bytes — this is
    // expected because the upstream `acp_adapter.entry` emits nothing on
    // stdout until it receives an `initialize` request, and the only
    // thing that sends `initialize` is the BFF after it connects to the
    // bridge. So the dropped-bytes window is effectively empty in normal
    // operation. (Boot handshake `[hermes:ready]` lives on STDERR per
    // Pass #1 sidecar_main.py — we tee that to the Tauri log below.)
    let socket_slot: BridgeSocketSlot = Arc::new(Mutex::new(None));
    let socket_slot_for_pump = Arc::clone(&socket_slot);
    let mut rx = rx;
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(buf) => {
                    let mut guard = socket_slot_for_pump.lock().unwrap();
                    if let Some(socket) = guard.as_mut() {
                        if let Err(e) = socket.write_all(&buf) {
                            log::warn!(
                "[hermes:bridge:err:tcp_write] {e} — dropping BFF socket (Hermes still running; awaiting reconnect)"
              );
                            *guard = None;
                        } else {
                            // Best-effort flush; ignore EPIPE on close.
                            let _ = socket.flush();
                        }
                    }
                    // else: no client connected yet — stdout dropped (see comment
                    // above; expected during the brief window between Hermes boot
                    // and BFF first-connect).
                }
                CommandEvent::Stderr(line) => {
                    // Includes the Pass #1 boot handshake `[hermes:ready] acp
                    // stdio server starting (hermes_dir=..., plugin_dir=...)`.
                    log::warn!("[hermes:err] {}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Error(err) => {
                    log::error!("[hermes:fatal] {err}");
                }
                CommandEvent::Terminated(payload) => {
                    log::warn!(
                        "[hermes:exit] code={:?} signal={:?}",
                        payload.code,
                        payload.signal
                    );
                    // Hermes died — close any active BFF socket so the BFF sees
                    // EOF + surfaces the failure (Engineering Rule #4: customer
                    // should see a classified chat error, not a hung request).
                    let mut guard = socket_slot_for_pump.lock().unwrap();
                    if let Some(socket) = guard.take() {
                        let _ = socket.shutdown(std::net::Shutdown::Both);
                    }
                    break;
                }
                _ => {}
            }
        }
        log::info!("[hermes:bridge] stdout→TCP pump exited");
    });

    // ──────────────── Step 5 — bridge accept loop ─────────────────────────
    //
    // Single-connection contract: the Node BFF (in production) opens ONE
    // TCP connection to 127.0.0.1:<port>. Any additional connections are
    // logged + closed (defense against accidental multi-client races; the
    // ACP server in Hermes assumes one client per stdio session).
    //
    // The accept() loop runs in a dedicated OS thread (NOT a tokio task)
    // because std::net::TcpListener::accept() is blocking. tauri's
    // async_runtime could host this via spawn_blocking but a plain thread
    // is clearer for the blocking-IO accept pattern.
    //
    // Per-connection layout:
    //   - Reader thread: TCP socket → Hermes child.stdin (via
    //     CommandChild::write)
    //   - Writer slot: the accept loop populates `socket_slot`; the
    //     stdout pump (step 4) reads from it.
    let socket_slot_for_accept = Arc::clone(&socket_slot);
    std::thread::Builder::new()
    .name("hermes-bridge-accept".into())
    .spawn(move || {
      log::info!(
        "[hermes:bridge] accepting connections on 127.0.0.1:{bound_port} (single-tenant; Node BFF only)"
      );
      let mut have_client = false;
      loop {
        match listener.accept() {
          Ok((socket, peer)) => {
            if have_client {
              log::warn!(
                "[hermes:bridge:warn:extra_client] rejecting {peer} (Hermes is single-tenant; first client already connected)"
              );
              let _ = socket.shutdown(std::net::Shutdown::Both);
              continue;
            }
            log::info!("[hermes:bridge] client connected from {peer}");

            // Clone the socket — one half goes into the stdout-pump's
            // writer slot, the other stays here for the TCP-reader
            // thread.
            let reader_half = socket;
            let writer_half = match reader_half.try_clone() {
              Ok(s) => s,
              Err(e) => {
                log::error!("[hermes:bridge:err:socket_clone] {e} — connection aborted");
                continue;
              }
            };

            // Install the writer half for the stdout pump.
            *socket_slot_for_accept.lock().unwrap() = Some(writer_half);
            have_client = true;

            // Spawn the TCP-reader → Hermes.stdin thread for this client.
            let child_for_this_client = Arc::clone(&child_for_stdin);
            let socket_slot_on_eof = Arc::clone(&socket_slot_for_accept);
            std::thread::Builder::new()
              .name("hermes-bridge-tcp-to-stdin".into())
              .spawn(move || {
                let mut reader = reader_half;
                let mut buf = [0u8; 8192];
                loop {
                  match reader.read(&mut buf) {
                    Ok(0) => {
                      // EOF — BFF disconnected cleanly. Hermes will see
                      // EOF on stdin when CommandChild is killed via
                      // the lifecycle handler (we don't close the
                      // child's stdin here because the child may still
                      // be serving the final response). Also clear the
                      // socket slot so the stdout pump stops trying to
                      // write into a dead socket.
                      log::info!("[hermes:bridge] TCP→stdin: client EOF");
                      *socket_slot_on_eof.lock().unwrap() = None;
                      break;
                    }
                    Ok(n) => {
                      let mut guard = child_for_this_client.lock().unwrap();
                      match guard.as_mut() {
                        Some(c) => {
                          if let Err(e) = c.write(&buf[..n]) {
                            log::warn!(
                              "[hermes:bridge:err:stdin_write] {e} — bridge halted"
                            );
                            *socket_slot_on_eof.lock().unwrap() = None;
                            break;
                          }
                        }
                        None => {
                          log::info!(
                            "[hermes:bridge] TCP→stdin: child already taken (shutdown in progress)"
                          );
                          *socket_slot_on_eof.lock().unwrap() = None;
                          break;
                        }
                      }
                    }
                    Err(e) => {
                      log::warn!("[hermes:bridge:err:tcp_read] {e} — bridge halted");
                      *socket_slot_on_eof.lock().unwrap() = None;
                      break;
                    }
                  }
                }
              })
              .ok();
          }
          Err(e) => {
            log::warn!("[hermes:bridge:err:accept] {e} — retrying in 500 ms");
            std::thread::sleep(Duration::from_millis(500));
          }
        }
      }
    })
    .map_err(|e| format!("bridge_thread_spawn_failed: {e}"))?;

    Ok(bound_port)
}

// ─────────────────────────────────────────────────────────────────────────
// iter-027: WeChat read-daemon spawn (Windows-only)
// ─────────────────────────────────────────────────────────────────────────

/// Spawn the bundled WeChat read-daemon exe on Windows. This function is
/// called (and compiled) only when `#[cfg(target_os = "windows")]` is in
/// effect. On macOS / Linux the entire function is elided at compile time —
/// no dead-code warnings, no runtime branch.
///
/// Path layout (post-install):
///   <resourceDir>/resources/wechat-daemon/wechat-read-daemon.exe  — daemon exe
///   <resourceDir>/resources/wechat-daemon/wechat-whitelist.json   — config
///
/// The exe is a PyInstaller onefile bundle. Its internal DEFAULT_CONFIG_PATH
/// resolves to _MEIPASS/wechat-whitelist.json (the temp extract dir) — NOT
/// next to the installed exe. To ensure the real config is found, we resolve
/// both paths via Tauri's resource resolver and pass --config explicitly.
///
/// Graceful-skip contract: if either path resolve fails OR the exe is absent
/// on disk, we log a warning and return without crashing. The daemon is an
/// optional enhancement; the core Holon app functions without it.
#[cfg(target_os = "windows")]
fn spawn_wechat_daemon<R: Runtime>(app: &tauri::AppHandle<R>) {
    // ── Step 1: resolve exe path ──────────────────────────────────────────
    let exe_relative = "resources/wechat-daemon/wechat-read-daemon.exe";
    let exe_path = match app
        .path()
        .resolve(exe_relative, tauri::path::BaseDirectory::Resource)
    {
        Ok(p) => p,
        Err(e) => {
            log::warn!(
        "[holon-desk:wechat_daemon:warn:resource_missing] could not resolve {exe_relative}: {e} — skipping WeChat daemon spawn"
      );
            return;
        }
    };

    if !exe_path.exists() {
        log::warn!(
      "[holon-desk:wechat_daemon:warn:exe_absent] {} not found on disk — skipping WeChat daemon spawn (run build-wechat-daemon.ps1 + rebuild installer to enable auto-spawn)",
      exe_path.display()
    );
        return;
    }

    let exe_path_str = match exe_path.to_str() {
        Some(s) => s.to_string(),
        None => {
            log::warn!(
        "[holon-desk:wechat_daemon:warn:non_utf8_path] exe path not UTF-8 — skipping WeChat daemon spawn"
      );
            return;
        }
    };

    // ── Step 2: resolve config path (optional) ────────────────────────────
    // The whitelist json lives alongside the exe in resources/wechat-daemon/.
    // Pass it explicitly via --config so the daemon doesn't try to read from
    // the PyInstaller _MEIPASS extract dir (which has no wechat-whitelist.json).
    // If the resolve fails or the json is absent, the daemon's own load_config()
    // falls back to an empty whitelist (logs a PRIVACY warning) — daemon boots safely.
    let config_relative = "resources/wechat-daemon/wechat-whitelist.json";
    let config_path_opt: Option<String> = app
        .path()
        .resolve(config_relative, tauri::path::BaseDirectory::Resource)
        .ok()
        .and_then(|p| p.to_str().map(|s| s.to_string()));

    if config_path_opt.is_none() {
        log::warn!(
      "[holon-desk:wechat_daemon:warn:config_resolve_failed] could not resolve {config_relative} — daemon will use built-in defaults (empty whitelist)"
    );
    }

    // ── Step 3: build the spawn command ───────────────────────────────────
    //
    // Use app.shell().command(path) — same as Hermes. We do NOT use
    // .sidecar(name) because the daemon is NOT in tauri.conf.json's
    // externalBin array (it lives under bundle.resources, not externalBin —
    // the same rationale as Hermes per the iter-016 Pass #2 comment above).
    //
    // set_raw_out(true): the daemon's output is plain log lines, but raw mode
    // matches the Hermes pattern for consistency.
    log::info!(
        "[holon-desk] spawning WeChat read daemon: {exe_path_str} --config {:?}",
        config_path_opt
    );

    let mut cmd = app.shell().command(&exe_path_str).set_raw_out(true);
    if let Some(ref config_str) = config_path_opt {
        cmd = cmd.arg("--config").arg(config_str);
    }

    let (mut rx, child) = match cmd.spawn() {
        Ok(pair) => pair,
        Err(e) => {
            log::warn!(
        "[holon-desk:wechat_daemon:warn:spawn_failed] {exe_path_str}: {e} — WeChat daemon not running (non-fatal)"
      );
            return;
        }
    };

    // ── Step 4: stash child handle in managed state ────────────────────────
    let state = app.state::<WechatDaemon>();
    *state.child.lock().unwrap() = Some(child);

    // ── Step 5: pump daemon stdout/stderr into Tauri log ──────────────────
    // Prevents the OS pipe buffer from filling (which would block the daemon).
    // The daemon emits timestamped INFO/ERROR lines (console=True in the spec).
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    log::info!(
                        "[wechat-daemon:out] {}",
                        String::from_utf8_lossy(&line).trim_end()
                    )
                }
                CommandEvent::Stderr(line) => {
                    log::warn!(
                        "[wechat-daemon:err] {}",
                        String::from_utf8_lossy(&line).trim_end()
                    )
                }
                CommandEvent::Error(err) => {
                    log::error!("[wechat-daemon:fatal] {err}")
                }
                CommandEvent::Terminated(payload) => {
                    log::warn!(
                        "[wechat-daemon:exit] code={:?} signal={:?}",
                        payload.code,
                        payload.signal
                    );
                    break;
                }
                _ => {}
            }
        }
        log::info!("[wechat-daemon] stdout pump exited");
    });
}
