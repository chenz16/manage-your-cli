'use client';

import { useEffect, useState } from 'react';
import type { OptionalFeature, OwnerAssistant } from '@holon/api-contract';
import { InlineField } from './InlineField';
import { PersonaPicker } from './PersonaPicker';
import { FolderPicker } from './FolderPicker';
import { AuthorizationsSection } from './AuthorizationsSection';
import { ConnectPhoneSection } from './ConnectPhoneSection';
import { BugQueue } from './BugQueue';
import { BugReportButton } from '../../_components/BugReportButton';
import { LanguageSwitcher } from '../../_components/LanguageSwitcher';
import { primeOwner } from '../../../lib/hooks/useOwner';
import { useT } from '../../../lib/i18n/useT';

/**
 * Client-side /me — inline-edit every owner field. Reads from
 * /api/v1/me (fixture + overrides), writes via PATCH on blur. Each
 * multiline field gets the ✨ Polish-with-LLM button.
 *
 * Per user 2026-05-16 "这些配置都可以点击修改 然后经过LLM 自己润色".
 */

interface Conn {
  id: string;
  display_name: string;
  health_state: string;
}

interface Desk {
  display_name?: string;
  device_kind?: string;
  span_of_control_cap?: number;
}

// Chat is always-on and never appears here. Everything else is toggleable.
// Defaults: Team + Today + Bug Report are on; the rest start hidden — this
// app is for managing CLIs, so the lean default nav stays focused.
const OPTIONAL_FEATURES: Array<{ key: OptionalFeature; label: string; desc: string }> = [
  { key: 'members', label: 'Team', desc: 'Your CLI agents roster' },
  { key: 'todo', label: 'Today', desc: 'Work-in-flight tracker' },
  { key: 'connectors', label: 'Connectors', desc: 'Voice / messaging integrations' },
  { key: 'deliverables', label: 'Drops', desc: 'Returned work and drops' },
  { key: 'skills', label: 'Skills', desc: 'Capability catalog' },
  { key: 'references', label: 'References', desc: 'Reference catalog' },
  { key: 'voice', label: 'Voice', desc: 'Dictation and voice mode controls' },
];



