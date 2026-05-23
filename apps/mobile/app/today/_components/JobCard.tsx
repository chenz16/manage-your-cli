'use client';

import type { JobRow } from './types';

function statusMeta(s: JobRow['status']): { label: string; tone: string } {
  switch (s) {
    case 'queued':    return { label: '排队',   tone: 'queued' };
    case 'running':   return { label: '执行中', tone: 'running' };
    case 'completed': return { label: '已完成', tone: 'done' };
    case 'failed':    return { label: '失败',   tone: 'failed' };
  }
}

function formatAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return iso.slice(0, 10);
}

export function JobCard({ job, staffName }: { job: JobRow; staffName?: string | undefined }) {
  const meta = statusMeta(job.status);
  return (
    <div className="m-card m-job-card" data-job-id={job.id} data-status={job.status}>
      <div className="m-job-card-top">
        <span className={`m-job-status m-job-status-${meta.tone}`}>{meta.label}</span>
        <span className="m-job-time">{formatAgo(job.started_at ?? job.created_at)}</span>
      </div>
      <div className="m-card-body m-job-brief">{job.brief}</div>
      <div className="m-job-staff muted">{staffName ?? job.staff_id}</div>
    </div>
  );
}
