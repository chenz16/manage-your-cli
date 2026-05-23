/**
 * iter-013 Pass #4 — Spec retired (ADR-024 / iter-013 cut-over).
 *
 * The iter-011 Pass #5 happy-path covered here drove the manual
 * `/api/v1/integrations/oauth/gmail/{authorize,callback,disconnect}` routes
 * + the OAuthClient test-mode short-circuit. All three are deleted (or
 * shrunk to 410-Gone deprecation shims) as of iter-013 Pass #4.
 *
 * The replacement NextAuth-backed flow lives at
 * `/api/auth/signin/google` (and the BFF session-fetch at
 * `/api/v1/integrations/auth/session`). A rewritten e2e for that path is
 * scoped for a follow-up iter — it needs a NextAuth-aware Playwright
 * harness (signed-session cookie injection, or a `credentials`-provider
 * test-mode fake within `apps/web/auth.ts`). Out of iter-013 budget.
 *
 * Until the rewrite lands, this spec stays in the tree as a permanent
 * skip with a pointer so any agent searching for "gmail OAuth e2e" lands
 * on this comment rather than thinking the test runs.
 */
import { test } from '@playwright/test';

test.describe('iter-011 Gmail OAuth e2e — RETIRED (see ADR-024 / iter-013 Pass #4)', () => {
  test.skip('happy path retired — see file comment for replacement plan', () => {
    // intentionally empty; the iter-011 routes this spec exercised are deleted.
  });
});
