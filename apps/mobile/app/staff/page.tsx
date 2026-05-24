'use client';

// M-L-017 · 成员 tab list (mibusy TeamClientView pattern). Two sections:
// 我的员工 (configured staff) + 内置专家 (default-collapsed). AgentCard
// with first-letter avatar + tone color + role label + status badge.
// Tap → /staff/detail?id=<id> read-only detail (M-L-036: was /staff/[id]
// dynamic route; converted to static query-param route to unblock
// Capacitor `output: 'export'` static build). Pure thin-client: reads desk's
// /api/v1/staff and renders. No mutations from mobile.

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { PullToRefresh } from '../_components/PullToRefresh';
import { ProjectSwitcherMobile } from '../_components/ProjectSwitcherMobile';
import { deskOrigin } from '../_lib/desk-origin';
import { fetchWithTimeout } from '../_lib/fetch-timeout';
import { useVisiblePoll } from '../_lib/useVisiblePoll';

const DESK_ORIGIN = deskOrigin();

interface Staff {
  id: string;
  name: string;
  role_name?: string;
  role_label?: string;
  status?: string;
  substrate?: { kind?: string };
  current_jobs?: number;
  max_concurrent_jobs?: number;
  project_ids?: string[]; // Phase 1
}

interface StaffApi { items: Staff[] }

// Mibusy TONE_MAP analogue — deterministic color from first character.
// Holon palette only: gold / ink-3 / muted variants of the desk paper.
const TONES = ['#C69A35', '#1A5E8A', '#2E7D52', '#B5892A', '#7A4F26', '#4A4A48'];
function toneFor(s: Staff): string {
  let h = 0;
  for (let i = 0; i < s.id.length; i++) h = (h * 31 + s.id.charCodeAt(i)) | 0;
  return TONES[Math.abs(h) % TONES.length] ?? '#1A1A18';
}

function isBuiltIn(s: Staff): boolean {
  // V1 heuristic: built-in staff have role_name = 'staff' AND substrate.kind
  // = 'local_ai'. User-recruited staff use distinct role_names or have a
  // configured agent_profile_id (refined later if desk exposes a flag).
  return s.role_name === 'staff' && s.substrate?.kind === 'local_ai';
}

