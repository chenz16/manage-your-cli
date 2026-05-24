/**
 * Owner-agent chat adapter — bridges assistant-ui's ChatModelAdapter
 * contract to our SSE endpoint at /api/v1/chat/owner/stream.
 *
 * Persistence (iter-007 fix 2026-05-16):
 *   - On adapter creation we read prior conversation from
 *     sessionStorage (key `holon.chatMessages`) and expose it via
 *     `loadInitialMessages()` so the runtime provider can pass it as
 *     `initialMessages` on construction.
 *   - After every successful turn we append the user prompt + final
 *     assistant text to sessionStorage so a page refresh restores the
 *     conversation. sessionStorage scope = single tab; for cross-tab
 *     persistence we'd need a server-side history endpoint (deferred).
 */

import type { ChatModelAdapter, ThreadMessageLike } from '@assistant-ui/react';
import { reloadForLanguageChange, type ExplicitLang } from './language-reload';
import { getActiveProjectId } from '../../lib/hooks/useProjects';

const STORAGE_KEY = 'holon.chatMessages';

interface StoredMessage { role: 'user' | 'assistant'; content: string }

function readStored(): StoredMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((m): m is StoredMessage =>
      typeof m === 'object' && m !== null &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string',
    );
  } catch {
    return [];
  }
}

function writeStored(messages: StoredMessage[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // QuotaExceeded or storage disabled — silently drop persistence.
  }
}

/** Wipe stored history. Called by the admin-reset event listener so
 *  /me's debug "Wipe chat" button also clears client storage. */
export function clearStoredMessages(): void {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(STORAGE_KEY); } catch {}
}

/** Read prior conversation for `useLocalRuntime`'s `initialMessages`. */
export function loadInitialMessages(): ThreadMessageLike[] {
  return readStored().map((m) => ({ role: m.role, content: m.content }));
}

/** L-050: hydrate first-load chat from the persona's seeded starter
 *  greeting (`/api/v1/chat/threads`) when sessionStorage is empty.
 *  Without this, Pass #4's per-persona starter_greeting has no UI
 *  surface and the customer never sees the Desk AI introduce itself.
 *
 *  Strategy: fetch /me to learn the active persona's role_label, then
 *  pick the `/chat/threads` entry whose participant_role matches. Fall
 *  back to the first thread if no match. Returns [] on any network or
 *  shape error so the UI degrades to empty silently. Also primes
 *  sessionStorage so the greeting persists across page refreshes the
 *  same way authored conversations do. */
export async function fetchInitialMessagesFromApi(): Promise<ThreadMessageLike[]> {
  if (typeof window === 'undefined') return [];
  try {
    const [meRes, threadsRes] = await Promise.all([
      fetch('/api/v1/me', { cache: 'no-store' }),
      fetch('/api/v1/chat/threads', { cache: 'no-store' }),
    ]);
    if (!meRes.ok || !threadsRes.ok) return [];
    const me = await meRes.json() as { role_label?: string };
    const threads = await threadsRes.json() as {
      items?: Array<{ participant_role?: string; messages?: Array<{ role?: string; body?: string }> }>;
    };
    const items = Array.isArray(threads.items) ? threads.items : [];
    if (items.length === 0) return [];
    const matched = items.find((t) => t.participant_role === me.role_label) ?? items[0];
    const msgs = Array.isArray(matched?.messages) ? matched.messages : [];
    const hydrated: StoredMessage[] = msgs
      .filter((m) => typeof m?.body === 'string' && (m.role === 'agent' || m.role === 'user'))
      .map((m) => ({
        role: m.role === 'agent' ? ('assistant' as const) : ('user' as const),
        content: m.body as string,
      }));
    if (hydrated.length > 0) writeStored(hydrated);
    return hydrated.map((m) => ({ role: m.role, content: m.content }));
  } catch {
    return [];
  }
}

interface StreamEvent {
  type: 'text' | 'tool_call' | 'tool_update' | 'done' | 'error' | 'language_changed';
  text?: string;
  finalText?: string;
  message?: string;
  name?: string;
  language?: ExplicitLang;
  status?: string;
  id?: string;
  stopReason?: string;
}

