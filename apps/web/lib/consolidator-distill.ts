/**
 * consolidator-distill — real LLM-backed distill for the sleep-time memory
 * consolidator (slice #19 ADR: docs/adr/sleep-time-memory-consolidator.md).
 *
 * Replaces the slice-1 `STUB_DISTILL` (still exported from @holon/core as a
 * fallback) with a one-shot `claude --print` call that summarises a single
 * `## ` section of a per-agent CLAUDE.md while preserving every concrete
 * fact / file path / URL / proper name.
 *
 * Spawn shape mirrors `warm-agent.ts`:
 *   claude --print
 *     --input-format stream-json --output-format stream-json
 *     --model claude-haiku-4-5 --effort low
 *     --dangerously-skip-permissions --verbose
 *
 * Owner direction 2026-05-30: 主模型 (claude), no token budget. Haiku here
 * matches the existing warm-secretary default — cheap + fast for a one-shot
 * summarisation job that runs while the agent is idle.
 *
 * Timeout: 60s per section. On timeout / spawn error / non-zero exit we fall
 * back to STUB_DISTILL so the consolidation pass never blocks. The sidecar
 * cooldown will retry next tick (default 24h).
 */

// Bare module names (no node: prefix) via eval('require') — codebase
// convention so webpack's node-builtin loader doesn't choke on the scheme.
// See heartbeat.ts §15.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (id: string) => any;
const { spawn } = nodeRequire('child_process') as typeof import('child_process');

import { STUB_DISTILL } from '@holon/core/memory-consolidator';
import type { ConsolidatorOptions } from '@holon/core/memory-consolidator';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_BINARY = 'claude';
const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_EFFORT = 'low';

const SYSTEM_PROMPT = [
  "You are summarizing one section of an AI agent's CLAUDE.md memory file.",
  'Your job: produce a SHORTER but FAITHFUL distillation of the section',
  'below. Preserve every concrete fact / decision / rule / file path /',
  'URL / proper name. Drop verbose prose, repeated examples, and stale',
  'context. Aim for 25-40% of the original word count. Output ONLY the',
  'distilled markdown — no preamble, no notes.',
].join('\n');

function buildPrompt(sectionName: string, content: string): string {
  return [
    SYSTEM_PROMPT,
    '',
    `Section name: ${sectionName}`,
    'Section content:',
    '---',
    content,
    '---',
  ].join('\n');
}

/**
 * Run one claude one-shot and return the assistant text. Resolves to null on
 * timeout, non-zero exit, or unparseable output — the caller falls back to
 * the stub marker.
 *
 * Exported for direct test use; the production path is `claudeDistill`.
 */
export interface DistillSpawnOptions {
  binary?: string;
  model?: string;
  effort?: string;
  timeoutMs?: number;
  /** Injection point for tests. Defaults to node child_process.spawn. */
  spawnFn?: typeof spawn;
}

export async function runClaudeDistill(
  sectionName: string,
  content: string,
  opts: DistillSpawnOptions = {},
): Promise<string | null> {
  const binary = opts.binary ?? process.env.HOLON_DISTILL_BINARY ?? DEFAULT_BINARY;
  const model = opts.model ?? process.env.HOLON_DISTILL_MODEL ?? DEFAULT_MODEL;
  const effort = opts.effort ?? process.env.HOLON_DISTILL_EFFORT ?? DEFAULT_EFFORT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawnImpl = opts.spawnFn ?? spawn;

  const args = [
    '--print',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
    '--model', model,
    '--effort', effort,
  ];

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const settle = (v: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.kill('SIGTERM'); } catch { /* already gone */ }
      resolve(v);
    };

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawnImpl(binary, args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    } catch {
      resolve(null);
      return;
    }

    const timer = setTimeout(() => settle(null), timeoutMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }

    let buf = '';
    const assembled: string[] = [];

    proc.stdout?.on('data', (d: Buffer) => {
      buf += d.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let ev: {
          type?: string;
          message?: {
            content?: Array<{ type?: string; text?: string }>;
          };
          result?: unknown;
        };
        try { ev = JSON.parse(line); } catch { continue; }
        // Stream-json: assistant messages carry the rewrite. We accept both
        // shapes — full `message.content` blocks (final assistant turn) and
        // any standalone text deltas warm-agent ignores. We only want full
        // text blocks here (one-shot, no incremental rendering needed).
        if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
          for (const block of ev.message!.content!) {
            if (block.type === 'text' && typeof block.text === 'string') {
              assembled.push(block.text);
            }
          }
        }
      }
    });

    proc.stderr?.on('data', () => { /* claude logs to stderr; ignore */ });

    proc.on('error', () => settle(null));

    proc.on('close', (code: number | null) => {
      const text = assembled.join('').trim();
      if (code === 0 && text) {
        settle(text);
      } else {
        settle(null);
      }
    });

    // One-shot: write the prompt as a single user message and close stdin.
    const userMsg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: buildPrompt(sectionName, content) },
    });
    try {
      proc.stdin?.write(userMsg + '\n');
      proc.stdin?.end();
    } catch {
      settle(null);
    }
  });
}

/**
 * Production distill — drop-in `ConsolidatorOptions['distill']`.
 *
 * Falls back to `STUB_DISTILL` on timeout / spawn failure / empty response so
 * the consolidator never blocks. The marker lets the next tick try again.
 */
export const claudeDistill: ConsolidatorOptions['distill'] = async ({ sectionName, content }) => {
  const text = await runClaudeDistill(sectionName, content);
  if (text && text.length > 0) {
    return text.endsWith('\n') ? text : text + '\n';
  }
  return STUB_DISTILL({ sectionName, content });
};
