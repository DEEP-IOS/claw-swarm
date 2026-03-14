/**
 * Theme Provider / 主题提供者
 *
 * 注入色盲模式 CSS class + reduced-motion 响应。
 *
 * @module themes/ThemeProvider
 * @author DEEP-IOS
 */
import React, { useEffect } from 'react';
import useStore from '../store.js';

/**
 * ThemeProvider 组件
 *
 * 根据 settings.colorBlindMode 在 <html> 上添加对应 CSS class。
 * 根据 prefers-reduced-motion 添加 'reduced-motion' class。
 *
 * @param {{ children: React.ReactNode }} props
 */
export default function ThemeProvider({ children }) {
  const colorBlindMode = useStore((s) => s.settings.colorBlindMode);
  const perfMode = useStore((s) => s.settings.perfMode);

  useEffect(() => {
    const html = document.documentElement;

    // 色盲模式 / Colorblind mode
    html.classList.remove('deuteranopia', 'protanopia', 'tritanopia');
    if (colorBlindMode && colorBlindMode !== 'none') {
      html.classList.add(colorBlindMode);
    }

    // 性能模式 / Performance mode
    html.classList.toggle('perf-mode', !!perfMode);

    return () => {
      html.classList.remove('deuteranopia', 'protanopia', 'tritanopia', 'perf-mode');
    };
  }, [colorBlindMode, perfMode]);

  // reduced-motion 媒体查询
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e) => {
      document.documentElement.classList.toggle('reduced-motion', e.matches);
    };
    handler(mql);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return <>{children}</>;
}
