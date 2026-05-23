import { NextResponse, type NextRequest } from 'next/server';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve, sep } from 'node:path';

/**
 * GET /api/v1/admin/fs/list?path=<abs path>
 *
 * Returns the subdirectories under `path` so the /me Sandbox-directory
 * field can offer a click-through folder browser (per bug
 * bug-20260517-200707-wql1smrg — owner wanted to nav manually with the
 * mouse instead of typing). Holon is a desk app so the Next.js server
 * runs on the owner's box; surfacing local FS structure to its own UI
 * is the intended behavior.
 *
 * If `path` is missing or not absolute, defaults to the user's home
 * directory. Hidden entries (`.foo`) are omitted to keep the list
 * tidy. Pass includeFiles=1 to include regular files as selectable rows.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const requested = url.searchParams.get('path');
  const includeFiles = url.searchParams.get('includeFiles') === '1';
  const target = requested && isAbsolute(requested) ? resolve(requested) : homedir();

  let entries: { name: string; isDir: boolean }[];
  try {
    const items = await readdir(target, { withFileTypes: true });
    entries = items
      .filter((e) => !e.name.startsWith('.') && (e.isDirectory() || (includeFiles && e.isFile())))
      .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = (e as NodeJS.ErrnoException)?.code;
    const status = code === 'ENOENT' || code === 'ENOTDIR' ? 404
      : code === 'EACCES' || code === 'EPERM' ? 403
      : 500;
    return NextResponse.json({ error: msg, code }, { status });
  }

  const parts = target.split(sep).filter(Boolean);
  const crumbs: { name: string; path: string }[] = [{ name: '/', path: '/' }];
  let acc = '';
  for (const p of parts) {
    acc += sep + p;
    crumbs.push({ name: p, path: acc });
  }

  return NextResponse.json({ path: target, entries, crumbs });
}

export const dynamic = 'force-dynamic';
