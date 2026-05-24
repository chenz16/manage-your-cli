/* chat.js — global right-side chat panel rendering + interaction.
 *
 * Per ADR-013 / iter-001a step-7.
 *
 * Chat IS a Secretary CLI session (no new data primitive).
 * Two scopes:
 *   1. Per-member: each member card has a chat icon → opens panel pre-filtered.
 *   2. Myself dialog: special owner_assistant member; default tab.
 *
 * Reads: window.HOLON_FIXTURES.chat_threads (set in fixtures.js).
 * Exposes: window.HOLON_CHAT.open(threadId?) — called from members.js cards.
 *
 * No frameworks. No build step. Vanilla DOM.
 * Loaded as type="module" so it defers naturally after DOMContentLoaded.
 */

(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────
  var _panelOpen   = false;
  var _activeThread = null;   // thread id string
  var _panel       = null;
  var _backdrop    = null;
  var _tabBar      = null;
  var _body        = null;
  var _input       = null;

  // ─── DOM helpers ──────────────────────────────────────────────────────────

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class')    node.className   = attrs[k];
        else if (k === 'html') node.innerHTML   = attrs[k];
        else                   node.setAttribute(k, attrs[k]);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  // ─── Data helpers ──────────────────────────────────────────────────────────

  function threads() {
    var fx = window.HOLON_FIXTURES;
    return (fx && fx.chat_threads) ? fx.chat_threads : [];
  }

  function getThread(id) {
    return threads().find(function (t) { return t.id === id; }) || null;
  }

  function defaultThreadId() {
    // Always default to "myself" assistant thread
    var t = threads().find(function (t) { return t.participant_role === 'owner_assistant'; });
    return t ? t.id : (threads()[0] ? threads()[0].id : null);
  }

  // ─── Panel build (called once) ────────────────────────────────────────────

  function buildPanel() {
    // Backdrop
    _backdrop = el('div', { class: 'chat-backdrop', 'aria-hidden': 'true' });
    _backdrop.addEventListener('click', closePanel);

    // Panel
    _panel = el('div', {
      class: 'chat-panel',
      role:  'complementary',
      'aria-label': 'Chat',
    });

    // Header
    var header = el('div', { class: 'chat-panel-header' });
    var title  = el('h2', { class: 'chat-panel-title' }, 'Chat');
    var closeBtn = el('button', {
      class: 'chat-panel-close',
      type:  'button',
      'aria-label': 'Close chat panel',
    });
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.addEventListener('click', closePanel);
    header.appendChild(title);
    header.appendChild(closeBtn);
    _panel.appendChild(header);

    // Tab bar
    _tabBar = el('div', { class: 'chat-tabs', role: 'tablist', 'aria-label': 'Chat threads' });
    _panel.appendChild(_tabBar);

    // Message body
    _body = el('div', { class: 'chat-body', role: 'log', 'aria-live': 'polite' });
    _panel.appendChild(_body);

    // Input bar
    var inputBar = el('div', { class: 'chat-input-bar' });
    _input = el('textarea', {
      class: 'chat-input',
      placeholder: 'Type a message…',
      rows: '1',
      'aria-label': 'Message input',
    });
    // Auto-grow textarea
    _input.addEventListener('input', function () {
      _input.style.height = 'auto';
      _input.style.height = Math.min(_input.scrollHeight, 120) + 'px';
    });
    _input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        handleSend();
      }
    });

    var sendBtn = el('button', {
      class: 'chat-send-btn',
      type: 'button',
      'aria-label': 'Send message',
    });
    sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
    sendBtn.addEventListener('click', handleSend);

    inputBar.appendChild(_input);
    inputBar.appendChild(sendBtn);
    _panel.appendChild(inputBar);

    document.body.appendChild(_backdrop);
    document.body.appendChild(_panel);

    // Esc closes
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && _panelOpen) closePanel();
    });
  }

  // ─── Tabs rendering ────────────────────────────────────────────────────────

  function renderTabs() {
    _tabBar.innerHTML = '';
    threads().forEach(function (t) {
      var isActive = t.id === _activeThread;
      var initial  = (t.participant_name || '?').charAt(0).toUpperCase();
      var isMyself = t.participant_role === 'owner_assistant';

      var avatarCls = 'chat-tab-avatar' + (isMyself ? ' myself' : '');
      var avatar = el('span', { class: avatarCls, 'aria-hidden': 'true' }, initial);

      var tab = el('button', {
        type: 'button',
        class: 'chat-tab' + (isActive ? ' active' : ''),
        role: 'tab',
        'aria-selected': isActive ? 'true' : 'false',
        'data-thread-id': t.id,
        'aria-label': 'Chat with ' + t.participant_name,
      }, [avatar, t.participant_name]);

      tab.addEventListener('click', function () {
        switchThread(t.id);
      });
      _tabBar.appendChild(tab);
    });
  }

  // ─── Message rendering ─────────────────────────────────────────────────────

  function renderMessages(threadId) {
    _body.innerHTML = '';
    var t = getThread(threadId);
    if (!t) {
      _body.appendChild(el('div', { class: 'chat-empty' }, [
        el('span', { class: 'chat-empty-icon', 'aria-hidden': 'true' }, '💬'),
        el('span', null, 'No messages yet.'),
      ]));
      return;
    }

    var msgs = t.messages || [];
    if (msgs.length === 0) {
      _body.appendChild(el('div', { class: 'chat-empty' }, [
        el('span', { class: 'chat-empty-icon', 'aria-hidden': 'true' }, '💬'),
        el('span', null, 'Start the conversation.'),
      ]));
      return;
    }

    msgs.forEach(function (m) {
      _body.appendChild(buildMessageEl(m, t));
    });

    // Scroll to bottom
    _body.scrollTop = _body.scrollHeight;
  }

  function buildMessageEl(m, thread) {
    var isUser    = m.role === 'user';
    var isMyself  = thread.participant_role === 'owner_assistant';
    var msgCls    = 'chat-msg ' + (isUser ? 'user' : ('agent' + (isMyself ? ' myself-role' : '')));

    var wrap = el('div', { class: msgCls });

    // Avatar
    var initial = isUser ? 'A' : (thread.participant_name || '?').charAt(0).toUpperCase();
    var avatar  = el('span', {
      class: 'chat-msg-avatar',
      'aria-hidden': 'true',
    }, initial);

    // Column (meta + bubble)
    var col  = el('div', { class: 'chat-msg-col' });
    var meta = el('div', { class: 'chat-msg-meta' });

    var nameSpan = el('span', { class: 'chat-msg-name' }, isUser ? 'You' : thread.participant_name);
    var tsSpan   = el('span', { class: 'chat-msg-ts' }, m.ts || '');
    meta.appendChild(nameSpan);
    meta.appendChild(tsSpan);
    col.appendChild(meta);

    // Bubble content
    var bubble = el('div', { class: 'chat-msg-bubble' });

    // Tool call block (if present)
    if (m.tool_call) {
      var tcBlock = buildToolCallEl(m.tool_call);
      col.appendChild(tcBlock);
    }

    // Streaming indicator (if flagged)
    if (m.streaming) {
      var streaming = el('div', { class: 'chat-streaming', 'aria-label': 'Agent is typing' });
      streaming.appendChild(el('span', { class: 'chat-streaming-dot' }));
      streaming.appendChild(el('span', { class: 'chat-streaming-dot' }));
      streaming.appendChild(el('span', { class: 'chat-streaming-dot' }));
      col.appendChild(streaming);
      wrap.appendChild(avatar);
      wrap.appendChild(col);
      return wrap;
    }

    // Body text (may contain citation chips)
    if (m.body) {
      bubble.appendChild(renderBody(m.body, m.citations || []));
    }

    col.appendChild(bubble);
    wrap.appendChild(avatar);
    wrap.appendChild(col);
    return wrap;
  }

  function buildToolCallEl(tc) {
    var block = el('div', { class: 'chat-tool-call', 'aria-label': 'Tool call: ' + (tc.name || '') });
    var icon  = el('span', { class: 'chat-tool-call-icon', 'aria-hidden': 'true' }, tc.icon || '🔧');
    var body  = el('div', { class: 'chat-tool-call-body' });
    var name  = el('span', { class: 'chat-tool-call-name' }, tc.name || 'tool');
    body.appendChild(name);
    if (tc.args) {
      body.appendChild(el('span', { class: 'chat-tool-call-args' }, tc.args));
    }
    block.appendChild(icon);
    block.appendChild(body);
    return block;
  }

  // Parse body text — insert citation chip spans inline where {cite:X} appears.
  function renderBody(text, citations) {
    var frag = document.createDocumentFragment();

    // Split on citation markers: {cite:some_id}
    var parts = text.split(/(\{cite:[^}]+\})/g);
    parts.forEach(function (part) {
      var m = part.match(/^\{cite:([^}]+)\}$/);
      if (m) {
        var citeId = m[1];
        var citeData = (citations || []).find(function (c) { return c.id === citeId; }) || { id: citeId, label: citeId };
        var chip = el('a', {
          class: 'chat-citation',
          href:  '#',
          'aria-label': 'Citation: ' + citeData.label,
          'data-cite-id': citeId,
        }, [
          el('span', { class: 'chat-citation-icon', 'aria-hidden': 'true' }, '📎'),
          citeData.label,
        ]);
        chip.addEventListener('click', function (ev) {
          ev.preventDefault();
          // iter-001a-patch: open deliverable detail drawer instead of alert().
          // Per "no dead-end clicks" rule — citation chips must open a second layer.
          if (window.HOLON_DRAWER && typeof window.HOLON_DRAWER.openDeliverableDrawer === 'function') {
            window.HOLON_DRAWER.openDeliverableDrawer(citeId);
          } else {
            // Fallback if drawer.js not loaded (should not happen in practice).
            // eslint-disable-next-line no-console
            console.info('[chat] Citation chip: ' + citeData.label + ' (HOLON_DRAWER not loaded)');
          }
        });
        frag.appendChild(chip);
      } else if (part) {
        frag.appendChild(document.createTextNode(part));
      }
    });

    return frag;
  }

  // ─── Send handler (appends mock reply) ────────────────────────────────────

  function handleSend() {
    var text = (_input.value || '').trim();
    if (!text || !_activeThread) return;

    var t = getThread(_activeThread);
    if (!t) return;

    // Append user message
    t.messages.push({
      role: 'user',
      ts:   nowTs(),
      body: text,
    });

    _input.value = '';
    _input.style.height = 'auto';

    renderMessages(_activeThread);

    // Simulate streaming reply after 800ms
    var replyTimer = setTimeout(function () {
      t.messages.push({
        role:      'agent',
        ts:        nowTs(),
        body:      '[mock] Message received. (Real agent response will be wired in V1 backend.)',
      });
      renderMessages(_activeThread);
    }, 800);

    // eslint-disable-next-line no-console
    console.info('[chat mock] sent to thread "' + _activeThread + '": ' + text, replyTimer);
  }

  function nowTs() {
    var d = new Date();
    return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  // ─── Thread switching ──────────────────────────────────────────────────────

  function switchThread(threadId) {
    _activeThread = threadId;
    renderTabs();
    renderMessages(threadId);
    if (_input) _input.focus();
  }

  // ─── Open / close ──────────────────────────────────────────────────────────

  function openPanel(threadId) {
    if (!_panel) buildPanel();

    _activeThread = threadId || defaultThreadId();
    renderTabs();
    renderMessages(_activeThread);

    _panelOpen = true;
    _panel.classList.add('open');
    _backdrop.classList.add('open');

    // Mark toggle button active
    var toggleBtn = document.querySelector('.chat-toggle-btn');
    if (toggleBtn) toggleBtn.classList.add('active');

    if (_input) _input.focus();
  }

  function closePanel() {
    _panelOpen = false;
    if (_panel) _panel.classList.remove('open');
    if (_backdrop) _backdrop.classList.remove('open');

    var toggleBtn = document.querySelector('.chat-toggle-btn');
    if (toggleBtn) toggleBtn.classList.remove('active');
  }

  // ─── Topbar chat button injection ─────────────────────────────────────────

  function injectTopbarButton() {
    var actions = document.querySelector('.topbar-actions');
    if (!actions) return;

    // Don't inject twice
    if (document.querySelector('.chat-toggle-btn')) return;

    var btn = el('button', {
      class: 'topbar-icon-btn chat-toggle-btn',
      type:  'button',
      'aria-label': 'Open chat panel',
      'aria-expanded': 'false',
    });
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

    btn.addEventListener('click', function () {
      if (_panelOpen) {
        closePanel();
        btn.setAttribute('aria-expanded', 'false');
      } else {
        openPanel();
        btn.setAttribute('aria-expanded', 'true');
      }
    });

    // Insert before the notifications button (second child) — or prepend
    var firstChild = actions.firstChild;
    actions.insertBefore(btn, firstChild);
  }

  // ─── Per-member card chat icon wiring ─────────────────────────────────────
  // Called by members.js after grid render, OR self-wired here via MutationObserver.

  function wireMemberCards() {
    document.querySelectorAll('.staff-card').forEach(function (card) {
      if (card.querySelector('.member-chat-btn')) return; // already wired

      var staffId   = card.dataset.staffId;
      var nameEl    = card.querySelector('.staff-name');
      var staffName = nameEl ? nameEl.textContent.trim() : staffId;

      // Find matching thread
      var thread = threads().find(function (t) { return t.staff_id === staffId; });

      var chatBtn = el('button', {
        type:  'button',
        class: 'member-chat-btn',
        'aria-label': 'Chat with ' + staffName,
        title: 'Chat with ' + staffName,
      });
      chatBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

      chatBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openPanel(thread ? thread.id : null);
      });

      // Append to the bottom row (staff-status-line) so it sits at the right
      var bottomRow = card.querySelector('.staff-status-line');
      if (bottomRow) {
        bottomRow.appendChild(chatBtn);
      } else {
        card.appendChild(chatBtn);
      }
    });
  }

  // ─── Boot ──────────────────────────────────────────────────────────────────

  function boot() {
    injectTopbarButton();

    // Wire member cards that exist at boot (members.js may run before this)
    wireMemberCards();

    // Observe DOM for cards added after boot (e.g. members.js renders after)
    if (window.MutationObserver) {
      var observer = new MutationObserver(function (mutations) {
        var hasNew = mutations.some(function (m) {
          return Array.from(m.addedNodes).some(function (n) {
            return n.nodeType === 1 && (
              n.classList.contains('staff-card') ||
              (n.querySelectorAll && n.querySelectorAll('.staff-card').length > 0)
            );
          });
        });
        if (hasNew) wireMemberCards();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  window.HOLON_CHAT = {
    open:             openPanel,
    close:            closePanel,
    _wireMemberCards: wireMemberCards,   // called by members.js after grid render
  };

})();
