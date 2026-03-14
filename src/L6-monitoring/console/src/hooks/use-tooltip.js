/**
 * Tooltip Hook / 提示工具 Hook
 *
 * 提供 Tooltip 定位和显隐逻辑, 智能避屏边缘。
 * Provides Tooltip positioning and visibility, auto-avoiding viewport edges.
 *
 * @module hooks/use-tooltip
 * @author DEEP-IOS
 */
import { useState, useCallback, useRef } from 'react';

const MARGIN = 8;
const TOOLTIP_W = 260;
const TOOLTIP_H = 120;

/**
 * @returns {{ tooltipProps, showTooltip, hideTooltip, isVisible }}
 */
export function useTooltip() {
  const [state, setState] = useState({ visible: false, x: 0, y: 0, data: null });
  const timerRef = useRef(null);

  const showTooltip = useCallback((e, data, delay = 300) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let x = e.clientX + 12;
      let y = e.clientY + 12;

      // 避免溢出右侧 / Avoid right overflow
      if (x + TOOLTIP_W + MARGIN > vw) x = e.clientX - TOOLTIP_W - 12;
      // 避免溢出底部 / Avoid bottom overflow
      if (y + TOOLTIP_H + MARGIN > vh) y = e.clientY - TOOLTIP_H - 12;
      // 避免溢出左侧/顶部 / Avoid left/top overflow
      x = Math.max(MARGIN, x);
      y = Math.max(MARGIN, y);

      setState({ visible: true, x, y, data });
    }, delay);
  }, []);

  const hideTooltip = useCallback(() => {
    clearTimeout(timerRef.current);
    setState((s) => ({ ...s, visible: false }));
  }, []);

  const tooltipProps = {
    style: {
      position: 'fixed',
      left: state.x,
      top: state.y,
      display: state.visible ? 'block' : 'none',
      pointerEvents: 'none',
      zIndex: 9999,
    },
    data: state.data,
  };

  return { tooltipProps, showTooltip, hideTooltip, isVisible: state.visible };
}

export default useTooltip;
