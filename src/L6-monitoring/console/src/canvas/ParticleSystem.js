/**
 * 粒子系统 / Particle System
 *
 * 管理信息素粒子与环境特效,渲染在特效画布 (canvas-fx) 上。
 * 使用对象池 (object pool) 减少 GC 压力。
 *
 * V7.0 支持 10 种粒子类型:
 *   trail    — 琥珀路径点
 *   alarm    — 红色闪烁
 *   recruit  — 蓝色扩展环
 *   dance    — 绿色八字路径
 *   dust     — 灰色环境尘埃
 *   change   — 金色环形爆发 (状态变更)
 *   queen    — 紫色持续光晕 (architect 周围)
 *   food     — 绿色三角箭头 (指向任务)
 *   danger   — 品红闪烁三角 (危险警告)
 *   evaporate — 上浮蒸发 (信息素衰减)
 *
 * @module console/canvas/ParticleSystem
 * @author DEEP-IOS
 */

import { PHEROMONE_COLORS, hexToRgba } from '../bridge/colors.js';

// ── 粒子类型配置 / Particle type configurations ──
const PARTICLE_CONFIGS = {
  // 路径粒子: 小琥珀点,缓慢飘移 / Trail: small amber dots, slow drift
  trail: {
    color: PHEROMONE_COLORS.trail,
    sizeMin: 1.5, sizeMax: 3,
    speedMin: 0.2, speedMax: 0.6,
    lifeMin: 1.5, lifeMax: 3.0,
  },
  // 警报粒子: 大红色闪烁,快速 / Alarm: large red blinks, fast
  alarm: {
    color: PHEROMONE_COLORS.alarm,
    sizeMin: 4, sizeMax: 7,
    speedMin: 1.0, speedMax: 2.5,
    lifeMin: 0.5, lifeMax: 1.2,
  },
  // 招募粒子: 蓝色扩展环 / Recruit: blue expanding rings
  recruit: {
    color: PHEROMONE_COLORS.recruit,
    sizeMin: 3, sizeMax: 5,
    speedMin: 0.1, speedMax: 0.3,
    lifeMin: 1.0, lifeMax: 2.0,
  },
  // 舞蹈粒子: 绿色八字路径 / Dance: green figure-8 path
  dance: {
    color: PHEROMONE_COLORS.dance,
    sizeMin: 2, sizeMax: 4,
    speedMin: 0.5, speedMax: 1.0,
    lifeMin: 1.5, lifeMax: 2.5,
  },
  // 尘埃粒子: 微灰色,极慢飘移 / Dust: tiny gray, very slow drift
  dust: {
    color: '#6B7280',
    sizeMin: 0.5, sizeMax: 1.5,
    speedMin: 0.05, speedMax: 0.15,
    lifeMin: 3.0, lifeMax: 6.0,
  },
  // 状态变更粒子: 12 粒子环形爆发 / Change: 12-particle ring burst
  change: {
    color: '#F5A623',
    sizeMin: 2, sizeMax: 3.5,
    speedMin: 1.5, speedMax: 3.0,
    lifeMin: 0.6, lifeMax: 1.2,
  },
  // 蜂王粒子: 紫色持续光晕 / Queen: purple persistent halo
  queen: {
    color: PHEROMONE_COLORS.queen,
    sizeMin: 2, sizeMax: 4,
    speedMin: 0.1, speedMax: 0.4,
    lifeMin: 2.0, lifeMax: 4.0,
  },
  // 食物粒子: 绿色三角箭头 / Food: green triangle arrows
  food: {
    color: PHEROMONE_COLORS.food,
    sizeMin: 3, sizeMax: 5,
    speedMin: 0.3, speedMax: 0.8,
    lifeMin: 1.5, lifeMax: 3.0,
  },
  // 危险粒子: 品红闪烁三角 / Danger: magenta flashing triangles
  danger: {
    color: PHEROMONE_COLORS.danger,
    sizeMin: 3, sizeMax: 6,
    speedMin: 0.8, speedMax: 1.8,
    lifeMin: 0.8, lifeMax: 1.5,
  },
  // 蒸发粒子: 上浮消失 / Evaporate: float up and fade
  evaporate: {
    color: '#F5A623',
    sizeMin: 1, sizeMax: 2.5,
    speedMin: 0.3, speedMax: 0.8,
    lifeMin: 1.0, lifeMax: 2.0,
  },
  // 能量流粒子: 金色光球 / Energy flow: golden orbs
  energy: {
    color: '#F5A623',
    sizeMin: 2, sizeMax: 3.5,
    speedMin: 0.5, speedMax: 1.2,
    lifeMin: 1.0, lifeMax: 2.0,
  },
};

