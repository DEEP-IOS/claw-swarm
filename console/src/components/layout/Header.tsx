import { useMetricsStore } from '../../stores/metrics-store';

export function Header() {
  const health = useMetricsStore((s) => s.health);
  const score = health?.score ?? 0;
  const status = health?.status ?? 'unknown';

  const statusColor = status === 'healthy' ? 'var(--glow-success)'
    : status === 'degraded' ? 'var(--glow-warning)'
    : 'var(--glow-danger)';

  return (
    <header style={{
      height: 48,
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--bg-border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 20px',
      fontSize: 13,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
          Claw-Swarm
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>V9.1</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: statusColor,
            boxShadow: `0 0 8px ${statusColor}`,
          }} />
          <span style={{ color: 'var(--text-secondary)' }}>
            {status} ({(score * 100).toFixed(0)}%)
          </span>
        </div>
      </div>
    </header>
  );
}
