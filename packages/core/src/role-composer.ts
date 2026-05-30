/**
 * role-composer — composition engine + persona renderer.
 *
 * Spec: `docs/adr/role-templates-and-persona-composition.md` §2 + §4.
 *
 * Composition rules (per ADR):
 *  - Identity, Voice / Tone:  NOMINAL role wins (one source of truth).
 *  - Responsibilities, Behaviors.do, Behaviors.dont, Knowledge:
 *      UNION across roles, de-duped via `stableRuleHash` (the SAME hash HR
 *      Path A uses for rule idempotence — see hr-path-a.ts). Sharing the
 *      hash is deliberate: HR's conflict-detection (ADR §5) compares its
 *      rule hash against composition bullets' hashes to spot overlap.
 *  - Do/Don't COLLISION: a `Do` bullet whose hash matches a `Don't` bullet
 *      from a different role is appended to `conflicts[]`. No auto-resolve
 *      (silent override is the worst debugging failure mode — ADR
 *      Alternatives §4).
 *
 * Transitivity (ADR §7): one-hop default. If nominal A has
 * `compose_with: [B]` and B has `compose_with: [C]`, calling
 * `composeRoles('A', ['A'])` resolves to merge A + B + C. The caller can
 * override by passing an explicit `actualIds` that excludes C — composition
 * uses exactly the IDs given (after augmenting with the nominal's own
 * 1-hop chain when no explicit overrides are passed).
 */
import { stableRuleHash } from './hr-path-a.js';
import { listRoleTemplates, loadRoleTemplate, type RoleTemplate } from './role-template-loader.js';

export interface ComposedPersona {
  nominal: string;
  actualIds: string[];
  identity: string;
  responsibilities: string[];
  behaviors: { do: string[]; dont: string[] };
  voice: string;
  knowledge: string[];
  conflicts: Array<{ rule: string; sources: string[] }>;
}

interface ResolvedRoles {
  nominal: RoleTemplate;
  ordered: RoleTemplate[];
}

function resolveRoles(nominalId: string, actualIds: string[], root: string | undefined): ResolvedRoles {
  const all = listRoleTemplates(root).reduce<Record<string, RoleTemplate>>((acc, t) => {
    acc[t.id] = t; return acc;
  }, {});
  // Make sure loader-by-id still works if listRoleTemplates missed it (e.g. custom root edge case).
  const get = (id: string): RoleTemplate | null => all[id] ?? loadRoleTemplate(id, root);

  const nominal = get(nominalId);
  if (!nominal) throw new Error(`role-composer: unknown nominal role "${nominalId}"`);

  // Build the merge order: nominal first, then explicit actualIds in order
  // (skipping the nominal duplicate). If the caller passed only the nominal,
  // expand via 1-hop transitive `compose_with` walk (ADR §7 default).
  const explicit = actualIds.filter((id) => id !== nominalId);
  let ids: string[];
  if (explicit.length === 0) {
    // Transitive walk: BFS, dedup by id, skip cycles. "One-hop" in the ADR
    // means we don't go beyond the natural compose_with chain — we still
    // follow each edge once. (A→B→C is fine; we cut cycles.)
    const seen = new Set<string>([nominalId]);
    const order: string[] = [];
    const queue: string[] = [...nominal.compose_with];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
      const t = get(id);
      if (!t) continue;
      for (const next of t.compose_with) if (!seen.has(next)) queue.push(next);
    }
    ids = order;
  } else {
    ids = explicit;
  }

  const ordered: RoleTemplate[] = [nominal];
  for (const id of ids) {
    const t = get(id);
    if (t) ordered.push(t);
    // Silently skip unknown ids — owner can pass strict-mode at a higher
    // layer if needed; the merger shouldn't blow up the create-agent flow.
  }
  return { nominal, ordered };
}

interface HashedBullet { hash: string; text: string; source: string }

function hashUnion(roles: RoleTemplate[], pick: (t: RoleTemplate) => string[]): HashedBullet[] {
  const seen = new Set<string>();
  const out: HashedBullet[] = [];
  for (const t of roles) {
    for (const text of pick(t)) {
      const trimmed = text.trim();
      if (!trimmed) continue;
      const hash = stableRuleHash(trimmed);
      if (seen.has(hash)) continue;
      seen.add(hash);
      out.push({ hash, text: trimmed, source: t.id });
    }
  }
  return out;
}

function uniqueByExact(roles: RoleTemplate[], pick: (t: RoleTemplate) => string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of roles) {
    for (const raw of pick(t)) {
      const text = raw.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
  }
  return out;
}

/**
 * Compose N roles into one persona.
 *
 * Pass `actualIds = []` (or just the nominal) to get the default 1-hop
 * transitive expansion. Pass an explicit list to pin the composition
 * (overrides default and skips transitivity).
 */
