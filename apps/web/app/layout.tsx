import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies, headers } from 'next/headers';
import { AppShell } from './_components/AppShell';
import { ChatRuntimeProvider } from './_components/ChatRuntimeProvider';
import SessionProviderClient from './_components/SessionProviderClient';
import { I18nProvider } from '../lib/i18n/I18nProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Holon — Hybrid Workforce',
  description: 'Local AI team + hybrid employment interconnect.',
};

/**
 * L-084: Derive <html lang> from the Accept-Language request header at
 * SSR time so browser assistive tech / auto-translate plugins see the
 * correct language on first paint, before the client-side I18nProvider
 * hydrates with the persisted owner preference.
 *
 * Limitation: this only reads the browser's Accept-Language header, not
 * the owner's saved language_preference (which lives server-side in
 * the owner fixture / DB). The owner preference wins after hydration
 * (~200–400 ms). `holon-lang`, written by the client language switcher,
 * lets a manual refresh first-paint in the user's explicit preference.
 */
async function getSsrLang(): Promise<'en' | 'zh-CN'> {
  try {
    const cookieStore = await cookies();
    const cookieLang = cookieStore.get('holon-lang')?.value;
    if (cookieLang === 'zh-CN' || cookieLang === 'en') return cookieLang;

    const hdrs = await headers();
    const acceptLang = hdrs.get('accept-language') ?? '';
    // Accept-Language is typically "zh-CN,zh;q=0.9,en;q=0.8" — check
    // whether any zh variant appears before en in the preference list.
    const first = acceptLang.split(',')[0]?.trim().toLowerCase() ?? '';
    if (first.startsWith('zh')) return 'zh-CN';
  } catch (_e: unknown) {
    // headers() unavailable (e.g. during static export) — fall back to en.
  }
  return 'en';
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await getSsrLang();
  return (
    <html lang={lang}>
      <body data-page="react">
        {/* iter-013 Pass #3 (ADR-024 step 3): SessionProvider must sit
         * above every client component that calls useSession/signIn/signOut
         * from next-auth/react — placed at the app-shell root so any
         * future page also inherits it.
         *
         * ChatRuntimeProvider wraps the entire app shell so the
         * assistant-ui runtime lives ABOVE AppShell + Nav + path
         * detection — surviving every soft route change. */}
        {/* I18nProvider mounted inside the SessionProvider chain (above
         * AppShell) so Nav + every page client component can call
         * useT(). The provider reads `useOwner()` which fetches /me;
         * placement under SessionProvider keeps the auth context
         * available to that fetch. iter-017 Pass #12 part 1 — wires up
         * the framework deferred since Phase A (91a2127). */}
        <SessionProviderClient>
          <ChatRuntimeProvider>
            <I18nProvider>
              <AppShell>{children}</AppShell>
            </I18nProvider>
          </ChatRuntimeProvider>
        </SessionProviderClient>
        {/* Bug-report button now lives in the Nav (next to the gear)
         * so it's never hidden by the Next.js dev indicator. */}
      </body>
    </html>
  );
}
