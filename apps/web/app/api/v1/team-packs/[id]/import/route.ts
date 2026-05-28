/**
 * POST /api/v1/team-packs/:id/import
 *
 * Body (JSON):
 *   {
 *     selected_staff_names?: string[];       // omit = import all
 *     conflict?: 'skip' | 'rename' | 'replace';  // default 'skip'
 *     workspace_overrides?: Record<string, string>;  // staffName → workspace path
 *   }
 *
 * Response:
 *   { created: string[], skipped: string[] }
 *
 * Conflict handling:
 *   skip    — if a staff with the same name exists, leave it untouched.
 *   rename  — append " (2)" / " (3)" etc. until the name is free, then create.
 *   replace — dismiss existing staff with the same name, then create fresh.
 *
 * workspace_overrides: when provided, the value for a given staff name overrides
 *   the pack's default workspace_hint for that member (applied as workspace:<path> tag).
 *
 * Auth: requireDeviceTokenForRemote.
 */

import { NextResponse } from 'next/server';
import {
  getTeamPack,
  createStaff,
  listStaffMerged,
  dismissStaffById,
} from '@holon/core';
import { deviceAuthErrorResponse, requireDeviceTokenForRemote } from '@/lib/device-token-auth';

type ConflictMode = 'skip' | 'rename' | 'replace';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) return deviceAuthErrorResponse(auth);

  const { id } = await params;
  const pack = getTeamPack(id);
  if (!pack) {
    return NextResponse.json({ error: 'pack_not_found', code: 'pack_not_found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body', code: 'invalid_json' }, { status: 400 });
  }

  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

  // Parse selected_staff_names (null = all)
  const selectedNames: string[] | null = Array.isArray(b.selected_staff_names)
    ? b.selected_staff_names.filter((n): n is string => typeof n === 'string')
    : null;

  // Parse conflict mode
  const rawConflict = typeof b.conflict === 'string' ? b.conflict : 'skip';
  const conflict: ConflictMode =
    rawConflict === 'rename' ? 'rename'
      : rawConflict === 'replace' ? 'replace'
      : 'skip';

  // Parse workspace_overrides: Record<staffName, workspacePath>
  const workspaceOverrides: Record<string, string> =
    (typeof b.workspace_overrides === 'object' && b.workspace_overrides !== null)
      ? Object.fromEntries(
          Object.entries(b.workspace_overrides as Record<string, unknown>)
            .filter(([, v]) => typeof v === 'string')
            .map(([k, v]) => [k, v as string]),
        )
      : {};

  // Parse project_id: if present, imported staff get a project:{id} tag.
  const projectId: string | null = typeof b.project_id === 'string' && b.project_id.trim()
    ? b.project_id.trim()
    : null;

  // Filter staff to import
  const toImport = selectedNames === null
    ? pack.staff
    : pack.staff.filter((s) => selectedNames.includes(s.name));

  const created: string[] = [];
  const skipped: string[] = [];

  for (const packMember of toImport) {
    const existingRoster = listStaffMerged();
    const collision = existingRoster.find((s) => s.name === packMember.name);

    let finalName = packMember.name;

    if (collision) {
      if (conflict === 'skip') {
        skipped.push(packMember.name);
        continue;
      } else if (conflict === 'rename') {
        let suffix = 2;
        while (listStaffMerged().some((s) => s.name === `${packMember.name} (${suffix})`)) {
          suffix += 1;
        }
        finalName = `${packMember.name} (${suffix})`;
      } else if (conflict === 'replace') {
        // Dismiss old entry — best-effort; create regardless
        dismissStaffById(collision.id);
      }
    }

    try {
      const tags: string[] = [];
      if (packMember.task_group) tags.push(`task_group:${packMember.task_group}`);
      // workspace_overrides wins over pack default when present for this member.
      const effectiveWorkspace = Object.prototype.hasOwnProperty.call(workspaceOverrides, packMember.name)
        ? workspaceOverrides[packMember.name]
        : packMember.workspace_hint;
      if (effectiveWorkspace) tags.push(`workspace:${effectiveWorkspace}`);
      tags.push(`pack:${pack.id}`);
      tags.push(`suggested_cli:${packMember.suggested_cli}`);
      // Project scoping: if project_id was provided, tag the staff to that project.
      if (projectId) tags.push(`project:${projectId}`);

      // Owner: 导入的角色要能实际跟 CLI 对话(总结面板需要 cli_agent substrate).
      // 包定义里的 suggested_cli 决定 binary;默认 short-term lifecycle.
      createStaff({
        name: finalName,
        role_label: packMember.role_label,
        role_name: packMember.role_name,
        system_prompt: packMember.persona,
        tool_scope: packMember.skills,
        tags,
        substrate: {
          kind: 'cli_agent',
          binary: packMember.suggested_cli,
          args_template: '',
          approval_rules: [],
          lifecycle: 'short',
          auto_launch: false,  // owner-on-demand; don't spawn 5 tmux on import
          ...(effectiveWorkspace ? { cwd: effectiveWorkspace } : {}),
        },
      });

      created.push(finalName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({
        audit: 'team_pack.import_error',
        pack_id: pack.id,
        staff_name: packMember.name,
        error: msg,
        ts: new Date().toISOString(),
      }));
      skipped.push(packMember.name);
    }
  }

  console.log(JSON.stringify({
    audit: 'team_pack.imported',
    pack_id: pack.id,
    created,
    skipped,
    conflict,
    workspace_overrides: workspaceOverrides,
    ts: new Date().toISOString(),
  }));

  return NextResponse.json({ created, skipped }, { status: 200 });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
