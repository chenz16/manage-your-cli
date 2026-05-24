/**
 * CLI session service — manage tmux-backed terminals for CLI staff.
 *
 * iter-007 step 8 (passthrough mode). Per user 2026-05-16:
 *   "本地也可以直接access 我的app也可以access 就是透彻 这样能随时监管"
 *
 * Design: each CLI staff gets at most ONE tmux session named
 * `holon-<staff_id>`. Holon BFF spawns/manages it; web/mobile UI
 * attaches via SSE for output + POST for input. Local terminal can
 * ALSO attach simultaneously via `tmux a -t holon-<staff_id>` — the
 * whole point is "monitor anytime, anywhere."
 *
 * tmux gives us for free:
 *   - persistent session across Node restarts
 *   - multi-attach (multiple browsers + local terminal)
 *   - scrollback buffer for late-attaching clients
 *   - PTY emulation without an npm dep
 *
 * Engineering rules:
 *   - Rule 4 (no silent failure): all subprocess errors return
 *     {ok:false, reason} not raised exceptions.
 *   - Rule 6 (owner-mediated authority): launch is owner-initiated
 *     via the BFF; no external trigger.
 *   - Rule 8 (audit emit after state change): launch / kill / input
 *     each log an `audit:` line.
 */

import { spawnSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, statSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { getStaffMerged } from './staff-management-service.js';
import { ensureAgentMemoryFile } from './cli-memory-scaffold.js';
import { getCliAdapter } from './cli-adapters.js';

const TMUX = 'tmux';
const FIFO_DIR = join(tmpdir(), 'holon-cli');

interface SessionState {
  staffId: string;
  tmuxName: string;
  fifoPath: string;
  tailProc: ChildProcess | null;
  /** Buffered tail output — sent to late-joining SSE clients so they
   *  see scrollback. Capped at MAX_BUFFER_BYTES. */
  buffer: string;
  /** Subscribers for live output. Each is a callback that receives
   *  raw bytes as the tail process emits them. */
  subscribers: Set<(chunk: string) => void>;
}

const MAX_BUFFER_BYTES = 64 * 1024; // ~64KB scrollback per session

interface GlobalState { sessions: Map<string, SessionState> }
const G = globalThis as unknown as { __holonCli?: GlobalState };
if (!G.__holonCli) G.__holonCli = { sessions: new Map() };
const ST = G.__holonCli;

function tmuxSessionName(staffId: string): string {
  // tmux session names can't contain `.` or `:` — strip them.
  return `holon-${staffId.replace(/[.:]/g, '-')}`;
}

/** Single-quote a string for safe interpolation into a bash command. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Default working dir for a CLI staff with no cwd set: a per-staff folder under
 *  ~/holon-agents. It's the agent's workspace AND memory anchor (CLAUDE.md +
 *  resumable session both live here). */
function defaultCwdFor(staffId: string): string {
  return join(homedir(), 'holon-agents', staffId.replace(/[^A-Za-z0-9_-]/g, '_'));
}

/** Pre-accept Claude Code's per-folder trust dialog so an auto-launched `claude`
 *  starts straight into its input instead of stalling on "Is this a project you
 *  trust? 1.Yes 2.No" (which otherwise drops the session to bash). Writes
 *  projects[cwd].hasTrustDialogAccepted=true in ~/.claude.json. Best-effort:
 *  on any failure claude just shows the prompt as before. */
function pretrustClaudeFolder(cwd: string): void {
  const cfgPath = join(homedir(), '.claude.json');
  if (!existsSync(cfgPath)) return; // claude not set up here — nothing to do
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
    if (typeof cfg !== 'object' || cfg === null) return;
    const projects = (cfg.projects && typeof cfg.projects === 'object')
      ? (cfg.projects as Record<string, Record<string, unknown>>)
      : ((cfg.projects = {}) as Record<string, Record<string, unknown>>);
    const entry = (projects[cwd] && typeof projects[cwd] === 'object') ? projects[cwd] : (projects[cwd] = {});
    if (entry.hasTrustDialogAccepted === true) return; // already trusted
    entry.hasTrustDialogAccepted = true;
    const tmp = `${cfgPath}.holon.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(cfg, null, 2));
    renameSync(tmp, cfgPath); // atomic-ish swap to minimise the clobber window
  } catch (err) {
    console.warn('[cli-session] pretrustClaudeFolder failed (claude will show its trust prompt):', err instanceof Error ? err.message : String(err));
  }
}

/** The tmux session this staff's I/O targets. Mode B (attach existing): the
 *  staff's `external_session` (an owner-run session). Otherwise (mode A):
 *  Holon's own `holon-<staffId>`. */
function sessionNameForStaff(staffId: string): string {
  const sub = getStaffMerged(staffId)?.substrate;
  if (sub?.kind === 'cli_agent' && sub.external_session?.trim()) {
    return sub.external_session.trim();
  }
  return tmuxSessionName(staffId);
}

/** True when this staff attaches to an owner-run session (mode B). */
function isExternalSession(staffId: string): boolean {
  const sub = getStaffMerged(staffId)?.substrate;
  return !!(sub?.kind === 'cli_agent' && sub.external_session?.trim());
}

function fifoPathFor(staffId: string): string {
  if (!existsSync(FIFO_DIR)) mkdirSync(FIFO_DIR, { recursive: true });
  return join(FIFO_DIR, `${staffId}.fifo`);
}

function tmuxHasSession(name: string): boolean {
  const r = spawnSync(TMUX, ['has-session', '-t', name], { stdio: 'ignore' });
  return r.status === 0;
}

function emit(staffId: string, evt: 'cli.launched' | 'cli.killed' | 'cli.input', detail?: Record<string, unknown>): void {
  console.log(JSON.stringify({ audit: evt, staff_id: staffId, ts: new Date().toISOString(), ...(detail ?? {}) }));
}

/* ── Public API ────────────────────────────────────────────────────── */

export interface LaunchResult {
  ok: true;
  staff_id: string;
  tmux_name: string;
  already_running: boolean;
  local_attach_cmd: string;
}
export interface LaunchError { ok: false; reason: string }

export function launchCliSession(staffId: string): LaunchResult | LaunchError {
  const staff = getStaffMerged(staffId);
  if (!staff) return { ok: false, reason: 'staff_not_found' };
  // ADR-029 Phase B: both `'cli'` (legacy alias) and `'cli_agent'` (canonical)
  // resolve to a CLI-agent session. Drop the `'cli'` branch in V2.
  if (staff.substrate.kind !== 'cli' && staff.substrate.kind !== 'cli_agent') {
    return { ok: false, reason: `substrate_not_cli_agent (${staff.substrate.kind})` };
  }

  const name = sessionNameForStaff(staffId);

  // Already running? Just ensure our tail is attached + return.
  if (tmuxHasSession(name)) {
    ensureTailAttached(staffId);
    return {
      ok: true, staff_id: staffId, tmux_name: name,
      already_running: true,
      local_attach_cmd: `tmux a -t ${name}`,
    };
  }

  // Mode B (attach existing): we never create or auto-launch an owner-run
  // session — it must already exist. Surface a clear error if it doesn't.
  if (isExternalSession(staffId)) {
    return { ok: false, reason: `external tmux session '${name}' not found — start it first, e.g. tmux new -s ${name}` };
  }

  // ADR-040: auto-launch the agent binary (e.g. `claude
  // --dangerously-skip-permissions`) in the owner-selected working dir so the
  // owner doesn't have to type anything — full automation. We still run it
  // INSIDE a login shell and `exec bash -l -i` AFTER it exits, so a missing /
  // mis-pathed binary (or the agent quitting) drops to a normal shell instead
  // of tearing down the session. `auto_launch === false` keeps the old
  // hint-only behaviour. Legacy `kind: 'cli'` rows never auto-launch.
  const sub = staff.substrate;
  const binary = sub.kind === 'cli_agent' || sub.kind === 'cli' ? sub.binary : null;
  const argsTemplate = sub.kind === 'cli_agent' ? (sub.args_template ?? '') : '';
  // Every CLI staff gets a working dir: the owner's cwd, else a per-staff default
  // under ~/holon-agents (workspace + memory anchor). Never run in a random dir.
  const cwd = (sub.kind === 'cli_agent' && sub.cwd?.trim()) ? sub.cwd.trim() : (binary ? defaultCwdFor(staffId) : undefined);
  const autoLaunch = sub.kind === 'cli_agent' && !!binary && sub.auto_launch !== false;
  if (sub.kind === 'cli_agent' && sub.lifecycle === 'long' && cwd) {
    ensureAgentMemoryFile(cwd, staff, binary ?? '');
  }
  // Claude stalls on a first-time folder-trust prompt → pre-accept it so the
  // auto-launched agent starts straight into its input and stays alive.
  if (autoLaunch && binary && getCliAdapter(binary).pretrust && cwd) pretrustClaudeFolder(cwd);
  const banner = binary
    ? `echo '[holon] session for ${staff.name} (${binary})${autoLaunch ? '' : ' — type your commands'}.'`
    : `echo '[holon] session for ${staff.name}.'`;
  const cdPart = cwd ? `mkdir -p ${shQuote(cwd)} 2>/dev/null; cd ${shQuote(cwd)} 2>/dev/null; ` : '';
  const launchCmd = autoLaunch
    ? `${cdPart}${banner}; ${binary} ${argsTemplate}; echo '[holon] (agent exited — dropped to shell)'; exec bash -l -i`
    : `${cdPart}${banner}; exec bash -l -i`;
  // Start at a sane size (-x/-y) and pin window-size to manual: a detached tmux
  // session otherwise stays at the 80x24 default (our only "client" is a
  // pipe-pane cat, not a sized terminal), so xterm renders a differently-sized
  // grid and the cursor lands in the wrong place. The frontend calls
  // resizeCliSession() with the real xterm cols/rows right after it fits.
  const r = spawnSync(TMUX, ['new-session', '-d', '-s', name, '-x', '120', '-y', '32', 'bash', '-l', '-c', launchCmd], { stdio: 'pipe' });
  if (r.status !== 0) {
    return { ok: false, reason: `tmux new-session failed: ${r.stderr?.toString().slice(0, 200) ?? '?'}` };
  }
  spawnSync(TMUX, ['set-option', '-t', name, 'window-size', 'manual'], { stdio: 'pipe' });

  // Codex shows a blocking "✨ Update available! … 1. Update now / 2. Skip /
  // 3. Skip until next version" menu on first launch whenever a newer release
  // exists, stalling an auto-launched worker. The DEFAULT (bare Enter) is
  // "Update now", which runs `npm install -g` and then EXITS codex — killing the
  // worker. So we must pick "Skip" (2), and only when the menu is actually on
  // screen, never typing into a ready composer. Codex exposes no flag to disable
  // the check, so this screen-guarded keystroke is the safe option.
  if (autoLaunch && binary === 'codex') {
    for (const delayMs of [2500, 5000]) {
      setTimeout(() => {
        const cap = spawnSync(TMUX, ['capture-pane', '-p', '-t', name], { stdio: 'pipe' });
        const screen = cap.stdout?.toString() ?? '';
        if (!/Update available|Skip until next version/i.test(screen)) return;
        spawnSync(TMUX, ['send-keys', '-t', name, '2'], { stdio: 'pipe' });
        spawnSync(TMUX, ['send-keys', '-t', name, 'Enter'], { stdio: 'pipe' });
      }, delayMs);
    }
  }

  ensureTailAttached(staffId);
  emit(staffId, 'cli.launched', { binary_hint: binary, auto_launch: autoLaunch, tmux: name });

  return {
    ok: true, staff_id: staffId, tmux_name: name,
    already_running: false,
    local_attach_cmd: `tmux a -t ${name}`,
  };
}

export function sendKeys(staffId: string, input: string, withEnter = true): { ok: boolean; reason?: string } {
  const name = sessionNameForStaff(staffId);
  if (!tmuxHasSession(name)) return { ok: false, reason: 'no_session' };
  const args = ['send-keys', '-t', name, '-l', input];
  const r = spawnSync(TMUX, args, { stdio: 'pipe' });
  if (r.status !== 0) return { ok: false, reason: r.stderr?.toString().slice(0, 200) };
  if (withEnter) {
    spawnSync(TMUX, ['send-keys', '-t', name, 'Enter']);
  }
  emit(staffId, 'cli.input', { bytes: input.length, with_enter: withEnter });
  return { ok: true };
}

/** The command currently running in the session's active pane (e.g. 'bash',
 *  'node', 'claude', 'codex'). Used to tell "a CLI agent is running" from
 *  "we're at a bare shell prompt". Empty string on failure. */
export function paneCurrentCommand(staffId: string): string {
  const name = sessionNameForStaff(staffId);
  if (!tmuxHasSession(name)) return '';
  const r = spawnSync(TMUX, ['display-message', '-p', '-t', name, '#{pane_current_command}'], { stdio: 'pipe' });
  return r.status === 0 ? (r.stdout?.toString().trim() ?? '') : '';
}

/** Capture the session's current screen + scrollback (read-only, no input) so
 *  the Secretary can read what a worker did and summarise it. */
export function captureCliOutput(staffId: string, lines = 200): { ok: boolean; output?: string; reason?: string } {
  const name = sessionNameForStaff(staffId);
  if (!tmuxHasSession(name)) return { ok: false, reason: 'no_session' };
  const n = Math.max(1, Math.min(2000, Math.floor(lines)));
  const r = spawnSync(TMUX, ['capture-pane', '-p', '-t', name, '-S', `-${n}`], { stdio: 'pipe' });
  if (r.status !== 0) return { ok: false, reason: r.stderr?.toString().slice(0, 160) };
  return { ok: true, output: r.stdout?.toString() ?? '' };
}

/** Send a (possibly multi-line) PROMPT to the session as a single bracketed
 *  paste, then Enter — so a TUI agent (claude/codex) receives it as ONE prompt
 *  instead of executing each line. (Plain `send-keys -l` turns every embedded
 *  newline into a separate Enter → each line runs as its own command.) */
export function sendPrompt(staffId: string, text: string): { ok: boolean; reason?: string } {
  const name = sessionNameForStaff(staffId);
  if (!tmuxHasSession(name)) return { ok: false, reason: 'no_session' };
  const buf = `holon-prompt-${Date.now()}`;
  const load = spawnSync(TMUX, ['load-buffer', '-b', buf, '-'], { input: text, stdio: ['pipe', 'pipe', 'pipe'] });
  if (load.status !== 0) return { ok: false, reason: `load-buffer failed: ${load.stderr?.toString().slice(0, 160) ?? '?'}` };
  const paste = spawnSync(TMUX, ['paste-buffer', '-d', '-b', buf, '-t', name], { stdio: 'pipe' });
  if (paste.status !== 0) return { ok: false, reason: `paste-buffer failed: ${paste.stderr?.toString().slice(0, 160) ?? '?'}` };
  spawnSync(TMUX, ['send-keys', '-t', name, 'Enter']);
  emit(staffId, 'cli.input', { bytes: text.length, paste: true });
  return { ok: true };
}

/** Resize the tmux window to match the frontend xterm grid so the cursor and
 *  line wrapping line up. Called by the CliTerminal after it fits. */
export function resizeCliSession(staffId: string, cols: number, rows: number): { ok: boolean; reason?: string } {
  const name = sessionNameForStaff(staffId);
  if (!tmuxHasSession(name)) return { ok: false, reason: 'no_session' };
  const c = Math.max(20, Math.min(500, Math.floor(cols)));
  const rr = Math.max(5, Math.min(200, Math.floor(rows)));
  if (!Number.isFinite(c) || !Number.isFinite(rr)) return { ok: false, reason: 'bad_dimensions' };
  const r = spawnSync(TMUX, ['resize-window', '-t', name, '-x', String(c), '-y', String(rr)], { stdio: 'pipe' });
  if (r.status !== 0) return { ok: false, reason: r.stderr?.toString().slice(0, 200) };
  return { ok: true };
}

export function killCliSession(staffId: string): { ok: boolean; reason?: string } {
  const name = sessionNameForStaff(staffId);
  const sess = ST.sessions.get(staffId);
  if (sess?.tailProc) {
    try { sess.tailProc.kill('SIGTERM'); } catch { /* ignore */ }
  }
  if (sess?.fifoPath && existsSync(sess.fifoPath)) {
    try { unlinkSync(sess.fifoPath); } catch { /* ignore */ }
  }
  ST.sessions.delete(staffId);

  // Mode B: never kill an owner-run session — just detach Holon's tail (done
  // above). The owner owns that session's lifecycle.
  if (isExternalSession(staffId)) {
    emit(staffId, 'cli.killed', { detached_only: true });
    return { ok: true };
  }

  if (!tmuxHasSession(name)) return { ok: true };
  const r = spawnSync(TMUX, ['kill-session', '-t', name]);
  if (r.status !== 0) return { ok: false, reason: r.stderr?.toString().slice(0, 200) };
  emit(staffId, 'cli.killed');
  return { ok: true };
}

export interface CliStatus {
  staff_id: string;
  running: boolean;
  tmux_name: string;
  fifo_path: string | null;
  local_attach_cmd: string;
  subscriber_count: number;
  buffer_bytes: number;
}

export function getCliStatus(staffId: string): CliStatus {
  const name = sessionNameForStaff(staffId);
  const sess = ST.sessions.get(staffId);
  return {
    staff_id: staffId,
    running: tmuxHasSession(name),
    tmux_name: name,
    fifo_path: sess?.fifoPath ?? null,
    local_attach_cmd: `tmux a -t ${name}`,
    subscriber_count: sess?.subscribers.size ?? 0,
    buffer_bytes: sess?.buffer.length ?? 0,
  };
}

/**
 * Subscribe to live output. Returns the scrollback buffer immediately
 * and an unsubscribe function. The output callback fires for every
 * subsequent chunk tmux emits.
 */
export function subscribeOutput(
  staffId: string,
  onChunk: (chunk: string) => void,
): { unsubscribe: () => void; scrollback: string } {
  ensureTailAttached(staffId);
  const sess = ST.sessions.get(staffId);
  if (!sess) return { unsubscribe: () => {}, scrollback: '' };
  sess.subscribers.add(onChunk);
  return {
    scrollback: sess.buffer,
    unsubscribe: () => { sess.subscribers.delete(onChunk); },
  };
}

/* ── Internals ─────────────────────────────────────────────────────── */

function ensureTailAttached(staffId: string): void {
  const name = sessionNameForStaff(staffId);
  let sess = ST.sessions.get(staffId);
  if (sess?.tailProc && !sess.tailProc.killed) return; // already tailing

  const fifoPath = sess?.fifoPath ?? fifoPathFor(staffId);

  // mkfifo if needed (Linux/Mac). Skip if already exists as a fifo.
  if (!existsSync(fifoPath)) {
    spawnSync('mkfifo', [fifoPath]);
  }

  // Wire tmux's pane output into the fifo. -o = open file in append+overwrite
  // mode; -O = clear previous pipe before starting (so we don't duplicate).
  spawnSync(TMUX, ['pipe-pane', '-t', name, '-O', `cat > ${fifoPath}`]);

  // Tail the fifo. `cat` blocks until something writes; we keep it open.
  const tail = spawn('cat', [fifoPath], { stdio: ['ignore', 'pipe', 'pipe'] });

  if (!sess) {
    sess = {
      staffId, tmuxName: name, fifoPath,
      tailProc: tail, buffer: '', subscribers: new Set(),
    };
    ST.sessions.set(staffId, sess);
  } else {
    sess.tailProc = tail;
    sess.fifoPath = fifoPath;
  }
  const s = sess; // captured for closures

  tail.stdout.on('data', (b: Buffer) => {
    const chunk = b.toString('utf-8');
    s.buffer = (s.buffer + chunk).slice(-MAX_BUFFER_BYTES);
    for (const sub of s.subscribers) {
      try { sub(chunk); } catch { /* dropped sub */ }
    }
  });
  tail.on('exit', () => {
    s.tailProc = null;
  });
}

export function clearAllCliSessions(): { killed: number } {
  let n = 0;
  for (const staffId of Array.from(ST.sessions.keys())) {
    killCliSession(staffId);
    n += 1;
  }
  return { killed: n };
}
