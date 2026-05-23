import type { CapacitorConfig } from '@capacitor/cli';

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
};

export default config;
