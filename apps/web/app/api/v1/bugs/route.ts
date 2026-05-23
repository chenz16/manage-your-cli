import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * /api/v1/bugs — file + list bug reports as plain markdown.
 *
 * Bugs are one markdown file each (YYYY-MM-DD-<slug>.md), matching the
 * bugs/README.md convention so Claude can scan + fix them. Stored in
 * BUGS_DIR: default ~/.holon/bugs, or set HOLON_BUGS_DIR to the repo's
 * bugs/ folder so filed bugs land where Claude already looks.
 */
export const dynamic = 'force-dynamic';

function bugsDir(): string {
  return process.env.HOLON_BUGS_DIR || path.join(os.homedir(), '.holon', 'bugs');
}

function slugify(s: string): string {
  return (
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'bug'
  );
}

function isErrno(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === code;
}

export async function GET() {
  const dir = bugsDir();
  try {
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.md')).sort().reverse();
    const items = await Promise.all(
      names.map(async (name) => {
        const body = await fs.readFile(path.join(dir, name), 'utf8');
        const title = body.split('\n').find((l) => l.startsWith('# '))?.slice(2).trim() ?? name;
        return { name, title, body };
      }),
    );
    return NextResponse.json({ items });
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return NextResponse.json({ items: [] }); // dir not created yet
    return NextResponse.json({ error: 'read_failed', detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let payload: { title?: string; where?: string; saw?: string; expected?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  const title = (payload.title ?? '').trim();
  if (!title) return NextResponse.json({ error: 'title_required' }, { status: 400 });

  const date = new Date().toISOString().slice(0, 10);
  const md = [
    `# ${title}`,
    '',
    `**Where:** ${(payload.where ?? '').trim() || '—'}`,
    `**Saw:** ${(payload.saw ?? '').trim() || '—'}`,
    `**Expected:** ${(payload.expected ?? '').trim() || '—'}`,
    '',
    `_Filed ${new Date().toISOString()} via app_`,
    '',
  ].join('\n');

  const dir = bugsDir();
  try {
    await fs.mkdir(dir, { recursive: true });
    let name = `${date}-${slugify(title)}.md`;
    try {
      await fs.writeFile(path.join(dir, name), md, { flag: 'wx' });
    } catch (err) {
      if (!isErrno(err, 'EEXIST')) throw err; // same-day same-title collision → unique suffix
      name = `${date}-${slugify(title)}-${Date.now().toString().slice(-4)}.md`;
      await fs.writeFile(path.join(dir, name), md);
    }
    return NextResponse.json({ ok: true, name });
  } catch (err) {
    return NextResponse.json({ error: 'write_failed', detail: String(err) }, { status: 500 });
  }
}
