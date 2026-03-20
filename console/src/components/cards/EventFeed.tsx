import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSSE } from '../../hooks/useSSE';
import { colors } from '../../theme/tokens';

interface FeedEvent {
  id: number;
  ts: number;
  topic: string;
  data: unknown;
}

let _idCounter = 0;

const TOPIC_COLORS: Record<string, string> = {
  'agent.lifecycle': colors.glow.info,
  'task': colors.glow.primary,
  'quality': colors.glow.warning,
  'field': colors.glow.secondary,
  'pheromone': colors.dimension.trust,
  'observe': colors.text.muted,
  'tool': colors.dimension.throughput,
};

function getTopicColor(topic: string): string {
  for (const [prefix, color] of Object.entries(TOPIC_COLORS)) {
    if (topic.startsWith(prefix)) return color;
  }
  return colors.text.secondary;
}

export function EventFeed({ maxItems = 30 }: { maxItems?: number }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);

  useSSE('*', (data, topic) => {
    setEvents((prev) => {
      const next = [{ id: ++_idCounter, ts: Date.now(), topic, data }, ...prev];
      return next.slice(0, maxItems);
    });
  });

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--bg-border)',
      borderRadius: 'var(--radius-md)',
      padding: '12px 0',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '0 16px 8px',
        fontSize: 12,
        color: 'var(--text-secondary)',
        fontWeight: 600,
        borderBottom: '1px solid var(--bg-border)',
      }}>
        Live Events
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        <AnimatePresence initial={false}>
          {events.map((e) => (
            <motion.div
              key={e.id}
              initial={{ opacity: 0, x: 20, height: 0 }}
              animate={{ opacity: 1, x: 0, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              style={{
                padding: '4px 16px',
                fontSize: 11,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                borderBottom: '1px solid rgba(42,42,90,0.3)',
              }}
            >
              <div style={{
                width: 4,
                height: 4,
                borderRadius: '50%',
                background: getTopicColor(e.topic),
                flexShrink: 0,
              }} />
              <span style={{ color: 'var(--text-muted)', minWidth: 60 }}>
                {new Date(e.ts).toLocaleTimeString()}
              </span>
              <span style={{ color: getTopicColor(e.topic), fontFamily: 'monospace' }}>
                {e.topic}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>

        {events.length === 0 && (
          <div style={{
            padding: 24,
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 12,
          }}>
            Waiting for events...
          </div>
        )}
      </div>
    </div>
  );
}
