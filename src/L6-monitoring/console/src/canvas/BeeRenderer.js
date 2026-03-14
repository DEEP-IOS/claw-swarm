/**
 * 蜜蜂代理渲染器 / Bee Agent Renderer
 *
 * 在前景画布 (canvas-fg) 上绘制生物形态蜜蜂代理。
 * 10 步渲染管线: 外发光 → 触角 → 翅膀 → 身体(头+胸+腹) → 边框 → 状态特效
 *            → 行为动画 → 角色图标 → 子代理徽章 → ID标签
 *
 * Draws biomorphic bee agents on the fg canvas layer.
 * 10-step pipeline: outer glow → antennae → wings → body(head+thorax+abdomen) → border
 *              → state effects → behavior animation → role icon → sub-agent badge → ID label
 *
 * V7.0 新增:
 *   - 生物形态蜜蜂 (触角/头/胸/腹/刺)
 *   - 12 种行为动画 (通过 determineBehavior)
 *   - Disney 12 原则 (压缩拉伸/预备/后续)
 *   - 角色视觉差异 (architect 皇冠, guard 力场, scout 长轨迹)
 *   - 状态饱和度 (IDLE 40%, ACTIVE 80%, EXECUTING 100%)
 *
 * @module console/canvas/BeeRenderer
 * @author DEEP-IOS
 */

import {
  ROLE_COLORS,
  ROLE_SIZES,
  ROLE_WING_FREQ,
  ROLE_ICONS,
  hexToRgba,
  shortId,
} from '../bridge/colors.js';
import { determineBehavior } from '../data/constants/behaviors.js';
import {
  SQUASH_CLICK,
  STRETCH_CLICK,
  SQUASH_ANTICIPATION,
} from '../data/constants/animation.js';

// ── 状态饱和度映射 / State saturation map ──
const STATE_SATURATION = {
  IDLE: 0.4,
  ACTIVE: 0.8,
  EXECUTING: 1.0,
  REPORTING: 0.9,
  ERROR: 1.0,
};

// ── Disney 动画状态 / Disney animation state ──
const SQUASH_DURATION = 0.15; // 150ms 压缩
const STRETCH_DURATION = 0.2; // 200ms 拉伸
const ANTICIPATION_DURATION = 0.12; // 120ms 预备

export class BeeRenderer {
  constructor() {
    // 压缩/拉伸状态缓存 / Squash-stretch state cache per bee
    this._squashState = new Map();
  }

  /**
   * 触发压缩拉伸 (点击时调用) / Trigger squash-stretch on click
   * @param {string} id
   * @param {number} time
   */
  triggerSquash(id, time) {
    this._squashState.set(id, { startTime: time, phase: 'squash' });
  }

  /**
   * 计算压缩拉伸缩放 / Calculate squash-stretch scale
   * @private
   */
  _getSquashScale(id, time) {
    const state = this._squashState.get(id);
    if (!state) return 1.0;

    const elapsed = time - state.startTime;
    if (elapsed < SQUASH_DURATION) {
      // 压缩阶段: 1.0 → SQUASH_CLICK
      const t = elapsed / SQUASH_DURATION;
      return 1.0 + (SQUASH_CLICK - 1.0) * Math.sin(t * Math.PI * 0.5);
    } else if (elapsed < SQUASH_DURATION + STRETCH_DURATION) {
      // 拉伸阶段: SQUASH_CLICK → STRETCH_CLICK → 1.0
      const t = (elapsed - SQUASH_DURATION) / STRETCH_DURATION;
      if (t < 0.5) {
        return SQUASH_CLICK + (STRETCH_CLICK - SQUASH_CLICK) * Math.sin(t * Math.PI);
      }
      return STRETCH_CLICK + (1.0 - STRETCH_CLICK) * Math.sin((t - 0.5) * Math.PI);
    } else {
      this._squashState.delete(id);
      return 1.0;
    }
  }

