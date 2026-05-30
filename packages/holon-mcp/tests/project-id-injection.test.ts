/**
 * MCP tool project_id auto-inject (System 0/1/2).
 *
 * When the MCP server is launched on behalf of a project secretary, env
 * HOLON_PROJECT_ID is set to that project's id; readMemory/writeMemory
 * default to project scope (System 1) unless the caller passes project_id=null
 * to force owner scope (System 2).
 *
 * Run via node:test (built-in, no extra deps).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readMemory, writeMemory } from '../src/tools.js';

let workDir: string;
let priorHome: string | undefined;
let priorProj: string | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'mcp-inject-test-'));
  priorHome = process.env.HOLON_AGENTS_HOME;
  priorProj = process.env.HOLON_PROJECT_ID;
  process.env.HOLON_AGENTS_HOME = workDir;
  delete process.env.HOLON_PROJECT_ID;
});

afterEach(() => {
  if (priorHome === undefined) delete process.env.HOLON_AGENTS_HOME;
  else process.env.HOLON_AGENTS_HOME = priorHome;
  if (priorProj === undefined) delete process.env.HOLON_PROJECT_ID;
  else process.env.HOLON_PROJECT_ID = priorProj;
  rmSync(workDir, { recursive: true, force: true });
});

describe('readMemory project_id resolution (System 1 vs System 2)', () => {
  it('defaults to owner scope (System 2) when no HOLON_PROJECT_ID env and no arg', async () => {
    const res = await readMemory('decisions') as { ok: boolean; path: string; project_id?: string };
    assert.equal(res.ok, true);
    assert.match(res.path, /boss\/owner\/MEMORY\/decisions\.md$/);
    assert.equal(res.project_id, undefined);
  });

  it('auto-injects HOLON_PROJECT_ID when caller omits project_id', async () => {
    process.env.HOLON_PROJECT_ID = 'sproj_auto';
    const res = await readMemory('decisions') as { ok: boolean; path: string; project_id?: string };
    assert.equal(res.ok, true);
    assert.match(res.path, /boss\/projects\/sproj_auto\/MEMORY\/decisions\.md$/);
    assert.equal(res.project_id, 'sproj_auto');
  });

  it('explicit null overrides HOLON_PROJECT_ID (forces System 2 owner scope)', async () => {
    process.env.HOLON_PROJECT_ID = 'sproj_auto';
    const res = await readMemory('decisions', null) as { ok: boolean; path: string };
    assert.equal(res.ok, true);
    assert.match(res.path, /boss\/owner\/MEMORY\/decisions\.md$/);
  });

  it('explicit project_id wins over env', async () => {
    process.env.HOLON_PROJECT_ID = 'sproj_auto';
    const res = await readMemory('decisions', 'sproj_explicit') as { ok: boolean; path: string };
    assert.equal(res.ok, true);
    assert.match(res.path, /boss\/projects\/sproj_explicit\/MEMORY\/decisions\.md$/);
  });
});

describe('writeMemory project_id resolution', () => {
  it('auto-injects HOLON_PROJECT_ID on write', async () => {
    process.env.HOLON_PROJECT_ID = 'sproj_write';
    const res = await writeMemory('decisions', 'fact one') as { ok: boolean; project_id?: string; path?: string };
    assert.equal(res.ok, true);
    assert.equal(res.project_id, 'sproj_write');
    assert.match(res.path!, /boss\/projects\/sproj_write\/MEMORY\/decisions\.md$/);
  });

  it('explicit null forces owner scope on write', async () => {
    process.env.HOLON_PROJECT_ID = 'sproj_write';
    const res = await writeMemory('decisions', 'owner fact', null) as { ok: boolean; path?: string };
    assert.equal(res.ok, true);
    assert.match(res.path!, /boss\/owner\/MEMORY\/decisions\.md$/);
  });
});
