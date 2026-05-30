/**
 * adopted-summarizer — front-stage summarizer for adopted CLI staff.
 *
 * When the owner sends a 前台 message to an adopted CLI (external_session),
 * the message is piped into tmux via sendKeys and the CLI answers in the raw
 * terminal. This module watches the pane in the background, detects when the
 * CLI has settled (output stops changing), diffs against the pre-send screen
 * to get only NEW text, asks a warm Haiku process for a short Chinese summary,
 * and appends it to the staff's 前台 thread so the mobile front stage shows
 * something useful.
 *
 * Design constraints (owner-explicit):
 *  1. NON-BLOCKING — never awaited from the chat route; fire-and-forget.
 *  2. SETTLE DETECTION — poll every ~700ms; settled = 2 consecutive equal
 *     captures, or hard cap 30s.
 *  3. DELTA ONLY — feed Haiku only the text that appeared after the pre-send
 *     snapshot; skip if empty/whitespace.
 *  4. WARM HAIKU — reuse sendWarmTurn so the process is already hot.
 *  5. ONE Haiku call per turn, not per poll.
 *  6. OVERLAP GUARD — module-level Set<string> prevents two watches per staffId.
 */

import { spawn } from 'node:child_process';
import { appendChatMessage, readChatTranscript } from '@holon/core';
import { waitForCliSettle } from '@/lib/cli-settle';

/** staffIds currently being watched — prevents overlapping watchers. */
const inFlight = new Set<string>();

const HARD_CAP_MS = 120_000;    // claude turns can be long; match chat TURN_TIMEOUT

/** System prompt for the summarizer Haiku process. Owner verbatim:
 *  "总结很 Mess,每次都差不多,移动重复多余的都不要,就说这次干了啥(如步骤、
 *   字段、文件),有的是要做什么事(待办)。"
 *  → terse action-log style: only NEW info, concrete objects, optional 待办. */
const SYSTEM_PROMPT =
  '你是产品交付记录员。把 CLI 这一轮工作写成 1 句【用户感知的成果】。' +
  '\n' +
  '\n规则:' +
  '\n1. 写"对用户来说什么变了"——不是"改了哪个文件"。' +
  '\n2. 把代码细节翻译成用户行为:文件名→功能名,字段→选项,函数→动作。' +
  '\n3. 不写"已完成/已修复/已部署"等空形容词,直接说新行为。' +
  '\n4. 1 句话,30-60 汉字。' +
  '\n5. 纯文字,无 Markdown / 代码块 / emoji。' +
  '\n' +
  '\n翻译示例:' +
  '\n  代码侧: "改 globals.css 字号 14.5→17px、padding 6→8"' +
  '\n  用户侧: "员工 CLI 终端字体从 14.5px 放大到 17px,长行不再换行成两行。"' +
  '\n' +
  '\n  代码侧: "改 device-pairing-store.ts 加 Tailscale-first"' +
  '\n  用户侧: "pair 时默认用 Tailscale IP,以后切蜂窝不再掉线。"' +
  '\n' +
  '\n  代码侧: "改 instrumentation.ts setTimeout fetch 8 个路由"' +
  '\n  用户侧: "桌面启动时预热 8 条慢路由,首请求不再卡 7 秒。"' +
  '\n' +
  '\n只在 CLI 这一轮真的什么都没动(纯查询/纯失败/只是回答问题没改东西)的极端' +
  '\n情况下,才写"无产品变化"四字。任何代码改动/文件编辑/build/install/部署都算' +
  '\n有变化,要总结成用户视角的成果。';

/**
 * Schedule a non-blocking settle-watch + summarize cycle for an adopted CLI turn.
 *
 * @param staffId  - the staff's id (used for capture, thread key, and warm key)
 * @param cwd      - working directory for the warm haiku process (may be undefined)
 * @param preSendScreen - tmux pane text captured BEFORE sendKeys was called
 */
