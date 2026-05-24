/* drawer.js — shared right-side drawer infrastructure for Holon UI mock.
 *
 * Ported pattern from mibusy:
 *  - Fixed overlay + panel: MissionSheet.tsx, AgentSheet.tsx
 *  - Backdrop click-to-close: MissionSheet.tsx
 *  - Layer 2 slide-over (position:absolute inset:0): AgentSheet.tsx ManageDrawer
 *  - Layer 3 bonus modal: designed fresh (no mibusy equivalent)
 *
 * Exposes: window.HOLON_DRAWER
 *   .openMemberDrawer(staffId)        — L1 member detail
 *   .openDeliverableDrawer(delivId)   — deliverable detail (Task 2 + Task 4)
 *   .openBucketDrawer(bucketKey)      — Today bucket items (Task 2)
 *   .showToast(msg, kind)             — success / error / default
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

  function svgIcon(path) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  var CLOSE_SVG  = svgIcon('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>');
  var BACK_SVG   = svgIcon('<polyline points="15 18 9 12 15 6"/>');
  var EXTERN_SVG = svgIcon('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>');

  // ─── Data helpers ──────────────────────────────────────────────────────────

  function fx() { return window.HOLON_FIXTURES || {}; }

  function getStaff(id) {
    return (fx().staff || []).find(function (s) { return s.id === id; }) || null;
  }

  function getConnection(id) {
    return (fx().connections || []).find(function (c) { return c.id === id; }) || null;
  }

  function getDeliverable(id) {
    return (fx().deliverables || []).find(function (d) { return d.id === id; }) || null;
  }

  function getMission(id) {
    return (fx().missions || []).find(function (m) { return m.id === id; }) || null;
  }

  // Derive synthetic recent assignments for a staff member.
  // Uses missions + deliverables from fixtures.
  function getRecentAssignments(staffId) {
    var results = [];
    // From missions (in_progress, accepted, blocked assigned to this staff)
    (fx().missions || []).forEach(function (m) {
      if (m.assigned_staff_id === staffId && results.length < 5) {
        results.push({
          title: m.title,
          status: m.state === 'in_progress' ? 'running' : m.state,
        });
      }
    });
    // From deliverables (completed by this staff)
    (fx().deliverables || []).forEach(function (d) {
      if (d.author_staff_id === staffId && results.length < 5) {
        results.push({ title: d.title, status: 'completed' });
      }
    });
    return results.slice(0, 5);
  }

  // Substrate labels / icons
  // Per ADR-015: "myself" substrate removed; union is now local_ai | cli | peer.
  var SUBSTRATE_LABELS = {
    local_ai: 'Local AI',
    cli:      'CLI executor',
    peer:     'Peer',
  };

  var TOOL_ICONS = {
    web_search:           '🔍',
    read_file:            '📄',
    write_file:           '✏️',
    summarize:            '📝',
    create_assignment:    '📋',
    list_missions:        '📊',
    ping_member:          '📤',
    read_desk_context:    '🗂️',
    search_deliverables:  '🔎',
    default:              '🔧',
  };

  // ─── Toast ─────────────────────────────────────────────────────────────────

  var _toastContainer = null;

  function ensureToastContainer() {
    if (!_toastContainer) {
      _toastContainer = el('div', { class: 'holon-toast-container' });
      document.body.appendChild(_toastContainer);
    }
    return _toastContainer;
  }

  function showToast(msg, kind) {
    var container = ensureToastContainer();
    var toast = el('div', { class: 'holon-toast' + (kind ? ' ' + kind : '') }, '✓ ' + msg);
    container.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 300ms ease';
      setTimeout(function () { toast.remove(); }, 320);
    }, 3000);
  }

  // ─── Drawer state ──────────────────────────────────────────────────────────

  var _backdrop   = null;
  var _panel      = null;
  var _l2         = null;
  var _panelOpen  = false;

  // ─── Build / ensure drawer ─────────────────────────────────────────────────

  function ensureDrawer() {
    if (_backdrop) return;

    _backdrop = el('div', { class: 'drawer-backdrop', 'aria-hidden': 'true' });
    _backdrop.addEventListener('click', closeDrawer);

    _panel = el('div', {
      class: 'drawer-panel',
      role:  'complementary',
      'aria-label': 'Detail drawer',
    });

    document.body.appendChild(_backdrop);
    document.body.appendChild(_panel);

    // Esc closes
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && _panelOpen) closeDrawer();
    });
  }

  function openDrawerWith(buildFn) {
    ensureDrawer();
    _panel.innerHTML = '';
    _l2 = null;

    buildFn(_panel);

    _panelOpen = true;
    _backdrop.classList.add('open');
    _panel.classList.add('open');
  }

  function closeDrawer() {
    _panelOpen = false;
    if (_backdrop) _backdrop.classList.remove('open');
    if (_panel)    _panel.classList.remove('open');
  }

  // ─── Layer 2 slide-over ────────────────────────────────────────────────────
  // Ported from mibusy AgentSheet.tsx ManageDrawer pattern (position:absolute inset:0)

  function openL2(buildFn) {
    if (_l2) { _l2.classList.add('open'); return; }
    _l2 = el('div', { class: 'drawer-l2' });
    _panel.style.position = 'relative';
    _panel.appendChild(_l2);
    buildFn(_l2);
    // Trigger animation on next frame
    requestAnimationFrame(function () { _l2.classList.add('open'); });
  }

  function closeL2() {
    if (!_l2) return;
    _l2.classList.remove('open');
    setTimeout(function () {
      if (_l2) { _l2.remove(); _l2 = null; }
    }, 220);
  }

  // ─── Layer 3 modal ─────────────────────────────────────────────────────────
  // Designed fresh — no mibusy equivalent. Centered dialog stacked above L2.

  function openL3(buildFn) {
    var bd = el('div', { class: 'drawer-l3-backdrop' });
    var modal = el('div', { class: 'drawer-l3-modal', role: 'dialog', 'aria-modal': 'true' });
    buildFn(modal, function () { bd.remove(); });
    bd.appendChild(modal);
    bd.addEventListener('click', function (ev) { if (ev.target === bd) bd.remove(); });
    document.body.appendChild(bd);
    document.addEventListener('keydown', function esc(ev) {
      if (ev.key === 'Escape') { bd.remove(); document.removeEventListener('keydown', esc); }
    });
  }

  // ─── Shared drawer close button ───────────────────────────────────────────

  function makeCloseBtn(label) {
    var btn = el('button', {
      class: 'drawer-close-btn',
      type: 'button',
      'aria-label': label || 'Close',
    });
    btn.innerHTML = CLOSE_SVG;
    btn.addEventListener('click', closeDrawer);
    return btn;
  }

  function makeBackBtn(label, onClick) {
    var btn = el('button', {
      class: 'drawer-l2-back-btn',
      type: 'button',
      'aria-label': label || 'Back',
    });
    btn.innerHTML = BACK_SVG;
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ─── Section builder helpers ──────────────────────────────────────────────

  function buildSection(labelText, contentEl) {
    var sec = el('div', { class: 'drawer-section' });
    sec.appendChild(el('div', { class: 'drawer-section-label' }, labelText));
    sec.appendChild(contentEl);
    return sec;
  }

  function buildSectionContent(text) {
    return el('div', { class: 'drawer-section-content' }, text);
  }

  // ─── Task 1: Member detail drawer ─────────────────────────────────────────
  // Pattern: card body click → L1 right-side drawer
  // L1 structure ported from mibusy AgentSheet.tsx header + body layout.

  function openMemberDrawer(staffId) {
    var s = getStaff(staffId);
    if (!s) return;

    openDrawerWith(function (panel) {

      // ── Header (ported from AgentSheet.tsx header block) ──────────────────
      var header = el('div', { class: 'drawer-header' });

      var avatarWrap = el('div', { class: 'drawer-header-avatar' });
      var initial = (s.name || '?').charAt(0).toUpperCase();

      // Color based on substrate
      var avatarColors = {
        local_ai: '#1F6F9E',
        myself:   '#2E7D52',
        cli:      '#856515',
        peer:     '#7B4FAB',
      };
      var avatarBg = avatarColors[s.substrate.kind] || '#6E6A60';

      var avatarInner = el('div', {
        class: 'drawer-header-avatar-initial',
        style: 'background:' + avatarBg + '; color:#fff; font-weight:700; font-size:17px;',
      }, initial);
      avatarWrap.appendChild(avatarInner);

      // Online dot
      var dot = el('div', { class: 'drawer-online-dot' + (s.status === 'active' ? ' online' : s.status === 'paused' ? ' paused' : '') });
      avatarWrap.appendChild(dot);

      header.appendChild(avatarWrap);

      var headerInfo = el('div', { class: 'drawer-header-info' });
      var nameEl = el('div', { class: 'drawer-header-name' }, s.name);
      var roleEl = el('div', { class: 'drawer-header-role' });

      // Substrate badge
      var subBadge = el('span', {
        class: 'badge badge-substrate substrate-' + s.substrate.kind,
      }, SUBSTRATE_LABELS[s.substrate.kind] || s.substrate.kind);

      // Autonomy badge
      var autoBadge = el('span', {
        class: 'badge',
        style: 'background: var(--bg-alt); color: var(--ink-soft);',
      }, s.autonomy_level || '—');

      roleEl.appendChild(el('span', null, s.role_label || s.role_name));
      roleEl.appendChild(el('span', null, '·'));
      roleEl.appendChild(subBadge);
      roleEl.appendChild(autoBadge);

      headerInfo.appendChild(nameEl);
      headerInfo.appendChild(roleEl);
      header.appendChild(headerInfo);
      header.appendChild(makeCloseBtn('Close member detail'));
      panel.appendChild(header);

      // ── Body ──────────────────────────────────────────────────────────────
      var body = el('div', { class: 'drawer-body' });

      // Status + load
      var statusRow = el('div', { style: 'display:flex; gap:8px; flex-wrap:wrap; align-items:center;' });
      var statusCls = 'badge badge-status status-' + (s.status === 'paused' ? 'paused' : s.status === 'archived' ? 'archived' : 'active');
      statusRow.appendChild(el('span', { class: statusCls }, s.status));
      if (s.current_jobs > 0) {
        statusRow.appendChild(el('span', { class: 'badge' }, s.current_jobs + ' job' + (s.current_jobs === 1 ? '' : 's') + ' running'));
      }
      body.appendChild(statusRow);

      // Cultivation preview
      var cultWrap = el('div', { class: 'drawer-section' });
      cultWrap.appendChild(el('div', { class: 'drawer-section-label' }, 'Cultivation'));
      var cultRow = el('div', { style: 'display:flex; gap:4px; align-items:center;' });
      for (var p = 0; p < 5; p++) {
        var pip = el('span', {
          class: 'cultivation-pip' + (p < (s.cultivation_maturity || 0) ? ' filled' : ''),
        });
        cultRow.appendChild(pip);
      }
      cultRow.appendChild(el('span', { class: 'cultivation-label' }, (s.cultivation_maturity || 0) + ' / 5 maturity'));
      cultWrap.appendChild(cultRow);
      // Standing instructions excerpt (mock)
      // Per ADR-015: "myself" substrate removed; substrate union is local_ai | cli | peer.
      cultWrap.appendChild(el('div', { class: 'drawer-section-content', style: 'margin-top:4px; font-size:12px;' },
        s.substrate.kind === 'local_ai'
          ? 'Standing instructions: "Always cite sources. Prefer bullet summaries. Flag uncertainty explicitly." — 3 exemplars recorded.'
          : 'Peer member — cultivation not tracked locally.'
      ));
      body.appendChild(cultWrap);

      // Recent assignments (ported from WorkerInbox.tsx card pattern)
      var assigns = getRecentAssignments(s.id);
      if (assigns.length > 0) {
        var assignSec = el('div', { class: 'drawer-section' });
        assignSec.appendChild(el('div', { class: 'drawer-section-label' }, 'Recent assignments'));
        var assignList = el('div', { style: 'display:flex; flex-direction:column; gap:6px;' });
        assigns.forEach(function (a) {
          var row = el('div', { class: 'assignment-row' });
          row.appendChild(el('div', { class: 'assignment-row-dot ' + (a.status || '') }));
          row.appendChild(el('div', { class: 'assignment-row-title' }, a.title));
          row.appendChild(el('span', { class: 'assignment-row-status' }, a.status));
          assignList.appendChild(row);
        });
        assignSec.appendChild(assignList);
        body.appendChild(assignSec);
      } else {
        body.appendChild(buildSection('Recent assignments', buildSectionContent('No recent assignments.')));
      }

      // Tool scope
      if (s.substrate.tool_scope && s.substrate.tool_scope.length) {
        var toolSec = el('div', { class: 'drawer-section' });
        toolSec.appendChild(el('div', { class: 'drawer-section-label' }, 'Tool scope (allowlist)'));
        var toolList = el('div', { class: 'tool-list' });
        s.substrate.tool_scope.forEach(function (t) {
          var item = el('div', { class: 'tool-item' });
          item.appendChild(el('span', { class: 'tool-item-icon' }, TOOL_ICONS[t] || TOOL_ICONS.default));
          item.appendChild(el('span', { class: 'tool-item-name' }, t));
          toolList.appendChild(item);
        });
        toolSec.appendChild(toolList);
        body.appendChild(toolSec);
      }

      // ── Mentors section (ADR-016) — local_ai only ─────────────────────────
      if (s.substrate.kind === 'local_ai' && s.substrate.mentors && s.substrate.mentors.length > 0) {
        var mentorSec = el('div', { class: 'drawer-section' });
        mentorSec.appendChild(el('div', { class: 'drawer-section-label' }, 'Mentors'));
        var mentorList = el('div', { style: 'display:flex; flex-direction:column; gap:8px;' });

        s.substrate.mentors.forEach(function (mentor) {
          // Look up mentor name via connections
          var mentorConn = getConnection(mentor.peer_id);
          var mentorName = mentorConn ? mentorConn.display_name : mentor.peer_id;

          var card = el('button', {
            class: 'mentor-card',
            type: 'button',
            'aria-label': 'View mentor ' + mentorName + ' details',
          });

          var cardTop = el('div', { style: 'display:flex; align-items:flex-start; justify-content:space-between; gap:8px;' });
          var nameSpan = el('span', { style: 'font-size:13px; font-weight:600; color:var(--ink);' }, mentorName);
          var statusSpan = el('span', {
            class: 'mentor-status ' + (mentor.distillation_enabled ? 'mentor-status-enabled' : 'mentor-status-off'),
          }, mentor.distillation_enabled ? '✓ distillation on' : '⚫ distillation off');
          cardTop.appendChild(nameSpan);
          cardTop.appendChild(statusSpan);
          card.appendChild(cardTop);

          var domainSpan = el('div', { class: 'mentor-domain' }, mentor.domain);
          card.appendChild(domainSpan);

          var policySpan = el('div', { style: 'font-size:11px; color:var(--ink-mute); margin-top:2px;' },
            'Policy: ' + mentor.invocation_policy.replace(/_/g, ' '));
          card.appendChild(policySpan);

          // Click → L2: connection details + recent consultation log
          card.addEventListener('click', function (ev) {
            ev.stopPropagation();
            openL2(function (l2) { buildL2Mentor(l2, s, mentor, mentorConn); });
          });

          mentorList.appendChild(card);
        });

        mentorSec.appendChild(mentorList);
        body.appendChild(mentorSec);
      }

      // Budget caps
      if (s.substrate.budget) {
        var budgetSec = el('div', { class: 'drawer-section' });
        budgetSec.appendChild(el('div', { class: 'drawer-section-label' }, 'Budget caps'));
        var budgetBox = el('div', { class: 'drawer-section-content', style: 'padding:0;' });
        var bContent = el('div', { style: 'padding: 10px 14px;' });
        if (s.substrate.budget.max_tokens != null) {
          var br1 = el('div', { class: 'budget-row' });
          br1.appendChild(el('span', { class: 'budget-row-label' }, 'Max tokens'));
          br1.appendChild(el('span', { class: 'budget-row-val' }, s.substrate.budget.max_tokens.toLocaleString()));
          bContent.appendChild(br1);
        }
        if (s.substrate.budget.max_cost_millicents != null) {
          var br2 = el('div', { class: 'budget-row' });
          br2.appendChild(el('span', { class: 'budget-row-label' }, 'Max cost'));
          br2.appendChild(el('span', { class: 'budget-row-val' }, '$' + (s.substrate.budget.max_cost_millicents / 100000).toFixed(2)));
          bContent.appendChild(br2);
        }
        budgetBox.appendChild(bContent);
        budgetSec.appendChild(budgetBox);
        body.appendChild(budgetSec);
      }

      // ── Backing instance panel (unique to each substrate) ─────────────────
      // "每个staff 需要能有下一层" — visible link to the real connected instance.
      body.appendChild(buildBackingPanel(s));

      panel.appendChild(body);
    });
  }

  // ─── Backing instance panel per substrate ─────────────────────────────────

  function buildBackingPanel(s) {
    var sec = el('div', { class: 'drawer-section' });
    sec.appendChild(el('div', { class: 'drawer-section-label' }, 'Backing instance'));

    var panel = el('div', { class: 'backing-panel' });

    if (s.substrate.kind === 'local_ai') {
      addPanelRow(panel, 'Profile ID', s.substrate.agent_profile_id || '—');
      addPanelRow(panel, 'Substrate', 'Local AI runtime');
      addPanelRow(panel, 'Tool count', String((s.substrate.tool_scope || []).length) + ' tools');
      var linkBtn = el('button', { class: 'backing-panel-link', type: 'button' });
      linkBtn.innerHTML = EXTERN_SVG + ' View AI profile →';
      linkBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openL2(function (l2) { buildL2LocalAI(l2, s); });
      });
      panel.appendChild(linkBtn);

    } else if (s.substrate.kind === 'cli') {
      addPanelRow(panel, 'Binary', s.substrate.binary || '—');
      addPanelRow(panel, 'Args template', s.substrate.args_template || '—');
      addPanelRow(panel, 'Approval rules', String((s.substrate.approval_rules || []).length) + ' rules');
      var cliLink = el('button', { class: 'backing-panel-link', type: 'button' });
      cliLink.innerHTML = EXTERN_SVG + ' View CLI config →';
      cliLink.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openL2(function (l2) { buildL2CLI(l2, s); });
      });
      panel.appendChild(cliLink);

    } else if (s.substrate.kind === 'peer') {
      var conn = getConnection(s.substrate.connection_id);
      addPanelRow(panel, 'Remote desk', conn ? conn.display_name + "'s desk" : '(unknown)');
      addPanelRow(panel, 'Connection ID', s.substrate.connection_id ? s.substrate.connection_id.slice(0, 24) + '…' : '—');
      if (conn) {
        var hbadge = el('span', { class: 'health-badge ' + (conn.health_state || 'offline') }, conn.health_state || 'offline');
        addPanelRowNode(panel, 'Health', hbadge);
        addPanelRow(panel, 'Paired at', conn.paired_at ? conn.paired_at.slice(0, 10) : '—');
      }
      var peerLink = el('button', { class: 'backing-panel-link', type: 'button' });
      peerLink.innerHTML = EXTERN_SVG + ' View remote desk →';
      peerLink.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openL2(function (l2) { buildL2Peer(l2, s, conn); });
      });
      panel.appendChild(peerLink);

    }
    // Per ADR-015: "myself" substrate branch removed — owner no longer a member.

    sec.appendChild(panel);
    return sec;
  }

  function addPanelRow(panel, key, val) {
    var row = el('div', { class: 'backing-panel-row' });
    row.appendChild(el('span', { class: 'backing-panel-key' }, key));
    row.appendChild(el('span', { class: 'backing-panel-val' }, val));
    panel.appendChild(row);
  }

  function addPanelRowNode(panel, key, valNode) {
    var row = el('div', { class: 'backing-panel-row' });
    row.appendChild(el('span', { class: 'backing-panel-key' }, key));
    row.appendChild(valNode);
    panel.appendChild(row);
  }

  // ─── Layer 2: local_ai AI profile ─────────────────────────────────────────

  function buildL2LocalAI(l2, s) {
    var sub = s.substrate;

    // Header (ported from mibusy ManageDrawer header)
    var header = el('div', { class: 'drawer-l2-header' });
    header.appendChild(makeBackBtn('Back to member detail', closeL2));
    var headerText = el('div');
    headerText.appendChild(el('div', { class: 'drawer-l2-title' }, 'AI Profile'));
    headerText.appendChild(el('div', { class: 'drawer-l2-subtitle' }, sub.agent_profile_id || 'local_ai'));
    header.appendChild(headerText);
    l2.appendChild(header);

    var body = el('div', { class: 'drawer-l2-body' });

    body.appendChild(buildL2Section('Model', [
      buildL2Row('Profile ID', sub.agent_profile_id || '—'),
      buildL2Row('Runtime', 'Local AI adapter'),
      buildL2Row('Max tokens', sub.budget ? sub.budget.max_tokens.toLocaleString() : '—'),
      buildL2Row('Cost cap', sub.budget ? '$' + (sub.budget.max_cost_millicents / 100000).toFixed(2) + ' / call' : '—'),
    ]));

    body.appendChild(buildL2Section('System prompt excerpt', [
      el('div', { class: 'drawer-section-content', style: 'font-size:12px; font-style:italic;' },
        '"You are ' + s.name + ', a ' + s.role_label + ' working for the desk owner. ' +
        'Always cite sources when making factual claims. Keep responses focused. ' +
        'Surface uncertainty with explicit confidence markers. ' +
        '[Full prompt truncated for display — 412 tokens.]"')
    ]));

    if (sub.tool_scope && sub.tool_scope.length) {
      var toolRows = sub.tool_scope.map(function (t) {
        var row = el('div', { class: 'tool-item' });
        row.appendChild(el('span', { class: 'tool-item-icon' }, TOOL_ICONS[t] || '🔧'));
        row.appendChild(el('span', { class: 'tool-item-name' }, t));
        return row;
      });
      body.appendChild(buildL2Section('Available tools', toolRows));
    }

    body.appendChild(buildL2Section('Cultivation profile', [
      el('div', { class: 'drawer-section-content', style: 'font-size:12px;' },
        'Maturity: ' + (s.cultivation_maturity || 0) + ' / 5\n' +
        'Exemplars recorded: ' + (s.cultivation_maturity * 3) + '\n' +
        'Standing instructions: "Always cite sources. Prefer bullet summaries. Flag uncertainty explicitly."\n' +
        'Last exemplar: 2026-05-14 — "Q1 contract diff" (rated 5/5 by owner)')
    ]));

    l2.appendChild(body);
  }

  // ─── Layer 2: mentor peer (ADR-016) ──────────────────────────────────────

  function buildL2Mentor(l2, s, mentor, mentorConn) {
    var mentorName = mentorConn ? mentorConn.display_name : mentor.peer_id;

    var header = el('div', { class: 'drawer-l2-header' });
    header.appendChild(makeBackBtn('Back to member detail', closeL2));
    var headerText = el('div');
    headerText.appendChild(el('div', { class: 'drawer-l2-title' }, 'Mentor: ' + mentorName));
    headerText.appendChild(el('div', { class: 'drawer-l2-subtitle' }, mentor.domain));
    header.appendChild(headerText);
    l2.appendChild(header);

    var body = el('div', { class: 'drawer-l2-body' });

    // Mentor relationship rows
    body.appendChild(buildL2Section('Mentor relationship', [
      buildL2Row('Mentor', mentorName),
      buildL2Row('Domain', mentor.domain),
      buildL2Row('Invocation policy', mentor.invocation_policy.replace(/_/g, ' ')),
      buildL2Row('Distillation', mentor.distillation_enabled ? '✓ enabled (V2+)' : '⚫ off (V1)'),
    ]));

    // Connection details if available
    if (mentorConn) {
      var hBadge = el('span', { class: 'health-badge ' + mentorConn.health_state }, mentorConn.health_state);
      body.appendChild(buildL2Section('Connection status', [
        hBadge,
        buildL2Row('Paired at', mentorConn.paired_at ? mentorConn.paired_at.slice(0, 10) : '—'),
        buildL2Row('Last heartbeat', mentorConn.last_successful_at ? mentorConn.last_successful_at.slice(0, 19).replace('T', ' ') : '—'),
        buildL2Row('Capabilities', (mentorConn.remote_desk_capabilities || []).join(', ') || '—'),
      ]));
    }

    // Cultivation log — recent mentor consultations
    var cultivationProfile = s.cultivation_profile || {};
    var log = cultivationProfile.cultivation_log || [];
    var mentorLog = log.filter(function (entry) {
      return entry.kind === 'mentor_consultation' && entry.mentor_peer_id === mentor.peer_id;
    });

    if (mentorLog.length > 0) {
      var logEls = mentorLog.map(function (entry) {
        var wrap = el('div', { class: 'drawer-section-content', style: 'display:flex; flex-direction:column; gap:2px; padding:8px 12px; background:#fff; border:1px solid var(--line); border-radius:8px;' });
        wrap.appendChild(el('div', { style: 'font-size:12px; font-weight:600; color:var(--ink);' }, entry.topic));
        wrap.appendChild(el('div', { style: 'font-size:11px; color:var(--ink-mute);' },
          (entry.consulted_at || '').slice(0, 10) + ' · outcome: ' + (entry.outcome || '—')));
        wrap.appendChild(el('div', { style: 'font-size:12px; color:var(--ink-soft); margin-top:2px;' }, entry.summary));
        return wrap;
      });
      body.appendChild(buildL2Section('Recent consultations (' + mentorLog.length + ')', logEls));
    } else {
      body.appendChild(buildL2Section('Recent consultations', [
        el('div', { class: 'drawer-section-content' }, 'No consultation log entries yet.')
      ]));
    }

    l2.appendChild(body);
  }

  // ─── Layer 2: CLI config ──────────────────────────────────────────────────

  function buildL2CLI(l2, s) {
    var sub = s.substrate;

    var header = el('div', { class: 'drawer-l2-header' });
    header.appendChild(makeBackBtn('Back to member detail', closeL2));
    var headerText = el('div');
    headerText.appendChild(el('div', { class: 'drawer-l2-title' }, 'CLI Config'));
    headerText.appendChild(el('div', { class: 'drawer-l2-subtitle' }, sub.binary || 'cli'));
    header.appendChild(headerText);
    l2.appendChild(header);

    var body = el('div', { class: 'drawer-l2-body' });

    body.appendChild(buildL2Section('Command', [
      buildL2Row('Binary', sub.binary || '—'),
      buildL2Row('Args template', sub.args_template || '—'),
    ]));

    if (sub.approval_rules && sub.approval_rules.length) {
      var ruleRows = sub.approval_rules.map(function (r) {
        return buildL2Row(r.operation_pattern, r.require_approval ? '⚠️ requires owner approval' : 'auto-approve');
      });
      body.appendChild(buildL2Section('Approval rules', ruleRows));
    }

    // Mock execution history (3 recent runs)
    var execRows = [
      { code: 0, cmd: 'gh pr list --state open', ts: '13:42' },
      { code: 0, cmd: 'gh issue view 142 --json state,title', ts: '13:30' },
      { code: 1, cmd: 'gh pr merge 88 --squash --delete-branch', ts: '11:05' },
    ];
    var execEls = execRows.map(function (r) {
      var row = el('div', { class: 'exec-row' });
      row.appendChild(el('span', { class: 'exec-row-code ' + (r.code === 0 ? 'ok' : 'err') }, String(r.code)));
      row.appendChild(el('span', { class: 'exec-row-cmd' }, r.cmd));
      row.appendChild(el('span', { class: 'exec-row-ts' }, r.ts));
      return row;
    });
    body.appendChild(buildL2Section('Recent executions (mock)', execEls));

    l2.appendChild(body);
  }

  // ─── Layer 2: peer remote desk ────────────────────────────────────────────
  // Per spec: "peer especially must visibly link to 'another app's instance'"
  // Ported connection display from mibusy FacadeConfig.tsx.

  function buildL2Peer(l2, s, conn) {
    var header = el('div', { class: 'drawer-l2-header' });
    header.appendChild(makeBackBtn('Back to member detail', closeL2));
    var headerText = el('div');
    headerText.appendChild(el('div', { class: 'drawer-l2-title' }, conn ? conn.display_name + "'s desk" : 'Remote desk'));
    headerText.appendChild(el('div', { class: 'drawer-l2-subtitle' }, 'Peer connection · ' + (s.substrate.connection_id || '').slice(0, 20) + '…'));
    header.appendChild(headerText);
    l2.appendChild(header);

    var body = el('div', { class: 'drawer-l2-body' });

    if (conn) {
      // Health + timing
      var hBadge = el('span', { class: 'health-badge ' + conn.health_state }, conn.health_state);
      var healthEl = el('div', { style: 'display:flex; align-items:center; gap:8px;' });
      healthEl.appendChild(hBadge);
      if (conn.last_failure_reason) {
        healthEl.appendChild(el('span', { style: 'font-size:11px; color:var(--ink-mute);' }, conn.last_failure_reason));
      }

      body.appendChild(buildL2Section('Connection status', [
        healthEl,
        buildL2Row('Last heartbeat', conn.last_successful_at ? conn.last_successful_at.slice(0, 19).replace('T', ' ') : '—'),
        buildL2Row('Paired at', conn.paired_at ? conn.paired_at.slice(0, 10) : '—'),
        buildL2Row('Remote person ID', conn.remote_person_id ? conn.remote_person_id.slice(0, 28) + '…' : '—'),
      ]));

      // Signing key fingerprint (mock)
      body.appendChild(buildL2Section('Security', [
        buildL2Row('Signing key', 'sha256:9f3c8a…b4e2d1 (mock fingerprint)'),
        buildL2Row('Key verified', '2026-04-02 at pairing'),
        buildL2Row('Token status', conn.health_state === 'invalid_token' ? '⚠️ Requires re-pair' : '✓ Valid'),
      ]));

      // Capabilities
      if (conn.remote_desk_capabilities && conn.remote_desk_capabilities.length) {
        body.appendChild(buildL2Section('Remote desk capabilities', [
          el('div', { class: 'drawer-section-content' }, conn.remote_desk_capabilities.join(', '))
        ]));
      }

      // Mock health history (sparkline mock via text)
      body.appendChild(buildL2Section('Health history (mock)', [
        el('div', { class: 'drawer-section-content', style: 'font-size:11px; font-family:monospace; letter-spacing:3px; line-height:2;' },
          '█ █ █ █ █ █ █ ░ ░ █\n' +
          'last 10 heartbeats — █=ok  ░=miss')
      ]));

      // Layer 3 bonus: "View remote desk's manifesto →"
      var l3Btn = el('button', { class: 'backing-panel-link', type: 'button', style: 'font-size:13px; padding:4px 0;' });
      l3Btn.innerHTML = EXTERN_SVG + ' View remote desk\'s manifesto → (bonus L3)';
      l3Btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openL3(function (modal, close) { buildL3Manifesto(modal, close, conn, s); });
      });
      var l3sec = el('div', { class: 'drawer-section' });
      l3sec.appendChild(el('div', { class: 'drawer-section-label' }, 'Remote desk'));
      l3sec.appendChild(l3Btn);
      body.appendChild(l3sec);

    } else {
      body.appendChild(buildL2Section('Connection', [
        el('div', { class: 'drawer-section-content' }, 'Connection details not found in fixtures.')
      ]));
    }

    l2.appendChild(body);
  }

  // ─── Layer 3: remote desk manifesto (bonus) ───────────────────────────────
  // Designed fresh — no mibusy equivalent.

  function buildL3Manifesto(modal, close, conn, s) {
    var mHeader = el('div', { class: 'drawer-l3-header' });
    mHeader.appendChild(el('div', { class: 'drawer-l3-title' }, (conn ? conn.display_name + "'s" : 'Remote') + ' desk manifesto'));
    var mClose = el('button', { class: 'drawer-close-btn', type: 'button', 'aria-label': 'Close' });
    mClose.innerHTML = CLOSE_SVG;
    mClose.addEventListener('click', close);
    mHeader.appendChild(mClose);
    modal.appendChild(mHeader);

    modal.appendChild(el('div', { class: 'drawer-section-content' }, [
      el('div', { style: 'font-weight:600; margin-bottom:8px;' }, conn ? conn.display_name + "'s desk" : 'Remote desk'),
      el('div', { style: 'font-size:13px; color:var(--ink-soft); line-height:1.65;' },
        'This is a mock representation of the remote desk\'s public manifesto. ' +
        'In a real Holon instance this would be fetched over the peer connection.\n\n' +
        'Desk: ' + (conn ? conn.display_name : '?') + '\n' +
        'Remote member: ' + s.name + '\n' +
        'Capabilities: ' + (conn && conn.remote_desk_capabilities ? conn.remote_desk_capabilities.join(', ') : '—') + '\n' +
        'Pairing date: ' + (conn && conn.paired_at ? conn.paired_at.slice(0, 10) : '—') + '\n\n' +
        '"We prioritize high-quality, cited research. All outbound deliverables ' +
        'are reviewed by the desk owner before transmission. Budget cap: $50/month per connection."')
    ]));

    var dismissBtn = el('button', {
      class: 'qc-submit-btn',
      type: 'button',
      style: 'margin-top:8px;',
    }, 'Close');
    dismissBtn.addEventListener('click', close);
    modal.appendChild(dismissBtn);
  }

  // Per ADR-015: buildL2Myself removed — "myself" substrate no longer exists.
  // Owner's work lives in Today personal queue (openPersonalQueueDrawer).

  // ─── L2 section builder ───────────────────────────────────────────────────

  function buildL2Section(label, contentEls) {
    var sec = el('div', { class: 'drawer-section' });
    sec.appendChild(el('div', { class: 'drawer-section-label' }, label));
    var wrap = el('div', { style: 'display:flex; flex-direction:column; gap:6px;' });
    (Array.isArray(contentEls) ? contentEls : [contentEls]).forEach(function (c) {
      if (c) wrap.appendChild(c);
    });
    sec.appendChild(wrap);
    return sec;
  }

  function buildL2Row(key, val) {
    var row = el('div', { class: 'backing-panel-row', style: 'background:#fff; border:1px solid var(--line); border-radius:8px; padding:8px 12px;' });
    row.appendChild(el('span', { class: 'backing-panel-key' }, key));
    row.appendChild(el('span', { class: 'backing-panel-val' }, val));
    return row;
  }

  // ─── Task 2: Today bucket drawer ──────────────────────────────────────────
  // Designed fresh — mibusy TodayPage is chat-centric, no bucket pattern.

  var BUCKET_META = {
    ai_running:   { label: 'Local AI running',        emoji: '🤖' },
    peer_waiting: { label: 'Remote peer waiting',     emoji: '⏳' },
    pending:      { label: 'Inbound mission pending', emoji: '📬' },
    returned:     { label: 'Deliverable returned',    emoji: '📥' },
    blocked:      { label: 'Blocked',                 emoji: '🚫' },
    retrying:     { label: 'Retrying',                emoji: '🔄' },
  };

  function getBucketItems(key) {
    var f = fx();
    var items = [];
    if (key === 'ai_running') {
      (f.staff || []).forEach(function (s) {
        if (s.substrate.kind === 'local_ai' && s.current_jobs > 0) {
          for (var j = 0; j < s.current_jobs; j++) {
            items.push({ type: 'staff_job', title: s.name + ' — job ' + (j + 1), staffId: s.id });
          }
        }
      });
    } else if (key === 'peer_waiting') {
      var peerConnIds = new Set((f.staff || [])
        .filter(function (s) { return s.substrate.kind === 'peer'; })
        .map(function (s) { return s.substrate.connection_id; }));
      (f.missions || []).forEach(function (m) {
        if (m.state === 'in_progress' && peerConnIds.has(m.sender_connection_id)) {
          items.push({ type: 'mission', title: m.title, id: m.id });
        }
      });
      if (items.length === 0) {
        (f.staff || []).filter(function (s) { return s.substrate.kind === 'peer'; }).forEach(function (s) {
          items.push({ type: 'peer_member', title: s.name + ' — peer member', staffId: s.id });
        });
      }
    } else if (key === 'pending') {
      (f.missions || []).filter(function (m) { return m.state === 'queued'; }).forEach(function (m) {
        items.push({ type: 'mission', title: m.title, from: m.sender_display_name, id: m.id });
      });
    } else if (key === 'returned') {
      (f.deliverables || []).filter(function (d) { return d.origin_label === 'remote'; }).forEach(function (d) {
        items.push({ type: 'deliverable', title: d.title, id: d.id });
      });
    } else if (key === 'blocked') {
      (f.missions || []).filter(function (m) { return m.state === 'blocked'; }).forEach(function (m) {
        items.push({ type: 'mission', title: m.title, reason: m.state_reason, id: m.id });
      });
    } else if (key === 'retrying') {
      (f.connections || []).filter(function (c) { return c.health_state === 'retrying'; }).forEach(function (c) {
        items.push({ type: 'connection', title: c.display_name + ' — retrying', connId: c.id });
      });
    }
    return items;
  }

  function openBucketDrawer(bucketKey) {
    var meta = BUCKET_META[bucketKey] || { label: bucketKey, emoji: '📌' };
    var items = getBucketItems(bucketKey);

    openDrawerWith(function (panel) {
      var header = el('div', { class: 'drawer-header' });
      var iconEl = el('div', { class: 'drawer-header-avatar', style: 'background:var(--bg-alt); color:var(--ink); font-size:20px;' }, meta.emoji);
      header.appendChild(iconEl);
      var hInfo = el('div', { class: 'drawer-header-info' });
      hInfo.appendChild(el('div', { class: 'drawer-header-name' }, meta.label));
      hInfo.appendChild(el('div', { class: 'drawer-header-role' }, items.length + ' item' + (items.length === 1 ? '' : 's')));
      header.appendChild(hInfo);
      header.appendChild(makeCloseBtn('Close bucket drawer'));
      panel.appendChild(header);

      var body = el('div', { class: 'drawer-body' });

      if (items.length === 0) {
        body.appendChild(el('div', { style: 'color:var(--ink-mute); font-size:14px; text-align:center; padding:32px 0;' }, 'Nothing in this bucket right now.'));
      } else {
        var list = el('div', { style: 'display:flex; flex-direction:column; gap:8px;' });
        items.forEach(function (item) {
          var row = el('button', {
            class: 'assignment-row',
            type: 'button',
            style: 'cursor:pointer; width:100%; text-align:left; transition: background 0.12s;',
          });
          row.style.setProperty('--hover-bg', 'var(--bg-alt)');

          var dot = el('div', { class: 'assignment-row-dot' + (item.type === 'deliverable' ? ' completed' : item.type === 'mission' ? ' queued' : ' running') });
          row.appendChild(dot);

          var textCol = el('div', { style: 'flex:1; min-width:0;' });
          textCol.appendChild(el('div', { class: 'assignment-row-title' }, item.title));
          if (item.from) {
            textCol.appendChild(el('div', { style: 'font-size:11px; color:var(--ink-mute);' }, 'From: ' + item.from));
          }
          if (item.reason) {
            textCol.appendChild(el('div', { style: 'font-size:11px; color:#C0392B;' }, item.reason));
          }
          row.appendChild(textCol);
          row.appendChild(el('span', { style: 'font-size:11px; color:var(--ink-mute); flex-shrink:0;' }, item.type));

          // Click: open deliverable or mission detail
          row.addEventListener('click', function (ev) {
            ev.stopPropagation();
            if (item.type === 'deliverable') {
              openDeliverableDrawer(item.id);
            } else if (item.type === 'mission' && item.id) {
              openMissionDetailInBucket(item.id);
            } else if (item.type === 'peer_member' && item.staffId) {
              openMemberDrawer(item.staffId);
            }
          });

          row.addEventListener('mouseenter', function () { row.style.background = 'var(--bg-alt)'; });
          row.addEventListener('mouseleave', function () { row.style.background = ''; });

          list.appendChild(row);
        });
        body.appendChild(list);
      }

      panel.appendChild(body);
    });
  }

  function openMissionDetailInBucket(missionId) {
    var m = getMission(missionId);
    if (!m) return;
    // Show a simple L2 mission detail
    openL2(function (l2) {
      var header = el('div', { class: 'drawer-l2-header' });
      header.appendChild(makeBackBtn('Back to bucket', closeL2));
      var headerText = el('div');
      headerText.appendChild(el('div', { class: 'drawer-l2-title' }, m.title));
      headerText.appendChild(el('div', { class: 'drawer-l2-subtitle' }, 'Mission · from ' + (m.sender_display_name || 'unknown')));
      header.appendChild(headerText);
      l2.appendChild(header);

      var body = el('div', { class: 'drawer-l2-body' });
      body.appendChild(buildL2Section('Status', [
        buildL2Row('State', m.state),
        buildL2Row('Priority', String(m.priority || '—')),
        buildL2Row('Form', m.form || '—'),
        buildL2Row('Sender', m.sender_display_name || '—'),
        buildL2Row('Created', m.created_at ? m.created_at.slice(0, 10) : '—'),
        m.deadline_at ? buildL2Row('Deadline', m.deadline_at.slice(0, 10)) : null,
        m.state_reason ? buildL2Row('Reason', m.state_reason) : null,
      ].filter(Boolean)));

      body.appendChild(buildL2Section('Brief', [
        el('div', { class: 'drawer-section-content' }, m.body || '—')
      ]));

      l2.appendChild(body);
    });
  }

  // ─── Task 2 + 4: Deliverable detail drawer ────────────────────────────────
  // Replaces alert() on citation chip click.
  // Also opened from bucket drawer items.

  function openDeliverableDrawer(delivId) {
    var d = getDeliverable(delivId);
    if (!d) {
      // Fallback for citation IDs not in fixtures (e.g. deliv_pricing_research)
      d = {
        title: 'Competitor X Pricing Research (May 1)',
        origin_label: 'local',
        created_at: '2026-05-01T10:00:00.000Z',
        body: { markdown: 'Competitor X had 3 tiers: $9 / $19 / $49. Site now shows only 2 tiers. Mid tier: $19 → $24 (~26% increase). Top tier ($49) unchanged. Entry tier dropped.' },
        author_staff_id: 'staff_01HKQ8RSCHRK4M7N2VBCXJ9WDPT',
      };
    }

    var authorStaff = d.author_staff_id ? getStaff(d.author_staff_id) : null;
    var bodyText = d.body && d.body.markdown ? d.body.markdown
      : d.body && typeof d.body === 'string' ? d.body
      : d.body ? JSON.stringify(d.body, null, 2)
      : '(no body)';

    openDrawerWith(function (panel) {
      var header = el('div', { class: 'drawer-header' });
      var iconEl = el('div', { class: 'drawer-header-avatar', style: 'background:var(--bg-alt); color:var(--ink); font-size:20px;' }, '📄');
      header.appendChild(iconEl);
      var hInfo = el('div', { class: 'drawer-header-info' });
      hInfo.appendChild(el('div', { class: 'drawer-header-name', style: 'font-size:15px;' }, d.title));
      hInfo.appendChild(el('div', { class: 'drawer-header-role' },
        authorStaff ? 'By ' + authorStaff.name : (d.author_remote_desk_id ? 'Remote deliverable' : 'Deliverable')
      ));
      header.appendChild(hInfo);
      header.appendChild(makeCloseBtn('Close deliverable detail'));
      panel.appendChild(header);

      var body = el('div', { class: 'drawer-body' });

      // Meta chips
      var metaRow = el('div', { class: 'deliv-drawer-meta' });
      metaRow.appendChild(el('span', { class: 'badge' }, d.origin_label || 'local'));
      if (d.body_kind) metaRow.appendChild(el('span', { class: 'badge' }, d.body_kind));
      if (d.created_at) metaRow.appendChild(el('span', { class: 'badge' }, d.created_at.slice(0, 10)));
      body.appendChild(metaRow);

      // Body
      body.appendChild(buildSection('Content', el('div', { class: 'deliv-drawer-body' }, bodyText)));

      // Attribution
      var attrContent = el('div', { class: 'drawer-section-content' });
      if (authorStaff) {
        attrContent.appendChild(el('div', null, 'Author: ' + authorStaff.name + ' (' + (authorStaff.role_label || authorStaff.role_name) + ')'));
        attrContent.appendChild(el('div', null, 'Substrate: ' + (authorStaff.substrate.kind || '—')));
      } else if (d.author_remote_desk_id) {
        attrContent.appendChild(el('div', null, 'Remote desk: ' + d.author_remote_desk_id.slice(0, 24) + '…'));
      }
      if (d.submitted_to_connection_id) {
        var conn = getConnection(d.submitted_to_connection_id);
        attrContent.appendChild(el('div', null, 'Submitted to: ' + (conn ? conn.display_name : d.submitted_to_connection_id)));
      }
      body.appendChild(buildSection('Attribution', attrContent));

      // Source link
      if (d.source_mission_id) {
        var srcMission = getMission(d.source_mission_id);
        if (srcMission) {
          var srcBtn = el('button', { class: 'deliv-drawer-link', type: 'button' });
          srcBtn.innerHTML = EXTERN_SVG + ' Source mission: ' + srcMission.title;
          srcBtn.addEventListener('click', function (ev) { ev.stopPropagation(); openMissionDetailInBucket(srcMission.id); });
          body.appendChild(buildSection('Source', srcBtn));
        }
      }

      panel.appendChild(body);

      // iter-001c: footer with Accept / Request revision (toast — no fixture mutation)
      var footer = el('div', { class: 'drawer-footer' });
      var accept = el('button', { class: 'mission-action mission-action-accept', type: 'button' }, 'Accept');
      var revise = el('button', { class: 'mission-action mission-action-ask',    type: 'button' }, 'Request revision');
      // Only meaningful on returned / submitted statuses; disabled on rejected
      if (d.status === 'rejected' || d.status === 'accepted') {
        accept.disabled = true; revise.disabled = true;
        accept.title = 'Already ' + d.status;
      }
      accept.addEventListener('click', function () { showToast('Wired in iter-002 BFF'); });
      revise.addEventListener('click', function () { showToast('Wired in iter-002 BFF'); });
      footer.appendChild(accept);
      footer.appendChild(revise);
      panel.appendChild(footer);
    });
  }

  // ─── Personal queue item drawer (ADR-015) ────────────────────────────────
  // Opens a detail drawer for a personal-queue item.
  // No alert() — per no-dead-end-clicks rule.

  function getPersonalQueueItem(id) {
    return ((fx().my_work_queue) || []).find(function (item) { return item.id === id; }) || null;
  }

  var PQ_PRIORITY_COLORS = {
    urgent: '#C0392B',
    high:   '#C69A35',
    normal: '#1F6F9E',
    low:    '#6E6A60',
  };

  function pqPriorityLabel(p) {
    if (p >= 80) return 'urgent';
    if (p >= 60) return 'high';
    if (p >= 40) return 'normal';
    return 'low';
  }

  function openPersonalQueueDrawer(itemId) {
    var item = getPersonalQueueItem(itemId);
    if (!item) return;

    var priorityTag = pqPriorityLabel(item.priority || 0);
    var accentColor = PQ_PRIORITY_COLORS[priorityTag] || '#6E6A60';

    openDrawerWith(function (panel) {
      // Header
      var header = el('div', { class: 'drawer-header' });
      var iconEl = el('div', { class: 'drawer-header-avatar', style: 'background:' + accentColor + '; color:#fff; font-size:18px;' }, '✏️');
      header.appendChild(iconEl);

      var hInfo = el('div', { class: 'drawer-header-info' });
      hInfo.appendChild(el('div', { class: 'drawer-header-name', style: 'font-size:15px;' }, item.title));

      var sourceLabel = item.source === 'from_mission' ? 'from mission' : 'own';
      var roleEl = el('div', { class: 'drawer-header-role' });
      roleEl.appendChild(el('span', { class: 'badge' }, sourceLabel));
      roleEl.appendChild(el('span', { class: 'badge' }, priorityTag));
      hInfo.appendChild(roleEl);

      header.appendChild(hInfo);
      header.appendChild(makeCloseBtn('Close personal queue item'));
      panel.appendChild(header);

      // Body
      var body = el('div', { class: 'drawer-body' });

      // Meta
      var metaRow = el('div', { style: 'display:flex; gap:8px; flex-wrap:wrap; margin-bottom:4px;' });
      metaRow.appendChild(el('span', { class: 'badge' }, 'Priority: ' + (item.priority || '—')));
      if (item.deadline) {
        var dl = new Date(item.deadline);
        metaRow.appendChild(el('span', { class: 'badge' }, 'Due: ' + dl.toISOString().slice(0, 10)));
      }
      body.appendChild(metaRow);

      // Full body text
      body.appendChild(buildSection('Details', el('div', { class: 'drawer-section-content' }, item.body || '(no details)')));

      panel.appendChild(body);
    });
  }

  // ─── Mission detail drawer (iter-001b) ────────────────────────────────────
  // Pattern ported from mibusy MissionSheet.tsx (fixed overlay + body + footer
  // actions). Adapted to right-side panel + L1 stack via openDrawerWith.

  var FORM_PLAIN = {
    direct_order:        'Authority form — sender directs the receiver to act within a defined scope. Receiver may accept, reject, or ask a clarifying question.',
    direct_takeover:     'Authority form — sender hands full execution authority to receiver for the named scope. Receiver acts as if they were the sender.',
    approval_chain:      'Authority form — receiver reviews and either approves or rejects. No transformation.',
    dual_authorization:  'Mutual form — both parties must cosign before the action lands. Either side can refuse.',
    negotiated:          'Mutual form — sender proposes; receiver may counter. Both must agree on final scope.',
    advisory:            'Receiver-passive form — sender shares an opinion. Receiver may cite but not act on the sender\'s behalf.',
    observer_brief:      'Receiver-passive form — informational only. Receiver acknowledges; no action expected.',
    watch_brief:         'Receiver-passive form — receiver monitors a named signal and reports back if it changes.',
    temporary_cover:     'Time-sensitive form — receiver covers a named role for a bounded window. Authority lapses at deadline.',
    conditional_engagement: 'Time-sensitive form — receiver acts only if a specified condition becomes true.',
    subcontracting:      'Composite form — receiver may further delegate to their own staff or peers; sub-handoffs must be disclosed back.',
    parallel_solicitation: 'Composite form — sender sent the same request to multiple receivers in parallel; first valid reply wins.',
    standing_request:    'Recurring form — receiver fulfills a known cadence (e.g., quarterly report). Each delivery counts as one fulfillment.',
  };

  var MISSION_AUTH_SCOPE_DETAIL = {
    direct_order:        'You may use any tool in your scope to transform the inputs into a deliverable. You may not act outside this mission\'s named scope.',
    direct_takeover:     'You have full execution authority for the duration of this mission. Sender will not intervene.',
    approval_chain:      'You may approve or reject only. Do not transform the artifact.',
    dual_authorization:  'You may cosign this action. Your signature alone is not sufficient — the other party must also sign.',
    negotiated:          'You may propose a counter-scope. Final scope is jointly agreed before either party executes.',
    advisory:            'You may read and cite this material. You may not act on the sender\'s behalf.',
    observer_brief:      'You may read this. No action expected. Acknowledge to clear from your inbox.',
    watch_brief:         'You may monitor the named signal. Notify the sender if the signal changes.',
    temporary_cover:     'You may execute the named role until the deadline. Authority lapses automatically.',
    conditional_engagement: 'You may act only if the specified trigger condition is met. Otherwise no action.',
    subcontracting:      'You may sub-delegate to your staff or peers. Disclose all sub-handoffs back to the original sender.',
    parallel_solicitation: 'You may reply if you can. Sender will pick one reply; others may not be used.',
    standing_request:    'You may fulfill this on the established cadence. No per-fulfillment renegotiation needed.',
  };

  var MISSION_STATE_CHIP_LABEL = {
    queued:              'Pending',
    accepted:            'Accepted',
    in_progress:         'In progress',
    blocked:             'Blocked',
    submitted:           'Submitted',
    rejected:            'Rejected',
    expired:             'Expired',
    returned_to_origin:  'Returned',
  };

  // Mocked context-pack items (would come from BFF in V1).
  var MOCK_CONTEXT_PACKS = {
    standing_request:    [{ name: 'Q1 baseline summary', kind: 'doc' }, { name: 'Contract change-log', kind: 'sheet' }, { name: 'Citation policy', kind: 'doc' }],
    advisory:            [{ name: 'Counterparty redlines', kind: 'doc' }, { name: 'Prior NDA template', kind: 'doc' }],
    direct_order:        [{ name: 'Research scope brief', kind: 'doc' }, { name: 'Prior survey notes', kind: 'doc' }, { name: 'Citation requirements', kind: 'doc' }],
    subcontracting:      [{ name: 'RFI question bank', kind: 'sheet' }, { name: 'Last proposal v3', kind: 'doc' }, { name: 'Win/loss notes', kind: 'doc' }],
    dual_authorization:  [{ name: 'SOC 2 attestation draft', kind: 'doc' }, { name: 'Cosigner instructions', kind: 'doc' }],
    observer_brief:      [{ name: 'Q-review summary', kind: 'doc' }],
    default:             [{ name: 'Context item 1', kind: 'doc' }, { name: 'Context item 2', kind: 'doc' }],
  };

  function openMissionDrawer(missionId) {
    var m = getMission(missionId);
    if (!m) return;

    var stateLabel = MISSION_STATE_CHIP_LABEL[m.state] || m.state;
    var formLabel  = m.form ? m.form.replace(/_/g, ' ') : '—';
    var contextPack = MOCK_CONTEXT_PACKS[m.form] || MOCK_CONTEXT_PACKS.default;

    openDrawerWith(function (panel) {

      // ── Header (mibusy MissionSheet.tsx header pattern) ──────────────────
      var header = el('div', { class: 'drawer-header' });
      var iconEl = el('div', { class: 'drawer-header-avatar', style: 'background:var(--bg-alt); color:var(--ink); font-size:18px;' }, '📬');
      header.appendChild(iconEl);

      var hInfo = el('div', { class: 'drawer-header-info' });
      hInfo.appendChild(el('div', { class: 'drawer-header-name', style: 'font-size:15px;' }, m.title));
      var roleEl = el('div', { class: 'drawer-header-role' });
      roleEl.appendChild(el('span', { class: 'mission-state-chip state-' + m.state }, stateLabel));
      roleEl.appendChild(el('span', { class: 'badge' }, formLabel));
      roleEl.appendChild(el('span', null, '·'));
      roleEl.appendChild(el('span', null, 'from ' + (m.sender_display_name || 'unknown')));
      hInfo.appendChild(roleEl);
      header.appendChild(hInfo);
      header.appendChild(makeCloseBtn('Close mission detail'));
      panel.appendChild(header);

      // ── Body ─────────────────────────────────────────────────────────────
      var body = el('div', { class: 'drawer-body' });

      // Meta strip
      var metaRow = el('div', { style: 'display:flex; gap:8px; flex-wrap:wrap;' });
      metaRow.appendChild(el('span', { class: 'badge' }, 'priority ' + (m.priority || '—')));
      if (m.deadline_at) metaRow.appendChild(el('span', { class: 'badge' }, 'deadline ' + m.deadline_at.slice(0, 10)));
      if (m.created_at)  metaRow.appendChild(el('span', { class: 'badge' }, 'arrived ' + m.created_at.slice(0, 10)));
      if (m.state_reason) metaRow.appendChild(el('span', { class: 'badge', style: 'background:#FBE8E5; color:#7A1F0F; border-color:#F1C8C0;' }, m.state_reason));
      body.appendChild(metaRow);

      // Full mission body
      body.appendChild(buildSection('Mission brief',
        el('pre', { class: 'mission-body' }, m.body || '(empty body)')
      ));

      // Form details panel
      var formContent = el('div', { class: 'drawer-section-content' });
      formContent.appendChild(el('div', { style: 'font-size:13px; font-weight:600; margin-bottom:4px;' }, formLabel));
      formContent.appendChild(el('div', { style: 'font-size:12px; color:var(--ink-soft); line-height:1.5;' },
        FORM_PLAIN[m.form] || 'No description available for this form.'));
      body.appendChild(buildSection('About this form', formContent));

      // Context pack viewer (mocked)
      var packList = el('div', { class: 'mission-context-list' });
      contextPack.forEach(function (item) {
        var btn = el('button', { class: 'mission-context-item', type: 'button' });
        btn.innerHTML = '<span class="mission-context-item-icon">' + (item.kind === 'sheet' ? '📊' : '📄') + '</span>' +
                        '<span class="mission-context-item-name">' + item.name + '</span>' +
                        '<span class="mission-context-item-kind">' + item.kind + '</span>';
        btn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          showToast('Context pack viewer in iter-001c');
        });
        packList.appendChild(btn);
      });
      body.appendChild(buildSection('Context pack (' + contextPack.length + ' items)', packList));

      // Authority scope detail
      body.appendChild(buildSection('What you may do',
        el('div', { class: 'drawer-section-content', style: 'font-size:12px; line-height:1.55;' },
          MISSION_AUTH_SCOPE_DETAIL[m.form] || 'Scope details not specified for this form.')
      ));

      // Assigned member (if any)
      if (m.assigned_staff_id) {
        var assigned = getStaff(m.assigned_staff_id);
        if (assigned) {
          var assignBtn = el('button', { class: 'deliv-drawer-link', type: 'button' });
          assignBtn.innerHTML = EXTERN_SVG + ' Assigned to: ' + assigned.name + ' →';
          assignBtn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            closeDrawer();
            setTimeout(function () { openMemberDrawer(assigned.id); }, 250);
          });
          body.appendChild(buildSection('Assignment', assignBtn));
        }
      }

      panel.appendChild(body);

      // ── Footer action area (Accept / Reject / Ask question) ─────────────
      var footer = el('div', { class: 'drawer-footer' });
      var accept = el('button', { class: 'mission-action mission-action-accept', type: 'button' }, 'Accept');
      var reject = el('button', { class: 'mission-action mission-action-reject', type: 'button' }, 'Reject');
      var ask    = el('button', { class: 'mission-action mission-action-ask',    type: 'button' }, 'Ask question');

      var actionable = m.state === 'queued' || m.state === 'accepted' || m.state === 'in_progress' || m.state === 'blocked';
      if (!actionable) {
        accept.disabled = true; reject.disabled = true; ask.disabled = true;
        accept.title = 'Mission already ' + stateLabel.toLowerCase();
      }
      accept.addEventListener('click', function () { showToast('Wired in iter-002 BFF'); });
      reject.addEventListener('click', function () { showToast('Wired in iter-002 BFF'); });
      ask.addEventListener('click',    function () { showToast('Wired in iter-002 BFF'); });
      footer.appendChild(accept);
      footer.appendChild(reject);
      footer.appendChild(ask);
      panel.appendChild(footer);
    });
  }

  // ─── Connection detail drawer (iter-001b step 6) ──────────────────────────
  // L1: metadata, health timeline, recent handoffs, masked token, policy.
  // L2: full config (URL + masked token + mode badge) — ported from
  //     mibusy FacadeConfig.tsx.

  function getRecentHandoffsFor(connId) {
    var f = fx();
    var ms = (f.missions || []).filter(function (m) {
      return m.sender_connection_id === connId;
    }).slice(0, 3).map(function (m) {
      return { type: 'mission', title: m.title, state: m.state, ts: m.created_at, id: m.id };
    });
    var ds = (f.deliverables || []).filter(function (d) {
      return d.submitted_to_connection_id === connId;
    }).slice(0, 3).map(function (d) {
      return { type: 'deliverable', title: d.title, state: 'submitted', ts: d.created_at, id: d.id };
    });
    return ms.concat(ds).sort(function (a, b) {
      return (b.ts || '').localeCompare(a.ts || '');
    }).slice(0, 5);
  }

  function buildHealthTimelineRows(c) {
    // Mock timeline derived from fixture timestamps
    var rows = [];
    if (c.paired_at)            rows.push({ ts: c.paired_at,            state: 'paired',       reason: 'Connection paired' });
    if (c.last_successful_at)   rows.push({ ts: c.last_successful_at,   state: 'healthy',      reason: 'Heartbeat OK' });
    if (c.last_failure_at)      rows.push({ ts: c.last_failure_at,      state: c.health_state, reason: c.last_failure_reason || '(no reason recorded)' });
    if (c.revoked_at)           rows.push({ ts: c.revoked_at,           state: 'revoked',      reason: c.revoked_reason || '(no reason recorded)' });
    return rows.sort(function (a, b) { return (b.ts || '').localeCompare(a.ts || ''); }).slice(0, 5);
  }

  function buildConnHealthBadge(state) {
    var label = { healthy:'Healthy', degraded:'Degraded', offline:'Offline', retrying:'Retrying', revoked:'Revoked', invalid_token:'Invalid token' }[state] || state;
    var pill = el('span', { class: 'conn-health-badge conn-health-' + state });
    pill.appendChild(el('span', { class: 'conn-health-dot' }));
    pill.appendChild(el('span', { class: 'conn-health-label' }, label));
    return pill;
  }

  function openConnectionDrawer(connId) {
    var c = getConnection(connId);
    if (!c) return;

    openDrawerWith(function (panel) {

      // ── Header ───────────────────────────────────────────────────────────
      var header = el('div', { class: 'drawer-header' });
      var avatar = el('div', { class: 'drawer-header-avatar', style: 'background:var(--bg-alt); color:var(--ink); font-weight:700; font-size:17px;' },
        (c.display_name || '?').charAt(0).toUpperCase());
      header.appendChild(avatar);

      var hInfo = el('div', { class: 'drawer-header-info' });
      var nameEl = el('div', { class: 'drawer-header-name' }, c.display_name || '(unnamed)');
      if (c.health_state === 'revoked') nameEl.style.textDecoration = 'line-through';
      hInfo.appendChild(nameEl);
      var roleEl = el('div', { class: 'drawer-header-role' });
      roleEl.appendChild(buildConnHealthBadge(c.health_state));
      roleEl.appendChild(el('span', null, '·'));
      roleEl.appendChild(el('span', null, 'paired ' + (c.paired_at ? c.paired_at.slice(0, 10) : '—')));
      hInfo.appendChild(roleEl);
      header.appendChild(hInfo);
      header.appendChild(makeCloseBtn('Close connection detail'));
      panel.appendChild(header);

      // ── Body ─────────────────────────────────────────────────────────────
      var body = el('div', { class: 'drawer-body' });

      // Metadata
      var metaSec = el('div', { class: 'drawer-section' });
      metaSec.appendChild(el('div', { class: 'drawer-section-label' }, 'Metadata'));
      var metaPanel = el('div', { class: 'backing-panel' });
      addPanelRow(metaPanel, 'Paired at',         c.paired_at ? c.paired_at.slice(0, 10) : '—');
      addPanelRow(metaPanel, 'Last success',      c.last_successful_at ? c.last_successful_at.slice(0, 19).replace('T', ' ') : '—');
      addPanelRow(metaPanel, 'Remote person ID',  c.remote_person_id ? c.remote_person_id.slice(0, 28) + '…' : '—');
      addPanelRow(metaPanel, 'Capabilities',      (c.remote_desk_capabilities || []).join(', ') || '—');
      if (c.revoked_at)       addPanelRow(metaPanel, 'Revoked at', c.revoked_at.slice(0, 10));
      if (c.revoked_reason)   addPanelRow(metaPanel, 'Revoke reason', c.revoked_reason);
      metaSec.appendChild(metaPanel);
      body.appendChild(metaSec);

      // Health timeline
      var tlRows = buildHealthTimelineRows(c);
      var tlWrap = el('div', { class: 'conn-detail-timeline' });
      if (tlRows.length === 0) {
        tlWrap.appendChild(el('div', { class: 'drawer-section-content' }, 'No timeline events recorded.'));
      } else {
        tlRows.forEach(function (r) {
          var row = el('div', { class: 'conn-timeline-row' });
          row.appendChild(el('span', { class: 'ts' }, r.ts ? r.ts.slice(0, 10) : '—'));
          var detail = el('div');
          detail.appendChild(el('div', { style: 'font-weight:600; font-size:12px;' }, r.state));
          detail.appendChild(el('div', { style: 'color:var(--ink-mute); font-size:11px;' }, r.reason));
          row.appendChild(detail);
          tlWrap.appendChild(row);
        });
      }
      var tlSec = el('div', { class: 'drawer-section' });
      tlSec.appendChild(el('div', { class: 'drawer-section-label' }, 'Health timeline'));
      tlSec.appendChild(tlWrap);
      body.appendChild(tlSec);

      // Recent handoffs
      var handoffs = getRecentHandoffsFor(c.id);
      var hSec = el('div', { class: 'drawer-section' });
      hSec.appendChild(el('div', { class: 'drawer-section-label' }, 'Recent handoffs'));
      if (handoffs.length === 0) {
        hSec.appendChild(el('div', { class: 'drawer-section-content' }, 'No recent handoffs through this connection.'));
      } else {
        var hList = el('div', { style: 'display:flex; flex-direction:column; gap:6px;' });
        handoffs.forEach(function (h) {
          var btn = el('button', { class: 'assignment-row', type: 'button', style: 'cursor:pointer; width:100%; text-align:left; transition: background 0.12s;' });
          btn.appendChild(el('div', { class: 'assignment-row-dot ' + (h.type === 'deliverable' ? 'completed' : (h.state === 'in_progress' ? 'running' : h.state)) }));
          var col = el('div', { style: 'flex:1; min-width:0;' });
          col.appendChild(el('div', { class: 'assignment-row-title' }, h.title));
          col.appendChild(el('div', { style: 'font-size:11px; color:var(--ink-mute);' }, h.type + ' · ' + h.state));
          btn.appendChild(col);
          btn.appendChild(el('span', { style: 'font-size:11px; color:var(--ink-mute); flex-shrink:0;' }, h.ts ? h.ts.slice(0, 10) : ''));
          btn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            if (h.type === 'mission')      openMissionDrawer(h.id);
            else if (h.type === 'deliverable') openDeliverableDrawer(h.id);
          });
          btn.addEventListener('mouseenter', function () { btn.style.background = 'var(--bg-alt)'; });
          btn.addEventListener('mouseleave', function () { btn.style.background = ''; });
          hList.appendChild(btn);
        });
        hSec.appendChild(hList);
      }
      body.appendChild(hSec);

      // Token info
      var tokenSec = el('div', { class: 'drawer-section' });
      tokenSec.appendChild(el('div', { class: 'drawer-section-label' }, 'Token & key'));
      var tokenRow = el('div', { class: 'conn-token-row' });
      tokenRow.appendChild(el('span', { class: 'conn-token-mask' }, '••••••••••••••••••••'));
      var copyBtn = el('button', { class: 'conn-copy-btn', type: 'button' }, 'Copy');
      copyBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        try { navigator.clipboard && navigator.clipboard.writeText('REDACTED_IN_MOCK'); } catch (e) {}
        copyBtn.classList.add('is-copied');
        copyBtn.textContent = '✓ Copied';
        setTimeout(function () {
          copyBtn.classList.remove('is-copied');
          copyBtn.textContent = 'Copy';
        }, 1400);
      });
      tokenRow.appendChild(copyBtn);
      tokenSec.appendChild(tokenRow);

      // Rotation info
      var rotPanel = el('div', { class: 'backing-panel', style: 'margin-top:8px;' });
      addPanelRow(rotPanel, 'Last rotated', c.paired_at ? c.paired_at.slice(0, 10) : '—');
      addPanelRow(rotPanel, 'Expires',      c.health_state === 'invalid_token' ? '⚠️ Expired — re-pair required' : 'Auto-rotates every 90 days');
      addPanelRow(rotPanel, 'Key fingerprint', 'sha256:9f3c8a…b4e2d1');
      tokenSec.appendChild(rotPanel);
      body.appendChild(tokenSec);

      // Policy
      var polSec = el('div', { class: 'drawer-section' });
      polSec.appendChild(el('div', { class: 'drawer-section-label' }, 'Policy'));
      var polPanel = el('div', { class: 'backing-panel' });
      addPanelRow(polPanel, 'Accepted forms', 'direct_order, advisory, subcontracting');
      addPanelRow(polPanel, 'Rate limit',     '100 handoffs / day');
      addPanelRow(polPanel, 'Auto-accept',    'no — owner reviews each');
      polSec.appendChild(polPanel);
      body.appendChild(polSec);

      // L2 config link
      var l2Btn = el('button', { class: 'backing-panel-link', type: 'button', style: 'font-size:13px;' });
      l2Btn.innerHTML = EXTERN_SVG + ' View connection config →';
      l2Btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openL2(function (l2) { buildL2ConnectionConfig(l2, c); });
      });
      var l2Sec = el('div', { class: 'drawer-section' });
      l2Sec.appendChild(el('div', { class: 'drawer-section-label' }, 'Configuration'));
      l2Sec.appendChild(l2Btn);
      body.appendChild(l2Sec);

      panel.appendChild(body);

      // ── Footer: Send handoff (iter-001c) + Revoke (two-step) ────────────
      var footer = el('div', { class: 'drawer-footer' });
      var send = el('button', { class: 'mission-action mission-action-accept', type: 'button' }, 'Send handoff');
      if (c.health_state === 'revoked' || c.health_state === 'invalid_token') {
        send.disabled = true;
        send.title = 'Connection ' + c.health_state + ' — cannot send';
      }
      send.addEventListener('click', function () {
        if (send.disabled) return;
        closeDrawer();
        // Slight delay so drawer close animation completes before composer mounts
        setTimeout(function () {
          if (window.HOLON_COMPOSER) {
            window.HOLON_COMPOSER.open({ recipientId: c.id });
          } else {
            showToast('Composer not loaded');
          }
        }, 230);
      });
      footer.appendChild(send);

      var revoke = el('button', { class: 'mission-action mission-action-reject', type: 'button' }, 'Revoke connection');
      if (c.health_state === 'revoked') {
        revoke.disabled = true;
        revoke.textContent = 'Already revoked';
      }
      revoke.addEventListener('click', function () {
        if (revoke.disabled) return;
        if (revoke.dataset.confirming === 'true') {
          showToast('Wired in iter-002 BFF');
          revoke.dataset.confirming = 'false';
          revoke.textContent = 'Revoke connection';
        } else {
          revoke.dataset.confirming = 'true';
          revoke.textContent = 'Confirm revoke?';
          setTimeout(function () {
            if (revoke.dataset.confirming === 'true') {
              revoke.dataset.confirming = 'false';
              revoke.textContent = 'Revoke connection';
            }
          }, 4000);
        }
      });
      footer.appendChild(revoke);
      panel.appendChild(footer);
    });
  }

  // L2: connection config panel (ported from FacadeConfig.tsx)
  function buildL2ConnectionConfig(l2, c) {
    var header = el('div', { class: 'drawer-l2-header' });
    header.appendChild(makeBackBtn('Back to connection detail', closeL2));
    var headerText = el('div');
    headerText.appendChild(el('div', { class: 'drawer-l2-title' }, 'Connection config'));
    headerText.appendChild(el('div', { class: 'drawer-l2-subtitle' }, c.display_name + ' · ' + (c.id || '').slice(0, 20) + '…'));
    header.appendChild(headerText);
    l2.appendChild(header);

    var body = el('div', { class: 'drawer-l2-body' });

    // Mode badge (mibusy FacadeConfig.tsx mode-badge)
    var modeSec = el('div', { class: 'drawer-section' });
    modeSec.appendChild(el('div', { class: 'drawer-section-label' }, 'Mode'));
    var modeRow = el('div', { style: 'display:flex; align-items:center; gap:10px; padding:10px 12px; background:#fff; border:1px solid var(--line); border-radius:10px;' });
    modeRow.appendChild(buildConnHealthBadge(c.health_state));
    modeRow.appendChild(el('span', { style: 'font-size:12px; color:var(--ink-soft);' },
      c.health_state === 'healthy' ? 'Peer is reachable; messages flow normally.' :
      c.health_state === 'degraded' ? 'Peer reachable but latency above SLO.' :
      c.health_state === 'offline' ? 'Peer unreachable. Outbound queued.' :
      c.health_state === 'retrying' ? 'Backoff in progress. Will retry automatically.' :
      c.health_state === 'invalid_token' ? 'Signing key rotated remotely. Re-pair required.' :
      c.health_state === 'revoked' ? 'Connection revoked. Read-only.' :
      'Unknown state.'
    ));
    modeSec.appendChild(modeRow);
    body.appendChild(modeSec);

    // URL block (mocked — V1 will pull from real connection record)
    var urlSec = el('div', { class: 'drawer-section' });
    urlSec.appendChild(el('div', { class: 'drawer-section-label' }, 'Peer URL'));
    var urlRow = el('div', { class: 'conn-token-row' });
    var urlVal = 'https://desk-' + (c.id || '').slice(-8).toLowerCase() + '.holon-mock.example/peer';
    urlRow.appendChild(el('span', { class: 'conn-token-mask', style: 'letter-spacing:0; color:var(--ink);' }, urlVal));
    var urlCopy = el('button', { class: 'conn-copy-btn', type: 'button' }, 'Copy');
    urlCopy.addEventListener('click', function (ev) {
      ev.stopPropagation();
      try { navigator.clipboard && navigator.clipboard.writeText(urlVal); } catch (e) {}
      urlCopy.classList.add('is-copied');
      urlCopy.textContent = '✓ Copied';
      setTimeout(function () {
        urlCopy.classList.remove('is-copied');
        urlCopy.textContent = 'Copy';
      }, 1400);
    });
    urlRow.appendChild(urlCopy);
    urlSec.appendChild(urlRow);
    body.appendChild(urlSec);

    // Token block (masked)
    var tokSec = el('div', { class: 'drawer-section' });
    tokSec.appendChild(el('div', { class: 'drawer-section-label' }, 'Peer token (masked)'));
    var tokRow = el('div', { class: 'conn-token-row' });
    tokRow.appendChild(el('span', { class: 'conn-token-mask' }, '••••••••••••••••••••••••••••••••'));
    var tokCopy = el('button', { class: 'conn-copy-btn', type: 'button' }, 'Copy');
    tokCopy.addEventListener('click', function (ev) {
      ev.stopPropagation();
      try { navigator.clipboard && navigator.clipboard.writeText('REDACTED_IN_MOCK'); } catch (e) {}
      tokCopy.classList.add('is-copied');
      tokCopy.textContent = '✓ Copied';
      setTimeout(function () {
        tokCopy.classList.remove('is-copied');
        tokCopy.textContent = 'Copy';
      }, 1400);
    });
    tokRow.appendChild(tokCopy);
    tokSec.appendChild(tokRow);
    body.appendChild(tokSec);

    // Counterparty
    var cpSec = el('div', { class: 'drawer-section' });
    cpSec.appendChild(el('div', { class: 'drawer-section-label' }, 'Counterparty'));
    var cpPanel = el('div', { class: 'backing-panel' });
    addPanelRow(cpPanel, 'Display name',  c.display_name || '—');
    addPanelRow(cpPanel, 'Remote person', c.remote_person_id ? c.remote_person_id.slice(0, 28) + '…' : '—');
    addPanelRow(cpPanel, 'Capabilities',  (c.remote_desk_capabilities || []).join(', ') || '—');
    cpSec.appendChild(cpPanel);
    body.appendChild(cpSec);

    l2.appendChild(body);
  }

  // ─── Wire member card body clicks ─────────────────────────────────────────
  // Called after grid renders. Adds click handler to card body (not chat icon,
  // not autonomy badge) per task spec.

  function wireMemberCardClicks() {
    document.querySelectorAll('.staff-card').forEach(function (card) {
      if (card.dataset.drawerWired) return;
      card.dataset.drawerWired = 'true';

      var staffId = card.dataset.staffId;
      if (!staffId) return;

      card.style.cursor = 'pointer';

      card.addEventListener('click', function (ev) {
        // Don't fire if click was on autonomy badge, chat button, or autonomy popover option
        var target = ev.target;
        if (target.closest('.autonomy-badge')) return;
        if (target.closest('.member-chat-btn')) return;
        if (target.closest('.autonomy-popover')) return;
        openMemberDrawer(staffId);
      });
    });
  }

  // ─── Wire Today bucket cards ──────────────────────────────────────────────

  function wireBucketCards() {
    var BUCKET_KEYS = ['ai_running', 'peer_waiting', 'pending', 'returned', 'blocked', 'retrying'];
    var cards = document.querySelectorAll('.bucket-card');
    cards.forEach(function (card, i) {
      var key = BUCKET_KEYS[i];
      if (!key) return;
      if (card.dataset.bucketWired) return;
      card.dataset.bucketWired = 'true';
      card.style.cursor = 'pointer';
      card.addEventListener('click', function () { openBucketDrawer(key); });
    });
  }

  // ─── Boot ──────────────────────────────────────────────────────────────────

  function boot() {
    ensureToastContainer();

    // Wire member cards (if on members page)
    wireMemberCardClicks();

    // Wire bucket cards (if on today page)
    wireBucketCards();

    // Observe DOM for dynamically added cards
    if (window.MutationObserver) {
      var observer = new MutationObserver(function (mutations) {
        var hasNew = mutations.some(function (m) {
          return Array.from(m.addedNodes).some(function (n) {
            return n.nodeType === 1;
          });
        });
        if (hasNew) {
          wireMemberCardClicks();
          wireBucketCards();
        }
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

  window.HOLON_DRAWER = {
    openMemberDrawer:          openMemberDrawer,
    openDeliverableDrawer:     openDeliverableDrawer,
    openBucketDrawer:          openBucketDrawer,
    openPersonalQueueDrawer:   openPersonalQueueDrawer,
    openMissionDrawer:         openMissionDrawer,
    openConnectionDrawer:      openConnectionDrawer,
    showToast:                 showToast,
    _wireMemberCardClicks:     wireMemberCardClicks,
    _wireBucketCards:          wireBucketCards,
    close:                     closeDrawer,
  };

})();