export default function StaffPage() {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ok'; staff: Staff[] } | { status: 'error'; message: string }>({ status: 'loading' });
  // M-L-022: default-collapsed when user has hires of their own (built-ins
  // are reference material); default-expanded when 我的员工 == 0 so the
  // page isn't visually empty. Toggle still owned by the user after first
  // interaction.
  const [builtInOpen, setBuiltInOpen] = useState(false);
  const [autoExpanded, setAutoExpanded] = useState(false);
  // Phase 1 — project filter
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // M-L-026 — lift load out of useEffect so PullToRefresh can call it.
  const load = useCallback(async () => {
    try {
      const r = await fetchWithTimeout('/api/v1/staff');
      if (!r.ok) throw new Error(`GET /api/v1/staff → ${r.status}`);
      const body = await r.json() as StaffApi;
      setState({ status: 'ok', staff: body.items || [] });
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  // M-L-065 — roster changes maybe daily; pause polling when off-screen.
  useVisiblePoll(load, 6000);

  const allMine = state.status === 'ok' ? state.staff.filter((s) => !isBuiltIn(s)) : [];
  const allBuiltIn = state.status === 'ok' ? state.staff.filter((s) => isBuiltIn(s)) : [];
  // Phase 1: project filter — cross-project staff (project_ids=[]) always visible
  const filterByProject = (staff: Staff[]) => {
    if (!activeProjectId) return staff;
    return staff.filter(
      (s) => !s.project_ids?.length || s.project_ids.includes(activeProjectId),
    );
  };
  const mine = filterByProject(allMine);
  const builtIn = filterByProject(allBuiltIn);

  // M-L-022 auto-expand once: if user has 0 hires and built-ins exist,
  // open the built-in section so the page isn't visually empty on first
  // load. Only fires once — user toggle wins thereafter.
  useEffect(() => {
    if (autoExpanded) return;
    if (state.status !== 'ok') return;
    if (mine.length === 0 && builtIn.length > 0) {
      setBuiltInOpen(true);
      setAutoExpanded(true);
    }
  }, [state.status, mine.length, builtIn.length, autoExpanded]);

  const ChevIcon = builtInOpen ? ChevronDown : ChevronRight;

  return (
    <PullToRefresh onRefresh={load}>
    <div className="mobile-shell">
      <header className="mobile-header">
        <div className="mobile-brand">
          成员
          {/* Phase 1: project switcher — hidden when < 2 projects */}
          <ProjectSwitcherMobile
            activeProjectId={activeProjectId}
            onChange={setActiveProjectId}
            className="mobile-header-project"
          />
        </div>
        <div className="mobile-subtitle">桌面 staff · 点头像派活</div>
      </header>
      <section className="mobile-section">
        {state.status === 'loading' && (<div className="m-card"><p className="muted">加载 /api/v1/staff…</p></div>)}
        {state.status === 'error' && (
          <div className="m-card">
            <p>读取 staff 失败</p>
            <p className="muted">{state.message}</p>
          </div>
        )}
        {state.status === 'ok' && state.staff.length === 0 && (
          <div className="m-card m-empty-card">
            <div className="m-empty-title">还没招人</div>
            <p className="m-empty-hint">在桌面端 /skills 或 /templates 招募 staff，加好后这里会显示</p>
          </div>
        )}
        {state.status === 'ok' && mine.length > 0 && (
          <div className="s-section">
            <div className="s-section-title">我的员工 · {mine.length}</div>
            <div className="s-list">
              {mine.map((s) => (<StaffCard key={s.id} staff={s} tone={toneFor(s)} />))}
            </div>
          </div>
        )}
        {state.status === 'ok' && builtIn.length > 0 && (
          <div className="s-section">
            <button type="button" className="s-section-title s-section-toggle" onClick={() => setBuiltInOpen((v) => !v)} aria-expanded={builtInOpen}>
              <ChevIcon size={14} aria-hidden="true" strokeWidth={2} />
              <span>内置专家 · {builtIn.length}</span>
            </button>
            {builtInOpen && (
              <div className="s-list">
                {builtIn.map((s) => (<StaffCard key={s.id} staff={s} tone={toneFor(s)} />))}
              </div>
            )}
          </div>
        )}

        {/* M-L-022 — recruit hint when user hasn't hired any custom staff yet.
            Soft-points at the chat (in-app delegation) + desk-side /skills. */}
        {state.status === 'ok' && mine.length === 0 && (
          <div className="m-card s-recruit-hint">
            <div className="m-card-title">想招更多 staff?</div>
            <p className="m-empty-hint">
              在<a href="/chat/?prompt=%E6%88%91%E6%83%B3%E6%8B%9B%E4%B8%80%E4%B8%AA...&autosubmit=0" className="s-recruit-link">工作台</a>跟 AI 说 "我想招个 X" · 或在<a href={`${DESK_ORIGIN}/skills`} className="s-recruit-link" target="_blank" rel="noopener noreferrer">桌面端 /skills</a>配置
            </p>
          </div>
        )}
      </section>
    </div>
    </PullToRefresh>
  );
}

function StaffCard({ staff, tone }: { staff: Staff; tone: string }) {
  const letter = (staff.name?.[0] ?? '?').toUpperCase();
  const role = staff.role_label ?? staff.role_name ?? '';
  const online = staff.status === 'active';
  return (
    <a className="s-card" href={`/staff/detail/?id=${encodeURIComponent(staff.id)}`}>
      <span className="s-avatar" style={{ background: tone }}>
        <span className="s-avatar-letter">{letter}</span>
        {online && <span className="s-online-dot" aria-hidden="true" />}
      </span>
      <span className="s-meta">
        <span className="s-name">{staff.name}</span>
        <span className="s-role muted">{role}</span>
      </span>
      <span className="s-status muted">
        {staff.current_jobs ?? 0}/{staff.max_concurrent_jobs ?? '∞'}
      </span>
    </a>
  );
}
