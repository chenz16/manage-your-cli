/* today.js — populates the Today screen from window.HOLON_FIXTURES.
 *
 * Per iter-001a/plan.md Step 4 + ui-architecture.md § 5.1.
 * Per ADR-015: added Personal Queue section above bucket cards.
 *
 * Renders into containers that index.html declares:
 *   #personal-queue  — owner's personal work-queue cards (ADR-015)
 *   #hero-summary    — one-line summary
 *   #bucket-grid     — 6 bucket cards
 *   #activity-feed   — recent activity (10 items)
 *
 * The "+ New handoff" button stays inert (handled by shell.js's
 * data-inert wiring) — the form composer ships in iter-001c.
 *
 * No frameworks. No build step. Vanilla DOM.
 */

(function () {
  'use strict';

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

  function pluralize (n, singular, plural) {
    return n === 1 ? singular : (plural || (singular + 's'));
  }

  function formatRelative (iso) {
    const then = new Date(iso).getTime();
    const now = new Date('2026-05-15T14:00:00.000Z').getTime(); // mock "now"
    const deltaMs = now - then;
    const min = Math.round(deltaMs / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + 'm ago';
    const hr = Math.round(min / 60);
    if (hr < 24) return hr + 'h ago';
    const day = Math.round(hr / 24);
    if (day < 7) return day + 'd ago';
    return new Date(iso).toISOString().slice(0, 10);
  }

  // ─── Bucket derivation from fixtures ───────────────────────────────────────

  function deriveBuckets (fx) {
    // 1. Local AI running — staff.current_jobs > 0 AND substrate.kind === 'local_ai'
    const aiRunning = fx.staff.filter(function (s) {
      return s.substrate.kind === 'local_ai' && s.current_jobs > 0;
    });
    const aiRunningCount = aiRunning.reduce(function (acc, s) { return acc + s.current_jobs; }, 0);

    // 2. Remote peer waiting — peer members with current_jobs > 0
    //    + missions in 'in_progress' assigned to peer connections (approximation
    //    in absence of an outbound-handoff fixture). Use peer connection ids.
    // Per ADR-003: substrate kind renamed from 'proxy' to 'peer'.
    const peerConnIds = new Set(fx.staff
      .filter(function (s) { return s.substrate.kind === 'peer'; })
      .map(function (s) { return s.substrate.connection_id; }));
    const peerWaitingMissions = fx.missions.filter(function (m) {
      return m.state === 'in_progress' && peerConnIds.has(m.sender_connection_id);
    });
    const peerWaitingNames = Array.from(new Set(fx.connections
      .filter(function (c) { return peerConnIds.has(c.id); })
      .map(function (c) { return c.display_name; })));

    // 3. Inbound mission pending — missions in queued state
    const pending = fx.missions.filter(function (m) { return m.state === 'queued'; });
    const pendingSenders = Array.from(new Set(pending.map(function (m) { return m.sender_display_name; })));

    // 4. Deliverable returned — origin_label === 'remote' (cap to recent set)
    const returned = fx.deliverables.filter(function (d) { return d.origin_label === 'remote'; });
    const mostRecentReturn = returned.slice().sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); })[0];

    // 5. Blocked — missions in 'blocked' state
    const blocked = fx.missions.filter(function (m) { return m.state === 'blocked'; });

    // 6. Retrying — connections in 'retrying' state (mock approximation for retry count)
    const retrying = fx.connections.filter(function (c) { return c.health_state === 'retrying'; });

    return {
      ai_running:      { count: aiRunningCount, names: aiRunning.map(function (s) { return s.name; }) },
      peer_waiting:    { count: peerWaitingMissions.length || peerConnIds.size, names: peerWaitingNames },
      pending:         { count: pending.length, senders: pendingSenders },
      returned:        { count: returned.length, recent: mostRecentReturn },
      blocked:         { count: blocked.length, items: blocked },
      retrying:        { count: retrying.length, items: retrying },
    };
  }

  // ─── Hero summary ──────────────────────────────────────────────────────────

  function renderHero (fx, host) {
    const pendingCount   = fx.missions.filter(function (m) { return m.state === 'queued'; }).length;
    const returnedCount  = fx.deliverables.filter(function (d) { return d.origin_label === 'remote'; }).length;
    const degradedCount  = fx.connections.filter(function (c) { return c.health_state === 'degraded'; }).length;
    const personalCount  = (fx.my_work_queue || []).length;

    host.innerHTML = '';
    host.appendChild(el('div', { class: 'hero-summary' }, [
      el('span', { html:
        'You have <strong>' + pendingCount + '</strong> ' + pluralize(pendingCount, 'mission') + ' waiting, ' +
        '<strong>' + returnedCount + '</strong> ' + pluralize(returnedCount, 'deliverable') + ' returned, ' +
        '<strong>' + degradedCount + '</strong> ' + pluralize(degradedCount, 'connection') + ' degraded' +
        (personalCount > 0
          ? ' + <strong>' + personalCount + '</strong> personal ' + pluralize(personalCount, 'item')
          : '') +
        '.'
      }),
    ]));
  }

  // ─── Personal queue (ADR-015) ─────────────────────────────────────────────
  // Owner's own work items — rendered above the 6 bucket cards.
  // Each card opens a detail drawer (no-dead-end-clicks rule).

  function priorityLabel (p) {
    if (p >= 80) return 'urgent';
    if (p >= 60) return 'high';
    if (p >= 40) return 'normal';
    return 'low';
  }

  function formatDeadline (iso) {
    if (!iso) return null;
    const d = new Date(iso);
    const now = new Date('2026-05-15T14:00:00.000Z'); // mock now
    const diffMs = d.getTime() - now.getTime();
    const diffHr = Math.round(diffMs / 3600000);
    if (diffHr < 0) return 'overdue';
    if (diffHr < 1) return 'due <1h';
    if (diffHr < 24) return 'due in ' + diffHr + 'h';
    const diffDays = Math.round(diffHr / 24);
    return 'due in ' + diffDays + 'd';
  }

  function renderPersonalQueue (fx, host) {
    // Sort by priority desc, then deadline asc (most urgent first; position emphasizes importance)
    const items = (fx.my_work_queue || []).slice().sort(function (a, b) {
      const pa = a.priority || 0, pb = b.priority || 0;
      if (pb !== pa) return pb - pa;
      const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      return da - db;
    });
    host.innerHTML = '';

    if (items.length === 0) {
      // iter-001c polish: empty-state code path (fixture never empties, but ship the branch).
      const empty = el('section', { class: 'personal-queue-section' });
      empty.appendChild(el('h2', { class: 'section-title' }, 'My queue'));
      const card = el('div', { class: 'deliv-empty', style: 'background:#fff; border:1px solid var(--line); border-radius:14px;' });
      card.appendChild(el('div', { class: 'deliv-empty-icon' }, '∅'));
      card.appendChild(el('div', { class: 'deliv-empty-text' }, 'Your queue is clear. Nothing on your desk right now.'));
      empty.appendChild(card);
      host.appendChild(empty);
      return;
    }

    const section = el('section', { class: 'personal-queue-section', 'aria-labelledby': 'pq-title' });
    section.appendChild(el('h2', { class: 'section-title', id: 'pq-title' }, 'My queue'));

    const grid = el('div', { class: 'personal-queue-grid' });

    items.forEach(function (item) {
      const priorityTag = priorityLabel(item.priority || 0);
      const deadlineStr = formatDeadline(item.deadline);

      const card = el('button', {
        class: 'card card-hover pq-card pq-priority-' + priorityTag,
        type: 'button',
        'data-pq-id': item.id,
        'aria-label': 'Open: ' + item.title,
      });

      const topRow = el('div', { class: 'pq-card-top' });
      topRow.appendChild(el('span', { class: 'pq-card-title' }, item.title));

      const tags = el('div', { class: 'pq-card-tags' });
      tags.appendChild(el('span', { class: 'badge pq-badge-source pq-source-' + item.source }, item.source === 'from_mission' ? 'from mission' : 'own'));
      tags.appendChild(el('span', { class: 'badge pq-badge-priority pq-priority-badge-' + priorityTag }, priorityTag));
      if (deadlineStr) {
        tags.appendChild(el('span', { class: 'badge pq-badge-deadline' + (priorityTag === 'urgent' ? ' pq-deadline-urgent' : '') }, deadlineStr));
      }
      topRow.appendChild(tags);

      card.appendChild(topRow);

      const excerpt = item.body ? item.body.slice(0, 90) + (item.body.length > 90 ? '…' : '') : '';
      if (excerpt) {
        card.appendChild(el('p', { class: 'pq-card-excerpt' }, excerpt));
      }

      card.addEventListener('click', function () {
        if (window.HOLON_DRAWER && typeof window.HOLON_DRAWER.openPersonalQueueDrawer === 'function') {
          window.HOLON_DRAWER.openPersonalQueueDrawer(item.id);
        }
      });

      grid.appendChild(card);
    });

    section.appendChild(grid);
    host.appendChild(section);
  }

  // ─── Bucket cards ──────────────────────────────────────────────────────────

  function bucketCard (variant, title, count, detail) {
    return el('div', { class: 'card bucket-card ' + variant }, [
      el('h3', { class: 'card-title' }, title),
      el('div', { class: 'card-count' }, String(count)),
      el('div', { class: 'card-detail' }, detail || '—'),
    ]);
  }

  function renderBuckets (buckets, host) {
    host.innerHTML = '';

    host.appendChild(bucketCard(
      'bucket-running',
      'Local AI running',
      buckets.ai_running.count,
      buckets.ai_running.names.length ? buckets.ai_running.names.join(', ') : 'No staff currently executing.'
    ));

    host.appendChild(bucketCard(
      'bucket-waiting',
      'Remote peer waiting', // ADR-003: renamed from 'Remote proxy waiting'
      buckets.peer_waiting.count,
      buckets.peer_waiting.names.length ? 'Awaiting: ' + buckets.peer_waiting.names.join(', ') : 'Nothing in flight.'
    ));

    host.appendChild(bucketCard(
      'bucket-pending',
      'Inbound mission pending',
      buckets.pending.count,
      buckets.pending.senders.length ? 'From: ' + buckets.pending.senders.join(', ') : 'Inbox empty.'
    ));

    host.appendChild(bucketCard(
      'bucket-returned',
      'Deliverable returned',
      buckets.returned.count,
      buckets.returned.recent ? 'Latest: ' + buckets.returned.recent.title : 'Nothing returned yet.'
    ));

    host.appendChild(bucketCard(
      'bucket-blocked',
      'Blocked',
      buckets.blocked.count,
      buckets.blocked.items.length
        ? buckets.blocked.items[0].title + ' — ' + (buckets.blocked.items[0].state_reason || 'awaiting unblock')
        : 'Nothing blocked.'
    ));

    host.appendChild(bucketCard(
      'bucket-retrying',
      'Retrying',
      buckets.retrying.count,
      buckets.retrying.items.length
        ? buckets.retrying.items.map(function (c) { return c.display_name; }).join(', ') + ' — backoff in progress'
        : 'No retries in flight.'
    ));
  }

  // ─── Recent activity ───────────────────────────────────────────────────────

  function renderActivity (fx, host) {
    host.innerHTML = '';
    const items = fx.recent_events
      .slice()
      .sort(function (a, b) { return new Date(b.at) - new Date(a.at); })
      .slice(0, 10);

    items.forEach(function (ev) {
      const row = el('div', { class: 'activity-item' }, [
        el('div', { class: 'activity-time' }, formatRelative(ev.at)),
        el('div', { class: 'activity-body' }, [
          el('span', { class: 'activity-kind' }, ev.kind),
          el('span', { html: ev.text }),
        ]),
      ]);
      host.appendChild(row);
    });

    if (!items.length) {
      host.appendChild(el('div', { class: 'activity-item' }, 'No recent activity.'));
    }
  }

  // ─── Quick-create wiring (visible but inert per plan.md) ──────────────────
  // The button is wired by shell.js (data-inert). We additionally surface a
  // brief alert so a clicking reviewer sees plain English about where the
  // composer lands. This stays in 001a per requirements.md acceptance #4.

  function wireQuickCreate () {
    const btn = document.querySelector('button[data-inert="new handoff"]');
    if (!btn) return;
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      // iter-001a-patch: open quick-create modal via HOLON_QUICKCREATE.
      if (window.HOLON_QUICKCREATE && typeof window.HOLON_QUICKCREATE.open === 'function') {
        window.HOLON_QUICKCREATE.open();
      }
      // If quick-create.js not yet loaded, the data-inert handler in shell.js
      // already console.info'd — no silent failure.
    });
  }

  // ─── Boot ──────────────────────────────────────────────────────────────────

  function boot () {
    const fx = window.HOLON_FIXTURES;
    if (!fx || fx.__placeholder) {
      // eslint-disable-next-line no-console
      console.error('[today.js] HOLON_FIXTURES missing or stub — fixtures.js not loaded?');
      return;
    }

    const pqHost       = $('#personal-queue');
    const heroHost     = $('#hero-summary');
    const bucketHost   = $('#bucket-grid');
    const activityHost = $('#activity-feed');

    if (pqHost)       renderPersonalQueue(fx, pqHost);
    if (heroHost)     renderHero(fx, heroHost);
    if (bucketHost)   renderBuckets(deriveBuckets(fx), bucketHost);
    if (activityHost) renderActivity(fx, activityHost);

    wireQuickCreate();

    // iter-001a-patch: wire bucket card clicks → bucket drawer via HOLON_DRAWER.
    // drawer.js also observes via MutationObserver, but explicit call avoids
    // the boot-order race when drawer.js boots before today.js renders.
    if (window.HOLON_DRAWER && typeof window.HOLON_DRAWER._wireBucketCards === 'function') {
      window.HOLON_DRAWER._wireBucketCards();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
