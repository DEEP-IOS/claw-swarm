import { useEffect, useRef, useState } from 'react';
import { StatCard } from '../components/cards/StatCard';
import { EventFeed } from '../components/cards/EventFeed';
import { RadarChart } from '../components/charts/RadarChart';
import { useMetricsStore } from '../stores/metrics-store';
import { useFieldStore } from '../stores/field-store';
import { useSSE } from '../hooks/useSSE';
import { systemApi, fieldApi } from '../api/client';

export function Overview() {
  const metrics = useMetricsStore((s) => s.metrics);
  const health = useMetricsStore((s) => s.health);
  const vector = useFieldStore((s) => s.vector);
  const updateMetrics = useMetricsStore((s) => s.updateMetrics);
  const updateHealth = useMetricsStore((s) => s.updateHealth);
  const updateVector = useFieldStore((s) => s.updateVector);

  // Radar chart container size
  const radarRef = useRef<HTMLDivElement>(null);
  const [radarSize, setRadarSize] = useState({ w: 400, h: 400 });

  useEffect(() => {
    const el = radarRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setRadarSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Initial load
  useEffect(() => {
    systemApi.metrics().then((m: any) => updateMetrics(m)).catch(() => {});
    systemApi.health().then((h: any) => updateHealth(h)).catch(() => {});
    fieldApi.superpose('global').then((v: any) => updateVector(v)).catch(() => {});
  }, [updateMetrics, updateHealth, updateVector]);

  // SSE real-time updates
  useSSE('observe.metrics.collected', (data: any) => {
    if (data?.metrics) updateMetrics(data.metrics);
  });
  useSSE('observe.health.snapshot', (data: any) => {
    if (data?.health) updateHealth(data.health);
  });
  useSSE('field.snapshot', (data: any) => {
    if (data?.vector) updateVector(data.vector);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      {/* Top row: stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        <StatCard
          label="Health Score"
          value={health ? `${(health.score * 100).toFixed(0)}%` : '—'}
          icon="💚"
          color={health?.status === 'healthy' ? 'var(--glow-success)' : 'var(--glow-warning)'}
          subtext={health?.status ?? 'loading'}
        />
        <StatCard
          label="Active Agents"
          value={metrics?.agents?.active ?? 0}
          icon="⬡"
          color="var(--glow-info)"
          subtext={`${metrics?.agents?.spawned ?? 0} spawned total`}
        />
        <StatCard
          label="Tasks"
          value={metrics?.tasks?.inProgress ?? 0}
          icon="◉"
          color="var(--glow-primary)"
          subtext={`${metrics?.tasks?.completed ?? 0} completed`}
        />
        <StatCard
          label="Signal Count"
          value={metrics?.signals?.currentCount ?? 0}
          icon="◈"
          color="var(--glow-secondary)"
          subtext={`${metrics?.signals?.emitted ?? 0} emitted`}
        />
        <StatCard
          label="Quality"
          value={metrics?.quality?.breakerTrips ?? 0}
          icon="◇"
          color={metrics?.quality?.breakerTrips ? 'var(--glow-danger)' : 'var(--glow-success)'}
          subtext="breaker trips"
        />
      </div>

      {/* Bottom row: 12D radar + event feed */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, minHeight: 0 }}>
        <div
          ref={radarRef}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--bg-border)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div style={{
            position: 'absolute',
            top: 12,
            left: 16,
            fontSize: 12,
            color: 'var(--text-secondary)',
            fontWeight: 600,
          }}>
            12-Dimensional Signal Field
          </div>
          {radarSize.w > 100 && radarSize.h > 100 && (
            <RadarChart
              vector={vector}
              width={radarSize.w}
              height={radarSize.h}
            />
          )}
        </div>
        <EventFeed />
      </div>
    </div>
  );
}
