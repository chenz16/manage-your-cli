import type { NextConfig } from 'next';

// When NEXT_PUBLIC_CAPACITOR=1 is set (e.g., by scripts/mobile-ios-gate.sh
// or scripts/build-android.sh when wrapping for native), Next builds a
// pure static export to ./out so Capacitor can package the assets.
// Otherwise we run as a normal Next.js dev server with API proxying.
const isCapacitorBuild = process.env.NEXT_PUBLIC_CAPACITOR === '1';

// M-L-032 — when scripts/mobile-prod-preview.sh sets HOLON_PROD_PREVIEW=1,
// build into .next-prod so the dev server's .next is not clobbered.
const isProdPreview = process.env.HOLON_PROD_PREVIEW === '1';

const config: NextConfig = {
  reactStrictMode: true,
  // M-L-067 — rewrite the `lucide-react` named-barrel imports (tab bar + strips,
  // ~10 icons total) into per-icon deep imports so the 37MB icon set is NOT
  // pulled wholesale into the shared chunk that loads on every route via the
  // root-layout tab bar. All current lucide imports are already named (verified:
  // no `import * as`), which is the precondition this optimization relies on.
  experimental: { optimizePackageImports: ['lucide-react'] },
  // M-L-047 — emit `chat/index.html` instead of flat `chat.html` so Capacitor's
  // local asset server (Android/iOS) resolves `/chat/` → `/chat/index.html`.
  // The static export does NOT auto-resolve an extensionless `/chat` to
  // `chat.html`, so every internal nav 404'd on a real device. Internal hrefs +
  // manifest start_url are updated to the trailing-slash form to match.
  trailingSlash: true,
  // Keep the trailing-slash *export* file naming (chat/index.html) but skip
  // the dev-server 308 redirect that would otherwise hop every `/api/*` proxy
  // call to its trailing-slash form before the rewrite runs. The APK calls the
  // desk origin directly via deskApi() (M-L-045), so this only affects dev.
  skipTrailingSlashRedirect: true,
  ...(isCapacitorBuild ? { output: 'export' as const } : {}),
  ...(isProdPreview ? { distDir: '.next-prod' } : {}),
  // Reuse workspace packages (raw TS, no built dist)
  transpilePackages: ['@holon/api-contract', '@holon/core'],
  webpack(webpackConfig) {
    webpackConfig.resolve.extensionAlias = {
      ...(webpackConfig.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return webpackConfig;
  },
  // Proxy /api/* to the desk BFF on port 3000 — mobile is a view layer,
  // does not define its own API routes in M001. Static export mode
  // (Capacitor) cannot have rewrites; for the native shell, Capacitor
  // config's `server.url` points the WebView at the dev/prod desk host.
  ...(isCapacitorBuild ? {} : {
    async rewrites() {
      return [
        {
          source: '/api/:path*',
          destination: 'http://localhost:3000/api/:path*',
        },
      ];
    },
  }),
};

export default config;
