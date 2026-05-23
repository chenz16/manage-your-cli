'use client';

// M-L-036 · /staff/detail?id=<id> static read-only detail. Replaces the
// dynamic `/staff/[id]` route, which broke `output: 'export'` (Capacitor
// requires static export and refused dynamic segments without
// generateStaticParams). UI is unchanged from the M-L-017 [id] version
// (header + active-tasks strip + 派活 CTA jumping to /chat?staff=<name>);
// only the param plumbing differs — read `id` from useSearchParams() and
// wrap in <Suspense> per Next.js requirement for CSR bailout under static
// export. M-L-018 per-staff chat thread still deferred (needs desk contract).

import { Suspense, useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { PullToRefresh } from '../../_components/PullToRefresh';
import { fetchWithTimeout } from '../../_lib/fetch-timeout';
import { useVisiblePoll } from '../../_lib/useVisiblePoll';

interface Staff {
  id: string;
  name: string;
  role_name?: string;
  role_label?: string;
  status?: string;
  current_jobs?: number;
  max_concurrent_jobs?: number;
  substrate?: { kind?: string; agent_profile_id?: string; tool_scope?: string[] };
  autonomy_level?: string;
  governance_mode?: string;
}

interface JobRow {
  id: string;
  staff_id: string;
  brief: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  created_at: string;
  started_at?: string;
}

const TONES = ['#C69A35', '#1A5E8A', '#2E7D52', '#B5892A', '#7A4F26', '#4A4A48'];
function toneFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return TONES[Math.abs(h) % TONES.length] ?? '#1A1A18';
}

function StaffDetailInner() {
  const search = useSearchParams();
  const id = search?.get('id') ?? '';
  const [staff, setStaff] = useState<Staff | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  // M-L-073 — track jobs-fetch failure separately from staff-fetch failure so a
  // failed /api/v1/jobs read renders "任务读取失败" instead of an authoritative
  // "无在跑任务" that would falsely tell the owner this staffer is idle.
  const [jobsErr, setJobsErr] = useState(false);

  // M-L-026 — load lifted out so PullToRefresh can call it.
  const load = useCallback(async () => {
    if (!id) {
      setErr('missing ?id= query param');
      return;
    }
    try {
      const [sr, jr] = await Promise.all([
        fetchWithTimeout('/api/v1/staff'),
        fetchWithTimeout('/api/v1/jobs'),
      ]);
      if (!sr.ok) throw new Error(`GET /api/v1/staff → ${sr.status}`);
      const sb = await sr.json() as { items: Staff[] };
      const found = (sb.items || []).find((s) => s.id === id);
      if (!found) {
        setErr(`staff ${id} not found`);
        return;
      }
      setStaff(found);
      if (jr.ok) {
        const jb = await jr.json() as { items: JobRow[] };
        setJobs((jb.items || []).filter((j) => j.staff_id === id).slice(0, 5));
        setJobsErr(false);
      } else {
        setJobsErr(true);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  // M-L-065 — pause /api/v1/staff + /api/v1/jobs poll while off-screen.
  useVisiblePoll(load, 6000);

  if (err) {
    return (
      <div className="mobile-shell">
        <div className="s-detail-back-row"><a href="/staff/" className="m-back-link"><ChevronLeft size={16} /> 成员</a></div>
        <section className="mobile-section">
          <div className="m-card"><p>{err}</p></div>
        </section>
      </div>
    );
  }
  if (!staff) {
    return (
      <div className="mobile-shell">
        <div className="s-detail-back-row"><a href="/staff/" className="m-back-link"><ChevronLeft size={16} /> 成员</a></div>
        <section className="mobile-section"><div className="m-card"><p className="muted">加载中…</p></div></section>
      </div>
    );
  }

  const tone = toneFor(staff.id);
  const letter = (staff.name?.[0] ?? '?').toUpperCase();
  const online = staff.status === 'active';
  const activeJobs = jobs.filter((j) => j.status === 'running' || j.status === 'queued');

  return (
    <PullToRefresh onRefresh={load}>
    <div className="mobile-shell s-detail">
      <div className="s-detail-back-row">
        <a href="/staff/" className="m-back-link"><ChevronLeft size={16} /> 成员</a>
      </div>

      <header className="s-detail-header">
        <span className="s-avatar s-avatar-lg" style={{ background: tone }}>
          <span className="s-avatar-letter">{letter}</span>
          {online && <span className="s-online-dot" aria-hidden="true" />}
        </span>
        <div className="s-detail-meta">
          <div className="s-detail-name">{staff.name}</div>
          <div className="s-detail-role muted">{staff.role_label ?? staff.role_name}</div>
          <div className="s-detail-sub muted">
            {online ? '● 在线' : '○ 离线'} · {staff.current_jobs ?? 0}/{staff.max_concurrent_jobs ?? '∞'} jobs
          </div>
        </div>
      </header>

      <section className="mobile-section">
        <div className="s-section-title">活跃任务 · {jobsErr ? '?' : activeJobs.length}</div>
        {jobsErr ? (
          <div className="m-card m-empty-card">
            <p className="m-empty-hint">⚠️ 任务读取失败 · 无法确认是否在跑任务，下拉重试</p>
          </div>
        ) : activeJobs.length === 0 ? (
          <div className="m-card m-empty-card">
            <p className="m-empty-hint">无在跑任务 · 用下方按钮派一个新任务</p>
          </div>
        ) : (
          <ul className="s-task-strip">
            {activeJobs.map((j) => (
              <li key={j.id} className="s-task-card" data-status={j.status}>
                <div className="s-task-status">{j.status === 'running' ? '执行中' : '排队'}</div>
                <div className="s-task-brief">{j.brief}</div>
              </li>
            ))}
          </ul>
        )}

        <div className="s-section-title s-section-title-mt">基本信息</div>
        <div className="m-card s-info-card">
          <div className="s-kv"><span className="muted">substrate</span><span>{staff.substrate?.kind ?? '—'}</span></div>
          <div className="s-kv"><span className="muted">autonomy</span><span>{staff.autonomy_level ?? '—'}</span></div>
          <div className="s-kv"><span className="muted">governance</span><span>{staff.governance_mode ?? '—'}</span></div>
        </div>
      </section>

      <div className="s-detail-cta">
        <a className="m-btn-primary s-cta-btn" href={`/chat/?staff=${encodeURIComponent(staff.name)}`}>
          派活给 {staff.name} →
        </a>
      </div>
    </div>
    </PullToRefresh>
  );
}

export default function StaffDetailPage() {
  // useSearchParams() requires a Suspense boundary under `output: 'export'`
  // (CSR bailout per Next.js docs). The fallback mirrors the loading state
  // inside the inner component so the visual is consistent.
  return (
    <Suspense fallback={
      <div className="mobile-shell">
        <div className="s-detail-back-row"><a href="/staff/" className="m-back-link"><ChevronLeft size={16} /> 成员</a></div>
        <section className="mobile-section"><div className="m-card"><p className="muted">加载中…</p></div></section>
      </div>
    }>
      <StaffDetailInner />
    </Suspense>
  );
}
