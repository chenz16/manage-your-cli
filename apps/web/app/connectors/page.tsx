'use client';

import { redirect } from 'next/navigation';
import { useEffect, useState } from 'react';
import { invalidateOwner, useOwner } from '../../lib/hooks/useOwner';

type MessagingChannel = 'slack' | 'discord' | 'telegram';

type SttEngine = 'off' | 'whisper_cpp' | 'sensevoice' | 'faster_whisper' | 'openai';
type TtsEngine = 'off' | 'cosyvoice' | 'openai';

const STT_DEFAULT_URL: Record<Exclude<SttEngine, 'off' | 'openai'>, string> = {
  whisper_cpp: 'http://127.0.0.1:8080',
  sensevoice: 'http://127.0.0.1:8769',
  faster_whisper: 'http://127.0.0.1:8000',
};
const TTS_DEFAULT_URL: Record<Exclude<TtsEngine, 'off' | 'openai'>, string> = {
  cosyvoice: 'http://127.0.0.1:8770',
};

function sttLabel(engine: SttEngine): string {
  if (engine === 'whisper_cpp') return 'whisper.cpp';
  if (engine === 'sensevoice') return 'SenseVoice';
  if (engine === 'faster_whisper') return 'faster-whisper';
  if (engine === 'openai') return 'OpenAI';
  return 'Off';
}

function ttsLabel(engine: TtsEngine): string {
  if (engine === 'cosyvoice') return 'Local TTS';
  if (engine === 'openai') return 'OpenAI';
  return 'Off';
}

function normalizeStt(value: unknown): SttEngine {
  if (value === 'whisper_cpp' || value === 'sensevoice' || value === 'faster_whisper' || value === 'openai') return value;
  return 'off';
}

function normalizeTts(value: unknown): TtsEngine {
  if (value === 'cosyvoice' || value === 'openai') return value;
  return 'off';
}

