/**
 * Settings Drawer
 */
import React from 'react';
import useStore from '../../store.js';

const SETTINGS = [
  { key: 'animSpeed',       type: 'range',  label: 'Animation Speed',   zh: '动画速度', min: 0.1, max: 3, step: 0.1 },
  { key: 'particleDensity', type: 'range',  label: 'Particle Density',  zh: '粒子密度', min: 0.1, max: 2, step: 0.1 },
  { key: 'showTrails',      type: 'toggle', label: 'Show Trails',       zh: '显示轨迹' },
  { key: 'showEdges',       type: 'toggle', label: 'Interaction Beams', zh: '交互光线' },
  { key: 'showSubAgents',   type: 'toggle', label: 'Sub-Agent Orbits',  zh: '子代理轨道' },
  { key: 'showFormulas',    type: 'toggle', label: 'Formula Display',   zh: '公式显示' },
  { key: 'sound',           type: 'toggle', label: 'Sound Effects',     zh: '音效' },
  { key: 'envParticles',    type: 'toggle', label: 'Ambient Particles', zh: '环境粒子' },
  { key: 'glitchFx',        type: 'toggle', label: 'Glitch Effects',    zh: '故障特效' },
  { key: 'perfMode',        type: 'toggle', label: 'Performance Mode',  zh: '性能模式' },
  {
    key: 'labelMode',
    type: 'select',
    label: 'Label Language',
    zh: '标签语言',
    options: [
      { value: 'en', label: 'English' },
      { value: 'zh', label: '中文' },
      { value: 'bilingual', label: 'Bilingual / 双语' },
    ],
  },
];

const COLORBLIND_OPTIONS = [
  { value: 'none', label: 'None / 无' },
  { value: 'deuteranopia', label: 'Deuteranopia / 红绿色盲' },
  { value: 'protanopia', label: 'Protanopia / 红色盲' },
  { value: 'tritanopia', label: 'Tritanopia / 蓝黄色盲' },
];

function Toggle({ value, onChange }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        width: 32,
        height: 18,
        borderRadius: 9,
        background: value ? '#10B981' : '#374151',
        cursor: 'pointer',
        padding: 2,
        transition: 'background 150ms',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          transform: value ? 'translateX(14px)' : 'translateX(0)',
          transition: 'transform 150ms',
        }}
      />
    </div>
  );
}

export default function SettingsDrawer() {
  const open = useStore((s) => s.settingsPanelOpen);
  const toggleSettings = useStore((s) => s.toggleSettings);
  const settings = useStore((s) => s.settings) || {};
  const updateSettings = useStore((s) => s.updateSettings);

  if (!open) return null;

  const getValue = (key) => settings[key];
  const setValue = (key, val) => updateSettings?.({ [key]: val });

  return (
    <div
      onClick={toggleSettings}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 950,
        background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 320,
          maxWidth: '90vw',
          background: '#111827',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          overflow: 'auto',
          animation: 'slideInRight 200ms ease-out',
        }}
      >
        <div
          style={{
            padding: '16px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#E5E7EB' }}>Settings</div>
            <div style={{ fontSize: 11, color: '#6B7280', fontFamily: 'var(--font-zh)' }}>设置</div>
          </div>
          <button
            onClick={toggleSettings}
            style={{
              background: 'rgba(107,114,128,0.1)',
              border: '1px solid rgba(107,114,128,0.2)',
              borderRadius: 4,
              color: '#9CA3AF',
              fontSize: 12,
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            x
          </button>
        </div>

        <div style={{ padding: '8px 16px' }}>
          {SETTINGS.map((s) => (
            <div
              key={s.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 0',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: '#D1D5DB' }}>{s.label}</div>
                <div style={{ fontSize: 9, color: '#4B5563', fontFamily: 'var(--font-zh)' }}>{s.zh}</div>
              </div>

              {s.type === 'toggle' && (
                <Toggle value={!!getValue(s.key)} onChange={(v) => setValue(s.key, v)} />
              )}
              {s.type === 'range' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="range"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={getValue(s.key) ?? 1}
                    onChange={(e) => setValue(s.key, parseFloat(e.target.value))}
                    style={{ width: 80, accentColor: '#F5A623' }}
                  />
                  <span
                    style={{
                      fontSize: 9,
                      color: '#6B7280',
                      fontFamily: 'var(--font-mono)',
                      width: 24,
                      textAlign: 'right',
                    }}
                  >
                    {(getValue(s.key) ?? 1).toFixed(1)}
                  </span>
                </div>
              )}
              {s.type === 'select' && (
                <select
                  value={getValue(s.key) || s.options[0].value}
                  onChange={(e) => setValue(s.key, e.target.value)}
                  style={{
                    background: '#1F2937',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 4,
                    color: '#D1D5DB',
                    fontSize: 10,
                    padding: '2px 6px',
                  }}
                >
                  {s.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>

        <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: 11, color: '#D1D5DB', marginBottom: 4 }}>Colorblind Mode</div>
          <div style={{ fontSize: 9, color: '#4B5563', fontFamily: 'var(--font-zh)', marginBottom: 6 }}>色盲模式</div>
          <select
            value={getValue('colorBlindMode') || 'none'}
            onChange={(e) => setValue('colorBlindMode', e.target.value)}
            style={{
              width: '100%',
              background: '#1F2937',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 4,
              color: '#D1D5DB',
              fontSize: 11,
              padding: '6px 8px',
            }}
          >
            {COLORBLIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <button
            onClick={() => {
              try {
                localStorage.removeItem('swarm-console-onboarded');
              } catch {
                // ignore
              }
              toggleSettings();
            }}
            style={{
              width: '100%',
              padding: '8px',
              background: 'rgba(59,130,246,0.1)',
              border: '1px solid rgba(59,130,246,0.2)',
              borderRadius: 6,
              color: '#3B82F6',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Re-trigger Onboarding / 重新触发引导
          </button>
        </div>
      </div>
    </div>
  );
}
