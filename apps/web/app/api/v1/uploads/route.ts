/**
 * POST /api/v1/uploads — receive a file attachment from the mobile client and
 * save it to the desk filesystem so the Secretary (CLI) can read it.
 *
 * Request body (JSON):
 *   { filename: string, mime: string, base64: string }
 *
 * Success (201):
 *   { path: string, filename: string, mime: string, size: number }
 *   `path` is the absolute path on the desk — the Secretary can open it directly.
 *
 * Errors:
 *   400  missing_fields / bad_filename / file_too_large
 *   401/403  auth errors (device token)
 *   500  write_failed
 *
 * Files land at: ~/.holon/uploads/<yyyymmdd>/<id>-<safe-filename>
 * Size cap: 25 MB (binary).
 *
 * Auth: requireDeviceTokenForRemote (same as /connectors/voice/transcribe).
 * No API keys, no cloud, no media transcoding.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { holonStateRoot } from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

// 25 MB in bytes (binary base64 payload can be up to ~33% larger)
const MAX_SIZE_BYTES = 25 * 1024 * 1024;
// base64 is ~4/3 of binary — cap the base64 string length at 34 MB chars
const MAX_BASE64_LEN = Math.ceil(MAX_SIZE_BYTES * 1.34);

function mintId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function dateSlug(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** Sanitize a filename: keep only alphanumeric, dot, dash, underscore.
 *  Collapses runs of disallowed chars to a single dash. Trims leading/trailing dashes. */
function safeFilename(raw: string): string {
  const name = raw
    .replace(/[^\w.\-]/g, '-')   // replace disallowed chars with dash
    .replace(/-{2,}/g, '-')      // collapse repeated dashes
    .replace(/^[-.]/, '')        // strip leading dash/dot
    .replace(/[-.]$/, '');       // strip trailing dash/dot
  if (!name || name.length > 200) return 'attachment';
  return name;
}

interface UploadPayload {
  filename: string;
  mime: string;
  base64: string;
}

function isPayload(b: unknown): b is UploadPayload {
  if (typeof b !== 'object' || b === null) return false;
  const r = b as Record<string, unknown>;
  return typeof r.filename === 'string' && typeof r.mime === 'string' && typeof r.base64 === 'string';
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json', message: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isPayload(body)) {
    return NextResponse.json(
      { error: 'missing_fields', message: 'Required fields: filename, mime, base64' },
      { status: 400 },
    );
  }

  const { filename, mime, base64 } = body;

  if (!filename.trim()) {
    return NextResponse.json({ error: 'bad_filename', message: 'filename must be non-empty' }, { status: 400 });
  }

  if (base64.length > MAX_BASE64_LEN) {
    return NextResponse.json(
      { error: 'file_too_large', message: `File exceeds the 25 MB limit` },
      { status: 400 },
    );
  }

  // Decode base64 → buffer (strip optional data-URL prefix)
  const rawB64 = base64.includes(',') ? base64.split(',', 2)[1] ?? '' : base64;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(rawB64, 'base64');
  } catch {
    return NextResponse.json({ error: 'bad_base64', message: 'base64 decode failed' }, { status: 400 });
  }

  if (bytes.length > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: 'file_too_large', message: `File exceeds the 25 MB limit` },
      { status: 400 },
    );
  }

  const safe = safeFilename(filename);
  const id = mintId();
  const day = dateSlug();
  const uploadDir = join(holonStateRoot(), 'uploads', day);
  const finalName = `${id}-${safe}`;
  const filePath = join(uploadDir, finalName);

  try {
    mkdirSync(uploadDir, { recursive: true });
    writeFileSync(filePath, bytes);
  } catch (err) {
    console.error(JSON.stringify({
      error: 'upload.write_failed',
      path: filePath,
      message: err instanceof Error ? err.message : String(err),
      ts: new Date().toISOString(),
    }));
    return NextResponse.json({ error: 'write_failed', message: 'Failed to save file on desk' }, { status: 500 });
  }

  console.log(JSON.stringify({
    audit: 'upload.saved',
    path: filePath,
    filename: safe,
    mime,
    size: bytes.length,
    ts: new Date().toISOString(),
  }));

  return NextResponse.json(
    { path: filePath, filename: safe, mime, size: bytes.length },
    { status: 201 },
  );
}

export const dynamic = 'force-dynamic';
