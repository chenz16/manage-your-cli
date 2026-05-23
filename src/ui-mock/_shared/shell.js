/* shell.js — app shell behaviors for the Holon UI mock.
 *
 * Responsibilities (kept intentionally tiny — this is a mock):
 *  - Mark the current page in the left nav as .active, derived from the
 *    page's body[data-page] attribute (set per-page in HTML).
 *  - Provide a no-op handler for inert buttons so clicks don't 404 / no-op
 *    silently — they log a clear "[mock] not wired" message to console.
 *  - (ADR-013) Wire topbar chat icon → global right-side panel via HOLON_CHAT.
 *    chat.js injects the button and owns the panel; shell.js just initialises it.
 *
 * No frameworks. No fetch. No build step.
 * Per iter-001a/plan.md + ADR-013.
 */

(function () {
  'use strict';

  function highlightActiveNav() {
    var page = document.body && document.body.dataset
      ? document.body.dataset.page
      : null;
    if (!page) { return; }
    var items = document.querySelectorAll('.nav-item[data-nav]');
    items.forEach(function (el) {
      if (el.dataset.nav === page) {
        el.classList.add('active');
        el.setAttribute('aria-current', 'page');
      }
    });
  }

  function wireInertButtons() {
    var buttons = document.querySelectorAll('[data-inert]');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        var label = btn.dataset.inert || btn.textContent.trim();
        // iter-001c: "new handoff" → form-aware composer (4-step, per-form consent).
        // Falls back to quick-create's "New Handoff" branch if composer not loaded.
        if (label === 'new handoff' || label === 'New handoff') {
          if (window.HOLON_COMPOSER) { window.HOLON_COMPOSER.open(); return; }
          if (window.HOLON_QUICKCREATE) { window.HOLON_QUICKCREATE.open(); return; }
        }
        // eslint-disable-next-line no-console
        console.info('[mock] "' + label + '" is not wired in iter-001a (see plan.md).');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      highlightActiveNav();
      wireInertButtons();
    });
  } else {
    highlightActiveNav();
    wireInertButtons();
  }
})();
