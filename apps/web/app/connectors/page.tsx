'use client';

import { useState } from 'react';

type Binary = 'claude' | 'codex';
type Lifecycle = 'short' | 'long';

export default function ConnectorsPage() {
  const [role, setRole] = useState('Research employee');
  const [binary, setBinary] = useState<Binary>('claude');
  const [lifecycle, setLifecycle] = useState<Lifecycle>('short');
  const [status, setStatus] = useState<string | null>(null);

  async function createCliAgent() {
    setStatus('Creating...');
    const res = await fetch('/api/v1/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: role,
        role_label: role,
        role_name: role.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '') || 'cli_agent',
        substrate: {
          kind: 'cli_agent',
          binary,
          args_template:
            binary === 'claude'
              ? '--dangerously-skip-permissions'
              : '--dangerously-bypass-approvals-and-sandbox',
          approval_rules: [],
          lifecycle,
          auto_launch: true,
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      setStatus(`Create failed: ${text || res.status}`);
      return;
    }
    const staff = (await res.json()) as { id: string; name: string };
    setStatus(`Created ${staff.name}. Open the roster to launch or attach the CLI session.`);
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Connectors</p>
          <h1 className="page-title">CLI Agents</h1>
          <p className="page-subtitle">Create Claude Code or Codex employees for the live roster.</p>
        </div>
      </header>

      <section className="card" style={{ padding: 20, display: 'grid', gap: 14, maxWidth: 680 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Role</span>
          <input className="input" value={role} onChange={(e) => setRole(e.target.value)} />
        </label>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {(['claude', 'codex'] as const).map((value) => (
            <button key={value} type="button" className={binary === value ? 'btn primary' : 'btn'} onClick={() => setBinary(value)}>
              {value}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {(['short', 'long'] as const).map((value) => (
            <button key={value} type="button" className={lifecycle === value ? 'btn primary' : 'btn'} onClick={() => setLifecycle(value)}>
              {value === 'short' ? 'Short-term' : 'Long-term'}
            </button>
          ))}
        </div>

        <button type="button" className="btn primary" onClick={createCliAgent} disabled={!role.trim()}>
          Create CLI Agent
        </button>
        {status && <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 13 }}>{status}</p>}
      </section>
    </main>
  );
}
