'use client';

import { useState } from 'react';
import { useSecretaryProjects, type SecretaryProject } from '../../_components/useSecretaryProjects';

export function ProjectsClient() {
  const { projects, active, activeId, setActiveId, refresh, loading } = useSecretaryProjects();
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

  return (
    <div className="page projects-page">
      <header className="page-header">
        <h1>Projects</h1>
        <p className="page-subtitle">Each project has its own secretary and staff scope.</p>
      </header>

      <section className="projects-create">
        <input
          type="text"
          className="projects-create-input"
          placeholder="New project name…"
          value={newName}
          maxLength={50}
          onChange={(e) => { setNewName(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void onCreate(); }}
          disabled={creating}
        />
        <button
          type="button"
          className="projects-create-btn"
          onClick={onCreate}
          disabled={creating || newName.trim().length === 0}
        >
          {creating ? 'Creating…' : 'Create project'}
        </button>
        {error && <span className="projects-create-err">{error}</span>}
      </section>

      <section className="projects-list">
        {loading ? (
          <div className="projects-empty">Loading…</div>
        ) : projects.length === 0 ? (
          <div className="projects-empty">No projects yet. Create one above.</div>
        ) : (
          projects.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              isActive={activeId === p.id}
              isOnlyOne={projects.length === 1}
              onSelect={() => setActiveId(p.id)}
              onAfterChange={() => void refresh()}
            />
          ))
        )}
      </section>

      {active && (
        <footer className="projects-foot">
          Active: <strong>{active.name}</strong>
          {' · '}
          Secretary: {active.secretary_staff?.name ?? active.secretary_staff_id}
        </footer>
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
    <div className={`projects-row${isActive ? ' is-active' : ''}`}>
      <button
        type="button"
        className="projects-row-mark"
        aria-label={isActive ? 'Active project' : 'Switch to this project'}
        onClick={onSelect}
        disabled={busy}
      >
        {isActive ? '●' : '○'}
      </button>
      <div className="projects-row-body" onClick={editing ? undefined : onSelect}>
        {editing ? (
          <input
            type="text"
            className="projects-row-input"
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
          <div className="projects-row-name">{project.name}</div>
        )}
        <div className="projects-row-sub">
          秘书: {project.secretary_staff?.name ?? project.secretary_staff_id}
        </div>
      </div>
      <div className="projects-row-actions">
        <button
          type="button"
          className="projects-row-btn"
          onClick={() => setEditing(true)}
          disabled={busy || editing}
        >
          Rename
        </button>
        <button
          type="button"
          className="projects-row-btn is-danger"
          onClick={() => void onDelete()}
          disabled={busy || isOnlyOne}
          title={isOnlyOne ? 'Keep at least one project' : ''}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
