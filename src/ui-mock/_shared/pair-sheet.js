/* pair-sheet.js — 5-step "Pair new connection" sheet (iter-001b step 7).
 *
 * No mibusy equivalent — designed fresh. Reuses the qc-* modal scaffold
 * styles already in drawer.css (qc-backdrop / qc-modal / qc-modal-header /
 * qc-form-input / qc-submit-btn) for visual consistency with the
 * quick-create modal.
 *
 * Steps:
 *  1. Target          — text input for peer code (mock; no real pairing)
 *  2. Confirm         — mocked prospective partner card; "Confirm pairing"
 *  3. Wait            — spinner; auto-advances after 2s
 *  4. Policies        — accepted-forms multi-select + rate limit
 *  5. Done            — "Connected!" + close button → toast
 *
 * Cancel at any step closes without toast.
 * No fixture mutation (mock-only flow).
 *
 * Exposes: window.HOLON_PAIR_SHEET.open()
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

  function showToast(msg) {
    if (window.HOLON_DRAWER && window.HOLON_DRAWER.showToast) {
      window.HOLON_DRAWER.showToast(msg);
    }
  }

  var _bd = null;
  var _modal = null;
  var _state = {
    step: 1,
    targetCode: '',
    acceptedForms: ['direct_order', 'advisory'],
    rateLimit: 100,
    autoAdvanceTimer: null,
  };

  var FORM_OPTIONS = [
    { key: 'direct_order',       label: 'Direct order' },
    { key: 'advisory',           label: 'Advisory' },
    { key: 'subcontracting',     label: 'Subcontracting' },
    { key: 'dual_authorization', label: 'Dual authorization' },
  ];

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  function open() {
    close(); // clear any prior instance
    _state = { step: 1, targetCode: '', acceptedForms: ['direct_order', 'advisory'], rateLimit: 100, autoAdvanceTimer: null };

    _bd = el('div', { class: 'qc-backdrop' });
    _bd.addEventListener('click', function (ev) { if (ev.target === _bd) close(); });

    _modal = el('div', { class: 'qc-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pair new connection' });
    _bd.appendChild(_modal);
    document.body.appendChild(_bd);

    document.addEventListener('keydown', escHandler);
    render();
  }

  function close() {
    if (_state.autoAdvanceTimer) { clearTimeout(_state.autoAdvanceTimer); _state.autoAdvanceTimer = null; }
    document.removeEventListener('keydown', escHandler);
    if (_bd) { _bd.remove(); _bd = null; _modal = null; }
  }

  function escHandler(ev) {
    if (ev.key === 'Escape') close();
  }

  // ── Header (shared across all steps) ─────────────────────────────────────

  function buildHeader() {
    var header = el('div', { class: 'qc-modal-header' });
    header.appendChild(el('div', { class: 'qc-modal-title' }, 'Pair new connection'));
    var closeBtn = el('button', { class: 'drawer-close-btn', type: 'button', 'aria-label': 'Cancel pairing' });
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.addEventListener('click', close);
    header.appendChild(closeBtn);
    return header;
  }

  function buildStepIndicator() {
    var indicator = el('div', { class: 'pair-step-indicator' });
    for (var i = 1; i <= 5; i++) {
      var dot = el('span', {
        class: 'pair-step-dot' + (i === _state.step ? ' is-active' : '') + (i < _state.step ? ' is-done' : ''),
      });
      indicator.appendChild(dot);
    }
    indicator.appendChild(el('span', { class: 'pair-step-label' }, 'Step ' + _state.step + ' of 5'));
    return indicator;
  }

  function buildFooter(opts) {
    // opts: { back: bool, next: bool|fn, nextLabel: str, cancelOnly: bool }
    var footer = el('div', { class: 'pair-sheet-footer' });
    if (opts.cancelOnly) {
      var cancelBtn = el('button', { class: 'qc-submit-btn', type: 'button', style: 'background:#fff; color:var(--ink); border:1px solid var(--line);' }, 'Cancel');
      cancelBtn.addEventListener('click', close);
      footer.appendChild(cancelBtn);
      return footer;
    }
    var back = el('button', { class: 'qc-submit-btn', type: 'button', style: 'background:#fff; color:var(--ink); border:1px solid var(--line);' }, 'Back');
    if (!opts.back) back.disabled = true;
    back.addEventListener('click', function () {
      if (_state.step > 1) { _state.step -= 1; render(); }
    });
    footer.appendChild(back);

    var spacer = el('div', { style: 'flex:1;' });
    footer.appendChild(spacer);

    if (opts.cancel !== false) {
      var cancelMid = el('button', { class: 'qc-submit-btn', type: 'button', style: 'background:transparent; color:var(--ink-mute); border:none; box-shadow:none;' }, 'Cancel');
      cancelMid.addEventListener('click', close);
      footer.appendChild(cancelMid);
    }

    if (opts.next) {
      var next = el('button', { class: 'qc-submit-btn', type: 'button' }, opts.nextLabel || 'Next');
      if (opts.next === false) next.disabled = true;
      next.addEventListener('click', function () {
        if (typeof opts.next === 'function') opts.next();
        else if (_state.step < 5) { _state.step += 1; render(); }
      });
      footer.appendChild(next);
    }
    return footer;
  }

  // ── Steps ─────────────────────────────────────────────────────────────────

  function renderStep1() {
    var body = el('div', { class: 'qc-modal-body' });
    body.appendChild(el('p', { class: 'pair-step-blurb' },
      'Enter the personal pairing code your peer shared with you. Codes are short, single-use, and expire after 24 hours.'));

    var field = el('div', { class: 'qc-form-field' });
    field.appendChild(el('label', { class: 'qc-form-label', 'for': 'pair-code-input' }, 'Personal code'));
    var input = el('input', {
      class: 'qc-form-input', id: 'pair-code-input', type: 'text',
      placeholder: 'e.g.  HOL-7K9A-2NMC',
      value: _state.targetCode,
    });
    input.addEventListener('input', function () {
      _state.targetCode = input.value;
      nextBtn.disabled = !_state.targetCode.trim();
    });
    field.appendChild(input);
    body.appendChild(field);

    // Empty suggestion list (mock placeholder)
    var sug = el('div', { class: 'pair-suggestions' });
    sug.appendChild(el('div', { class: 'pair-suggestions-empty' },
      'No saved peers yet. Paste a code or scan a QR (coming in iter-001c).'));
    body.appendChild(sug);

    var footer = buildFooter({ back: false, next: true });
    var nextBtn = footer.querySelector('.qc-submit-btn:last-child');
    nextBtn.disabled = !_state.targetCode.trim();

    _modal.appendChild(buildHeader());
    _modal.appendChild(buildStepIndicator());
    _modal.appendChild(body);
    _modal.appendChild(footer);

    setTimeout(function () { input.focus(); }, 50);
  }

  function renderStep2() {
    var body = el('div', { class: 'qc-modal-body' });
    body.appendChild(el('p', { class: 'pair-step-blurb' },
      'Looking up <code>' + _state.targetCode + '</code> — here is who you are about to connect with:'));

    // Mocked prospective partner card
    var card = el('div', { class: 'pair-partner-card' });
    card.appendChild(el('div', { class: 'pair-partner-avatar' }, 'N'));
    var col = el('div', { class: 'pair-partner-col' });
    col.appendChild(el('div', { class: 'pair-partner-name' }, 'Nora'));
    col.appendChild(el('div', { class: 'pair-partner-meta' }, 'Nora\'s desk · person_01HKQ8NORA…XCKWTC'));
    col.appendChild(el('div', { class: 'pair-partner-caps' }, 'Capabilities: research · drafting · review'));
    card.appendChild(col);
    body.appendChild(card);

    body.appendChild(el('p', { class: 'pair-step-blurb', style: 'margin-top:12px; color:var(--ink-mute); font-size:12px;' },
      'A signed handshake will be exchanged. No data is sent until you confirm.'));

    var footer = buildFooter({
      back: true,
      next: function () { _state.step = 3; render(); },
      nextLabel: 'Confirm pairing',
    });
    _modal.appendChild(buildHeader());
    _modal.appendChild(buildStepIndicator());
    _modal.appendChild(body);
    _modal.appendChild(footer);
  }

  function renderStep3() {
    var body = el('div', { class: 'qc-modal-body' });
    var wait = el('div', { class: 'pair-wait' });
    wait.appendChild(el('div', { class: 'pair-spinner' }));
    wait.appendChild(el('div', { class: 'pair-wait-text' }, 'Waiting for Nora to accept…'));
    wait.appendChild(el('div', { class: 'pair-wait-sub' }, 'They will see a request in their inbox.'));
    body.appendChild(wait);

    var footer = buildFooter({ cancelOnly: true });

    _modal.appendChild(buildHeader());
    _modal.appendChild(buildStepIndicator());
    _modal.appendChild(body);
    _modal.appendChild(footer);

    // Auto-advance after 2s
    if (_state.autoAdvanceTimer) clearTimeout(_state.autoAdvanceTimer);
    _state.autoAdvanceTimer = setTimeout(function () {
      _state.autoAdvanceTimer = null;
      if (_state.step === 3) { _state.step = 4; render(); }
    }, 2000);
  }

  function renderStep4() {
    var body = el('div', { class: 'qc-modal-body' });
    body.appendChild(el('p', { class: 'pair-step-blurb' },
      'Choose which handoff forms Nora may send you, and set a daily rate limit.'));

    var formsField = el('div', { class: 'qc-form-field' });
    formsField.appendChild(el('label', { class: 'qc-form-label' }, 'Accepted forms'));
    var chipRow = el('div', { class: 'pair-form-chips' });
    FORM_OPTIONS.forEach(function (opt) {
      var on = _state.acceptedForms.indexOf(opt.key) >= 0;
      var chip = el('button', {
        type: 'button',
        class: 'pair-form-chip' + (on ? ' is-on' : ''),
      }, opt.label);
      chip.addEventListener('click', function () {
        var i = _state.acceptedForms.indexOf(opt.key);
        if (i >= 0) _state.acceptedForms.splice(i, 1);
        else        _state.acceptedForms.push(opt.key);
        chip.classList.toggle('is-on');
      });
      chipRow.appendChild(chip);
    });
    formsField.appendChild(chipRow);
    body.appendChild(formsField);

    var rateField = el('div', { class: 'qc-form-field' });
    rateField.appendChild(el('label', { class: 'qc-form-label', 'for': 'pair-rate-input' }, 'Rate limit (handoffs / day)'));
    var rateInput = el('input', {
      class: 'qc-form-input', id: 'pair-rate-input', type: 'number',
      min: '1', max: '10000', value: String(_state.rateLimit),
    });
    rateInput.addEventListener('input', function () {
      _state.rateLimit = parseInt(rateInput.value, 10) || 0;
    });
    rateField.appendChild(rateInput);
    body.appendChild(rateField);

    var footer = buildFooter({
      back: true,
      next: function () { _state.step = 5; render(); },
      nextLabel: 'Finish',
    });
    _modal.appendChild(buildHeader());
    _modal.appendChild(buildStepIndicator());
    _modal.appendChild(body);
    _modal.appendChild(footer);
  }

  function renderStep5() {
    var body = el('div', { class: 'qc-modal-body' });
    var done = el('div', { class: 'pair-done' });
    done.appendChild(el('div', { class: 'pair-done-check', html: '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>' }));
    done.appendChild(el('div', { class: 'pair-done-title' }, 'Connected!'));
    done.appendChild(el('div', { class: 'pair-done-name' }, 'Nora'));
    done.appendChild(el('div', { class: 'pair-done-sub' },
      'Accepted forms: ' + (_state.acceptedForms.length ? _state.acceptedForms.join(', ') : 'none') +
      ' · ' + _state.rateLimit + '/day'));
    body.appendChild(done);

    var footer = el('div', { class: 'pair-sheet-footer' });
    var doneBtn = el('button', { class: 'qc-submit-btn', type: 'button' }, 'Done');
    doneBtn.addEventListener('click', function () {
      close();
      showToast('Connection added (mock)');
    });
    footer.appendChild(el('div', { style: 'flex:1;' }));
    footer.appendChild(doneBtn);

    _modal.appendChild(buildHeader());
    _modal.appendChild(buildStepIndicator());
    _modal.appendChild(body);
    _modal.appendChild(footer);
  }

  function render() {
    if (!_modal) return;
    _modal.innerHTML = '';
    switch (_state.step) {
      case 1: return renderStep1();
      case 2: return renderStep2();
      case 3: return renderStep3();
      case 4: return renderStep4();
      case 5: return renderStep5();
    }
  }

  window.HOLON_PAIR_SHEET = { open: open, close: close };
})();
