import { deskOrigin } from './desk-origin';

// M-L-045 · single source of truth for every data fetch URL. On the Next dev
// server, relative `/api/v1/*` URLs work only because next.config.ts rewrites
// `/api/*` → the desk (localhost:3000). That rewrite block is stripped for the
// Capacitor build and does NOT exist in the static `output:'export'` APK, so on
// a real phone the WebView origin is `capacitor://localhost`/`file://` and every
// relative `/api/v1/*` fetch 404s — the entire app goes non-functional off the
// dev box. Route every fetch through deskApi(): in the Capacitor build it
// prefixes the absolute desk origin; in dev it stays relative so the rewrite
// keeps working (origin empty path).
export function deskApi(path: string): string {
  if (process.env.NEXT_PUBLIC_CAPACITOR === '1') {
    return `${deskOrigin()}${path}`;
  }
  return path;
}
