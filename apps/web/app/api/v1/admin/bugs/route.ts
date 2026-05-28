import { NextResponse } from 'next/server';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { listBugsWithStatus } from '@holon/core';

// ── GitHub issue creation (trusted-tester shortcut) ───────────────────────
// Activated only when HOLON_FEEDBACK_GITHUB_TOKEN is set.  Non-fatal:
// a GitHub failure never bubbles to the client — the local-disk save
// already succeeded.  See TECH-DEBT.md for the "move to server-side
// Worker before public launch" note.

type GitHubIssueResult =
  | { created: true; number: number; url: string }
  | { created: false; reason: string };

async function maybeCreateGitHubIssue(opts: {
  bugId: string;
  description: string;
  url: string;
  route: string;
  ts: string;
  screenshotCount: number;
}): Promise<GitHubIssueResult> {
  const token = process.env.HOLON_FEEDBACK_GITHUB_TOKEN ?? '';
  if (!token) return { created: false, reason: 'token_absent' };

  const repo =
    process.env.HOLON_FEEDBACK_GITHUB_REPO ?? 'chenz16/holon-engineering';

  // Title: "[feedback] <first 80 chars of description, single line>"
  const shortSummary = opts.description
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  const issueTitle = `[feedback] ${shortSummary}`;

  // Body: description + ## Context section
  const screenshotNote =
    opts.screenshotCount === 0
      ? 'None attached.'
      : `${opts.screenshotCount} screenshot(s) saved locally at \`bugs/${opts.bugId}/\` — not uploaded to GitHub (V1 policy).`;
  const body = [
    opts.description.trim(),
    '',
    '## Context',
    `| Field | Value |`,
    `|---|---|`,
    `| Bug ID | \`${opts.bugId}\` |`,
    `| URL | ${opts.url} |`,
    `| Route | \`${opts.route}\` |`,
    `| Timestamp | ${opts.ts} |`,
    `| Screenshots | ${screenshotNote} |`,
  ].join('\n');

  const apiUrl = `https://api.github.com/repos/${repo}/issues`;

  let res: Response;
  try {
    res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'holon-feedback',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: issueTitle,
        body,
        labels: ['customer-feedback'],
      }),
    });
  } catch (err: unknown) {
    // Network-level failure (DNS, timeout, ECONNREFUSED)
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      JSON.stringify({
        warn: 'github_issue.network_error',
        bug_id: opts.bugId,
        message: msg,
      }),
    );
    return { created: false, reason: `network_error: ${msg}` };
  }

  if (!res.ok) {
    // HTTP-level failure (401 bad token, 403 no scope, 422 validation)
    const category =
      res.status === 401
        ? 'auth_error'
        : res.status === 403
          ? 'forbidden'
          : res.status === 422
            ? 'validation_error'
            : 'http_error';
    console.warn(
      JSON.stringify({
        warn: `github_issue.${category}`,
        bug_id: opts.bugId,
        status: res.status,
      }),
    );
    return { created: false, reason: `${category}: HTTP ${res.status}` };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      JSON.stringify({
        warn: 'github_issue.parse_error',
        bug_id: opts.bugId,
        message: msg,
      }),
    );
    return { created: false, reason: `parse_error: ${msg}` };
  }

  if (
    typeof data !== 'object' ||
    data === null ||
    typeof (data as Record<string, unknown>).number !== 'number' ||
    typeof (data as Record<string, unknown>).html_url !== 'string'
  ) {
    console.warn(
      JSON.stringify({
        warn: 'github_issue.unexpected_shape',
        bug_id: opts.bugId,
      }),
    );
    return { created: false, reason: 'parse_error: unexpected response shape' };
  }

  const d = data as Record<string, unknown>;
  const issueNumber = d.number as number;
  const issueUrl = d.html_url as string;

  console.log(
    JSON.stringify({
      audit: 'github_issue.created',
      bug_id: opts.bugId,
      issue_number: issueNumber,
      issue_url: issueUrl,
    }),
  );

  return { created: true, number: issueNumber, url: issueUrl };
}