export function MeClient({
  initialOwner,
  primaryDesk,
  connections,
  defaultWorkspaceDir,
}: {
  initialOwner: OwnerAssistant;
  primaryDesk: Desk | null;
  connections: Conn[];
  defaultWorkspaceDir: string;
}) {
  const { t, tFmt, lang } = useT();
  const zh = lang === 'zh-CN';
  const [owner, setOwner] = useState<OwnerAssistant>(initialOwner);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);

  // Re-fetch on a server-driven reset event (DebugControls dispatches it).
  useEffect(() => {
    function reload() {
      fetch('/api/v1/me')
        .then((r) => {
          if (!r.ok) throw new Error(`GET /api/v1/me ${r.status}`);
          return r.json() as Promise<OwnerAssistant>;
        })
        .then((j) => {
          setOwner(j);
          setReloadError(null);
        })
        .catch((e: unknown) => setReloadError(e instanceof Error ? e.message : String(e)));
    }
    window.addEventListener('holon:reset', reload);
    return () => window.removeEventListener('holon:reset', reload);
  }, []);
  async function patchField<K extends keyof OwnerAssistant>(key: K, value: OwnerAssistant[K]): Promise<void> {
    const r = await fetch('/api/v1/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    });
    if (!r.ok) throw new Error(`PATCH ${r.status}`);
    const j: OwnerAssistant = await r.json();
    setOwner(j);
    primeOwner(j);
  }

  function isFeatureVisible(key: OptionalFeature): boolean {
    return !(owner.hidden_features ?? []).includes(key);
  }

  async function setFeatureVisible(key: OptionalFeature, visible: boolean): Promise<void> {
    const hidden = new Set<OptionalFeature>(owner.hidden_features ?? []);
    if (visible) hidden.delete(key);
    else hidden.add(key);
    await patchField('hidden_features', Array.from(hidden));
  }

  const upstream = owner.upstream_connection_id
    ? connections.find((c) => c.id === owner.upstream_connection_id) ?? null
    : null;

  const monthlyBudgetUSD = owner.monthly_budget_mc != null
    ? (owner.monthly_budget_mc / 100_000).toFixed(2)
    : '';


  return (
    <>
      <div className="page-strip">
        <h1 className="page-strip-title">{owner.owner_name || 'Me'}</h1>
        <div style={{ flex: 1 }} />
        <PersonaPicker
          currentRole={owner.owner_role ?? ''}
          onApplied={() => {
            fetch('/api/v1/me')
              .then((r) => {
                if (!r.ok) throw new Error(`GET /api/v1/me ${r.status}`);
                return r.json() as Promise<OwnerAssistant>;
              })
              .then((j) => {
                setOwner(j);
                setReloadError(null);
              })
              .catch((e: unknown) => setReloadError(e instanceof Error ? e.message : String(e)));
          }}
        />
        {reloadError && <span style={{ fontSize: 12, color: 'var(--red, #c0392b)' }}>{zh ? '刷新失败' : 'Refresh failed'}: {reloadError}</span>}
        <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{zh ? '桌面' : 'desk'}: {primaryDesk?.display_name ?? '—'}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Language — first section per owner directive: config-type settings at top of /me */}
        <section className="card" style={{ padding: 20 }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>{t('me.language.section_title')}</h2>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: -4, marginBottom: 12 }}>
            {t('me.language.section_hint')}
          </p>
          <LanguageSwitcher hideLabel />
        </section>

        <section className="card" style={{ padding: 20 }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>{zh ? '功能显示' : 'Feature Visibility'}</h2>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: -4, marginBottom: 12 }}>
            {zh ? '隐藏可选模块会移除左侧导航，并阻止直接打开该页面。Chat、Team、Connectors 始终显示。' : 'Hide optional modules from the left nav and direct page access. Chat, Team, and Connectors stay on.'}
          </p>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {OPTIONAL_FEATURES.map((feature) => {
              const checked = isFeatureVisible(feature.key);
              return (
                <label key={feature.key} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  border: '1px solid var(--line)', borderRadius: 8,
                  padding: 12, cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(ev) => {
                      setFeatureVisible(feature.key, ev.currentTarget.checked)
                        .catch((e: unknown) => setReloadError(e instanceof Error ? e.message : String(e)));
                    }}
                    style={{ marginTop: 2 }}
                  />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{feature.label}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{feature.desc}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        {/* Identity */}
        <section className="card" style={{ padding: 20 }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>{t('me.section.identity')}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <InlineField
              label={zh ? '你的名字' : 'Your name'}
              value={owner.owner_name ?? ''}
              placeholder={zh ? '桌面智能助手应该怎么称呼你？' : 'What should the desk AI call you?'}
              onSave={(v) => patchField('owner_name', v)}
            />
            <InlineField
              label={zh ? '你的角色 / 职位' : 'Your role / title'}
              value={owner.owner_role ?? ''}
              placeholder={zh ? '例如：产品负责人 · Acme' : 'e.g. Senior Product Engineer · Acme'}
              onSave={(v) => patchField('owner_role', v)}
            />
            <InlineField
              label={zh ? '关于我' : 'About me'}
              value={owner.owner_intro ?? ''}
              placeholder={zh ? '你是谁、做什么、希望智能秘书如何称呼你。' : 'Who you are, what you work on, how you like to be addressed.'}
              multiline polishable
              polishHint={zh ? '这是用户自己的简介。保留第一人称和用户语气，只润色表达。' : "This is the human user's self-intro. Keep first-person and the user's voice; tighten grammar / phrasing only."}
              onSave={(v) => patchField('owner_intro', v)}
            />
          </div>
        </section>

        {/* Desk AI working style — fix(persona): clearly separate AI instructions from owner identity */}
        <section className="card" style={{ padding: 20 }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>
            {owner.name} · {zh ? '智能秘书工作风格' : 'AI Secretary Working Style'}
          </h2>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: -4, marginBottom: 10 }}>
            {zh ? (
              <>
                <strong>这里配置的是你的智能秘书的工作方式</strong>，不是你的人设。
                你自己的角色和简介请在上方“关于我”处填写。
                智能秘书始终是你的助手，绝不会把自己当成你。
              </>
            ) : (
              <em>
                This field configures how your <strong>AI secretary</strong> thinks and replies.
                Your own profile is in the Identity section above.
                The AI is always your secretary, never you.
              </em>
            )}
          </p>
          <InlineField
            label={zh ? '智能秘书指示' : 'AI Secretary Instructions'}
            value={owner.system_prompt ?? ''}
            placeholder={zh ? '描述你的智能秘书应该如何思考、沟通和处理任务。' : 'Describe how your AI secretary should think, communicate, and handle tasks on your behalf.'}
            multiline polishable
            polishHint={zh ? '这是智能秘书的工作方式指令。请保持对助手发号施令的语气，不要写成用户自我介绍。' : "This is the AI secretary's working-style instructions. Keep imperative voice directed at the AI assistant; do not write as if this is the user's self-description."}
            onSave={(v) => patchField('system_prompt', v)}
          />
        </section>

        {/* Tool scope + Skills — grouped under developer expander (L-096) */}
        <details style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--bg)' }}>
          <summary style={{
            cursor: 'pointer', padding: '14px 20px',
            fontSize: 13, fontWeight: 600, color: 'var(--ink-mute)',
            listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>{zh ? '⚙ 开发设置' : '⚙ Developer settings'}</span>
            <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 4 }}>{zh ? '— 工具 · 技能 · 上游伙伴 · 工作区' : '— tools · skills · upstream peer · workspace'}</span>
          </summary>
          <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Tool scope (read-only — structural) */}
            <section>
              <h2 className="section-title" style={{ marginTop: 16 }}>{t('me.section.tools')}</h2>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: -4, marginBottom: 10 }}>
                {zh ? 'Holon 智能插件注册的桥接工具。需要修改时请调整插件结构。' : 'Bridge tools registered by the Holon AI plugin. Edit by changing the plugin schema.'}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {owner.substrate.tool_scope.map((t) => (
                  <code key={t} className="badge" style={{ fontFamily: 'monospace', fontSize: 12 }}>{t}</code>
                ))}
              </div>
            </section>

            {/* Skills */}
            <section>
              <h2 className="section-title" style={{ marginTop: 0 }}>{t('me.section.skills_inherit')}</h2>
              {!owner.skills || owner.skills.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: 0 }}>{zh ? '暂无技能。' : 'No skills defined yet.'}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {owner.skills.map((s, i) => (
                    <details key={s.name + i} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px' }}>
                      <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                        {s.name} <span style={{ fontWeight: 400, color: 'var(--ink-mute)', fontSize: 13 }}>· {s.description}</span>
                      </summary>
                      <pre style={{
                        marginTop: 10, marginBottom: 0, fontSize: 12, lineHeight: 1.5,
                        color: 'var(--ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        background: 'var(--bg-alt)', padding: 10, borderRadius: 6,
                      }}>{s.body}</pre>
                    </details>
                  ))}
                </div>
              )}
            </section>

            {/* Upstream peer */}
            <section>
              <h2 className="section-title" style={{ marginTop: 0 }}>{t('me.section.upstream_peer')}</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <InlineField
                  label={zh ? '显示名称' : 'Display name'}
                  value={owner.upstream_display_name ?? ''}
                  placeholder={zh ? '例如：王（非正式评审伙伴）' : 'e.g. Wang (informal peer reviewer)'}
                  onSave={(v) => patchField('upstream_display_name', v)}
                />
                <InlineField
                  label={zh ? '连接编号' : 'Connection id'}
                  value={owner.upstream_connection_id ?? ''}
                  placeholder="conn_…"
                  onSave={(v) => patchField('upstream_connection_id', v)}
                />
                {upstream && (
                  <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                    {zh ? '已解析' : 'resolved'}: {upstream.display_name} · {zh ? '状态' : 'health'} = {upstream.health_state}
                  </div>
                )}
              </div>
            </section>

            {/* Workspace + budget */}
            <section>
              <h2 className="section-title" style={{ marginTop: 0 }}>{t('me.section.workspace_budget')}</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <InlineField
                  label={zh ? '沙盒目录' : 'Sandbox directory'}
                  value={owner.workspace_dir ?? ''}
                  placeholder={zh ? `员工进入的绝对路径，例如 ${defaultWorkspaceDir}` : `Absolute path workers cd into — e.g. ${defaultWorkspaceDir}`}
                  onSave={(v) => patchField('workspace_dir', v)}
                />
                <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: -8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn"
                    style={{ fontSize: 11, padding: '2px 8px' }}
                    onClick={() => setFolderPickerOpen(true)}
                    title={zh ? '浏览本机文件系统选择文件夹' : 'Browse the local filesystem to pick a folder'}
                  >
                    {zh ? '浏览…' : 'Browse…'}
                  </button>
                  {!owner.workspace_dir && (
                    <>
                      <span>{zh ? '建议：' : 'Suggested:'}</span>
                      <code style={{ fontFamily: 'monospace', fontSize: 12 }}>{defaultWorkspaceDir}</code>
                      <button
                        type="button"
                        className="btn"
                        style={{ fontSize: 11, padding: '2px 8px' }}
                        onClick={() => patchField('workspace_dir', defaultWorkspaceDir)}
                        title={zh ? '填入当前 Holon 安装下的建议沙盒路径' : 'Fill in the suggested sandbox path under this Holon install'}
                      >
                        {zh ? '+ 使用默认值' : '+ Use default'}
                      </button>
                    </>
                  )}
                </div>
                {folderPickerOpen && (
                  <FolderPicker
                    initialPath={owner.workspace_dir || defaultWorkspaceDir}
                    onPick={(p) => {
                      setFolderPickerOpen(false);
                      patchField('workspace_dir', p).catch((e: unknown) => setReloadError(e instanceof Error ? e.message : String(e)));
                    }}
                    onClose={() => setFolderPickerOpen(false)}
                  />
                )}
                <InlineField
                  label={zh ? '月预算（美元）' : 'Monthly budget (USD)'}
                  value={monthlyBudgetUSD}
                  placeholder="50.00"
                  onSave={async (v) => {
                    const usd = parseFloat(v);
                    if (!Number.isFinite(usd) || usd < 0) throw new Error(zh ? '请输入非负数字' : 'not a positive number');
                    await patchField('monthly_budget_mc', Math.round(usd * 100_000));
                  }}
                />
                <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                  {zh ? '设备' : 'device'}: {primaryDesk?.device_kind ?? '—'} · {zh ? '上限' : 'cap'}: {primaryDesk?.span_of_control_cap ?? '—'} {zh ? '名成员' : 'members'}
                </div>
              </div>
            </section>

          </div>
        </details>

        {/* LLM Settings · iter-018 Pass #5 replaces the read-only "LLM
         * mode · Debug" placeholder (ba0d9f2) with the full provider
         * grid: 11 cards (1 trial + 10 BYOK) + key modal + active radio
         * + test/remove. Anchor `id="llm-settings"` is inside the
         * section component itself (consumed by Pass #4 onboarding
         * return-cookie + the `/me#llm-settings` deep-link).
         *
         * me.llm_mode.* dict keys from the old placeholder are retained
         * in the dictionary (still used by the ADR / docs) but no
         * longer rendered here. */}

        <ConnectPhoneSection />

        {/* Authorizations · 2026-05-20: restored inline after /integrations
         * route was reverted per owner directive 'nav 简单点 后面 mobile 迁移'.
         * AuthorizationsSection now renders a compact configured-only
         * connection summary. Catalog setup lives on /connectors. */}
        <section className="card" style={{ padding: 20 }}>
          <AuthorizationsSection
            value={owner.integrations}
            onChange={async () => {
              /* No-op — setup flows mutate connection state elsewhere. */
            }}
          />
        </section>


        {/* iter-012 Pass #3 → iter-017 V1.0 minimal replay (AC-2.5).
         * Promoted from muted footer link to proper Settings card per
         * owner 2026-05-19 "怎么在配置里面 重新进入 on boarding". */}
        <section className="card" style={{ padding: 20 }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>{t('me.section.replay_onboarding')}</h2>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: -4, marginBottom: 12 }}>
            {t('me.replay_onboarding_desc')}
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              try {
                window.localStorage.removeItem('holon-onboarded-v1');
                window.localStorage.removeItem('holon-onboarding-state-v1');
              } catch (e: unknown) {
                setReloadError(e instanceof Error ? e.message : String(e));
                return;
              }
              window.location.href = '/onboarding';
            }}
          >
            {t('me.replay_onboarding_button')}
          </button>
        </section>

        {/* wylvzigc — version + check-for-updates link */}
        <section className="card" style={{ padding: 20 }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>
            {t('me.section.app_version', zh ? '应用版本' : 'App Version')}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--ink-mute)', fontFamily: 'ui-monospace, monospace' }}>
              v0.1.0
            </span>
            <a
              href="https://github.com/chenz16/holon-release/releases"
              target="_blank"
              rel="noreferrer"
              className="btn"
              style={{ fontSize: 12, padding: '4px 10px', textDecoration: 'none' }}
            >
              {t('me.check_for_updates', zh ? '检查更新' : 'Check for updates')} ↗
            </a>
          </div>
        </section>

        {/* Feedback / bug queue — reports filed via the Feedback button
         * (ported from holon-engineering main). */}
        <section className="card" style={{ padding: 20 }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>{t('me.section.bug_queue', zh ? '🐞 缺陷队列' : '🐞 Bug queue')}</h2>
          <div className="me-feedback-action"><BugReportButton /></div>
          <BugQueue />
        </section>

      </div>
    </>
  );
}
