/**
 * Server-side helper: fetch + minimally validate an A2A agent card from a
 * remote desk/agent.
 *
 * Shared between:
 *   - POST /api/v1/a2a/connect  (mobile scan → server-side connect)
 *   - Any future server route that needs to validate a remote card
 *
 * The client-side connectors page does its own inline fetch (browser can
 * reach the peer directly); this module is for server-to-server fetches
 * that originate inside the desk's Next.js process.
 *
 * Validation is intentionally minimal — we check that the response is a
 * JSON object carrying at least `name` (string) and `protocolVersion`
 * (string). Full A2A 0.2.0 spec validation is left to the caller if needed.
 */

import { normalizeA2ABaseUrl } from '@holon/core';

export interface FetchedAgentCard {
  /** The normalized agent-card JSON (whatever the remote desk returned). */
  card: Record<string, unknown>;
  /** Normalized base URL (used as the peer's stable id). */
  baseUrl: string;
}

export type FetchAgentCardResult =
  | { ok: true; data: FetchedAgentCard }
  | { ok: false; status: 400 | 502 | 422; error: string };

/**
 * Fetch and lightly validate the agent card at `rawUrl`.
 *
 * `rawUrl` may be:
 *   - A base URL:           http://host:port
 *   - A full card URL:      http://host:port/.well-known/agent-card.json
 *
 * Both are normalized to the base URL; the card is always fetched from
 * `<baseUrl>/.well-known/agent-card.json`.
 *
 * HTTP errors → 502 (upstream unreachable / returned non-OK).
 * Non-JSON or structurally invalid card → 422.
 * Unparseable input URL → 400.
 */
export async function fetchAgentCard(rawUrl: string): Promise<FetchAgentCardResult> {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, status: 400, error: 'url is required' };
  }

  // Validate URL structure before attempting a network fetch.
  let baseUrl: string;
  try {
    // normalizeA2ABaseUrl strips trailing slash + /.well-known/... suffix.
    baseUrl = normalizeA2ABaseUrl(trimmed);
    // Verify the normalized form is a parseable URL.
    const u = new URL(baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, status: 400, error: 'url must use http or https' };
    }
  } catch {
    return { ok: false, status: 400, error: `invalid url: ${trimmed}` };
  }

  const cardUrl = `${baseUrl}/.well-known/agent-card.json`;

  let res: Response;
  try {
    // 10s timeout — agent cards are tiny JSON documents.
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10_000);
    try {
      res = await fetch(cardUrl, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 502, error: `could not reach ${cardUrl}: ${msg}` };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: 502,
      error: `${cardUrl} returned HTTP ${res.status}`,
    };
  }

  let card: unknown;
  try {
    card = await res.json();
  } catch {
    return {
      ok: false,
      status: 422,
      error: `${cardUrl} did not return valid JSON`,
    };
  }

  // Minimal structural check: must be an object with name + protocolVersion.
  if (
    typeof card !== 'object' ||
    card === null ||
    Array.isArray(card) ||
    typeof (card as Record<string, unknown>).name !== 'string' ||
    typeof (card as Record<string, unknown>).protocolVersion !== 'string'
  ) {
    return {
      ok: false,
      status: 422,
      error: 'agent card is missing required fields (name, protocolVersion)',
    };
  }

  return {
    ok: true,
    data: {
      card: card as Record<string, unknown>,
      baseUrl,
    },
  };
}
