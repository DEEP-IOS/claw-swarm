/**
 * ResizeObserver Hook / 响应式尺寸监听 Hook
 *
 * @module hooks/use-resize-observer
 * @author DEEP-IOS
 */
import { useEffect, useState, useRef } from 'react';

/**
 * 监听元素尺寸变化 / Watch element size changes
 * @param {React.RefObject} [externalRef] - 外部 ref (可选)
 * @returns {{ ref, width, height }}
 */
export function useResizeObserver(externalRef) {
  const internalRef = useRef(null);
  const ref = externalRef || internalRef;
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize({ width, height });
      }
    });

    observer.observe(el);
    // 初始尺寸 / Initial size
    const rect = el.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });

    return () => observer.disconnect();
  }, [ref]);

  return { ref, ...size };
}

export default useResizeObserver;
