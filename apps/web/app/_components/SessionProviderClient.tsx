'use client';

/**
 * iter-013 Pass #3 (ADR-024 § Implementation Notes step 3): mount the
 * NextAuth v5 React SessionProvider at the app shell so client components
 * (e.g. AuthorizationsSection) can call `useSession()` / `signIn()` /
 * `signOut()` from `next-auth/react`. Without this provider those hooks
 * throw "No session context found".
 *
 * Thin client wrapper so the server-rendered `app/layout.tsx` can stay
 * a Server Component (RSC) — only this leaf is the 'use client' boundary.
 */

import type { ReactNode } from 'react';
import { SessionProvider } from 'next-auth/react';

export default function SessionProviderClient({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
