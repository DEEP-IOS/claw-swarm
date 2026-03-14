/**
 * 控制视图覆盖层 / Control View Overlay
 *
 * V7.0 完整实现:
 *   - 模式指示器 (大字模式名 + 回合数)
 *   - 断路器状态 (CLOSED/OPEN/HALF_OPEN)
 *   - 健康度仪表盘 (百分比+色彩编码)
 *   - 预算仪表盘 (消耗/总量+风险等级)
 *   - PI 控制器指示
 *   - 冷启动进度
 *   - RED 指标面板
 *   - 信号权重条
 *
 * @module console/views/ControlOverlay
 * @author DEEP-IOS
 */
import React from 'react';
import useStore from '../store.js';
import { MODE_COLORS, hexToRgba, fmtDuration, fmtPct } from '../bridge/colors.js';

const BREAKER_COLORS = { CLOSED: '#10B981', OPEN: '#EF4444', HALF_OPEN: '#F5A623' };
const BREAKER_ZH = { CLOSED: '关闭', OPEN: '断开', HALF_OPEN: '半开' };

export default function ControlOverlay() {
  const mode = useStore((s) => s.mode);
  const breaker = useStore((s) => s.breaker);
  const budget = useStore((s) => s.budget);
  const health = useStore((s) => s.health);
  const red = useStore((s) => s.red);
  const piController = useStore((s) => s.piController);
  const coldStart = useStore((s) => s.coldStart);
  const signals = useStore((s) => s.signals);

  const modeColor = MODE_COLORS[mode.m] || MODE_COLORS.EXPLOIT;
  const brkColor = BREAKER_COLORS[breaker.state] || '#6B7280';
  const budgetTotal = budget.total || 1;
  const budgetPct = Math.min(100, (budget.consumed / budgetTotal) * 100);
  const budgetRisk = budgetPct > 80 ? '#EF4444' : budgetPct > 60 ? '#F5A623' : '#10B981';
  const healthColor = health > 80 ? '#10B981' : health > 50 ? '#F5A623' : '#EF4444';

  // 信号权重排序 / Sort signal weights
  const signalEntries = Object.entries(signals || {}).sort(([, a], [, b]) => b - a);

  return (
    <div style={{ pointerEvents: 'none', padding: 12, height: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* 模式指示器 */}
      <div style={{
        background: hexToRgba(modeColor, 0.12), border: `2px solid ${modeColor}`,
        borderRadius: 10, padding: '8px 14px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: modeColor, letterSpacing: 2 }}>{mode.m || 'UNKNOWN'}</div>
        <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2, fontFamily: 'var(--font-zh)' }}>运行模式 · 回合 {mode.turns || 0}</div>
      </div>

      {/* 断路器 + 健康度 */}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, background: hexToRgba(brkColor, 0.08), border: `1px solid ${hexToRgba(brkColor, 0.3)}`, borderRadius: 8, padding: '6px 10px' }}>
          <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 3, fontFamily: 'var(--font-zh)' }}>断路器</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: brkColor }}>{breaker.state || 'CLOSED'}</div>
          <div style={{ fontSize: 9, color: '#6B7280', marginTop: 2 }}>
            {BREAKER_ZH[breaker.state] || '—'} · 失败 {breaker.failures || 0}/{breaker.threshold || 5}
          </div>
        </div>
        <div style={{ flex: 1, background: hexToRgba(healthColor, 0.08), border: `1px solid ${hexToRgba(healthColor, 0.3)}`, borderRadius: 8, padding: '6px 10px' }}>
          <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 3, fontFamily: 'var(--font-zh)' }}>健康度</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: healthColor }}>
            {typeof health === 'number' ? health : '—'}<span style={{ fontSize: 11, fontWeight: 400 }}>%</span>
          </div>
          <div style={{ height: 4, background: '#374151', borderRadius: 2, marginTop: 3, overflow: 'hidden' }}>
            <div style={{ width: `${health || 0}%`, height: '100%', background: healthColor, borderRadius: 2 }} />
          </div>
        </div>
      </div>

      {/* PI 控制器 + 冷启动 */}
      <div style={{ display: 'flex', gap: 8 }}>
        {/* PI 控制器 */}
        <div style={{ flex: 1, background: hexToRgba('#06B6D4', 0.06), border: `1px solid ${hexToRgba('#06B6D4', 0.15)}`, borderRadius: 6, padding: '5px 8px' }}>
          <div style={{ fontSize: 9, color: '#06B6D4', fontWeight: 600 }}>PI Controller</div>
          <div style={{ fontSize: 8, color: '#6B7280', fontFamily: 'var(--font-zh)' }}>PI 控制器</div>
          {piController ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 3, fontSize: 9, fontFamily: 'var(--font-mono)', color: '#D1D5DB' }}>
              <span>Kp:{piController.kp?.toFixed(2) || '—'}</span>
              <span>Ki:{piController.ki?.toFixed(2) || '—'}</span>
              <span>Out:{piController.output?.toFixed(2) || '—'}</span>
            </div>
          ) : (
            <div style={{ fontSize: 9, color: '#4B5563', marginTop: 3 }}>—</div>
          )}
        </div>

        {/* 冷启动进度 */}
        <div style={{ flex: 1, background: hexToRgba('#3B82F6', 0.06), border: `1px solid ${hexToRgba('#3B82F6', 0.15)}`, borderRadius: 6, padding: '5px 8px' }}>
          <div style={{ fontSize: 9, color: '#3B82F6', fontWeight: 600 }}>Cold Start</div>
          <div style={{ fontSize: 8, color: '#6B7280', fontFamily: 'var(--font-zh)' }}>冷启动</div>
          {coldStart ? (
            <React.Fragment>
              <div style={{ fontSize: 10, color: coldStart.complete ? '#10B981' : '#3B82F6', fontWeight: 600, marginTop: 2 }}>
                {coldStart.complete ? '已完成' : coldStart.mode || 'EXPLORE'}
              </div>
              <div style={{ height: 3, background: '#374151', borderRadius: 2, marginTop: 2, overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.min(100, ((coldStart.completedTasks || 0) / (coldStart.threshold || 5)) * 100)}%`,
                  height: '100%', background: '#3B82F6', borderRadius: 2,
                }} />
              </div>
              <div style={{ fontSize: 8, color: '#6B7280', marginTop: 1 }}>
                {coldStart.completedTasks || 0}/{coldStart.threshold || 5}
              </div>
            </React.Fragment>
          ) : (
            <div style={{ fontSize: 9, color: '#4B5563', marginTop: 3 }}>—</div>
          )}
        </div>
      </div>

      {/* 预算仪表盘 */}
      <div style={{ background: hexToRgba(budgetRisk, 0.06), border: `1px solid ${hexToRgba(budgetRisk, 0.2)}`, borderRadius: 8, padding: '6px 10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9CA3AF', marginBottom: 3 }}>
          <span>Budget / 预算</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: budgetRisk }}>
            {budget.consumed?.toLocaleString() || 0} / {budget.total?.toLocaleString() || 0}
          </span>
        </div>
        <div style={{ height: 6, background: '#374151', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${budgetPct}%`, height: '100%', background: budgetRisk, borderRadius: 3 }} />
        </div>
        <div style={{ fontSize: 9, color: '#6B7280', marginTop: 2, textAlign: 'right' }}>
          风险: {budget.risk === 'low' ? '低' : budget.risk === 'medium' ? '中' : budget.risk === 'high' ? '高' : (budget.risk || '低')}
        </div>
      </div>

      {/* RED 指标 */}
      <div style={{ display: 'flex', gap: 6 }}>
        {[
          { label: 'Rate', zh: '速率', value: typeof red.rate === 'number' ? red.rate.toFixed(1) + '/m' : '—', color: '#3B82F6' },
          { label: 'Error', zh: '错误率', value: typeof red.errorRate === 'number' ? fmtPct(red.errorRate) : '—', color: red.errorRate > 0.1 ? '#EF4444' : '#10B981' },
          { label: 'Duration', zh: '耗时', value: typeof red.duration === 'number' ? fmtDuration(red.duration) : '—', color: '#F5A623' },
        ].map((m) => (
          <div key={m.label} style={{
            flex: 1, background: hexToRgba(m.color, 0.06),
            border: `1px solid ${hexToRgba(m.color, 0.15)}`,
            borderRadius: 6, padding: '5px 7px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 10, color: m.color, fontWeight: 600 }}>{m.label}</div>
            <div style={{ fontSize: 9, fontFamily: 'var(--font-zh)', color: '#6B7280' }}>{m.zh}</div>
            <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: '#E5E7EB', marginTop: 3 }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* 信号权重条 */}
      {signalEntries.length > 0 && (
        <div style={{ fontSize: 9, color: '#6B7280' }}>
          <div style={{ marginBottom: 2, fontWeight: 600, fontFamily: 'var(--font-zh)' }}>信号权重</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {signalEntries.slice(0, 7).map(([name, weight]) => (
              <span key={name} style={{
                padding: '1px 5px', borderRadius: 3,
                background: hexToRgba('#06B6D4', 0.1),
                fontSize: 8, color: '#9CA3AF',
              }}>
                {name}: <span style={{ color: '#06B6D4', fontWeight: 600 }}>{(weight * 100).toFixed(0)}%</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
