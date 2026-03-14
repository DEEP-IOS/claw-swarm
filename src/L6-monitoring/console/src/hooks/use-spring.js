/**
 * Spring Physics Hook / 弹簧物理 Hook
 *
 * 基于 spring-damper 模型的动画插值。
 * Spring-damper model for physics-based animation interpolation.
 *
 * 5 个预设: interaction / navigation / morphing / gentle / bounce
 *
 * @module hooks/use-spring
 * @author DEEP-IOS
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { springStep, SPRING_PRESETS } from '../utils/spring.js';

/**
 * Spring 动画 Hook
 *
 * @param {number} target - 目标值
 * @param {Object} [config] - Spring 配置
 * @param {number} [config.stiffness=170] - 刚度
 * @param {number} [config.damping=26] - 阻尼
 * @param {number} [config.mass=1] - 质量
 * @param {string} [config.preset] - 预设名 ('interaction'|'navigation'|'morphing'|'gentle'|'bounce')
 * @returns {{ value: number, velocity: number, isAnimating: boolean }}
 */
export function useSpring(target, config = {}) {
  const preset = config.preset ? SPRING_PRESETS[config.preset] : null;
  const stiffness = preset?.stiffness || config.stiffness || 170;
  const damping = preset?.damping || config.damping || 26;
  const mass = preset?.mass || config.mass || 1;

  const [value, setValue] = useState(target);
  const [isAnimating, setAnimating] = useState(false);
  const stateRef = useRef({ pos: target, vel: 0 });
  const targetRef = useRef(target);
  const rafRef = useRef(null);
  const lastTimeRef = useRef(null);

  const animate = useCallback(() => {
    const now = performance.now();
    const dt = lastTimeRef.current ? Math.min((now - lastTimeRef.current) / 1000, 0.064) : 0.016;
    lastTimeRef.current = now;

    const { pos, vel } = springStep(
      stateRef.current.pos, stateRef.current.vel,
      targetRef.current, stiffness, damping, mass, dt,
    );

    stateRef.current = { pos, vel };
    setValue(pos);

    // 收敛检测 / Convergence check
    if (Math.abs(pos - targetRef.current) < 0.001 && Math.abs(vel) < 0.001) {
      stateRef.current = { pos: targetRef.current, vel: 0 };
      setValue(targetRef.current);
      setAnimating(false);
      rafRef.current = null;
      return;
    }

    rafRef.current = requestAnimationFrame(animate);
  }, [stiffness, damping, mass]);

  useEffect(() => {
    targetRef.current = target;
    if (!isAnimating) {
      setAnimating(true);
      lastTimeRef.current = null;
      rafRef.current = requestAnimationFrame(animate);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, animate, isAnimating]);

  return { value, velocity: stateRef.current.vel, isAnimating };
}

export default useSpring;
