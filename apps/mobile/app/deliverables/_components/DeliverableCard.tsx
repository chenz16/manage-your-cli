'use client';

import type { Deliverable } from '@holon/api-contract';
import { ORIGIN_ICON, STATUS_LABEL } from '../DeliverablesView';

function excerpt(d: Deliverable): string {
  const raw =
    d.body && typeof d.body === 'object' && 'markdown' in d.body
      ? (d.body as { markdown: string }).markdown
      : '';
  const first = raw.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  return first.length > 100 ? first.slice(0, 97) + '…' : first;
}

export function DeliverableCard({
  d,
  onOpen,
}: {
  d: Deliverable;
  onOpen: (id: string) => void;
}) {
  const ts = d.created_at ? d.created_at.slice(0, 10) : '';
  const ex = excerpt(d);
  return (
    <button
      type="button"
      className="m-card m-deliv-card"
      data-deliv-id={d.id}
      data-origin={d.origin_label}
      onClick={() => onOpen(d.id)}
    >
      <div className="m-deliv-top">
        <span className={`m-deliv-status m-deliv-status-${d.status}`}>{STATUS_LABEL[d.status]}</span>
        <span className="m-deliv-origin" title={d.origin_label}>{ORIGIN_ICON[d.origin_label]}</span>
        <span className="m-deliv-kind">{d.body_kind}</span>
        <span className="m-deliv-grow" />
        {ts && <span className="m-deliv-ts">{ts}</span>}
      </div>
      <div className="m-card-title m-deliv-title">{d.title}</div>
      {ex && <div className="m-deliv-excerpt">{ex}</div>}
    </button>
  );
}