  /**
   * 绘制单个蜜蜂 / Draw a single bee agent
   *
   * @param {CanvasRenderingContext2D} ctx - 画布上下文 / Canvas context
   * @param {Object} bee - 蜜蜂数据 / Bee data
   * @param {number} time - 动画时间 (秒) / Animation time in seconds
   * @param {Object} [pheromones] - 信息素数据 / Pheromone data for behavior determination
   */
  draw(ctx, bee, time, pheromones) {
    const { x, y, role, state, selected, id, subAgentCount, vx, vy } = bee;
    const roleColor = ROLE_COLORS[role] || ROLE_COLORS.default;
    const size = bee.size || ROLE_SIZES[role] || ROLE_SIZES.default;
    const wingFreq = ROLE_WING_FREQ[role] || ROLE_WING_FREQ.default;
    const icon = ROLE_ICONS[role] || ROLE_ICONS.default;

    // 状态饱和度 / State saturation
    const saturation = STATE_SATURATION[state] || 0.8;

    // Disney 压缩拉伸 / Disney squash-stretch
    const squashScale = this._getSquashScale(id, time);

    // 行为判定 / Behavior determination
    const behavior = determineBehavior(bee, pheromones || {});

    // 运动朝向角 / Heading angle from velocity
    const speed = Math.sqrt((vx || 0) ** 2 + (vy || 0) ** 2);
    const heading = speed > 0.1 ? Math.atan2(vy || 0, vx || 0) : 0;

    const dpr = window.devicePixelRatio || 1;

    ctx.save();
    ctx.translate(x, y);

    // 应用 Disney 压缩拉伸 / Apply squash-stretch
    ctx.scale(squashScale, 2 - squashScale);

    // ── 第1步: 外发光 / Step 1: Outer glow ──
    const glowPulse = 0.3 + 0.15 * Math.sin(time * 2.5);
    const glowAlpha = glowPulse * saturation;
    const glowRadius = size * 2.2;
    const glowGrad = ctx.createRadialGradient(0, 0, size * 0.5, 0, 0, glowRadius);
    glowGrad.addColorStop(0, hexToRgba(roleColor, glowAlpha));
    glowGrad.addColorStop(1, hexToRgba(roleColor, 0));
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    // ── 第2步: 触角 / Step 2: Antennae ──
    ctx.save();
    ctx.rotate(heading);
    const antWobble = Math.sin(time * wingFreq * 0.5) * 0.15;

    ctx.strokeStyle = hexToRgba(roleColor, 0.6 * saturation);
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';

    // 左触角 / Left antenna
    ctx.beginPath();
    ctx.moveTo(size * 0.15, -size * 0.1);
    ctx.quadraticCurveTo(
      size * 0.5, -size * 0.35 + antWobble * size,
      size * 0.55, -size * 0.5,
    );
    ctx.stroke();
    // 触角尖端小球 / Antenna tip ball
    ctx.fillStyle = hexToRgba(roleColor, 0.5 * saturation);
    ctx.beginPath();
    ctx.arc(size * 0.55, -size * 0.5, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // 右触角 / Right antenna
    ctx.beginPath();
    ctx.moveTo(size * 0.15, size * 0.1);
    ctx.quadraticCurveTo(
      size * 0.5, size * 0.35 - antWobble * size,
      size * 0.55, size * 0.5,
    );
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(size * 0.55, size * 0.5, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ── 第3步: 翅膀 / Step 3: Wings ──
    const wingAngle = Math.sin(time * wingFreq) * 0.3;
    // 空闲时翅膀后续动作: 减弱拍动 / Follow-through: reduced wing beat when idle
    const wingAmplitude = state === 'IDLE' ? 0.5 : 1.0;
    const wingW = size * 0.7;
    const wingH = size * 0.35;
    ctx.fillStyle = hexToRgba(roleColor, 0.2 * saturation);
    ctx.strokeStyle = hexToRgba(roleColor, 0.15 * saturation);
    ctx.lineWidth = 0.5;

    ctx.save();
    ctx.rotate(heading);

    // 左翅 / Left wing
    ctx.save();
    ctx.rotate(-Math.PI / 2 + wingAngle * wingAmplitude);
    ctx.beginPath();
    ctx.ellipse(-size * 0.25, -size * 0.1, wingW, wingH, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 右翅 / Right wing
    ctx.save();
    ctx.rotate(-Math.PI / 2 - wingAngle * wingAmplitude);
    ctx.beginPath();
    ctx.ellipse(size * 0.25, -size * 0.1, wingW, wingH, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();

    // ── 第4步: 身体 (头+胸+腹) / Step 4: Body (head + thorax + abdomen) ──
    ctx.save();
    ctx.rotate(heading);

    // 腹部 (尾段, 大椭圆) / Abdomen (rear, large ellipse)
    const abdGrad = ctx.createRadialGradient(-size * 0.15, 0, 0, -size * 0.15, 0, size * 0.35);
    abdGrad.addColorStop(0, hexToRgba(roleColor, 0.9 * saturation));
    abdGrad.addColorStop(1, hexToRgba(roleColor, 0.5 * saturation));
    ctx.fillStyle = abdGrad;
    ctx.beginPath();
    ctx.ellipse(-size * 0.15, 0, size * 0.35, size * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();

    // 腹部条纹 / Abdomen stripes
    ctx.strokeStyle = hexToRgba('#000000', 0.1 * saturation);
    ctx.lineWidth = 1;
    for (let s = -1; s <= 1; s++) {
      const sx = -size * 0.15 + s * size * 0.1;
      ctx.beginPath();
      ctx.moveTo(sx, -size * 0.2);
      ctx.lineTo(sx, size * 0.2);
      ctx.stroke();
    }

    // 胸部 (中段, 中椭圆) / Thorax (middle, medium ellipse)
    const thoraxGrad = ctx.createRadialGradient(size * 0.12, 0, 0, size * 0.12, 0, size * 0.22);
    thoraxGrad.addColorStop(0, hexToRgba(roleColor, 1.0 * saturation));
    thoraxGrad.addColorStop(1, hexToRgba(roleColor, 0.7 * saturation));
    ctx.fillStyle = thoraxGrad;
    ctx.beginPath();
    ctx.ellipse(size * 0.12, 0, size * 0.22, size * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // 高光点 (实体感) / Highlight dot (solid feel)
    ctx.fillStyle = hexToRgba('#FFFFFF', 0.3 * saturation);
    ctx.beginPath();
    ctx.arc(size * 0.08, -size * 0.08, size * 0.06, 0, Math.PI * 2);
    ctx.fill();

    // 头部 (前段, 小圆) / Head (front, small circle)
    ctx.fillStyle = hexToRgba(roleColor, 0.95 * saturation);
    ctx.beginPath();
    ctx.arc(size * 0.32, 0, size * 0.13, 0, Math.PI * 2);
    ctx.fill();

    // 刺 (执行时发光) / Stinger (glows when executing)
    if (state === 'EXECUTING') {
      const stingerGlow = 0.6 + 0.4 * Math.sin(time * 6);
      ctx.fillStyle = hexToRgba('#F5A623', stingerGlow);
      ctx.beginPath();
      ctx.moveTo(-size * 0.48, 0);
      ctx.lineTo(-size * 0.38, -size * 0.06);
      ctx.lineTo(-size * 0.38, size * 0.06);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();

    // ── 第5步: 边框环 / Step 5: Border ring ──
    ctx.strokeStyle = hexToRgba(roleColor, 0.6 * saturation);
    ctx.lineWidth = selected ? 2.5 : 1;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2);
    ctx.stroke();

    // 选中时的外环高亮 / Selected outer highlight ring
    if (selected) {
      ctx.strokeStyle = hexToRgba(roleColor, 0.4);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.lineDashOffset = -time * 20;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // 选中脉冲环 / Selection pulse ring
      const pulseR = size * 0.8 + Math.sin(time * 3) * size * 0.1;
      ctx.strokeStyle = hexToRgba(roleColor, 0.15);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, pulseR, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ── 第6步: 状态特效 / Step 6: State effects ──
    if (state === 'EXECUTING') {
      // 旋转虚线金环 / Rotating dashed gold ring
      ctx.save();
      ctx.rotate(time * 2);
      ctx.strokeStyle = '#F5A623';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.65, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // 能量微粒环 / Energy particle ring
      const sparkCount = 4;
      for (let i = 0; i < sparkCount; i++) {
        const sa = time * 3 + (i / sparkCount) * Math.PI * 2;
        const sr = size * 0.6;
        const sx = Math.cos(sa) * sr;
        const sy = Math.sin(sa) * sr;
        ctx.fillStyle = hexToRgba('#F5A623', 0.6);
        ctx.beginPath();
        ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (state === 'REPORTING') {
      // 八字形预览路径 / Figure-8 preview path
      ctx.save();
      ctx.strokeStyle = hexToRgba('#8B5CF6', 0.4);
      ctx.lineWidth = 1;
      ctx.beginPath();
      const f8Radius = size * 0.5;
      for (let t = 0; t <= Math.PI * 2; t += 0.1) {
        const fx = Math.sin(t) * f8Radius;
        const fy = Math.sin(t * 2) * f8Radius * 0.5;
        if (t === 0) ctx.moveTo(fx, fy);
        else ctx.lineTo(fx, fy);
      }
      ctx.stroke();
      ctx.restore();

      // 舞蹈旋转光点 / Dance rotating light dot
      const dAngle = time * 4;
      const dRadius = size * 0.5;
      const dx = Math.sin(dAngle) * dRadius;
      const dy = Math.sin(dAngle * 2) * dRadius * 0.5;
      ctx.fillStyle = hexToRgba('#8B5CF6', 0.7);
      ctx.beginPath();
      ctx.arc(dx, dy, 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (state === 'ERROR') {
      // 红色脉冲环 / Red pulse ring
      const errPulse = 0.5 + 0.5 * Math.sin(time * 5);
      ctx.strokeStyle = hexToRgba('#EF4444', errPulse);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.7, 0, Math.PI * 2);
      ctx.stroke();

      // 警告三角 / Warning triangle
      ctx.fillStyle = hexToRgba('#EF4444', 0.3 + errPulse * 0.3);
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.85);
      ctx.lineTo(-size * 0.12, -size * 0.65);
      ctx.lineTo(size * 0.12, -size * 0.65);
      ctx.closePath();
      ctx.fill();
    }

    // ── 第7步: 角色特殊视觉 / Step 7: Role-specific visuals ──
    if (role === 'architect') {
      // 皇冠光晕 / Crown halo
      const crownAlpha = 0.15 + 0.1 * Math.sin(time * 1.5);
      ctx.strokeStyle = hexToRgba('#8B5CF6', crownAlpha);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      // 3 个皇冠尖 / 3 crown points
      const cr = size * 0.6;
      for (let i = 0; i < 3; i++) {
        const ca = -Math.PI / 2 + (i - 1) * 0.5;
        const tipX = Math.cos(ca) * cr * 1.2;
        const tipY = Math.sin(ca) * cr * 1.2;
        const baseL = Math.cos(ca - 0.2) * cr;
        const baseR = Math.cos(ca + 0.2) * cr;
        const baseLY = Math.sin(ca - 0.2) * cr;
        const baseRY = Math.sin(ca + 0.2) * cr;
        ctx.moveTo(baseL, baseLY);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(baseR, baseRY);
      }
      ctx.stroke();
    } else if (role === 'guard') {
      // 力场效果 / Force field effect
      const fieldAlpha = 0.08 + 0.05 * Math.sin(time * 2);
      ctx.strokeStyle = hexToRgba('#EF4444', fieldAlpha);
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 6]);
      ctx.lineDashOffset = -time * 15;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (role === 'scout') {
      // 侦察范围指示 / Scout range indicator
      const rangeAlpha = 0.04 + 0.03 * Math.sin(time * 1.8);
      ctx.strokeStyle = hexToRgba('#06B6D4', rangeAlpha);
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, size * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ── 第8步: 行为动画叠加 / Step 8: Behavior animation overlay ──
    this._drawBehaviorAnimation(ctx, behavior, size, time, roleColor, saturation);

    // ── 第9步: 角色图标 / Step 9: Role icon ──
    ctx.save();
    // 重置变换保持图标水平 / Reset transform to keep icon upright
    ctx.setTransform(dpr, 0, 0, dpr, x * dpr, y * dpr);
    const fontSize = Math.max(8, size * 0.45);
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = saturation;
    ctx.fillText(icon, 0, 0);
    ctx.restore();

    // ── 第10步: 子代理徽章 / Step 10: Sub-agent count badge ──
    if (subAgentCount > 0) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, x * dpr, y * dpr);
      const badgeX = size * 0.4;
      const badgeY = -size * 0.4;
      const badgeR = 7;

      // 徽章底色 + 脉冲 / Badge background + pulse
      const badgePulse = 0.9 + 0.1 * Math.sin(time * 3);
      ctx.fillStyle = hexToRgba('#06B6D4', badgePulse);
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
      ctx.fill();

      // 徽章边框 / Badge border
      ctx.strokeStyle = '#0E7490';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 数字文本 / Number text
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(subAgentCount), badgeX, badgeY);
      ctx.restore();
    }

    // ── ID 标签 / ID label ──
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, x * dpr, y * dpr);
    const labelY = size * 0.65 + 10;

    // 短 ID / Short ID
    ctx.fillStyle = hexToRgba('#E5E7EB', 0.9 * saturation);
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(shortId(id), 0, labelY);

    // 角色副标题 / Role subtitle
    ctx.fillStyle = hexToRgba(roleColor, 0.6 * saturation);
    ctx.font = '8px sans-serif';
    ctx.fillText((role || 'bee').toUpperCase(), 0, labelY + 13);

    // 行为标签 (仅选中时) / Behavior label (selected only)
    if (selected && behavior) {
      ctx.fillStyle = hexToRgba('#9CA3AF', 0.7);
      ctx.font = '7px sans-serif';
      ctx.fillText(behavior.en, 0, labelY + 24);
    }
    ctx.restore();

    ctx.restore();
  }

  /**
   * 绘制行为动画叠加 / Draw behavior animation overlay
   * @private
   */
  _drawBehaviorAnimation(ctx, behavior, size, time, color, saturation) {
    if (!behavior) return;

    const alpha = 0.25 * saturation;

    switch (behavior.animation) {
      case 'zigzag-fast': {
        // 警报: 快速锯齿闪烁 / Alarm: fast zigzag flash
        const zOff = Math.sin(time * 12) * size * 0.15;
        ctx.strokeStyle = hexToRgba('#EF4444', 0.4);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-size * 0.3, zOff);
        ctx.lineTo(0, -zOff);
        ctx.lineTo(size * 0.3, zOff);
        ctx.stroke();
        break;
      }

      case 'patrol-arc': {
        // 守卫: 巡逻弧线 / Guard: patrol arc
        const patrolAngle = time * 1.5;
        ctx.strokeStyle = hexToRgba(color, alpha);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.8, patrolAngle, patrolAngle + Math.PI * 1.2);
        ctx.stroke();
        break;
      }

      case 'figure-eight': {
        // 摇摆舞已在状态特效中绘制 / Waggle dance already drawn in state effects
        break;
      }

      case 'circle': {
        // 圆舞 / Round dance
        ctx.strokeStyle = hexToRgba(color, alpha);
        ctx.lineWidth = 0.8;
        ctx.setLineDash([2, 4]);
        ctx.lineDashOffset = -time * 20;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.55, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }

      case 'vibrate': {
        // 扇风: 快速振动 / Fanning: fast vibration
        const vib = Math.sin(time * 25) * 1.5;
        ctx.strokeStyle = hexToRgba('#3B82F6', 0.2);
        ctx.lineWidth = size * 0.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(vib, -0.5);
        ctx.lineTo(vib, 0.5);
        ctx.stroke();
        break;
      }

      case 'hover-near': {
        // 哺育: 柔和光环 / Nursing: soft halo
        const nurseAlpha = 0.06 + 0.04 * Math.sin(time * 2);
        ctx.fillStyle = hexToRgba('#EC4899', nurseAlpha);
        ctx.beginPath();
        ctx.arc(0, 0, size * 1.2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'breathe': {
        // 休息: 呼吸脉冲 / Resting: breathing pulse
        const breathScale = 1 + 0.03 * Math.sin(time * 1.5);
        ctx.strokeStyle = hexToRgba(color, 0.08);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.55 * breathScale, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }

      case 'zigzag-slow': {
        // 采花粉: 慢速锯齿 / Pollinating: slow zigzag
        const pOff = Math.sin(time * 3) * size * 0.1;
        ctx.fillStyle = hexToRgba('#22C55E', 0.15);
        ctx.beginPath();
        ctx.arc(pOff, -pOff, size * 0.08, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(-pOff, pOff, size * 0.06, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'slow-circle': {
        // 清洁: 缓慢旋转 / Cleaning: slow rotation
        const cleanAngle = time * 0.8;
        const cx = Math.cos(cleanAngle) * size * 0.15;
        const cy = Math.sin(cleanAngle) * size * 0.15;
        ctx.fillStyle = hexToRgba(color, 0.12);
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.08, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'follow-trail': {
        // 定向飞行: 方向箭头 / Orienting: direction arrow
        ctx.strokeStyle = hexToRgba('#F5A623', 0.2);
        ctx.lineWidth = 1;
        const arrowLen = size * 0.4;
        ctx.beginPath();
        ctx.moveTo(arrowLen, 0);
        ctx.lineTo(arrowLen - size * 0.12, -size * 0.08);
        ctx.moveTo(arrowLen, 0);
        ctx.lineTo(arrowLen - size * 0.12, size * 0.08);
        ctx.stroke();
        break;
      }

      case 'return-to-hive': {
        // 储存: 内旋螺线 / Storing: inward spiral
        ctx.strokeStyle = hexToRgba(color, 0.1);
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let t = 0; t < Math.PI * 4; t += 0.2) {
          const sr = size * 0.5 * (1 - t / (Math.PI * 4));
          const sx = Math.cos(t + time * 2) * sr;
          const sy = Math.sin(t + time * 2) * sr;
          if (t === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        break;
      }

      default:
        break;
    }
  }
}
