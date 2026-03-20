import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { StatCard } from '../components/cards/StatCard';
import { GaugeRing } from '../components/charts/GaugeRing';
import { useSSE } from '../hooks/useSSE';
import { useRestApi } from '../hooks/useRestApi';
import { systemApi } from '../api/client';
import { colors, spacing, radii, transitions } from '../theme/tokens';

/* ── Type definitions ────────────────────────────────────────── */

interface HealthData {
  score: number;           // 0-1
  status: string;          // 'healthy' | 'degraded' | 'unhealthy'
  dimensions?: Record<string, DimensionHealth>;
  uptime?: number;
  timestamp?: string;
}

interface DimensionHealth {
  value: number;
  threshold?: number;
  status: string;          // 'ok' | 'warn' | 'critical'
  unit?: string;
}

interface MetricsData {
  cpu?: { usage: number; threshold?: number };
  memory?: { usage: number; total?: number; threshold?: number };
  eventLoop?: { delay: number; threshold?: number };
  signals?: { currentCount: number };
  agents?: { active: number; spawned?: number };
  errors?: { rate: number; threshold?: number; total?: number };
  [key: string]: unknown;
}

interface ModuleInfo {
  name: string;
  domain: string;
  status: string;
  version?: string;
  [key: string]: unknown;
}

interface ModulesData {
  modules?: ModuleInfo[];
  total?: number;
  active?: number;
  version?: string;
  port?: number;
  startTime?: string;
  [key: string]: unknown;
}

/* ── Health dimension card config ────────────────────────────── */

interface DimCardDef {
  key: string;
  label: string;
  icon: string;
  unit: string;
  extract: (m: MetricsData, h: HealthData) => { value: number | string; threshold?: number; status: string };
  color: string;
}

const DIM_CARDS: DimCardDef[] = [
  {
    key: 'cpu', label: 'CPU Usage', icon: '⚙', unit: '%', color: colors.dimension.task_load,
    extract: (m, h) => ({
      value: m.cpu?.usage != null ? `${(m.cpu.usage * 100).toFixed(1)}` : (h.dimensions?.cpu?.value ?? '—'),
      threshold: m.cpu?.threshold ?? h.dimensions?.cpu?.threshold,
      status: h.dimensions?.cpu?.status ?? 'ok',
    }),
  },
  {
    key: 'memory', label: 'Memory', icon: '◧', unit: '%', color: colors.dimension.resource_pressure,
    extract: (m, h) => ({
      value: m.memory?.usage != null ? `${(m.memory.usage * 100).toFixed(1)}` : (h.dimensions?.memory?.value ?? '—'),
      threshold: m.memory?.threshold ?? h.dimensions?.memory?.threshold,
      status: h.dimensions?.memory?.status ?? 'ok',
    }),
  },
  {
    key: 'eventLoop', label: 'Event Loop', icon: '↻', unit: 'ms', color: colors.dimension.latency,
    extract: (m, h) => ({
      value: m.eventLoop?.delay != null ? m.eventLoop.delay.toFixed(1) : (h.dimensions?.eventLoop?.value ?? '—'),
      threshold: m.eventLoop?.threshold ?? h.dimensions?.eventLoop?.threshold,
      status: h.dimensions?.eventLoop?.status ?? 'ok',
    }),
  },
  {
    key: 'signals', label: 'Signal Count', icon: '◈', unit: '', color: colors.glow.secondary,
    extract: (m, h) => ({
      value: m.signals?.currentCount ?? h.dimensions?.signals?.value ?? 0,
      threshold: h.dimensions?.signals?.threshold,
      status: h.dimensions?.signals?.status ?? 'ok',
    }),
  },
  {
    key: 'agents', label: 'Agent Count', icon: '⬡', unit: '', color: colors.glow.info,
    extract: (m, h) => ({
      value: m.agents?.active ?? h.dimensions?.agents?.value ?? 0,
      threshold: h.dimensions?.agents?.threshold,
      status: h.dimensions?.agents?.status ?? 'ok',
    }),
  },
  {
    key: 'errors', label: 'Error Rate', icon: '✕', unit: '/min', color: colors.glow.danger,
    extract: (m, h) => ({
      value: m.errors?.rate != null ? m.errors.rate.toFixed(2) : (h.dimensions?.errors?.value ?? 0),
      threshold: m.errors?.threshold ?? h.dimensions?.errors?.threshold,
      status: h.dimensions?.errors?.status ?? (m.errors?.rate != null && m.errors.rate > 5 ? 'critical' : 'ok'),
    }),
  },
];

