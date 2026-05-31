import type { NextConfig } from 'next';
import { loadEnvConfig } from '@next/env';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

// `next build` imports route modules while collecting page data, before
// instrumentation.ts has a chance to load repo-root `.env`. Load it here too
// so production module-load guards see HOLON_* secrets during standalone
// builds. `forceReload=true` lets root `.env` supplement apps/web/.env*.
loadEnvConfig(findRepoRoot(), process.env.NODE_ENV !== 'production', console, true);

const config: NextConfig = {
  // L-099: isolate the prod build's output dir so a build run while dev is
  // live never clobbers the dev server's .next/ directory.
  // With NEXT_DIST_DIR unset (normal dev), resolves to the default ".next".
  // The installer pipeline sets NEXT_DIST_DIR=.next-prod so the standalone
  // output lands in apps/web/.next-prod/ and leaves .next/ untouched.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  // Hide the draggable Next.js dev indicator (the floating "N" badge). Dev-only
  // chrome with no production effect; owner found it visual noise during testing.
  devIndicators: false,
  // iter-012 Pass #1: Tauri 2.x production bundle reads from `.next/standalone`
  // per `tauri.conf.json` build.frontendDist. Dev mode (`pnpm dev` on port
  // 3000) is unaffected — `standalone` output only emits on `pnpm build`.
  //
  // iter-012 Pass #6.1 update: standalone bundle is no longer Tauri's
  // frontendDist (that points at apps/web/public/ now); instead the bundle
  // is copied into apps/web/src-tauri/resources/n/ by
  // scripts/copy-standalone-for-tauri.mjs and run as a Node sidecar (per
  // Q-010 path #1). frontendDist swap removes the "node_modules inside
  // frontendDist" Tauri-bundler error.
  output: 'standalone',
  // iter-012 Pass #6.1: Next.js's file tracer scans the entire workspace
  // root by default + bundles everything it finds into .next/standalone/.
  // Without exclusion it copies apps/web/src-tauri/{target,resources,
  // binaries} into the bundle — target/ alone is ~500 MB of Rust build
  // artifacts; resources/ contains the previous standalone copy (1 GB
  // recursive bloat); binaries/ has the 115 MB Node sidecar. Excluding
  // src-tauri here keeps the bundle at the expected ~80-100 MB.
  // Windows-only EPERM workaround (GHA windows-latest desk-installer):
  // Next 15's file tracer walks HOME/USERPROFILE and chokes on the legacy
  // `C:\Users\<user>\AppData\Local\Application Data` junction (XP compat
  // self-referential symlink with restricted ACL). Stock Node hits
  // `EPERM: operation not permitted, scandir` and the build fails. Excluding
  // the user-profile junction paths globally keeps the tracer off them.
  // Linux/Mac patterns are no-ops on those platforms.
  outputFileTracingExcludes: {
    '*': [
      'src-tauri/**/*',
      '../../apps/web/src-tauri/**/*',
      '../../apps/mobile/**/*',
      '**/src-tauri/target/**/*',
      '**/src-tauri/resources/**/*',
      '**/src-tauri/binaries/**/*',
      '**/.next/cache/**/*',
      // Windows legacy junction loops (EPERM on GHA windows-latest)
      'C:/Users/**/AppData/**',
      '**/Application Data/**',
      '**/My Documents/**',
      '**/Local Settings/**',
      '**/Cookies/**',
      '**/NetHood/**',
      '**/PrintHood/**',
      '**/Recent/**',
      '**/SendTo/**',
      '**/Start Menu/**',
      '**/Templates/**',
    ],
  },
  // Allow Next.js to transpile the workspace packages (they ship raw TS).
  transpilePackages: ['@holon/api-contract', '@holon/core'],
  // iter-013 Pass #2 hotfix: better-sqlite3 is a native Node addon used by
  // the NextAuth drizzle adapter. Webpack must not try to bundle it for the
  // server runtime — keep it as an external require() so the .node binary
  // resolves correctly. Without this, dev boot crashes 500 with
  // module-not-found for `file-uri-to-path` (a transitive runtime-path-
  // resolver dep that webpack tree-shakes incorrectly).
  serverExternalPackages: ['better-sqlite3'],
  // Workspace packages use `.js` extensions in import specifiers (NodeNext
  // convention) but ship `.ts` files. Tell webpack to look for `.ts`/`.tsx`
  // when it sees a `.js` import that doesn't exist as a file.
  webpack(webpackConfig) {
    webpackConfig.resolve.extensionAlias = {
      ...(webpackConfig.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return webpackConfig;
  },
};

export default config;