/* iter-010 Pass #4 — chat-side refusal copy.
 *
 * When the owner asks a staff to do work via chat, the LLM calls
 * `assign_to_staff` which POSTs `/api/v1/staff/:id/jobs`. Pass #3
 * + L-010 made that endpoint return HTTP 402 with a structured
 * `{error: 'budget_exceeded', mtd_mc, cap_mc, hint}` when the staff's
 * monthly_budget_millicents cap is reached.
 *
 * Detection is content-based (substring + JSON parse): scan streamed
 * text + SSE error events for the canonical `budget_exceeded` shape and
 * substitute in the friendly refusal copy. Other 4xx/5xx are surfaced
 * verbatim so we never silently swallow a failure (Engineering Rule #4).
 */
interface BudgetRefusal { mtd_mc: number; cap_mc: number; hint?: string }

function extractBudgetRefusal(s: string): BudgetRefusal | null {
  if (!s || s.indexOf('budget_exceeded') === -1) return null;
  // Try every JSON-object substring. Cheap heuristic — at most a couple
  // of braces per text chunk; budget_exceeded is rare so this only
  // matters on the failure path.
  let start = s.indexOf('{');
  while (start !== -1) {
    let depth = 0;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          const slice = s.slice(start, i + 1);
          try {
            const obj = JSON.parse(slice) as { error?: string; mtd_mc?: number; cap_mc?: number; hint?: string; body?: string };
            if (obj && obj.error === 'budget_exceeded'
                && typeof obj.mtd_mc === 'number' && typeof obj.cap_mc === 'number') {
              const out: BudgetRefusal = { mtd_mc: obj.mtd_mc, cap_mc: obj.cap_mc };
              if (typeof obj.hint === 'string') out.hint = obj.hint;
              return out;
            }
            // tools.py wraps non-2xx as {error: "BFF ... returned 402", body: "<inner JSON>"}
            if (obj && typeof obj.body === 'string' && obj.body.indexOf('budget_exceeded') !== -1) {
              const inner = extractBudgetRefusal(obj.body);
              if (inner) return inner;
            }
          } catch { /* not JSON — keep scanning */ }
          break;
        }
      }
    }
    start = s.indexOf('{', start + 1);
  }
  return null;
}

function refusalCopy(r: BudgetRefusal): string {
  const mtdUsd = (r.mtd_mc / 100_000).toFixed(2);
  const capUsd = (r.cap_mc / 100_000).toFixed(2);
  return `💰 Staff hit their monthly cap ($${mtdUsd} of $${capUsd}). Raise the cap on /me or wait until next month.`;
}

function languageRefreshingCopy(language: ExplicitLang): string {
  return language === 'zh-CN' ? '语言已切换，正在刷新…' : 'Language changed, refreshing...';
}

function isExplicitLang(value: unknown): value is ExplicitLang {
  return value === 'en' || value === 'zh-CN';
}

function flattenToText(content: ReadonlyArray<{ type: string; text?: string }>): string {
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
}

/** Client-side slash commands the adapter intercepts before hitting
 *  the server. Keep this list short — anything that needs the LLM
 *  should NOT be a slash command. */
const SLASH_COMMANDS: Record<string, string> = {
  '/clear': 'Wipe chat history (server session + local cache).',
  '/help':  'List slash commands.',
  '/cli':   'Open a CLI member terminal. Usage: /cli <staff_name_or_id>.',
};

