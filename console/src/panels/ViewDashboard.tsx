/**
 * ViewDashboard - compact data panel for view-specific telemetry
 */

import type { CSSProperties, FC } from 'react';
import { getPheromoneTypeInfo, usePheromoneStore } from '../stores/pheromone-store';
import { useWorldStore } from '../stores/world-store';
import type { ViewId } from '../stores/view-store';

interface ViewDashboardProps {
  viewId: ViewId;
}

const GLASS: CSSProperties = {
  background: 'rgba(12,12,30,0.85)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 8,
  padding: 12,
  marginBottom: 8,
};

const LABEL: CSSProperties = {
  fontSize: 9,
  color: '#666',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 4,
};

function StatRow({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
      <span style={{ fontSize: 11, color: '#888' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: color ?? '#fff', fontFamily: '"Segoe UI", monospace' }}>{value}</span>
    </div>
  );
}

function HiveDashboard() {
  const snapshot = useWorldStore((state) => state.snapshot);
  const agents = snapshot?.agents ?? [];
  const pheromones = snapshot?.pheromones ?? [];
  const executing = agents.filter((agent) => agent.state?.toUpperCase() === 'EXECUTING').length;

  return (
    <div style={GLASS}>
      <div style={LABEL}>Hive Status</div>
      <StatRow label="Active Agents" value={agents.length} color="#F5A623" />
      <StatRow label="Executing" value={executing} color="#10B981" />
      <StatRow label="Pheromones" value={pheromones.length} color="#F5A623" />
      <StatRow label="Mode" value={snapshot?.mode ?? 'N/A'} color={snapshot?.mode === 'EXPLORE' ? '#3B82F6' : '#F5A623'} />
    </div>
  );
}

function PipelineDashboard() {
  const tasks = useWorldStore((state) => state.snapshot?.tasks ?? []);
  const running = tasks.filter((task) => task.status === 'RUNNING').length;
  const completed = tasks.filter((task) => task.status === 'COMPLETED').length;
  const failed = tasks.filter((task) => task.status === 'FAILED').length;

  return (
    <div style={GLASS}>
      <div style={LABEL}>Pipeline Status</div>
      <StatRow label="Total Tasks" value={tasks.length} color="#3B82F6" />
      <StatRow label="Running" value={running} color="#3B82F6" />
      <StatRow label="Completed" value={completed} color="#10B981" />
      <StatRow label="Failed" value={failed} color="#EF4444" />
    </div>
  );
}

function FieldDashboard() {
  const field = useWorldStore((state) => state.snapshot?.field ?? {});
  const dims = Object.entries(field).slice(0, 12);

  return (
    <div style={GLASS}>
      <div style={LABEL}>Signal Field</div>
      {dims.length === 0 ? <StatRow label="Dimensions" value="No data" /> : null}
      {dims.map(([key, value]) => (
        <StatRow key={key} label={key} value={typeof value === 'number' ? value.toFixed(3) : 'N/A'} color="#7B61FF" />
      ))}
    </div>
  );
}

function SystemDashboard() {
  const snapshot = useWorldStore((state) => state.snapshot);
  const health = snapshot?.health ?? { score: 0, status: 'unknown', ts: 0 };
  const budget = snapshot?.budget?.global ?? { spent: 0, totalSession: 0, utilization: 0 };
  const breakerCount = Object.keys(snapshot?.breakers ?? {}).length;

  return (
    <div style={GLASS}>
      <div style={LABEL}>System Health</div>
      <StatRow label="Score" value={`${(health.score * 100).toFixed(0)}%`} color={health.score > 0.8 ? '#10B981' : '#F5A623'} />
      <StatRow label="Status" value={health.status} />
      <StatRow label="Budget" value={`${Math.round(budget.spent)}/${Math.round(budget.totalSession)}`} color={budget.utilization > 0.8 ? '#EF4444' : '#10B981'} />
      <StatRow label="Breakers" value={breakerCount} />
    </div>
  );
}

function ControlDashboard() {
  const breakers = useWorldStore((state) => state.snapshot?.breakers ?? {});

  return (
    <div style={GLASS}>
      <div style={LABEL}>Circuit Breakers</div>
      {Object.entries(breakers).length === 0 ? <StatRow label="Status" value="No breakers" /> : null}
      {Object.entries(breakers).map(([name, breaker]) => (
        <StatRow
          key={name}
          label={name.slice(0, 15)}
          value={breaker.state}
          color={breaker.state === 'CLOSED' ? '#10B981' : breaker.state === 'OPEN' ? '#EF4444' : '#F5A623'}
        />
      ))}
    </div>
  );
}

function CommunicationDashboard() {
  const levels = usePheromoneStore((state) => state.levels);
  const pheromoneInfo = getPheromoneTypeInfo();

  return (
    <div style={GLASS}>
      <div style={LABEL}>Pheromone Levels</div>
      {pheromoneInfo.map(({ type, label, color }) => {
        const intensity = levels[type]?.maxIntensity ?? 0;
        return (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 4px ${color}66` }} />
            <span style={{ fontSize: 11, color: '#aaa', flex: 1 }}>{label}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color }}>{(intensity * 100).toFixed(0)}%</span>
          </div>
        );
      })}
    </div>
  );
}

function GenericDashboard({ viewId }: { viewId: string }) {
  const snapshot = useWorldStore((state) => state.snapshot);

  return (
    <div style={GLASS}>
      <div style={LABEL}>{viewId} View</div>
      <StatRow label="Agents" value={snapshot?.agents?.length ?? 0} />
      <StatRow label="Health" value={`${((snapshot?.health?.score ?? 0) * 100).toFixed(0)}%`} />
    </div>
  );
}

const VIEW_DASHBOARDS: Partial<Record<ViewId, FC>> = {
  hive: HiveDashboard,
  pipeline: PipelineDashboard,
  field: FieldDashboard,
  system: SystemDashboard,
  control: ControlDashboard,
  communication: CommunicationDashboard,
};

export function ViewDashboard({ viewId }: ViewDashboardProps) {
  const Dashboard = VIEW_DASHBOARDS[viewId];
  if (Dashboard) {
    return <Dashboard />;
  }
  return <GenericDashboard viewId={viewId} />;
}
