/**
 * Harvest-on-retire tests (System 0/1/2 bubble-up).
 *
 * Mock the dispatcher so we never spawn a real CLI; assert that the right
 * brief lands at the right harvester staff, that the target scope flag is
 * right, and that project-retire archives the project memory dir.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  harvestEmployeeRetire,
  harvestProjectRetire,
  setBossMemoryHarvestDispatcher,
} from '../src/boss-memory-harvest-service.js';

let workDir: string;
let priorEnv: { home?: string | undefined; super?: string | undefined };
let auditLines: string[];
let originalLog: typeof console.log;
let originalWarn: typeof console.warn;
let originalErr: typeof console.error;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'boss-harvest-test-'));
  priorEnv = {
    home: process.env.HOLON_AGENTS_HOME,
    super: process.env.HOLON_SUPER_AGENT_STAFF_ID,
  };
  process.env.HOLON_AGENTS_HOME = workDir;
  delete process.env.HOLON_SUPER_AGENT_STAFF_ID;

  auditLines = [];
  originalLog = console.log;
  originalWarn = console.warn;
  originalErr = console.error;
  const capture = (msg?: unknown) => {
    if (typeof msg === 'string') auditLines.push(msg);
  };
  console.log = capture;
  console.warn = capture;
  console.error = capture;
});

afterEach(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalErr;
  setBossMemoryHarvestDispatcher(null);
  if (priorEnv.home === undefined) delete process.env.HOLON_AGENTS_HOME;
  else process.env.HOLON_AGENTS_HOME = priorEnv.home;
  if (priorEnv.super === undefined) delete process.env.HOLON_SUPER_AGENT_STAFF_ID;
  else process.env.HOLON_SUPER_AGENT_STAFF_ID = priorEnv.super;
  rmSync(workDir, { recursive: true, force: true });
});

function auditEvents(): Array<{ audit: string; [k: string]: unknown }> {
  return auditLines
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter((obj): obj is { audit: string } => !!obj && typeof (obj as { audit?: string }).audit === 'string');
}

describe('harvestEmployeeRetire', () => {
  it('dispatches with project context when staff has a project_id', async () => {
    // Seed an employee workspace with a CLAUDE.md.
    const dir = join(workDir, 'staff_emp1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'CLAUDE.md'), '# role\nI shipped feature X.\n');

    const dispatcher = vi.fn().mockResolvedValue({ ok: true, launched: false, preamble: '' });
    setBossMemoryHarvestDispatcher(dispatcher);

    const res = await harvestEmployeeRetire({ staff_id: 'staff_emp1', project_id: 'sproj_a' });
    expect(res.ok).toBe(true);
    expect(res.dispatched).toBe(true);
    expect(res.target_scope).toBe('project');
    expect(res.target_project_id).toBe('sproj_a');

    expect(dispatcher).toHaveBeenCalledTimes(1);
    const brief = dispatcher.mock.calls[0]?.[0]?.brief as string;
    expect(brief).toContain('staff_emp1');
    expect(brief).toContain('sproj_a');
    expect(brief).toContain('System 1');
    expect(brief).toContain('I shipped feature X.');

    const audits = auditEvents().map((e) => e.audit);
    expect(audits).toContain('boss.harvest_employee_dispatched');
  });

  it('routes to owner scope when employee has no project_id', async () => {
    const dispatcher = vi.fn().mockResolvedValue({ ok: true, launched: false, preamble: '' });
    setBossMemoryHarvestDispatcher(dispatcher);

    const res = await harvestEmployeeRetire({ staff_id: 'staff_cross', project_id: null });
    expect(res.target_scope).toBe('owner');
    expect(res.target_project_id).toBe(null);
    const brief = dispatcher.mock.calls[0]?.[0]?.brief as string;
    expect(brief).toContain('System 2');
    expect(brief).toContain('owner-scope');
  });

  it('reports dispatched=false but does not throw when dispatcher rejects', async () => {
    const dispatcher = vi.fn().mockRejectedValue(new Error('cli down'));
    setBossMemoryHarvestDispatcher(dispatcher);

    const res = await harvestEmployeeRetire({ staff_id: 'staff_bad', project_id: 'sproj_a' });
    expect(res.ok).toBe(false);
    expect(res.dispatched).toBe(false);
    expect(res.reason).toContain('cli down');

    const audits = auditEvents().map((e) => e.audit);
    expect(audits).toContain('boss.harvest_failed');
  });
});

describe('harvestProjectRetire', () => {
  function seedProjectMemory(projectId: string): void {
    const root = join(workDir, 'holon-agents-not-used'); // unused; just keep linter happy
    void root;
    const projRoot = join(workDir, 'boss', 'projects', projectId);
    const memDir = join(projRoot, 'MEMORY');
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(projRoot, 'INDEX.md'), '# index\n- decisions\n');
    writeFileSync(join(memDir, 'decisions.md'), '# decisions\npicked HTTP over gRPC\n');
  }

  it('dispatches harvest brief + archives the project memory dir', async () => {
    seedProjectMemory('sproj_retire');
    const dispatcher = vi.fn().mockResolvedValue({ ok: true, launched: false, preamble: '' });
    setBossMemoryHarvestDispatcher(dispatcher);

    const res = await harvestProjectRetire({ project_id: 'sproj_retire', project_name: 'Retire Me' });
    expect(res.ok).toBe(true);
    expect(res.target_scope).toBe('owner');

    expect(dispatcher).toHaveBeenCalledTimes(1);
    const brief = dispatcher.mock.calls[0]?.[0]?.brief as string;
    expect(brief).toContain('sproj_retire');
    expect(brief).toContain('Retire Me');
    expect(brief).toContain('System 1');
    expect(brief).toContain('System 2');
    expect(brief).toContain('picked HTTP over gRPC');

    // Project dir should now be under _archived/
    expect(existsSync(join(workDir, 'boss', 'projects', 'sproj_retire'))).toBe(false);
    const archives = readdirSync(join(workDir, 'boss', 'projects', '_archived'));
    expect(archives.some((n) => n.startsWith('sproj_retire_'))).toBe(true);

    const audits = auditEvents().map((e) => e.audit);
    expect(audits).toContain('boss.harvest_project_dispatched');
    expect(audits).toContain('boss.project_memory_archived');
  });

  it('uses HOLON_SUPER_AGENT_STAFF_ID when set to a live cli_agent staff id', async () => {
    seedProjectMemory('sproj_sa');

    // Create a real cli_agent staff and use its id as the super-agent.
    const { createStaff } = await import('../src/staff-management-service.js');
    const superAgent = createStaff({
      name: 'Super Boss',
      role_label: 'Super Boss',
      role_name: 'super_boss',
      substrate: {
        kind: 'cli_agent',
        binary: 'claude',
        lifecycle: 'long',
        cwd: workDir,
        auto_launch: false,
        args_template: '',
        approval_rules: [],
      },
      system_prompt: 'super agent',
      max_concurrent_jobs: 1,
    });
    process.env.HOLON_SUPER_AGENT_STAFF_ID = superAgent.id;

    const dispatcher = vi.fn().mockResolvedValue({ ok: true, launched: false, preamble: '' });
    setBossMemoryHarvestDispatcher(dispatcher);

    const res = await harvestProjectRetire({ project_id: 'sproj_sa' });
    expect(res.ok).toBe(true);
    expect(res.harvester_staff_id).toBe(superAgent.id);
    expect(dispatcher.mock.calls[0]?.[0]?.staffId).toBe(superAgent.id);
  });

  it('falls back to memory-manager when super-agent id does not resolve', async () => {
    seedProjectMemory('sproj_bad_sa');
    process.env.HOLON_SUPER_AGENT_STAFF_ID = 'staff_does_not_exist';

    const dispatcher = vi.fn().mockResolvedValue({ ok: true, launched: false, preamble: '' });
    setBossMemoryHarvestDispatcher(dispatcher);

    const res = await harvestProjectRetire({ project_id: 'sproj_bad_sa' });
    expect(res.ok).toBe(true);
    // harvester_staff_id should NOT equal the bogus id.
    expect(res.harvester_staff_id).not.toBe('staff_does_not_exist');

    const audits = auditEvents().map((e) => e.audit);
    expect(audits).toContain('boss.harvest_super_agent_unresolved');
  });
});
