/**
 * Boids 群体物理模拟系统 / Boids Flocking Physics Simulation
 *
 * 以 30Hz 频率运行 Boids 算法来模拟蜜蜂群体运动。
 * Runs Boids algorithm at 30Hz to simulate bee swarm movement.
 *
 * V7.0 增强:
 *   - 7 种力: 目标吸引 + 分离 + 对齐 + 任务吸引 + 逃离 + 阻尼 + 边界
 *   - 270° 前方视角 (后方盲区)
 *   - 动量守恒 (方向突变先减速再转向, 停止有滑行)
 *   - 4 态参数表 (IDLE/ACTIVE/EXECUTING/REPORTING)
 *   - Gestalt 共同命运 (同角色 agent 相似运动模式)
 *   - 逃离力 (高 alarm 区域排斥)
 *   - 任务吸引力 (EXECUTING → 飞向任务位置)
 *
 * @module console/canvas/BoidsSystem
 * @author DEEP-IOS
 */

import { ROLE_SIZES } from '../bridge/colors.js';

// ── 通用力学参数 / General force parameters ──
const SEPARATION_RADIUS = 50;
const ALIGNMENT_RADIUS = 90;
const COHESION_RADIUS = 120;
const BOUNDARY_MARGIN = 40;
const BOUNDARY_FORCE = 0.1;
const VIEW_ANGLE = (270 / 360) * Math.PI * 2; // 270° 前方视角

// ── 4 态参数表 / State parameter table ──
const STATE_PARAMS = {
  IDLE: {
    targetStrength: 0.06,     // 强吸引回巢 / Strong home attraction
    separationStrength: 0.04,
    alignmentStrength: 0.025,
    damping: 0.92,
    maxSpeed: 2.0,
    wanderStrength: 0.3,      // 轻微游荡 / Slight wander
  },
  ACTIVE: {
    targetStrength: 0.04,
    separationStrength: 0.05,
    alignmentStrength: 0.03,
    damping: 0.94,
    maxSpeed: 3.0,
    wanderStrength: 0.1,
  },
  EXECUTING: {
    targetStrength: 0.03,
    separationStrength: 0.03,
    alignmentStrength: 0.01,  // 低对齐 — 专注任务 / Low alignment — focused
    damping: 0.95,
    maxSpeed: 5.0,
    wanderStrength: 0.0,
  },
  REPORTING: {
    targetStrength: 0.02,
    separationStrength: 0.02,
    alignmentStrength: 0.02,
    damping: 0.93,
    maxSpeed: 3.5,
    wanderStrength: 0.0,      // 八字舞替代游荡 / Figure-8 dance replaces wander
  },
  ERROR: {
    targetStrength: 0.01,
    separationStrength: 0.06,
    alignmentStrength: 0.0,   // 无对齐 / No alignment
    damping: 0.90,
    maxSpeed: 2.0,
    wanderStrength: 0.5,      // 不安游荡 / Anxious wander
  },
};

const DEFAULT_PARAMS = STATE_PARAMS.ACTIVE;

// ── 特殊力参数 / Special force parameters ──
const TASK_ATTRACTION_STRENGTH = 0.04;
const ESCAPE_RADIUS = 120;
const ESCAPE_STRENGTH = 0.08;
const GESTALT_STRENGTH = 0.015;

export class BoidsSystem {
  constructor() {
    /** @type {Array<Object>} 内部 boid 列表 / Internal boid list */
    this.agents = [];
    /** @type {number} 画布宽度 / Canvas width */
    this.width = 800;
    /** @type {number} 画布高度 / Canvas height */
    this.height = 600;
    /** @type {number} alarm 级别 / Alarm level (0-1) */
    this._alarmLevel = 0;
    /** @type {Array<{x:number,y:number}>} 危险区域 / Danger zones */
    this._dangerZones = [];
    /** @type {Map<string,{x:number,y:number}>} 任务位置 / Task positions */
    this._taskPositions = new Map();
  }

  /**
   * 设置画布尺寸 / Set canvas dimensions
   * @param {number} w
   * @param {number} h
   */
  setDimensions(w, h) {
    this.width = w;
    this.height = h;
  }

  /**
   * 设置 alarm 级别 / Set alarm level
   * @param {number} level - 0-1
   */
  setAlarmLevel(level) {
    this._alarmLevel = level;
  }

  /**
   * 设置危险区域 / Set danger zones
   * @param {Array<{x:number,y:number}>} zones
   */
  setDangerZones(zones) {
    this._dangerZones = zones || [];
  }

  /**
   * 设置任务位置 (用于任务吸引力) / Set task positions for attraction
   * @param {Map<string,{x:number,y:number}>} positions
   */
  setTaskPositions(positions) {
    this._taskPositions = positions || new Map();
  }

