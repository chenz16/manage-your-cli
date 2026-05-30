/**
 * Topbar — brand on the left, icon buttons + user chip on the right.
 *
 * Ported visually from src/ui-mock/_shared/shell.css `.topbar*` rules
 * + the vanilla HTML topbar pattern reused across all pages.
 */

import { HealthDot } from './HealthDot';
import { SecretaryProjectSwitcher } from './SecretaryProjectSwitcher';

export function Topbar() {
  return (
    <header className="topbar">
      <a href="/" className="topbar-brand" aria-label="Holon — go to Today">
        <img src="/assets/holon-logo.svg" alt="" />
      </a>
      <SecretaryProjectSwitcher />
      <div className="topbar-actions">
        <HealthDot />
        <button className="topbar-icon-btn" data-inert="search" aria-label="Search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        <button className="topbar-icon-btn" data-inert="notifications" aria-label="Notifications">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>
        <div className="topbar-me" data-inert="user menu" tabIndex={0} role="button">
          <span className="topbar-me-avatar">CZ</span>
          <span className="topbar-me-name">Chen · laptop-desk</span>
        </div>
      </div>
    </header>
  );
}
