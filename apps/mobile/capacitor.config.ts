import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

// Holon mobile — Capacitor wrap config.
// webDir points at Next.js static export output (`pnpm -F mobile build`
// with output: 'export' produces ./out). When user installs desk auth
// + production hosting, switch `server.url` to point at the deployed
// Holon host so the native shell loads from there with hot-reload.
const config: CapacitorConfig = {
  appId: 'com.holon.mobile',
  appName: 'Holon',
  webDir: 'out',
  server: {
    // Dev: point Capacitor WebView at the WSL2-hosted dev server so
    // hot-reload + assistant-ui chat both work end-to-end against the
    // desk BFF (proxied via next.config.ts rewrites).
    androidScheme: 'http',
    iosScheme: 'http',
    cleartext: true,
  },
  plugins: {
    // SSE-FIX: CapacitorHttp is DISABLED. When enabled it patches window.fetch
    // to the native HTTP stack, which buffers the entire response body before
    // resolving — this killed SSE streaming (chat reply appeared all-at-once).
    //
    // Cross-origin + cleartext access is now solved correctly:
    //   1. apps/web/middleware.ts adds CORS headers (Access-Control-Allow-Origin,
    //      Allow-Headers: x-holon-device-token, OPTIONS preflight) for all
    //      /api/v1/* routes, covering the Capacitor origin (http://localhost on
    //      Android, capacitor://localhost on iOS).
    //   2. server.cleartext:true + usesCleartextTraffic (patched in the build
    //      script) allow http:// LAN addresses at the OS level.
    // The real WebView fetch (now unpatched) supports ReadableStream + SSE,
    // so chunks arrive incrementally and the chat UI updates token-by-token.
    CapacitorHttp: {
      enabled: false,
    },
    // Keyboard: resize=None made the keyboard OVERLAY the composer (it vanished
    // behind the keyboard). Native resizes the WebView so the composer stays
    // visible above the keyboard. interactiveWidget is dropped (below) so the
    // two don't double-resize. Remaining iOS bottom-gap is tuned in CSS.
    Keyboard: {
      resize: KeyboardResize.Native,
    },
  },
};

export default config;
