// NextAuth v5 (Auth.js) catch-all route handler.
// iter-013 Pass #1 (ADR-024 § Implementation Notes step 1).
//
// Destructures GET + POST from the central auth config's handlers. NextAuth's
// internal router dispatches signin/callback/signout/providers/session under
// this single route — replaces iter-011's hand-rolled
// /api/v1/integrations/oauth/[kind]/{authorize,callback}/route.ts pair
// (those die in Pass #4 of iter-013).

import { handlers } from '@/auth';

export const { GET, POST } = handlers;
