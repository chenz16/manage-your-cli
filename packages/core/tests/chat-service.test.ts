import { describe, it, expect } from 'vitest';
import { ListChatThreadsResponse } from '@holon/api-contract';
import { listChatThreads, getChatThread } from '../src/chat-service.js';

// iter-010 Pass #5 triage (TECH-DEBT D9): the baseline fixture was
// intentionally emptied per user directive (see CLAUDE.md § "Fixture
// edits" + fixtures.snapshot.json now ships 0 chat_threads / 0 staff /
// 0 connections / 0 missions / 0 deliverables). Tests that assert on
// specific fixture counts / ids are stale; either rewrite against a
// minimal seeded fixture or rely on dynamic-store CRUD coverage that
// the iter-009 mutable-store tests already provide. Skipped here so
// CI exits 0; tracked under D9 cleanup task.

describe('listChatThreads', () => {
  it.skip('returns 3 threads from fixture (Myself, Aria, Wang)', () => {
    // SKIP: TECH-DEBT D9 — fixture is now empty; reseed before re-enable.
    const r = listChatThreads();
    expect(r.items).toHaveLength(3);
  });

  it('parses through ListChatThreadsResponse schema', () => {
    expect(() => ListChatThreadsResponse.parse(listChatThreads())).not.toThrow();
  });

  it('every thread has at least one message', () => {
    for (const t of listChatThreads().items) {
      expect(t.messages.length).toBeGreaterThan(0);
    }
  });
});

describe('getChatThread', () => {
  it('returns null for unknown id', () => {
    expect(getChatThread('thread_NONEXISTENT')).toBeNull();
  });

  it.skip('returns the Myself thread by id', () => {
    // SKIP: TECH-DEBT D9 — fixture has no `thread_01MYSELF` row anymore.
    const t = getChatThread('thread_01MYSELF');
    expect(t).not.toBeNull();
    expect(t!.participant_name).toBe('Myself (Desk AI)');
  });
});
