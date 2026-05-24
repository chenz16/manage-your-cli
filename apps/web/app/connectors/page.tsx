'use client';

import { redirect } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { invalidateOwner, useOwner } from '../../lib/hooks/useOwner';

type MessagingChannel = 'slack' | 'discord' | 'telegram';

// ---------------------------------------------------------------------------
// Plugin types (mirrors api-contract/src/manifests/plugins.ts + plugin-store.ts)
// ---------------------------------------------------------------------------
interface McpToolCapability {
  id: string;
  label: string;
  risk: 'read' | 'write';
  description: string;
}

interface McpPluginConfigField {
  key: string;
  label: string;
  required: boolean;
  secret?: boolean;
  description?: string;
}

interface McpPluginManifest {
  id: string;
  name: string;
  description: string;
  transport: 'stdio' | 'remote';
  bundled?: boolean;
  capabilities: McpToolCapability[];
  needsConfig: McpPluginConfigField[];
}

interface InstalledMcpPlugin {
  id: string;
  label: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

interface PluginsData {
  registry: McpPluginManifest[];
  installed: InstalledMcpPlugin[];
}

// ---------------------------------------------------------------------------
// A2A types (subset of A2A 0.2.0 agent card + task result)
// ---------------------------------------------------------------------------
interface A2ASkill {
  id: string;
  name: string;
}

interface AgentCard {
  name: string;
  protocolVersion: string;
  skills: A2ASkill[];
}

interface A2ATaskResult {
  result?: {
    artifacts?: Array<{
      parts: Array<{ kind: string; text?: string }>;
    }>;
  };
  error?: { message: string };
}

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

  // A2A state
  const [myCard, setMyCard] = useState<AgentCard | null>(null);
  const [myCardError, setMyCardError] = useState<string | null>(null);
  const [peerUrl, setPeerUrl] = useState('');
  const [peerCard, setPeerCard] = useState<AgentCard | null>(null);
  const [peerCardStatus, setPeerCardStatus] = useState<string | null>(null);
  const [pingMsg, setPingMsg] = useState('Hello from this desk!');
  const [pingStatus, setPingStatus] = useState<string | null>(null);

