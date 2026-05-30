/**
 * SecretaryProjectSwitcher — single desk affordance for everything project-
 * related. Owner request: "Chat 直接变成 project" (mirror mobile's chat
 * surface where the ⋯ menu is also where project CRUD lives).
 *
 *   - Closed: a chip-shaped button showing the active project name.
 *   - Open: a dropdown listing every project. Each row has a click target
 *     for "switch to this" plus inline ✏️ rename and 🗑 delete buttons.
 *     A "New project…" inline form sits at the bottom.
 *
 * Mouse-friendly (no swipes, no long-press) — desk ergonomics; mobile's
 * carousel + ⋯ sheet is the equivalent for touch.
 */

'use client';

import { useState } from 'react';
import { useSecretaryProjects, type SecretaryProject } from './useSecretaryProjects';

export function SecretaryProjectSwitcher() {
  const { projects, active, setActiveId, refresh } = useSecretaryProjects();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true); setError(null);
    try {
      const res = await fetch('/api/v1/secretary-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error ?? `${res.status}`);
      }
      const j = await res.json() as { id?: string };
      setNewName('');
      await refresh();
      if (j.id) setActiveId(j.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  if (projects.length === 0 && !open) {
    // Nothing yet → render a quiet "+ New project" button so the owner has
    // an obvious first action.
    return (
      <button
        type="button"
        className="desk-proj-switcher-btn"
        onClick={() => setOpen(true)}
      >
        + New project
      </button>
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
        <span>{active?.name ?? 'Select project'}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M0 0l5 6 5-6z" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <>
          <div className="desk-proj-switcher-backdrop" onClick={() => setOpen(false)} />
          <div className="desk-proj-switcher-menu" role="listbox">
            {projects.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                isActive={active?.id === p.id}
                isOnlyOne={projects.length === 1}
                onSelect={() => { setActiveId(p.id); setOpen(false); }}
                onAfterChange={() => void refresh()}
              />
            ))}
            <div className="desk-proj-switcher-divider" />
            <div className="desk-proj-switcher-newrow">
              <input
                type="text"
                className="desk-proj-switcher-newinput"
                placeholder="New project name…"
                value={newName}
                maxLength={50}
                onChange={(e) => { setNewName(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') void onCreate(); }}
                disabled={creating}
              />
              <button
                type="button"
                className="desk-proj-switcher-newbtn"
                onClick={onCreate}
                disabled={creating || newName.trim().length === 0}
              >
                {creating ? '…' : 'Add'}
              </button>
            </div>
            {error && <div className="desk-proj-switcher-err">{error}</div>}
          </div>
        </>
      )}
    </div>
  );
}

function ProjectRow({
  project,
  isActive,
  isOnlyOne,
  onSelect,
  onAfterChange,
}: {
  project: SecretaryProject;
  isActive: boolean;
  isOnlyOne: boolean;
  onSelect: () => void;
  onAfterChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);

  const commitRename = async () => {
    const v = name.trim();
    if (!v || v === project.name) { setEditing(false); setName(project.name); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/secretary-projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: v }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      onAfterChange();
    } catch { setName(project.name); }
    finally { setBusy(false); setEditing(false); }
  };

  const onDelete = async () => {
    if (isOnlyOne) return;
    if (!confirm(`Delete project "${project.name}"?\nThe project's secretary and chat will be removed.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/secretary-projects/${project.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`${res.status}`);
      onAfterChange();
    } finally { setBusy(false); }
  };

  return (
    <div
      className={`desk-proj-switcher-item${isActive ? ' is-active' : ''}`}
      role="option"
      aria-selected={isActive}
    >
      <span className="desk-proj-switcher-mark">{isActive ? '●' : '○'}</span>
      <div
        className="desk-proj-switcher-name-wrap"
        onClick={editing ? undefined : onSelect}
      >
        {editing ? (
          <input
            type="text"
            className="desk-proj-switcher-renameinput"
            value={name}
            maxLength={50}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
              if (e.key === 'Escape') { setName(project.name); setEditing(false); }
            }}
          />
        ) : (
          <span className="desk-proj-switcher-name">{project.name}</span>
        )}
      </div>
      <div className="desk-proj-switcher-rowactions">
        <button
          type="button"
          className="desk-proj-switcher-rowbtn"
          title="Rename"
          onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          disabled={busy || editing}
          aria-label="Rename"
        >
          ✏️
        </button>
        <button
          type="button"
          className="desk-proj-switcher-rowbtn is-danger"
          title={isOnlyOne ? 'Keep at least one project' : 'Delete'}
          onClick={(e) => { e.stopPropagation(); void onDelete(); }}
          disabled={busy || isOnlyOne}
          aria-label="Delete"
        >
          🗑
        </button>
      </div>
    </div>
  );
}
