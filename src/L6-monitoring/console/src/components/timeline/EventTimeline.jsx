/**
 * Event Timeline with Replay controls.
 */
import React, { useEffect } from 'react';
import useStore from '../../store.js';
import { shortId, fmtTime } from '../../bridge/colors.js';

const EVENT_TYPES = {
  success:   { icon: 'OK',   color: '#10B981', label: 'Success',   zh: '成功' },
  warning:   { icon: 'WARN', color: '#F5A623', label: 'Warning',   zh: '警告' },
  error:     { icon: 'ERR',  color: '#EF4444', label: 'Error',     zh: '错误' },
  info:      { icon: 'INFO', color: '#3B82F6', label: 'Info',      zh: '信息' },
  alarm:     { icon: 'ALM',  color: '#EF4444', label: 'Alarm',     zh: '警报' },
  breaker:   { icon: 'BRK',  color: '#F5A623', label: 'Breaker',   zh: '断路器' },
  evolution: { icon: 'EVO',  color: '#8B5CF6', label: 'Evolution', zh: '进化' },
  quality:   { icon: 'QA',   color: '#10B981', label: 'Quality',   zh: '质检' },
  spawn:     { icon: 'SPN',  color: '#06B6D4', label: 'Spawn',     zh: '孵化' },
  task:      { icon: 'TSK',  color: '#3B82F6', label: 'Task',      zh: '任务' },
  mode:      { icon: 'MODE', color: '#F5A623', label: 'Mode',      zh: '模式' },
  default:   { icon: 'EVT',  color: '#6B7280', label: 'Event',     zh: '事件' },
};

function normalizeType(type) {
  if (type === 'warn') return 'warning';
  return type || 'default';
}

