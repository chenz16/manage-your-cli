'use client';

// M-L-005 — phone-shell status bar with Crown brand mark.
// Mirrors mibusy's AppShell header pattern but uses Holon's tokens
// (gold #C69A35 mark on paper #F8F6EF). Once /api/v1/me lands, the
// brand label flips to "${ceo_name} 的 Holon" — until then "我的 Holon".

import { Crown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { deskApi } from '../_lib/desk-api';

export function PhoneStatus() {
  const [ceoName, setCeoName] = useState<string>('我');

  useEffect(() => {
    let cancelled = false;
    fetch(deskApi('/api/v1/me'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        // /me payload shape varies; check the common fields without
        // hard-coupling to the desk's exact API surface.
        const name =
          d?.name ?? d?.display_name ?? d?.persona?.name ?? d?.owner?.name;
        if (typeof name === 'string' && name.trim()) setCeoName(name);
      })
      .catch(() => {
        // Silent: keep default "我"; this header is decorative.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const label = ceoName === '我' ? '我的 Holon' : `${ceoName} 的 Holon`;

  return (
    <header className="phone-status">
      <div className="phone-brand">
        <span className="brand-mark" aria-hidden="true">
          <Crown size={15} strokeWidth={2.1} />
        </span>
        <span>{label}</span>
      </div>
    </header>
  );
}
