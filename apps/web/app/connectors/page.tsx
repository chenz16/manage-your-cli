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
  setupSteps?: string[];
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
  const [myCardSkillsExpanded, setMyCardSkillsExpanded] = useState(false);
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
  // per-plugin: config inputs (keyed by plugin id), action status, setup steps open/closed
  const [pluginConfigInputs, setPluginConfigInputs] = useState<Record<string, Record<string, string>>>({});
  const [pluginActionStatus, setPluginActionStatus] = useState<Record<string, string>>({});
  const [pluginSetupOpen, setPluginSetupOpen] = useState<Record<string, boolean>>({});

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
    <main className="page conn-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Connectors</h1>
          <p className="page-subtitle">Optional services your Secretary and employees can use — each category is described below. CLI agents are created from chat or the Team page, not here.</p>
        </div>
      </header>

      {/* ── 通知 group: Voice ─────────────────────────────────────────── */}
      <section className="card conn-card">
        <div className="conn-card-head">
          <p className="conn-eyebrow">Voice</p>
          <h2 className="conn-card-title">Speech in &amp; out</h2>
          <p className="conn-card-hint">
            Voice is off unless you choose an engine. OpenAI keys here are voice-only keys stored with owner config, not chat or runtime tokens.
          </p>
        </div>

        <div className="conn-field">
          <span className="conn-field-label">Speech-to-Text</span>
          <select className="conn-input" value={sttEngine} onChange={(event) => {
            const next = event.target.value as SttEngine;
            setSttEngine(next);
            if (next !== 'off' && next !== 'openai') setSttUrl(STT_DEFAULT_URL[next]);
          }}>
            {(['off', 'whisper_cpp', 'sensevoice', 'faster_whisper', 'openai'] as const).map((engine) => (
              <option key={engine} value={engine}>{sttLabel(engine)}</option>
            ))}
          </select>
          {sttEngine !== 'off' && sttEngine !== 'openai' && (
            <input className="conn-input" value={sttUrl} onChange={(event) => setSttUrl(event.target.value)} placeholder="http://127.0.0.1:8080" />
          )}
          {sttEngine === 'openai' && (
            <input className="conn-input" type="password" value={sttKey} onChange={(event) => setSttKey(event.target.value)} placeholder="OpenAI voice API key" autoComplete="off" />
          )}
          <div className="conn-actions">
            <button type="button" className="btn btn-primary" onClick={() => saveVoiceConfig('stt')}>Save STT</button>
            <button type="button" className="btn btn-secondary" onClick={checkSttHealth}>Health check</button>
            {sttStatus && <span className="conn-status">{sttStatus}</span>}
          </div>
        </div>

        <div className="conn-field">
          <span className="conn-field-label">Text-to-Speech</span>
          <select className="conn-input" value={ttsEngine} onChange={(event) => {
            const next = event.target.value as TtsEngine;
            setTtsEngine(next);
            if (next === 'cosyvoice') setTtsUrl(TTS_DEFAULT_URL.cosyvoice);
          }}>
            {(['off', 'cosyvoice', 'openai'] as const).map((engine) => (
              <option key={engine} value={engine}>{ttsLabel(engine)}</option>
            ))}
          </select>
          {ttsEngine === 'cosyvoice' && (
            <input className="conn-input" value={ttsUrl} onChange={(event) => setTtsUrl(event.target.value)} placeholder="http://127.0.0.1:8770" />
          )}
          {ttsEngine === 'openai' && (
            <input className="conn-input" type="password" value={ttsKey} onChange={(event) => setTtsKey(event.target.value)} placeholder="OpenAI voice API key" autoComplete="off" />
          )}
          <div className="conn-actions">
            <button type="button" className="btn btn-primary" onClick={() => saveVoiceConfig('tts')}>Save TTS</button>
            <button type="button" className="btn btn-secondary" onClick={checkTtsHealth}>Health check</button>
            {ttsStatus && <span className="conn-status">{ttsStatus}</span>}
          </div>
        </div>
      </section>

      {/* ── 通知 group: Messaging & Social ────────────────────────────── */}
      <section className="card conn-card">
        <div className="conn-card-head">
          <p className="conn-eyebrow">Messaging &amp; Social</p>
          <h2 className="conn-card-title">Notification channels</h2>
          <p className="conn-card-hint">
            Webhook/token-based channels let the desk push notifications. Tokens are owner-scoped, like voice keys.
          </p>
        </div>

        {/* Slack */}
        <div className="conn-field">
          <span className="conn-field-label">Slack</span>
          <input
            className="conn-input"
            value={slackUrl}
            onChange={(event) => setSlackUrl(event.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            autoComplete="off"
          />
          <div className="conn-actions">
            <button type="button" className="btn btn-primary" onClick={() => saveMessagingConfig('slack')}>Save</button>
            <button type="button" className="btn btn-secondary" onClick={() => sendMessagingTestMsg('slack')}>Send test</button>
            {slackStatus && <span className="conn-status">{slackStatus}</span>}
          </div>
        </div>

        {/* Discord */}
        <div className="conn-field">
          <span className="conn-field-label">Discord</span>
          <input
            className="conn-input"
            value={discordUrl}
            onChange={(event) => setDiscordUrl(event.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
            autoComplete="off"
          />
          <div className="conn-actions">
            <button type="button" className="btn btn-primary" onClick={() => saveMessagingConfig('discord')}>Save</button>
            <button type="button" className="btn btn-secondary" onClick={() => sendMessagingTestMsg('discord')}>Send test</button>
            {discordStatus && <span className="conn-status">{discordStatus}</span>}
          </div>
        </div>

        {/* Telegram */}
        <div className="conn-field">
          <span className="conn-field-label">Telegram</span>
          <input
            className="conn-input"
            value={telegramToken}
            onChange={(event) => setTelegramToken(event.target.value)}
            placeholder="Bot token (from @BotFather)"
            autoComplete="off"
          />
          <input
            className="conn-input"
            value={telegramChatId}
            onChange={(event) => setTelegramChatId(event.target.value)}
            placeholder="Chat ID (numeric)"
            autoComplete="off"
          />
          <div className="conn-actions">
            <button type="button" className="btn btn-primary" onClick={() => saveMessagingConfig('telegram')}>Save</button>
            <button type="button" className="btn btn-secondary" onClick={() => sendMessagingTestMsg('telegram')}>Send test</button>
            {telegramStatus && <span className="conn-status">{telegramStatus}</span>}
          </div>
        </div>

        {/* Coming channels (OAuth-required) */}
        <div className="conn-field">
          <span className="conn-field-label" style={{ color: 'var(--ink-mute)' }}>Coming soon (OAuth required)</span>
          {(['Google Meet'] as const).map((name) => (
            <div key={name} className="conn-soon">
              <span className="conn-soon-name">{name}</span>
              <span className="conn-soon-tag">Coming</span>
            </div>
          ))}
          <p className="conn-field-hint">Gmail is now available as an MCP plugin in the Plugins section below.</p>
        </div>
      </section>

      {/* ── 通知 group: Agent peers (A2A) ─────────────────────────────── */}
      <section className="card conn-card">
        <div className="conn-card-head">
          <p className="conn-eyebrow">Agent peers (A2A)</p>
          <h2 className="conn-card-title">Agent-to-Agent interconnect</h2>
          <p className="conn-card-hint">
            Discover and message other A2A-speaking desks. Uses the A2A 0.2.0 standard (agent card + JSON-RPC task protocol).
          </p>
        </div>

        {/* This desk's card */}
        <div className="conn-field">
          <span className="conn-field-label">This desk&apos;s card</span>
          <p className="conn-field-hint">
            This is your desk&apos;s outward &ldquo;business card&rdquo; — other people&apos;s agents read{' '}
            <code>/.well-known/agent-card.json</code> to discover what your Secretary can do.
            Only relevant if you federate with other agents; safe to ignore otherwise.
          </p>
          {myCardError && (
            <p className="conn-status">Error loading card: {myCardError}</p>
          )}
          {myCard && (
            <div className="conn-panel">
              <div className="conn-panel-row">
                <span className="conn-panel-name">{myCard.name}</span>
                <span className="conn-panel-meta">A2A {myCard.protocolVersion}</span>
              </div>
              {myCard.skills.length > 0 && (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: '3px 10px', marginTop: 8, alignSelf: 'flex-start' }}
                    onClick={() => setMyCardSkillsExpanded((prev) => !prev)}
                    aria-expanded={myCardSkillsExpanded}
                  >
                    {myCardSkillsExpanded
                      ? `隐藏能力列表 ▴`
                      : `查看全部 ${myCard.skills.length} 项能力 ▾`}
                  </button>
                  {myCardSkillsExpanded && (
                    <div className="conn-chips" style={{ marginTop: 8 }}>
                      {myCard.skills.map((sk) => (
                        <span key={sk.id} title={sk.id} className="conn-chip">{sk.name}</span>
                      ))}
                    </div>
                  )}
                </>
              )}
              {myCard.skills.length === 0 && (
                <p className="conn-panel-empty">No skills/employees registered.</p>
              )}
            </div>
          )}
          {!myCard && !myCardError && (
            <p className="conn-status">Loading…</p>
          )}
        </div>

        {/* Ping a peer */}
        <div className="conn-field">
          <span className="conn-field-label">Ping a peer</span>
          <input
            className="conn-input"
            value={peerUrl}
            onChange={(event) => { setPeerUrl(event.target.value); setPeerCard(null); setPeerCardStatus(null); }}
            placeholder="http://host:port"
            autoComplete="off"
          />
          <div className="conn-actions">
            <button type="button" className="btn btn-secondary" onClick={discoverPeer}>Discover</button>
            {peerCardStatus && <span className="conn-status">{peerCardStatus}</span>}
          </div>
          {peerCard && peerCard.skills.length > 0 && (
            <div className="conn-chips">
              {peerCard.skills.map((sk) => (
                <span key={sk.id} title={sk.id} className="conn-chip">{sk.name}</span>
              ))}
            </div>
          )}
        </div>

        {/* Send test message */}
        <div className="conn-field">
          <span className="conn-field-label">Send test message</span>
          <input
            className="conn-input"
            value={pingMsg}
            onChange={(event) => setPingMsg(event.target.value)}
            placeholder="Hello from this desk!"
            autoComplete="off"
          />
          <div className="conn-actions">
            <button type="button" className="btn btn-primary" onClick={sendPingMessage}>Send test message</button>
            {pingStatus && <span className="conn-status">{pingStatus}</span>}
          </div>
        </div>
      </section>

      {/* ── 插件 group: Plugins (MCP plugin manager) ──────────────────── */}
      <section className="card conn-card">
        <div className="conn-card-head">
          <p className="conn-eyebrow">插件 · Plugins</p>
          <h2 className="conn-card-title">MCP 插件管理</h2>
          <p className="conn-card-hint">
            扩展桌面能力的精选插件（curated 白名单）。每个插件是一个 MCP server，启用后会在你的桌面运行。
          </p>
        </div>

        <div className="conn-note">
          <span className="conn-note-icon" aria-hidden>●</span>
          <span>插件会在桌面执行代码，仅安装来自可信来源的精选插件。标记 <strong>写入 / write</strong> 的能力可以修改数据，请按需启用。</span>
        </div>

        {pluginsError && (
          <p className="conn-error">加载失败: {pluginsError}</p>
        )}

        {!pluginsData && !pluginsError && (
          <p className="conn-loading">加载中…</p>
        )}

        {pluginsData && pluginsData.registry.map((manifest) => {
          const installedEntry = pluginsData.installed.find((p) => p.id === manifest.id);
          const isInstalled = installedEntry !== undefined;
          const isEnabled = installedEntry?.enabled ?? false;
          const actionStatus = pluginActionStatus[manifest.id];
          const configInputs = pluginConfigInputs[manifest.id] ?? {};

          // State label + class
          const stateLabel = !isInstalled
            ? '未安装'
            : isEnabled
              ? '已启用'
              : '已停用';
          const stateClass = !isInstalled
            ? ''
            : isEnabled
              ? ' is-enabled'
              : ' is-disabled';

          return (
            <div key={manifest.id} className="conn-plugin">
              {/* Header row */}
              <div className="conn-plugin-head">
                <div className="conn-plugin-title-wrap">
                  <div className="conn-plugin-title-row">
                    <span className="conn-plugin-name">{manifest.name}</span>
                    {manifest.bundled && (
                      <span className="conn-tag">bundled</span>
                    )}
                  </div>
                  <p className="conn-plugin-desc">{manifest.description}</p>
                </div>
                <span className={`conn-plugin-state${stateClass}`}>{stateLabel}</span>
              </div>

              {/* Capabilities — neutral=read, amber=write */}
              {manifest.capabilities.length > 0 && (
                <div className="conn-chips">
                  {manifest.capabilities.map((cap) => (
                    <span
                      key={cap.id}
                      title={cap.description}
                      className={`conn-chip ${cap.risk === 'write' ? 'is-write' : 'is-read'}`}
                    >
                      {cap.risk === 'write' ? '写入' : '读取'} · {cap.label}
                    </span>
                  ))}
                </div>
              )}

              {/* Setup steps — shown for any plugin that declares them */}
              {manifest.setupSteps && manifest.setupSteps.length > 0 && (
                <div className="conn-plugin-config">
                  <button
                    type="button"
                    className="conn-field-label"
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6 }}
                    onClick={() => setPluginSetupOpen((prev) => ({ ...prev, [manifest.id]: !prev[manifest.id] }))}
                    aria-expanded={!!pluginSetupOpen[manifest.id]}
                  >
                    如何连接 / Setup
                    <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--ink-mute)' }}>
                      {pluginSetupOpen[manifest.id] ? '▴ 收起' : '▾ 展开'}
                    </span>
                  </button>
                  {pluginSetupOpen[manifest.id] && (
                    <ol style={{ margin: '4px 0 0 0', paddingLeft: 18, display: 'grid', gap: 6 }}>
                      {manifest.setupSteps.map((step, idx) => (
                        <li key={idx} style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink-soft)' }}>{step}</li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {/* Config inputs for needsConfig fields (show when not yet installed) */}
              {!isInstalled && manifest.needsConfig.length > 0 && (
                <div className="conn-plugin-config">
                  {manifest.needsConfig.map((field) => (
                    <div key={field.key} className="conn-field">
                      <label className="conn-field-label" style={{ fontSize: 13 }}>
                        {field.label}{field.required && ' *'}
                      </label>
                      {field.description && (
                        <p className="conn-field-hint">{field.description}</p>
                      )}
                      <input
                        className="conn-input"
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
              <div className="conn-actions">
                {!isInstalled && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => installPlugin(manifest)}
                  >
                    安装
                  </button>
                )}
                {isInstalled && (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => togglePlugin(manifest.id, !isEnabled)}
                    >
                      {isEnabled ? '停用' : '启用'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => uninstallPlugin(manifest.id)}
                    >
                      卸载
                    </button>
                  </>
                )}
                {actionStatus && (
                  <span className="conn-status">{actionStatus}</span>
                )}
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}
