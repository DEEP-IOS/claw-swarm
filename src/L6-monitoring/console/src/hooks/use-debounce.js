/**
 * Debounce Hook / 防抖 Hook
 *
 * @module hooks/use-debounce
 * @author DEEP-IOS
 */
import { useState, useEffect } from 'react';

/**
 * 防抖值 / Debounced value
 * @template T
 * @param {T} value - 输入值
 * @param {number} [delay=300] - 延迟毫秒
 * @returns {T} 防抖后的值
 */
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

export default useDebounce;
