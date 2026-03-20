import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { StatCard } from '../components/cards/StatCard';
import { useSSE } from '../hooks/useSSE';
import { useRestApi } from '../hooks/useRestApi';
import { qualityApi } from '../api/client';
import { colors, spacing, radii, transitions } from '../theme/tokens';

/* ── Type definitions ────────────────────────────────────────── */

interface CircuitBreaker {
  tool: string;
  state: 'CLOSED' | 'HALF_OPEN' | 'OPEN';
  failures: number;
  lastFailure?: string;
  threshold?: number;
}

interface ComplianceStats {
  totalChecks: number;
  violations: number;
  escalations?: Record<string, number>;       // level -> count
  escalationDistribution?: Record<string, number>;
}

interface FailureMode {
  mode: string;
  count: number;
  percentage?: number;
}

interface VaccinationData {
  total: number;
  active: number;
  patterns?: Array<{ pattern: string; count: number }>;
}

interface AuditSummary {
  gateEvaluations: number;
  passed: number;
  failed: number;
  passRate?: number;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const BREAKER_COLORS: Record<string, string> = {
  CLOSED: colors.glow.success,
  HALF_OPEN: colors.glow.warning,
  OPEN: colors.glow.danger,
};

const BREAKER_LABELS: Record<string, string> = {
  CLOSED: 'Healthy',
  HALF_OPEN: 'Half-Open',
  OPEN: 'Open',
};

function maxVal(arr: number[]): number {
  return arr.length === 0 ? 1 : Math.max(...arr, 1);
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
  overflow: 'hidden',
};

const panelTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: colors.text.secondary,
  letterSpacing: '0.04em',
  textTransform: 'uppercase' as const,
};

