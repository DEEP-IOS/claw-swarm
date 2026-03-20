import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSSE } from '../hooks/useSSE';
import { useRestApi } from '../hooks/useRestApi';
import { agentApi, socialApi } from '../api/client';
import { useAgentStore } from '../stores/agent-store';
import type { AgentInfo } from '../stores/agent-store';
import { useMetricsStore } from '../stores/metrics-store';
import { StatCard } from '../components/cards/StatCard';
import { GaugeRing } from '../components/charts/GaugeRing';
import { colors, spacing, radii, transitions } from '../theme/tokens';

// ── Types ────────────────────────────────────────────────────
interface EmotionalStates {
  [agentId: string]: Record<string, number>;
}

interface ReputationMap {
  [agentId: string]: number;
}

// ── Status helpers ───────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  active:    colors.glow.success,
  running:   colors.glow.primary,
  idle:      colors.glow.info,
  paused:    colors.glow.warning,
  failed:    colors.glow.danger,
  completed: colors.text.muted,
  spawning:  colors.glow.secondary,
};

function statusColor(status: string): string {
  return STATUS_COLORS[status?.toLowerCase()] || colors.text.secondary;
}

function dominantEmotion(emo: Record<string, number> | undefined): { name: string; value: number } {
  if (!emo || Object.keys(emo).length === 0) return { name: 'neutral', value: 0.5 };
  let best = { name: 'neutral', value: 0 };
  for (const [k, v] of Object.entries(emo)) {
    if (v > best.value) best = { name: k, value: v };
  }
  return best;
}

function emotionColor(name: string): string {
  const map: Record<string, string> = {
    joy:        colors.glow.success,
    trust:      colors.glow.primary,
    curiosity:  colors.glow.info,
    anger:      colors.glow.danger,
    fear:       colors.glow.warning,
    sadness:    colors.glow.secondary,
    surprise:   '#FFD93D',
    disgust:    '#FF61A6',
    neutral:    colors.text.muted,
  };
  return map[name?.toLowerCase()] || colors.glow.info;
}

// ── Styles ───────────────────────────────────────────────────
const styles = {
  container: {
    height: '100%',
    padding: spacing.lg,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: spacing.lg,
    overflow: 'auto',
    background: colors.bg.deep,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: colors.glow.secondary,
    letterSpacing: '-0.02em',
  },
  titleIcon: {
    fontSize: 28,
    filter: `drop-shadow(0 0 8px ${colors.glow.secondary}44)`,
  },
  statRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: spacing.md,
  },
  cardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: spacing.md,
  },
  agentCard: {
    background: colors.bg.card,
    border: `1px solid ${colors.bg.border}`,
    borderRadius: radii.lg,
    padding: spacing.md,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: spacing.sm,
    cursor: 'default',
    position: 'relative' as const,
    overflow: 'hidden' as const,
  },
  cardTopRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  agentId: {
    fontSize: 13,
    fontWeight: 600,
    color: colors.text.primary,
    fontFamily: 'JetBrains Mono, monospace',
    letterSpacing: '-0.02em',
    wordBreak: 'break-all' as const,
    maxWidth: 160,
  },
  statusBadge: (status: string) => ({
    fontSize: 10,
    fontWeight: 600,
    color: statusColor(status),
    background: `${statusColor(status)}18`,
    border: `1px solid ${statusColor(status)}33`,
    borderRadius: 20,
    padding: '2px 8px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap' as const,
  }),
  roleLabel: {
    fontSize: 12,
    color: colors.text.secondary,
  },
  cardEmoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  emotionLabel: {
    fontSize: 11,
    color: colors.text.muted,
    flex: 1,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: colors.text.secondary,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    marginBottom: spacing.sm,
  },
  reputationPanel: {
    background: colors.bg.card,
    border: `1px solid ${colors.bg.border}`,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  repRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: `${spacing.xs}px 0`,
    borderBottom: `1px solid ${colors.bg.border}44`,
  },
  repRank: {
    fontSize: 12,
    fontWeight: 700,
    color: colors.text.muted,
    minWidth: 28,
    textAlign: 'center' as const,
    fontFamily: 'JetBrains Mono, monospace',
  },
  repId: {
    fontSize: 12,
    fontWeight: 500,
    color: colors.text.primary,
    fontFamily: 'JetBrains Mono, monospace',
    flex: 1,
  },
  repBarBg: {
    width: 120,
    height: 10,
    background: colors.bg.hover,
    borderRadius: radii.sm,
    overflow: 'hidden' as const,
  },
  repScore: {
    fontSize: 12,
    fontWeight: 600,
    color: colors.glow.primary,
    minWidth: 40,
    textAlign: 'right' as const,
    fontFamily: 'JetBrains Mono, monospace',
  },
  loadingOverlay: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column' as const,
    gap: spacing.md,
    color: colors.text.muted,
    fontSize: 14,
  },
  errorBanner: {
    background: `${colors.glow.danger}11`,
    border: `1px solid ${colors.glow.danger}44`,
    borderRadius: radii.sm,
    padding: `${spacing.sm}px ${spacing.md}px`,
    color: colors.glow.danger,
    fontSize: 12,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xxl,
    color: colors.text.muted,
    fontSize: 14,
  },
} as const;

