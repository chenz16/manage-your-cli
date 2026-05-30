'use client';

/**
 * ProjectsSection — Phase 1 create-project UI entry point on the /me page.
 *
 * Shows a simple "Create Project" form. Hidden when no desk is configured.
 * The project list is also shown so the boss can see + archive projects.
 *
 * Desk strings: English. No new deps.
 */

import { useState, useEffect } from 'react';
import { invalidateProjects } from '../../../lib/hooks/useProjects';

interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  color?: string;
  archived: boolean;
  created_at: string;
}

export function ProjectsSection() {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/v1/projects?include_archived=true', { cache: 'no-store' });
      if (!r.ok) throw new Error(`GET /api/v1/projects → ${r.status}`);
      const j = (await r.json()) as { items: ProjectItem[] };
      setProjects(j.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) {
        const j = (await r.json()) as { error?: string };
        throw new Error(j.error ?? `${r.status}`);
      }
      setNewName('');
      await load();
      invalidateProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleArchive(id: string, archived: boolean) {
    setError(null);
    try {
      const r = await fetch(`/api/v1/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      });
      if (!r.ok) {
        const j = (await r.json()) as { error?: string };
        throw new Error(j.error ?? `${r.status}`);
      }
      await load();
      invalidateProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return;
    setError(null);
    try {
      const r = await fetch(`/api/v1/projects/${id}`, { method: 'DELETE' });
      if (!r.ok) {
        const j = (await r.json()) as { error?: string };
        throw new Error(j.error ?? `${r.status}`);
      }
      await load();
      invalidateProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="card" style={{ padding: 20 }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>Projects</h2>
      <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: -4, marginBottom: 12 }}>
        Create projects to organize your todos, deliverables, and staff. A project switcher appears on Drops and Team pages when you have 2+ active projects.
      </p>

      {error && (
        <div style={{ color: 'var(--red, #c0392b)', fontSize: 12, marginBottom: 8 }}>{error}</div>
      )}

      {/* Create form */}
      <form onSubmit={(e) => void handleCreate(e)} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Project name…"
          disabled={creating}
          style={{
            flex: 1,
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid var(--ink-border, #ddd)',
            fontSize: 14,
            background: 'var(--ink-bg, #fff)',
            color: 'var(--ink-text, #333)',
          }}
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="btn btn-primary"
          style={{ fontSize: 12, padding: '6px 12px', whiteSpace: 'nowrap' }}
        >
          {creating ? 'Creating…' : '+ New project'}
        </button>
      </form>

      {/* Project list */}
      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Loading…</div>
      ) : projects.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>No projects yet. Create one above.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {projects.map((p) => (
            <div
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 6,
                background: p.archived ? 'var(--ink-bg-2, #f5f5f5)' : 'var(--ink-bg, #fff)',
                border: '1px solid var(--ink-border, #eee)',
                opacity: p.archived ? 0.6 : 1,
              }}
            >
              <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>
                {p.name}
                <span style={{ fontSize: 11, color: 'var(--ink-mute)', marginLeft: 6, fontWeight: 400 }}>
                  /{p.slug}
                </span>
                {p.archived && (
                  <span style={{ fontSize: 11, color: 'var(--ink-mute)', marginLeft: 4 }}>· archived</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => void handleArchive(p.id, !p.archived)}
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--ink-border, #ddd)',
                  background: 'none',
                  cursor: 'pointer',
                  color: 'var(--ink-mute)',
                }}
              >
                {p.archived ? 'Unarchive' : 'Archive'}
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(p.id, p.name)}
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--ink-border, #ddd)',
                  background: 'none',
                  cursor: 'pointer',
                  color: 'var(--red, #c0392b)',
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
