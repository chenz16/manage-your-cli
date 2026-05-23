/**
 * Bug-disk reader. Used to be an auto-dispatching watcher (tmux + claude
 * code) but that path was retired 2026-05-17 per user:
 *
 *   "还是我们主开发平台 使用agent 扫描了 不用单独开的那个tmux"
 *
 * The new flow: bug filed via /api/v1/admin/bugs → lands on disk in
 * `bugs/<id>/report.md` (+ optional screenshot.png). The owner pings
 * the main dev session ("scan bugs", or just mentions it in chat) and
 * Claude Code (this session, or a dispatched Agent subagent) reads
 * the bug + fixes it directly. Each fix writes `bugs/<id>/_processed.md`
 * so this module's listBugsWithStatus reader can surface "fixed /
 * needs-human / not-reproducible" in the BugQueue UI.
 *
 * What remains here:
 *   - listBugsWithStatus()  — read bugs/ + their marker files for UI display
 *   - reprocessBug(id)      — drop the marker files so the bug shows as
 *                             un-processed again (rescan trigger)
 *   - startBugWatcher() / stopBugWatcher() / bugWatcherStatus() — kept
 *                             as no-op stubs so existing callers don't
 *                             break. They're free to delete on cleanup.
 *
 * What's gone: the 30s setInterval tick loop, the tmux session
 * pre-launch, the per-bug `claude -p '<prompt>'` dispatch, the
 * `_dispatched.md` / stale-timeout machinery, and the legacy
 * `dispatched` field in BugStatus (D2, 2026-05-20). `_processed.md`
 * is the canonical marker; `_dispatched.md` is fully retired.
 */

import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { listJobs } from './mutable-store.js';

function findRepoRoot(): string {
  if (process.env.HOLON_REPO_ROOT) return process.env.HOLON_REPO_ROOT;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
const HOLON_REPO_ROOT = findRepoRoot();
const BUGS_DIR = join(HOLON_REPO_ROOT, 'bugs');

// No-op stubs — retained so older imports don't break.
export function startBugWatcher(): void { /* retired 2026-05-17 */ }
export function stopBugWatcher(): void { /* retired 2026-05-17 */ }
export function bugWatcherStatus(): { running: boolean; bugs_dir: string } {
  return { running: false, bugs_dir: BUGS_DIR };
}

/* ── Bug-list-with-status reader (UI consumer) ──────────────────── */

export interface BugStatus {
  id: string;
  filed_at: string;
  processed: boolean;
  /** Legacy field — older bugs may carry _no_dispatch.md from when
   *  the auto-dispatch flow was live. Always false for new bugs. */
  no_dispatch: boolean;
  status?: 'fixed' | 'needs-human' | 'not-reproducible' | 'unknown';
  diagnosis?: string;
  files_changed?: string[];
  job_id?: string;
  job_status?: string;
  deliverable_id?: string;
  description_preview: string;
}

export function listBugsWithStatus(): BugStatus[] {
  if (!existsSync(BUGS_DIR)) return [];
  const out: BugStatus[] = [];
  for (const name of readdirSync(BUGS_DIR)) {
    const dir = join(BUGS_DIR, name);
    let st;
    try { st = statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    if (!existsSync(join(dir, 'report.md'))) continue;

    let descPreview = '';
    try {
      const report = readFileSync(join(dir, 'report.md'), 'utf-8');
      const body = report.split(/\n---\n/)[1] ?? report;
      descPreview = body.trim().split('\n').slice(0, 2).join(' ').slice(0, 140);
    } catch { /* no report */ }

    const processedPath = join(dir, '_processed.md');
    const noDispatchPath = join(dir, '_no_dispatch.md');
    let processed = false;
    let status: BugStatus['status'] | undefined;
    let diagnosis: string | undefined;
    if (existsSync(processedPath)) {
      processed = true;
      try {
        const p = readFileSync(processedPath, 'utf-8');
        const m = /\*\*status:\*\*\s*(\S+)/i.exec(p);
        if (m && m[1]) {
          const s = m[1].toLowerCase();
          status = (s === 'fixed' || s === 'needs-human' || s === 'not-reproducible') ? s : 'unknown';
        }
        const d = /\*\*diagnosis:\*\*\s*([^\n]+)/i.exec(p);
        if (d && d[1]) diagnosis = d[1].trim();
      } catch { /* malformed */ }
    }
    const noDispatch = !processed && existsSync(noDispatchPath);

    const job = listJobs().find((j) => j.brief.includes(name));

    out.push({
      id: name,
      filed_at: st.birthtime.toISOString(),
      processed,
      no_dispatch: noDispatch,
      ...(status !== undefined ? { status } : {}),
      ...(diagnosis !== undefined ? { diagnosis } : {}),
      ...(job ? { job_id: job.id, job_status: job.status } : {}),
      ...(job?.deliverable_id ? { deliverable_id: job.deliverable_id } : {}),
      description_preview: descPreview,
    });
  }
  out.sort((a, b) => b.filed_at.localeCompare(a.filed_at));
  return out;
}

/** Drop _processed.md / _no_dispatch.md markers so the bug shows as
 *  un-processed again — owner-driven "please look at this one again"
 *  signal. (_dispatched.md retired D2 2026-05-20; _processed.md is
 *  the canonical marker.) */
export function reprocessBug(bugId: string): { ok: boolean; reason?: string } {
  const fs = require('node:fs') as typeof import('node:fs');
  let removed = 0;
  for (const marker of ['_processed.md', '_no_dispatch.md']) {
    const p = join(BUGS_DIR, bugId, marker);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); removed += 1; } catch { /* ignore */ }
    }
  }
  if (removed === 0) return { ok: false, reason: 'no_markers_to_clear' };
  return { ok: true };
}
