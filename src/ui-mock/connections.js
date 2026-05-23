/* connections.js — Peer connections screen (iter-001b).
 *
 * Mibusy port:
 *  - Health badge / mode badge / online dot pattern from FacadeConfig.tsx
 *    (adapted to 6-state palette per requirements.md §2).
 *  - L1 detail drawer body sections (metadata, masked token) from FacadeConfig.tsx.
 *
 * Health summary banner: designed fresh (no mibusy equivalent).
 * Pair-new sheet: designed fresh; see openPairSheet() in this file.
 *
 * Sort order per requirements: needs-attention first (degraded / offline /
 * retrying / invalid_token), then healthy, then revoked.
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

  function fx() { return window.HOLON_FIXTURES || { connections: [], missions: [], deliverables: [] }; }

  function showToast(msg) {
    if (window.HOLON_DRAWER && window.HOLON_DRAWER.showToast) {
      window.HOLON_DRAWER.showToast(msg);
    }
  }

  // ── Health state metadata ─────────────────────────────────────────────────
  var HEALTH_LABEL = {
    healthy:        'Healthy',
    degraded:       'Degraded',
    offline:        'Offline',
    retrying:       'Retrying',
    revoked:        'Revoked',
    invalid_token:  'Invalid token',
  };
  var HEALTH_ATTENTION_ORDER = {
    degraded: 0, offline: 1, retrying: 2, invalid_token: 3, healthy: 10, revoked: 20,
  };

  // ── Pending handoff count per connection (mock derive) ───────────────────
  function pendingHandoffs(conn) {
    var inCount = (fx().missions || []).filter(function (m) {
      return m.sender_connection_id === conn.id &&
        (m.state === 'queued' || m.state === 'accepted' || m.state === 'in_progress' || m.state === 'blocked');
    }).length;
    var outCount = (fx().deliverables || []).filter(function (d) {
      return d.submitted_to_connection_id === conn.id;
    }).length;
    return inCount + outCount;
  }

  // ── Relative timestamp ────────────────────────────────────────────────────
  function relTime(iso) {
    if (!iso) return '—';
    var then = new Date(iso);
    var now  = new Date();
    var diff = now - then;
    var m = Math.floor(diff / 60000);
    if (m < 1)    return 'just now';
    if (m < 60)   return m + ' min ago';
    var h = Math.floor(m / 60);
    if (h < 24)   return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
    var d = Math.floor(h / 24);
    if (d < 30)   return d + ' day' + (d === 1 ? '' : 's') + ' ago';
    return then.toISOString().slice(0, 10);
  }

  // ── Health summary banner ─────────────────────────────────────────────────
  function renderBanner() {
    var banner = document.getElementById('health-banner');
    if (!banner) return;
    var conns = fx().connections || [];

    var counts = { degraded: 0, offline: 0, retrying: 0, revoked: 0, invalid_token: 0, healthy: 0 };
    conns.forEach(function (c) { counts[c.health_state] = (counts[c.health_state] || 0) + 1; });

    var attentionNeeded = counts.degraded + counts.offline + counts.retrying + counts.invalid_token;

    banner.className = 'health-banner';
    banner.innerHTML = '';

    if (attentionNeeded === 0) {
      banner.classList.add('banner-ok');
      var dot = el('span', { class: 'banner-dot' });
      banner.appendChild(dot);
      banner.appendChild(el('strong', null, 'All connections healthy'));
      banner.appendChild(el('span', { class: 'banner-detail' },
        ' · ' + counts.healthy + ' active · ' + counts.revoked + ' revoked'));
    } else {
      banner.classList.add(counts.invalid_token > 0 || counts.offline > 0 ? 'banner-alert' : 'banner-warn');
      var dot2 = el('span', { class: 'banner-dot' });
      banner.appendChild(dot2);
      banner.appendChild(el('strong', null,
        attentionNeeded + ' connection' + (attentionNeeded === 1 ? '' : 's') + ' need' + (attentionNeeded === 1 ? 's' : '') + ' attention'));
      var bits = [];
      if (counts.degraded)      bits.push(counts.degraded + ' degraded');
      if (counts.offline)       bits.push(counts.offline + ' offline');
      if (counts.retrying)      bits.push(counts.retrying + ' retrying');
      if (counts.invalid_token) bits.push(counts.invalid_token + ' invalid token');
      banner.appendChild(el('span', { class: 'banner-detail' }, ' · ' + bits.join(' · ')));
    }
  }

  // ── Health badge element (mibusy FacadeConfig.tsx mode-badge pattern) ────
  function buildHealthBadge(state) {
    var label = HEALTH_LABEL[state] || state;
    var pill = el('span', { class: 'conn-health-badge conn-health-' + state });
    pill.appendChild(el('span', { class: 'conn-health-dot' }));
    pill.appendChild(el('span', { class: 'conn-health-label' }, label));
    return pill;
  }

  // ── Build a connection row ───────────────────────────────────────────────
  function buildConnectionRow(c) {
    var row = el('div', { class: 'conn-row conn-state-' + c.health_state, 'data-conn-id': c.id });

    // Avatar (first letter of display name)
    var avatar = el('div', { class: 'conn-avatar' }, (c.display_name || '?').charAt(0).toUpperCase());
    row.appendChild(avatar);

    var col = el('div', { class: 'conn-row-col' });

    var topLine = el('div', { class: 'conn-row-top' });
    var nameEl = el('div', { class: 'conn-name' }, c.display_name || '(unnamed)');
    if (c.health_state === 'revoked') nameEl.classList.add('is-revoked');
    topLine.appendChild(nameEl);
    topLine.appendChild(buildHealthBadge(c.health_state));
    col.appendChild(topLine);

    // Subline: remote person ID + capabilities
    var subLine = el('div', { class: 'conn-subline' });
    var personFrag = c.remote_person_id ? c.remote_person_id.slice(0, 26) + '…' : 'no remote person id';
    subLine.appendChild(el('span', null, personFrag));
    if ((c.remote_desk_capabilities || []).length) {
      subLine.appendChild(el('span', { class: 'conn-cap-pill' },
        (c.remote_desk_capabilities || []).slice(0, 3).join(' · ')));
    }
    col.appendChild(subLine);

    // Meta strip
    var meta = el('div', { class: 'conn-meta' });
    meta.appendChild(el('span', null, 'Last seen ' + relTime(c.last_successful_at)));
    meta.appendChild(el('span', { class: 'conn-meta-sep' }, '·'));
    var pend = pendingHandoffs(c);
    meta.appendChild(el('span', null, pend + ' pending handoff' + (pend === 1 ? '' : 's')));
    if (c.last_failure_reason && (c.health_state === 'degraded' || c.health_state === 'invalid_token' || c.health_state === 'offline')) {
      meta.appendChild(el('span', { class: 'conn-meta-sep' }, '·'));
      meta.appendChild(el('span', { class: 'conn-failure-hint' }, c.last_failure_reason));
    }
    col.appendChild(meta);

    // Quick actions
    var actions = el('div', { class: 'conn-actions' });
    var testBtn   = el('button', { type: 'button', class: 'conn-action' }, 'Test');
    var rotateBtn = el('button', { type: 'button', class: 'conn-action' }, 'Rotate');
    var revokeBtn = el('button', { type: 'button', class: 'conn-action conn-action-revoke' }, 'Revoke');

    if (c.health_state === 'revoked') {
      testBtn.disabled = true; rotateBtn.disabled = true; revokeBtn.disabled = true;
      revokeBtn.textContent = 'Revoked';
      revokeBtn.title = 'Already revoked';
    }

    testBtn.addEventListener('click',   function (ev) { ev.stopPropagation(); showToast('Wired in iter-002 BFF'); });
    rotateBtn.addEventListener('click', function (ev) { ev.stopPropagation(); showToast('Wired in iter-002 BFF'); });
    revokeBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (revokeBtn.disabled) return;
      // Two-step inline confirm
      if (revokeBtn.dataset.confirming === 'true') {
        showToast('Wired in iter-002 BFF');
        revokeBtn.dataset.confirming = 'false';
        revokeBtn.textContent = 'Revoke';
        revokeBtn.classList.remove('conn-action-revoke-confirm');
      } else {
        revokeBtn.dataset.confirming = 'true';
        revokeBtn.textContent = 'Confirm revoke?';
        revokeBtn.classList.add('conn-action-revoke-confirm');
        setTimeout(function () {
          if (revokeBtn.dataset.confirming === 'true') {
            revokeBtn.dataset.confirming = 'false';
            revokeBtn.textContent = 'Revoke';
            revokeBtn.classList.remove('conn-action-revoke-confirm');
          }
        }, 4000);
      }
    });

    actions.appendChild(testBtn);
    actions.appendChild(rotateBtn);
    actions.appendChild(revokeBtn);
    col.appendChild(actions);

    row.appendChild(col);

    // Click row body → open detail drawer (skip if clicked on a button)
    row.addEventListener('click', function (ev) {
      if (ev.target.closest('.conn-action')) return;
      if (window.HOLON_DRAWER && window.HOLON_DRAWER.openConnectionDrawer) {
        window.HOLON_DRAWER.openConnectionDrawer(c.id);
      }
    });

    return row;
  }

  // ── Render list ───────────────────────────────────────────────────────────
  function renderList() {
    var list = document.getElementById('connection-list');
    if (!list) return;
    list.innerHTML = '';
    var conns = (fx().connections || []).slice();

    if (conns.length === 0) {
      // iter-001c polish: empty-state code path
      var empty = el('div', { class: 'deliv-empty', style: 'background:#fff; border:1px solid var(--line); border-radius:14px; padding:40px 20px;' });
      empty.appendChild(el('div', { class: 'deliv-empty-icon' }, '∅'));
      empty.appendChild(el('div', { class: 'deliv-empty-text' }, 'No connections yet. Pair with a peer to start handing off work.'));
      var cta = el('button', { class: 'deliv-empty-cta', type: 'button', style: 'background:none; border:none; cursor:pointer;' }, 'Pair new connection →');
      cta.addEventListener('click', function () {
        if (window.HOLON_PAIR_SHEET) window.HOLON_PAIR_SHEET.open();
      });
      empty.appendChild(cta);
      list.appendChild(empty);
      return;
    }

    conns.sort(function (a, b) {
      var oa = HEALTH_ATTENTION_ORDER[a.health_state] || 99;
      var ob = HEALTH_ATTENTION_ORDER[b.health_state] || 99;
      if (oa !== ob) return oa - ob;
      return (a.display_name || '').localeCompare(b.display_name || '');
    });
    conns.forEach(function (c) { list.appendChild(buildConnectionRow(c)); });
  }

  // ── Wire pair-new button (sheet defined in pair-sheet.js, loaded later) ──
  function wirePairBtn() {
    var btn = document.getElementById('pair-new-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (window.HOLON_PAIR_SHEET && window.HOLON_PAIR_SHEET.open) {
        window.HOLON_PAIR_SHEET.open();
      } else {
        showToast('Pair-new sheet not loaded');
      }
    });
  }

  function boot() {
    if (!document.getElementById('connection-list')) return;
    renderBanner();
    renderList();
    wirePairBtn();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
