/* quick-create.js — "+ New" quick-create modal for Holon UI mock.
 *
 * Per iter-001a-patch Task 3.
 *
 * 3-way picker → form per type:
 *   New Assignment  → title + member dropdown + body textarea → create → toast
 *   New Handoff     → handoff form picker (per handoff-taxonomy.md) → config → send → toast
 *   New Member      → substrate picker → role + name → autonomy → save → toast
 *                     (Ported from mibusy AgentSheet.tsx ManageDrawer field style.
 *                      AgentForm.tsx does not exist in mibusy; designed fresh.)
 *
 * CSS is in drawer.css (qc-* classes).
 *
 * Exposes: window.HOLON_QUICKCREATE
 *   .open(defaultType?)  — opens modal; optional default type skips picker
 *
 * No frameworks. No build step. Vanilla DOM.
 */

(function () {
  'use strict';

  // ─── DOM helpers ──────────────────────────────────────────────────────────

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class')     node.className  = attrs[k];
        else if (k === 'html') node.innerHTML  = attrs[k];
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

  var CLOSE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var BACK_SVG  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';

  // ─── Data helpers ──────────────────────────────────────────────────────────

  function fx() { return window.HOLON_FIXTURES || {}; }
  function getStaff() { return fx().staff || []; }

  // ─── Handoff forms from handoff-taxonomy.md ───────────────────────────────

  var HANDOFF_FORMS = [
    { key: 'direct_order',       label: 'Direct order',       desc: 'Sender assigns a specific task; receiver accepts/rejects.' },
    { key: 'standing_request',   label: 'Standing request',   desc: 'Ongoing authorization to perform a class of tasks.' },
    { key: 'advisory',           label: 'Advisory',           desc: 'Provide expert opinion; receiver can accept/modify.' },
    { key: 'subcontracting',     label: 'Subcontracting',     desc: 'Sender delegates full execution + sub-delegation rights.' },
    { key: 'dual_authorization', label: 'Dual authorization', desc: 'Both parties must sign off before execution.' },
    { key: 'observer_brief',     label: 'Observer brief',     desc: 'One-way FYI; no response or action expected.' },
  ];

  // ─── Toast via HOLON_DRAWER ───────────────────────────────────────────────

  function toast(msg, kind) {
    if (window.HOLON_DRAWER && typeof window.HOLON_DRAWER.showToast === 'function') {
      window.HOLON_DRAWER.showToast(msg, kind || 'success');
    } else {
      // eslint-disable-next-line no-console
      console.info('[quick-create] ' + msg);
    }
  }

  // ─── Modal scaffold ───────────────────────────────────────────────────────

  var _bd = null;

  function openModal(buildBodyFn) {
    // Close any existing
    if (_bd) _bd.remove();

    _bd = el('div', { class: 'qc-backdrop' });
    _bd.addEventListener('click', function (ev) {
      if (ev.target === _bd) close();
    });

    var modal = el('div', { class: 'qc-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Create new' });

    buildBodyFn(modal, close);

    _bd.appendChild(modal);
    document.body.appendChild(_bd);

    // Esc closes
    document.addEventListener('keydown', function esc(ev) {
      if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });
  }

  function close() {
    if (_bd) { _bd.remove(); _bd = null; }
  }

  function makeCloseBtn() {
    var btn = el('button', {
      class: 'drawer-close-btn',
      type: 'button',
      'aria-label': 'Close',
    });
    btn.innerHTML = CLOSE_SVG;
    btn.addEventListener('click', close);
    return btn;
  }

  // ─── Picker view ──────────────────────────────────────────────────────────

  var OPTIONS = [
    {
      key:   'assignment',
      icon:  '📋',
      label: 'New Assignment',
      desc:  'Delegate a task to a member of your local team.',
    },
    {
      key:   'handoff',
      icon:  '📤',
      label: 'New Handoff',
      desc:  'Send typed work to a peer connection via a handoff form.',
    },
    {
      key:   'member',
      icon:  '👤',
      label: 'New Member',
      desc:  'Add a local AI, CLI, peer, or myself member to your team.',
    },
  ];

  function buildPicker(modal, onPick) {
    var header = el('div', { class: 'qc-modal-header' });
    header.appendChild(el('div', { class: 'qc-modal-title' }, 'Create what?'));
    header.appendChild(makeCloseBtn());
    modal.appendChild(header);

    var body = el('div', { class: 'qc-modal-body' });

    OPTIONS.forEach(function (opt) {
      var card = el('button', { class: 'qc-option-card', type: 'button' });
      var icon = el('div', { class: 'qc-option-icon' }, opt.icon);
      var text = el('div', { class: 'qc-option-text' });
      text.appendChild(el('div', { class: 'qc-option-label' }, opt.label));
      text.appendChild(el('div', { class: 'qc-option-desc' }, opt.desc));
      card.appendChild(icon);
      card.appendChild(text);
      card.addEventListener('click', function () { onPick(opt.key); });
      body.appendChild(card);
    });

    modal.appendChild(body);
  }

  // ─── Assignment form ──────────────────────────────────────────────────────

  function buildAssignmentForm(modal) {
    modal.innerHTML = '';

    var header = el('div', { class: 'qc-modal-header' });
    var back = el('button', { class: 'qc-back-btn', type: 'button', style: 'padding:6px 10px;' });
    back.innerHTML = BACK_SVG;
    back.addEventListener('click', function () { buildPickerInModal(modal); });
    header.appendChild(back);
    header.appendChild(el('div', { class: 'qc-modal-title' }, 'New Assignment'));
    header.appendChild(makeCloseBtn());
    modal.appendChild(header);

    var body = el('div', { class: 'qc-modal-body' });
    var form = el('div', { class: 'qc-form' });

    // Title
    var titleField = el('div', { class: 'qc-form-field' });
    titleField.appendChild(el('label', { class: 'qc-form-label', 'for': 'qc-assign-title' }, 'Task title'));
    var titleInput = el('input', {
      class: 'qc-form-input',
      id: 'qc-assign-title',
      type: 'text',
      placeholder: 'e.g. Draft Q3 competitive analysis',
    });
    titleField.appendChild(titleInput);
    form.appendChild(titleField);

    // Member dropdown
    var memberField = el('div', { class: 'qc-form-field' });
    memberField.appendChild(el('label', { class: 'qc-form-label', 'for': 'qc-assign-member' }, 'Assign to'));
    var memberSel = el('select', { class: 'qc-form-select', id: 'qc-assign-member' });
    memberSel.appendChild(el('option', { value: '' }, '— Select member —'));
    getStaff().filter(function (s) { return s.status === 'active'; }).forEach(function (s) {
      memberSel.appendChild(el('option', { value: s.id }, s.name + ' (' + (s.role_label || s.role_name) + ')'));
    });
    memberField.appendChild(memberSel);
    form.appendChild(memberField);

    // ADR-016: Mentor routing toggle — shown only when selected member is a local_ai with mentors[]
    var mentorToggleField = el('div', { class: 'qc-form-field composer-mentor-toggle', id: 'qc-mentor-toggle-wrap', style: 'display:none;' });
    mentorToggleField.appendChild(el('div', { class: 'qc-form-label' }, 'Route via'));

    var routeState = { selected: 'ai' }; // default: "Let AI handle"
    var toggleWrap = el('div', { style: 'display:flex; gap:6px; flex-wrap:wrap; align-items:center;' });

    var aiBtn = el('button', { class: 'qc-substrate-btn selected', type: 'button', id: 'qc-route-ai' }, 'Let AI handle');
    var mentorDropLabel = el('label', {
      class: 'qc-form-label',
      'for': 'qc-route-mentor-sel',
      style: 'display:none; margin:0; font-weight:500; font-size:12px;',
    }, 'Send to mentor:');
    var mentorDropSel = el('select', { class: 'qc-form-select', id: 'qc-route-mentor-sel', style: 'display:none; min-width:160px;' });

    aiBtn.addEventListener('click', function () {
      aiBtn.classList.add('selected');
      routeState.selected = 'ai';
      mentorDropLabel.style.display = 'none';
      mentorDropSel.style.display = 'none';
    });

    toggleWrap.appendChild(aiBtn);
    toggleWrap.appendChild(mentorDropLabel);
    toggleWrap.appendChild(mentorDropSel);
    mentorToggleField.appendChild(toggleWrap);
    form.appendChild(mentorToggleField);

    // Rebuild mentor dropdown when member selection changes
    memberSel.addEventListener('change', function () {
      var selectedId = memberSel.value;
      var staff = getStaff().find(function (s) { return s.id === selectedId; });
      var hasMentors = staff && staff.substrate && staff.substrate.kind === 'local_ai' &&
                       staff.substrate.mentors && staff.substrate.mentors.length > 0;

      mentorToggleField.style.display = hasMentors ? '' : 'none';
      routeState.selected = 'ai';
      aiBtn.classList.add('selected');
      mentorDropLabel.style.display = 'none';
      mentorDropSel.style.display = 'none';

      if (hasMentors) {
        // Rebuild mentor dropdown options
        mentorDropSel.innerHTML = '';
        staff.substrate.mentors.forEach(function (m, idx) {
          // Look up mentor name via connections
          var conn = ((fx().connections) || []).find(function (c) { return c.id === m.peer_id; });
          var mentorName = conn ? conn.display_name : m.peer_id;
          var opt = el('option', { value: idx }, mentorName + ' (' + m.domain + ')');
          mentorDropSel.appendChild(opt);
        });

        // Add a "Send to mentor" button alongside aiBtn
        var existingMentorBtn = toggleWrap.querySelector('#qc-route-mentor-btn');
        if (!existingMentorBtn) {
          var mentorBtn = el('button', { class: 'qc-substrate-btn', type: 'button', id: 'qc-route-mentor-btn' }, 'Send to mentor');
          mentorBtn.addEventListener('click', function () {
            aiBtn.classList.remove('selected');
            mentorBtn.classList.add('selected');
            routeState.selected = 'mentor';
            mentorDropLabel.style.display = '';
            mentorDropSel.style.display = '';
          });
          // Insert before mentorDropLabel
          toggleWrap.insertBefore(mentorBtn, mentorDropLabel);
        }
      }
    });

    // Body textarea
    var bodyField = el('div', { class: 'qc-form-field' });
    bodyField.appendChild(el('label', { class: 'qc-form-label', 'for': 'qc-assign-body' }, 'Instructions'));
    var bodyInput = el('textarea', {
      class: 'qc-form-textarea',
      id: 'qc-assign-body',
      placeholder: 'Describe what you want done…',
    });
    bodyInput.rows = 4;
    bodyField.appendChild(bodyInput);
    form.appendChild(bodyField);

    // Actions
    var actions = el('div', { class: 'qc-form-actions' });
    var cancelBtn = el('button', { class: 'qc-back-btn', type: 'button' }, 'Cancel');
    cancelBtn.addEventListener('click', close);
    var submitBtn = el('button', { class: 'qc-submit-btn', type: 'button' }, 'Create assignment');
    submitBtn.addEventListener('click', function () {
      var title  = titleInput.value.trim();
      var member = memberSel.value;
      var body   = bodyInput.value.trim();
      if (!title || !member) {
        titleInput.style.borderColor = !title ? 'var(--purple)' : '';
        memberSel.style.borderColor = !member ? 'var(--purple)' : '';
        return;
      }
      var staffRec = (getStaff().find(function (s) { return s.id === member; }) || {});
      var staffName = staffRec.name || 'member';

      // ADR-016: if owner chose "Send to mentor", show mentor-routing toast
      if (routeState.selected === 'mentor') {
        var mentorIdx = parseInt(mentorDropSel.value || '0', 10);
        var mentors = (staffRec.substrate && staffRec.substrate.mentors) || [];
        var chosenMentor = mentors[mentorIdx];
        var mentorConn = chosenMentor ? ((fx().connections || []).find(function (c) { return c.id === chosenMentor.peer_id; })) : null;
        var mentorName = mentorConn ? mentorConn.display_name : (chosenMentor ? chosenMentor.peer_id : 'mentor');
        close();
        toast('Mock: would consult ' + mentorName + ' for this assignment (ADR-016 V1)', 'success');
        // eslint-disable-next-line no-console
        console.info('[quick-create] mentor routing (mock):', { title: title, assignedTo: member, mentor: mentorName, body: body });
      } else {
        close();
        toast('Assignment "' + title + '" created → ' + staffName + ' (mock)', 'success');
        // eslint-disable-next-line no-console
        console.info('[quick-create] assignment created (mock):', { title: title, assignedTo: member, body: body });
      }
    });
    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    form.appendChild(actions);

    body.appendChild(form);
    modal.appendChild(body);

    titleInput.focus();
  }

  // ─── Handoff form picker ──────────────────────────────────────────────────
  // Per handoff-taxonomy.md § UI Consent Flow Per Form.

  function buildHandoffForm(modal) {
    modal.innerHTML = '';

    var header = el('div', { class: 'qc-modal-header' });
    var back = el('button', { class: 'qc-back-btn', type: 'button', style: 'padding:6px 10px;' });
    back.innerHTML = BACK_SVG;
    back.addEventListener('click', function () { buildPickerInModal(modal); });
    header.appendChild(back);
    header.appendChild(el('div', { class: 'qc-modal-title' }, 'New Handoff'));
    header.appendChild(makeCloseBtn());
    modal.appendChild(header);

    var body = el('div', { class: 'qc-modal-body' });

    body.appendChild(el('div', {
      style: 'font-size:13px; color:var(--ink-mute); margin-bottom:4px;',
    }, 'Choose a handoff form type:'));

    var selectedForm = { key: null };
    var grid = el('div', { class: 'handoff-form-grid' });

    HANDOFF_FORMS.forEach(function (f) {
      var btn = el('button', { class: 'handoff-form-btn', type: 'button' });
      btn.appendChild(el('div', { class: 'handoff-form-btn-label' }, f.label));
      btn.appendChild(el('div', { class: 'handoff-form-btn-desc' }, f.desc));
      btn.addEventListener('click', function () {
        grid.querySelectorAll('.handoff-form-btn').forEach(function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        selectedForm.key = f.key;
      });
      grid.appendChild(btn);
    });
    body.appendChild(grid);

    // Connection dropdown (who to send to)
    var connField = el('div', { class: 'qc-form-field', style: 'margin-top:12px;' });
    connField.appendChild(el('label', { class: 'qc-form-label', 'for': 'qc-handoff-conn' }, 'Send to connection'));
    var connSel = el('select', { class: 'qc-form-select', id: 'qc-handoff-conn' });
    connSel.appendChild(el('option', { value: '' }, '— Select connection —'));
    (fx().connections || []).filter(function (c) { return c.health_state === 'healthy'; }).forEach(function (c) {
      connSel.appendChild(el('option', { value: c.id }, c.display_name));
    });
    connField.appendChild(connSel);
    body.appendChild(connField);

    // Brief
    var briefField = el('div', { class: 'qc-form-field', style: 'margin-top:4px;' });
    briefField.appendChild(el('label', { class: 'qc-form-label', 'for': 'qc-handoff-brief' }, 'Brief'));
    var briefInput = el('textarea', { class: 'qc-form-textarea', id: 'qc-handoff-brief', placeholder: 'Describe what you need from the peer…' });
    briefInput.rows = 3;
    briefField.appendChild(briefInput);
    body.appendChild(briefField);

    // Actions
    var actions = el('div', { class: 'qc-form-actions', style: 'margin-top:8px;' });
    var cancelBtn = el('button', { class: 'qc-back-btn', type: 'button' }, 'Cancel');
    cancelBtn.addEventListener('click', close);
    var sendBtn = el('button', { class: 'qc-submit-btn', type: 'button' }, 'Send handoff');
    sendBtn.addEventListener('click', function () {
      if (!selectedForm.key || !connSel.value) {
        if (!selectedForm.key) {
          grid.style.outline = '2px solid var(--purple)';
          grid.style.borderRadius = '10px';
        }
        connSel.style.borderColor = !connSel.value ? 'var(--purple)' : '';
        return;
      }
      var connName = (connSel.options[connSel.selectedIndex] || {}).text || connSel.value;
      var formLabel = (HANDOFF_FORMS.find(function (f) { return f.key === selectedForm.key; }) || {}).label || selectedForm.key;
      close();
      toast(formLabel + ' handoff sent to ' + connName + ' (mock)', 'success');
      // eslint-disable-next-line no-console
      console.info('[quick-create] handoff sent (mock):', { form: selectedForm.key, to: connSel.value, brief: briefInput.value });
    });
    actions.appendChild(cancelBtn);
    actions.appendChild(sendBtn);
    body.appendChild(actions);

    modal.appendChild(body);
  }

  // ─── New Member form ──────────────────────────────────────────────────────
  // Ported field style from mibusy AgentSheet.tsx ManageDrawer (InlineField pattern).
  // Substrate picker from mibusy FacadeConfig.tsx mode-badge concept.
  // AgentForm.tsx does not exist in mibusy repo — designed fresh.

  var SUBSTRATES = [
    { key: 'local_ai', icon: '🤖', label: 'Local AI' },
    { key: 'cli',      icon: '💻', label: 'CLI' },
    { key: 'peer',     icon: '🔗', label: 'Peer' },
    { key: 'myself',   icon: '👤', label: 'Myself' },
  ];

  var AUTONOMY_LEVELS = ['Supervised', 'Bounded', 'Autonomous'];

  function buildMemberForm(modal) {
    modal.innerHTML = '';

    var header = el('div', { class: 'qc-modal-header' });
    var back = el('button', { class: 'qc-back-btn', type: 'button', style: 'padding:6px 10px;' });
    back.innerHTML = BACK_SVG;
    back.addEventListener('click', function () { buildPickerInModal(modal); });
    header.appendChild(back);
    header.appendChild(el('div', { class: 'qc-modal-title' }, 'New Member'));
    header.appendChild(makeCloseBtn());
    modal.appendChild(header);

    var body = el('div', { class: 'qc-modal-body' });
    var form = el('div', { class: 'qc-form' });

    // Substrate picker (ported concept from FacadeConfig.tsx mode toggle)
    var selectedSubstrate = { key: null };
    var subField = el('div', { class: 'qc-form-field' });
    subField.appendChild(el('div', { class: 'qc-form-label' }, 'Substrate type'));
    var subGrid = el('div', { class: 'qc-substrate-grid' });
    SUBSTRATES.forEach(function (sub) {
      var btn = el('button', { class: 'qc-substrate-btn', type: 'button' });
      btn.appendChild(el('span', { class: 'qc-substrate-btn-icon' }, sub.icon));
      btn.appendChild(el('span', { class: 'qc-substrate-btn-label' }, sub.label));
      btn.addEventListener('click', function () {
        subGrid.querySelectorAll('.qc-substrate-btn').forEach(function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        selectedSubstrate.key = sub.key;
      });
      subGrid.appendChild(btn);
    });
    subField.appendChild(subGrid);
    form.appendChild(subField);

    // Name
    var nameField = el('div', { class: 'qc-form-field' });
    nameField.appendChild(el('label', { class: 'qc-form-label', 'for': 'qc-member-name' }, 'Name'));
    var nameInput = el('input', {
      class: 'qc-form-input',
      id: 'qc-member-name',
      type: 'text',
      placeholder: 'e.g. Aria, gh-ci, Peer-Bob',
    });
    nameField.appendChild(nameInput);
    form.appendChild(nameField);

    // Role
    var roleField = el('div', { class: 'qc-form-field' });
    roleField.appendChild(el('label', { class: 'qc-form-label', 'for': 'qc-member-role' }, 'Role / job title'));
    var roleInput = el('input', {
      class: 'qc-form-input',
      id: 'qc-member-role',
      type: 'text',
      placeholder: 'e.g. Researcher, Executor, Outbound Drafter',
    });
    roleField.appendChild(roleInput);
    form.appendChild(roleField);

    // Autonomy (select) — N/A for peer / myself
    var selectedAutonomy = { level: 'Supervised' };
    var autoField = el('div', { class: 'qc-form-field' });
    autoField.appendChild(el('label', { class: 'qc-form-label', 'for': 'qc-member-autonomy' }, 'Autonomy level'));
    var autoSel = el('select', { class: 'qc-form-select', id: 'qc-member-autonomy' });
    AUTONOMY_LEVELS.forEach(function (level) {
      autoSel.appendChild(el('option', { value: level }, level));
    });
    autoSel.addEventListener('change', function () { selectedAutonomy.level = autoSel.value; });
    autoField.appendChild(autoSel);
    autoField.appendChild(el('div', { style: 'font-size:11px; color:var(--ink-mute); margin-top:3px;' },
      'N/A for peer and myself substrates.'));
    form.appendChild(autoField);

    // Actions
    var actions = el('div', { class: 'qc-form-actions' });
    var cancelBtn = el('button', { class: 'qc-back-btn', type: 'button' }, 'Cancel');
    cancelBtn.addEventListener('click', close);
    var saveBtn = el('button', { class: 'qc-submit-btn', type: 'button' }, 'Save member');
    saveBtn.addEventListener('click', function () {
      var name = nameInput.value.trim();
      var role = roleInput.value.trim();
      if (!selectedSubstrate.key || !name) {
        if (!selectedSubstrate.key) { subGrid.style.outline = '2px solid var(--purple)'; subGrid.style.borderRadius = '10px'; }
        if (!name) nameInput.style.borderColor = 'var(--purple)';
        return;
      }
      close();
      toast(name + ' added as ' + (SUBSTRATES.find(function (s) { return s.key === selectedSubstrate.key; }) || {}).label + ' member (mock)', 'success');
      // eslint-disable-next-line no-console
      console.info('[quick-create] member created (mock):', {
        name: name, role: role,
        substrate: selectedSubstrate.key, autonomy: selectedAutonomy.level,
      });
    });
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    body.appendChild(form);
    modal.appendChild(body);

    nameInput.focus();
  }

  // ─── Picker helper (re-builds picker into existing modal) ─────────────────

  function buildPickerInModal(modal) {
    modal.innerHTML = '';
    buildPicker(modal, function (type) {
      if (type === 'assignment') buildAssignmentForm(modal);
      else if (type === 'handoff') buildHandoffForm(modal);
      else if (type === 'member') buildMemberForm(modal);
    });
  }

  // ─── Public open() ────────────────────────────────────────────────────────

  function open(defaultType) {
    openModal(function (modal, _close) {
      if (defaultType === 'assignment') {
        buildAssignmentForm(modal);
      } else if (defaultType === 'handoff') {
        buildHandoffForm(modal);
      } else if (defaultType === 'member') {
        buildMemberForm(modal);
      } else {
        buildPickerInModal(modal);
      }
    });
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  window.HOLON_QUICKCREATE = {
    open: open,
    close: close,
  };

})();
