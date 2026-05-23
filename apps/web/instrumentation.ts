/**
 * Next.js instrumentation hook — runs once at server startup, BEFORE any
 * route handlers. We use it to load the repo-root `.env` file via Next's
 * own loader (`@next/env`), so `process.env.GOOGLE_CLIENT_ID` etc. are
 * visible to plain `process.env.*` reads everywhere in the app.
 *
 * Without this, `next dev` only auto-loads `apps/web/.env*` (relative to
 * its own cwd), and the recipe / `.env.example` pattern of putting env
 * vars at the repo root silently fails — root-cause of L-015 (iter-011
 * Gmail OAuth `oauth_config_error`). The only prior root-`.env` reader
 * was the bespoke one in `apps/web/lib/deepseek-json.ts`; this hook
 * generalises the fix to the whole process env.
 */
export async function register(): Promise<void> {
  // Edge runtime has no fs / __dirname; skip cleanly.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Use `eval("require")` to hide these deps from webpack's static
  // analysis. A plain `await import('@next/env')` makes webpack try to
  // bundle the package for the edge-runtime pass, which fails because
  // `@next/env` internally `require('crypto')` (node-only). The eval
  // keeps the require as a runtime Node call. Safe — the strings are
  // hard-coded module IDs, not user input.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeRequire = eval('require') as (id: string) => any;
  const { existsSync } = nodeRequire('node:fs') as typeof import('node:fs');
  const { dirname, join } = nodeRequire('node:path') as typeof import('node:path');
  const { loadEnvConfig } = nodeRequire('@next/env') as typeof import('@next/env');

  // Walk up from this file's directory until we find pnpm-workspace.yaml
  // — the repo-root marker. Same pattern as `findRepoRoot()` in
  // apps/web/lib/deepseek-json.ts (kept for the DeepSeek-only path; this
  // hook covers the rest).
  function findRepoRoot(): string | null {
    if (process.env.HOLON_REPO_ROOT) return process.env.HOLON_REPO_ROOT;
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  const repoRoot = findRepoRoot();
  if (!repoRoot) {
    process.stderr.write(
      '[instrumentation] repo root (pnpm-workspace.yaml) not found; ' +
        'skipping root .env load — env vars must live in apps/web/.env*\n',
    );
    return;
  }

  try {
    const dev = process.env.NODE_ENV !== 'production';
    // `forceReload=true` (4th arg) is REQUIRED here: Next dev already
    // auto-loaded `apps/web/.env*` and set `process.env.__NEXT_PROCESSED_ENV=true`
    // before this hook fires; without the flag, `loadEnvConfig` early-returns
    // (see `processEnv` in `@next/env/dist/index.js`) and our repo-root `.env`
    // is silently ignored — defeating the whole L-015 fix.
    loadEnvConfig(repoRoot, dev, console, true);
    process.stderr.write(`[instrumentation] loaded .env from ${repoRoot}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[instrumentation] loadEnvConfig(${repoRoot}) failed: ${msg} — ` +
        'falling back to default env loading\n',
    );
  }

  // iter-013 Pass #2 hotfix3: auth.db init moved INTO db/index.ts as a
  // module-side-effect (runs on first import via NextAuth's adapter, well
  // before any sign-in attempt). instrumentation.ts no longer needs to
  // touch better-sqlite3 — keeps webpack happy AND avoids the eval-require
  // .ts-resolution issue that hotfix2 hit. The DDL lives inline in
  // db/index.ts; scripts/init-auth-db.ts retained as the CLI entry point
  // for manual table-init in deploy scripts.
  // (no-op block below preserved for symmetry with the loadEnvConfig
  // try/catch above — easier to add new boot-time init later.)
  try {
    // Fixture cache warming moved to first API route call (loadFixtures is
    // cached after first invocation). Cannot warm here because instrumentation
    // is bundled by webpack which rejects node: protocol imports.
    const dynamicImport = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;
    const core = await dynamicImport<typeof import('@holon/core')>('@holon/core');
    core.startMemoryConsolidationService();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[instrumentation] post-env init failed: ${msg} — ` +
        'first route may surface a structured error\n',
    );
  }
}