/**
 * POST /api/v1/admin/bugs — receive a bug report from the floating
 * BugReportButton and persist it to disk so Claude Code can triage.
 *
 * Per user 2026-05-16. v1 = file-on-disk queue, no DB. Each bug lands
 * in:
 *
 *   bugs/<ts>-<id>/
 *     report.md       (markdown — description + metadata)
 *     screenshot.<ext> (optional — decoded from data URL)
 *
 * The user invokes Claude Code (me) which lists bugs/ and walks
 * through them. No autonomous fixer worker yet — bug triage needs
 * human judgment to scope.
 */

/** Walk up from process.cwd() until we find pnpm-workspace.yaml — the
 *  repo root marker. Falls back to cwd if not found. MUST match
 *  packages/core/src/bug-watcher.ts findRepoRoot() exactly, or POST
 *  and watcher will disagree on where bugs live (cwd in dev is
 *  apps/web, not the repo root). */
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

interface BugScreenshot {
  data_url: string;
  filename: string | null;
}

interface BugPayload {
  description: string;
  url: string;
  route: string;
  // Optional: some clients (e.g. mobile) may omit these. Never dereference
  // without a guard — a missing viewport previously crashed the md template
  // AFTER mkdir, leaving an empty bug folder + a 500 "提交失败".
  viewport?: { w: number; h: number };
  user_agent?: string;
  ts: string;
  // Legacy single-screenshot fields — kept so older clients still work.
  screenshot_data_url?: string | null;
  screenshot_filename?: string | null;
  // 2026-05-17: multi-screenshot support. New clients send this; older
  // clients only populate the legacy fields above.
  screenshots?: BugScreenshot[];
  dispatch?: boolean;
}

// Hard cap on attachments accepted server-side. Matches MAX_SCREENSHOTS
// in apps/web/app/_components/BugReportButton.tsx.
const MAX_SCREENSHOTS = 5;

function isPayload(b: unknown): b is BugPayload {
  if (typeof b !== 'object' || b === null) return false;
  const r = b as Record<string, unknown>;
  return typeof r.description === 'string'
    && typeof r.url === 'string'
    && typeof r.ts === 'string';
}

function mintId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function tsSlug(iso: string): string {
  // 2026-05-16T18:30:00.000Z → 20260516-183000
  return iso.replace(/[-:.]/g, '').replace('T', '-').slice(0, 15);
}

function decodeDataUrl(dataUrl: string): { ext: string; bytes: Buffer } | null {
  // data:image/png;base64,iVBORw0KGgo...
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1] ?? 'image/png';
  const b64 = m[2] ?? '';
  const ext = mime.split('/')[1]?.split('+')[0] ?? 'bin';
  return { ext, bytes: Buffer.from(b64, 'base64') };
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!isPayload(body)) {
    return NextResponse.json({ error: 'invalid payload shape' }, { status: 400 });
  }
  if (!body.description.trim()) {
    return NextResponse.json({ error: 'description required' }, { status: 400 });
  }

  const bug_id = `bug-${tsSlug(body.ts)}-${mintId()}`;
  const dir = join(BUGS_DIR, bug_id);
  mkdirSync(dir, { recursive: true });

  // Normalize the screenshot inputs: prefer the new `screenshots[]`
  // array, else fall back to the legacy single fields. Cap at
  // MAX_SCREENSHOTS to bound disk + agent context.
  const dataUrls: string[] = [];
  if (Array.isArray(body.screenshots) && body.screenshots.length > 0) {
    for (const s of body.screenshots) {
      if (s && typeof s.data_url === 'string') dataUrls.push(s.data_url);
    }
  } else if (body.screenshot_data_url) {
    dataUrls.push(body.screenshot_data_url);
  }

  const screenshotNames: string[] = [];
  for (let i = 0; i < dataUrls.length && screenshotNames.length < MAX_SCREENSHOTS; i++) {
    const dataUrl = dataUrls[i];
    if (!dataUrl) continue;
    const dec = decodeDataUrl(dataUrl);
    if (!dec) continue;
    // First file keeps the canonical `screenshot.<ext>` name so the
    // bug-fix agent's existing screenshot-pickup path is unchanged.
    const name = i === 0
      ? `screenshot.${dec.ext}`
      : `screenshot-${i + 1}.${dec.ext}`;
    writeFileSync(join(dir, name), dec.bytes);
    screenshotNames.push(name);
  }

  const screenshotLine = screenshotNames.length === 0
    ? '(none)'
    : screenshotNames.length === 1
      ? screenshotNames[0]
      : screenshotNames.join(', ');

  const md =
