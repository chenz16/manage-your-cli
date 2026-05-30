/**
 * SecretaryProjectSwitcher — desk-side counterpart to mobile's ⋯ menu
 * "切换项目" section. Renders in the chat topbar:
 *
 *   - 0 projects → invisible (legacy single-secretary mode)
 *   - 1 project  → a non-interactive chip showing the project name
 *   - 2+ projects → click → dropdown listing projects (✓ on active)
 *
 * Selection writes through useSecretaryProjects → localStorage → reloads
 * the ChatRuntimeProvider via its activeId key.
 */

'use client';

import { useState } from 'react';
import { useSecretaryProjects } from './useSecretaryProjects';

export function SecretaryProjectSwitcher() {
  const { projects, active, setActiveId } = useSecretaryProjects();
  const [open, setOpen] = useState(false);

  if (projects.length === 0) return null;
  if (projects.length === 1) {
    return (
      <span className="desk-proj-chip" title={active?.name}>
        {active?.name ?? projects[0]!.name}
      </span>
    );
  }

  return (
    <div className="desk-proj-switcher">
      <button
        type="button"
        className="desk-proj-switcher-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{active?.name ?? '选择项目'}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M0 0l5 6 5-6z" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <>
          <div className="desk-proj-switcher-backdrop" onClick={() => setOpen(false)} />
          <ul className="desk-proj-switcher-menu" role="listbox">
            {projects.map((p) => {
              const isActive = active?.id === p.id;
              return (
                <li
                  key={p.id}
                  className={`desk-proj-switcher-item${isActive ? ' is-active' : ''}`}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => { setActiveId(p.id); setOpen(false); }}
                >
                  <span className="desk-proj-switcher-mark">{isActive ? '●' : '○'}</span>
                  <span className="desk-proj-switcher-name">{p.name}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
