/* inbound.js — Mission inbox screen (iter-001b).
 *
 * Mibusy port: MissionInbox.tsx (card layout: left color bar + status chip
 * + title + chevron right). Adapted to vanilla HTML/CSS/JS + brand tokens.
 *
 * State filter chips: All / Pending / Accepted / In progress / Submitted /
 * Rejected / Expired. Maps "Pending" → state:queued.
 *
 * Row click → HOLON_DRAWER.openMissionDrawer(missionId) — defined in
 * drawer.js per the "no new drawer system" rule.
 *
 * Quick actions (Accept / Reject / Ask question) call showToast — wired to
 * real BFF in iter-002.
 */

(function () {
  'use strict';

  // ── Form family → badge style (per ui-architecture.md § 6.5) ──────────────
  // Authority forms: solid filled (blue).
  // Mutual forms: outlined double border (purple).
  // Receiver-passive: soft tinted, smaller (ink-soft).
  // Time-sensitive: clock icon (gold).
  // Composite: branching icon (green).
  var FORM_META = {
    direct_order:        { label: 'Direct order',        family: 'authority',  icon: null },
    direct_takeover:     { label: 'Direct takeover',     family: 'authority',  icon: null },
    approval_chain:      { label: 'Approval chain',      family: 'authority',  icon: null },
    dual_authorization:  { label: 'Dual authorization',  family: 'mutual',     icon: null },
    negotiated:          { label: 'Negotiated',          family: 'mutual',     icon: null },
    advisory:            { label: 'Advisory',            family: 'passive',    icon: null },
    observer_brief:      { label: 'Observer brief',      family: 'passive',    icon: null },
    watch_brief:         { label: 'Watch brief',         family: 'passive',    icon: null },
    temporary_cover:     { label: 'Temporary cover',     family: 'time',       icon: 'clock' },
    conditional_engagement: { label: 'Conditional engagement', family: 'time', icon: 'clock' },
    subcontracting:      { label: 'Subcontracting',      family: 'composite',  icon: 'branch' },
    parallel_solicitation: { label: 'Parallel solicitation', family: 'composite', icon: 'branch' },
    standing_request:    { label: 'Standing request',    family: 'time',       icon: 'clock' },
  };

  var STATE_LABEL = {
    queued:              'Pending',
    accepted:            'Accepted',
    in_progress:         'In progress',
    blocked:             'Blocked',
    submitted:           'Submitted',
    rejected:            'Rejected',
    expired:             'Expired',
    returned_to_origin:  'Returned',
  };

  // Authority scope summary (one-label) — derived per fixture form
  var AUTHORITY_SCOPE_BY_FORM = {
    direct_order:        'transform',
    direct_takeover:     'full delegation',
    approval_chain:      'approve / reject',
    dual_authorization:  'cosign required',
    negotiated:          'mutual scope',
    advisory:            'cite-only',
    observer_brief:      'read-only',
    watch_brief:         'observe',
    temporary_cover:     'time-bounded',
    conditional_engagement: 'conditional',
    subcontracting:      'sub-delegate',
    parallel_solicitation: 'parallel reply',
    standing_request:    'recurring',
  };

  var CHEVRON_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  var CLOCK_SVG   = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  var BRANCH_SVG  = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 8v8"/><path d="M8 6h6a4 4 0 0 1 4 4"/><path d="M8 18h6a4 4 0 0 0 4-4"/></svg>';

  // ── DOM helpers ───────────────────────────────────────────────────────────

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

  function fx() { return window.HOLON_FIXTURES || { missions: [] }; }

  function showToast(msg) {
    if (window.HOLON_DRAWER && window.HOLON_DRAWER.showToast) {
      window.HOLON_DRAWER.showToast(msg);
    }
  }

  // Truncate body excerpt at first newline OR 120 chars.
  function excerpt(body) {
    if (!body) return '';
    var s = String(body).split(/\r?\n/)[0];
    return s.length > 120 ? s.slice(0, 117) + '…' : s;
  }

  // Relative deadline label (today/tomorrow/N days)
  function deadlineLabel(iso) {
    if (!iso) return null;
    var dl   = new Date(iso);
    var now  = new Date();
    var diff = dl - now;
    var oneDay = 86400000;
    if (diff < 0) return 'Overdue ' + dl.toISOString().slice(0, 10);
    if (diff < oneDay)      return 'Due today ' + dl.toISOString().slice(11, 16);
    if (diff < oneDay * 2)  return 'Due tomorrow';
    var days = Math.ceil(diff / oneDay);
    return 'Due in ' + days + 'd';
  }

  // ── State ─────────────────────────────────────────────────────────────────

  var currentFilter = 'all';

  function filteredMissions() {
    var all = (fx().missions || []).slice();
    // Sort: priority desc, then created_at desc.
    all.sort(function (a, b) {
      var pa = a.priority || 0, pb = b.priority || 0;
      if (pa !== pb) return pb - pa;
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
    if (currentFilter === 'all') return all;
    return all.filter(function (m) { return m.state === currentFilter; });
  }

  // ── Build a mission row ──────────────────────────────────────────────────
  // Pattern ported from mibusy MissionInbox.tsx MissionCard.

  function buildMissionRow(m) {
    var meta   = FORM_META[m.form] || { label: m.form, family: 'authority', icon: null };
    var stateLabel = STATE_LABEL[m.state] || m.state;
    var isUrgent = (m.priority || 0) >= 80 && (m.state === 'queued' || m.state === 'blocked');

    var row = el('div', {
      class: 'mission-row' + (isUrgent ? ' is-urgent' : '') + ' state-' + m.state,
      'data-mission-id': m.id,
    });

    // Color bar (left edge) — color reflects state
    row.appendChild(el('div', { class: 'mission-row-bar' }));

    // Body column
    var col = el('div', { class: 'mission-row-col' });

    // Top line: state chip + form badge + sender
    var topLine = el('div', { class: 'mission-row-toprow' });
    topLine.appendChild(el('span', { class: 'mission-state-chip state-' + m.state }, stateLabel));

    var formBadge = el('span', { class: 'form-badge form-family-' + meta.family });
    if (meta.icon === 'clock')  formBadge.innerHTML  = CLOCK_SVG + ' ' + meta.label;
    else if (meta.icon === 'branch') formBadge.innerHTML = BRANCH_SVG + ' ' + meta.label;
    else                       formBadge.textContent = meta.label;
    topLine.appendChild(formBadge);

    topLine.appendChild(el('span', { class: 'mission-sender' }, 'from ' + (m.sender_display_name || 'unknown')));
    col.appendChild(topLine);

    // Title
    col.appendChild(el('div', { class: 'mission-title' }, m.title));

    // Excerpt
    var ex = excerpt(m.body);
    if (ex) col.appendChild(el('div', { class: 'mission-excerpt' }, ex));

    // Meta row: authority scope + deadline + state reason
    var metaRow = el('div', { class: 'mission-meta' });
    var scope = AUTHORITY_SCOPE_BY_FORM[m.form];
    if (scope)        metaRow.appendChild(el('span', { class: 'mission-meta-pill' }, 'scope: ' + scope));
    var dl = deadlineLabel(m.deadline_at);
    if (dl)           metaRow.appendChild(el('span', { class: 'mission-meta-pill mission-meta-deadline' }, dl));
    if (m.state_reason) metaRow.appendChild(el('span', { class: 'mission-meta-pill mission-meta-reason' }, m.state_reason));
    if (metaRow.children.length > 0) col.appendChild(metaRow);

    // Quick actions — only for actionable states
    if (m.state === 'queued') {
      var actions = el('div', { class: 'mission-actions' });
      var acceptBtn = el('button', { type: 'button', class: 'mission-action mission-action-accept' }, 'Accept');
      var rejectBtn = el('button', { type: 'button', class: 'mission-action mission-action-reject' }, 'Reject');
      var askBtn    = el('button', { type: 'button', class: 'mission-action mission-action-ask' },    'Ask question');
      acceptBtn.addEventListener('click', function (ev) { ev.stopPropagation(); showToast('Wired in iter-002 BFF'); });
      rejectBtn.addEventListener('click', function (ev) { ev.stopPropagation(); showToast('Wired in iter-002 BFF'); });
      askBtn.addEventListener('click',    function (ev) { ev.stopPropagation(); showToast('Wired in iter-002 BFF'); });
      actions.appendChild(acceptBtn);
      actions.appendChild(rejectBtn);
      actions.appendChild(askBtn);
      col.appendChild(actions);
    }

    row.appendChild(col);
    row.appendChild(el('div', { class: 'mission-row-chevron', html: CHEVRON_SVG }));

    // Click body → open drawer (skip if click on action button)
    row.addEventListener('click', function (ev) {
      if (ev.target.closest('.mission-action')) return;
      if (window.HOLON_DRAWER && window.HOLON_DRAWER.openMissionDrawer) {
        window.HOLON_DRAWER.openMissionDrawer(m.id);
      }
    });

    return row;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function render() {
    var list = document.getElementById('mission-list');
    if (!list) return;
    list.innerHTML = '';

    var rows = filteredMissions();
    if (rows.length === 0) {
      list.appendChild(el('div', { class: 'mission-empty' },
        'No missions in this state.'));
      return;
    }
    rows.forEach(function (m) { list.appendChild(buildMissionRow(m)); });

    var count = document.getElementById('inbound-count');
    if (count) {
      count.textContent = rows.length + ' mission' + (rows.length === 1 ? '' : 's') +
        (currentFilter === 'all' ? '' : ' · ' + (STATE_LABEL[currentFilter] || currentFilter));
    }
  }

  function updateChipCounts() {
    var all = (fx().missions || []);
    document.querySelectorAll('.filter-chip-count').forEach(function (span) {
      var key = span.getAttribute('data-count');
      var n = key === 'all' ? all.length
            : all.filter(function (m) { return m.state === key; }).length;
      span.textContent = n;
    });
  }

  function wireChips() {
    document.querySelectorAll('.filter-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        currentFilter = chip.getAttribute('data-filter');
        document.querySelectorAll('.filter-chip').forEach(function (c) {
          var on = c === chip;
          c.classList.toggle('is-active', on);
          c.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        render();
      });
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  function boot() {
    if (!document.getElementById('mission-list')) return; // not on inbound page
    updateChipCounts();
    wireChips();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
