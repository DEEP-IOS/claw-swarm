import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSSE } from '../hooks/useSSE';
import { useRestApi } from '../hooks/useRestApi';
import { fieldApi } from '../api/client';
import { useFieldStore } from '../stores/field-store';
import { StatCard } from '../components/cards/StatCard';
import { RadarChart } from '../components/charts/RadarChart';
import { Suspense, lazy } from 'react';
import { colors, spacing, radii, transitions, DIMENSIONS, DIMENSION_LABELS } from '../theme/tokens';

const FieldSphere = lazy(() => import('../components/three/FieldSphere').then(m => ({ default: m.FieldSphere })));
import type { FieldVector } from '../stores/field-store';

// ── Types ────────────────────────────────────────────────────
interface FieldStats {
  signalCount: number;
  gcCount: number;
  dimensionCount: number;
  queryCount: number;
  [key: string]: unknown;
}

interface DimensionInfo {
  name: string;
  value: number;
  weight: number;
  [key: string]: unknown;
}

interface SuperposeResult {
  vector: FieldVector;
  scope: string;
  [key: string]: unknown;
}

interface WeightsResult {
  weights: Record<string, number>;
  [key: string]: unknown;
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
  middleRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: spacing.lg,
    flex: 1,
    minHeight: 0,
  },
  radarPanel: {
    background: colors.bg.card,
    border: `1px solid ${colors.bg.border}`,
    borderRadius: radii.lg,
    padding: spacing.md,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 360,
  },
  dimPanel: {
    background: colors.bg.card,
    border: `1px solid ${colors.bg.border}`,
    borderRadius: radii.lg,
    padding: spacing.md,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: spacing.xs,
    overflow: 'auto',
  },
  dimPanelTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: colors.text.secondary,
    marginBottom: spacing.sm,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
  },
  dimRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: `${spacing.xs}px ${spacing.sm}px`,
    borderRadius: radii.sm,
    transition: transitions.fast,
    cursor: 'default',
  },
  dimDot: (color: string) => ({
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: color,
    boxShadow: `0 0 6px ${color}88`,
    flexShrink: 0,
  }),
  dimName: {
    fontSize: 13,
    fontWeight: 500,
    color: colors.text.primary,
    flex: 1,
  },
  dimValue: {
    fontSize: 13,
    fontWeight: 600,
    fontFamily: 'JetBrains Mono, monospace',
    color: colors.text.primary,
    minWidth: 48,
    textAlign: 'right' as const,
  },
  dimWeight: {
    fontSize: 11,
    color: colors.text.muted,
    minWidth: 40,
    textAlign: 'right' as const,
    fontFamily: 'JetBrains Mono, monospace',
  },
  weightsPanel: {
    background: colors.bg.card,
    border: `1px solid ${colors.bg.border}`,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  weightsPanelTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: colors.text.secondary,
    marginBottom: spacing.md,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
  },
  weightBarRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs + 2,
  },
  weightLabel: {
    fontSize: 11,
    color: colors.text.secondary,
    minWidth: 72,
    textAlign: 'right' as const,
  },
  weightBarBg: {
    flex: 1,
    height: 14,
    background: colors.bg.hover,
    borderRadius: radii.sm,
    overflow: 'hidden' as const,
    position: 'relative' as const,
  },
  weightBarValueLabel: {
    fontSize: 10,
    color: colors.text.primary,
    minWidth: 36,
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
} as const;

