import { NextResponse, type NextRequest } from 'next/server';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute, resolve, basename, extname } from 'node:path';
import { Readable } from 'node:stream';

/**
 * GET /api/v1/admin/fs/serve?path=<abs path>
 *
 * Streams the file at `path` so the deliverable body's path tokens can
 * be turned into clickable hyperlinks the owner can open directly
 * (bug-20260517-205304-uqdjnur3 — "这个文件链接 能做超链接 直接打开么？").
 * Mirrors the permissiveness of the sibling /api/v1/admin/fs/list
 * endpoint: Holon is a desk app and Next.js runs on the owner's box,
 * so surfacing local files to its own UI is intended.
 *
 * Content-Disposition is `inline` so browsers display previewable
 * formats (md, txt, pdf, images, html) directly and download
 * everything else with the original filename.
 */

const MIME: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.py': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.csv': 'text/csv; charset=utf-8',
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const requested = url.searchParams.get('path');

  if (!requested || !isAbsolute(requested) || requested.includes('..')) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  const target = resolve(requested);
  const info = await stat(target).catch((e: NodeJS.ErrnoException) => e);
  if (info instanceof Error) {
    const code = (info as NodeJS.ErrnoException).code;
    const status = code === 'ENOENT' ? 404 : code === 'EACCES' || code === 'EPERM' ? 403 : 500;
    return NextResponse.json({ error: info.message, code }, { status });
  }
  if (!info.isFile()) {
    return NextResponse.json({ error: 'not a regular file' }, { status: 400 });
  }

  const name = basename(target);
  const ext = extname(target).toLowerCase();
  const mime = MIME[ext] ?? 'application/octet-stream';

  console.log(JSON.stringify({
    audit: 'fs.served',
    path: target,
    size: info.size,
    mime,
    ts: new Date().toISOString(),
  }));

  const stream = Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>;
  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(info.size),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  });
}
