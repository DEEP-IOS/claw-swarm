/**
 * 增强 Tooltip 组件 / Enhanced Tooltip Component
 *
 * 结构: 英文标题 [icon] / 中文标题 / 描述 / 次要数据 (最多 3 行)
 * 定位: 智能避屏边缘
 *
 * @module components/ui/Tooltip
 * @author DEEP-IOS
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';

const TOOLTIP_OFFSET = 8;
const EDGE_MARGIN = 12;

/**
 * @param {{
 *   children: React.ReactNode,
 *   title?: string,
 *   titleZh?: string,
 *   icon?: string,
 *   description?: string,
 *   data?: Array<{ label: string, value: string }>,
 *   position?: 'top'|'bottom'|'left'|'right'|'auto',
 *   color?: string,
 *   disabled?: boolean,
 * }} props
 */
export default function Tooltip({
  children, title, titleZh, icon, description,
  data, position = 'auto', color = '#F5A623', disabled = false,
}) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const timeoutRef = useRef(null);

  const show = useCallback(() => {
    if (disabled) return;
    timeoutRef.current = setTimeout(() => setVisible(true), 300);
  }, [disabled]);

  const hide = useCallback(() => {
    clearTimeout(timeoutRef.current);
    setVisible(false);
  }, []);

  // 计算位置 / Calculate position
  useEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = 0, left = 0;

    // 自动定位 / Auto positioning
    const effectivePos = position === 'auto'
      ? (triggerRect.top > vh / 2 ? 'top' : 'bottom')
      : position;

    switch (effectivePos) {
      case 'top':
        top = triggerRect.top - tooltipRect.height - TOOLTIP_OFFSET;
        left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
        break;
      case 'bottom':
        top = triggerRect.bottom + TOOLTIP_OFFSET;
        left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
        break;
      case 'left':
        top = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
        left = triggerRect.left - tooltipRect.width - TOOLTIP_OFFSET;
        break;
      case 'right':
        top = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
        left = triggerRect.right + TOOLTIP_OFFSET;
        break;
    }

    // 避免超出视口 / Clamp to viewport
    left = Math.max(EDGE_MARGIN, Math.min(left, vw - tooltipRect.width - EDGE_MARGIN));
    top = Math.max(EDGE_MARGIN, Math.min(top, vh - tooltipRect.height - EDGE_MARGIN));

    setPos({ top, left });
  }, [visible, position]);

  const hasContent = title || titleZh || description || (data && data.length > 0);
  if (!hasContent) {
    return <>{children}</>;
  }

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        style={{ display: 'inline-flex' }}
      >
        {children}
      </span>

      {visible && (
        <div
          ref={tooltipRef}
          role="tooltip"
          style={{
            position: 'fixed',
            top: pos.top, left: pos.left,
            zIndex: 5000,
            background: '#1F2937',
            border: `1px solid rgba(255,255,255,0.12)`,
            borderRadius: 8,
            padding: '8px 12px',
            maxWidth: 280, minWidth: 140,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
            animation: 'fadeIn 100ms ease-out',
          }}
        >
          {/* 标题行 / Title row */}
          {(title || icon) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: titleZh ? 0 : 4 }}>
              {icon && <span style={{ fontSize: 12 }}>{icon}</span>}
              <span style={{ fontSize: 11, fontWeight: 600, color }}>
                {title}
              </span>
            </div>
          )}

          {/* 中文标题 / Chinese title */}
          {titleZh && (
            <div style={{ fontSize: 9, color: '#6B7280', fontFamily: 'var(--font-zh)', marginBottom: 4 }}>
              {titleZh}
            </div>
          )}

          {/* 描述 / Description */}
          {description && (
            <div style={{ fontSize: 10, color: '#D1D5DB', lineHeight: 1.4, marginBottom: data ? 4 : 0 }}>
              {description}
            </div>
          )}

          {/* 数据行 / Data rows */}
          {data && data.length > 0 && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 3, marginTop: 2 }}>
              {data.slice(0, 3).map((d, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between',
                  fontSize: 9, padding: '1px 0',
                }}>
                  <span style={{ color: '#6B7280' }}>{d.label}</span>
                  <span style={{ color: '#E5E7EB', fontFamily: 'var(--font-mono)' }}>{d.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
