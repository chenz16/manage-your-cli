'use client';

import { useEffect, useRef, useState } from 'react';

interface PendingRequest {
  requestId: string;
  code: string;
  deviceName: string;
  createdAt: string;
  expires_at: string;
}

interface PendingResponse {
  pending: PendingRequest[];
}

const POLL_INTERVAL_MS = 2000;

export function ConnectPhoneSection() {
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [pollError, setPollError] = useState<string | null>(null);
  const [polling, setPolling] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    setPolling(false);
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  function startPolling() {
    setPollError(null);
    setPolling(true);
  }

  async function pollPending() {
    try {
      const res = await fetch('/api/v1/pair/pending', { cache: 'no-store' });
      if (!res.ok) {
        if (res.status === 403) {
          // Not on loopback — stop polling, show message.
          stopPolling();
          setPollError(
            'Phone pairing requires opening the desk at localhost (e.g. http://localhost:3000). ' +
            'Remote access to this page cannot display pairing codes.',
          );
          return;
        }
        setPollError(`Polling failed: HTTP ${res.status}`);
        return;
      }
      const data = await res.json() as PendingResponse;
      const list = Array.isArray(data.pending) ? data.pending : [];
      // Filter out expired on the client side (belt-and-suspenders)
      const now = Date.now();
      const live = list.filter((r) => new Date(r.expires_at).getTime() > now);
      setRequests(live);
      setPollError(null);
    } catch (err: unknown) {
      setPollError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    if (!polling) return;
    void pollPending();
    intervalRef.current = setInterval(() => { void pollPending(); }, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling]);

  function formatCode(code: string): string {
    // Display 4-digit code with spaces for readability: "1 2 3 4"
    return code.split('').join(' ');
  }

  return (
    <section className="card conn-card">
      <div className="conn-card-head">
        <p className="conn-eyebrow">Mobile</p>
        <h2 className="conn-card-title">Waiting for phone</h2>
        <p className="conn-card-hint">
          On your phone (微作), tap <strong>请求连接</strong>. A 4-digit code will appear here.
          Read it off the screen and type it into the phone to complete pairing.
          The code expires in 2 minutes.
        </p>
      </div>

      {pollError && !polling && (
        <div className="conn-note" style={{ borderColor: 'var(--red, #e0533a)' }}>
          <span className="conn-note-icon" aria-hidden>●</span>
          <span>{pollError}</span>
        </div>
      )}

      {pollError && polling && (
        <p className="conn-status" style={{ color: 'var(--ink-mute)' }}>
          Poll error: {pollError}
        </p>
      )}

      {!pollError && polling && requests.length === 0 && (
        <div className="conn-field">
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: 0 }}>
            Waiting for a phone to request pairing…
          </p>
        </div>
      )}

      {requests.map((req) => {
        const expiresMs = new Date(req.expires_at).getTime() - Date.now();
        const expiresSec = Math.max(0, Math.floor(expiresMs / 1000));
        return (
          <div
            key={req.requestId}
            className="conn-panel"
            style={{ marginBottom: 12, padding: '16px 20px' }}
          >
            <div className="conn-panel-row" style={{ marginBottom: 8 }}>
              <span className="conn-panel-name">
                Phone &ldquo;{req.deviceName}&rdquo; wants to connect
              </span>
              <span className="conn-panel-meta">expires in {expiresSec}s</span>
            </div>
            <div
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: 40,
                fontWeight: 700,
                letterSpacing: '0.2em',
                color: 'var(--ink)',
                textAlign: 'center',
                padding: '12px 0',
                background: 'var(--surface-raise, rgba(0,0,0,0.04))',
                borderRadius: 8,
                margin: '4px 0 8px',
              }}
              aria-label={`Pairing code: ${formatCode(req.code)}`}
            >
              {formatCode(req.code)}
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0, textAlign: 'center' }}>
              Enter this code on the phone to pair
            </p>
          </div>
        );
      })}

      <div className="conn-actions">
        {polling ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={stopPolling}
          >
            Stop watching
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={startPolling}
          >
            Start watching
          </button>
        )}
        <span className="conn-status" style={{ color: 'var(--ink-mute)' }}>
          {polling ? 'Polling every 2s…' : 'Paused'}
        </span>
      </div>
    </section>
  );
}
