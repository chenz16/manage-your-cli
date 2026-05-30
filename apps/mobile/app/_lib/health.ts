/**
 * health.ts — mobile-side hook for the desk's /api/v1/health endpoint.
 *
 * Polls every 30s when a connection exists, aggregates entries into a single
 * status (green / yellow / red / gray), and exposes a per-entry breakdown
 * so the header dot can pop a list of which agents are unhealthy.
 */

'use client';

import { useEffect, useState } from 'react';
import { holonApiFetch, readDesktopConnection } from './mobile-runtime';

export type HealthLevel = 'green' | 'yellow' | 'red' | 'gray';

export interface HealthEntry {
  key: string;
  kind: string;
  pid: number;
  status: string;
  pidAlive: boolean;
  meta?: Record<string, unknown>;
  parentKey?: string;
}

export interface HealthSnapshot {
  level: HealthLevel;
  reason: string;
  entries: HealthEntry[];
  ts: string | null;
  counts: Record<string, number>;
}

const EMPTY: HealthSnapshot = { level: 'gray', reason: '未连接 desk', entries: [], ts: null, counts: {} };

function deriveLevel(entries: HealthEntry[]): { level: HealthLevel; reason: string } {
  if (entries.length === 0) return { level: 'gray', reason: '空 registry' };
  const dead = entries.filter((e) => e.status === 'dead' || !e.pidAlive);
  if (dead.length > 0) {
    return { level: 'red', reason: `${dead.length} 个 agent 挂了` };
  }
  const stuck = entries.filter((e) => e.status === 'stuck');
  if (stuck.length > 0) return { level: 'yellow', reason: `${stuck.length} 个 agent 卡了` };
  return { level: 'green', reason: '全部健康' };
}

export function useHealth(intervalMs = 30_000): HealthSnapshot {
  const [snap, setSnap] = useState<HealthSnapshot>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const connection = readDesktopConnection();
      if (!connection) {
        if (!cancelled) setSnap(EMPTY);
        return;
      }
      try {
        const res = await holonApiFetch('/api/v1/health');
        if (!res.ok) {
          if (!cancelled) setSnap({ ...EMPTY, level: 'red', reason: `desk ${res.status}` });
          return;
        }
        const json = await res.json() as {
          desk?: string; ts?: string;
          counts?: Record<string, number>;
          processes?: HealthEntry[];
        };
        const entries = json.processes ?? [];
        const { level, reason } = deriveLevel(entries);
        if (!cancelled) {
          setSnap({ level, reason, entries, ts: json.ts ?? null, counts: json.counts ?? {} });
        }
      } catch {
        if (!cancelled) setSnap({ ...EMPTY, level: 'red', reason: 'health fetch 失败' });
      }
    };
    void tick();
    const id = setInterval(tick, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [intervalMs]);

  return snap;
}
