import { NextResponse } from 'next/server';
import { createStaff, listTmuxSessions } from '@holon/core';
import { requireDeviceTokenForRemote, deviceAuthErrorResponse } from '@/lib/device-token-auth';

/**
 * POST /api/v1/cli/adopt — adopt an existing owner-run tmux session as an
 * employee (Mode B). Creates a long-lived cli_agent staff bound to that session
 * via external_session; Holon pipes I/O to it but does NOT launch or kill it.
 *
 * Body: { session_name, cwd?, binary?, name?, role_label? }
 */
export async function POST(req: Request): Promise<NextResponse | Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid JSON body', code: 'invalid_json' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const sessionName = typeof b.session_name === 'string' ? b.session_name.trim() : '';
  if (!sessionName) {
    return NextResponse.json({ error: 'session_name required', code: 'missing_session' }, { status: 400 });
  }

  // Verify the session actually exists + isn't already adopted (avoid dupes).
  const sessions = listTmuxSessions();
  const found = sessions.find((s) => s.name === sessionName);
  if (!found) {
    return NextResponse.json({ error: `tmux session '${sessionName}' not found`, code: 'no_session' }, { status: 404 });
  }
  if (found.adopted) {
    return NextResponse.json({ error: `session '${sessionName}' is already an employee`, code: 'already_adopted' }, { status: 409 });
  }

  const cwd = typeof b.cwd === 'string' && b.cwd.trim() ? b.cwd.trim() : (found.cwd || undefined);
  const binaryRaw = typeof b.binary === 'string' && b.binary.trim() ? b.binary.trim() : found.command;
  const binary = (binaryRaw === 'claude' || binaryRaw === 'codex') ? binaryRaw : 'claude';
  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : sessionName;
  const roleLabel = typeof b.role_label === 'string' && b.role_label.trim() ? b.role_label.trim() : '收编员工';

  try {
    const staff = createStaff({
      name,
      role_label: roleLabel,
      substrate: {
        kind: 'cli_agent',
        binary,
        args_template: '',
        approval_rules: [],
        lifecycle: 'long',
        cwd,
        auto_launch: false,        // existing session — don't (re)launch or kill it
        external_session: sessionName,
      },
    });
    console.log(JSON.stringify({ audit: 'cli.session_adopted', staff_id: staff.id, session: sessionName, ts: new Date().toISOString() }));
    return NextResponse.json({ staff }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), code: 'adopt_failed' },
      { status: 500 },
    );
  }
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
