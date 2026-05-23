'use client';

import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { useT } from '../../lib/i18n/useT';

/**
 * Floating bug-report button + modal. Visible on every page (mounted
 * from the root layout). Per user 2026-05-16:
 *
 *   "你弄个bug report的按钮 我可以submit bug 然后你在后台弄个bug fixer
 *    agent ... 要能接受文字描述 要能截图"
 *
 * v1 scope:
 *   - Free-text description + optional screenshot upload
 *   - Auto-captures URL + viewport + user agent at submit time
 *   - POSTs to /api/v1/admin/bugs which writes the report to disk
 *     under bugs/<timestamp>-<id>/ for later triage by Claude Code
 *
 * Hide in prod via NEXT_PUBLIC_HOLON_ENABLE_DEBUG when ready.
 */

// Cap multi-screenshot attachments. User 2026-05-17:
// "能多张么 你可以限制最多多少 但是不能一张 3-5张合理". 5 lands in that range.
const MAX_SCREENSHOTS = 5;

interface Attachment {
  file: File;
  url: string;
  id: string;
}

export function BugReportButton() {
  const { t, lang } = useT();
  const zh = lang === 'zh-CN';
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const objectUrlsRef = useRef<string[]>([]);

  function addFiles(files: File[]) {
    if (files.length === 0) return;
    setAttachments((prev) => {
      const room = MAX_SCREENSHOTS - prev.length;
      if (room <= 0) {
        setLastResult(`❌ ${zh ? `最多 ${MAX_SCREENSHOTS} 张截图` : `Max ${MAX_SCREENSHOTS} screenshots`}`);
        return prev;
      }
      const accepted = files.slice(0, room).map((f) => {
        const url = URL.createObjectURL(f);
        objectUrlsRef.current.push(url);
        return { file: f, url, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
      });
      if (files.length > room) {
        setLastResult(`❌ ${zh ? `已限制为 ${MAX_SCREENSHOTS} 张截图` : `Capped at ${MAX_SCREENSHOTS} screenshots`}`);
      }
      return [...prev, ...accepted];
    });
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) {
        URL.revokeObjectURL(target.url);
        objectUrlsRef.current = objectUrlsRef.current.filter((u) => u !== target.url);
      }
      return prev.filter((a) => a.id !== id);
    });
  }

  function clearAttachments() {
    for (const u of objectUrlsRef.current) URL.revokeObjectURL(u);
    objectUrlsRef.current = [];
    setAttachments([]);
  }

  // Hotkey: Ctrl/Cmd + Shift + B
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && (ev.key === 'B' || ev.key === 'b')) {
        ev.preventDefault();
        setOpen((v) => !v);
      } else if (ev.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // External trigger: any component can open the Feedback modal by dispatching
  // a window 'holon:open-feedback' event (e.g. the Connectors "Tell us what to
  // support" CTA). Keeps the modal state owned here without prop-drilling.
  useEffect(() => {
    function onOpen() { setOpen(true); }
    window.addEventListener('holon:open-feedback', onOpen);
    return () => window.removeEventListener('holon:open-feedback', onOpen);
  }, []);

  // Clipboard paste — when modal is open, ⌘V/Ctrl+V anywhere in the
  // modal (textarea included) attaches any image on the clipboard
  // directly. Per user 2026-05-17: "最好能直接贴图 方便 ... 不能通过
  // navigate文件 太慢了". Multi-image support added 2026-05-17 per
  // user: paste/browse appends up to MAX_SCREENSHOTS.
  useEffect(() => {
    if (!open) return;
    function onPaste(ev: ClipboardEvent) {
      const items = ev.clipboardData?.items;
      if (!items) return;
      const collected: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it && it.kind === 'file' && it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) {
            const ext = (f.type.split('/')[1] ?? 'png').split('+')[0];
            collected.push(new File([f], `paste-${Date.now()}-${i}.${ext}`, { type: f.type }));
          }
        }
      }
      if (collected.length > 0) {
        addFiles(collected);
        ev.preventDefault(); // don't dump binary into the textarea
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [open]);

  // Cleanup object URLs on unmount.
  useEffect(() => () => {
    for (const u of objectUrlsRef.current) URL.revokeObjectURL(u);
  }, []);

  function onFileChange(ev: ChangeEvent<HTMLInputElement>) {
    const list = ev.target.files;
    if (!list || list.length === 0) return;
    addFiles(Array.from(list));
    // Reset input so re-picking the same file fires onChange again.
    ev.target.value = '';
  }

  async function submit() {
    if (!text.trim()) {
      setLastResult(`❌ ${zh ? '请先填写反馈内容' : 'Description is required'}`);
      return;
    }
    setBusy(true);
    setLastResult(null);

    const screenshots = await Promise.all(attachments.map((a) =>
      new Promise<{ data_url: string; filename: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ data_url: reader.result as string, filename: a.file.name });
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(a.file);
      }),
    ));

    // Keep legacy single-screenshot fields populated with the first
    // attachment so the BFF stays backwards compatible if an older
    // client (or this one before the upgrade) is still in the wild.
    const first = screenshots[0] ?? null;

    const payload = {
      description: text.trim(),
      url: window.location.href,
      route: window.location.pathname,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      user_agent: navigator.userAgent,
      ts: new Date().toISOString(),
      screenshot_data_url: first?.data_url ?? null,
      screenshot_filename: first?.filename ?? null,
      screenshots,
    };

    try {
      const r = await fetch('/api/v1/admin/bugs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) {
        setLastResult(`❌ ${j.error ?? (zh ? '提交失败' : 'submit failed')}`);
      } else {
        setLastResult(`✅ ${zh ? '已提交' : 'Filed'} · ${j.bug_id}`);
        setText('');
        clearAttachments();
        setTimeout(() => { setOpen(false); setLastResult(null); }, 2500);
      }
    } catch (e) {
      setLastResult(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={zh ? '发送反馈（Ctrl/Cmd+Shift+B）' : 'Send feedback (Ctrl/Cmd+Shift+B)'}
        aria-label={zh ? '发送反馈' : 'Send feedback'}
        className="bug-fab-inline"
      >
        {/* Chat-bubble glyph (was a line-art bug; rename "Report bug"
         * → "Feedback" 2026-05-19 widens the surface beyond bugs to
         * include suggestions, confusion, praise — the bug-only icon
         * was misleading users away from non-bug input). Lucide's
         * message-square outline at 18px, currentColor, wrapped in
         * .nav-icon for rail alignment. */}
        <span className="nav-icon">
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </span>
        <span className="nav-label">{t('feedback.nav', 'Feedback')}</span>
      </button>

      {open && (
        <div className="bug-modal-backdrop" onClick={() => setOpen(false)} role="presentation">
          <div
            className="bug-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={zh ? '发送反馈' : 'Send feedback'}
          >
            <div className="bug-modal-header">
              <h2 style={{ margin: 0, fontSize: 16, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {/* Same chat-bubble glyph as the FAB button. */}
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                {t('feedback.title', 'Feedback')}
              </h2>
              <button type="button" className="bug-modal-close" onClick={() => setOpen(false)} aria-label={zh ? '关闭' : 'Close'}>×</button>
            </div>

            <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 10 }}>
              {zh
                ? '问题、建议和疑惑都可以写在这里。会自动记录当前页面、窗口大小和浏览器信息。可用 ⌘/Ctrl+Shift+B 打开或关闭。'
                : 'Bugs, suggestions, confusion, praise — all welcome. Auto-captures URL, viewport, and user agent. ⌘/Ctrl+Shift+B toggles this dialog.'}
            </div>

            <label style={{ fontSize: 12, color: 'var(--ink-mute)', display: 'block', marginTop: 8 }}>
              {zh ? '你想反馈什么？' : "What's on your mind?"}
            </label>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder={zh ? '例如：我点今日再回到首页后，聊天记录不见了。' : 'e.g. After I click Today and come back to /, the chat history is gone.'}
              className="bug-modal-textarea"
            />

            <label style={{ fontSize: 12, color: 'var(--ink-mute)', display: 'block', marginTop: 10 }}>
              {zh ? '截图' : 'Screenshots'} ({zh ? `可选，最多 ${MAX_SCREENSHOTS} 张` : `optional, up to ${MAX_SCREENSHOTS}`} — <strong>{zh ? '可直接粘贴' : 'paste with ⌘V / Ctrl+V'}</strong>{zh ? '，也可以浏览选择：' : ' anywhere in this dialog, or browse:'})
            </label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={onFileChange}
              disabled={attachments.length >= MAX_SCREENSHOTS}
              style={{ fontSize: 12 }}
            />
            {attachments.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {attachments.map((a, i) => (
                  <div
                    key={a.id}
                    style={{
                      padding: 6, border: '1px solid var(--line)',
                      borderRadius: 8, display: 'flex', alignItems: 'flex-start', gap: 10,
                      background: 'var(--bg-alt)',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.url}
                      alt={zh ? `反馈截图 ${i + 1} 预览` : `feedback screenshot ${i + 1} preview`}
                      style={{ maxWidth: 140, maxHeight: 100, border: '1px solid var(--line)', borderRadius: 4, objectFit: 'contain', background: '#fff' }}
                    />
                    <div style={{ fontSize: 11, color: 'var(--ink-mute)', flex: 1, lineHeight: 1.5 }}>
                      <div><strong>#{i + 1} · {a.file.name}</strong></div>
                      <div>{a.file.type} · {Math.round(a.file.size / 1024)} KB</div>
                      <button
                        type="button"
                        onClick={() => removeAttachment(a.id)}
                        style={{
                          marginTop: 4, fontSize: 11, padding: '2px 6px',
                          background: 'transparent', border: '1px solid var(--line)',
                          borderRadius: 4, cursor: 'pointer', color: 'var(--ink)',
                        }}
                      >
                        × {zh ? '移除' : 'remove'}
                      </button>
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                  {zh ? `已附加 ${attachments.length} / ${MAX_SCREENSHOTS} 张` : `${attachments.length} of ${MAX_SCREENSHOTS} attached`}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
              <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>{zh ? '取消' : 'Cancel'}</button>
              <div style={{ flex: 1 }} />
              {lastResult && (
                <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{lastResult}</span>
              )}
              <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !text.trim()}>
                {busy ? (zh ? '发送中…' : 'Sending…') : (zh ? '发送反馈' : 'Send feedback')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
