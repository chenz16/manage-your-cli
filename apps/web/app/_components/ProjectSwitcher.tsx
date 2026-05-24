'use client';

/**
 * <ProjectSwitcher /> — Desk (English) variant.
 *
 * Phase 1 progressive disclosure rules:
 *   - `projects.length < 2` → renders null (zero chrome for single-stream boss).
 *   - `projects.length >= 2` → renders a header "pill" dropdown:
 *       [All ▾] or [<ProjectName> ▾]
 *     Options: each active (non-archived) project + "──" divider + "All"
 *
 * Usage:
 *   <ProjectSwitcher
 *     activeProjectId={selectedId}
 *     onChange={(id) => setSelectedId(id)}
 *   />
 *
 * The parent manages the `activeProjectId` state and uses it to filter the
 * list it renders. This component is pure display + user intent capture.
 *
 * Desk strings: English.
 */

import { useState, useRef, useEffect } from 'react';
import { useProjects } from '../../lib/hooks/useProjects';
import type { Project } from '@holon/api-contract';

export interface ProjectSwitcherProps {
  /** Currently selected project id, or null/"" for "All".
   *  When omitted the switcher reads/writes from the shared module-level
   *  selection (useProjects().activeProjectId) — the single source of truth
   *  that the chat adapter also reads. Pass explicitly only when you need a
   *  locally-controlled copy (e.g. a filtered list view).
   */
  activeProjectId?: string | null;
  /** Called when the user picks a project or "All". null = "All".
   *  When omitted the switcher writes to the shared selection automatically.
   */
  onChange?: (projectId: string | null) => void;
  /** Optional CSS class on the pill button. */
  className?: string;
}

export function ProjectSwitcher({ activeProjectId: externalId, onChange, className }: ProjectSwitcherProps) {
  const { projects, activeProjectId: sharedId, setActiveProjectId } = useProjects();
  // When no external controlled value is provided, use the shared module state.
  const activeProjectId = externalId !== undefined ? externalId : sharedId;
  const handleChange = onChange ?? setActiveProjectId;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Phase 1 rule: hidden when < 2 projects
  if (projects.length < 2) return null;

  const activeProjects = projects.filter((p) => !p.archived);
  const active: Project | undefined = activeProjectId
    ? projects.find((p) => p.id === activeProjectId)
    : undefined;

  const label = active ? active.name : 'All';

  const handleSelect = (id: string | null) => {
    handleChange(id);
    setOpen(false);
  };

  return (
    <div
      ref={ref}
      className={`project-switcher${className ? ` ${className}` : ''}`}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <button
        type="button"
        className="project-switcher-pill"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '2px 8px',
          borderRadius: '12px',
          fontSize: '0.8rem',
          fontWeight: 500,
          background: 'var(--ink-bg-2, #f0f0f0)',
          border: '1px solid var(--ink-border, #ddd)',
          cursor: 'pointer',
          color: 'var(--ink-text, #333)',
        }}
      >
        {active?.color && (
          <span
            style={{
              width: 8, height: 8, borderRadius: '50%',
              background: active.color, flexShrink: 0,
            }}
          />
        )}
        {label}
        <span aria-hidden="true" style={{ opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <DropdownMenu
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

function DropdownMenu({
  projects,
  activeId,
  onSelect,
  onClose,
  parentRef,
}: {
  projects: Project[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
  parentRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Close on outside click
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
        zIndex: 200,
        minWidth: 160,
        background: 'var(--ink-surface, #fff)',
        border: '1px solid var(--ink-border, #ddd)',
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
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
              padding: '6px 12px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: '0.875rem',
              fontWeight: activeId === p.id ? 600 : 400,
              color: 'var(--ink-text, #333)',
            }}
          >
            {activeId === p.id && <span aria-hidden="true">✓</span>}
            {p.color && (
              <span
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: p.color, flexShrink: 0,
                }}
              />
            )}
            {p.name}
          </button>
        </li>
      ))}
      <li role="separator" style={{ borderTop: '1px solid var(--ink-border, #eee)', margin: '4px 0' }} />
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
            padding: '6px 12px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            fontSize: '0.875rem',
            fontWeight: !activeId ? 600 : 400,
            color: 'var(--ink-text, #333)',
          }}
        >
          {!activeId && <span aria-hidden="true">✓</span>}
          All
        </button>
      </li>
    </ul>
  );
}
