import React from 'react';

export default function EmptyStateGuide({ sseConnected, onStartDemo }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 8,
      }}
    >
      <div
        style={{
          width: 520,
          maxWidth: '92vw',
          borderRadius: 14,
          border: '1px solid rgba(245,166,35,0.3)',
          background: 'linear-gradient(160deg, rgba(31,41,55,0.9), rgba(15,23,42,0.86))',
          boxShadow: '0 14px 38px rgba(0,0,0,0.35)',
          padding: '18px 20px',
          pointerEvents: 'auto',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: '#F5A623', fontFamily: 'var(--font-zh)' }}>
          控制台当前空闲
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: '#D1D5DB', lineHeight: 1.6, fontFamily: 'var(--font-zh)' }}>
          {sseConnected
            ? 'SSE 已连接，等待蜂群任务启动。向 Agent 发送消息后，此处将实时显示蜂群活动数据。'
            : 'SSE 未连接。请确认插件监控服务已启动（dashboard.enabled: true），或进入演示模式预览。'}
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={onStartDemo}
            style={{
              borderRadius: 6,
              border: '1px solid rgba(245,166,35,0.45)',
              background: 'rgba(245,166,35,0.14)',
              color: '#FCD34D',
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--font-zh)',
            }}
          >
            启动演示模式（模拟数据）
          </button>
          <div style={{ fontSize: 11, color: '#6B7280', alignSelf: 'center', fontFamily: 'var(--font-zh)' }}>
            提示：演示模式使用模拟数据，非真实蜂群数据
          </div>
        </div>
      </div>
    </div>
  );
}