export default function ConnectorsPage() {
  const { owner } = useOwner();
  const [sttEngine, setSttEngine] = useState<SttEngine>('off');
  const [sttUrl, setSttUrl] = useState(STT_DEFAULT_URL.whisper_cpp);
  const [sttKey, setSttKey] = useState('');
  const [sttStatus, setSttStatus] = useState<string | null>(null);

  const [ttsEngine, setTtsEngine] = useState<TtsEngine>('off');
  const [ttsUrl, setTtsUrl] = useState(TTS_DEFAULT_URL.cosyvoice);
  const [ttsKey, setTtsKey] = useState('');
  const [ttsStatus, setTtsStatus] = useState<string | null>(null);

  // Messaging state
  const [slackUrl, setSlackUrl] = useState('');
  const [slackStatus, setSlackStatus] = useState<string | null>(null);
  const [discordUrl, setDiscordUrl] = useState('');
  const [discordStatus, setDiscordStatus] = useState<string | null>(null);
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramStatus, setTelegramStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!owner) return;
    const nextStt = normalizeStt(owner.stt_provider);
    setSttEngine(nextStt);
    setSttUrl(typeof owner.stt_server_url === 'string' ? owner.stt_server_url : STT_DEFAULT_URL.whisper_cpp);
    setSttKey(typeof owner.stt_openai_api_key === 'string' ? owner.stt_openai_api_key : '');
    const nextTts = normalizeTts(owner.tts_provider);
    setTtsEngine(nextTts);
    setTtsUrl(typeof owner.tts_server_url === 'string' ? owner.tts_server_url : TTS_DEFAULT_URL.cosyvoice);
    setTtsKey(typeof owner.tts_openai_api_key === 'string' ? owner.tts_openai_api_key : '');
    // Messaging pre-fill
    setSlackUrl(typeof owner.slack_webhook_url === 'string' ? owner.slack_webhook_url : '');
    setDiscordUrl(typeof owner.discord_webhook_url === 'string' ? owner.discord_webhook_url : '');
    setTelegramToken(typeof owner.telegram_bot_token === 'string' ? owner.telegram_bot_token : '');
    setTelegramChatId(typeof owner.telegram_chat_id === 'string' ? owner.telegram_chat_id : '');
  }, [owner]);

  async function saveVoiceConfig(kind: 'stt' | 'tts') {
    const isStt = kind === 'stt';
    const engine = isStt ? sttEngine : ttsEngine;
    const statusSetter = isStt ? setSttStatus : setTtsStatus;
    statusSetter('Saving...');
    const body = isStt
      ? {
          stt_provider: engine === 'off' ? null : engine,
          stt_server_url: engine !== 'off' && engine !== 'openai' ? sttUrl.trim() : null,
          sensevoice_url: engine === 'sensevoice' ? sttUrl.trim() : null,
          stt_openai_api_key: engine === 'openai' ? sttKey.trim() : null,
        }
      : {
          tts_provider: engine === 'off' ? null : engine,
          tts_server_url: engine !== 'off' && engine !== 'openai' ? ttsUrl.trim() : null,
          tts_openai_api_key: engine === 'openai' ? ttsKey.trim() : null,
        };
    const res = await fetch('/api/v1/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      statusSetter(`Save failed: ${text || res.status}`);
      return;
    }
    invalidateOwner();
    statusSetter('Saved.');
  }

  async function saveMessagingConfig(channel: MessagingChannel) {
    const statusSetter =
      channel === 'slack' ? setSlackStatus
        : channel === 'discord' ? setDiscordStatus
          : setTelegramStatus;
    statusSetter('Saving...');
    const body =
      channel === 'slack'
        ? { slack_webhook_url: slackUrl.trim() || null }
        : channel === 'discord'
          ? { discord_webhook_url: discordUrl.trim() || null }
          : {
              telegram_bot_token: telegramToken.trim() || null,
              telegram_chat_id: telegramChatId.trim() || null,
            };
    const res = await fetch('/api/v1/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      statusSetter(`Save failed: ${text || res.status}`);
      return;
    }
    invalidateOwner();
    statusSetter('Saved.');
  }

  async function sendMessagingTestMsg(channel: MessagingChannel) {
    const statusSetter =
      channel === 'slack' ? setSlackStatus
        : channel === 'discord' ? setDiscordStatus
          : setTelegramStatus;
    statusSetter('Sending...');
    const res = await fetch('/api/v1/connectors/messaging/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel }),
    });
    const data = await res.json() as { ok?: boolean; error?: string };
    statusSetter(data.ok ? 'Test message sent.' : (data.error ?? `HTTP ${res.status}`));
  }

  async function checkSttHealth() {
    if (sttEngine === 'off') {
      setSttStatus('STT is off.');
      return;
    }
    setSttStatus('Checking...');
    const params = new URLSearchParams({ engine: sttEngine });
    if (sttEngine !== 'openai') params.set('url', sttUrl);
    const res = await fetch(`/api/v1/connectors/voice/health?${params.toString()}`);
    const body = await res.json() as { ok?: boolean; message?: string; error?: string };
    setSttStatus(body.ok ? `${sttLabel(sttEngine)} is reachable.` : (body.message ?? body.error ?? `HTTP ${res.status}`));
  }

  async function checkTtsHealth() {
    if (ttsEngine === 'off') {
      setTtsStatus('TTS is off.');
      return;
    }
    setTtsStatus('Checking...');
    const params = new URLSearchParams({ engine: ttsEngine });
    if (ttsEngine !== 'openai') params.set('url', ttsUrl);
    const res = await fetch(`/api/v1/connectors/tts/health?${params.toString()}`);
    const body = await res.json() as { ok?: boolean; message?: string; error?: string };
    setTtsStatus(body.ok ? `${ttsLabel(ttsEngine)} is reachable.` : (body.message ?? body.error ?? `HTTP ${res.status}`));
  }

  // Guard after all hooks (rules-of-hooks safe): Connectors is opt-in and
  // hidden by default. If the owner hasn't enabled it, bounce to chat.
  if (owner?.hidden_features?.includes('connectors')) redirect('/');

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Connectors</p>
          <h1 className="page-title">Voice &amp; Messaging</h1>
          <p className="page-subtitle">Connect optional voice, messaging, and social services. CLI agents are created from chat or the Team page — not here.</p>
        </div>
      </header>

      <section className="card" style={{ padding: 20, display: 'grid', gap: 20, maxWidth: 760 }}>
        <div>
          <p className="eyebrow">Voice</p>
          <h2 style={{ margin: 0, fontSize: 18 }}>Optional STT and TTS</h2>
          <p style={{ margin: '6px 0 0', color: 'var(--ink-mute)', fontSize: 13 }}>
            Voice is off unless you choose an engine. OpenAI keys here are voice-only keys stored with owner config, not chat or runtime tokens.
          </p>
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Speech-to-Text</h3>
          <select className="input" value={sttEngine} onChange={(event) => {
            const next = event.target.value as SttEngine;
            setSttEngine(next);
            if (next !== 'off' && next !== 'openai') setSttUrl(STT_DEFAULT_URL[next]);
          }}>
            {(['off', 'whisper_cpp', 'sensevoice', 'faster_whisper', 'openai'] as const).map((engine) => (
              <option key={engine} value={engine}>{sttLabel(engine)}</option>
            ))}
          </select>
          {sttEngine !== 'off' && sttEngine !== 'openai' && (
            <input className="input" value={sttUrl} onChange={(event) => setSttUrl(event.target.value)} placeholder="http://127.0.0.1:8080" />
          )}
          {sttEngine === 'openai' && (
            <input className="input" type="password" value={sttKey} onChange={(event) => setSttKey(event.target.value)} placeholder="OpenAI voice API key" autoComplete="off" />
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" onClick={() => saveVoiceConfig('stt')}>Save STT</button>
            <button type="button" className="btn" onClick={checkSttHealth}>Health Check</button>
          </div>
          {sttStatus && <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 13 }}>{sttStatus}</p>}
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Text-to-Speech</h3>
          <select className="input" value={ttsEngine} onChange={(event) => {
            const next = event.target.value as TtsEngine;
            setTtsEngine(next);
            if (next === 'cosyvoice') setTtsUrl(TTS_DEFAULT_URL.cosyvoice);
          }}>
            {(['off', 'cosyvoice', 'openai'] as const).map((engine) => (
              <option key={engine} value={engine}>{ttsLabel(engine)}</option>
            ))}
          </select>
          {ttsEngine === 'cosyvoice' && (
            <input className="input" value={ttsUrl} onChange={(event) => setTtsUrl(event.target.value)} placeholder="http://127.0.0.1:8770" />
          )}
          {ttsEngine === 'openai' && (
            <input className="input" type="password" value={ttsKey} onChange={(event) => setTtsKey(event.target.value)} placeholder="OpenAI voice API key" autoComplete="off" />
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" onClick={() => saveVoiceConfig('tts')}>Save TTS</button>
            <button type="button" className="btn" onClick={checkTtsHealth}>Health Check</button>
          </div>
          {ttsStatus && <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 13 }}>{ttsStatus}</p>}
        </div>
      </section>

      <section className="card" style={{ padding: 20, display: 'grid', gap: 20, maxWidth: 760, marginTop: 18 }}>
        <div>
          <p className="eyebrow">Messaging &amp; Social</p>
          <h2 style={{ margin: 0, fontSize: 18 }}>Message &amp; social channels</h2>
          <p style={{ margin: '6px 0 0', color: 'var(--ink-mute)', fontSize: 13 }}>
            Webhook/token-based channels let the desk push notifications. Tokens are owner-scoped, like voice keys.
          </p>
        </div>

        {/* Slack */}
        <div style={{ display: 'grid', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Slack</h3>
          <input
            className="input"
            value={slackUrl}
            onChange={(event) => setSlackUrl(event.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            autoComplete="off"
          />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" onClick={() => saveMessagingConfig('slack')}>Save</button>
            <button type="button" className="btn" onClick={() => sendMessagingTestMsg('slack')}>Send test</button>
          </div>
          {slackStatus && <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 13 }}>{slackStatus}</p>}
        </div>

        {/* Discord */}
        <div style={{ display: 'grid', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Discord</h3>
          <input
            className="input"
            value={discordUrl}
            onChange={(event) => setDiscordUrl(event.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
            autoComplete="off"
          />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" onClick={() => saveMessagingConfig('discord')}>Save</button>
            <button type="button" className="btn" onClick={() => sendMessagingTestMsg('discord')}>Send test</button>
          </div>
          {discordStatus && <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 13 }}>{discordStatus}</p>}
        </div>

        {/* Telegram */}
        <div style={{ display: 'grid', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Telegram</h3>
          <input
            className="input"
            value={telegramToken}
            onChange={(event) => setTelegramToken(event.target.value)}
            placeholder="Bot token (from @BotFather)"
            autoComplete="off"
          />
          <input
            className="input"
            value={telegramChatId}
            onChange={(event) => setTelegramChatId(event.target.value)}
            placeholder="Chat ID (numeric)"
            autoComplete="off"
          />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" onClick={() => saveMessagingConfig('telegram')}>Save</button>
            <button type="button" className="btn" onClick={() => sendMessagingTestMsg('telegram')}>Send test</button>
          </div>
          {telegramStatus && <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 13 }}>{telegramStatus}</p>}
        </div>

        {/* Coming channels (OAuth-required) */}
        <div style={{ display: 'grid', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15, color: 'var(--ink-mute)' }}>Coming (OAuth required)</h3>
          {(['Gmail', 'Google Meet'] as const).map((name) => (
            <div
              key={name}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 12px',
                border: '1px solid var(--line)',
                borderRadius: 8,
                opacity: 0.5,
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
              <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Coming</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
