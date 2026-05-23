'use client';

/**
 * Step 4 — Try delegating.
 *
 * Persona-aware prefill in a single textarea. Auto-fills on render;
 * user can edit before submit. "Send" POSTs to /api/v1/chat/owner/stream
 * and renders the streamed reply inline. Then Next → Step 5 (which
 * watches /deliverables for the first artifact).
 *
 * Persona→prompt mapping is a small in-file table — the persona ID
 * matches packages/core/src/persona-catalog.ts. Falls back to a
 * generic "summarize my work" prompt if persona unknown.
 *
 * NOTE (tentative — see Q-007 follow-up): per brief escape-hatch, the
 * prefill IS editable (auto-fills only — does NOT auto-submit). The
 * user must click Send. This avoids surprising the user with a chat
 * turn they didn't initiate, and matches the "user feels in control"
 * UX bar from CLAUDE.md § Working Patterns.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../../lib/i18n/useT';

interface Props {
  personaId: string | null;
  gmailConnected: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkipStep: () => void;
  onSkipOnboarding: () => void;
}

// Persona ID → prompt prefill. Mirrors packages/core/src/persona-catalog.ts
// IDs. Gmail-connected variants when relevant. Defaults provided for
// any unknown ID.
function prefillFor(personaId: string | null, gmailConnected: boolean): string {
  switch (personaId) {
    case 'marketing_director_robotics':
      return 'Sketch a Q3 marketing campaign for our robotics product — three concrete tactics and one risk to watch.';
    case 'engineering_manager_backend':
      return 'Draft a one-page tech-debt triage plan for our backend team for the next two weeks.';
    case 'founder_solo_gm':
      return gmailConnected
        ? 'Summarize the last 24 hours of my inbox and flag anything that needs a reply today.'
        : 'Draft a hiring plan for an EA — top 3 responsibilities and what to look for in week-one.';
    case 'hr_people_ops':
      return 'Draft a 30-60-90 day onboarding outline for a new mid-level engineer.';
    case 'sales_director_enterprise':
      return 'Outline a discovery-call template for an enterprise prospect in the manufacturing vertical.';
    case 'product_manager_consumer':
      return 'Sketch an A/B-test plan for our onboarding funnel — one hypothesis, one metric, one rollout cut.';
    case 'finance_controller_startup':
      return 'Draft a one-page monthly board update template — KPIs, cash runway, top 3 risks.';
    case 'research_director_academic':
      return 'Draft a 6-month research-direction memo for my group on the topic I work in.';
    default:
      return 'Show me what you can do — pick something useful for the next 30 minutes of my day and draft it.';
  }
}

interface Msg { role: 'user' | 'assistant'; text: string }

export function Step4TryDelegating({ personaId, gmailConnected, onBack, onNext, onSkipStep, onSkipOnboarding }: Props) {
  const { t } = useT();
  const initialPrompt = useMemo(() => prefillFor(personaId, gmailConnected), [personaId, gmailConnected]);
  const [draft, setDraft] = useState(initialPrompt);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // L-090: true when the 503 body carried code:'no-llm-provider-configured'
  const [noLlmConfigured, setNoLlmConfigured] = useState(false);
  const sentOnce = useRef(false);

  async function send() {
    if (!draft.trim() || streaming) return;
    const userText = draft.trim();
    setMessages((m) => [...m, { role: 'user', text: userText }, { role: 'assistant', text: '' }]);
    setDraft('');
    setStreaming(true);
    setError(null);
    setNoLlmConfigured(false);
    sentOnce.current = true;
    try {
      const r = await fetch('/api/v1/chat/owner/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: userText }] }),
      });
      // L-090: parse structured 503 before falling back to generic error.
      if (r.status === 503) {
        try {
          const body = await r.json() as { code?: string };
          if (body.code === 'no-llm-provider-configured') {
            setNoLlmConfigured(true);
            setMessages((m) => m.slice(0, -2)); // remove the optimistic bubbles
            return;
          }
        } catch { /* non-JSON 503 — fall through to generic handler */ }
      }
      if (!r.ok || !r.body) {
        throw new Error(`HTTP ${r.status}`);
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      // Read SSE events. Minimal parser — splits on "\n\n", extracts
      // `data: {...}` payloads, appends `text` chunks to the last
      // assistant message.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split(/\n\n/);
        buf = events.pop() ?? '';
        for (const ev of events) {
          const line = ev.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try {
            const obj = JSON.parse(line.slice(6)) as { type?: string; text?: string };
            if (obj.type === 'text' && obj.text) {
              const chunk = obj.text;
              setMessages((m) => {
                const copy = [...m];
                const last = copy[copy.length - 1];
                if (last && last.role === 'assistant') {
                  copy[copy.length - 1] = { ...last, text: last.text + chunk };
                }
                return copy;
              });
            }
          } catch { /* ignore parse errors on non-JSON heartbeats */ }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
    }
  }

  // Auto-focus the textarea so the user can edit immediately.
  useEffect(() => {
    const el = document.getElementById('onb-step4-prompt') as HTMLTextAreaElement | null;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <>
      <h1 className="onb-title">Try delegating your first task</h1>
      <p className="onb-sub">
        We've written a starter request for your role — edit it to match
        something real on your plate today, or just send it as-is to see
        how your AI staff respond.
      </p>

      <div className="onb-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length > 0 && (
          <div className="onb-chat-feed">
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'onb-bubble-user' : 'onb-bubble-ai onb-pulse'}>
                {m.text || (streaming && i === messages.length - 1 ? '…' : '')}
              </div>
            ))}
          </div>
        )}
        <textarea
          id="onb-step4-prompt"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          disabled={streaming}
          placeholder="What would you like to hand off? (e.g. 'Draft a follow-up email to the Frankfurt client about next week's booth review')"
          style={{
            padding: '10px 12px', borderRadius: 10, border: '1px solid var(--ink)',
            fontSize: 13, fontFamily: 'inherit', color: 'var(--ink)', background: '#fff',
            outline: 'none', lineHeight: 1.5, resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={send} disabled={streaming || !draft.trim()}>
            {streaming ? 'Your AI is thinking…' : 'Send to your AI staff'}
          </button>
        </div>
        {noLlmConfigured && (
          /* L-090: friendly recovery UI when LLM provider not yet configured */
          <div style={{ fontSize: 13, color: 'var(--ink)', background: '#fff8e1', border: '1px solid #f0c800', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>{t('onboarding.step4.no_llm_message', 'AI 还没配置 — 先去 Step 6 选个 LLM provider，配置好再回来试试。')}</div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ alignSelf: 'flex-start' }}
              onClick={onNext}
            >
              {t('onboarding.step4.no_llm_cta', '→ Step 6 配置 LLM')}
            </button>
          </div>
        )}
        {error && <div style={{ fontSize: 13, color: 'var(--red, #c0392b)' }}>{error}</div>}
      </div>

      <div className="onb-controls">
        <button type="button" className="btn" onClick={onBack} disabled={streaming}>Back</button>
        <button
          type="button"
          className="btn onb-skip-link onb-skip-heavy"
          onClick={onSkipOnboarding}
          disabled={streaming}
          title="Exit onboarding entirely. Resume from /me → Replay onboarding."
        >
          {t('onboarding.skip_onboarding', 'Skip onboarding')}
        </button>
        <div className="spacer" />
        <button
          type="button"
          className="btn"
          onClick={onSkipStep}
          disabled={streaming}
          title="Move on without sending a test request. You can chat with your AI staff any time from /."
        >
          {t('onboarding.skip_this_step', 'Skip this step')}
        </button>
        <button type="button" className="btn btn-primary" onClick={onNext} disabled={streaming || !sentOnce.current}>
          Next — watch a deliverable land
        </button>
      </div>
    </>
  );
}
