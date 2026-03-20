import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { StatCard } from '../components/cards/StatCard';
import { useSSE } from '../hooks/useSSE';
import { communicationApi } from '../api/client';
import { colors } from '../theme/tokens';

interface Message { ts: number; from: string; topic: string }

const PHEROMONE_COLORS: Record<string, string> = {
  trail: colors.dimension.throughput, alarm: colors.glow.danger,
  recruit: colors.glow.info, queen: colors.glow.secondary,
  dance: colors.dimension.novelty, food: colors.glow.success,
};

export function CommunicationView() {
  const [pheromones, setPheromones] = useState<any>({});
  const [channelInfo, setChannelInfo] = useState<any>({});
  const [stigmergy, setStigmergy] = useState<any>({});
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    communicationApi.pheromones().then((p: any) => setPheromones(p || {})).catch(() => {});
    communicationApi.channels().then((c: any) => setChannelInfo(c || {})).catch(() => {});
    communicationApi.stigmergy().then((s: any) => setStigmergy(s || {})).catch(() => {});
  }, []);

  useSSE('pheromone.*', (data: any, topic) => {
    setPheromones((prev: any) => ({ ...prev, lastEvent: topic }));
    setMessages(prev => [{ ts: Date.now(), from: 'pheromone', topic }, ...prev].slice(0, 50));
  });

  useSSE('channel.*', (data: any, topic) => {
    setMessages(prev => [{ ts: Date.now(), from: 'channel', topic }, ...prev].slice(0, 50));
  });

  const trailCount = pheromones?.trails ?? 0;
  const typeCount = pheromones?.types ?? 0;
  const channelCount = channelInfo?.count ?? 0;
  const boardEntries = stigmergy?.entries ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 16 }}>
        <StatCard label="Pheromone Trails" value={trailCount} icon="🐜" color={colors.dimension.throughput} />
        <StatCard label="Pheromone Types" value={typeCount} icon="🧪" color={colors.glow.secondary} />
        <StatCard label="Active Channels" value={channelCount} icon="📡" color={colors.glow.info} />
        <StatCard label="Stigmergy Board" value={boardEntries} icon="📋" color={colors.dimension.novelty} subtext="entries" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, flex: 1, minHeight: 250 }}>
        {/* Pheromone types legend */}
        <div style={{ background: colors.bg.card, border: `1px solid ${colors.bg.border}`, borderRadius: 'var(--radius-md)', padding: 16 }}>
          <div style={{ fontSize: 12, color: colors.text.secondary, fontWeight: 600, marginBottom: 16 }}>Pheromone Types</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {Object.entries(PHEROMONE_COLORS).map(([type, color]) => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: colors.bg.hover, borderRadius: 'var(--radius-sm)' }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}44` }} />
                <div>
                  <div style={{ fontSize: 13, color: colors.text.primary, fontWeight: 500, textTransform: 'capitalize' }}>{type}</div>
                  <div style={{ fontSize: 10, color: colors.text.muted }}>
                    {type === 'trail' ? 'Path taken' : type === 'alarm' ? 'Danger area' : type === 'recruit' ? 'Need help' : type === 'queen' ? 'Strategy shift' : type === 'dance' ? 'High-value find' : 'Quality output'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Message feed */}
        <div style={{ background: colors.bg.card, border: `1px solid ${colors.bg.border}`, borderRadius: 'var(--radius-md)', padding: 16, overflow: 'auto' }}>
          <div style={{ fontSize: 12, color: colors.text.secondary, fontWeight: 600, marginBottom: 12 }}>Communication Feed</div>
          {messages.length === 0 ? (
            <div style={{ color: colors.text.muted, fontSize: 13, textAlign: 'center', padding: 40 }}>Waiting for pheromone & channel events...</div>
          ) : (
            <AnimatePresence initial={false}>
              {messages.map((m, i) => (
                <motion.div key={`${m.ts}-${i}`} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} style={{
                  padding: '6px 0', borderBottom: `1px solid ${colors.bg.border}33`, fontSize: 11, display: 'flex', gap: 8, alignItems: 'center',
                }}>
                  <span style={{ color: colors.text.muted, minWidth: 55 }}>{new Date(m.ts).toLocaleTimeString()}</span>
                  <span style={{ color: m.from === 'pheromone' ? colors.dimension.throughput : colors.glow.info, fontFamily: 'monospace' }}>{m.topic}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}
