import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { StatCard } from '../components/cards/StatCard';
import { GaugeRing } from '../components/charts/GaugeRing';
import { useSSE } from '../hooks/useSSE';
import { orchestrationApi } from '../api/client';
import { colors } from '../theme/tokens';

interface TaskInfo { id: string; type?: string; status?: string; agentId?: string }

export function OrchestrationView() {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [criticalPath, setCriticalPath] = useState<any>({});
  const [dualProcess, setDualProcess] = useState<any>({});
  const [budget, setBudget] = useState<any>({});

  useEffect(() => {
    orchestrationApi.tasks().then((t: any) => setTasks(Array.isArray(t) ? t : [])).catch(() => {});
    orchestrationApi.criticalPath().then((c: any) => setCriticalPath(c || {})).catch(() => {});
    orchestrationApi.dualProcess().then((d: any) => setDualProcess(d || {})).catch(() => {});
    orchestrationApi.budget().then((b: any) => setBudget(b || {})).catch(() => {});
  }, []);

  useSSE('task.*', () => {
    orchestrationApi.tasks().then((t: any) => setTasks(Array.isArray(t) ? t : [])).catch(() => {});
  });

  const s1 = dualProcess?.system1Count ?? 0;
  const s2 = dualProcess?.system2Count ?? 0;
  const totalBudget = budget?.totalTokens ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 16 }}>
        <StatCard label="Tasks" value={tasks.length} icon="⬢" color={colors.glow.info} subtext={`${tasks.filter(t => t.status === 'completed').length} completed`} />
        <StatCard label="System 1 (Fast)" value={s1} icon="⚡" color={colors.glow.primary} />
        <StatCard label="System 2 (Slow)" value={s2} icon="🧠" color={colors.glow.secondary} />
        <StatCard label="Threshold" value={(dualProcess?.threshold ?? 0.4).toFixed(2)} icon="◎" color={colors.glow.warning} />
        <StatCard label="Token Budget" value={totalBudget.toLocaleString()} icon="💰" color={colors.dimension.cost} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 16, flex: 1, minHeight: 250 }}>
        <div style={{ background: colors.bg.card, border: `1px solid ${colors.bg.border}`, borderRadius: 'var(--radius-md)', padding: 16, overflow: 'auto' }}>
          <div style={{ fontSize: 12, color: colors.text.secondary, fontWeight: 600, marginBottom: 12 }}>Task Queue</div>
          {tasks.length === 0 ? (
            <div style={{ color: colors.text.muted, fontSize: 13, textAlign: 'center', padding: 40 }}>No tasks yet — send a message to trigger swarm_run</div>
          ) : tasks.map((task, i) => (
            <motion.div key={task.id || i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} style={{
              padding: '10px 14px', background: colors.bg.hover, borderRadius: 'var(--radius-sm)', marginBottom: 6,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%',
                  background: task.status === 'completed' ? colors.glow.success : task.status === 'failed' ? colors.glow.danger : colors.glow.info }} />
                <span style={{ color: colors.text.primary }}>{task.id?.slice(0, 16)}</span>
              </div>
              <span style={{ color: colors.text.muted }}>{task.status ?? 'pending'}</span>
            </motion.div>
          ))}
        </div>
        <div style={{ background: colors.bg.card, border: `1px solid ${colors.bg.border}`, borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ fontSize: 12, color: colors.text.secondary, fontWeight: 600, marginBottom: 8 }}>Budget</div>
          <GaugeRing value={totalBudget > 0 ? Math.min(1, totalBudget / 1000000) : 0} label="tokens" width={180} height={180} color={totalBudget > 800000 ? colors.glow.danger : colors.glow.primary} />
          <div style={{ fontSize: 11, color: colors.text.muted, marginTop: 12, textAlign: 'center' }}>
            Critical Path: {criticalPath?.criticalPath?.length ?? 0} nodes<br />Bottleneck: {criticalPath?.bottleneck ?? 'none'}
          </div>
        </div>
      </div>
    </div>
  );
}
