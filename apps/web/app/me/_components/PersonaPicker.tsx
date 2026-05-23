'use client';

import { useEffect, useRef, useState } from 'react';
import type { PersonaPreset } from '@holon/core';
import { useT } from '../../../lib/i18n/useT';

/**
 * PersonaPicker — top-of-/me dropdown to switch the owner-role bundle.
 *
 * Per user 2026-05-17:
 *   "我们预置一些人设 不同角色的典型的工作流 user 可以直接饮用 然后
 *    在这基础上修改"
 *   "用户说自己的事情 不用说那么多的话 就是预置"
 *
 * Flow:
 *   1. Owner clicks the dropdown, sees 8 presets with icon + tagline.
 *   2. Picks one — modal confirms ("will overwrite owner_role + intro
 *      + system_prompt + tool_scope; everything else preserved").
 *   3. POST /api/v1/me/apply-persona — fixture+overrides update.
 *   4. /me re-fetches; owner refines via inline-edit + ✨ Polish.
 */

interface PersonaPickerProps {
  currentRole: string;
  onApplied: () => void;
}

export function PersonaPicker({ currentRole, onApplied }: PersonaPickerProps) {
  const { lang } = useT();
  const zh = lang === 'zh-CN';
  const [personas, setPersonas] = useState<PersonaPreset[]>([]);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<PersonaPreset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Visual-only flag: after the owner picks "Custom · write your own",
   * the trigger button shows "Custom · write your own" so the selection
   * is acknowledged. Cleared when an actual preset is applied or when
   * the underlying owner_role changes (e.g. via inline-edit below). */
  const [customSelected, setCustomSelected] = useState(false);
  /* L-053 — one-line confirmation surfaced after a persona-switch
   * archives the prior team. Auto-dismisses after ~6s. */
  const [toast, setToast] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const lastRoleRef = useRef(currentRole);

  useEffect(() => {
    fetch('/api/v1/personas')
      .then((r) => {
        if (!r.ok) throw new Error(`GET /api/v1/personas ${r.status}`);
        return r.json();
      })
      .then((j: { items: PersonaPreset[] }) => setPersonas(j.items ?? []))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) { if (ev.key === 'Escape') { setOpen(false); setConfirming(null); } }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* Outside-click closes the dropdown — user reported clicking outside
   * (or X) didn't dismiss it. Only the menu is dismissed this way; the
   * confirm modal has its own backdrop + Cancel button. */
  useEffect(() => {
    if (!open || confirming) return;
    function onDown(ev: MouseEvent) {
      const target = ev.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, confirming]);

  /* Clear the customSelected hint when currentRole actually changes
   * (preset applied, or inline-edit landed) so the trigger reverts to
   * showing the real role. */
  useEffect(() => {
    if (currentRole !== lastRoleRef.current) {
      setCustomSelected(false);
      lastRoleRef.current = currentRole;
    }
  }, [currentRole]);

  async function apply(p: PersonaPreset): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/v1/me/apply-persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona_id: p.id }),
      });
      if (!r.ok) {
        const j = await r.json().catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
        setError(j.error ?? `HTTP ${r.status}`);
        return;
      }
      const j = await r.json().catch(() => ({} as {
        replaced_persona?: { id: string; name: string } | null;
        archived_staff_count?: number;
      }));
      if (j.replaced_persona && (j.archived_staff_count ?? 0) > 0) {
        setToast(
          zh
            ? `已用 ${p.name} 的初始团队替换你之前的 ${j.replaced_persona.name} 初始团队，已归档 ${j.archived_staff_count} 名旧员工。`
            : `Replaced your ${j.replaced_persona.name} starter team with ${p.name}'s — ${j.archived_staff_count} prior starter staff archived.`,
        );
        setTimeout(() => setToast(null), 6000);
      }
      setConfirming(null);
      setOpen(false);
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const triggerLabel = customSelected
    ? (zh ? '自定义' : 'Custom · write your own')
    : (currentRole || (zh ? '未设置' : '(none)'));

  return (
    <>
      {toast && (
        <div role="status" className="persona-toast" style={{
          position: 'fixed', top: 16, right: 16, zIndex: 1000,
          maxWidth: 420, padding: '10px 14px', borderRadius: 8,
          background: 'var(--bg-alt, #fff)', border: '1px solid var(--line, #ddd)',
          fontSize: 12, lineHeight: 1.5, color: 'var(--ink)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        }}>
          {toast}
        </div>
      )}
      <button
        ref={buttonRef}
        type="button"
        className="persona-picker-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={zh ? '切换你的角色预设（这是你的角色，不是 AI 的人设）' : 'Switch your role preset'}
      >
        <span style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 500 }}>{zh ? '你的角色' : 'Your role'} ·</span>
        <span style={{ fontWeight: 600 }}>{triggerLabel}</span>
        <span style={{ color: 'var(--ink-mute)', fontSize: 11 }}>▾</span>
      </button>

      {open && !confirming && (
        <div ref={dropdownRef} className="persona-picker-dropdown" role="menu">
          <div style={{
            padding: '10px 14px', borderBottom: '1px solid var(--line)',
            fontSize: 11, color: 'var(--ink-mute)',
          }}>
            {zh
              ? '这些是你的角色预设，不是 AI 的人设。选一个来填写你的角色、简介和 AI 助手的工作风格配置，或跳过并在下面直接编辑。'
              : 'These presets are for your role profile. The desk AI is always your assistant, not the persona-holder.'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <button
              type="button"
              className="persona-picker-item"
              onClick={() => { setCustomSelected(true); setOpen(false); }}
              role="menuitem"
              title={zh ? '跳过预设，在下方直接编辑你的角色、简介和系统指令。' : 'Skip the presets — write your own role / intro / system prompt via inline-edit below.'}
            >
              <span className="persona-picker-icon" aria-hidden="true">✏️</span>
              <span className="persona-picker-text">
                <span className="persona-picker-name-row">
                  <span className="persona-picker-name">{zh ? '自定义' : 'Custom · write your own'}</span>
                </span>
                <span className="persona-picker-tagline">
                  {zh ? '跳过预设，直接编辑下方字段。' : 'Skip the catalog — edit the fields below directly. Having or skipping a preset is fine.'}
                </span>
              </span>
            </button>
            {personas.map((p) => (
              <button
                key={p.id}
                type="button"
                className="persona-picker-item"
                onClick={() => setConfirming(p)}
                role="menuitem"
              >
                <span className="persona-picker-icon" aria-hidden="true">{p.icon}</span>
                <span className="persona-picker-text">
                  <span className="persona-picker-name-row">
                    <span className="persona-picker-name">{p.name}</span>
                    {p.industry && (
                      <span className="persona-picker-industry" title={zh ? '行业 / 领域' : 'Industry / domain'}>{p.industry}</span>
                    )}
                  </span>
                  <span className="persona-picker-tagline">{p.tagline}</span>
                </span>
              </button>
            ))}
            {personas.length === 0 && (
              <div style={{ padding: 14, color: 'var(--ink-mute)', fontSize: 12, fontStyle: 'italic' }}>
                {zh ? '正在加载预设…' : 'Loading presets…'}
              </div>
            )}
          </div>
        </div>
      )}

      {confirming && (
        <div className="persona-confirm-backdrop" onClick={() => !busy && setConfirming(null)} role="presentation">
          <div className="persona-confirm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>{confirming.icon} {confirming.name}</span>
              {confirming.industry && (
                <span className="persona-picker-industry" title={zh ? '行业 / 领域' : 'Industry / domain'}>{confirming.industry}</span>
              )}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: '6px 0 14px' }}>{confirming.tagline}</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, lineHeight: 1.55 }}>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--ink-mute)', textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.5, marginBottom: 4 }}>{zh ? '你的角色' : 'owner_role'}</div>
                <div>{confirming.owner_role}</div>
              </div>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--ink-mute)', textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.5, marginBottom: 4 }}>{zh ? '你的简介草稿' : 'owner_intro (draft)'}</div>
                <div style={{ color: 'var(--ink)' }}>{confirming.owner_intro}</div>
              </div>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--ink-mute)', textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.5, marginBottom: 4 }}>{zh ? '系统指令（前 200 字）' : 'system_prompt (first 200 chars)'}</div>
                <div style={{
                  fontSize: 11, fontFamily: 'ui-monospace, monospace',
                  background: 'var(--bg-alt)', padding: 8, borderRadius: 6,
                  border: '1px solid var(--line)', whiteSpace: 'pre-wrap',
                }}>
                  {confirming.system_prompt.slice(0, 200)}…
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--ink-mute)', textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.5, marginBottom: 4 }}>{zh ? '额外加入工具范围的技能' : 'extra skills added to tool_scope'}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {confirming.extra_tools.map((t) => (
                    <code key={t} className="badge" style={{ fontFamily: 'monospace', fontSize: 11 }}>{t}</code>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 14, fontSize: 12, color: 'var(--ink-mute)', fontStyle: 'italic' }}>
              {zh ? '保留：你的名字 · 工作区 · 月预算 · 技能 · 连接 · 上游伙伴 · 员工列表。' : 'Preserved: owner_name · workspace_dir · monthly_budget · skills · integrations · upstream peer · staff roster.'}
            </div>

            {error && (
              <div style={{ marginTop: 10, padding: 8, background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: 6, fontSize: 12, color: 'var(--red, #c0392b)' }}>
                ✗ {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
              <button type="button" className="btn" onClick={() => setConfirming(null)} disabled={busy}>{zh ? '取消' : 'Cancel'}</button>
              <div style={{ flex: 1 }} />
              <button type="button" className="btn btn-primary" onClick={() => apply(confirming)} disabled={busy}>
                {busy ? (zh ? '应用中…' : 'Applying…') : (zh ? '应用预设' : 'Apply persona')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
