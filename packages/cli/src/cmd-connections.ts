/**
 * myc connections — paired devices, A2A peers, MCP plugins, WeChat status.
 *
 * Core readers used:
 *   - listA2APeers()       A2A peer registry (a2a-peer-store)
 *   - listInstalled()      installed MCP plugins (plugin-store)
 *   WeChat channel status: reads ~/.claude/channels/wechat/account.json
 *                          directly (same approach as the web route) because
 *                          the channel-creds blob is encrypted and only the
 *                          web layer holds the auth key — no core reader
 *                          exists for the decrypted status. NOTE: this is
 *                          the one data source not backed by a core function.
 *
 * Device pairing: the pairing store (apps/web/lib/device-pairing-store.ts)
 *   is NOT exported from @holon/core — it lives in the Next.js app layer.
 *   This command reports "not available (pairing store in web layer)" for
 *   paired devices rather than reaching into apps/.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  listA2APeers,
  listInstalled,
  type A2APeerRecord,
  type InstalledMcpPlugin,
} from '@holon/core';

/* ── WeChat status (file-based, same as web route) ─────────────────── */

interface WechatAccountJson {
  accountId?: string;
  baseUrl?: string;
  savedAt?: string;
}

interface WechatStatus {
  connected: boolean;
  accountId?: string | undefined;
  baseUrl?: string | undefined;
  savedAt?: string | undefined;
}

function readWechatStatus(): WechatStatus {
  const filePath = join(homedir(), '.claude', 'channels', 'wechat', 'account.json');
  try {
    const raw = readFileSync(filePath, { encoding: 'utf-8' });
    const account = JSON.parse(raw) as WechatAccountJson;
    if (!account.accountId) return { connected: false };
    return {
      connected: true,
      accountId: account.accountId,
      baseUrl: account.baseUrl ?? undefined,
      savedAt: account.savedAt ?? undefined,
    };
  } catch {
    return { connected: false };
  }
}

/* ── Types ─────────────────────────────────────────────────────────── */

interface ConnectionsResult {
  timestamp: string;
  a2a_peers: A2APeerRecord[];
  mcp_plugins: InstalledMcpPlugin[];
  wechat: WechatStatus;
  note_paired_devices: string;
}

/* ── Command ───────────────────────────────────────────────────────── */

export async function runConnections({ json }: { json: boolean }): Promise<void> {
  let peers: A2APeerRecord[] = [];
  try {
    peers = listA2APeers();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[connections] A2A peers unavailable: ${msg}`);
  }

  let plugins: InstalledMcpPlugin[] = [];
  try {
    plugins = listInstalled();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[connections] MCP plugins unavailable: ${msg}`);
  }

  let wechat: WechatStatus = { connected: false };
  try {
    wechat = readWechatStatus();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[connections] WeChat status unavailable: ${msg}`);
  }

  const result: ConnectionsResult = {
    timestamp: new Date().toISOString(),
    a2a_peers: peers,
    mcp_plugins: plugins,
    wechat,
    note_paired_devices:
      'Paired mobile devices are managed by apps/web/lib/device-pairing-store.ts (web layer) — not available headless.',
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  /* ── Human-readable output ─────────────────────────────────────── */
  const ts = new Date(result.timestamp).toLocaleString();
  console.log(`\n== Connections  (${ts}) ==\n`);

  console.log(`A2A Peers  (${peers.length})`);
  if (peers.length === 0) {
    console.log('  (none)');
  } else {
    for (const p of peers) {
      const lastSeen = p.last_seen_at
        ? new Date(p.last_seen_at).toLocaleString()
        : 'never';
      const cardName =
        typeof p.card?.name === 'string' ? p.card.name : p.id;
      console.log(`  ${cardName}`);
      console.log(`    url        : ${p.id}`);
      console.log(`    connected  : ${p.connected_at}`);
      console.log(`    last seen  : ${lastSeen}`);
    }
  }

  console.log(`\nMCP Plugins  (${plugins.length})`);
  if (plugins.length === 0) {
    console.log('  (none installed)');
  } else {
    const w = Math.max(...plugins.map((p) => p.label.length), 5);
    console.log(`  ${'LABEL'.padEnd(w)}  ID                    ENABLED`);
    for (const p of plugins) {
      console.log(`  ${p.label.padEnd(w)}  ${p.id.padEnd(22)}  ${p.enabled ? 'yes' : 'no'}`);
    }
  }

  console.log('\nWeChat Channel');
  if (wechat.connected) {
    console.log(`  connected  : yes`);
    console.log(`  account    : ${wechat.accountId ?? '-'}`);
    if (wechat.baseUrl) console.log(`  base url   : ${wechat.baseUrl}`);
    if (wechat.savedAt) console.log(`  saved at   : ${wechat.savedAt}`);
  } else {
    console.log('  connected  : no');
  }

  console.log('\nPaired Mobile Devices');
  console.log('  (not available headless — pairing store is in the web layer)');
  console.log('');
}
