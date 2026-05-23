/**
 * CLI-staff task dispatch. Holon assembles a lean context preamble from the
 * staff role, boss-side memory pointers, and task brief, then injects it into
 * the real CLI session. The CLI does the work; Holon does not route this
 * through Hermes or add a secondary intelligence layer.
 */

import type { Staff } from '@holon/api-contract';
import { getStaffMerged } from './staff-management-service.js';
import { launchCliSession, getCliStatus, sendPrompt, captureCliOutput } from './cli-session-service.js';
import { readBossMemory } from './boss-memory-service.js';

/** Decide whether the session is at a bare shell (no CLI agent to receive a
 * prompt) by looking at the screen instead of pane_current_command, which tmux
 * can report as bash even while claude/codex is running. */
export function looksLikeBareShell(staffId: string): boolean {
  const snap = captureCliOutput(staffId, 40);
  if (!snap.ok) return false;
  const screen = snap.output ?? '';
  if (/bypass permissions|esc to interrupt|tokens used/i.test(screen)) return false;
  const lines = screen.split('\n').map((l) => l.replace(/\s+$/, '')).filter(Boolean);
  const last = lines[lines.length - 1] ?? '';
  return /[\w.()-]+@[\w.-]+:.*[$#]\s*$/.test(last) || /(^|\s)[$#]\s*$/.test(last) || lines.some((l) => /command not found/.test(l));
}

export interface DispatchCliTaskInput {
  staffId: string;
  brief: string;
}

export interface DispatchCliTaskResult {
  ok: boolean;
  launched: boolean;
  preamble: string;
  reason?: string;
}

function parseBossMemoryScopes(indexText: string): string[] {
  const scopes = new Set<string>();
  for (const line of indexText.split(/\r?\n/)) {
    const direct = line.match(/^\s*-\s*([a-z0-9][a-z0-9/_-]{0,120})\s*->\s*MEMORY\/\1\.md\b/i);
    if (direct?.[1]) scopes.add(direct[1].toLowerCase());
    const pointer = line.match(/\bMEMORY\/([a-z0-9][a-z0-9/_-]{0,120})\.md\b/i);
    if (pointer?.[1]) scopes.add(pointer[1].toLowerCase());
  }
  return Array.from(scopes);
}

function scopesReferencedByBrief(indexText: string, brief: string): string[] {
  const haystack = brief.toLowerCase();
  return parseBossMemoryScopes(indexText)
    .filter((scope) => {
      const tail = scope.split('/').at(-1) ?? scope;
      return haystack.includes(scope)
        || haystack.includes(`memory/${scope}.md`)
        || haystack.includes(tail.replace(/[-_]/g, ' '));
    })
    .slice(0, 3);
}

function formatBossMemoryContext(brief: string): { text: string; scopes: string[] } {
  const index = readBossMemory();
  if (!index.ok) {
    return {
      text: `Boss memory unavailable (${index.error}): ${index.message}`,
      scopes: [],
    };
  }

  const scoped = scopesReferencedByBrief(index.text, brief);
  const parts = [
    `INDEX (${index.path})`,
    index.text.trim() || '(empty index)',
  ];

  for (const scope of scoped) {
    const detail = readBossMemory(scope);
    if (!detail.ok) {
      parts.push(`SCOPE ${scope}`, `Unavailable (${detail.error}): ${detail.message}`);
      continue;
    }
    parts.push(`SCOPE ${scope} (${detail.path})`, detail.text.trim() || `(empty ${scope})`);
  }

  return { text: parts.join('\n\n'), scopes: scoped };
}

/** Build the context preamble injected into the CLI session. Mirrors the
 * manager-to-Codex handoff shape: who-you-are + boss-memory + the-task. */
export function buildCliPreamble(staff: Staff, memory: string, brief: string): string {
  const header = `[Holon - ${staff.role_label ?? staff.role_name} - ${staff.name}]`;
  const role = staff.system_prompt?.trim() ? staff.system_prompt.trim() : '';
  const mem = memory.trim();
  const parts = [header];
  if (role) parts.push(role);
  parts.push(
    '== Boss memory context (central, read-only brief) ==',
    mem || '(no boss memory context)',
    'Employees carry no durable memory. If more context is needed, ask the Secretary to read a specific boss-memory scope.',
  );
  parts.push('== Task ==', brief.trim());
  return parts.join('\n\n');
}

const isCliAgent = (staff: Staff): boolean =>
  staff.substrate.kind === 'cli_agent' || staff.substrate.kind === 'cli';

/**
 * Assemble the context preamble for a cli_agent staff and inject it into its
 * CLI session, launching the session first if needed. Returns the preamble so
 * callers can echo/audit exactly what was sent.
 */
export async function dispatchCliTask(input: DispatchCliTaskInput): Promise<DispatchCliTaskResult> {
  const staff = getStaffMerged(input.staffId);
  if (!staff) return { ok: false, launched: false, preamble: '', reason: 'staff_not_found' };
  if (!isCliAgent(staff)) return { ok: false, launched: false, preamble: '', reason: 'not_a_cli_agent' };

  const brief = input.brief.trim();
  if (!brief) return { ok: false, launched: false, preamble: '', reason: 'empty_brief' };

  const bossMemory = formatBossMemoryContext(brief);
  const preamble = buildCliPreamble(staff, bossMemory.text, brief);

  let launched = false;
  if (!getCliStatus(input.staffId).running) {
    const l = launchCliSession(input.staffId);
    if (!l.ok) return { ok: false, launched: false, preamble, reason: l.reason };
    launched = true;
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (looksLikeBareShell(input.staffId)) {
    return {
      ok: false,
      launched,
      preamble,
      reason: 'agent_not_running: the session looks like a bare shell, no CLI agent to receive the task. Make sure claude/codex is running in it (auto-launch, or start it), then retry.',
    };
  }

  const r = sendPrompt(input.staffId, preamble);
  if (!r.ok) return { ok: false, launched, preamble, reason: r.reason ?? 'send_failed' };

  console.log(JSON.stringify({
    audit: 'cli.task_dispatched',
    staff_id: input.staffId,
    launched,
    brief_len: brief.length,
    boss_memory_len: bossMemory.text.length,
    boss_memory_scopes: bossMemory.scopes,
    ts: new Date().toISOString(),
  }));

  return { ok: true, launched, preamble };
}
