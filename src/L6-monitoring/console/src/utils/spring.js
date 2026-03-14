/**
 * Spring 物理引擎 / Spring Physics Engine
 *
 * 基于阻尼弹簧模型的动画插值核心。
 * 5 个预设: interaction / navigation / morphing / gentle / bounce
 *
 * @module utils/spring
 * @author DEEP-IOS
 */

/**
 * Spring 预设 / Spring Presets
 *
 * | Preset      | Stiffness | Damping | Mass | Use Case          |
 * |-------------|-----------|---------|------|-------------------|
 * | interaction | 300       | 24      | 0.8  | 点击/悬浮响应      |
 * | navigation  | 170       | 26      | 1.0  | 视图切换/面板滑出  |
 * | morphing    | 120       | 20      | 1.2  | 形变过渡           |
 * | gentle      | 80        | 18      | 1.5  | 缓慢呼吸/空闲动画  |
 * | bounce      | 400       | 12      | 0.5  | 弹性反馈           |
 */
export const SPRING_PRESETS = {
  interaction: { stiffness: 300, damping: 24, mass: 0.8 },
  navigation:  { stiffness: 170, damping: 26, mass: 1.0 },
  morphing:    { stiffness: 120, damping: 20, mass: 1.2 },
  gentle:      { stiffness: 80,  damping: 18, mass: 1.5 },
  bounce:      { stiffness: 400, damping: 12, mass: 0.5 },
};

/**
 * 单步弹簧物理 / Single spring physics step
 *
 * F = -k(x - target) - d*v
 * a = F / m
 * v' = v + a*dt
 * x' = x + v'*dt
 *
 * @param {number} pos - 当前位置
 * @param {number} vel - 当前速度
 * @param {number} target - 目标位置
 * @param {number} stiffness - 刚度 (k)
 * @param {number} damping - 阻尼 (d)
 * @param {number} mass - 质量 (m)
 * @param {number} dt - 时间步长 (秒)
 * @returns {{ pos: number, vel: number }}
 */
export function springStep(pos, vel, target, stiffness, damping, mass, dt) {
  const springForce = -stiffness * (pos - target);
  const dampingForce = -damping * vel;
  const acceleration = (springForce + dampingForce) / mass;
  const newVel = vel + acceleration * dt;
  const newPos = pos + newVel * dt;
  return { pos: newPos, vel: newVel };
}

/**
 * 2D Spring 步进 / 2D Spring step
 *
 * @param {{ x: number, y: number }} pos
 * @param {{ x: number, y: number }} vel
 * @param {{ x: number, y: number }} target
 * @param {number} stiffness
 * @param {number} damping
 * @param {number} mass
 * @param {number} dt
 * @returns {{ pos: {x, y}, vel: {x, y} }}
 */
export function springStep2D(pos, vel, target, stiffness, damping, mass, dt) {
  const rx = springStep(pos.x, vel.x, target.x, stiffness, damping, mass, dt);
  const ry = springStep(pos.y, vel.y, target.y, stiffness, damping, mass, dt);
  return {
    pos: { x: rx.pos, y: ry.pos },
    vel: { x: rx.vel, y: ry.vel },
  };
}

/**
 * 是否收敛 / Has converged
 * @param {number} pos
 * @param {number} vel
 * @param {number} target
 * @param {number} [threshold=0.001]
 * @returns {boolean}
 */
export function hasConverged(pos, vel, target, threshold = 0.001) {
  return Math.abs(pos - target) < threshold && Math.abs(vel) < threshold;
}
