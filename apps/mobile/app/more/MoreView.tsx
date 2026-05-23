'use client';

// M-L-007 — /more is the mobile entry-point to every desk surface in
// read-only form (Principle 1: thin client). Replaces the standalone
// 我 tab; persona/budget become Section 1 of this page. The standalone
// /me route is preserved as the deep-link target.

import { useCallback, useEffect, useState } from 'react';
import { MoreSection } from './_components/MoreSection';
import { PullToRefresh } from '../_components/PullToRefresh';
import { deskApi } from '../_lib/desk-api';

// Mirrors of desk's BUILTIN_*_IDS sets (apps/web/app/{skills,templates,references}
// /_components/*Client.tsx). Kept in sync manually per CLAUDE.md guidance — the
// desk-side files are the source of truth.
const BUILTIN_SKILL_IDS = new Set<string>([
  'make_slides', 'make_spreadsheet', 'make_pdf', 'make_chart', 'web_build',
  'summarize_inbox', 'format_deliverable', 'generate_image', 'generate_video',
  'browse_web', 'run_code', 'feishu_doc', 'google_meet', 'kanban',
  'decompose_task', 'ambiguity_probe',
  'create_agent', 'update_agent', 'dismiss_agent',
  'create_skill', 'update_skill', 'delete_skill',
  'create_template', 'update_template', 'delete_template',
  'extract_references', 'create_reference', 'update_reference', 'delete_reference',
  'discord_post',
]);
const BUILTIN_TEMPLATE_IDS = new Set<string>([
  'weekly-status-update', 'investor-update-monthly', '1on1-agenda', 'offer-letter',
  'marketing-brief', 'sales-proposal', 'prd-feature', 'meeting-minutes',
]);
const BUILTIN_REFERENCE_IDS = new Set<string>([
  'wcag-2-2', 'iso-27001-2022', 'gdpr', 'pep-8', 'oauth-2-1', 'nist-csf-2-0',
]);

type IdItem = { id: string; name?: string };
type CountSplit = { yours: number; examples: number };

function split(items: IdItem[], builtIns: Set<string>): CountSplit {
  let examples = 0;
  for (const it of items) if (builtIns.has(it.id)) examples += 1;
  return { yours: items.length - examples, examples };
}

type Loaded = {
  meName: string | undefined;
  meRole: string | undefined;
  staffCount: number;
  staffNames: string[];
  skills: CountSplit;
  templates: CountSplit;
  references: CountSplit;
  connectionCount: number;
};

// M-L-070 — discriminated result so `load` can tell "desk unreachable / bad
// status" apart from "genuinely empty". Previously this swallowed every
// failure to `null`, making a down desk render authoritative zeros (LIE).
type FetchResult<T> = { ok: true; data: T } | { ok: false; status: number };

async function fetchJson<T>(url: string): Promise<FetchResult<T>> {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, data: (await r.json()) as T };
  } catch {
    // network/parse failure — status 0 marks "never reached the desk"
    return { ok: false, status: 0 };
  }
}

// M-L-070 — real state machine, mirroring TodayView/MeView. If ANY of the six
// reads fails, the whole page goes to `error` rather than rendering zeros.
type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; data: Loaded }
  | { status: 'error' };