// ── Component ────────────────────────────────────────────────
export function AgentsView() {
  // ---- zustand stores ----
  const agents = useAgentStore(s => s.agents);
  const storeEmotions = useAgentStore(s => s.emotions);
  const storeReputation = useAgentStore(s => s.reputation);
  const setAgents = useAgentStore(s => s.setAgents);
  const addAgent = useAgentStore(s => s.addAgent);
  const removeAgent = useAgentStore(s => s.removeAgent);
  const setEmotions = useAgentStore(s => s.setEmotions);
  const setReputation = useAgentStore(s => s.setReputation);
  const pushEvent = useAgentStore(s => s.pushEvent);
  const metrics = useMetricsStore(s => s.metrics);

  // ---- local state ----
  const [localEmotions, setLocalEmotions] = useState<EmotionalStates>({});
  const [localReputation, setLocalReputation] = useState<ReputationMap>({});

  // ---- REST fetches ----
  const { loading: agentsLoading, error: agentsErr } = useRestApi<AgentInfo[]>(
    async () => {
      const data = await agentApi.active() as AgentInfo[];
      const list = Array.isArray(data) ? data : [];
      setAgents(list);
      return list;
    },
    [],
    10_000,
  );

  // Also fetch states for enrichment
  useRestApi(
    async () => {
      const data = await agentApi.states();
      return data;
    },
    [],
    15_000,
  );

  useRestApi<EmotionalStates>(
    async () => {
      const data = await socialApi.emotionalStates() as EmotionalStates;
      if (data && typeof data === 'object') {
        setLocalEmotions(data);
        setEmotions(data);
      }
      return data;
    },
    [],
    12_000,
  );

  useRestApi<ReputationMap>(
    async () => {
      const data = await socialApi.reputation() as ReputationMap;
      if (data && typeof data === 'object') {
        setLocalReputation(data);
        setReputation(data);
      }
      return data;
    },
    [],
    20_000,
  );

  // ---- SSE real-time: agent lifecycle ----
  useSSE('agent.lifecycle.*', useCallback((data: unknown, topic: string) => {
    const d = data as { agentId?: string; id?: string; role?: string; status?: string; sessionId?: string };
    const agentId = d?.agentId || d?.id || '';

    if (topic.includes('spawned') || topic.includes('added') || topic.includes('started')) {
      addAgent({
        id: agentId,
        role: d?.role || 'unknown',
        status: d?.status || 'active',
        sessionId: d?.sessionId,
        spawnedAt: Date.now(),
      });
    } else if (topic.includes('removed') || topic.includes('stopped') || topic.includes('terminated')) {
      removeAgent(agentId);
    }

    if (agentId) {
      pushEvent(topic, agentId, data);
    }
  }, [addAgent, removeAgent, pushEvent]));

  // ---- computed stats ----
  const activeCount = agents.length;
  const totalSpawned = metrics?.agents?.spawned ?? activeCount;
  const failedCount = metrics?.agents?.failed ?? 0;

  // ---- merge emotions from store + local ----
  const mergedEmotions = useMemo(() => {
    return { ...localEmotions, ...storeEmotions };
  }, [localEmotions, storeEmotions]);

  const mergedReputation = useMemo(() => {
    return { ...localReputation, ...storeReputation };
  }, [localReputation, storeReputation]);

  // ---- reputation leaderboard ----
  const reputationBoard = useMemo(() => {
    const entries = Object.entries(mergedReputation);
    entries.sort(([, a], [, b]) => b - a);
    return entries.slice(0, 20);
  }, [mergedReputation]);

  const maxRep = useMemo(() => {
    return Math.max(1, ...reputationBoard.map(([, v]) => v));
  }, [reputationBoard]);

  // ---- loading ----
  if (agentsLoading && agents.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        style={styles.loadingOverlay}
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
          style={{ fontSize: 32 }}
        >
          ⬡
        </motion.div>
        Loading agent data...
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={styles.container}
    >
      {/* ── Header ─────────────────────────── */}
      <div style={styles.header}>
        <span style={styles.titleIcon}>⬡</span>
        <span style={styles.title}>Agents</span>
      </div>

      {/* ── Error banner ───────────────────── */}
      <AnimatePresence>
        {agentsErr && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={styles.errorBanner}
          >
            {agentsErr}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Stat cards row ─────────────────── */}
      <div style={styles.statRow}>
        <StatCard
          label="Active Agents"
          value={activeCount}
          color={colors.glow.primary}
          icon="⬡"
          subtext="Currently running"
        />
        <StatCard
          label="Total Spawned"
          value={totalSpawned}
          color={colors.glow.info}
          icon="↗"
          subtext="Lifetime spawns"
        />
        <StatCard
          label="Failed"
          value={failedCount}
          color={colors.glow.danger}
          icon="✕"
          subtext="Spawn or runtime failures"
        />
      </div>

      {/* ── Agent card grid ────────────────── */}
      <div>
        <div style={styles.sectionTitle}>Agent Fleet</div>
        {agents.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={styles.emptyState}
          >
            <div style={{ fontSize: 36, opacity: 0.4 }}>⬡</div>
            <div>No active agents</div>
          </motion.div>
        ) : (
          <div style={styles.cardGrid}>
            <AnimatePresence>
              {agents.map((agent, idx) => {
                const emo = mergedEmotions[agent.id];
                const dominant = dominantEmotion(emo);
                const emoColor = emotionColor(dominant.name);
                const rep = mergedReputation[agent.id];

                return (
                  <motion.div
                    key={agent.id}
                    layout
                    initial={{ opacity: 0, scale: 0.92, y: 16 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: -8 }}
                    transition={{ delay: idx * 0.03, ...transitions.spring }}
                    whileHover={{
                      boxShadow: `0 0 20px ${statusColor(agent.status)}18`,
                      borderColor: `${statusColor(agent.status)}44`,
                    }}
                    style={styles.agentCard}
                  >
                    {/* Glow accent line at top */}
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 2,
                      background: `linear-gradient(90deg, transparent, ${statusColor(agent.status)}, transparent)`,
                      opacity: 0.6,
                    }} />

                    {/* Top row: ID + status */}
                    <div style={styles.cardTopRow}>
                      <div>
                        <div style={styles.agentId}>
                          {agent.id.length > 20 ? `...${agent.id.slice(-16)}` : agent.id}
                        </div>
                        <div style={styles.roleLabel}>{agent.role}</div>
                      </div>
                      <span style={styles.statusBadge(agent.status)}>{agent.status}</span>
                    </div>

                    {/* Emotion gauge */}
                    <div style={styles.cardEmoRow}>
                      <div style={{ flexShrink: 0 }}>
                        <GaugeRing
                          value={dominant.value}
                          label={dominant.name}
                          width={64}
                          height={64}
                          color={emoColor}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: colors.text.muted, marginBottom: 2 }}>Emotional State</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: emoColor, textTransform: 'capitalize' }}>
                          {dominant.name}
                        </div>
                        {rep !== undefined && (
                          <div style={{ fontSize: 11, color: colors.text.muted, marginTop: 4 }}>
                            Rep: <span style={{ color: colors.glow.primary, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>
                              {typeof rep === 'number' ? rep.toFixed(2) : rep}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Spawned time */}
                    {agent.spawnedAt && (
                      <div style={{ fontSize: 10, color: colors.text.muted }}>
                        Spawned: {new Date(agent.spawnedAt).toLocaleTimeString()}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ── Reputation leaderboard ─────────── */}
      {reputationBoard.length > 0 && (
        <motion.div
          style={styles.reputationPanel}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
        >
          <div style={styles.sectionTitle}>Reputation Leaderboard</div>
          {reputationBoard.map(([agentId, score], idx) => {
            const pct = (score / maxRep) * 100;
            const rankColor = idx === 0
              ? '#FFD93D'
              : idx === 1
                ? '#C0C0C0'
                : idx === 2
                  ? '#CD7F32'
                  : colors.text.muted;

            return (
              <motion.div
                key={agentId}
                style={styles.repRow}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 + idx * 0.03, duration: 0.3 }}
              >
                <span style={{ ...styles.repRank, color: rankColor }}>
                  {idx + 1}
                </span>
                <span style={styles.repId}>
                  {agentId.length > 24 ? `...${agentId.slice(-18)}` : agentId}
                </span>
                <div style={styles.repBarBg}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ delay: 0.35 + idx * 0.04, duration: 0.5, ease: 'easeOut' }}
                    style={{
                      height: '100%',
                      background: `linear-gradient(90deg, ${colors.glow.primary}88, ${colors.glow.primary})`,
                      borderRadius: radii.sm,
                      boxShadow: `0 0 6px ${colors.glow.primary}33`,
                    }}
                  />
                </div>
                <span style={styles.repScore}>{score.toFixed(2)}</span>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </motion.div>
  );
}