/**
 * 随机范围 / Random in range
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function rand(min, max) {
  return min + Math.random() * (max - min);
}

export class ParticleSystem {
  /**
   * @param {number} [maxParticles=500] - 最大粒子数 / Maximum particle count
   */
  constructor(maxParticles = 500) {
    /** @type {Array<Object>} 活跃粒子 / Active particles */
    this.particles = [];
    /** @type {Array<Object>} 对象池 / Object pool for reuse */
    this.pool = [];
    /** @type {number} 上限 / Maximum count */
    this.maxParticles = maxParticles;
  }

  /**
   * 从对象池获取或创建粒子 / Get particle from pool or create new
   * @returns {Object}
   */
  _acquire() {
    return this.pool.length > 0 ? this.pool.pop() : {};
  }

  /**
   * 在指定位置发射粒子 / Emit particles at position
   *
   * @param {number} x - X 坐标 / X position
   * @param {number} y - Y 坐标 / Y position
   * @param {string} type - 粒子类型 / Particle type
   * @param {number} [count=5] - 发射数量 / Emission count
   * @param {Object} [opts] - 额外选项 / Extra options
   * @param {number} [opts.targetX] - 目标 X (用于 food/energy) / Target X
   * @param {number} [opts.targetY] - 目标 Y (用于 food/energy) / Target Y
   * @param {string} [opts.color] - 覆盖颜色 / Override color
   */
  emit(x, y, type, count = 5, opts = {}) {
    const cfg = PARTICLE_CONFIGS[type] || PARTICLE_CONFIGS.trail;
    const emitCount = Math.min(count, this.maxParticles - this.particles.length);

    for (let i = 0; i < emitCount; i++) {
      const p = this._acquire();
      const life = rand(cfg.lifeMin, cfg.lifeMax);
      const speed = rand(cfg.speedMin, cfg.speedMax);

      p.x = x;
      p.y = y;
      p.type = type;
      p.color = opts.color || cfg.color;
      p.size = rand(cfg.sizeMin, cfg.sizeMax);
      p.life = life;
      p.maxLife = life;
      // 初始相位 / Initial phase for special paths
      p.phase = Math.random() * Math.PI * 2;
      // 目标坐标 / Target coords (food/energy)
      p.targetX = opts.targetX || 0;
      p.targetY = opts.targetY || 0;

      if (type === 'change') {
        // 环形爆发: 均匀分布在圆周上 / Ring burst: evenly distributed
        const angle = (i / Math.max(1, count)) * Math.PI * 2;
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed;
      } else if (type === 'evaporate') {
        // 蒸发: 主要向上 / Evaporate: mainly upward
        p.vx = (Math.random() - 0.5) * speed * 0.5;
        p.vy = -speed;
      } else if (type === 'food' && opts.targetX) {
        // 食物: 指向目标 / Food: towards target
        const dx = opts.targetX - x;
        const dy = opts.targetY - y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        p.vx = (dx / dist) * speed;
        p.vy = (dy / dist) * speed;
      } else if (type === 'energy' && opts.targetX) {
        // 能量流: 指向目标 / Energy: towards target
        const dx = opts.targetX - x;
        const dy = opts.targetY - y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        p.vx = (dx / dist) * speed;
        p.vy = (dy / dist) * speed;
      } else if (type === 'queen') {
        // 蜂王: 缓慢轨道 / Queen: slow orbit
        const angle = (i / Math.max(1, count)) * Math.PI * 2;
        p.vx = Math.cos(angle) * speed * 0.3;
        p.vy = Math.sin(angle) * speed * 0.3;
      } else {
        // 随机方向 / Random direction
        const angle = Math.random() * Math.PI * 2;
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed;
      }

      this.particles.push(p);
    }
  }

  /**
   * 更新所有粒子 / Update all particles
   * @param {number} dt - 时间步长 (秒) / Time step in seconds
   */
  tick(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      // 舞蹈粒子: 八字形叠加 / Dance: figure-8 overlay
      if (p.type === 'dance') {
        p.phase += dt * 4;
        p.x += Math.sin(p.phase) * 0.8;
        p.y += Math.sin(p.phase * 2) * 0.4;
      }

      // 招募粒子: 尺寸随时间增长 / Recruit: size grows over time
      if (p.type === 'recruit') {
        const progress = 1 - p.life / p.maxLife;
        p.size = p.size + progress * 0.15;
      }

      // 蜂王粒子: 围绕原点轨道 / Queen: orbit around origin
      if (p.type === 'queen') {
        p.phase += dt * 1.5;
        p.x += Math.cos(p.phase) * 0.3;
        p.y += Math.sin(p.phase) * 0.3;
      }

      // 蒸发粒子: 逐渐减速 + 尺寸缩小 / Evaporate: decelerate + shrink
      if (p.type === 'evaporate') {
        p.vy *= 0.98;
        p.size *= 0.995;
      }

      // 危险粒子: 尺寸脉冲 / Danger: size pulse
      if (p.type === 'danger') {
        p.phase += dt * 8;
      }

      // 能量流: 加速向目标 / Energy: accelerate towards target
      if (p.type === 'energy' && p.targetX) {
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 5) {
          p.vx += (dx / dist) * 0.05;
          p.vy += (dy / dist) * 0.05;
        }
      }

      // 通用移动 / Generic movement
      p.x += p.vx;
      p.y += p.vy;

      // 尘埃粒子: 微弱随机漂移 / Dust: slight random drift
      if (p.type === 'dust') {
        p.vx += (Math.random() - 0.5) * 0.01;
        p.vy += (Math.random() - 0.5) * 0.01;
      }

      // 生命衰减 / Life decay
      p.life -= dt;
      if (p.life <= 0) {
        // 回收到对象池 / Recycle to pool
        this.pool.push(this.particles.splice(i, 1)[0]);
      }
    }
  }

  /**
   * 绘制所有活跃粒子 / Draw all active particles
   * @param {CanvasRenderingContext2D} ctx - 画布上下文 / Canvas context
   */
  draw(ctx) {
    for (const p of this.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);

      if (p.type === 'recruit') {
        // 招募: 描边圆环,尺寸增长 / Recruit: stroke ring, growing
        ctx.globalAlpha = alpha * 0.6;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.stroke();

      } else if (p.type === 'alarm') {
        // 警报: 正弦闪烁调制 / Alarm: sin-modulated blink
        const blink = 0.5 + 0.5 * Math.sin(p.life * 15);
        ctx.globalAlpha = alpha * blink;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

      } else if (p.type === 'queen') {
        // 蜂王: 紫色光晕 + 外发光 / Queen: purple halo + outer glow
        ctx.globalAlpha = alpha * 0.5;
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3);
        glow.addColorStop(0, hexToRgba(p.color, 0.3));
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = alpha * 0.8;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

      } else if (p.type === 'food') {
        // 食物: 三角形箭头 / Food: triangle arrow
        ctx.globalAlpha = alpha * 0.7;
        ctx.fillStyle = p.color;
        const angle = Math.atan2(p.vy, p.vx);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(p.size, 0);
        ctx.lineTo(-p.size * 0.6, -p.size * 0.5);
        ctx.lineTo(-p.size * 0.6, p.size * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

      } else if (p.type === 'danger') {
        // 危险: 闪烁三角形 / Danger: flashing triangle
        const blink = 0.4 + 0.6 * Math.abs(Math.sin(p.phase));
        ctx.globalAlpha = alpha * blink;
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(-p.size * 0.866, p.size * 0.5);
        ctx.lineTo(p.size * 0.866, p.size * 0.5);
        ctx.closePath();
        ctx.fill();

        // 内部感叹号 / Inner exclamation
        ctx.fillStyle = '#FFFFFF';
        ctx.globalAlpha = alpha * blink * 0.8;
        ctx.font = `bold ${p.size}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', 0, p.size * 0.05);
        ctx.restore();

      } else if (p.type === 'evaporate') {
        // 蒸发: 上浮渐隐 + 尺寸缩小 / Evaporate: float up, fade, shrink
        ctx.globalAlpha = alpha * 0.6;
        ctx.fillStyle = hexToRgba(p.color, alpha * 0.5);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
        ctx.fill();

      } else if (p.type === 'energy') {
        // 能量流: 发光光球 / Energy: glowing orb
        ctx.globalAlpha = alpha * 0.7;
        const eGlow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
        eGlow.addColorStop(0, hexToRgba(p.color, 0.5));
        eGlow.addColorStop(1, 'transparent');
        ctx.fillStyle = eGlow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
        ctx.fill();

      } else if (p.type === 'change') {
        // 变化爆发: 填充圆 + 拖尾 / Change: filled circle + trail
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

        // 拖尾 / Trail
        ctx.globalAlpha = alpha * 0.3;
        ctx.beginPath();
        ctx.arc(p.x - p.vx * 2, p.y - p.vy * 2, p.size * 0.6, 0, Math.PI * 2);
        ctx.fill();

      } else {
        // 默认: 填充圆 / Default: filled circle
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 恢复全局透明度 / Restore global alpha
    ctx.globalAlpha = 1;
  }

  /**
   * 获取活跃粒子数 / Get active particle count
   * @returns {number}
   */
  getActiveCount() {
    return this.particles.length;
  }

  /**
   * 清空所有粒子 / Clear all particles
   */
  clear() {
    // 回收到池中 / Recycle all to pool
    while (this.particles.length > 0) {
      this.pool.push(this.particles.pop());
    }
  }
}