/* ── Bar chart row (div-simulated) ───────────────────────────── */

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
      <div style={{ width: 120, fontSize: 12, color: colors.text.secondary, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </div>
      <div style={{ flex: 1, height: 18, background: colors.bg.hover, borderRadius: radii.sm, overflow: 'hidden', position: 'relative' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{
            height: '100%',
            background: `linear-gradient(90deg, ${color}CC, ${color})`,
            borderRadius: radii.sm,
            boxShadow: `0 0 8px ${color}44`,
          }}
        />
      </div>
      <div style={{ width: 48, fontSize: 12, fontWeight: 600, color: colors.text.primary, textAlign: 'right' }}>
        {value}
      </div>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────── */

export function QualityView() {
  // ── REST data ──
  const { data: breakers, refresh: refreshBreakers } = useRestApi<CircuitBreaker[]>(
    qualityApi.circuitBreakers as () => Promise<CircuitBreaker[]>, [], 15000,
  );
  const { data: compliance, refresh: refreshCompliance } = useRestApi<ComplianceStats>(
    qualityApi.compliance as () => Promise<ComplianceStats>, [], 15000,
  );
  const { data: failureModes, refresh: refreshFailures } = useRestApi<FailureMode[]>(
    qualityApi.failureModes as () => Promise<FailureMode[]>, [], 15000,
  );
  const { data: vaccinations, refresh: refreshVax } = useRestApi<VaccinationData>(
    qualityApi.vaccinations as () => Promise<VaccinationData>, [], 30000,
  );
  const { data: audit, refresh: refreshAudit } = useRestApi<AuditSummary>(
    qualityApi.audit as () => Promise<AuditSummary>, [], 15000,
  );

  // ── SSE real-time ──
  const [lastEvent, setLastEvent] = useState<string>('');

  const handleSSE = useCallback((_data: unknown, topic: string) => {
    setLastEvent(topic);
    // Refresh relevant data on quality events
    if (topic.includes('circuit') || topic.includes('breaker')) {
      refreshBreakers();
    } else if (topic.includes('compliance') || topic.includes('violation')) {
      refreshCompliance();
    } else if (topic.includes('failure')) {
      refreshFailures();
    } else if (topic.includes('vaccin')) {
      refreshVax();
    } else if (topic.includes('audit') || topic.includes('gate')) {
      refreshAudit();
    } else {
      // Generic quality event: refresh everything
      refreshBreakers();
      refreshCompliance();
      refreshFailures();
    }
  }, [refreshBreakers, refreshCompliance, refreshFailures, refreshVax, refreshAudit]);

  useSSE('quality.*', handleSSE);

  // ── Derived stats ──
  const violationCount = compliance?.violations ?? 0;
  const breakerArr = Array.isArray(breakers) ? breakers : Object.values(breakers ?? {});
  const breakerTrips = breakerArr.filter((b: any) => b.state === 'OPEN').length;
  const gateEvals = audit?.gateEvaluations ?? (Array.isArray(audit) ? audit.length : 0);
  const vaxCount = vaccinations?.total ?? (Array.isArray(vaccinations) ? vaccinations.length : 0);

  // Escalation distribution: level 1/2/3
  const escalation = compliance?.escalations ?? compliance?.escalationDistribution ?? {};
  const escalationEntries = Object.entries(escalation).sort(([a], [b]) => a.localeCompare(b));
  const escalationMax = maxVal(escalationEntries.map(([, v]) => v));

  // Failure modes
  const failures = Array.isArray(failureModes)
    ? failureModes
    : Object.entries(failureModes ?? {}).map(([mode, count]) => ({ mode, count: count as number }));
  const failureMax = maxVal(failures.map((f: any) => f.count ?? 0));

  // Escalation bar colors by level
  const escalationColors = [colors.glow.warning, colors.glow.danger, '#FF2255'];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      style={{ display: 'flex', flexDirection: 'column', gap: spacing.lg, height: '100%', overflow: 'auto' }}
    >
      {/* ── Top row: 4 stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: spacing.md }}>
        <StatCard
          label="Compliance Violations"
          value={violationCount}
          icon="⚠"
          color={violationCount > 0 ? colors.glow.danger : colors.glow.success}
          subtext={`${compliance?.totalChecks ?? 0} total checks`}
        />
        <StatCard
          label="Breaker Trips"
          value={breakerTrips}
          icon="⚡"
          color={breakerTrips > 0 ? colors.glow.danger : colors.glow.success}
          subtext={`${breakerArr?.length ?? 0} breakers total`}
        />
        <StatCard
          label="Gate Evaluations"
          value={gateEvals}
          icon="◇"
          color={colors.glow.info}
          subtext={audit?.passRate != null ? `${(audit.passRate * 100).toFixed(1)}% pass rate` : `${audit?.passed ?? 0} passed`}
        />
        <StatCard
          label="Vaccinations"
          value={vaxCount}
          icon="🛡"
          color={colors.glow.secondary}
          subtext={`${vaccinations?.active ?? 0} active`}
        />
      </div>

      {/* ── Middle: Circuit Breaker panel ── */}
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={panelTitle}>Circuit Breakers</span>
          {lastEvent && (
            <motion.span
              key={lastEvent}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              style={{ fontSize: 10, color: colors.text.muted }}
            >
              Last event: {lastEvent}
            </motion.span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: spacing.sm }}>
          <AnimatePresence mode="popLayout">
            {breakerArr.map((b: any) => (
              <motion.div
                key={b.tool}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={transitions.spring}
                style={{
                  background: colors.bg.hover,
                  border: `1px solid ${BREAKER_COLORS[b.state] ?? colors.bg.border}44`,
                  borderRadius: radii.sm,
                  padding: `${spacing.sm}px ${spacing.md}px`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: spacing.sm,
                }}
              >
                {/* State indicator dot */}
                <div style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: BREAKER_COLORS[b.state] ?? colors.text.muted,
                  boxShadow: `0 0 6px ${BREAKER_COLORS[b.state] ?? colors.text.muted}88`,
                  flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: colors.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.tool}
                  </div>
                  <div style={{ fontSize: 10, color: colors.text.muted }}>
                    {BREAKER_LABELS[b.state] ?? b.state} &middot; {b.failures} failures
                  </div>
                </div>
                {/* State badge */}
                <div style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: radii.sm,
                  background: `${BREAKER_COLORS[b.state] ?? colors.text.muted}22`,
                  color: BREAKER_COLORS[b.state] ?? colors.text.muted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}>
                  {b.state}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {breakerArr.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: spacing.lg, color: colors.text.muted, fontSize: 13 }}>
              No circuit breakers registered
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom row: Escalation + Failure Modes ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.md, minHeight: 180 }}>
        {/* Escalation Distribution */}
        <div style={panelStyle}>
          <span style={panelTitle}>Escalation Distribution</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm, flex: 1 }}>
            {escalationEntries.length > 0 ? (
              escalationEntries.map(([level, count], i) => (
                <BarRow
                  key={level}
                  label={`Level ${level}`}
                  value={count}
                  max={escalationMax}
                  color={escalationColors[i] ?? colors.glow.warning}
                />
              ))
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.text.muted, fontSize: 12 }}>
                No escalation data
              </div>
            )}
          </div>
        </div>

        {/* Failure Mode Distribution */}
        <div style={panelStyle}>
          <span style={panelTitle}>Failure Modes</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm, flex: 1, overflow: 'auto' }}>
            {failures.length > 0 ? (
              failures.map((f) => (
                <BarRow
                  key={f.mode}
                  label={f.mode}
                  value={f.count}
                  max={failureMax}
                  color={colors.glow.danger}
                />
              ))
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.text.muted, fontSize: 12 }}>
                No failure modes recorded
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
