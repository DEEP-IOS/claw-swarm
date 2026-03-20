import { useSSEStore } from '../../stores/sse-store';
import { motion } from 'framer-motion';

export function StatusBar() {
  const { connected, eventCount, lastEventAt } = useSSEStore();

  const ago = lastEventAt ? `${Math.round((Date.now() - lastEventAt) / 1000)}s ago` : '—';

  return (
    <footer style={{
      height: 24,
      background: 'var(--bg-surface)',
      borderTop: '1px solid var(--bg-border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      fontSize: 11,
      color: 'var(--text-muted)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <motion.div
          animate={connected
            ? { opacity: [0.4, 1, 0.4], scale: [0.9, 1.1, 0.9] }
            : { opacity: 0.3 }
          }
          transition={connected
            ? { duration: 2, repeat: Infinity, ease: 'easeInOut' }
            : {}
          }
          style={{
            width: 6, height: 6, borderRadius: '50%',
            background: connected ? 'var(--glow-success)' : 'var(--glow-danger)',
            boxShadow: connected ? '0 0 6px var(--glow-success)' : 'none',
          }}
        />
        <span>{connected ? 'SSE Connected' : 'SSE Disconnected'}</span>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <span>Events: {eventCount.toLocaleString()}</span>
        <span>Last: {ago}</span>
      </div>
    </footer>
  );
}
