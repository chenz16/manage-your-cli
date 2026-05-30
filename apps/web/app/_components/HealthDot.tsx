/**
 * HealthDot — desk top-bar status indicator. Polls /api/v1/health every 30s
 * and renders a 10px green/yellow/red/gray dot. Click pops a sheet listing
 * unhealthy agents (dead/stuck) so the owner can triage from the chat page
 * without opening DevTools.
 *
 * Visually mirrors the mobile HealthDot (lives in apps/mobile/_components/
 * WeizoApp.tsx); same color logic, different surface frame (mobile sheet
 * slides up from bottom; desk popover anchors below the dot).
 */

'use client';

import { useEffect, useState } from 'react';

type HealthLevel = 'green' | 'yellow' | 'red' | 'gray';

interface HealthEntry {
  key: string;
  kind: string;
  pid: number;
  status: string;
  pidAlive: boolean;
  meta?: Record<string, unknown>;
}

interface HealthSnapshot {
  level: HealthLevel;
  reason: string;
  entries: HealthEntry[];
  ts: string | null;
}

const EMPTY: HealthSnapshot = { level: 'gray', reason: 'Empty registry', entries: [], ts: null };

function deriveLevel(entries: HealthEntry[]): { level: HealthLevel; reason: string } {
  if (entries.length === 0) return { level: 'gray', reason: 'Empty registry' };
  const dead = entries.filter((e) => e.status === 'dead' || !e.pidAlive);
  if (dead.length > 0) return { level: 'red', reason: `${dead.length} agent${dead.length > 1 ? 's' : ''} dead` };
  const stuck = entries.filter((e) => e.status === 'stuck');
  if (stuck.length > 0) return { level: 'yellow', reason: `${stuck.length} agent${stuck.length > 1 ? 's' : ''} stuck` };
  return { level: 'green', reason: 'All healthy' };
}

export function HealthDot() {
  const [snap, setSnap] = useState<HealthSnapshot>(EMPTY);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/v1/health');
        if (!res.ok) {
          if (!cancelled) setSnap({ ...EMPTY, level: 'red', reason: `desk ${res.status}` });
          return;
        }
        const json = await res.json() as { ts?: string; processes?: HealthEntry[] };
        const entries = json.processes ?? [];
        const { level, reason } = deriveLevel(entries);
        if (!cancelled) setSnap({ level, reason, entries, ts: json.ts ?? null });
      } catch {
        if (!cancelled) setSnap({ ...EMPTY, level: 'red', reason: 'health fetch failed' });
      }
    };
    void tick();
    const id = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const unhealthy = snap.entries.filter((e) => e.status === 'dead' || e.status === 'stuck' || !e.pidAlive);

  return (
    <div className="desk-health-wrap">
      <button
        type="button"
        className={`desk-health-dot is-${snap.level}`}
        aria-label={`System status: ${snap.reason}`}
        title={snap.reason}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <>
          <div className="desk-health-popover-backdrop" onClick={() => setOpen(false)} />
          <div className="desk-health-popover" role="dialog" aria-label="System status">
            <div className="desk-health-popover-title">System · {snap.reason}</div>
          {/* (title uses derived reason from deriveLevel, kept English) */}
            {snap.entries.length === 0 ? (
              <div className="desk-health-popover-empty">No tracked processes.</div>
            ) : unhealthy.length === 0 ? (
              <div className="desk-health-popover-empty">
                {snap.entries.length} agent{snap.entries.length > 1 ? 's' : ''} healthy.
              </div>
            ) : (
              <ul className="desk-health-popover-list">
                {unhealthy.map((e) => {
                  const meta = (e.meta ?? {}) as Record<string, string>;
                  const label = meta.staffName || meta.session || e.key;
                  const status = !e.pidAlive ? 'dead' : e.status;
                  return (
                    <li key={e.key} className={`desk-health-popover-item is-${status}`}>
                      <span className="desk-health-popover-name">{label}</span>
                      <span className="desk-health-popover-kind">{e.kind} · {status}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {snap.ts && <div className="desk-health-popover-foot">{snap.ts}</div>}
          </div>
        </>
      )}
    </div>
  );
}