export function MoreView() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  // M-L-043 — lifted into a useCallback so PullToRefresh can re-run it; the
  // catalog counts otherwise go stale and the pull-down gesture did nothing.
  const load = useCallback(async () => {
    const [me, staff, skills, templates, references, connections] = await Promise.all([
      fetchJson<{ owner_name?: string; name?: string; owner_role?: string }>(deskApi('/api/v1/me')),
      fetchJson<{ items: { id: string; name?: string }[] }>(deskApi('/api/v1/staff')),
      fetchJson<{ items: IdItem[] }>(deskApi('/api/v1/skills')),
      fetchJson<{ items: IdItem[] }>(deskApi('/api/v1/templates')),
      fetchJson<{ items: IdItem[] }>(deskApi('/api/v1/references')),
      fetchJson<{ items: unknown[] }>(deskApi('/api/v1/connections')),
    ]);
    // M-L-070 — any failed read means we can't trust the screen; show the
    // desk-unreachable card instead of authoritative zeros.
    if (!me.ok || !staff.ok || !skills.ok || !templates.ok || !references.ok || !connections.ok) {
      setState({ status: 'error' });
      return;
    }
    const staffItems = staff.data.items ?? [];
    setState({
      status: 'ok',
      data: {
        meName: me.data.owner_name?.trim() || me.data.name || undefined,
        meRole: me.data.owner_role,
        staffCount: staffItems.length,
        staffNames: staffItems.slice(0, 3).map((s) => s.name ?? s.id),
        skills: split(skills.data.items ?? [], BUILTIN_SKILL_IDS),
        templates: split(templates.data.items ?? [], BUILTIN_TEMPLATE_IDS),
        references: split(references.data.items ?? [], BUILTIN_REFERENCE_IDS),
        connectionCount: connections.data.items?.length ?? 0,
      },
    });
  }, []);

  useEffect(() => { void load(); }, [load]);

  // `s` is the loaded data when ok, else null — the existing render reads `s`
  // truthiness for the "…" placeholders, which now only show on first load.
  const s = state.status === 'ok' ? state.data : null;
  // M-L-011 — counts now render as a right-aligned mini-badge on the title
  // row (scannable summary, Notion/Linear pattern). Catalog sections use
  // "{yours}·{examples}"; single-axis sections use a plain integer.
  const badge = (c: CountSplit) => `${c.yours}·${c.examples}`;

  return (
    <PullToRefresh onRefresh={load}>
    <div className="mobile-shell">
      <header className="mobile-header">
        <div className="mobile-brand">更多</div>
        <div className="mobile-subtitle">read-only views · 在桌面端配置</div>
      </header>

      {state.status === 'error' ? (
        <section className="mobile-section">
          <div className="m-card">
            <p>无法连接桌面</p>
            <p className="muted">读取失败，未能加载团队 / 技能 / 模板等信息。这不代表它们为空——可能是桌面端未运行或网络中断。</p>
            <button type="button" className="m-btn" onClick={() => void load()}>重试</button>
          </div>
        </section>
      ) : (
      <section className="mobile-section">
        <MoreSection
          title="我的"
          summary={s?.meRole ?? 'persona + budget'}
          deskHref="/me"
        >
          <div className="m-card-body">{s?.meName ?? (s ? '未设置' : '…')}</div>
        </MoreSection>

        <MoreSection
          title="今日"
          summary="job board · 全屏 jobs-in-flight + deliverables 视图"
          mobileHref="/today"
        >
          <p className="m-empty-hint">M-L-017 后从 tab 移到此处 · 短列表已合并进工作台顶栏</p>
        </MoreSection>

        <MoreSection
          title="团队"
          summary="staff 名册 · 在 成员 tab 浏览 / 在桌面端 hire-dismiss"
          badge={s ? String(s.staffCount) : undefined}
          mobileHref="/staff"
        >
          {/* M-L-009 — work-tool empty: explain trigger + point at desk action.
              M-L-028 — primary CTA now to mobile /staff; desk hire link is a
              compact secondary line so users see the source-of-truth path. */}
          {s && s.staffCount === 0 ? (
            <p className="m-empty-hint">团队暂未组建 · 在桌面端 /skills 招第一位 staff</p>
          ) : (
            <div className="m-card-body muted">
              {s ? s.staffNames.join(' · ') : '…'}
            </div>
          )}
        </MoreSection>

        <MoreSection
          title="技能"
          summary="skills catalog · yours · examples"
          badge={s ? badge(s.skills) : undefined}
          deskHref="/skills"
        >
          {s && s.skills.yours + s.skills.examples === 0 && (
            <p className="m-empty-hint">技能库暂未配置 · 在桌面端 + 新建 或选用 examples</p>
          )}
        </MoreSection>

        <MoreSection
          title="模板"
          summary="templates catalog · yours · examples"
          badge={s ? badge(s.templates) : undefined}
          deskHref="/templates"
        >
          {s && s.templates.yours + s.templates.examples === 0 && (
            <p className="m-empty-hint">模板库暂未配置 · 在桌面端 + 新建 或选用 examples</p>
          )}
        </MoreSection>

        <MoreSection
          title="引用"
          summary="references catalog · yours · examples"
          badge={s ? badge(s.references) : undefined}
          deskHref="/references"
        >
          {s && s.references.yours + s.references.examples === 0 && (
            <p className="m-empty-hint">引用库暂未配置 · 在桌面端 + 新建 或选用 examples</p>
          )}
        </MoreSection>

        <MoreSection
          title="连接"
          summary="peer connections (V2) · cross-desk handoffs"
          badge={s ? String(s.connectionCount) : undefined}
          deskHref="/connections"
        >
          {s && s.connectionCount === 0 && (
            <p className="m-empty-hint">尚未建立跨桌面连接 · V2 解锁同伴协作</p>
          )}
        </MoreSection>

        <MoreSection
          title="设置"
          summary="主题 · 通知 · 重置 — 在桌面端配置"
          deskHref="/me"
          ctaLabel="在桌面端配置"
        />

        <MoreSection
          title="关于"
          summary="Holon — 一个台面 (desk)、几个员工、其余靠你"
          deskHref="mailto:chen.zhang6@gmail.com"
          ctaLabel="反馈给作者"
        >
          <div className="muted m-card-footnote">
            mobile-v1 · {new Date().getFullYear()} Holon
          </div>
        </MoreSection>
      </section>
      )}
    </div>
    </PullToRefresh>
  );
}
