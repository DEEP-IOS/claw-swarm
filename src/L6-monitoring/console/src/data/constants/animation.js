/**
 * 动画常量 / Animation Constants
 *
 * Disney 12 原则参数 + Spring 预设 + 时间常量
 *
 * @module constants/animation
 * @author DEEP-IOS
 */

/** Disney 压缩拉伸比例 / Squash-Stretch Ratios */
export const SQUASH_CLICK = 0.90;       // 点击时压缩到 90%
export const STRETCH_CLICK = 1.05;      // 回弹到 105%
export const SQUASH_ANTICIPATION = 0.95; // 预备动作缩小 5%

/** 时间常量 (ms) / Timing Constants */
export const TIMING = {
  urgent: 100,        // 紧急 (alarm 闪烁)
  fast: 200,          // 快速 (状态切换)
  normal: 500,        // 正常 (飞行/过渡)
  slow: 1000,         // 慢速 (面板展开)
  breathing: 2000,    // 呼吸 (空闲脉冲)
  morph: 800,         // 形变过渡
};

/** 帧率 / Frame Rates */
export const FPS = {
  physics: 30,        // Boids 物理更新
  render: 60,         // 渲染帧率
  perfMode: 30,       // 性能模式渲染帧率
};

/** 粒子预算 / Particle Budget */
export const PARTICLE_BUDGET = {
  max: 500,           // 最大粒子数
  perfMode: 100,      // 性能模式最大粒子数
  perAgent: 3,        // 每个 Agent 的粒子数
  burst: 12,          // 状态变化爆发粒子数
};

/** Boids 物理常量 / Boids Physics Constants */
export const BOIDS = {
  separationRadius: 40,
  alignmentRadius: 80,
  cohesionRadius: 120,
  maxSpeed: 3.0,
  maxForce: 0.15,
  viewAngle: (270 / 360) * Math.PI * 2, // 270 度前方视角
};

/** 自适应 UI 常量 / Adaptive UI Constants */
export const ADAPTIVE = {
  idleThreshold: 30000,     // 30s 无操作进入节能
  wakeupDelay: 200,          // 200ms 唤醒延迟
  autoCollapseDelay: 5000,   // 5s 自动折叠
};
