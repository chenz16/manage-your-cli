import { NextResponse } from 'next/server';
import { captureCliOutput, getStaffMerged } from '@holon/core';

interface Context { params: Promise<{ id: string }> }

/**
 * GET /api/v1/staff/:id/cli/output?lines=N&hash=H — read-only snapshot of a CLI
 * staff's terminal (screen + scrollback). Does NOT send any input.
 *
 * Delta/conditional fetch: the client passes the `hash` it last saw. If the pane
 * is unchanged we return a tiny `{ ok, unchanged:true, hash }` instead of the
 * full screen — terminals are static most of the time, so this cuts the polled
 * payload ~95%. On change we return the full `{ ok, output, hash }`.
 *
 * Response: { ok, output?, hash?, unchanged?, reason? }
 */
function fastHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ':' + s.length.toString(36);
}

/**
 * condenseToolBlocks — Claude Code TUI renders tool calls as a header line
 * (starts with ● / ⏺ / ✓) followed by indented "⎿"-prefixed continuation
 * lines. On mobile these can be 20-100 lines and bury the signal. Owner:
 * 中间过程用省略号——头一行 + 末一行,中间塞 "⎿ …(N 行省略)"。
 *
 * Rule: a block has >3 continuation lines → keep first + last + ellipsis line.
 */
/**
 * stripLongPaths — drop the noisy absolute-path prefix so the visible part of
 * a status line is the meaningful tail. /home/chenz/project/myc-mobile/foo/bar.ts
 * → foo/bar.ts. ~ for home. Owner: "前面的路径删掉,多看有效信息"。
 */
function stripLongPaths(s: string): string {
  return s
    // repo-root absolute → relative
    .replace(/\/home\/chenz\/project\/myc-mobile\//g, '')
    .replace(/\/Users\/zuolinliu\/holon-mobile-build\//g, '')
    // user home → ~
    .replace(/\/home\/chenz\//g, '~/')
    .replace(/\/Users\/[a-z]+\//g, '~/');
}

function condenseToolBlocks(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  const HEADER_RE = /^\s*[●⏺✓⚒⏵]\s/u;
  const CONT_RE = /^\s{2,}/u;
  // Per-cell width truncation ONLY for status/update continuation lines.
  // Chinese counts as 2 cells, ASCII as 1. Normal text lines pass through.
  function isWide(cp: number): boolean {
    return (cp >= 0x1100 && cp <= 0x115F) || (cp >= 0x2E80 && cp <= 0xA4CF) ||
           (cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0xF900 && cp <= 0xFAFF) ||
           (cp >= 0xFE30 && cp <= 0xFE4F) || (cp >= 0xFF00 && cp <= 0xFF60) ||
           (cp >= 0xFFE0 && cp <= 0xFFE6) || cp >= 0x1F300;
  }
  function widthCap(s: string, max: number): string {
    let w = 0, out = '';
    for (const ch of s) {
      const cw = isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
      if (w + cw > max) return out + '…';
      out += ch; w += cw;
    }
    return out;
  }
  const STATUS_MAX = 38;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!HEADER_RE.test(line)) { out.push(line); i++; continue; }
    const header = line;
    const cont: string[] = [];
    let j = i + 1;
    while (j < lines.length && CONT_RE.test(lines[j] ?? '')) { cont.push(lines[j] ?? ''); j++; }
    // Truncate each continuation line by visual cell width.
    const capped = cont.map((c) => widthCap(c, STATUS_MAX));
    if (capped.length > 3) {
      const first = capped[0] ?? '';
      const last = capped[capped.length - 1] ?? '';
      const prefix = (cont[0]?.match(/^\s+/u)?.[0]) ?? '  ';
      out.push(header, first, `${prefix}⎿ …(省略 ${capped.length - 2} 行)`, last);
    } else {
      out.push(header, ...capped);
    }
    i = j;
  }
  return out.join('\n');
}
export async function GET(req: Request, ctx: Context): Promise<NextResponse> {
  const { id } = await ctx.params;
  // BUG-006: a missing staff is a distinct 404, not a no_session (which the
  // mobile terminal renders as "session not running").
  if (!getStaffMerged(id)) {
    return NextResponse.json({ ok: false, error: 'staff not found', code: 'not_found' }, { status: 404 });
  }
  // BUG-009: if `lines` is present it must be a positive integer — don't silently
  // fall back to 200 on garbage input.
  const rawLines = new URL(req.url).searchParams.get('lines');
  let lines = 200;
  if (rawLines !== null) {
    const n = Number(rawLines);
    if (!Number.isInteger(n) || n <= 0) {
      return NextResponse.json({ ok: false, error: 'lines must be a positive integer', code: 'invalid_lines' }, { status: 400 });
    }
    lines = n;
  }
  const r = captureCliOutput(id, lines);
  // no_session (running worker absent) is a 409 Conflict, not a 400.
  if (!r.ok) return NextResponse.json(r, { status: 409 });

  const rawOutput = stripLongPaths(r.output ?? '');
  const output = condenseToolBlocks(rawOutput);
  const hash = fastHash(output);
  const clientHash = new URL(req.url).searchParams.get('hash');
  if (clientHash && clientHash === hash) {
    // Unchanged since the client's last poll — skip the full payload.
    return NextResponse.json({ ok: true, unchanged: true, hash }, { status: 200 });
  }
  return NextResponse.json({ ok: true, output, hash }, { status: 200 });
}
