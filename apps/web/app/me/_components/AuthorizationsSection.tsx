'use client';

import { useEffect, useState } from 'react';
import { isGmailLink, type IntegrationLink } from '@holon/api-contract';
import { useT } from '../../../lib/i18n/useT';
import type { Lang } from '../../../lib/i18n/I18nProvider';

/**
 * /me — owner-level external connections.
 *
 * 2026-05-22 owner feedback: /me must only summarize connections that
 * are already configured. Catalog browsing, intros, and setup controls
 * live on /connectors.
 *
 * iter-013 Pass #3 (ADR-024 step 3): Gmail Connect/Disconnect routes
 * through NextAuth v5 React (`signIn('google')` / `signOut()`). The
 * iter-011 IntegrationLink shape (gmailLink.config.email_address) is
 * still read as a fallback so the row stays correct during the
 * transitional window where a legacy install has an IntegrationLink
 * row but no NextAuth account yet. Pass #4 collapses to the NextAuth
 * session as the sole source (and drops the IntegrationLink 'gmail'
 * branch per Q-006).
 *
 * Non-Gmail kinds (Slack / Discord / etc.) used to be hand-added via
 * the legacy "+ Add other" form. They now live in the manifest as
 * `coming_soon` rows — actual wiring lands in iter-014+. The
 * `value`/`onChange` props are kept on the public signature so MeClient
 * does not need to change shape, even though the connector-redesign
 * does not currently mutate the IntegrationLink array directly.
 */

// TODO(V1.1): once iter-014 wires real per-connector auth flows,
// drop the legacy IntegrationLink array entirely and source
// connection status purely from a `/api/v1/connectors/status` BFF
// endpoint. The `value` / `onChange` props can then be removed.
// TODO(V1.1): replace URL-param banners with status returned by a
// connection-status endpoint.

// Legacy "non-Gmail" descriptor options (kept here as a comment for
// the V1.1 cleanup; not consumed by the compact /me surface).
// Will be deleted in V1.1 alongside the dual-source fallback:
//   slack · discord · email · webhook · mcp · feishu · google_meet

export function AuthorizationsSection({
  value,
  onChange: _onChange,
}: {
  value: IntegrationLink[];
  onChange: (next: IntegrationLink[]) => Promise<void>;
}) {
  const { t: tr, lang } = useT();

  // feat/remove-nextauth: Gmail status comes solely from the
  // IntegrationLink row (`integrations[]` on /me). NextAuth session
  // surface removed.
  const gmailLink = value.find(isGmailLink) ?? null;
  const gmailEmail = gmailLink?.config.email_address ?? null;
  const gmailConnected = Boolean(gmailLink);

  const configured = value
    .filter((link) => link.enabled !== false)
    .map((link) => ({
      key: link.kind,
      label: labelForConnection(link.kind, lang),
      detail: isGmailLink(link) ? link.config.email_address : link.label,
    }));

  if (gmailConnected && !configured.some((item) => item.key === 'gmail')) {
    configured.unshift({
      key: 'gmail',
      label: labelForConnection('gmail', lang),
      detail: gmailEmail ?? tr('me.connections.connected'),
    });
  }

  // URL-param banners from the OAuth callback (kept at the section
  // level so the Detail pane stays purely presentational).
  const [connectedToast, setConnectedToast] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const connected = url.searchParams.get('integration_connected');
    const errParam = url.searchParams.get('integration_error');
    if (connected) {
      setConnectedToast(
        lang === 'zh-CN'
          ? `${labelForConnection(connected, lang)}已连接。`
          : `${labelForConnection(connected, lang)} connected.`,
      );
      url.searchParams.delete('integration_connected');
      window.history.replaceState({}, '', url.toString());
      const t = window.setTimeout(() => setConnectedToast(null), 3000);
      return () => window.clearTimeout(t);
    }
    if (errParam) {
      setErrorBanner(errParam);
      url.searchParams.delete('integration_error');
      window.history.replaceState({}, '', url.toString());
    }
    return undefined;
  }, []);

  // Hide the entire section (heading included) when nothing is configured.
  // owner directive: "没配置的不列出 或者彻底不弄了"
  if (configured.length === 0) return <></>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 className="section-title" style={{ margin: 0 }}>{tr('me.section.authorizations')}</h2>
      </div>

      {connectedToast && (
        <div
          role="status"
          style={{
            padding: '8px 12px', borderRadius: 6, fontSize: 13,
            background: 'rgba(46,125,82,0.12)', color: 'var(--green)',
            border: '1px solid rgba(46,125,82,0.35)',
          }}
        >
          {connectedToast}
        </div>
      )}
      {errorBanner && (
        <div
          role="alert"
          style={{
            padding: '8px 12px', borderRadius: 6, fontSize: 13,
            background: 'rgba(192,57,43,0.10)', color: 'var(--red)',
            border: '1px solid rgba(192,57,43,0.35)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
          }}
        >
          <span>{lang === 'zh-CN' ? '连接错误' : 'Connection error'}: {errorBanner}</span>
          <button
            type="button"
            className="btn"
            onClick={() => setErrorBanner(null)}
            style={{ padding: '2px 8px', fontSize: 12 }}
          >
            {lang === 'zh-CN' ? '关闭' : 'Dismiss'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {configured.map((item) => (
          <div
            key={`${item.key}:${item.detail}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              border: '1px solid var(--line)',
              borderRadius: 8,
              background: 'var(--bg)',
            }}
          >
            <span aria-hidden style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              background: 'var(--green, #2e7d52)',
              flex: '0 0 8px',
            }} />
            <strong style={{ fontSize: 13, color: 'var(--ink)' }}>{item.label}</strong>
            <span style={{ fontSize: 12, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.detail}
            </span>
          </div>
        ))}
        <div>
          <a className="btn" href="/connectors" style={{ textDecoration: 'none', fontSize: 12 }}>
            {tr('me.connections.configure_more')}
          </a>
        </div>
      </div>
    </div>
  );
}

function labelForConnection(kind: string, lang: Lang): string {
  const zh: Record<string, string> = {
    gmail: '邮箱',
    slack: 'Slack',
    email: '邮箱',
    webhook: '网络回调',
    mcp: '工具协议',
    discord: 'Discord',
    feishu: '飞书',
    google_meet: 'Google Meet',
  };
  const en: Record<string, string> = {
    gmail: 'Gmail',
    slack: 'Slack',
    email: 'Email',
    webhook: 'Webhook',
    mcp: 'MCP',
    discord: 'Discord',
    feishu: 'Feishu',
    google_meet: 'Google Meet',
  };
  return (lang === 'zh-CN' ? zh : en)[kind] ?? kind;
}
