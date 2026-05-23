/**
 * iter-011 Pass #2 — IntegrationLink discriminated union + isGmailLink.
 * Numbered cases below map 1:1 to the Pass #2 acceptance checks (#2–#5).
 * #1 (typecheck green) is exercised by `pnpm -F api-contract typecheck`.
 */

import { describe, it, expect } from 'vitest';

import {
  IntegrationLink,
  GmailConfig,
  isGmailLink,
} from '../src/entities/owner-assistant.js';

const fullGmail = {
  kind: 'gmail' as const,
  label: 'you@gmail.com',
  config: {
    access_token_ref: 'a',
    refresh_token_ref: 'b',
    expires_at: 0,
    scope: 'x',
    email_address: 'x@y.com',
    connected_at: 0,
  },
  enabled: true,
};

describe('IntegrationLink — iter-011 Pass #2 discriminated union', () => {
  it('accepts a fully-formed gmail link (acceptance #2)', () => {
    const result = IntegrationLink.safeParse(fullGmail);
    expect(result.success).toBe(true);
    if (result.success && isGmailLink(result.data)) {
      expect(result.data.config.email_address).toBe('x@y.com');
    } else {
      throw new Error('expected isGmailLink to narrow');
    }
  });

  it('rejects a gmail link with empty config (acceptance #3)', () => {
    const result = IntegrationLink.safeParse({
      kind: 'gmail', label: 'you@gmail.com', config: {}, enabled: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('config.access_token_ref');
      expect(paths).toContain('config.email_address');
    }
  });

  it('rejects gmail with malformed email_address', () => {
    const result = IntegrationLink.safeParse({
      ...fullGmail, config: { ...fullGmail.config, email_address: 'nope' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a slack link with loose config (acceptance #4)', () => {
    const result = IntegrationLink.safeParse({
      kind: 'slack', label: '#design', config: { anything: 'goes' }, enabled: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(isGmailLink(result.data)).toBe(false);
    }
  });

  it('defaults config to {} for non-gmail kinds when omitted', () => {
    const result = IntegrationLink.safeParse({ kind: 'discord', label: 't', enabled: true });
    expect(result.success).toBe(true);
    if (result.success && result.data.kind === 'discord') {
      expect(result.data.config).toEqual({});
    }
  });

  it('rejects an unknown kind', () => {
    expect(IntegrationLink.safeParse(
      { kind: 'asana', label: 'X', config: {}, enabled: true },
    ).success).toBe(false);
  });

  it('isGmailLink narrows correctly (acceptance #5)', () => {
    const gmail = IntegrationLink.parse(fullGmail);
    const slack = IntegrationLink.parse({ kind: 'slack', label: '#x', config: {}, enabled: true });
    expect(isGmailLink(gmail)).toBe(true);
    expect(isGmailLink(slack)).toBe(false);
    if (isGmailLink(gmail)) {
      // Typecheck-time assertion: if the guard fails to narrow, this won't compile.
      const _email: string = gmail.config.email_address;
      expect(_email).toBe('x@y.com');
    }
  });

  it('GmailConfig parses standalone', () => {
    expect(GmailConfig.safeParse(fullGmail.config).success).toBe(true);
  });
});
