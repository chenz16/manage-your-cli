/**
 * Helpers for the owner-chat route. These live in a lib (not the route file)
 * because Next.js route modules may only export route handlers + config —
 * exporting helpers from route.ts fails `next build` route-type validation.
 */

export interface ChatMessage { role: string; content: string }

const WECHAT_CONTEXT_START = '<!-- holon:wechat-context';
const WECHAT_CONTEXT_END = '-->';

function parseCharset(contentType: string | null): string {
  const match = /(?:^|;)\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType ?? '');
  return match?.[1]?.toLowerCase() ?? 'utf-8';
}

function decodeRequestBytes(bytes: ArrayBuffer, charset: string): string {
  const label = charset === 'gbk' ? 'gb18030' : charset;
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes);
  } catch (primaryErr) {
    if (label !== 'utf-8') return new TextDecoder('utf-8').decode(bytes);
    try {
      return new TextDecoder('gb18030').decode(bytes);
    } catch (fallbackErr) {
      const primary = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      const fallback = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      throw new Error(`request body decode failed: ${fallback}; primary=${primary}`);
    }
  }
}

export async function parseJsonRequestBody(req: Request): Promise<unknown> {
  const bytes = await req.arrayBuffer();
  const text = decodeRequestBytes(bytes, parseCharset(req.headers.get('content-type')));
  return JSON.parse(text) as unknown;
}

export function extractChatMessages(body: unknown): ChatMessage[] {
  if (typeof body !== 'object' || body === null || !('messages' in body)) return [];
  const raw = (body as { messages: unknown }).messages;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (m): m is ChatMessage =>
      typeof m === 'object' && m !== null &&
      typeof (m as { role?: unknown }).role === 'string' &&
      typeof (m as { content?: unknown }).content === 'string',
  );
}

export function extractLatestUserText(body: unknown): string | null {
  const messages = extractChatMessages(body);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user') return m.content;
  }
  return null;
}

function extractWeChatContextBlocks(messages: ChatMessage[]): string[] {
  const blocks: string[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    let searchFrom = 0;
    while (searchFrom < message.content.length) {
      const start = message.content.indexOf(WECHAT_CONTEXT_START, searchFrom);
      if (start === -1) break;
      const jsonStart = message.content.indexOf('\n', start);
      if (jsonStart === -1) break;
      const end = message.content.indexOf(WECHAT_CONTEXT_END, jsonStart + 1);
      if (end === -1) break;
      const block = message.content.slice(jsonStart + 1, end).trim();
      if (block) blocks.push(block);
      searchFrom = end + WECHAT_CONTEXT_END.length;
    }
  }
  return blocks.slice(-3);
}

export function buildOwnerPrompt(
  userText: string,
  messages: ChatMessage[],
  activeProjectContext?: { name: string; memoryText: string } | null,
): string {
  const wechatContexts = extractWeChatContextBlocks(messages);

  const parts: string[] = [];

  // Phase 1 — active project context injected at the top of the prompt
  // when the boss has a project selected. One conditional readBossMemory
  // call (per design doc § 9 item 8). The memory text may be short (just
  // the stub written at project create time), which is fine — more detail
  // accumulates as the boss uses writeBossMemory().
  if (activeProjectContext?.name && activeProjectContext.memoryText.trim()) {
    parts.push(`## Active project: ${activeProjectContext.name}`, activeProjectContext.memoryText.trim(), '');
  }

  if (wechatContexts.length > 0) {
    parts.push(
      'The user may be asking a follow-up about WeChat messages that were read earlier in this chat.',
      'Use the WeChat context JSON below as already-read source data. Do not say you cannot read WeChat if the answer is present in this context.',
      '',
      ...wechatContexts.map((ctx, i) => `WeChat context ${i + 1}:\n${ctx}`),
      '',
      `Current user question:\n${userText}`,
    );
    return parts.join('\n');
  }

  if (parts.length === 0) return userText;
  parts.push(userText);
  return parts.join('\n');
}