export function scheduleAdoptedSummary(
  staffId: string,
  cwd: string | undefined,
  preSendScreen: string,
  userContent: string = '',
): void {
  if (inFlight.has(staffId)) return; // another watch is already running for this staff
  inFlight.add(staffId);

  // Kick off asynchronously — intentionally NOT awaited.
  void (async () => {
    try {
      await runSettleWatch(staffId, cwd, preSendScreen, userContent);
    } catch (err) {
      console.warn(JSON.stringify({
        warn: 'adopted_summarizer.unhandled_error',
        staff_id: staffId,
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }));
    } finally {
      inFlight.delete(staffId);
    }
  })();
}

async function runSettleWatch(
  staffId: string,
  cwd: string | undefined,
  preSendScreen: string,
  userContent: string,
): Promise<void> {
  const { settled, delta } = await waitForCliSettle(staffId, preSendScreen, {
    timeoutMs: HARD_CAP_MS,
  });

  if (!delta || !delta.trim()) {
    // No meaningful new output — skip Haiku call entirely.
    console.log(JSON.stringify({
      audit: 'adopted_summarizer.no_delta',
      staff_id: staffId,
      settled,
      ts: new Date().toISOString(),
    }));
    return;
  }

  // Tell Haiku the user's last message explicitly so it can subtract that
  // echo from the delta and summarize ONLY the CLI's answer.
  const userHint = userContent.trim()
    ? `用户刚才发送的消息(不要总结这部分,只是给你做对照): "${userContent.trim().slice(0, 200)}"\n\n`
    : '';

  // Light anti-repeat hint — show haiku the last 1 summary just as STYLE
  // reference, no "must be new" rule (that was making it write 无新进展 for
  // legitimate work). System prompt already covers style.
  const recent = readChatTranscript(`staff:${staffId}`, 4)
    .filter((m) => m.role === 'assistant')
    .slice(-1)
    .map((m) => `参考上一条总结的风格(不要照抄): "${m.content}"`)
    .join('\n');
  const antiRepeat = recent ? `\n${recent}\n` : '';

  // The USER message — just context + the raw delta. SYSTEM_PROMPT goes via
  // claude's --system-prompt flag in runHaikuSummarize so the rules are real
  // system rules, not buried in turn text.
  const userMessage =
    `${userHint}${antiRepeat}\n以下是终端新增输出(包含用户消息的回显 + CLI 的回答,只总结 CLI 的回答),请按系统规则写一句用户视角的成果:\n\`\`\`\n${delta.slice(0, 4000)}\n\`\`\``;

  const summary = await runHaikuSummarize(cwd, userMessage);
  if (!summary || summary.trim().length < 8) {
    // Too short / "无产品变化" → don't pollute the front-stage thread with
    // 4-char placeholders. Just log + skip the append.
    console.log(JSON.stringify({
      audit: 'adopted_summarizer.skipped_short',
      staff_id: staffId,
      len: summary?.length ?? 0,
      raw: summary?.slice(0, 30) ?? null,
      ts: new Date().toISOString(),
    }));
    return;
  }

  const threadId = `staff:${staffId}`;
  appendChatMessage(threadId, { role: 'assistant', content: summary });

  console.log(JSON.stringify({
    audit: 'adopted_summarizer.appended',
    staff_id: staffId,
    settled,
    delta_chars: delta.length,
    summary_chars: summary.length,
    ts: new Date().toISOString(),
  }));
}

