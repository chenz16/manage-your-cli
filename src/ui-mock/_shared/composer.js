/* composer.js — Form-aware handoff composer modal (iter-001c steps 2-3).
 *
 * 4-step flow per plan §"Form composer modal architecture":
 *   1. PickRecipient   — connection picker from fixtures.connections
 *   2. PickForm        — 4 cards: Direct Order / Direct Takeover /
 *                        Approval Chain / Watch Brief
 *   3. ConfigureForm   — per-form consent UI; copy quoted verbatim from
 *                        docs/architecture/handoff-taxonomy.md
 *                        § "UI Consent Flow Per Form"
 *   4. Confirm         — summary + Send → success toast, no mutation
 *
 * Reachable via:
 *   - HOLON_COMPOSER.open()                 — from Today "+ New handoff"
 *   - HOLON_COMPOSER.open({ recipientId })  — pre-selects recipient and
 *                                              starts on step 2 (used by
 *                                              Connections drawer "Send
 *                                              handoff" link)
 *
 * Reuses qc-* modal scaffold styles from drawer.css for visual
 * consistency with quick-create and pair-sheet.
 */

(function () {
  'use strict';

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class')      node.className = attrs[k];
        else if (k === 'html')  node.innerHTML = attrs[k];
        else                    node.setAttribute(k, attrs[k]);
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

  function fx() { return window.HOLON_FIXTURES || { connections: [] }; }

  function showToast(msg) {
    if (window.HOLON_DRAWER && window.HOLON_DRAWER.showToast) {
      window.HOLON_DRAWER.showToast(msg);
    }
  }

  // ── Per-form metadata ─────────────────────────────────────────────────────
  // Copy quoted verbatim from handoff-taxonomy.md § "UI Consent Flow Per Form"
  // (rows for Direct Order, Direct Takeover, Approval Chain, Watch Brief).
  var FORMS = [
    {
      key: 'direct_order',
      label: 'Direct Order',
      blurb: 'Authority form. You tell the receiver exactly what to do.',
      consent: 'Receiver gets full authority — act exactly as instructed.',
      sendLabel: 'Send Direct Order',
    },
    {
      key: 'direct_takeover',
      label: 'Direct Takeover',
      blurb: 'Authority form. You hand off the goal; they decide how.',
      consent: 'Receiver gets full authority — they decide how to do this.',
      sendLabel: 'Send Direct Takeover',
    },
    {
      key: 'approval_chain',
      label: 'Approval Chain',
      blurb: 'Composite form. Multiple approvers sign off in sequence.',
      consent: 'Drag-and-drop chain builder; each stage names a desk and a form. (Full builder in iter-002+; iter-001c shows a read-only stub.)',
      sendLabel: 'Send Approval Chain',
    },
    {
      key: 'watch_brief',
      label: 'Watch Brief',
      blurb: 'Receiver-passive form. They watch a signal and report back.',
      consent: 'Receiver picker only; one-line message.',
      sendLabel: 'Send Watch Brief',
    },
  ];

  function getForm(key) {
    return FORMS.find(function (f) { return f.key === key; }) || FORMS[0];
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  var _bd = null, _modal = null;
  var _state = null;

  function open(opts) {
    opts = opts || {};
    close();
    _state = {
      step: opts.recipientId ? 2 : 1,
      recipientId: opts.recipientId || null,
      formKey: null,
      // Per-form config payload
      orderInstructions: '',
      takeoverGoal: '',
      approvalStages: [
        { stage: 'Legal review',    desk: 'Felix',  form: 'Approval Chain' },
        { stage: 'Final sign-off',  desk: 'You',    form: 'Approval Chain' },
      ],
      watchSignal: '',
      watchMessage: '',
    };

    _bd = el('div', { class: 'qc-backdrop' });
    _bd.addEventListener('click', function (ev) { if (ev.target === _bd) close(); });

    _modal = el('div', {
      class: 'qc-modal composer-modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Compose handoff',
    });
    _bd.appendChild(_modal);
    document.body.appendChild(_bd);

    document.addEventListener('keydown', escHandler);
    render();
  }

  function close() {
    document.removeEventListener('keydown', escHandler);
    if (_bd) { _bd.remove(); _bd = null; _modal = null; _state = null; }
  }

  function escHandler(ev) {
    if (ev.key === 'Escape') close();
  }

  // ── Header + step indicator ───────────────────────────────────────────────

  function buildHeader() {
    var header = el('div', { class: 'qc-modal-header' });
    header.appendChild(el('div', { class: 'qc-modal-title' }, 'New handoff'));
    var closeBtn = el('button', { class: 'drawer-close-btn', type: 'button', 'aria-label': 'Cancel handoff' });
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.addEventListener('click', close);
    header.appendChild(closeBtn);
    return header;
  }

  function buildStepIndicator() {
    var indicator = el('div', { class: 'pair-step-indicator' });
    for (var i = 1; i <= 4; i++) {
      indicator.appendChild(el('span', {
        class: 'pair-step-dot' + (i === _state.step ? ' is-active' : '') + (i < _state.step ? ' is-done' : ''),
      }));
    }
    var label = ['Recipient', 'Form', 'Configure', 'Confirm'][_state.step - 1];
    indicator.appendChild(el('span', { class: 'pair-step-label' }, 'Step ' + _state.step + ' / 4 — ' + label));
    return indicator;
  }

  function buildFooter(opts) {
    var footer = el('div', { class: 'pair-sheet-footer' });
    var back = el('button', { class: 'qc-submit-btn', type: 'button', style: 'background:#fff; color:var(--ink); border:1px solid var(--line);' }, 'Back');
    if (!opts.back) back.disabled = true;
    back.addEventListener('click', function () {
      if (_state.step > 1) { _state.step -= 1; render(); }
    });
    footer.appendChild(back);
    footer.appendChild(el('div', { style: 'flex:1;' }));

    var cancel = el('button', { class: 'qc-submit-btn', type: 'button', style: 'background:transparent; color:var(--ink-mute); border:none; box-shadow:none;' }, 'Cancel');
    cancel.addEventListener('click', close);
    footer.appendChild(cancel);

    if (opts.next) {
      var next = el('button', { class: 'qc-submit-btn', type: 'button' }, opts.nextLabel || 'Next');
      next.disabled = opts.nextDisabled === true;
      next.addEventListener('click', function () {
        if (typeof opts.next === 'function') opts.next();
        else if (_state.step < 4) { _state.step += 1; render(); }
      });
      footer.appendChild(next);
    }
    return footer;
  }

  // ── Step 1: pick recipient ────────────────────────────────────────────────

  function renderStep1() {
    var body = el('div', { class: 'qc-modal-body' });
    body.appendChild(el('p', { class: 'pair-step-blurb' },
      'Choose which peer should receive this handoff.'));

    var conns = (fx().connections || []).filter(function (c) {
      return c.health_state !== 'revoked';
    });

    if (conns.length === 0) {
      body.appendChild(el('div', { class: 'deliv-empty' }, [
        el('div', { class: 'deliv-empty-icon' }, '∅'),
        el('div', { class: 'deliv-empty-text' }, 'No active connections. Pair one first.'),
      ]));
    } else {
      var list = el('div', { class: 'composer-recipient-list' });
      conns.forEach(function (c) {
        var card = el('button', {
          type: 'button',
          class: 'composer-recipient-card' + (_state.recipientId === c.id ? ' is-selected' : ''),
        });
        card.appendChild(el('div', { class: 'pair-partner-avatar', style: 'width:36px; height:36px; font-size:16px; border-radius:10px;' },
          (c.display_name || '?').charAt(0).toUpperCase()));
        var col = el('div', { style: 'flex:1; min-width:0;' });
        col.appendChild(el('div', { style: 'font-size:13px; font-weight:600; color:var(--ink);' }, c.display_name));
        col.appendChild(el('div', { style: 'font-size:11px; color:var(--ink-mute); margin-top:2px;' },
          (c.remote_desk_capabilities || []).slice(0, 3).join(' · ') || 'no capabilities listed'));
        card.appendChild(col);

        var healthState = c.health_state || 'offline';
        var healthLabel = { healthy: 'Healthy', degraded: 'Degraded', offline: 'Offline', retrying: 'Retrying', invalid_token: 'Invalid token' }[healthState] || healthState;
        var pill = el('span', { class: 'conn-health-badge conn-health-' + healthState });
        pill.appendChild(el('span', { class: 'conn-health-dot' }));
        pill.appendChild(el('span', { class: 'conn-health-label' }, healthLabel));
        card.appendChild(pill);

        card.addEventListener('click', function () {
          _state.recipientId = c.id;
          render();
        });
        list.appendChild(card);
      });
      body.appendChild(list);
    }

    var footer = buildFooter({
      back: false,
      next: function () { _state.step = 2; render(); },
      nextDisabled: !_state.recipientId,
    });

    _modal.appendChild(buildHeader());
    _modal.appendChild(buildStepIndicator());
    _modal.appendChild(body);
    _modal.appendChild(footer);
  }

  // ── Step 2: pick form ─────────────────────────────────────────────────────

  function renderStep2() {
    var body = el('div', { class: 'qc-modal-body' });
    body.appendChild(el('p', { class: 'pair-step-blurb' },
      'Choose the handoff form. Each form has different consent rules — pick the one that matches the work.'));

    var grid = el('div', { class: 'composer-form-grid' });
    FORMS.forEach(function (f) {
      var card = el('button', {
        type: 'button',
        class: 'composer-form-card' + (_state.formKey === f.key ? ' is-selected' : ''),
      });
      card.appendChild(el('div', { class: 'composer-form-card-label' }, f.label));
      card.appendChild(el('div', { class: 'composer-form-card-blurb' }, f.blurb));
      card.addEventListener('click', function () {
        _state.formKey = f.key;
        render();
      });
      grid.appendChild(card);
    });
    body.appendChild(grid);

    var footer = buildFooter({
      back: true,
      next: function () { _state.step = 3; render(); },
      nextDisabled: !_state.formKey,
    });

    _modal.appendChild(buildHeader());
    _modal.appendChild(buildStepIndicator());
    _modal.appendChild(body);
    _modal.appendChild(footer);
  }

  // ── Step 3: per-form consent UI ──────────────────────────────────────────

  function renderStep3() {
    var f = getForm(_state.formKey);

    var body = el('div', { class: 'qc-modal-body' });

    // Verbatim consent quote from handoff-taxonomy.md
    body.appendChild(el('div', { class: 'composer-consent-quote' }, [
      el('div', { class: 'composer-consent-label' }, f.label + ' consent'),
      el('div', { class: 'composer-consent-text' }, '"' + f.consent + '"'),
      el('div', { class: 'composer-consent-cite' }, '— handoff-taxonomy.md § UI Consent Flow Per Form'),
    ]));

    if (f.key === 'direct_order') {
      var field = el('div', { class: 'qc-form-field' });
      field.appendChild(el('label', { class: 'qc-form-label', 'for': 'composer-order-text' }, 'Exact instruction'));
      var ta = el('textarea', { class: 'qc-form-input', id: 'composer-order-text', rows: '4',
        placeholder: 'e.g. Summarize the attached contract in 5 bullets. Cite each section.' });
      ta.value = _state.orderInstructions;
      ta.addEventListener('input', function () { _state.orderInstructions = ta.value; refreshNext(); });
      field.appendChild(ta);
      body.appendChild(field);

    } else if (f.key === 'direct_takeover') {
      var field2 = el('div', { class: 'qc-form-field' });
      field2.appendChild(el('label', { class: 'qc-form-label', 'for': 'composer-takeover-text' }, 'Goal (receiver decides how)'));
      var ta2 = el('textarea', { class: 'qc-form-input', id: 'composer-takeover-text', rows: '4',
        placeholder: 'e.g. Get this NDA signed by Friday. Use whatever channel works.' });
      ta2.value = _state.takeoverGoal;
      ta2.addEventListener('input', function () { _state.takeoverGoal = ta2.value; refreshNext(); });
      field2.appendChild(ta2);
      body.appendChild(field2);

    } else if (f.key === 'approval_chain') {
      var label = el('div', { class: 'qc-form-label' }, 'Approval chain (read-only stub)');
      body.appendChild(label);
      var chain = el('div', { class: 'composer-chain' });
      _state.approvalStages.forEach(function (stage, idx) {
        var node = el('div', { class: 'composer-chain-node' });
        node.appendChild(el('div', { class: 'composer-chain-num' }, String(idx + 1)));
        var col = el('div', { class: 'composer-chain-col' });
        col.appendChild(el('div', { class: 'composer-chain-stage' }, stage.stage));
        col.appendChild(el('div', { class: 'composer-chain-meta' }, stage.desk + ' · ' + stage.form));
        node.appendChild(col);
        chain.appendChild(node);
      });
      body.appendChild(chain);
      body.appendChild(el('p', { class: 'composer-chain-hint' },
        'Drag-and-drop chain builder lands in iter-002+. This stub demonstrates the visual layout only.'));

    } else if (f.key === 'watch_brief') {
      var sigField = el('div', { class: 'qc-form-field' });
      sigField.appendChild(el('label', { class: 'qc-form-label', 'for': 'composer-watch-signal' }, 'What to watch'));
      var sigInput = el('input', { class: 'qc-form-input', id: 'composer-watch-signal', type: 'text',
        placeholder: 'e.g. Vendor X pricing page' });
      sigInput.value = _state.watchSignal;
      sigInput.addEventListener('input', function () { _state.watchSignal = sigInput.value; refreshNext(); });
      sigField.appendChild(sigInput);
      body.appendChild(sigField);

      var msgField = el('div', { class: 'qc-form-field' });
      msgField.appendChild(el('label', { class: 'qc-form-label', 'for': 'composer-watch-msg' }, 'One-line message to receiver'));
      var msgInput = el('input', { class: 'qc-form-input', id: 'composer-watch-msg', type: 'text',
        placeholder: 'e.g. Let me know if their pricing changes.' });
      msgInput.value = _state.watchMessage;
      msgInput.addEventListener('input', function () { _state.watchMessage = msgInput.value; refreshNext(); });
      msgField.appendChild(msgInput);
      body.appendChild(msgField);
    }

    function isStep3Valid() {
      if (f.key === 'direct_order')    return !!_state.orderInstructions.trim();
      if (f.key === 'direct_takeover') return !!_state.takeoverGoal.trim();
      if (f.key === 'approval_chain')  return true; // stub is always valid
      if (f.key === 'watch_brief')     return !!_state.watchSignal.trim() && !!_state.watchMessage.trim();
      return true;
    }

    var footer = buildFooter({
      back: true,
      next: function () { _state.step = 4; render(); },
      nextLabel: 'Review',
      nextDisabled: !isStep3Valid(),
    });

    function refreshNext() {
      var nextBtn = footer.querySelector('.qc-submit-btn:last-child');
      if (nextBtn) nextBtn.disabled = !isStep3Valid();
    }

    _modal.appendChild(buildHeader());
    _modal.appendChild(buildStepIndicator());
    _modal.appendChild(body);
    _modal.appendChild(footer);
  }

  // ── Step 4: confirm + send ────────────────────────────────────────────────

  function renderStep4() {
    var f = getForm(_state.formKey);
    var conn = (fx().connections || []).find(function (c) { return c.id === _state.recipientId; });

    var body = el('div', { class: 'qc-modal-body' });
    body.appendChild(el('p', { class: 'pair-step-blurb' },
      'Review the handoff. Nothing is sent until you click <strong>Send</strong>.'));

    var summary = el('div', { class: 'composer-summary' });
    summary.appendChild(buildSummaryRow('Recipient', conn ? conn.display_name : '—'));
    summary.appendChild(buildSummaryRow('Form',      f.label));
    summary.appendChild(buildSummaryRow('Consent',   '"' + f.consent + '"'));

    if (f.key === 'direct_order')    summary.appendChild(buildSummaryRow('Instruction',  _state.orderInstructions));
    if (f.key === 'direct_takeover') summary.appendChild(buildSummaryRow('Goal',         _state.takeoverGoal));
    if (f.key === 'approval_chain')  summary.appendChild(buildSummaryRow('Chain length', _state.approvalStages.length + ' stages'));
    if (f.key === 'watch_brief')     {
      summary.appendChild(buildSummaryRow('Watching', _state.watchSignal));
      summary.appendChild(buildSummaryRow('Message',  _state.watchMessage));
    }
    body.appendChild(summary);

    var footer = buildFooter({
      back: true,
      next: function () {
        close();
        showToast('Handoff sent to ' + (conn ? conn.display_name : 'recipient') + ' (mock)');
      },
      nextLabel: f.sendLabel,
    });

    _modal.appendChild(buildHeader());
    _modal.appendChild(buildStepIndicator());
    _modal.appendChild(body);
    _modal.appendChild(footer);
  }

  function buildSummaryRow(key, val) {
    var row = el('div', { class: 'composer-summary-row' });
    row.appendChild(el('div', { class: 'composer-summary-key' }, key));
    row.appendChild(el('div', { class: 'composer-summary-val' }, val || '—'));
    return row;
  }

  function render() {
    if (!_modal) return;
    _modal.innerHTML = '';
    switch (_state.step) {
      case 1: return renderStep1();
      case 2: return renderStep2();
      case 3: return renderStep3();
      case 4: return renderStep4();
    }
  }

  window.HOLON_COMPOSER = { open: open, close: close };
})();
