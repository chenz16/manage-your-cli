/**
 * Audit emit — iter-011 Pass #6.
 *
 * Single source of truth for the `integration.*` event family. Mirrors the
 * cost-service pattern (iter-010 Pass #3): each emit is a one-line JSON
 * object on stdout with `audit: '<event.name>'` + `ts` + payload. The dev
 * daemon tee's stdout into the audit collector; tests grep on these lines.
 *
 * Engineering Rule #8 (V1 post-emit): callers MUST call after the state
 * change lands. Error paths emit before surfacing per Rule #4.
 *
 * Engineering Rule #4 (no silent failure): every reject path in the
 * integration BFFs routes through here so the audit trail has a unified
 * shape regardless of where the failure was caught.
 *
 * Kind-agnostic: the emit signature takes `kind: IntegrationKind` from
 * `@holon/api-contract`. Adding a new integration (e.g. `'asana'`) to the
 * enum requires zero edits in this file or any audit-emit call site —
 * the per-event payload types stay open via `Record<string, unknown>`.
 *
 * Audit-event taxonomy (iter-011 Pass #6 spec § Components):
 *   - `integration.connected`           {email_redacted?, owner_id_prefix, connected_at?}
 *   - `integration.connect_failed`      {reason, message?}
 *   - `integration.disconnected`        {owner_id_prefix, email_redacted?, ...}
 *   - `integration.token_refreshed`     {owner_id_prefix}
 *   - `integration.token_refresh_failed`{reason, owner_id_prefix?, message?}
 *   - `integration.token_fetched`       {owner_id_prefix}     (BFF tokens route)
 *   - `integration.disconnect_failed`   {reason, ...}
 *   - `integration.api_called`          {endpoint, status_code, latency_ms}
 *   - `integration.deprecated_endpoint_called` {endpoint, replacement}
 *       (iter-013 Pass #4: stragglers hitting iter-011 OAuth shims after
 *        the NextAuth cutover; lets us count + chase them before the
 *        shim removal in the next iter.)
 *
 * WeChat audit event taxonomy (iter-022 Phase 1, Pass #2):
 *   - `wechat.paste.created`  {mission_id, content_length, contact_name_present: bool, ts, staff_id: null}
 *       Emitted after every successful createWeChatPasteMission call (V1
 *       post-emit per ADR-007). Content body is NOT stored (AC-1.6 privacy
 *       default); only length + contact presence flags are recorded.
 */

import type { IntegrationKind } from '@holon/api-contract';

/** Closed event-name union. Adding a member is the ONE place a new event
 *  type must register — call sites stay structural. */
export type IntegrationEvent =
  | 'integration.connected'
  | 'integration.connect_failed'
  | 'integration.disconnected'
  | 'integration.disconnect_failed'
  | 'integration.token_fetched'
  | 'integration.token_fetch_failed'
  | 'integration.token_refreshed'
  | 'integration.token_refresh_failed'
  | 'integration.api_called'
  | 'integration.deprecated_endpoint_called';

// ── WeChat audit event types ─────────────────────────────────────────────────

/**
 * Payload for `wechat.paste.created`.
 *
 * Per AC-1.6: content body is intentionally absent — only metadata is
 * recorded (privacy default). staff_id is null in Phase 1 (no automated
 * staff involved; owner-initiated paste only).
 */
export interface WeChatPasteCreatedPayload {
  mission_id: string;
  content_length: number;
  contact_name_present: boolean;
  ts: string;
  staff_id: null;
}

/** Emit the `wechat.paste.created` audit event via the standard stdout sink.
 *  Returns the emitted object so tests can assert on shape without mocking
 *  console.log (mirrors emitIntegrationAudit return convention). */
export function emitWeChatPasteAudit(
  input: Omit<WeChatPasteCreatedPayload, 'staff_id'>,
): Record<string, unknown> {
  const line: Record<string, unknown> = {
    audit: 'wechat.paste.created',
    mission_id: input.mission_id,
    content_length: input.content_length,
    contact_name_present: input.contact_name_present,
    ts: input.ts,
    staff_id: null,
  };
  // Same stdout sink as emitIntegrationAudit; daemon tee's into audit collector.
  console.log(JSON.stringify(line));
  return line;
}

// ── Ingress audit event types (iter-022 Phase 2 — ADR-037) ─────────────────

/**
 * Payload for `ingress.received` — emitted by IngressGateway.ingest() after a
 * normalized IngressEvent has been converted to a Mission and persisted (V1
 * post-emit, Engineering Rule #8 / ADR-007). Channel-agnostic: the `channel`
 * field records which adapter delivered the event.
 *
 * Privacy posture (Rule #8 / AC-1.6): message body is NOT recorded — only
 * length + presence flags + the channel-native ids needed for dedup tracing.
 * `sender_external_id` is recorded only as a presence flag, never the raw
 * value (it may be a personal account id).
 */
export interface IngressReceivedPayload {
  mission_id: string;
  channel: string;
  external_message_id: string;
  content_length: number;
  sender_external_id_present: boolean;
  context_token_present: boolean;
  ts: string;
}

/** Emit the `ingress.received` audit event via the standard stdout sink.
 *  Returns the emitted object so tests can assert on shape without mocking
 *  console.log (mirrors emitWeChatPasteAudit). */
export function emitIngressReceivedAudit(
  input: IngressReceivedPayload,
): Record<string, unknown> {
  const line: Record<string, unknown> = {
    audit: 'ingress.received',
    mission_id: input.mission_id,
    channel: input.channel,
    external_message_id: input.external_message_id,
    content_length: input.content_length,
    sender_external_id_present: input.sender_external_id_present,
    context_token_present: input.context_token_present,
    ts: input.ts,
  };
  // Same stdout sink as emitWeChatPasteAudit; daemon tee's into audit collector.
  console.log(JSON.stringify(line));
  return line;
}

export interface IntegrationAuditInput {
  /** Which external system the event is about. Untyped at the value level
   *  (so adding `'asana'` to IntegrationKind needs no edit here), but the
   *  TS type enforces membership at every call site. */
  kind: IntegrationKind;
  /** What happened. Closed union so typos are compile errors. */
  event: IntegrationEvent;
  /** Best-effort timestamp. Defaults to `new Date().toISOString()` so call
   *  sites can stay terse; supply explicitly when the event records a
   *  past moment (e.g. forwarded from the Python sidecar). */
  ts?: string;
  /** Event-specific payload. Intentionally open so per-event schemas
   *  evolve without touching this file. Caller is responsible for not
   *  embedding PII (tokens, full email addresses, message bodies). */
  payload?: Record<string, unknown>;
}

/** Emit one structured audit line via the standard stdout sink. Returns
 *  the emitted object so test fixtures can assert on shape. */
export function emitIntegrationAudit(input: IntegrationAuditInput): Record<string, unknown> {
  const line: Record<string, unknown> = {
    audit: input.event,
    kind: input.kind,
    ts: input.ts ?? new Date().toISOString(),
    ...(input.payload ?? {}),
  };
  // Same sink as cost-service.ts (iter-010 Pass #3); the daemon tee's
  // stdout into the audit collector. console.log is intentional.
  console.log(JSON.stringify(line));
  return line;
}
