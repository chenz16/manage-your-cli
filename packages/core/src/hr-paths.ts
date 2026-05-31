/**
 * hr-paths — filesystem layout for the owner-HR agent.
 *
 * Spec: docs/adr/hr-evaluator-and-behavior-correction.md §4.1 / §4.6 / §4.7.
 * The owner-HR agent lives at `~/holon-agents/boss/owner/hr/`. Tests must
 * NEVER touch the real owner HOME; they override via `HOLON_HR_ROOT`.
 *
 * This module is path math + scaffold creation only. The scoring rubric +
 * Path A / Path B writers live in sibling modules (hr-path-a, hr-promotion)
 * and in `apps/web/lib/hr-path-b-producer.ts`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (id: string) => any;
const { existsSync, mkdirSync, writeFileSync } = nodeRequire('fs') as typeof import('fs');
const { homedir } = nodeRequire('os') as typeof import('os');
const { join } = nodeRequire('path') as typeof import('path');

/** Root of the owner-HR agent's on-disk presence. Env override is the only
 *  knob — tests set HOLON_HR_ROOT to a tmpdir; production lets it default. */
export function ownerHrRoot(): string {
  return process.env.HOLON_HR_ROOT
    ?? join(process.env.HOME ?? homedir(), 'holon-agents', 'boss', 'owner', 'hr');
}

/** Owner-global System 2 boss-memory root. Holds vetoes + INDEX/MEMORY.
 *  Env-aware via HOLON_AGENTS_HOME (state-isolation work); falls back to
 *  ~/holon-agents. NOTE: deliberately NOT HOLON_HR_ROOT-scoped — vetoes
 *  survive HR re-scaffold (ADR §4.9). */
function ownerSystem2Root(): string {
  const home = process.env.HOLON_AGENTS_HOME?.trim()
    || join(process.env.HOME ?? homedir(), 'holon-agents');
  return join(home, 'boss', 'owner');
}

/** Per-secretary-project evaluation log. One markdown file per day so a
 *  cron sweep is append-only inside a day and rotation is by-file. */
export function hrEvaluationLogPath(sprojId: string, date: string): string {
  return join(ownerHrRoot(), 'evaluations', sprojId, `${date}.md`);
}

/** Promotion-veto list. Owner-edited (or HR-edited after owner revert).
 *  Format documented in the module-level test fixture: a JSON file with
 *  `{ vetoes: [{ ruleHash, ruleText, vetoedAt }] }`.
 *
 *  Resolved (ADR §4.9, 2026-05-30): lives under owner System 2 root, NOT
 *  ownerHrRoot(), so vetoes survive HR re-scaffold. One-shot legacy
 *  migration in `migrateLegacyVetoesIfNeeded()`. */
export function hrVetoPath(): string {
  return join(ownerSystem2Root(), 'hr-promotion-vetoes.json');
}

/** Legacy (pre-§4.9) veto path. Kept exported for one-shot migration only;
 *  do NOT read at runtime — readers always go through `hrVetoPath()`. */
export function legacyHrVetoPath(): string {
  return join(ownerHrRoot(), 'promotion-vetoes.json');
}

/** Promotion log (append-only). One 🔴 line per auto-promotion. Owner reads
 *  this to accept / edit / revert. */
export function hrPromotionLogPath(): string {
  return join(ownerHrRoot(), 'promotions.log');
}

/** Per-(target × rule) counter store for Path B → A promotion threshold. */
export function hrStateFilePath(): string {
  return process.env.HOLON_HR_STATE
    ?? join(process.env.HOME ?? homedir(), '.holon', 'hr-state.json');
}

const PERSONA_MD = `# owner-HR — persona

You are the **HR evaluator** for the owner's secretaries. Read warm-agent
logs and tmux history, score each completed turn against the rubric below,
emit Path A patches (persistent memory edits) and Path B nudges (next-turn
synthetic messages). **Never dispatch work, never write code.** Pure
observe-score-correct.

Scope: secretaries across all projects. Cross-project drift is your signal —
the same mistake in N projects is an owner-level rule.

## Rubric (markdown checklist — §4.7)

Each scored turn gets a row:

\`\`\`markdown
## YYYY-MM-DD secretary=<sproj_id>
- [ ] dispatched-not-DIY     — heavy work went to a sub-agent
- [ ] respected-north-star   — no RAG/vector/abstraction proposals
- [ ] read-INDEX-before-act  — wrote memory without reading INDEX.md
- [ ] role-fidelity          — manager persona maintained
- [ ] memory-hygiene         — boss-memory diff is clean and INDEX'd
\`\`\`

Unchecked items are drift signals. Each unchecked item maps to a normalized
rule hash; ≥3 fires in 24h triggers Path-B → Path-A auto-promotion (§4.4).

## What you do NOT do

- Do not write code. Do not run shell commands.
- Do not dispatch work to other agents.
- Do not interrupt a running turn — Path B nudges land on the NEXT inbound.
- Do not evaluate the owner. Owner is terminal (System 2).
`;

/** Idempotent: writes only if absent. Same semantics as
 *  `writeFileIfAbsent` in cli-memory-scaffold — never clobber owner edits. */
function writeFileIfAbsent(path: string, content: string): void {
  if (existsSync(path)) return;
  try {
    writeFileSync(path, content, { flag: 'wx' });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'EEXIST') return;
    console.warn(`[hr-paths] write ${path} failed:`, err instanceof Error ? err.message : String(err));
  }
}

/** Create the owner-HR scaffold (idempotent). Called from boot
 *  (`apps/web/instrumentation.ts`) alongside `startHeartbeat()`. */
export function ensureOwnerHrScaffold(): { root: string; created: boolean } {
  const root = ownerHrRoot();
  const evalDir = join(root, 'evaluations');
  let created = false;
  if (!existsSync(root)) { mkdirSync(root, { recursive: true }); created = true; }
  if (!existsSync(evalDir)) mkdirSync(evalDir, { recursive: true });
  const personaPath = join(root, 'CLAUDE.md');
  if (!existsSync(personaPath)) { writeFileIfAbsent(personaPath, PERSONA_MD); created = true; }
  return { root, created };
}