/* ── Status helpers ──────────────────────────────────────────── */

const STATUS_COLORS: Record<string, string> = {
  ok: colors.glow.success,
  healthy: colors.glow.success,
  warn: colors.glow.warning,
  degraded: colors.glow.warning,
  critical: colors.glow.danger,
  unhealthy: colors.glow.danger,
};

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? colors.text.muted;
}

function healthScoreColor(score: number): string {
  if (score >= 0.8) return colors.glow.success;
  if (score >= 0.5) return colors.glow.warning;
  return colors.glow.danger;
}

function formatUptime(ms?: number): string {
  if (ms == null) return '—';
  const seconds = Math.floor(ms / 1000);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

/* ── Shared styles ───────────────────────────────────────────── */

const panelStyle: React.CSSProperties = {
  background: colors.bg.card,
  border: `1px solid ${colors.bg.border}`,
  borderRadius: radii.md,
  padding: spacing.lg,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing.md,
};

const panelTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: colors.text.secondary,
  letterSpacing: '0.04em',
  textTransform: 'uppercase' as const,
};

/* ── Main component ──────────────────────────────────────────── */

export function SystemView() {
  // ── REST data ──
  const { data: health, refresh: refreshHealth } = useRestApi<HealthData>(
    systemApi.health as () => Promise<HealthData>, [], 10000,
  );
  const { data: metrics, refresh: refreshMetrics } = useRestApi<MetricsData>(
    systemApi.metrics as () => Promise<MetricsData>, [], 10000,
  );
  const { data: modulesData } = useRestApi<ModulesData>(
    systemApi.modules as () => Promise<ModulesData>, [], 30000,
  );

  // ── SSE real-time updates ──
  const handleHealthSSE = useCallback((data: unknown) => {
    // On health snapshots, refresh both health and metrics
    if (data && typeof data === 'object') {
      refreshHealth();
      refreshMetrics();
    }
  }, [refreshHealth, refreshMetrics]);

  useSSE('observe.health.snapshot', handleHealthSSE);
  useSSE('observe.metrics.collected', useCallback(() => {
    refreshMetrics();
  }, [refreshMetrics]));

  // ── Gauge container sizing ──
  const gaugeRef = useRef<HTMLDivElement>(null);
  const [gaugeSize, setGaugeSize] = useState(200);

  useEffect(() => {
    const el = gaugeRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setGaugeSize(Math.min(width, height, 260));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── Derived values ──
  const score = health?.score ?? 0;
  const scoreColor = healthScoreColor(score);
  const safeHealth: HealthData = health ?? { score: 0, status: 'unknown' };
  const safeMetrics: MetricsData = metrics ?? {};

  // System info table
  const modulesList = modulesData?.modules ?? [];
  const sysInfo: Array<{ label: string; value: string }> = [
    { label: 'Status', value: health?.status ?? 'loading...' },
    { label: 'Version', value: modulesData?.version ?? '—' },
    { label: 'Port', value: modulesData?.port != null ? String(modulesData.port) : '19100' },
    { label: 'Uptime', value: formatUptime(health?.uptime) },
    { label: 'Modules', value: `${modulesData?.active ?? modulesList.length} / ${modulesData?.total ?? modulesList.length}` },
    { label: 'Start Time', value: modulesData?.startTime ? new Date(modulesData.startTime).toLocaleString() : (health?.timestamp ? new Date(health.timestamp).toLocaleString() : '—') },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg, height: '100%', overflow: 'auto' }}
    >
      {/* ── Top: Health Score Gauge ── */}
      <div style={{
        ...panelStyle,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 200,
        position: 'relative',
      }}>
        <span style={{ ...panelTitle, position: 'absolute', top: spacing.md, left: spacing.lg }}>
          System Health
        </span>
        <div
          ref={gaugeRef}
          style={{
            width: '100%',
            maxWidth: 280,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            aspectRatio: '1',
          }}
        >
          <GaugeRing
            value={score}
            label={health?.status ?? 'loading'}
            width={gaugeSize}
            height={gaugeSize}
            color={scoreColor}
          />
        </div>
        {/* Health status badge */}
        <motion.div
          key={health?.status}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '3px 12px',
            borderRadius: radii.lg,
            background: `${scoreColor}18`,
            color: scoreColor,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {health?.status ?? 'loading'}
        </motion.div>
      </div>

      {/* ── Middle: 6 Health Dimension Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: spacing.md }}>
        <AnimatePresence mode="popLayout">
          {DIM_CARDS.map((def, i) => {
            const extracted = def.extract(safeMetrics, safeHealth);
            const dimColor = statusColor(extracted.status);
            return (
              <motion.div
                key={def.key}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...transitions.spring, delay: i * 0.05 }}
                style={{
                  background: colors.bg.card,
                  border: `1px solid ${dimColor}33`,
                  borderRadius: radii.md,
                  padding: spacing.md,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: spacing.sm,
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Glow accent line */}
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  background: `linear-gradient(90deg, transparent, ${dimColor}, transparent)`,
                  opacity: 0.6,
                }} />

                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                  <span style={{ fontSize: 16 }}>{def.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: colors.text.secondary }}>{def.label}</span>
                </div>

                {/* Value */}
                <motion.div
                  key={String(extracted.value)}
                  initial={{ opacity: 0.5 }}
                  animate={{ opacity: 1 }}
                  style={{ fontSize: 26, fontWeight: 700, color: dimColor, letterSpacing: '-0.02em' }}
                >
                  {extracted.value}
                  {def.unit && <span style={{ fontSize: 13, fontWeight: 400, marginLeft: 3, color: colors.text.muted }}>{def.unit}</span>}
                </motion.div>

                {/* Threshold + Status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: colors.text.muted }}>
                    {extracted.threshold != null ? `Threshold: ${extracted.threshold}${def.unit}` : ''}
                  </span>
                  <span style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: radii.sm,
                    background: `${dimColor}22`,
                    color: dimColor,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}>
                    {extracted.status}
                  </span>
                </div>

                {/* Progress bar (for % based metrics) */}
                {(def.key === 'cpu' || def.key === 'memory') && typeof extracted.value === 'string' && !isNaN(parseFloat(extracted.value)) && (
                  <div style={{ height: 3, background: colors.bg.hover, borderRadius: 2, overflow: 'hidden' }}>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(parseFloat(extracted.value), 100)}%` }}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                      style={{
                        height: '100%',
                        background: dimColor,
                        borderRadius: 2,
                        boxShadow: `0 0 4px ${dimColor}66`,
                      }}
                    />
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* ── Bottom: System Info Table ── */}
      <div style={panelStyle}>
        <span style={panelTitle}>System Information</span>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: `${spacing.xs}px ${spacing.lg}px`,
        }}>
          {sysInfo.map(({ label, value }) => (
            <div key={label} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: `${spacing.xs}px 0`,
              borderBottom: `1px solid ${colors.bg.border}44`,
            }}>
              <span style={{ fontSize: 12, color: colors.text.muted }}>{label}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: colors.text.primary }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Modules list */}
        {modulesList.length > 0 && (
          <>
            <span style={{ ...panelTitle, marginTop: spacing.sm }}>Modules</span>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: spacing.xs,
              maxHeight: 240,
              overflow: 'auto',
            }}>
              {modulesList.map((mod) => (
                <div key={mod.name} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: spacing.sm,
                  padding: `${spacing.xs}px ${spacing.sm}px`,
                  background: colors.bg.hover,
                  borderRadius: radii.sm,
                  fontSize: 11,
                }}>
                  <div style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: mod.status === 'active' || mod.status === 'ready'
                      ? colors.glow.success
                      : mod.status === 'error'
                        ? colors.glow.danger
                        : colors.text.muted,
                    boxShadow: mod.status === 'active' || mod.status === 'ready'
                      ? `0 0 4px ${colors.glow.success}88`
                      : 'none',
                    flexShrink: 0,
                  }} />
                  <span style={{ color: colors.text.primary, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {mod.name}
                  </span>
                  <span style={{ color: colors.text.muted, fontSize: 10, flexShrink: 0 }}>
                    {mod.domain}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
