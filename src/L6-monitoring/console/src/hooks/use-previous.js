/**
 * Previous Value Hook / 前值 Hook
 *
 * 记住上一次渲染的值, 用于形变过渡比较。
 *
 * @module hooks/use-previous
 * @author DEEP-IOS
 */
import { useRef, useEffect } from 'react';

/**
 * @template T
 * @param {T} value - 当前值
 * @returns {T|undefined} 上一次的值
 */
export function usePrevious(value) {
  const ref = useRef();
  useEffect(() => { ref.current = value; });
  return ref.current;
}

export default usePrevious;
