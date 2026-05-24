'use client';

/**
 * <ProjectSwitcherMobile /> — Mobile (微作/Chinese) variant.
 *
 * Phase 1 progressive disclosure rules (same as desk variant):
 *   - `projects.length < 2` → renders null (zero chrome for single-stream boss).
 *   - `projects.length >= 2` → renders a header "pill" dropdown:
 *       [全部 ▾] or [<项目名> ▾]
 *     Options: each active project + "──" divider + "全部"
 *
 * SSR/static-export safe: no `window` at module load, no Capacitor imports.
 * The useEffect in fetchProjects fires only in the browser.
 *
 * Mobile strings: Chinese (all labels 中文).
 */

import { useState, useRef, useEffect } from 'react';
import { deskApi } from '../_lib/desk-api';

interface ProjectItem {
  id: string;
  name: string;
  color?: string;
  archived: boolean;
  slug: string;
  desk_id: string;
  created_at: string;
}

export interface ProjectSwitcherMobileProps {
  /** Currently selected project id, or null for "全部". */
  activeProjectId: string | null;
  /** Called when the user picks a project or "全部". null = "全部". */
  onChange: (projectId: string | null) => void;
  /** Optional CSS class on the wrapper. */
  className?: string;
}

export function ProjectSwitcherMobile({
  activeProjectId,
  onChange,
  className,
}: ProjectSwitcherMobileProps) {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fetch project list on mount — SSR-safe (useEffect only runs in browser)
  useEffect(() => {
    let cancelled = false;
    fetch(deskApi('/api/v1/projects'), { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) return;
        const data = (await r.json()) as { items: ProjectItem[] };
        if (!cancelled) setProjects(data.items ?? []);
      })
      .catch(() => { /* fail silently — progressive enhancement */ });
    return () => { cancelled = true; };
  }, []);

  // Phase 1 rule: hidden when < 2 projects
  if (projects.length < 2) return null;

  const activeProjects = projects.filter((p) => !p.archived);
  const active = activeProjectId ? projects.find((p) => p.id === activeProjectId) : undefined;
  const label = active ? active.name : '全部';

  const handleSelect = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div
      ref={ref}
      className={`project-switcher-m${className ? ` ${className}` : ''}`}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <button
        type="button"
        className="project-switcher-m-pill"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 8px',
          borderRadius: 12,
          fontSize: '0.8rem',
          fontWeight: 500,
          background: 'rgba(255,255,255,0.15)',
          border: '1px solid rgba(255,255,255,0.3)',
          cursor: 'pointer',
          color: 'inherit',
        }}
      >
        {active?.color && (
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: active.color, flexShrink: 0 }} />
        )}
        {label}
        <span aria-hidden="true" style={{ opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <MobileDropdown
          projects={activeProjects}
          activeId={activeProjectId}
          onSelect={handleSelect}
          onClose={() => setOpen(false)}
          parentRef={ref}
        />
      )}
    </div>
  );
}

function MobileDropdown({
  projects,
  activeId,
  onSelect,
  onClose,
  parentRef,
}: {
  projects: ProjectItem[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
  parentRef: React.RefObject<HTMLDivElement | null>;
}) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (parentRef.current && !parentRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, parentRef]);

  return (
    <ul
      role="listbox"
      style={{
        position: 'absolute',
        top: 'calc(100% + 4px)',
        left: 0,
        zIndex: 300,
        minWidth: 140,
        background: '#1a1a2e',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 10,
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        listStyle: 'none',
        margin: 0,
        padding: '4px 0',
      }}
    >
      {projects.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            role="option"
            aria-selected={activeId === p.id}
            onClick={() => onSelect(p.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '7px 12px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: '0.875rem',
              fontWeight: activeId === p.id ? 600 : 400,
              color: 'rgba(255,255,255,0.9)',
            }}
          >
            {activeId === p.id && <span aria-hidden="true" style={{ fontSize: 10 }}>✓</span>}
            {p.color && (
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
            )}
            {p.name}
          </button>
        </li>
      ))}
      <li role="separator" style={{ borderTop: '1px solid rgba(255,255,255,0.12)', margin: '4px 0' }} />
      <li>
        <button
          type="button"
          role="option"
          aria-selected={!activeId}
          onClick={() => onSelect(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '7px 12px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            fontSize: '0.875rem',
            fontWeight: !activeId ? 600 : 400,
            color: 'rgba(255,255,255,0.9)',
          }}
        >
          {!activeId && <span aria-hidden="true" style={{ fontSize: 10 }}>✓</span>}
          全部
        </button>
      </li>
    </ul>
  );
}
