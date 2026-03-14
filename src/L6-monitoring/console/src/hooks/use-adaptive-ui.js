/**
 * 自适应 UI Hook / Adaptive UI Hook
 *
 * - 30s 无操作 → 节能模式 (降低帧率, 减少粒子)
 * - 鼠标移动 → 200ms 内唤醒
 * - 频繁点击某 Agent → Inspector 自动保持展开
 * - 频繁展开某折叠区 → 下次自动展开
 * - 屏幕空间不足 → 自动折叠低优先级面板
 *
 * @module hooks/use-adaptive-ui
 * @author DEEP-IOS
 */
import { useState, useEffect, useRef, useCallback } from 'react';

const IDLE_TIMEOUT = 30000;     // 30s 无操作进入节能
const WAKE_DELAY = 200;          // 200ms 唤醒延迟
const CLICK_MEMORY_SIZE = 10;    // 记忆最近 10 次点击
const FREQUENT_THRESHOLD = 3;    // 3 次以上视为频繁

/**
 * @typedef {Object} AdaptiveState
 * @property {boolean} isIdle - 是否空闲 / Is idle
 * @property {boolean} powerSave - 节能模式 / Power save mode
 * @property {number} targetFps - 目标帧率 / Target FPS
 * @property {number} particleMultiplier - 粒子数量倍率 / Particle multiplier
 * @property {Set<string>} frequentAgents - 频繁点击的 Agent / Frequently clicked agents
 * @property {Set<string>} autoExpandSections - 自动展开的折叠区 / Auto-expand sections
 * @property {boolean} compactMode - 紧凑模式 / Compact mode (narrow screen)
 */

/**
 * @returns {AdaptiveState & { recordClick: Function, recordSectionOpen: Function }}
 */
export function useAdaptiveUI() {
  const [isIdle, setIsIdle] = useState(false);
  const [powerSave, setPowerSave] = useState(false);
  const [compactMode, setCompactMode] = useState(false);

  const idleTimerRef = useRef(null);
  const clickHistoryRef = useRef([]);
  const sectionHistoryRef = useRef({});
  const wakeTimerRef = useRef(null);

  // ── 空闲检测 / Idle detection ──
  const resetIdle = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

    // 唤醒 (如果处于节能模式) / Wake up from power save
    if (powerSave) {
      if (!wakeTimerRef.current) {
        wakeTimerRef.current = setTimeout(() => {
          setPowerSave(false);
          setIsIdle(false);
          wakeTimerRef.current = null;
        }, WAKE_DELAY);
      }
    } else {
      setIsIdle(false);
    }

    idleTimerRef.current = setTimeout(() => {
      setIsIdle(true);
      setPowerSave(true);
    }, IDLE_TIMEOUT);
  }, [powerSave]);

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((e) => window.addEventListener(e, resetIdle, { passive: true }));

    // 初始化空闲定时器
    idleTimerRef.current = setTimeout(() => {
      setIsIdle(true);
      setPowerSave(true);
    }, IDLE_TIMEOUT);

    return () => {
      events.forEach((e) => window.removeEventListener(e, resetIdle));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (wakeTimerRef.current) clearTimeout(wakeTimerRef.current);
    };
  }, [resetIdle]);

  // ── 屏幕尺寸检测 / Screen size detection ──
  useEffect(() => {
    const check = () => setCompactMode(window.innerWidth < 1280);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ── 记录 Agent 点击 / Record agent click ──
  const recordClick = useCallback((agentId) => {
    clickHistoryRef.current = [
      agentId,
      ...clickHistoryRef.current.filter((id) => id !== agentId),
    ].slice(0, CLICK_MEMORY_SIZE);
  }, []);

  // ── 记录折叠区展开 / Record section open ──
  const recordSectionOpen = useCallback((sectionKey) => {
    const count = (sectionHistoryRef.current[sectionKey] || 0) + 1;
    sectionHistoryRef.current[sectionKey] = count;
  }, []);

  // ── 频繁 Agent 计算 / Frequent agents ──
  const frequentAgents = new Set();
  const counts = {};
  for (const id of clickHistoryRef.current) {
    counts[id] = (counts[id] || 0) + 1;
    if (counts[id] >= FREQUENT_THRESHOLD) frequentAgents.add(id);
  }

  // ── 自动展开折叠区 / Auto-expand sections ──
  const autoExpandSections = new Set();
  for (const [key, count] of Object.entries(sectionHistoryRef.current)) {
    if (count >= FREQUENT_THRESHOLD) autoExpandSections.add(key);
  }

  return {
    isIdle,
    powerSave,
    targetFps: powerSave ? 30 : 60,
    particleMultiplier: powerSave ? 0.3 : 1.0,
    frequentAgents,
    autoExpandSections,
    compactMode,
    recordClick,
    recordSectionOpen,
  };
}

export default useAdaptiveUI;
