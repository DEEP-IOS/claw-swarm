import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { StatCard } from '../components/cards/StatCard';
import { GaugeRing } from '../components/charts/GaugeRing';
import { adaptationApi, orchestrationApi } from '../api/client';
import { colors } from '../theme/tokens';

export function AdaptationView() {
  const [modulator, setModulator] = useState<any>({});
  const [shapley, setShapley] = useState<any>({});
  const [species, setSpecies] = useState<any>({});
  const [calibration, setCalibration] = useState<any>({});
  const [budgetForecast, setBudgetForecast] = useState<any>({});
  const [roleDiscovery, setRoleDiscovery] = useState<any>({});

  useEffect(() => {
    adaptationApi.modulator().then((m: any) => setModulator(m || {})).catch(() => {});
    adaptationApi.shapley().then((s: any) => setShapley(s || {})).catch(() => {});
    adaptationApi.species().then((s: any) => setSpecies(s || {})).catch(() => {});
    adaptationApi.calibration().then((c: any) => setCalibration(c || {})).catch(() => {});
    orchestrationApi.budgetForecast().then((b: any) => setBudgetForecast(b || {})).catch(() => {});
    adaptationApi.roleDiscovery().then((r: any) => setRoleDiscovery(r || {})).catch(() => {});
  }, []);

  const mode = modulator?.mode ?? 'EXPLOIT';
  const explorationRate = modulator?.explorationRate ?? 0.1;
  const modeChanges = modulator?.modeChanges ?? 0;
  const shapleyEntries = Object.keys(shapley).length;
  const speciesEntries = Object.keys(species).length;
  const calibrationEntries = Object.keys(calibration).length;

  const modeColor = mode === 'EXPLORE' ? colors.glow.secondary : colors.glow.primary;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%', overflow: 'auto' }}>
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 16 }}>
        <StatCard label="Global Mode" value={mode} icon={mode === 'EXPLORE' ? '🔭' : '🎯'} color={modeColor} subtext={`${modeChanges} switches`} />
        <StatCard label="Exploration Rate" value={`${(explorationRate * 100).toFixed(0)}%`} icon="📊" color={colors.glow.warning} />
        <StatCard label="Shapley Credits" value={shapleyEntries} icon="⚖️" color={colors.dimension.trust} subtext="agent credits" />
        <StatCard label="Species" value={speciesEntries} icon="🧬" color={colors.dimension.novelty} subtext="role variants" />
        <StatCard label="Calibrations" value={calibrationEntries} icon="🎚️" color={colors.dimension.complexity} subtext="weight adjustments" />
      </div>

      {/* Mode gauge + details */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, flex: 1, minHeight: 250 }}>
        {/* Exploration/Exploitation gauge */}
        <div style={{
          background: colors.bg.card, border: `1px solid ${colors.bg.border}`, borderRadius: 'var(--radius-md)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{ fontSize: 12, color: colors.text.secondary, fontWeight: 600, marginBottom: 8 }}>
            Explore / Exploit Balance
          </div>
          <GaugeRing value={explorationRate} label={mode} width={200} height={200} color={modeColor} />
          <div style={{ fontSize: 11, color: colors.text.muted, marginTop: 12, textAlign: 'center' }}>
            {mode === 'EXPLORE' ? 'Trying new strategies' : 'Using proven patterns'}
          </div>
        </div>

        {/* Adaptation details */}
        <div style={{
          background: colors.bg.card, border: `1px solid ${colors.bg.border}`, borderRadius: 'var(--radius-md)',
          padding: 16, overflow: 'auto',
        }}>
          <div style={{ fontSize: 12, color: colors.text.secondary, fontWeight: 600, marginBottom: 16 }}>
            Self-Evolution Mechanisms
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            {[
              { title: 'Signal Calibration', desc: 'Auto-adjusts which signal dimensions matter most based on outcome correlation', icon: '🎚️', color: colors.glow.warning },
              { title: 'Species Evolution', desc: 'Role definitions evolve over time via Lotka-Volterra population dynamics', icon: '🧬', color: colors.glow.secondary },
              { title: 'Learning Curves', desc: 'Per-role per-task success rates tracked for model cost optimization', icon: '📈', color: colors.glow.primary },
              { title: 'Budget Forecast', desc: 'Predictive token consumption based on task complexity history', icon: '💰', color: colors.dimension.cost },
              { title: 'Role Discovery', desc: 'Emergent role patterns detected from agent behavior clusters', icon: '🔍', color: colors.glow.info },
              { title: 'Shapley Credit', desc: 'Fair credit attribution via Monte Carlo Shapley value estimation', icon: '⚖️', color: colors.dimension.trust },
            ].map((item) => (
              <motion.div key={item.title} whileHover={{ scale: 1.02 }} style={{
                padding: 14, background: colors.bg.hover, borderRadius: 'var(--radius-sm)',
                borderLeft: `3px solid ${item.color}`,
              }}>
                <div style={{ fontSize: 16, marginBottom: 6 }}>{item.icon}</div>
                <div style={{ fontSize: 12, color: item.color, fontWeight: 600, marginBottom: 4 }}>{item.title}</div>
                <div style={{ fontSize: 11, color: colors.text.muted, lineHeight: 1.4 }}>{item.desc}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