export default function EventTimeline() {
  const expanded = useStore((s) => s.timelineExpanded);
  const toggleTimeline = useStore((s) => s.toggleTimeline);
  const events = useStore((s) => s.timelineEvents) || [];

  const replayActive = useStore((s) => s.replayActive);
  const replayPlaying = useStore((s) => s.replayPlaying);
  const replaySpeed = useStore((s) => s.replaySpeed);
  const replayIndex = useStore((s) => s.replayIndex);
  const replaySnapshots = useStore((s) => s.replaySnapshots) || [];

  const enterReplay = useStore((s) => s.enterReplay);
  const exitReplay = useStore((s) => s.exitReplay);
  const setReplayPlaying = useStore((s) => s.setReplayPlaying);
  const setReplaySpeed = useStore((s) => s.setReplaySpeed);
  const seekReplay = useStore((s) => s.seekReplay);

  // Playback ticker
  useEffect(() => {
    if (!replayActive || !replayPlaying || replaySnapshots.length < 2) return undefined;
    const baseMs = 1000;
    const interval = Math.max(120, Math.round(baseMs / Math.max(0.25, replaySpeed || 1)));
    const timer = setInterval(() => {
      const s = useStore.getState();
      if (s.replayIndex >= s.replaySnapshots.length - 1) {
        s.setReplayPlaying(false);
        return;
      }
      s.seekReplay(s.replayIndex + 1);
    }, interval);
    return () => clearInterval(timer);
  }, [replayActive, replayPlaying, replaySpeed, replaySnapshots.length]);

  const previewEvents = events.slice(0, 20);
  const fullEvents = events.slice(0, 80);
  const snapshotCount = replaySnapshots.length;
  const sliderMax = Math.max(0, snapshotCount - 1);
  const canReplay = snapshotCount > 1;

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      height: expanded ? 220 : 32,
      background: '#111827', borderTop: '1px solid rgba(255,255,255,0.08)',
      transition: 'height 300ms cubic-bezier(0.4, 0, 0.2, 1)',
      zIndex: 100, overflow: 'hidden',
    }}>
      <div
        onClick={toggleTimeline}
        style={{
          height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', cursor: 'pointer', userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 10, color: '#4B5563',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 200ms',
          }}>▾</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#6B7280' }}>EVENT TIMELINE</span>
          <span style={{ fontSize: 9, color: '#4B5563', fontFamily: 'var(--font-zh)' }}>/ 事件时间线</span>
          {replayActive && (
            <span style={{
              fontSize: 9,
              color: '#F59E0B',
              border: '1px solid rgba(245,158,11,0.35)',
              background: 'rgba(245,158,11,0.12)',
              borderRadius: 10,
              padding: '1px 6px',
            }}>
              REPLAY
            </span>
          )}
        </div>

        {!expanded && (
          <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            {previewEvents.map((ev, i) => {
              const config = EVENT_TYPES[normalizeType(ev.type)] || EVENT_TYPES.default;
              return (
                <div key={ev.id || i} style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: config.color, opacity: 0.3 + (1 - i / 20) * 0.7,
                }} />
              );
            })}
            {events.length > 0 && (
              <span style={{ fontSize: 8, color: '#4B5563', marginLeft: 4 }}>
                {events.length} events
              </span>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div style={{ height: 188, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{
            padding: '6px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto',
            gap: 8,
            alignItems: 'center',
          }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {!replayActive ? (
                <button
                  onClick={(e) => { e.stopPropagation(); if (canReplay) enterReplay(); }}
                  disabled={!canReplay}
                  style={ctlBtn(canReplay ? '#3B82F6' : '#6B7280')}
                >
                  Enter Replay
                </button>
              ) : (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); setReplayPlaying(!replayPlaying); }}
                    style={ctlBtn('#3B82F6')}
                  >
                    {replayPlaying ? 'Pause' : 'Play'}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); exitReplay(); }}
                    style={ctlBtn('#EF4444')}
                  >
                    Exit
                  </button>
                </>
              )}
            </div>

            <input
              type="range"
              min={0}
              max={sliderMax}
              value={Math.min(replayIndex, sliderMax)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (!replayActive) enterReplay();
                seekReplay(next);
              }}
              disabled={!canReplay}
              style={{ width: '100%', accentColor: '#F59E0B' }}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 8, color: '#6B7280', width: 42, textAlign: 'right' }}>
                {snapshotCount ? `${Math.min(replayIndex + 1, snapshotCount)}/${snapshotCount}` : '0/0'}
              </span>
              <select
                value={replaySpeed}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setReplaySpeed(Number(e.target.value))}
                style={{
                  background: '#1F2937',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 4,
                  color: '#D1D5DB',
                  fontSize: 10,
                  padding: '2px 4px',
                }}
              >
                <option value={0.5}>0.5x</option>
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={4}>4x</option>
              </select>
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '4px 16px' }}>
            {fullEvents.length === 0 && (
              <div style={{ textAlign: 'center', color: '#4B5563', fontSize: 10, marginTop: 20 }}>
                No events yet / 暂无事件
              </div>
            )}
            {fullEvents.map((ev, i) => {
              const config = EVENT_TYPES[normalizeType(ev.type)] || EVENT_TYPES.default;
              const rawTitle = ev.title || ev.titleZh || ev.message || ev.body || '—';
              const title = typeof rawTitle === 'object' ? JSON.stringify(rawTitle) : String(rawTitle);
              return (
                <div key={ev.id || i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.02)',
                }}>
                  <span style={{ fontSize: 9, width: 28, textAlign: 'center', color: config.color, fontWeight: 700 }}>{config.icon}</span>
                  <span style={{ fontSize: 9, color: config.color, fontWeight: 600, width: 60 }}>
                    {config.label}
                  </span>
                  <span style={{
                    flex: 1, fontSize: 10, color: '#D1D5DB',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {title}
                  </span>
                  {ev.agentId && (
                    <span style={{ fontSize: 8, color: '#06B6D4', fontFamily: 'var(--font-mono)' }}>
                      {shortId(ev.agentId)}
                    </span>
                  )}
                  <span style={{ fontSize: 8, color: '#4B5563', fontFamily: 'var(--font-mono)', width: 56, textAlign: 'right' }}>
                    {fmtTime(ev.ts)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ctlBtn(color) {
  return {
    padding: '3px 8px',
    borderRadius: 4,
    border: `1px solid ${color}66`,
    background: `${color}1A`,
    color,
    fontSize: 10,
    fontWeight: 600,
    cursor: 'pointer',
  };
}
