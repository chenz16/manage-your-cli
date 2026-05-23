// M-L-037 · single source of truth for the desk origin used by every
// "open in desk" deep-link. On a real phone (Capacitor APK / iOS / PWA off
// the dev box) a hardcoded localhost:3000 resolves to the phone itself and
// the entire thin-client→desk handoff dies. Read NEXT_PUBLIC_DESK_ORIGIN at
// build time; fall back to localhost:3000 for local dev.
export function deskOrigin(): string {
  return process.env.NEXT_PUBLIC_DESK_ORIGIN ?? 'http://localhost:3000';
}
