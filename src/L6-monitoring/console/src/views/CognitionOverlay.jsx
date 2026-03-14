/**
 * 认知视图覆盖层 / Cognition View Overlay
 *
 * V7.0 完整实现:
 *   - 工作记忆层 (前额叶): Focus/Context/Scratch 节点
 *   - 情景记忆层 (海马体): 事件卡时间线
 *   - 语义记忆层 (新皮质): 知识图谱网络
 *   - 巩固箭头: 上→下层流动
 *   - 底部: 注意力公式 + 检索公式
 *
 * @module console/views/CognitionOverlay
 * @author DEEP-IOS
 */
import React from 'react';
import useStore from '../store.js';
import { hexToRgba, shortId } from '../bridge/colors.js';

const LAYERS = [
  { key: 'working',  color: '#F5A623', en: 'Working Memory',  zh: '工作记忆', region: 'Prefrontal / 前额叶', icon: '◉' },
  { key: 'episodic', color: '#8B5CF6', en: 'Episodic Memory', zh: '情景记忆', region: 'Hippocampus / 海马体', icon: '◈' },
  { key: 'semantic', color: '#06B6D4', en: 'Semantic Memory',  zh: '语义记忆', region: 'Neocortex / 新皮质', icon: '◇' },
];

const WM_TYPES = [
  { name: 'Focus',   count: 5,  opacity: 1.0 },
  { name: 'Context', count: 15, opacity: 0.6 },
  { name: 'Scratch', count: 30, opacity: 0.3 },
];

export default function CognitionOverlay() {
  const agents = useStore((s) => s.agents);
  const knowledge = useStore((s) => s.knowledge);

  const focusAgents = agents.filter((a) => a.state === 'EXECUTING').slice(0, 5);
  const contextAgents = agents.filter((a) => a.state === 'ACTIVE').slice(0, 15);
  const scratchAgents = agents.filter((a) => a.state === 'IDLE').slice(0, 30);
  const recentEvents = (knowledge || []).slice(-6);

  return (
    <div style={{ pointerEvents: 'none', padding: 12, height: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {LAYERS.map((layer, idx) => (
        <React.Fragment key={layer.key}>
          <div style={{
            flex: 1, background: hexToRgba(layer.color, 0.05),
            border: `1px solid ${hexToRgba(layer.color, 0.2)}`, borderRadius: 8,
            padding: '8px 12px', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            {/* 头部 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14, color: layer.color }}>{layer.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: layer.color }}>{layer.en}</span>
                <span style={{ fontSize: 10, fontFamily: 'var(--font-zh)', color: layer.color, opacity: 0.6 }}>/ {layer.zh}</span>
              </div>
              <span style={{ fontSize: 8, color: '#6B7280' }}>{layer.region}</span>
            </div>

            {/* 工作记忆内容 */}
            {layer.key === 'working' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {WM_TYPES.map((wm) => {
                  const items = wm.name === 'Focus' ? focusAgents : wm.name === 'Context' ? contextAgents : scratchAgents;
                  return (
                    <div key={wm.name} style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: wm.opacity }}>
                      <span style={{ fontSize: 8, color: layer.color, width: 42, textAlign: 'right', fontWeight: 600 }}>{wm.name}</span>
                      <div style={{ display: 'flex', gap: 2, flex: 1, flexWrap: 'wrap' }}>
                        {items.map((a) => (
                          <div key={a.id} style={{ width: 6, height: 6, borderRadius: '50%', background: layer.color, opacity: wm.opacity }} title={shortId(a.id)} />
                        ))}
                        {items.length === 0 && <span style={{ fontSize: 8, color: '#4B5563' }}>—</span>}
                      </div>
                      <span style={{ fontSize: 7, color: '#4B5563' }}>{items.length}/{wm.count}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 情景记忆内容 */}
            {layer.key === 'episodic' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, overflow: 'auto' }}>
                {recentEvents.length === 0 && (
                  <div style={{ fontSize: 9, color: '#4B5563', textAlign: 'center', marginTop: 4 }}>No events / 暂无事件</div>
                )}
                {recentEvents.map((ev, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: 4, alignItems: 'center', fontSize: 9, color: '#D1D5DB',
                    padding: '2px 4px', borderRadius: 3, background: hexToRgba(layer.color, 0.08),
                    opacity: 0.4 + (i / recentEvents.length) * 0.6,
                  }}>
                    <span style={{ color: layer.color, fontWeight: 600 }}>{shortId(ev.from || '')}</span>
                    <span style={{ color: '#6B7280' }}>→</span>
                    <span style={{ color: '#10B981' }}>{shortId(ev.to || '')}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 8, color: '#6B7280' }}>{ev.content || ''}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 语义记忆内容 */}
            {layer.key === 'semantic' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, justifyContent: 'center' }}>
                  {agents.slice(0, 12).map((a) => (
                    <div key={a.id} style={{
                      padding: '2px 6px', borderRadius: 10,
                      border: `1px solid ${hexToRgba(layer.color, 0.3)}`,
                      background: hexToRgba(layer.color, 0.08),
                      fontSize: 8, color: layer.color,
                    }}>{shortId(a.id)}</div>
                  ))}
                </div>
                <div style={{ fontSize: 8, color: '#4B5563', textAlign: 'center', marginTop: 2 }}>
                  {agents.length} nodes / 节点
                </div>
              </div>
            )}
          </div>

          {idx < LAYERS.length - 1 && (
            <div style={{ textAlign: 'center', fontSize: 12, color: '#4B5563', lineHeight: 1, padding: '1px 0' }}>
              ⬇ consolidation
            </div>
          )}
        </React.Fragment>
      ))}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', fontSize: 8, color: '#4B5563', fontFamily: 'var(--font-mono)', padding: '2px 0' }}>
        <span>Attn = softmax(QK&#x1D40;/&#x221A;d)V</span>
        <span>|</span>
        <span>Score = &#x3A3;(&#x3B1;&#x1D62;&#xB7;f&#x1D62;)</span>
      </div>
    </div>
  );
}