  /**
   * 从 store 同步代理数据 / Sync agent data from store
   * @param {Array<Object>} storeAgents
   */
  setAgents(storeAgents) {
    const incoming = new Map(storeAgents.map(a => [a.id, a]));
    const existing = new Map(this.agents.map(b => [b.id, b]));

    // 移除不在新列表中的 boid / Remove departed boids
    this.agents = this.agents.filter(b => incoming.has(b.id));

    for (const [id, agent] of incoming) {
      if (existing.has(id)) {
        // 更新现有 boid 的非物理属性 / Update non-physics properties
        const boid = existing.get(id);
        boid.role = agent.role || 'default';
        boid.state = agent.state || 'IDLE';
        boid.size = agent.size || ROLE_SIZES[boid.role] || ROLE_SIZES.default;
        boid.subAgentCount = agent.subAgentCount || 0;
        boid.taskId = agent.taskId || null;
      } else {
        // 创建新 boid / Create new boid
        const size = agent.size || ROLE_SIZES[agent.role] || ROLE_SIZES.default;
        this.agents.push({
          id,
          x: agent.x ?? (this.width * 0.5 + (Math.random() - 0.5) * 100),
          y: agent.y ?? (this.height * 0.5 + (Math.random() - 0.5) * 100),
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
          targetX: this.width * 0.5,
          targetY: this.height * 0.5,
          role: agent.role || 'default',
          state: agent.state || 'IDLE',
          size,
          subAgentCount: agent.subAgentCount || 0,
          taskId: agent.taskId || null,
          // 动量追踪 / Momentum tracking
          prevHeading: 0,
        });
      }
    }
  }

  /**
   * 设置目标位置 / Set target positions
   * @param {Array<{id: string, x: number, y: number}>} viewTargets
   */
  setTargets(viewTargets) {
    const targetMap = new Map(viewTargets.map(t => [t.id, t]));
    for (const boid of this.agents) {
      const target = targetMap.get(boid.id);
      if (target) {
        boid.targetX = target.x;
        boid.targetY = target.y;
      }
    }
  }

  /**
   * 检查另一个 boid 是否在前方视角内 / Check if other boid is within view angle
   * @private
   */
  _isInView(boid, other) {
    const dx = other.x - boid.x;
    const dy = other.y - boid.y;
    const heading = Math.atan2(boid.vy, boid.vx);
    const angleTo = Math.atan2(dy, dx);
    let diff = angleTo - heading;
    // 归一化到 [-PI, PI] / Normalize to [-PI, PI]
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return Math.abs(diff) < VIEW_ANGLE * 0.5;
  }

