/**
 * A2A peer registry — service layer for the list of known A2A peer desks/agents.
 *
 * Mirrors the plugin-store pattern: thin service over owner-state-persistence.
 * Upsert semantics: connecting a known URL refreshes the card rather than
 * duplicating it. The stable peer id is the normalized base URL.
 *
 * Used by:
 *   - POST /api/v1/a2a/connect   (server-side connect, e.g. from mobile scan)
 *   - GET  /api/v1/a2a/peers     (future: list peers for mobile/UI consumption)
 *   - /connectors page           (can read listA2APeers() to render persistent peers)
 */

import {
  readA2APeers,
  writeA2APeers,
  type A2APeerRecord,
} from './owner-state-persistence.js';

export type { A2APeerRecord };

/** Normalized base URL (no trailing slash, no /.well-known suffix). */
export function normalizeA2ABaseUrl(raw: string): string {
  return raw.trim().replace(/\/$/, '').replace(/\/\.well-known\/agent-card(\.json)?$/, '');
}

/** Return all persisted A2A peers. */
export function listA2APeers(): A2APeerRecord[] {
  return readA2APeers();
}

/** Return a single peer by its normalized base URL, or null if unknown. */
export function getA2APeer(baseUrl: string): A2APeerRecord | null {
  const id = normalizeA2ABaseUrl(baseUrl);
  return readA2APeers().find((p) => p.id === id) ?? null;
}

/**
 * Upsert a peer: write or overwrite the entry for this base URL with the
 * provided agent-card payload. Returns the final stored record.
 *
 * Idempotent: a second call with the same URL updates `last_seen_at` and the
 * card snapshot; `connected_at` is preserved from the original entry.
 */
export function upsertA2APeer(
  baseUrl: string,
  card: Record<string, unknown>,
): A2APeerRecord {
  const id = normalizeA2ABaseUrl(baseUrl);
  const now = new Date().toISOString();
  const peers = readA2APeers();
  const existing = peers.find((p) => p.id === id);

  const updated: A2APeerRecord = {
    id,
    card,
    connected_at: existing?.connected_at ?? now,
    last_seen_at: now,
  };

  const next = existing
    ? peers.map((p) => (p.id === id ? updated : p))
    : [...peers, updated];

  writeA2APeers(next);

  console.log(JSON.stringify({
    audit: 'a2a_peer.upsert',
    peer_id: id,
    card_name: typeof card.name === 'string' ? card.name : null,
    is_update: Boolean(existing),
    ts: now,
  }));

  return updated;
}

/** Remove a peer from the registry. Returns true if the peer existed. */
export function removeA2APeer(baseUrl: string): boolean {
  const id = normalizeA2ABaseUrl(baseUrl);
  const peers = readA2APeers();
  const next = peers.filter((p) => p.id !== id);
  if (next.length === peers.length) return false;
  writeA2APeers(next);
  console.log(JSON.stringify({
    audit: 'a2a_peer.removed',
    peer_id: id,
    ts: new Date().toISOString(),
  }));
  return true;
}
