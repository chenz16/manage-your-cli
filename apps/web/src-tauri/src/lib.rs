// Holon desktop shell (Tauri 2.x) — wraps apps/web Next.js as a native window.
//
// Architecture (lifted from sister repo holon-engineering, Hermes-stripped):
//
// Next.js `output: 'standalone'` produces a Node server bundle (server.js +
// a copy of node_modules) — NOT a static asset folder Tauri's webview can
// serve directly. So we:
//   1. Bundle Node.js as a Tauri sidecar (binaries/node-<triple>).
//   2. Bundle the standalone tree under resources/n/.
//   3. At app launch, spawn `node resources/n/apps/web/server.js` with
//      PORT=3000, HOSTNAME=127.0.0.1, NODE_ENV=production.
//   4. Webview opens http://127.0.0.1:3000/.
//   5. On main-window destroy, SIGTERM the Node child.
//
// NOTE: This scaffold deliberately does NOT include a Hermes ACP sidecar.
// Manage-Your-CLI is CLI-only (per CLAUDE.md "thin shell" North Star) —
// there is no Python ACP runtime to spawn. Compare with sister repo
// holon-engineering @ apps/web/src-tauri/src/lib.rs which still ships
// HOLON_HERMES_PORT + stdio↔TCP bridge code; both have been removed here.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};

use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the spawned Node sidecar child so we can SIGTERM it on quit.
/// `Mutex<Option<...>>` because Tauri's `manage()` requires `Sync` and
/// we need interior mutability to `take()` the child during shutdown.
#[derive(Default)]
struct NodeSidecar {
    child: Arc<Mutex<Option<CommandChild>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(NodeSidecar::default())
        .setup(|app| {
            // Initialize log plugin UNCONDITIONALLY so production setup() failures
            // leave a diagnosable trail on disk. Level: Trace in debug, Info in release.
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

            // Dev mode: Next dev-server owns :3000 (via beforeDevCommand `pnpm dev`).
            // Skip the Node sidecar spawn entirely — the webview points at
            // http://localhost:3000 in both modes; only the source differs.
            if cfg!(debug_assertions) {
                log::info!(
                    "[holon-desk] dev mode — skipping Node sidecar spawn; using Next dev-server on :3000"
                );
                return Ok(());
            }

            // Production: spawn the bundled Node + standalone server.js.
            //
            // Monorepo note: Next.js standalone output for a workspace package
            // (apps/web) preserves the workspace path inside the bundle, so
            // server.js lives at `apps/web/server.js` relative to the
            // standalone root — NOT at the bundle root.
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
            if !resource_path.is_file() {
                return Err(format!(
                    "[holon-desk:err:resource_missing] server.js not found at {}",
                    resource_path.display()
                )
                .into());
            }

            // Resolve OS-conventional per-app data dir and expose it to the Node
            // sidecar via HOLON_DATA_DIR. apps/web's DB layer reads this first
            // before any pnpm-workspace.yaml walk, so the standalone bundle
            // (resources/n/apps/web/) doesn't die looking for a dev-only marker.
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
                node_path_candidates
                    .push(resource_parent.join("binaries").join(tauri_sidecar_node_name));
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
                // Pin to 127.0.0.1 (loopback only — not exposed on LAN).
                .env("PORT", "3000")
                .env("HOSTNAME", "127.0.0.1")
                .env("NODE_ENV", "production")
                .env("HOLON_DATA_DIR", &data_dir_str);

            let (mut rx, child) = sidecar
                .spawn()
                .map_err(|e| format!("[holon-desk:err:spawn_failed] node sidecar: {e}"))?;

            // Stash the child handle so we can kill it on app quit.
            let state = app.state::<NodeSidecar>();
            *state.child.lock().unwrap() = Some(child);

            // Pump stdout/stderr into the log. Without this, the sidecar's pipe
            // buffer fills + the child eventually blocks.
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => log::info!(
                            "[holon-desk:sidecar:out] {}",
                            String::from_utf8_lossy(&line)
                        ),
                        CommandEvent::Stderr(line) => log::warn!(
                            "[holon-desk:sidecar:err] {}",
                            String::from_utf8_lossy(&line)
                        ),
                        CommandEvent::Error(err) => {
                            log::error!("[holon-desk:sidecar:fatal] {err}")
                        }
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

            Ok(())
        })
        // SIGTERM the Node sidecar when the main window is destroyed.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    let node_state = window.state::<NodeSidecar>();
                    if let Some(child) = node_state.child.lock().unwrap().take() {
                        log::info!("[holon-desk] killing Node sidecar on main-window destroy");
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