export function makeOwnerAdapter(): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const payload = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: flattenToText(m.content) }));

      // ── Slash-command interception ──────────────────────────────
      const last = payload[payload.length - 1];
      const cmdLine = last?.content?.trim() ?? '';
      const [cmdHead, ...cmdRest] = cmdLine.split(/\s+/);
      const cmd = cmdHead ?? '';
      const cmdArgs = cmdRest.join(' ').trim();
      if (cmd in SLASH_COMMANDS) {
        if (cmd === '/help') {
          const lines = ['Available slash commands:'];
          for (const [name, desc] of Object.entries(SLASH_COMMANDS)) lines.push(`  ${name} — ${desc}`);
          yield { content: [{ type: 'text', text: lines.join('\n') }] };
          return;
        }
        if (cmd === '/cli') {
          if (!cmdArgs) {
            yield { content: [{ type: 'text', text: 'Usage: `/cli <staff_name_or_id>`' }] };
            return;
          }
          // Resolve name or id by fetching the roster client-side.
          let staffId = '';
          let staffName = '';
          try {
            const res = await fetch('/api/v1/staff');
            const { items } = (await res.json()) as { items: Array<{ id: string; name: string; substrate: { kind: string } }> };
            const target = items.find(
              (s) => s.id === cmdArgs
                || s.name.toLowerCase() === cmdArgs.toLowerCase()
                || s.id.endsWith(cmdArgs),
            );
            if (!target) {
              yield { content: [{ type: 'text', text: `❌ No staff matching "${cmdArgs}". Try /cli with the name or id.` }] };
              return;
            }
            // ADR-029 Phase B: accept both `'cli'` (legacy alias) and `'cli_agent'`
            // (canonical) until the V2 cutover drops `'cli'`.
            if (target.substrate.kind !== 'cli' && target.substrate.kind !== 'cli_agent') {
              yield { content: [{ type: 'text', text: `❌ "${target.name}" is substrate=${target.substrate.kind}, not cli/cli_agent. Only CLI-agent staff have terminals.` }] };
              return;
            }
            staffId = target.id;
            staffName = target.name;
          } catch (e) {
            yield { content: [{ type: 'text', text: `❌ Couldn't fetch roster: ${e instanceof Error ? e.message : String(e)}` }] };
            return;
          }
          yield { content: [{ type: 'text', text: `Opening terminal for **${staffName}**…` }] };
          if (typeof window !== 'undefined') {
            setTimeout(() => { window.location.href = `/members?cli=${staffId}`; }, 250);
          }
          return;
        }
        if (cmd === '/clear') {
          try {
            await fetch('/api/v1/admin/reset', { method: 'POST', signal: abortSignal });
          } catch { /* server may be down — still clear client */ }
          clearStoredMessages();
          // Force ChatRuntimeProvider to remount (bumps mountKey via
          // listener) — that drops assistant-ui's internal thread state.
          // We don't yield text first because the remount unmounts this
          // generator; the empty-state will be the user's confirmation.
          if (typeof window !== 'undefined') {
            // Defer one tick so any state writes flush before remount.
            setTimeout(() => window.dispatchEvent(new Event('holon:reset')), 0);
          }
          return;
        }
      }


      // Owner directive 2026-05-19 19:48: cancel mid-generation.
      // assistant-ui's local runtime passes `abortSignal` here; when the
      // user clicks Stop, that signal aborts AND the fetch RST propagates
      // server-side (req.signal.aborted on the BFF), which cancels the
      // warm-agent subprocess. Cancel is end-to-end: client AbortController
      // → server stream close → warm-agent cancel → next turn on the SAME
      // session is reusable. On abort we yield a final assistant chunk with
      // the cancelled-footer so the partial bubble keeps its content + shows
      // a clear "I stopped" affordance, instead of vanishing or rendering as
      // an unmarked truncation.
      // Phase 1 follow-up: include the currently selected project id so the
      // server-side Secretary prompt injection (route.ts § "active project
      // memory injection") picks it up. null = no active project → server
      // behavior unchanged (backward-compat for single-project / no-project
      // bosses).
      const activeProjectId = getActiveProjectId();

      let res: Response;
      try {
        res = await fetch('/api/v1/chat/owner/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: payload, active_project_id: activeProjectId }),
          signal: abortSignal,
        });
      } catch (err) {
        // AbortError on the fetch promise itself = user cancelled before
        // any bytes arrived. Yield a minimal cancelled footer so the
        // assistant bubble still renders something (vs blank).
        if (abortSignal?.aborted) {
          yield { content: [{ type: 'text', text: cancelledFooter('') }] };
          return;
        }
        throw err;
      }

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        // Pass #4 — don't swallow 4xx/5xx: surface as visible error.
        let body: { error?: string } = {};
        try { body = JSON.parse(text) as { error?: string }; } catch { /* not JSON */ }
        const detail = body.error ?? text.slice(0, 300) ?? 'unexpected';
        yield { content: [{ type: 'text', text: `⚠️ Error ${res.status}: ${detail}` }] };
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let assembled = '';
      // Pass #4 — track whether we've already swapped in the friendly
      // refusal copy so we don't double-render if multiple text chunks
      // contain the payload (e.g. LLM echoes it then summarizes).
      let budgetRefused = false;
      let cancelled = false;
      let languageReloadScheduled = false;

      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (err) {
          // Mid-stream abort: reader.read() rejects with AbortError when
          // the underlying fetch is cancelled. Emit the cancelled footer
          // appended to whatever we've assembled so far so the partial
          // useful content survives + the user sees a clear stop marker.
          if (abortSignal?.aborted) {
            cancelled = true;
            assembled = cancelledFooter(assembled);
            yield { content: [{ type: 'text', text: assembled }] };
            break;
          }
          throw err;
        }
        const { value, done } = chunk;
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let sep = buf.indexOf('\n\n');
        while (sep !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          sep = buf.indexOf('\n\n');

          const dataLines = frame.split('\n').filter((l) => l.startsWith('data:'));
          for (const line of dataLines) {
            const json = line.slice(5).trim();
            if (!json) continue;
            let ev: StreamEvent;
            try { ev = JSON.parse(json) as StreamEvent; } catch { continue; }

            if (ev.type === 'text' && typeof ev.text === 'string') {
              assembled = ev.text;
              // Pass #4 — substitute friendly refusal copy on detection.
              if (!budgetRefused) {
                const refusal = extractBudgetRefusal(assembled);
                if (refusal) {
                  budgetRefused = true;
                  assembled = refusalCopy(refusal);
                }
              }
              yield { content: [{ type: 'text', text: assembled }] };
            } else if (ev.type === 'done') {
              if (ev.finalText && ev.finalText !== assembled) {
                assembled = ev.finalText;
                yield { content: [{ type: 'text', text: assembled }] };
              }
            } else if (ev.type === 'error') {
              // Pass #4 — error events may carry tool-failure JSON (e.g.
              // assign_to_staff hit 402). Surface budget refusal cleanly;
              // otherwise emit verbatim so we don't swallow 4xx/5xx.
              const raw = ev.message ?? 'stream error';
              const refusal = extractBudgetRefusal(raw);
              if (refusal && !budgetRefused) {
                budgetRefused = true;
                assembled = refusalCopy(refusal);
                yield { content: [{ type: 'text', text: assembled }] };
              } else {
                yield { content: [{ type: 'text', text: `⚠️ Error: ${raw}` }] };
              }
            } else if (ev.type === 'language_changed' && isExplicitLang(ev.language)) {
              const status = languageRefreshingCopy(ev.language);
              yield { content: [{ type: 'text', text: status }] };
              if (!languageReloadScheduled && typeof window !== 'undefined') {
                languageReloadScheduled = true;
                reloadForLanguageChange(ev.language, 500);
              }
            }
          }
        }
      }

      // Persist the completed turn — INCLUDING cancelled turns. If the
      // user cancelled mid-stream, the partial+footer is still useful
      // (some response is better than none in session history) and
      // matches the visible bubble. The footer is the marker that this
      // turn was cancelled — readable on refresh, no ambiguity.
      const finalAssistant = assembled.trim();
      if (finalAssistant) {
        const next: StoredMessage[] = [
          ...payload.map((m) => ({ role: m.role, content: m.content })),
          { role: 'assistant', content: finalAssistant },
        ];
        writeStored(next);
      }
      // Reference `cancelled` so static-analysis doesn't flag it unused
      // and so a future code path that needs to differentiate has a hook.
      void cancelled;
    },
  };
}

/** Append the cancelled-footer to whatever partial assistant text we
 *  assembled. Keeps the partial content (often useful — the LLM may have
 *  said something meaningful before cancel) and adds a clear stop marker.
 *  i18n strings live in the chat dictionary (chat.cancelled_footer);
 *  resolved client-side from globalThis-stashed dict by ChatRuntimeProvider
 *  if available, else falls back to the English string. The adapter runs
 *  inside a generator with no React context, so we can't useT() here. */
function cancelledFooter(partial: string): string {
  const footer = readCancelledFooterLabel();
  return partial ? `${partial}\n\n${footer}` : footer;
}

function readCancelledFooterLabel(): string {
  // Read from the i18n dict the I18nProvider stashes onto globalThis
  // for non-React-context consumers (adapter generators, listeners).
  // Falls back to English if the stash hasn't been hydrated yet.
  if (typeof window === 'undefined') return '— cancelled —';
  const g = window as unknown as { __holonI18nDict?: Record<string, string> };
  return g.__holonI18nDict?.['chat.cancelled_footer'] ?? '— cancelled —';
}