// Warm summarizer pool — keyed by staff cwd (so summaries for different repos
// don't share context). System prompt is baked at spawn via --system-prompt so
// it persists for the process lifetime (NOT injected as user-turn text).
// Per-turn cost: ~1-2s instead of 3-5s cold spawn.
interface WarmSummarizer {
  proc: import('node:child_process').ChildProcessWithoutNullStreams;
  busy: boolean;
  buf: string;
  // Text assembled across the turn's `assistant` events. The final `result`
  // event uses this if no separate result.result was emitted.
  assembled: string;
  onResolve: ((v: string | null) => void) | null;
}
const _g2 = globalThis as unknown as { __holonSummarizerPool?: Map<string, WarmSummarizer> };
if (!_g2.__holonSummarizerPool) _g2.__holonSummarizerPool = new Map();
const POOL = _g2.__holonSummarizerPool;

function spawnWarmSummarizer(cwd: string | undefined): WarmSummarizer {
  const proc = spawn('claude', [
    '--print',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--system-prompt', SYSTEM_PROMPT,
    '--model', 'claude-sonnet-4-5',
    '--effort', 'low',
    '--dangerously-skip-permissions',
  ], { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });

  const w: WarmSummarizer = { proc, busy: false, buf: '', assembled: '', onResolve: null };

  // Stream-json events from `claude --print` use the same shape that
  // warm-agent.ts parses. Previous version checked `type==='message'`
  // (doesn't exist) and read `message.content` on the `result` event
  // (wrong field — it's `result.result` as a plain string). Result: this
  // resolver always fired with empty/null text, leaving the summary
  // pipeline silent (audit logs showed `skipped_short, len:0`). Fixed
  // here to match the warm-agent parser exactly.
  proc.stdout.on('data', (d) => {
    w.buf += d.toString('utf8');
    let nl: number;
    while ((nl = w.buf.indexOf('\n')) >= 0) {
      const line = w.buf.slice(0, nl);
      w.buf = w.buf.slice(nl + 1);
      if (!line.trim()) continue;
      let ev: {
        type?: string;
        message?: { content?: Array<{ type: string; text?: string }> };
        result?: unknown;
      };
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'assistant' && ev.message?.content) {
        // Authoritative full message for the turn — extract text parts.
        const text = ev.message.content
          .filter((b) => b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text as string).join('');
        if (text) w.assembled = text;
      } else if (ev.type === 'result') {
        // Turn boundary. Prefer the result string when present (covers
        // edge cases where assistant text was empty), otherwise use the
        // assembled text from earlier `assistant` events.
        if (typeof ev.result === 'string' && ev.result.trim()) {
          w.assembled = ev.result;
        }
        const final = w.assembled.trim();
        const cb = w.onResolve;
        w.assembled = '';
        w.onResolve = null;
        w.busy = false;
        cb?.(final || null);
      }
    }
  });
  proc.on('error', () => {
    if (w.onResolve) { const cb = w.onResolve; w.onResolve = null; w.busy = false; cb(null); }
  });
  proc.on('close', () => {
    if (w.onResolve) { const cb = w.onResolve; w.onResolve = null; w.busy = false; cb(null); }
    POOL.delete(cwd ?? '_default_');
  });

  return w;
}

function runHaikuSummarize(
  cwd: string | undefined,
  userMessage: string,
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const key = cwd ?? '_default_';
    let w = POOL.get(key);
    if (!w || w.proc.killed || w.proc.exitCode !== null) {
      w = spawnWarmSummarizer(cwd);
      POOL.set(key, w);
    }
    if (w.busy) {
      // Drop concurrent — summarizer is fire-and-forget, OK to lose one.
      resolve(null);
      return;
    }
    w.busy = true;
    w.onResolve = resolve;
    const msg = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: userMessage }] } });
    try {
      w.proc.stdin.write(msg + '\n');
    } catch (err) {
      w.busy = false;
      w.onResolve = null;
      console.warn(JSON.stringify({
        warn: 'adopted_summarizer.write_failed',
        msg: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }));
      resolve(null);
    }
    // Safety timeout — if no response in 30s, give up.
    setTimeout(() => {
      if (w.onResolve === resolve) {
        w.onResolve = null;
        w.busy = false;
        resolve(null);
      }
    }, 30_000);
  });
}