  // Messaging state
  const [slackUrl, setSlackUrl] = useState('');
  const [slackStatus, setSlackStatus] = useState<string | null>(null);
  const [discordUrl, setDiscordUrl] = useState('');
  const [discordStatus, setDiscordStatus] = useState<string | null>(null);
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramStatus, setTelegramStatus] = useState<string | null>(null);

  // Plugin state
  const [pluginsData, setPluginsData] = useState<PluginsData | null>(null);
  const [pluginsError, setPluginsError] = useState<string | null>(null);
  // per-plugin: config inputs (keyed by plugin id) and action status
  const [pluginConfigInputs, setPluginConfigInputs] = useState<Record<string, Record<string, string>>>({});
  const [pluginActionStatus, setPluginActionStatus] = useState<Record<string, string>>({});

  const fetchPlugins = useCallback(() => {
    setPluginsError(null);
    fetch('/api/v1/plugins')
      .then(async (res) => {
        if (!res.ok) {
          setPluginsError(`HTTP ${res.status}: ${await res.text()}`);
          return;
        }
        const data = await res.json() as PluginsData;
        setPluginsData(data);
      })
      .catch((err: unknown) => {
        setPluginsError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  async function installPlugin(manifest: McpPluginManifest) {
    const config = pluginConfigInputs[manifest.id] ?? {};
    setPluginActionStatus((prev) => ({ ...prev, [manifest.id]: 'Installing…' }));
    try {
      const res = await fetch('/api/v1/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: manifest.id, config }),
      });
      const data = await res.json() as { installed?: InstalledMcpPlugin; error?: string };
      if (!res.ok) {
        setPluginActionStatus((prev) => ({ ...prev, [manifest.id]: `错误: ${data.error ?? res.status}` }));
        return;
      }
      setPluginActionStatus((prev) => ({ ...prev, [manifest.id]: '已安装' }));
      fetchPlugins();
    } catch (err: unknown) {
      setPluginActionStatus((prev) => ({ ...prev, [manifest.id]: err instanceof Error ? err.message : String(err) }));
    }
  }

  async function togglePlugin(id: string, enabled: boolean) {
    setPluginActionStatus((prev) => ({ ...prev, [id]: enabled ? '启用中…' : '停用中…' }));
    try {
      const res = await fetch(`/api/v1/plugins/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json() as { installed?: InstalledMcpPlugin; error?: string };
      if (!res.ok) {
        setPluginActionStatus((prev) => ({ ...prev, [id]: `错误: ${data.error ?? res.status}` }));
        return;
      }
      setPluginActionStatus((prev) => ({ ...prev, [id]: enabled ? '已启用' : '已停用' }));
      fetchPlugins();
    } catch (err: unknown) {
      setPluginActionStatus((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : String(err) }));
    }
  }

  async function uninstallPlugin(id: string) {
    setPluginActionStatus((prev) => ({ ...prev, [id]: '卸载中…' }));
    try {
      const res = await fetch(`/api/v1/plugins/${id}`, { method: 'DELETE' });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) {
        setPluginActionStatus((prev) => ({ ...prev, [id]: `错误: ${data.error ?? res.status}` }));
        return;
      }
      setPluginActionStatus((prev) => ({ ...prev, [id]: '' }));
      fetchPlugins();
    } catch (err: unknown) {
      setPluginActionStatus((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : String(err) }));
    }
  }

  // Fetch plugins on mount.
  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  // Fetch this desk's own agent card on mount.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPeerUrl(window.location.origin);
    }
    fetch('/.well-known/agent-card.json')
      .then(async (res) => {
        if (!res.ok) {
          setMyCardError(`HTTP ${res.status}: ${await res.text()}`);
          return;
        }
        const data = await res.json() as AgentCard;
        setMyCard(data);
      })
      .catch((err: unknown) => {
        setMyCardError(err instanceof Error ? err.message : String(err));
      });
  }, []);

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

  // ---------------------------------------------------------------------------
  // A2A handlers
  // ---------------------------------------------------------------------------

  async function discoverPeer() {
    const base = peerUrl.trim().replace(/\/$/, '');
    if (!base) { setPeerCardStatus('Enter a peer base URL.'); return; }
    setPeerCardStatus('Discovering…');
    setPeerCard(null);
    try {
      const res = await fetch(`${base}/.well-known/agent-card.json`);
      if (!res.ok) {
        setPeerCardStatus(`HTTP ${res.status}: ${await res.text()}`);
        return;
      }
      const data = await res.json() as AgentCard;
      setPeerCard(data);
      setPeerCardStatus(`Found: ${data.name} (A2A ${data.protocolVersion})`);
    } catch (err: unknown) {
      setPeerCardStatus(err instanceof Error ? err.message : String(err));
    }
  }

  async function sendPingMessage() {
    const base = peerUrl.trim().replace(/\/$/, '');
    if (!base) { setPingStatus('Enter a peer base URL.'); return; }
    if (!pingMsg.trim()) { setPingStatus('Enter a message.'); return; }
    setPingStatus('Sending…');
    const rpcId = Math.floor(Math.random() * 1_000_000);
    try {
      const res = await fetch(`${base}/api/v1/a2a`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: rpcId,
          method: 'message/send',
          params: {
            message: {
              role: 'user',
              parts: [{ kind: 'text', text: pingMsg.trim() }],
            },
          },
        }),
      });
      const data = await res.json() as A2ATaskResult;
      if (data.error) {
        setPingStatus(`Error: ${data.error.message}`);
        return;
      }
      const text = data.result?.artifacts?.[0]?.parts?.find((p) => p.kind === 'text')?.text;
      setPingStatus(text ? `Reply: ${text}` : 'Task completed (no text artifact).');
    } catch (err: unknown) {
      setPingStatus(err instanceof Error ? err.message : String(err));
    }
  }

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

      {/* ------------------------------------------------------------------ */}
      {/* Agent peers (A2A)                                                   */}
      {/* ------------------------------------------------------------------ */}
      <section className="card" style={{ padding: 20, display: 'grid', gap: 20, maxWidth: 760, marginTop: 18 }}>
        <div>
          <p className="eyebrow">Agent peers (A2A)</p>
          <h2 style={{ margin: 0, fontSize: 18 }}>Agent-to-Agent interconnect</h2>
          <p style={{ margin: '6px 0 0', color: 'var(--ink-mute)', fontSize: 13 }}>
            Discover and message other A2A-speaking desks. Uses the A2A 0.2.0 standard (agent card + JSON-RPC task protocol).
          </p>
        </div>

        {/* This desk's card */}
        <div style={{ display: 'grid', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>This desk&apos;s card</h3>
          <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 13 }}>
            Other desks discover you at <code>/.well-known/agent-card.json</code>.
          </p>
          {myCardError && (
            <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 13 }}>Error loading card: {myCardError}</p>
          )}
          {myCard && (
            <div
              style={{
                padding: '10px 12px',
                border: '1px solid var(--line)',
                borderRadius: 8,
                display: 'grid',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{myCard.name}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>A2A {myCard.protocolVersion}</span>
              </div>
              {myCard.skills.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                  {myCard.skills.map((sk) => (
                    <span
                      key={sk.id}
                      title={sk.id}
                      style={{
                        fontSize: 11,
                        padding: '2px 7px',
                        borderRadius: 99,
                        background: 'var(--bg-subtle, rgba(128,128,128,0.12))',
                        color: 'var(--ink-mute)',
                      }}
                    >
                      {sk.name}
                    </span>
                  ))}
                </div>
              )}
              {myCard.skills.length === 0 && (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-mute)' }}>No skills/employees registered.</p>
              )}
            </div>
          )}
          {!myCard && !myCardError && (
            <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 13 }}>Loading…</p>
          )}
        </div>

        {/* Ping a peer */}
        <div style={{ display: 'grid', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Ping a peer</h3>
          <input
            className="input"
            value={peerUrl}
            onChange={(event) => { setPeerUrl(event.target.value); setPeerCard(null); setPeerCardStatus(null); }}
            placeholder="http://host:port"
            autoComplete="off"
          />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={discoverPeer}>Discover</button>
          </div>
          {peerCardStatus && <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 13 }}>{peerCardStatus}</p>}
          {peerCard && peerCard.skills.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {peerCard.skills.map((sk) => (
                <span
                  key={sk.id}
                  title={sk.id}
                  style={{
                    fontSize: 11,
                    padding: '2px 7px',
                    borderRadius: 99,
                    background: 'var(--bg-subtle, rgba(128,128,128,0.12))',
                    color: 'var(--ink-mute)',
                  }}
                >
                  {sk.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Send test message */}
        <div style={{ display: 'grid', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Send test message</h3>
          <input
            className="input"
            value={pingMsg}
            onChange={(event) => setPingMsg(event.target.value)}
            placeholder="Hello from this desk!"
            autoComplete="off"
          />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" onClick={sendPingMessage}>Send test message</button>
          </div>
          {pingStatus && <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 13 }}>{pingStatus}</p>}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 插件 / Plugins (MCP plugin manager)                                 */}
      {/* ------------------------------------------------------------------ */}
      <section className="card" style={{ padding: 20, display: 'grid', gap: 20, maxWidth: 760, marginTop: 18 }}>
        <div>
          <p className="eyebrow">插件 / Plugins</p>
          <h2 style={{ margin: 0, fontSize: 18 }}>MCP 插件管理</h2>
          <p style={{ margin: '6px 0 0', color: 'var(--ink-mute)', fontSize: 13 }}>
            仅精选白名单插件（curated）。插件是 MCP server = 会在桌面执行代码，只装可信来源。
          </p>
        </div>

        {pluginsError && (
          <p style={{ margin: 0, color: 'var(--color-warning, #d97706)', fontSize: 13 }}>
            加载失败: {pluginsError}
          </p>
        )}

        {!pluginsData && !pluginsError && (
          <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 13 }}>加载中…</p>
        )}

        {pluginsData && pluginsData.registry.map((manifest) => {
          const installedEntry = pluginsData.installed.find((p) => p.id === manifest.id);
          const isInstalled = installedEntry !== undefined;
          const isEnabled = installedEntry?.enabled ?? false;
          const actionStatus = pluginActionStatus[manifest.id];
          const configInputs = pluginConfigInputs[manifest.id] ?? {};
          const hasWriteCap = manifest.capabilities.some((c) => c.risk === 'write');

          // State label
          const stateLabel = !isInstalled
            ? '未安装'
            : isEnabled
              ? '已安装 · 已启用'
              : '已安装 · 已停用';

          return (
            <div
              key={manifest.id}
              style={{
                padding: '14px 16px',
                border: '1px solid var(--line)',
                borderRadius: 10,
                display: 'grid',
                gap: 10,
              }}
            >
              {/* Header row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ display: 'grid', gap: 3, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{manifest.name}</span>
                    {manifest.bundled && (
                      <span style={{
                        fontSize: 11, padding: '1px 6px', borderRadius: 99,
                        background: 'var(--bg-subtle, rgba(128,128,128,0.12))',
                        color: 'var(--ink-mute)',
                      }}>
                        bundled
                      </span>
                    )}
                    {hasWriteCap && (
                      <span style={{
                        fontSize: 11, padding: '1px 7px', borderRadius: 99,
                        background: 'rgba(217, 119, 6, 0.15)',
                        color: '#d97706',
                        fontWeight: 600,
                      }}>
                        ⚠ write
                      </span>
                    )}
                  </div>
                  <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 13 }}>{manifest.description}</p>
                </div>
                <span style={{
                  fontSize: 12,
                  color: isInstalled ? (isEnabled ? 'var(--color-success, #16a34a)' : 'var(--ink-mute)') : 'var(--ink-mute)',
                  whiteSpace: 'nowrap',
                  paddingTop: 2,
                }}>
                  {stateLabel}
                </span>
              </div>

              {/* Capabilities */}
              {manifest.capabilities.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {manifest.capabilities.map((cap) => (
                    <span
                      key={cap.id}
                      title={cap.description}
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 99,
                        border: '1px solid var(--line)',
                        color: cap.risk === 'write' ? '#d97706' : 'var(--ink-mute)',
                        background: cap.risk === 'write'
                          ? 'rgba(217, 119, 6, 0.08)'
                          : 'var(--bg-subtle, rgba(128,128,128,0.07))',
                      }}
                    >
                      {cap.risk === 'write' ? '✏ ' : '👁 '}{cap.label}
                    </span>
                  ))}
                </div>
              )}

              {/* Config inputs for needsConfig fields (show when not yet installed) */}
              {!isInstalled && manifest.needsConfig.length > 0 && (
                <div style={{ display: 'grid', gap: 8 }}>
                  {manifest.needsConfig.map((field) => (
                    <div key={field.key} style={{ display: 'grid', gap: 4 }}>
                      <label style={{ fontSize: 12, color: 'var(--ink-mute)', fontWeight: 500 }}>
                        {field.label}{field.required && ' *'}
                      </label>
                      {field.description && (
                        <p style={{ margin: 0, fontSize: 11, color: 'var(--ink-mute)' }}>{field.description}</p>
                      )}
                      <input
                        className="input"
                        type={field.secret ? 'password' : 'text'}
                        value={configInputs[field.key] ?? ''}
                        onChange={(e) => {
                          setPluginConfigInputs((prev) => ({
                            ...prev,
                            [manifest.id]: { ...(prev[manifest.id] ?? {}), [field.key]: e.target.value },
                          }));
                        }}
                        placeholder={field.label}
                        autoComplete="off"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                {!isInstalled && (
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => installPlugin(manifest)}
                  >
                    安装
                  </button>
                )}
                {isInstalled && (
                  <>
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => togglePlugin(manifest.id, !isEnabled)}
                    >
                      {isEnabled ? '停用' : '启用'}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => uninstallPlugin(manifest.id)}
                    >
                      卸载
                    </button>
                  </>
                )}
                {actionStatus && (
                  <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{actionStatus}</span>
                )}
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}