// ── Component ────────────────────────────────────────────────
export function FieldView() {
  // ---- zustand store ----
  const storeVector = useFieldStore(s => s.vector);
  const updateVector = useFieldStore(s => s.updateVector);
  const updateStats = useFieldStore(s => s.updateStats);
  const updateWeights = useFieldStore(s => s.updateWeights);

  // ---- local state for REST data ----
  const [localStats, setLocalStats] = useState<FieldStats>({
    signalCount: 0, gcCount: 0, dimensionCount: 12, queryCount: 0,
  });
  const [localDims, setLocalDims] = useState<DimensionInfo[]>([]);
  const [localWeights, setLocalWeights] = useState<Record<string, number>>({});

  // ---- REST fetches ----
  const { loading: statsLoading, error: statsErr } = useRestApi<FieldStats>(
    async () => {
      const data = await fieldApi.stats() as FieldStats;
      setLocalStats(data);
      updateStats(data as unknown as Record<string, unknown>);
      return data;
    },
    [],
    15_000,
  );

  const { loading: dimsLoading, error: dimsErr } = useRestApi<DimensionInfo[]>(
    async () => {
      const data = await fieldApi.dimensions() as DimensionInfo[];
      setLocalDims(Array.isArray(data) ? data : []);
      return data;
    },
    [],
    30_000,
  );

  useRestApi<SuperposeResult>(
    async () => {
      const data = await fieldApi.superpose('global') as SuperposeResult;
      if (data?.vector) {
        updateVector(data.vector);
      }
      return data;
    },
    [],
    10_000,
  );

  useRestApi<WeightsResult>(
    async () => {
      const data = await fieldApi.weights() as WeightsResult;
      const w = data?.weights ?? (data as unknown as Record<string, number>);
      if (w && typeof w === 'object') {
        setLocalWeights(w);
        updateWeights(w);
      }
      return data;
    },
    [],
    30_000,
  );

  // ---- SSE real-time updates ----
  useSSE('field.snapshot', useCallback((data: unknown) => {
    const d = data as { vector?: FieldVector };
    if (d?.vector) updateVector(d.vector);
  }, [updateVector]));

  useSSE('field.stats.snapshot', useCallback((data: unknown) => {
    const d = data as FieldStats;
    if (d) {
      setLocalStats(prev => ({ ...prev, ...d }));
      updateStats(d as unknown as Record<string, unknown>);
    }
  }, [updateStats]));

  // ---- derived: merge REST dims with live vector ----
  const dimensionRows = useMemo(() => {
    return DIMENSIONS.map(dim => {
      const restInfo = localDims.find(d => d.name === dim);
      const liveValue = storeVector[dim] ?? restInfo?.value ?? 0;
      const weight = localWeights[dim] ?? restInfo?.weight ?? 0;
      const dimColor = colors.dimension[dim] || colors.glow.primary;
      return { dim, label: DIMENSION_LABELS[dim] || dim, value: liveValue, weight, color: dimColor };
    });
  }, [localDims, storeVector, localWeights]);

  // ---- loading state ----
  const isLoading = statsLoading && dimsLoading;
  const error = statsErr || dimsErr;

  if (isLoading) {
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
          ◎
        </motion.div>
        Loading field data...
      </motion.div>
    );
  }

  // ---- max weight for bar scaling ----
  const maxWeight = Math.max(0.01, ...dimensionRows.map(d => d.weight));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={styles.container}
    >
      {/* ── Header ─────────────────────────── */}
      <div style={styles.header}>
        <span style={styles.titleIcon}>◉</span>
        <span style={styles.title}>Signal Field</span>
      </div>

      {/* ── Error banner ───────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={styles.errorBanner}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Stat cards row ─────────────────── */}
      <div style={styles.statRow}>
        <StatCard
          label="Signals"
          value={localStats.signalCount ?? 0}
          color={colors.glow.primary}
          icon="⚡"
          subtext="Total emitted"
        />
        <StatCard
          label="GC Cycles"
          value={localStats.gcCount ?? 0}
          color={colors.glow.warning}
          icon="♻"
          subtext="Garbage collections"
        />
        <StatCard
          label="Dimensions"
          value={localStats.dimensionCount ?? 12}
          color={colors.glow.secondary}
          icon="◈"
          subtext="Active dims"
        />
        <StatCard
          label="Queries"
          value={localStats.queryCount ?? 0}
          color={colors.glow.info}
          icon="⊛"
          subtext="Superposition queries"
        />
      </div>

      {/* ── 3D Signal Field Sphere ── */}
      <motion.div
        style={{ background: colors.bg.card, border: `1px solid ${colors.bg.border}`, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.md }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.5 }}
      >
        <div style={{ fontSize: 12, color: colors.text.secondary, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          3D Signal Field — Rotate to explore
        </div>
        <Suspense fallback={<div style={{ height: 350, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.text.muted }}>Loading 3D...</div>}>
          <FieldSphere vector={storeVector} width={undefined as any} height={350} />
        </Suspense>
      </motion.div>

      {/* ── Middle row: Radar + Dimensions ── */}
      <div style={styles.middleRow}>
        {/* Radar chart */}
        <motion.div
          style={styles.radarPanel}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, duration: 0.5 }}
        >
          <div style={{ fontSize: 12, color: colors.text.secondary, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Global Superposition (2D)
          </div>
          <RadarChart vector={storeVector} width={380} height={380} />
        </motion.div>

        {/* 12 dimension list */}
        <motion.div
          style={styles.dimPanel}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15, duration: 0.4 }}
        >
          <div style={styles.dimPanelTitle}>12 Dimensions</div>
          <AnimatePresence>
            {dimensionRows.map((row, i) => (
              <motion.div
                key={row.dim}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03, duration: 0.3 }}
                style={{
                  ...styles.dimRow,
                  background: 'transparent',
                }}
                whileHover={{ background: colors.bg.hover }}
              >
                <div style={styles.dimDot(row.color)} />
                <span style={styles.dimName}>{row.label}</span>
                <motion.span
                  key={row.value.toFixed(3)}
                  initial={{ opacity: 0.4 }}
                  animate={{ opacity: 1 }}
                  style={{ ...styles.dimValue, color: row.color }}
                >
                  {row.value.toFixed(3)}
                </motion.span>
                <span style={styles.dimWeight}>w:{row.weight.toFixed(2)}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* ── Bottom: Weight bar chart ──────── */}
      <motion.div
        style={styles.weightsPanel}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.4 }}
      >
        <div style={styles.weightsPanelTitle}>Signal Weights Distribution</div>
        {dimensionRows.map((row, i) => {
          const pct = maxWeight > 0 ? (row.weight / maxWeight) * 100 : 0;
          return (
            <motion.div
              key={row.dim}
              style={styles.weightBarRow}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.025, duration: 0.3 }}
            >
              <span style={styles.weightLabel}>{row.label}</span>
              <div style={styles.weightBarBg}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ delay: 0.4 + i * 0.03, duration: 0.6, ease: 'easeOut' }}
                  style={{
                    height: '100%',
                    background: `linear-gradient(90deg, ${row.color}88, ${row.color})`,
                    borderRadius: radii.sm,
                    boxShadow: `0 0 8px ${row.color}44`,
                  }}
                />
              </div>
              <span style={styles.weightBarValueLabel}>{row.weight.toFixed(2)}</span>
            </motion.div>
          );
        })}
      </motion.div>
    </motion.div>
  );
}
