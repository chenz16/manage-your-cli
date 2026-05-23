export default function Loading() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      minHeight: 200,
      color: 'var(--ink-mute, #999)',
      fontSize: 14,
    }}>
      加载中…
    </div>
  );
}
