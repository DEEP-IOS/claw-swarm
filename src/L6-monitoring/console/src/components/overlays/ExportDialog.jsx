import React from 'react';
import useStore from '../../store.js';
import { exportStateJSON, exportTimelineCSV } from '../../utils/exporters.js';

export default function ExportDialog({ onExportPng }) {
  const open = useStore((s) => s.exportDialogOpen);
  const setOpen = useStore((s) => s.setExportDialogOpen);
  const timelineEvents = useStore((s) => s.timelineEvents) || [];
  const addNotification = useStore((s) => s.addNotification);

  if (!open) return null;

  const exportJson = () => {
    exportStateJSON(useStore.getState());
    addNotification?.({ type: 'success', title: 'State Exported', titleZh: '状态已导出' });
  };

  const exportCsv = () => {
    exportTimelineCSV(timelineEvents);
    addNotification?.({ type: 'success', title: 'Events Exported', titleZh: '事件已导出' });
  };

  const exportPng = () => {
    const ok = onExportPng?.();
    if (ok) {
      addNotification?.({ type: 'success', title: 'Screenshot Exported', titleZh: '截图已导出' });
    } else {
      addNotification?.({ type: 'warning', title: 'Screenshot Unavailable', titleZh: '截图不可用' });
    }
  };

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 960,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          right: 16,
          top: 56,
          width: 300,
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.1)',
          background: '#111827',
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#E5E7EB' }}>Export</div>
          <div style={{ fontSize: 10, color: '#6B7280' }}>导出</div>
        </div>

        <div style={{ padding: 10, display: 'grid', gap: 8 }}>
          <button
            onClick={exportPng}
            style={btnStyle('#3B82F6')}
          >
            Export PNG (Ctrl+Shift+S)
          </button>
          <button
            onClick={exportJson}
            style={btnStyle('#10B981')}
          >
            Export JSON (Ctrl+Shift+E)
          </button>
          <button
            onClick={exportCsv}
            style={btnStyle('#F59E0B')}
          >
            Export Events CSV
          </button>
        </div>
      </div>
    </div>
  );
}

function btnStyle(color) {
  return {
    width: '100%',
    padding: '9px 10px',
    borderRadius: 6,
    border: `1px solid ${color}66`,
    background: `${color}1A`,
    color,
    fontSize: 11,
    fontWeight: 600,
    textAlign: 'left',
    cursor: 'pointer',
  };
}
