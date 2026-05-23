/* members.js — populates the Members screen from window.HOLON_FIXTURES.
 *
 * Renamed from staff.js per ADR-003 (collective term 'staff'→'member';
 * substrate 'proxy'→'peer'). Autonomy slider reduced from 6 stops to 3
 * per ADR-004 (Supervised | Bounded | Autonomous).
 *
 * Per ADR-012: 3-stop segmented control replaced by a single autonomy badge
 * per card. Clicking a non-locked badge opens a radio popover (below/above
 * based on space). Clicking an option updates the badge immediately (mock;
 * no persistence). Click-outside / Esc dismisses.
 *
 * Per iter-001a/plan.md Step 5 + ui-architecture.md § 5.3 +
 * local-agent-management.md §§ 4, 5, 8.
 *
 * Renders into containers that members.html declares:
 *   #roster-overview   — "X of N members active" banner
 *   #substrate-filter  — All / Local AI / CLI / Peer chips (Myself removed per ADR-015)
 *   #staff-grid        — card grid
 *
 * Each card shows: avatar (1st letter), name, role · substrate badge ·
 * autonomy badge (click-to-edit popover for non-locked; lock emoji for
 * always_supervised), status with current load, cultivation 5-pip indicator.
 *
 * Peer substrate shows autonomy badge as N/A (autonomy not applicable).
 * Per ADR-015: "myself" substrate removed from Members entirely — owner's
 * personal work now lives in Today's personal queue.
 *
 * No frameworks. No build step. Vanilla DOM.
 */

