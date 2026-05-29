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

  // Secretary pre-warm — spawn the secretary's claude process at boot so the
  // owner's FIRST message never hits a cold-start. The heartbeat in warm-agent
  // respawns it automatically if it ever dies, keeping it always-warm.
  // This is the correct place: instrumentation.register() runs ONCE per server
  // boot, before any route handler, in the Node.js runtime.
  try {
    const dynamicImport2 = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;
    const [coreSecretaryMod, warmAgentMod] = await Promise.all([
      dynamicImport2<typeof import('@holon/core')>('@holon/core'),
      dynamicImport2<typeof import('./lib/warm-agent')>('./lib/warm-agent'),
    ]);
    const secretary = coreSecretaryMod.getOrCreateSecretaryStaff();
    // Secretary must be a cli_agent backed by 'claude' for warm-agent to work.
    if (secretary.substrate.kind === 'cli_agent' && secretary.substrate.binary === 'claude') {
      const cwd = secretary.substrate.cwd;
      const result = warmAgentMod.prewarmAgent(secretary.id, 'claude', cwd, /* keep */ true);
      process.stderr.write(JSON.stringify({
        audit: 'secretary.prewarm_at_boot',
        staff_id: secretary.id,
        already_warm: result.alreadyWarm,
        warming: result.warming,
        ts: new Date().toISOString(),
      }) + '\n');
    } else {
      process.stderr.write(JSON.stringify({
        warn: 'secretary.prewarm_skipped',
        reason: 'secretary substrate is not a claude cli_agent',
        kind: secretary.substrate.kind,
        binary: secretary.substrate.kind === 'cli_agent' ? secretary.substrate.binary : undefined,
        ts: new Date().toISOString(),
      }) + '\n');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(JSON.stringify({
      warn: 'secretary.prewarm_at_boot_failed',
      msg,
      ts: new Date().toISOString(),
    }) + '\n');
  }

  // Default team room — idempotent get-or-create + member sync against current
  // staff list. Runs once at boot so the first mobile /api/v1/rooms/team request
  // always finds a populated room, even before any client fetch.
  try {
    const dynamicImport3 = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;
    const coreMod = await dynamicImport3<typeof import('@holon/core')>('@holon/core');
    const room = coreMod.getOrCreateDefaultTeamRoom();
    process.stderr.write(JSON.stringify({
      audit: 'default_team_room.boot_sync',
      room_id: room.id,
      name: room.name,
      ts: new Date().toISOString(),
    }) + '\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(JSON.stringify({
      warn: 'default_team_room.boot_sync_failed',
      msg,
      ts: new Date().toISOString(),
    }) + '\n');
  }

  // Dev-mode route prewarm — Next dev compiles each API route on first HTTP
  // hit (3-7s blocking). Mobile clients on cellular see this as "请求中" 永远
  // 转圈 after a network switch. Self-fetch high-traffic routes at boot so
  // first real request is warm. Prod has all routes pre-built; skip there.
  if (process.env.NODE_ENV !== 'production') {
    const port = process.env.PORT ?? '3110';
    const ROUTES = [
      '/api/v1/ping',
      '/api/v1/staff',
      '/api/v1/jobs',
      '/api/v1/usage',
      '/api/v1/rooms',
      '/api/v1/deliverables',
      '/api/v1/chat/history?thread=owner',
      '/api/v1/chat/warm',
      '/api/v1/references',
      '/api/v1/boss-memory',
      '/api/v1/team-packs',
    ];
    setTimeout(() => {
      void (async () => {
        for (const path of ROUTES) {
          const t0 = Date.now();
          try {
            await fetch(`http://127.0.0.1:${port}${path}`, { cache: 'no-store' });
          } catch { /* route may 4xx without auth; that's still compiled */ }
          process.stderr.write(JSON.stringify({
            audit: 'dev_prewarm.route',
            path,
            ms: Date.now() - t0,
          }) + '\n');
        }
      })();
    }, 1500);
  }

  // Auto-start edge-tts server on port 8770 if not already running. Mobile TTS
  // (Edge neural voices) depends on it; owner shouldn't have to manually start
  // the python venv every reboot. Idempotent: skip if port already listening.
  try {
    const dynamicImport4 = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;
    const net = await dynamicImport4<typeof import('node:net')>('node:net');
    const cp = await dynamicImport4<typeof import('node:child_process')>('node:child_process');
    const fs = await dynamicImport4<typeof import('node:fs')>('node:fs');
    const path = await dynamicImport4<typeof import('node:path')>('node:path');

    const isPortListening = (port: number): Promise<boolean> => new Promise((resolve) => {
      const sock = new net.Socket();
      sock.setTimeout(300);
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error', () => resolve(false));
      sock.once('timeout', () => { sock.destroy(); resolve(false); });
      sock.connect(8770, '127.0.0.1');
    });

    setTimeout(() => {
      void (async () => {
        if (await isPortListening(8770)) {
          process.stderr.write(JSON.stringify({ audit: 'tts.already_running', port: 8770 }) + '\n');
          return;
        }
        const repoRoot = process.env.HOLON_REPO_ROOT || '/home/chenz/project/myc-mobile';
        const venvPython = path.join(repoRoot, '.venv-tts', 'bin', 'python');
        const serverScript = path.join(repoRoot, 'scripts', 'cosyvoice-server.py');
        if (!fs.existsSync(venvPython) || !fs.existsSync(serverScript)) {
          process.stderr.write(JSON.stringify({ audit: 'tts.spawn_skipped', reason: 'venv or script missing', venvPython, serverScript }) + '\n');
          return;
        }
        const out = fs.openSync('/tmp/edge-tts.log', 'a');
        const child = cp.spawn(venvPython, [serverScript, '--host', '127.0.0.1', '--port', '8770'], {
          cwd: repoRoot, env: process.env,
          stdio: ['ignore', out, out], detached: true,
        });
        child.unref();
        process.stderr.write(JSON.stringify({ audit: 'tts.spawned', pid: child.pid, log: '/tmp/edge-tts.log' }) + '\n');
      })();
    }, 2500);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(JSON.stringify({ audit: 'tts.spawn_init_failed', error: msg }) + '\n');
  }

  // Robustness layer — boot the ProcessRegistry heartbeat ticker so every
  // warm secretary / tmux employee / spawned codex gets a 30s liveness check
  // + process-tree scan that discovers hidden sub-agents and registers them
  // for /api/v1/health.
  // Use the same dynamicImport pattern as the rest of this file (hidden
  // from webpack via `new Function`) so `node:` imports inside heartbeat /
  // tmux-discovery / @holon/core don't poison the webpack bundle pass.
  const dynamicImportRobust = new Function('s', 'return import(s)') as <T>(s: string) => Promise<T>;

  try {
    const { startHeartbeat } = await dynamicImportRobust<typeof import('./lib/heartbeat')>('./lib/heartbeat');
    startHeartbeat();
    process.stderr.write(JSON.stringify({ audit: 'heartbeat.started' }) + '\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(JSON.stringify({ audit: 'heartbeat.start_failed', error: msg }) + '\n');
  }

  // Boot sweep — register tmux cli_agent employees in the process registry
  // so /api/v1/health reflects them right after boot.
  try {
    const { discoverTmuxEmployees } = await dynamicImportRobust<typeof import('./lib/tmux-discovery')>('./lib/tmux-discovery');
    setTimeout(() => {
      try {
        const found = discoverTmuxEmployees();
        process.stderr.write(JSON.stringify({ audit: 'tmux.discovered', count: found.length, keys: found.map((e) => e.key) }) + '\n');
      } catch (err) {
        process.stderr.write(JSON.stringify({ audit: 'tmux.discover_failed', error: err instanceof Error ? err.message : String(err) }) + '\n');
      }
    }, 4000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(JSON.stringify({ audit: 'tmux.discover_import_failed', error: msg }) + '\n');
  }
}