export function composeRoles(nominalId: string, actualIds: string[], root?: string): ComposedPersona {
  const { nominal, ordered } = resolveRoles(nominalId, actualIds, root);

  const respHashed = hashUnion(ordered, (t) => t.sections.responsibilities);
  const doHashed = hashUnion(ordered, (t) => t.sections.behaviors.do);
  const dontHashed = hashUnion(ordered, (t) => t.sections.behaviors.dont);

  // Collision detection: same hash appears as both Do and Don't (from any
  // roles — including the same role, which would be self-inconsistent).
  const conflicts: Array<{ rule: string; sources: string[] }> = [];
  const dontIndex = new Map(dontHashed.map((b) => [b.hash, b]));
  // Also need raw per-role sources for both sides — recompute roles per hash.
  const rolesPerHash = (pick: (t: RoleTemplate) => string[]): Map<string, Set<string>> => {
    const m = new Map<string, Set<string>>();
    for (const t of ordered) {
      for (const text of pick(t)) {
        const h = stableRuleHash(text.trim());
        if (!h) continue;
        if (!m.has(h)) m.set(h, new Set());
        m.get(h)!.add(t.id);
      }
    }
    return m;
  };
  const doSources = rolesPerHash((t) => t.sections.behaviors.do);
  const dontSources = rolesPerHash((t) => t.sections.behaviors.dont);
  for (const doBullet of doHashed) {
    const dontMatch = dontIndex.get(doBullet.hash);
    if (!dontMatch) continue;
    const sources = new Set<string>();
    for (const s of doSources.get(doBullet.hash) ?? []) sources.add(`${s}.do`);
    for (const s of dontSources.get(doBullet.hash) ?? []) sources.add(`${s}.dont`);
    conflicts.push({ rule: doBullet.text, sources: Array.from(sources).sort() });
  }

  return {
    nominal: nominal.id,
    actualIds: ordered.map((t) => t.id),
    identity: nominal.sections.identity,
    responsibilities: respHashed.map((b) => b.text),
    behaviors: {
      do: doHashed.map((b) => b.text),
      dont: dontHashed.map((b) => b.text),
    },
    voice: nominal.sections.voice,
    knowledge: uniqueByExact(ordered, (t) => t.sections.knowledge),
    conflicts,
  };
}

const ROLE_SECTION_HEADING = '## Role-Composition';
const ROLE_SECTION_SENTINEL =
  '<!-- managed by holon-create-agent — do not hand-edit above the owner-edits sentinel -->';
const OWNER_EDITS_SENTINEL = '<!-- owner-edits below -->';
const CONFLICTS_HEADING = '## Composition-conflicts';

/** Render the managed-section markdown block injected into a per-CLI memory file. */
export function renderPersona(p: ComposedPersona): string {
  const lines: string[] = [];
  lines.push(ROLE_SECTION_HEADING);
  lines.push(ROLE_SECTION_SENTINEL);
  lines.push('');
  lines.push('### Identity');
  lines.push(p.identity || '_(no identity set by nominal role)_');
  lines.push('');
  lines.push('### Responsibilities');
  if (p.responsibilities.length === 0) lines.push('_(none)_');
  else for (const r of p.responsibilities) lines.push(`- ${r}`);
  lines.push('');
  lines.push('### Behaviors');
  lines.push('');
  lines.push('**Do:**');
  if (p.behaviors.do.length === 0) lines.push('_(none)_');
  else for (const r of p.behaviors.do) lines.push(`- ${r}`);
  lines.push('');
  lines.push("**Don't:**");
  if (p.behaviors.dont.length === 0) lines.push('_(none)_');
  else for (const r of p.behaviors.dont) lines.push(`- ${r}`);
  lines.push('');
  lines.push('### Voice / Tone');
  lines.push(p.voice || '_(no voice set by nominal role)_');
  lines.push('');
  lines.push('### Knowledge anchors');
  if (p.knowledge.length === 0) lines.push('_(none)_');
  else for (const k of p.knowledge) lines.push(`- ${k}`);
  lines.push('');
  lines.push(`<!-- composition-conflicts: ${p.conflicts.length} -->`);
  lines.push(`<!-- composed-from: ${p.actualIds.join(', ')} -->`);
  lines.push(OWNER_EDITS_SENTINEL);

  if (p.conflicts.length > 0) {
    lines.push('');
    lines.push(CONFLICTS_HEADING);
    lines.push('<!-- managed by holon-create-agent; owner resolves manually -->');
    lines.push('');
    for (const c of p.conflicts) {
      lines.push(`- rule: "${c.rule}"`);
      lines.push(`  sources: ${c.sources.join(', ')}`);
      lines.push('  resolution: __TODO owner__');
    }
  }
  return lines.join('\n');
}

export const ROLE_COMPOSITION_HEADING = ROLE_SECTION_HEADING;
export const ROLE_COMPOSITION_SENTINEL = ROLE_SECTION_SENTINEL;
export const ROLE_COMPOSITION_OWNER_SENTINEL = OWNER_EDITS_SENTINEL;
export const ROLE_COMPOSITION_CONFLICTS_HEADING = CONFLICTS_HEADING;