(function () {
  'use strict';

  // Per ADR-004: 6 autonomy levels → 3.
  // L0 removed (use status:paused); L1+L2→Supervised; L3→Bounded; L4+L5→Autonomous.
  // Per ADR-012: each stop has a `sub` subtitle shown in the popover radio option.
  const AUTONOMY_STOPS = [
    { level: 'Supervised', tip: 'Supervised — every output requires owner approval before it leaves',         sub: 'Every output requires owner approval' },
    { level: 'Bounded',    tip: 'Bounded — acts autonomously within declared limits; pauses if limit exceeded', sub: 'Acts within budget; pauses if exceeded' },
    { level: 'Autonomous', tip: 'Autonomous — acts without per-assignment approval; owner reviews audit trail', sub: 'Acts freely; owner reviews via audit' },
  ];

  // Per ADR-003: substrate "proxy" renamed to "peer" (local mirror of a paired peer desk).
  // Per ADR-015: "myself" substrate removed — owner's work lives in Today personal queue.
  const SUBSTRATE_LABELS = {
    local_ai: 'Local AI',
    cli:      'CLI executor',
    peer:     'Peer',
  };

  // Substrate icons — inline SVG (matches marketing page approach)
  // Per ADR-015: "myself" icon removed; substrate union is now local_ai | cli | peer.
  const SUBSTRATE_ICONS = {
    local_ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></svg>',
    cli:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
    peer:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07L11.34 5.6"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l2.12-2.12"/></svg>',
  };

  const LOCK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function $ (sel) { return document.querySelector(sel); }

  function el (tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else node.setAttribute(k, attrs[k]);
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

  function avatarLetter (name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return '?';
    return trimmed.charAt(0).toUpperCase();
  }

  function statusLabel (s) {
    if (s.status === 'paused')   return 'Paused';
    if (s.status === 'archived') return 'Archived';
    if (s.current_jobs > 0)      return 'Running ' + s.current_jobs + ' job' + (s.current_jobs === 1 ? '' : 's');
    return 'Idle';
  }

  // ─── Roster overview ───────────────────────────────────────────────────────

  function renderRoster (fx, host) {
    const cap = (fx.desks.find(function (d) { return d.id === fx.primary_desk_id; }) || {}).span_of_control_cap || 7;
    const active = fx.staff.filter(function (s) { return s.status === 'active'; }).length;
    const total = fx.staff.length;
    const overCap = total > cap;
    host.innerHTML = '';
    host.appendChild(el('div', { html:
      '<strong>' + active + '</strong> of <strong>' + total + '</strong> members active' +
      ' &middot; soft cap <strong>' + cap + '</strong>' +
      (overCap ? ' <span style="color:#7A1F0F;">(over cap — consider archiving or handing off)</span>' : '')
    }));
  }

  // ─── Substrate filter chips ────────────────────────────────────────────────

  function renderFilter (fx, host) {
    host.innerHTML = '';
    const counts = fx.staff.reduce(function (acc, s) {
      acc[s.substrate.kind] = (acc[s.substrate.kind] || 0) + 1;
      return acc;
    }, {});
    counts['__all'] = fx.staff.length;

    // Per ADR-003: 'proxy' chip renamed to 'peer'.
    // Per ADR-015: 'Myself' chip removed — owner no longer a member.
    const chips = [
      { key: '__all',    label: 'All' },
      { key: 'local_ai', label: SUBSTRATE_LABELS.local_ai },
      { key: 'cli',      label: SUBSTRATE_LABELS.cli },
      { key: 'peer',     label: SUBSTRATE_LABELS.peer },
    ];

    chips.forEach(function (c, i) {
      const btn = el('button', {
        class: 'substrate-chip',
        type: 'button',
        'data-filter': c.key,
        'aria-pressed': i === 0 ? 'true' : 'false',
        role: 'tab',
      }, [
        c.label,
        el('span', { class: 'substrate-chip-count' }, '(' + (counts[c.key] || 0) + ')'),
      ]);
      btn.addEventListener('click', function () {
        host.querySelectorAll('.substrate-chip').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
        btn.setAttribute('aria-pressed', 'true');
        applyFilter(c.key);
      });
      host.appendChild(btn);
    });
  }

  function applyFilter (key) {
    const cards = document.querySelectorAll('.staff-card[data-substrate]');
    cards.forEach(function (card) {
      const kind = card.dataset.substrate;
      const show = key === '__all' || kind === key;
      card.style.display = show ? '' : 'none';
    });
  }

  // ─── Autonomy badge + popover (ADR-012) ──────────────────────────────────
  // Per ADR-012: replace 3-stop segmented control with a single badge per card.
  // - Peer substrate: N/A badge (autonomy not applicable for remote peer members).
  // - always_supervised: locked badge with 🔒 prefix, no popover.
  // - Other (graduated): clickable badge → popover with 3 radio options.
  // Per ADR-015: "myself" substrate removed; N/A check for myself dropped.

  // Map level → CSS modifier class
  var LEVEL_CLASS = {
    'Supervised': 'autonomy-supervised',
    'Bounded':    'autonomy-bounded',
    'Autonomous': 'autonomy-autonomous',
  };

  // Track the single open popover so we can close it on click-outside / Esc.
  var _activePopover = null;

  function closeActivePopover () {
    if (_activePopover) {
      if (_activePopover._keyHandler) {
        document.removeEventListener('keydown', _activePopover._keyHandler);
      }
      _activePopover.remove();
      _activePopover = null;
    }
  }

  // Build and return the autonomy badge element.
  function buildBadge (s) {
    const kind = s.substrate.kind;

    // Peer — N/A badge (autonomy not applicable for remote peer members)
    if (kind === 'peer') {
      return el('span', {
        class: 'autonomy-badge autonomy-na',
        'aria-label': 'Autonomy: N/A (not applicable for peer substrate)',
      }, 'N/A');
    }

    const locked = s.governance_mode === 'always_supervised';
    const level  = s.autonomy_level || 'Supervised';
    const levelCls = LEVEL_CLASS[level] || '';

    var badgeText = locked ? '🔒 ' + level : level;
    var badgeCls = 'autonomy-badge ' + levelCls + (locked ? ' autonomy-locked' : '');

    const badge = el('button', {
      type: 'button',
      class: badgeCls,
      'data-staff-id': s.id,
    }, badgeText);

    if (locked) {
      badge.setAttribute('aria-disabled', 'true');
      badge.setAttribute('title', 'Locked by governance_mode (always_supervised). Click owner settings to change.');
      badge.setAttribute('aria-label', 'Autonomy locked at ' + level + ' by governance_mode=always_supervised');
      badge.addEventListener('click', function (ev) {
        ev.stopPropagation();
        // eslint-disable-next-line no-console
        console.info('[mock] "' + s.name + '" is locked at ' + level + ' (governance_mode=always_supervised). Cannot change.');
      });
    } else {
      badge.setAttribute('aria-label', 'Autonomy: ' + level + '. Click to change.');
      badge.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openPopover(badge, s);
      });
    }

    return badge;
  }

  // Open the autonomy popover anchored below (or above) the badge button.
  function openPopover (badgeEl, s) {
    // Close any existing popover first.
    closeActivePopover();

    const popover = el('div', {
      class: 'autonomy-popover',
      role: 'dialog',
      'aria-label': 'Set autonomy level for ' + s.name,
      'aria-modal': 'true',
    });

    // Build 3 radio options
    AUTONOMY_STOPS.forEach(function (st) {
      const isCurrent = st.level === (s.autonomy_level || 'Supervised');
      const optBtn = el('button', {
        type: 'button',
        class: 'autonomy-popover-option',
        role: 'radio',
        'aria-checked': isCurrent ? 'true' : 'false',
        'data-level': st.level,
      });
      optBtn.appendChild(el('span', { class: 'autonomy-popover-label' }, st.level));
      optBtn.appendChild(el('span', { class: 'autonomy-popover-sub' }, st.sub));
      optBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        applyBadgeUpdate(s.id, st.level);
        closeActivePopover();
      });
      popover.appendChild(optBtn);
    });

    // Position: place in <body> with absolute coords derived from badge rect.
    document.body.appendChild(popover);
    _activePopover = popover;

    const rect   = badgeEl.getBoundingClientRect();
    const pop_h  = popover.offsetHeight || 140;   // estimate before layout
    const spaceBelow = window.innerHeight - rect.bottom;
    const above  = spaceBelow < pop_h + 8 && rect.top > pop_h + 8;

    popover.style.position = 'fixed';
    popover.style.left = Math.max(8, rect.left) + 'px';
    if (above) {
      popover.style.top = (rect.top - popover.offsetHeight - 4) + 'px';
    } else {
      popover.style.top = (rect.bottom + 4) + 'px';
    }

    // Focus first option
    var first = popover.querySelector('.autonomy-popover-option');
    if (first) first.focus();

    // Esc dismisses
    popover._keyHandler = function (ev) {
      if (ev.key === 'Escape') { closeActivePopover(); badgeEl.focus(); }
    };
    document.addEventListener('keydown', popover._keyHandler);
  }

  // Apply the chosen level to the badge in the card (mock — no persistence).
  function applyBadgeUpdate (staffId, newLevel) {
    const card = document.querySelector('.staff-card[data-staff-id="' + staffId + '"]');
    if (!card) return;

    const badge = card.querySelector('.autonomy-badge');
    if (!badge) return;

    // Update text
    badge.textContent = newLevel;

    // Swap color class
    badge.classList.remove('autonomy-supervised', 'autonomy-bounded', 'autonomy-autonomous');
    var newCls = LEVEL_CLASS[newLevel];
    if (newCls) badge.classList.add(newCls);

    // Update aria-label
    badge.setAttribute('aria-label', 'Autonomy: ' + newLevel + '. Click to change.');

    // Mirror change to fixture so popover re-opens with correct selection
    var fx = window.HOLON_FIXTURES;
    if (fx) {
      var member = (fx.staff || []).find(function (m) { return m.id === staffId; });
      if (member) member.autonomy_level = newLevel;
    }

    // eslint-disable-next-line no-console
    console.info('[mock] autonomy for staff ' + staffId + ' set to ' + newLevel + ' (not persisted).');
  }

  // ─── Cultivation indicator ────────────────────────────────────────────────

  function buildCultivation (level) {
    const wrap = el('div', { class: 'cultivation', 'aria-label': 'Cultivation maturity ' + level + ' of 5' });
    for (let i = 0; i < 5; i++) {
      wrap.appendChild(el('span', { class: 'cultivation-pip' + (i < level ? ' filled' : '') }));
    }
    wrap.appendChild(el('span', { class: 'cultivation-label' }, level + ' / 5'));
    return wrap;
  }

  // ─── Card ─────────────────────────────────────────────────────────────────

  function buildCard (s) {
    const kind = s.substrate.kind;
    // Per ADR-003: 'proxy'→'peer'; CSS class is-proxy→is-peer.
    const isPeer = kind === 'peer';

    const card = el('div', {
      class: 'card card-hover staff-card' + (isPeer ? ' is-peer' : ''),
      'data-staff-id': s.id,
      'data-substrate': kind,
    });

    // Header: avatar + name/role
    const header = el('div', { class: 'staff-card-header' });
    header.appendChild(el('div', { class: 'staff-avatar' }, avatarLetter(s.name)));

    const headerRight = el('div', { style: 'flex:1; min-width:0;' });
    headerRight.appendChild(el('h3', { class: 'staff-name' }, s.name));

    const meta = el('div', { class: 'staff-meta' });
    meta.appendChild(el('span', null, s.role_label));
    meta.appendChild(el('span', null, '·'));
    const subBadge = el('span', { class: 'badge badge-substrate substrate-' + kind, html:
      '<span class="substrate-icon">' + (SUBSTRATE_ICONS[kind] || '') + '</span> ' + SUBSTRATE_LABELS[kind]
    });
    meta.appendChild(subBadge);
    // Per ADR-012: autonomy badge inline with substrate badge; replaces 3-stop slider.
    meta.appendChild(buildBadge(s));
    headerRight.appendChild(meta);

    header.appendChild(headerRight);
    card.appendChild(header);

    // Bottom row: status + cultivation
    const bottom = el('div', { class: 'staff-status-line' });
    const statusBadgeClass = 'badge badge-status status-' + (s.status === 'paused' ? 'paused' : s.status === 'archived' ? 'archived' : 'active');
    bottom.appendChild(el('span', { class: statusBadgeClass }, statusLabel(s)));
    bottom.appendChild(buildCultivation(s.cultivation_maturity || 0));
    card.appendChild(bottom);

    return card;
  }

  function renderGrid (fx, host) {
    host.innerHTML = '';
    if (!fx.staff || fx.staff.length === 0) {
      // iter-001c polish: empty-state code path
      const empty = el('div', { class: 'deliv-empty', style: 'grid-column: 1 / -1; background:#fff; border:1px solid var(--line); border-radius:14px; padding:40px 20px;' });
      empty.appendChild(el('div', { class: 'deliv-empty-icon' }, '∅'));
      empty.appendChild(el('div', { class: 'deliv-empty-text' }, 'No members yet. Add a local AI, CLI executor, or peer to start delegating.'));
      const cta = el('a', { class: 'deliv-empty-cta', href: '#', id: 'empty-add-member' }, 'Add your first member →');
      empty.appendChild(cta);
      host.appendChild(empty);
      cta.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (window.HOLON_QUICKCREATE) window.HOLON_QUICKCREATE.open('member');
      });
      return;
    }
    fx.staff.forEach(function (s) {
      host.appendChild(buildCard(s));
    });
  }

  // ─── Add-member button ────────────────────────────────────────────────────

  function wireAddMember () {
    const btn = document.getElementById('add-staff-btn');
    if (!btn) return;
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      // iter-001a-patch: open quick-create modal → "New Member" form.
      if (window.HOLON_QUICKCREATE && typeof window.HOLON_QUICKCREATE.open === 'function') {
        window.HOLON_QUICKCREATE.open('member');
      } else {
        // Quick-create not yet loaded — will be available after step-13 commit.
        // eslint-disable-next-line no-console
        console.info('[members.js] Add-member: HOLON_QUICKCREATE not yet loaded.');
      }
    });
  }

  // ─── Global click-outside handler for autonomy popover ────────────────────

  function wirePopoverDismiss () {
    document.addEventListener('click', function (ev) {
      if (!_activePopover) return;
      // Dismiss if click is outside the popover (badge click already calls
      // ev.stopPropagation so it won't bubble to this handler).
      if (!_activePopover.contains(ev.target)) {
        closeActivePopover();
      }
    });
  }

  // ─── Boot ──────────────────────────────────────────────────────────────────

  function boot () {
    const fx = window.HOLON_FIXTURES;
    if (!fx || fx.__placeholder) {
      // eslint-disable-next-line no-console
      console.error('[members.js] HOLON_FIXTURES missing or stub — fixtures.js not loaded?');
      return;
    }

    const rosterHost = $('#roster-overview');
    const filterHost = $('#substrate-filter');
    const gridHost   = $('#staff-grid');

    if (rosterHost) renderRoster(fx, rosterHost);
    if (filterHost) renderFilter(fx, filterHost);
    if (gridHost)   renderGrid(fx, gridHost);

    wireAddMember();
    wirePopoverDismiss();

    // ADR-013: after the grid is rendered, wire per-card chat icons via HOLON_CHAT.
    // chat.js also observes via MutationObserver, but calling explicitly here
    // avoids a race when chat.js boots after members.js.
    if (window.HOLON_CHAT && typeof window.HOLON_CHAT._wireMemberCards === 'function') {
      window.HOLON_CHAT._wireMemberCards();
    }

    // iter-001a-patch: wire member card body clicks → detail drawer via HOLON_DRAWER.
    // drawer.js also observes via MutationObserver, but explicit call here avoids
    // the boot-order race when drawer.js loads before members.js renders.
    if (window.HOLON_DRAWER && typeof window.HOLON_DRAWER._wireMemberCardClicks === 'function') {
      window.HOLON_DRAWER._wireMemberCardClicks();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