`# ${bug_id}

**Filed:** ${body.ts}
**Route:** ${body.route}
**URL:** ${body.url}
**Viewport:** ${body.viewport ? `${body.viewport.w}×${body.viewport.h}` : '(unknown)'}
**User-Agent:** \`${body.user_agent ?? '(unknown)'}\`
**Screenshot:** ${screenshotLine}

---

${body.description.trim()}
`;
  writeFileSync(join(dir, 'report.md'), md);

  console.log(JSON.stringify({
    audit: 'bug.filed',
    bug_id,
    route: body.route,
    description_preview: body.description.slice(0, 100),
    has_screenshot: screenshotNames.length > 0,
    screenshot_count: screenshotNames.length,
    ts: body.ts,
  }));

  // 2026-05-17: auto-dispatch via Maintenance tmux retired per user
  // ("还是我们主开发平台 使用agent 扫描了"). Bugs just sit on disk
  // until the owner pings their main dev session (this Claude Code
  // process, or a dispatched Agent subagent) to scan + fix. The
  // body.dispatch flag is ignored now; kept on the payload schema
  // only so the older BugReportButton field doesn't blow up.

  // 2026-05-20: Also open a GitHub issue when HOLON_FEEDBACK_GITHUB_TOKEN
  // is set (trusted-tester shortcut; see TECH-DEBT.md D-github-feedback).
  // Runs AFTER the local-disk write — a GitHub failure never fails the
  // request.  Non-blocking: the local save already succeeded.
  const ghResult = await maybeCreateGitHubIssue({
    bugId: bug_id,
    description: body.description,
    url: body.url,
    route: body.route,
    ts: body.ts,
    screenshotCount: screenshotNames.length,
  });

  // NOTE: don't leak the absolute filesystem path back to the client
  // — that exposes the host machine's directory layout. The bug_id is
  // sufficient for the user to know the report was filed; the path
  // (under `bugs/`) is implicit + only meaningful to the dev process.
  // github_issue is optional in the response (backward-compatible):
  // absent when token not set, present when issue was opened or attempted.
  const responseBody: {
    ok: true;
    bug_id: string;
    location: string;
    github_issue?: { created: boolean; number?: number; url?: string; reason?: string };
  } = { ok: true, bug_id, location: `bugs/${bug_id}` };

  if (ghResult.created) {
    responseBody.github_issue = {
      created: true,
      number: ghResult.number,
      url: ghResult.url,
    };
  } else if (ghResult.reason !== 'token_absent') {
    // Token was set but GitHub step failed — surface in response so UI
    // can note "issue not opened" without breaking the success toast.
    responseBody.github_issue = { created: false, reason: ghResult.reason };
  }
  // token_absent → omit github_issue entirely (token-not-configured is
  // not an error; callers that don't know about GitHub just get ok+bug_id)

  return NextResponse.json(responseBody, { status: 201 });
}

/** GET — list known bugs with rich status (most recent first). */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ items: listBugsWithStatus() });
}

export const dynamic = 'force-dynamic';
