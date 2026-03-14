/**
 * Media Query Hook / 媒体查询 Hook
 *
 * 监听 prefers-reduced-motion / prefers-color-scheme 等。
 *
 * @module hooks/use-media-query
 * @author DEEP-IOS
 */
import { useState, useEffect } from 'react';

/**
 * 通用媒体查询 Hook
 * @param {string} query - CSS media query string
 * @returns {boolean}
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/** 是否偏好减少动画 / Prefers reduced motion */
export function useReducedMotion() {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/** 是否偏好暗色模式 / Prefers dark color scheme */
export function useDarkMode() {
  return useMediaQuery('(prefers-color-scheme: dark)');
}

export default useMediaQuery;
