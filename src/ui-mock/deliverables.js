/* deliverables.js — 3-column Deliverables screen (iter-001c step 1).
 *
 * Mibusy port: card layout reuses the mission-row pattern from
 * MissionInbox.tsx; row click → HOLON_DRAWER.openDeliverableDrawer
 * which already exists in drawer.js (originally from iter-001a-patch).
 *
 * Columns:
 *  - Local AI       (origin_label = 'local')
 *  - Remote returned (origin_label = 'remote')
 *  - Submitted upstream (origin_label = 'submitted')
 *
 * Per card: status badge (draft/final/accepted/rejected/revised), title,
 * one-line body excerpt, originator (staff name or remote desk), timestamp.
 *
 * Empty-state UI per column when fixture filters to zero.
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

  function fx() { return window.HOLON_FIXTURES || { deliverables: [], staff: [], connections: [] }; }

  function getStaffById(id) {
    return (fx().staff || []).find(function (s) { return s.id === id; }) || null;
  }
  function getConnById(id) {
    return (fx().connections || []).find(function (c) { return c.id === id; }) || null;
  }

  var STATUS_LABEL = {
    draft:    'Draft',
    final:    'Final',
    accepted: 'Accepted',
    rejected: 'Rejected',
    revised:  'Revised',
  };

  function excerpt(d) {
    var src = '';
    if (d.body && typeof d.body === 'object' && d.body.markdown) {
      src = d.body.markdown;
    } else if (d.body && typeof d.body === 'string') {
      src = d.body;
    } else if (d.body) {
      src = JSON.stringify(d.body);
    }
    src = String(src).split(/\r?\n/)[0].trim();
    return src.length > 100 ? src.slice(0, 97) + '…' : src;
  }

  function originLine(d) {
    if (d.author_staff_id) {
      var s = getStaffById(d.author_staff_id);
      return s ? 'By ' + s.name : 'By local staff';
    }
    if (d.author_remote_desk_id) {
      return 'From remote desk';
    }
    if (d.submitted_to_connection_id) {
      var c = getConnById(d.submitted_to_connection_id);
      return 'To ' + (c ? c.display_name : 'peer');
    }
    return 'Deliverable';
  }

  function buildCard(d) {
    var card = el('div', { class: 'deliv-card status-' + (d.status || 'draft'), 'data-deliv-id': d.id });

    // Top: status chip + body kind
    var top = el('div', { class: 'deliv-card-top' });
    top.appendChild(el('span', { class: 'deliv-status-chip deliv-status-' + (d.status || 'draft') },
      STATUS_LABEL[d.status] || (d.status || 'draft')));
    if (d.body_kind) {
      top.appendChild(el('span', { class: 'deliv-kind-chip' }, d.body_kind));
    }
    var ts = d.created_at ? d.created_at.slice(0, 10) : '';
    if (ts) top.appendChild(el('span', { class: 'deliv-ts' }, ts));
    card.appendChild(top);

    // Title
    card.appendChild(el('div', { class: 'deliv-card-title' }, d.title));

    // Excerpt
    var ex = excerpt(d);
    if (ex) card.appendChild(el('div', { class: 'deliv-card-excerpt' }, ex));

    // Origin
    card.appendChild(el('div', { class: 'deliv-card-origin' }, originLine(d)));

    card.addEventListener('click', function () {
      if (window.HOLON_DRAWER && window.HOLON_DRAWER.openDeliverableDrawer) {
        window.HOLON_DRAWER.openDeliverableDrawer(d.id);
      }
    });

    return card;
  }

  // Column empty-state messages
  var EMPTY_COPY = {
    local:     { text: 'No local-AI deliverables yet.',          cta: 'Go to Today', href: 'index.html' },
    remote:    { text: 'No deliverables returned from peers yet.', cta: 'View Connections', href: 'connections.html' },
    submitted: { text: 'You have not submitted any deliverables upstream yet.', cta: 'View Inbound', href: 'inbound.html' },
  };

  function renderEmptyState(colKey) {
    var meta = EMPTY_COPY[colKey];
    var wrap = el('div', { class: 'deliv-empty' });
    wrap.appendChild(el('div', { class: 'deliv-empty-icon' }, '∅'));
    wrap.appendChild(el('div', { class: 'deliv-empty-text' }, meta.text));
    var cta = el('a', { class: 'deliv-empty-cta', href: meta.href }, meta.cta + ' →');
    wrap.appendChild(cta);
    return wrap;
  }

  function renderColumn(colKey, originValue) {
    var listEl  = document.getElementById('list-' + colKey);
    var countEl = document.getElementById('count-' + colKey);
    if (!listEl) return;

    var items = (fx().deliverables || [])
      .filter(function (d) { return d.origin_label === originValue; })
      .sort(function (a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); });

    listEl.innerHTML = '';
    if (countEl) countEl.textContent = items.length;

    if (items.length === 0) {
      listEl.appendChild(renderEmptyState(colKey));
      return;
    }
    items.forEach(function (d) { listEl.appendChild(buildCard(d)); });
  }

  function boot() {
    if (!document.getElementById('list-local')) return; // not the deliverables page
    renderColumn('local',     'local');
    renderColumn('remote',    'remote');
    renderColumn('submitted', 'submitted');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