  /**
   * 物理模拟步进 (30Hz) / Physics tick at 30Hz
   * @param {number} dt - 时间步长 (秒) / Time step in seconds
   */
  tick(dt) {
    const count = this.agents.length;
    if (count === 0) return;

    const now = Date.now() / 1000;

    for (let i = 0; i < count; i++) {
      const boid = this.agents[i];
      const params = STATE_PARAMS[boid.state] || DEFAULT_PARAMS;
      let ax = 0, ay = 0;

      // ── 力1: 目标吸引 / Force 1: Target attraction ──
      const tdx = boid.targetX - boid.x;
      const tdy = boid.targetY - boid.y;
      ax += tdx * params.targetStrength;
      ay += tdy * params.targetStrength;

      // ── 力2: 分离力 / Force 2: Separation ──
      for (let j = 0; j < count; j++) {
        if (i === j) continue;
        const other = this.agents[j];
        const sdx = boid.x - other.x;
        const sdy = boid.y - other.y;
        const dist = Math.sqrt(sdx * sdx + sdy * sdy);
        if (dist > 0 && dist < SEPARATION_RADIUS) {
          // 前方视角检查 (近距离总是感知) / View check (always sense close range)
          if (this._isInView(boid, other) || dist < SEPARATION_RADIUS * 0.4) {
            const force = params.separationStrength * (1 - dist / SEPARATION_RADIUS);
            ax += (sdx / dist) * force;
            ay += (sdy / dist) * force;
          }
        }
      }

      // ── 力3: 对齐力 / Force 3: Alignment ──
      let avgVx = 0, avgVy = 0, neighbors = 0;
      for (let j = 0; j < count; j++) {
        if (i === j) continue;
        const other = this.agents[j];
        const adx = other.x - boid.x;
        const ady = other.y - boid.y;
        const dist = Math.sqrt(adx * adx + ady * ady);
        if (dist < ALIGNMENT_RADIUS && this._isInView(boid, other)) {
          avgVx += other.vx;
          avgVy += other.vy;
          neighbors++;
        }
      }
      if (neighbors > 0) {
        avgVx /= neighbors;
        avgVy /= neighbors;
        ax += (avgVx - boid.vx) * params.alignmentStrength;
        ay += (avgVy - boid.vy) * params.alignmentStrength;
      }

      // ── 力4: Gestalt 共同命运 / Force 4: Gestalt common fate ──
      let gestaltVx = 0, gestaltVy = 0, gestaltN = 0;
      for (let j = 0; j < count; j++) {
        if (i === j) continue;
        const other = this.agents[j];
        if (other.role === boid.role) {
          const gdist = Math.sqrt((other.x - boid.x) ** 2 + (other.y - boid.y) ** 2);
          if (gdist < COHESION_RADIUS) {
            gestaltVx += other.vx;
            gestaltVy += other.vy;
            gestaltN++;
          }
        }
      }
      if (gestaltN > 0) {
        gestaltVx /= gestaltN;
        gestaltVy /= gestaltN;
        ax += (gestaltVx - boid.vx) * GESTALT_STRENGTH;
        ay += (gestaltVy - boid.vy) * GESTALT_STRENGTH;
      }

      // ── 力5: 任务吸引力 / Force 5: Task attraction ──
      if (boid.state === 'EXECUTING' && boid.taskId) {
        const taskPos = this._taskPositions.get(boid.taskId);
        if (taskPos) {
          const taskDx = taskPos.x - boid.x;
          const taskDy = taskPos.y - boid.y;
          ax += taskDx * TASK_ATTRACTION_STRENGTH;
          ay += taskDy * TASK_ATTRACTION_STRENGTH;
        }
      }

      // ── 力6: 逃离力 / Force 6: Escape from danger ──
      if (this._alarmLevel > 0.5) {
        for (const zone of this._dangerZones) {
          const edx = boid.x - zone.x;
          const edy = boid.y - zone.y;
          const eDist = Math.sqrt(edx * edx + edy * edy);
          if (eDist < ESCAPE_RADIUS && eDist > 0) {
            const escapeForce = ESCAPE_STRENGTH * this._alarmLevel * (1 - eDist / ESCAPE_RADIUS);
            ax += (edx / eDist) * escapeForce;
            ay += (edy / eDist) * escapeForce;
          }
        }
      }

      // ── 力7: 状态特殊行为 / Force 7: State-specific behavior ──
      if (boid.state === 'REPORTING') {
        // 八字形振荡叠加 / Figure-8 oscillation overlay
        ax += Math.sin(now * 3 + i) * 0.5;
        ay += Math.sin(now * 6 + i) * 0.3;
      }

      // 游荡 / Wander
      if (params.wanderStrength > 0) {
        ax += (Math.random() - 0.5) * params.wanderStrength;
        ay += (Math.random() - 0.5) * params.wanderStrength;
      }

      // ── 边界软反弹 / Soft boundary bounce ──
      if (boid.x < BOUNDARY_MARGIN) {
        ax += (BOUNDARY_MARGIN - boid.x) * BOUNDARY_FORCE;
      } else if (boid.x > this.width - BOUNDARY_MARGIN) {
        ax -= (boid.x - (this.width - BOUNDARY_MARGIN)) * BOUNDARY_FORCE;
      }
      if (boid.y < BOUNDARY_MARGIN) {
        ay += (BOUNDARY_MARGIN - boid.y) * BOUNDARY_FORCE;
      } else if (boid.y > this.height - BOUNDARY_MARGIN) {
        ay -= (boid.y - (this.height - BOUNDARY_MARGIN)) * BOUNDARY_FORCE;
      }

      // ── 动量守恒: 大角度转向减速 / Momentum: decelerate on sharp turns ──
      const currentHeading = Math.atan2(boid.vy, boid.vx);
      const desiredHeading = Math.atan2(boid.vy + ay, boid.vx + ax);
      let headingDiff = desiredHeading - currentHeading;
      while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
      while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;

      const turnPenalty = Math.abs(headingDiff) > Math.PI * 0.5
        ? 1 - (Math.abs(headingDiff) / Math.PI) * 0.3
        : 1.0;

      // ── 施加力并更新速度 / Apply forces and update velocity ──
      boid.vx += ax;
      boid.vy += ay;

      // ── 阻尼 / Damping ──
      boid.vx *= params.damping * turnPenalty;
      boid.vy *= params.damping * turnPenalty;

      // ── 速度限制 / Speed limit ──
      const speed = Math.sqrt(boid.vx * boid.vx + boid.vy * boid.vy);
      if (speed > params.maxSpeed) {
        boid.vx = (boid.vx / speed) * params.maxSpeed;
        boid.vy = (boid.vy / speed) * params.maxSpeed;
      }

      // 保存朝向 / Save heading
      boid.prevHeading = currentHeading;

      // ── 更新位置 / Update position ──
      boid.x += boid.vx;
      boid.y += boid.vy;

      // 硬边界 / Hard boundary clamp
      boid.x = Math.max(5, Math.min(this.width - 5, boid.x));
      boid.y = Math.max(5, Math.min(this.height - 5, boid.y));
    }
  }

  /**
   * 获取当前所有 boid / Get all current boids
   * @returns {Array<Object>}
   */
  getAgents() {
    return this.agents;
  }
}
