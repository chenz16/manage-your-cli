'use client';

export default function GlobalError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui' }}>
      <h2 style={{ fontSize: 18, marginBottom: 12 }}>出错了</h2>
      <p style={{ fontSize: 14, color: '#666', marginBottom: 20 }}>
        页面加载失败。请重试。
      </p>
      <button
        onClick={reset}
        style={{
          padding: '8px 20px',
          fontSize: 14,
          borderRadius: 8,
          border: '1px solid #ccc',
          cursor: 'pointer',
          background: '#fff',
        }}
      >
        重试
      </button>
    </div>
  );
}
