/**
 * 动画帧钩子 / Animation Frame Hook
 *
 * requestAnimationFrame 循环封装,自动计算 delta-time。
 * Wraps requestAnimationFrame loop with automatic delta-time calculation.
 *
 * @module console/hooks/useAnimationFrame
 * @author DEEP-IOS
 */
import { useRef, useEffect } from 'react';

/**
 * @param {(dt: number, time: number) => void} callback
 *   dt   — 距上帧毫秒数 / Milliseconds since last frame
 *   time — 高精度时间戳 / High-resolution timestamp
 */
export function useAnimationFrame(callback) {
  const reqRef  = useRef();
  const prevRef = useRef();

  useEffect(() => {
    const animate = (time) => {
      if (prevRef.current !== undefined) {
        const dt = time - prevRef.current;
        callback(dt, time);
      }
      prevRef.current = time;
      reqRef.current = requestAnimationFrame(animate);
    };
    reqRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(reqRef.current);
  }, [callback]);
}
