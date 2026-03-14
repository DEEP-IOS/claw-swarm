/**
 * 形变过渡容器 / Morph Transition Container
 *
 * 包裹视图切换, 管理 DOM 元素的形变动画。
 * 使用 spring 物理插值 + CSS transition 混合。
 *
 * @module components/MorphTransition
 * @author DEEP-IOS
 */
import React, { useEffect, useRef, useState } from 'react';
import useStore from '../store.js';
import { VIEW_TINTS, hexToRgba } from '../bridge/colors.js';

/**
 * @param {{ children: React.ReactNode }} props
 */
export default function MorphTransitionContainer({ children }) {
  const view = useStore((s) => s.view);
  const prevView = useStore((s) => s.prevView);
  const [transitioning, setTransitioning] = useState(false);
  const [opacity, setOpacity] = useState(1);
  const [transform, setTransform] = useState('translate3d(0,0,0) scale(1)');
  const containerRef = useRef(null);

  // 视图切换时触发过渡 / Trigger transition on view change
  useEffect(() => {
    if (prevView && prevView !== view) {
      setTransitioning(true);
      setOpacity(0);
      setTransform('translate3d(0, 8px, 0) scale(0.985)');

      // 淡入新视图 / Fade in new view
      const timer = setTimeout(() => {
        setOpacity(1);
        setTransform('translate3d(0, 0, 0) scale(1)');
      }, 50);

      // 结束过渡 / End transition
      const endTimer = setTimeout(() => {
        setTransitioning(false);
      }, 400);

      return () => {
        clearTimeout(timer);
        clearTimeout(endTimer);
      };
    }
  }, [view, prevView]);

  const viewColor = VIEW_TINTS[view] || '#F5A623';

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative', width: '100%', height: '100%',
        opacity,
        transform,
        transition: 'opacity 350ms cubic-bezier(0.4, 0, 0.2, 1), transform 420ms cubic-bezier(0.16, 1, 0.3, 1)',
        willChange: 'opacity, transform',
      }}
    >
      {/* 过渡时的背景色闪烁 / Background color flash during transition */}
      {transitioning && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          background: hexToRgba(viewColor, 0.03),
          pointerEvents: 'none',
          animation: 'morphFlash 400ms ease-out forwards',
        }} />
      )}

      {children}
    </div>
  );
}
