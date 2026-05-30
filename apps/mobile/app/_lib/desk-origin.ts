// M-L-037 · single source of truth for the desk origin used by every
// "open in desk" deep-link.
//
// Resolution order (first hit wins):
//   1. localStorage (runtime, user-configured via onboarding/settings) — lets
//      the same APK work for any user without rebuilding.
//   2. NEXT_PUBLIC_DESK_ORIGIN — baked at build time, owner-only convenience.
//   3. http://localhost:3000 — dev fallback (will misbehave on a real phone;
//      the onboarding screen exists specifically to keep this from shipping).
import { readDeskOrigin } from './desk-url-storage';

export function deskOrigin(): string {
  const stored = readDeskOrigin();
  if (stored) return stored;
  return process.env.NEXT_PUBLIC_DESK_ORIGIN ?? 'http://localhost:3000';
}
