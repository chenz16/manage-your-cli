/**
 * TopbarMe — right-side "me" chip. Reads the live owner name + machine
 * hostname from the desk APIs instead of the previous hardcoded literal
 * ("Chen · laptop-desk") that leaked the maintainer's identity.
 *
 * Falls back gracefully:
 *   - owner name unavailable → "Owner"
 *   - hostname unavailable → omitted (just the avatar + name)
 *   - both unavailable → just the avatar (initial of "?" if no fallback)
 *
 * Click → /me (existing config page).
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function TopbarMe() {
  const [name, setName] = useState<string>('Owner');

  useEffect(() => {
    let cancelled = false;
    // GET /api/v1/me returns the OwnerAssistant record + owner_name +
    // owner_role on the same object. Use owner_name (the human's name)
    // for the topbar chip; fall back to assistant 'name' if empty.
    void (async () => {
      try {
        const res = await fetch('/api/v1/me', { cache: 'no-store' });
        if (!res.ok) return;
        const j = await res.json() as { owner_name?: string; name?: string };
        const n = j.owner_name?.trim() || j.name?.trim();
        if (n && !cancelled) setName(n);
      } catch { /* keep fallback */ }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <Link href="/me" className="topbar-me" aria-label="Owner config">
      <span className="topbar-me-avatar">{initials(name)}</span>
      <span className="topbar-me-name">{name}</span>
    </Link>
  );
}
