import React from 'react';

export default function MobileDrawer({
  enabled,
  pane,
  onPane,
  onClose,
  leftContent,
  rightContent,
}) {
  if (!enabled) return null;

  return (
    <>
      <div style={{
        position: 'fixed',
        right: 10,
        bottom: 44,
        zIndex: 930,
        display: 'flex',
        gap: 6,
      }}>
        <button onClick={() => onPane('agents')} style={fabStyle(pane === 'agents')}>
          Agents
        </button>
        <button onClick={() => onPane('inspector')} style={fabStyle(pane === 'inspector')}>
          Inspector
        </button>
        {pane && (
          <button onClick={onClose} style={fabStyle(false, '#EF4444')}>
            Close
          </button>
        )}
      </div>

      {pane && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 920,
            background: 'rgba(0,0,0,0.35)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 32,
              height: '55vh',
              background: '#111827',
              borderTop: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '12px 12px 0 0',
              overflow: 'auto',
              boxShadow: '0 -16px 40px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{
              padding: '8px 12px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              fontSize: 11,
              color: '#9CA3AF',
              fontWeight: 600,
            }}>
              {pane === 'agents' ? 'Agents / 代理' : 'Inspector / 检视'}
            </div>
            <div>
              {pane === 'agents' ? leftContent : rightContent}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function fabStyle(active, dangerColor = '#3B82F6') {
  return {
    padding: '6px 10px',
    borderRadius: 8,
    border: `1px solid ${active ? `${dangerColor}AA` : 'rgba(255,255,255,0.18)'}`,
    background: active ? `${dangerColor}22` : 'rgba(17,24,39,0.72)',
    color: active ? dangerColor : '#D1D5DB',
    fontSize: 10,
    fontWeight: 600,
    cursor: 'pointer',
    backdropFilter: 'blur(6px)',
  };
}
