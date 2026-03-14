/**
 * Atmospheric Effects / 环境特效
 *
 * 语义化大气层:
 * - 环境尘埃 (蜂巢花粉感)
 * - 顶部光场与体积光束 (系统活性)
 * - Control 视图扫描线
 * - Alarm 触发时的 glitch + 冲击波 + 轻微震颤
 * - 统一暗角提升聚焦
 *
 * @module canvas/AtmosphericFX
 * @author DEEP-IOS
 */

const DUST_COUNT = 80;
const SCAN_SPEED = 30; // px/s
const AURORA_BANDS = 4;
const LIGHT_RAYS = 3;

export class AtmosphericFX {
  constructor() {
    /** @type {Array<{x:number,y:number,vx:number,vy:number,size:number,alpha:number,life:number}>} */
    this._dust = [];
    /** @type {Array<{speed:number,amp:number,thickness:number,offset:number,hueShift:number}>} */
    this._aurora = [];
    /** @type {Array<{x:number,w:number,speed:number,phase:number}>} */
    this._rays = [];
    this._scanY = 0;
    this._glitchTimer = 0;
    this._glitchActive = false;
    this._time = 0;
    this._auroraPhase = Math.random() * Math.PI * 2;
    this._alarmLevel = 0;
    this._shakeX = 0;
    this._shakeY = 0;
    this._w = 0;
    this._h = 0;
    this._enabled = {
      dust: true,
      scanlines: false,
      glitch: true,
    };
  }

  /**
   * 设置尺寸 / Set dimensions
   * @param {number} w
   * @param {number} h
   */
  resize(w, h) {
    this._w = w;
    this._h = h;
    this._initDust();
    this._initAurora();
    this._initRays();
  }

  /**
   * 设置启用状态 / Set enabled features
   * @param {{ dust?: boolean, scanlines?: boolean, glitch?: boolean }} opts
   */
  setEnabled(opts) {
    Object.assign(this._enabled, opts);
  }

  _initDust() {
    this._dust = [];
    for (let i = 0; i < DUST_COUNT; i++) this._dust.push(this._makeDust());
  }

  _initAurora() {
    this._aurora = [];
    for (let i = 0; i < AURORA_BANDS; i++) {
      this._aurora.push({
        speed: 0.12 + Math.random() * 0.35,
        amp: 22 + Math.random() * 70,
        thickness: 60 + Math.random() * 110,
        offset: Math.random() * Math.PI * 2,
        hueShift: Math.random() * 40 - 20,
      });
    }
  }

  _initRays() {
    this._rays = [];
    for (let i = 0; i < LIGHT_RAYS; i++) {
      this._rays.push({
        x: (i + 1) / (LIGHT_RAYS + 1),
        w: 110 + Math.random() * 120,
        speed: 0.06 + Math.random() * 0.12,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  _makeDust() {
    return {
      x: Math.random() * this._w,
      y: Math.random() * this._h,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.2 - 0.1,
      size: 0.5 + Math.random() * 1.5,
      alpha: 0.05 + Math.random() * 0.1,
      life: 5 + Math.random() * 10,
    };
  }

  /**
   * 更新 / Tick
   * @param {number} dt
   * @param {number} alarmLevel - alarm 信息素浓度 (0-1)
   * @param {string} view - 当前视图
   */
  tick(dt, alarmLevel = 0, view = 'hive') {
    this._time += dt;
    this._alarmLevel = Math.max(0, Math.min(1, alarmLevel || 0));
    this._auroraPhase += dt * (0.22 + this._alarmLevel * 0.35);

    if (this._enabled.dust) {
      for (const d of this._dust) {
        d.x += d.vx;
        d.y += d.vy;
        d.life -= dt;
        if (d.life <= 0 || d.x < 0 || d.x > this._w || d.y < 0 || d.y > this._h) {
          Object.assign(d, this._makeDust());
        }
      }
    }

    if (view === 'control') {
      this._enabled.scanlines = true;
      this._scanY = (this._scanY + SCAN_SPEED * dt) % Math.max(this._h, 1);
    } else {
      this._enabled.scanlines = false;
    }

    if (this._enabled.glitch && alarmLevel > 0.6) {
      this._glitchTimer += dt;
      if (this._glitchTimer > 0.3) {
        this._glitchActive = Math.random() < 0.32;
        this._glitchTimer = 0;
      }
      this._shakeX = (Math.random() - 0.5) * this._alarmLevel * 2.5;
      this._shakeY = (Math.random() - 0.5) * this._alarmLevel * 2.5;
    } else {
      this._glitchActive = false;
      this._glitchTimer = 0;
      this._shakeX *= 0.85;
      this._shakeY *= 0.85;
    }
  }

  /**
   * 绘制 / Draw
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (this._w <= 0 || this._h <= 0) return;

    ctx.save();
    if (Math.abs(this._shakeX) > 0.01 || Math.abs(this._shakeY) > 0.01) {
      ctx.translate(this._shakeX, this._shakeY);
    }

    // 顶部光场
    for (const band of this._aurora) {
      const y = this._h * 0.22 + Math.sin(this._auroraPhase * band.speed + band.offset) * band.amp;
      const grad = ctx.createLinearGradient(0, y, 0, y + band.thickness);
      grad.addColorStop(0, `hsla(${205 + band.hueShift}, 95%, 60%, 0.00)`);
      grad.addColorStop(0.45, `hsla(${220 + band.hueShift}, 85%, 64%, ${0.05 + this._alarmLevel * 0.06})`);
      grad.addColorStop(1, `hsla(${168 + band.hueShift}, 75%, 56%, 0.00)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, y - 40, this._w, band.thickness + 60);
    }

    // 体积光束
    for (const ray of this._rays) {
      const ox = this._w * ray.x + Math.sin(this._time * ray.speed + ray.phase) * 120;
      const alpha = 0.018 + (0.02 * Math.sin(this._time * 0.5 + ray.phase) ** 2);
      const grd = ctx.createLinearGradient(ox, 0, ox + ray.w, this._h);
      grd.addColorStop(0, `rgba(245,166,35,${alpha.toFixed(4)})`);
      grd.addColorStop(0.5, `rgba(59,130,246,${(alpha * 0.6).toFixed(4)})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(ox - ray.w, 0, ray.w * 1.8, this._h);
    }

    if (this._enabled.dust) {
      for (const d of this._dust) {
        ctx.fillStyle = `rgba(255,255,255,${d.alpha})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (this._enabled.scanlines) {
      const grad = ctx.createLinearGradient(0, this._scanY - 20, 0, this._scanY + 20);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(0.5, 'rgba(16,185,129,0.06)');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(0, this._scanY - 20, this._w, 40);

      ctx.fillStyle = 'rgba(255,255,255,0.01)';
      for (let y = 0; y < this._h; y += 3) ctx.fillRect(0, y, this._w, 1);
    }

    if (this._glitchActive) {
      ctx.save();
      const strips = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < strips; i++) {
        const y = Math.random() * this._h;
        const h = 2 + Math.random() * 8;
        const offset = (Math.random() - 0.5) * 20;
        ctx.fillStyle = `rgba(239,68,68,${0.1 + Math.random() * 0.15})`;
        ctx.fillRect(offset, y, this._w, h);
      }
      ctx.restore();
    }

    if (this._alarmLevel > 0.35) {
      const wave = (Math.sin(this._time * (4 + this._alarmLevel * 8)) + 1) * 0.5;
      const radius = 80 + wave * Math.min(this._w, this._h) * 0.35;
      const alpha = 0.06 + this._alarmLevel * 0.11;
      ctx.strokeStyle = `rgba(239,68,68,${alpha.toFixed(4)})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(this._w * 0.5, this._h * 0.5, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 统一暗角
    const vignette = ctx.createRadialGradient(
      this._w * 0.5, this._h * 0.5, Math.min(this._w, this._h) * 0.25,
      this._w * 0.5, this._h * 0.5, Math.max(this._w, this._h) * 0.75,
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, `rgba(0,0,0,${(0.24 + this._alarmLevel * 0.16).toFixed(4)})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this._w, this._h);
    ctx.restore();
  }

  /**
   * 是否有 glitch 活跃 / Is glitch active
   * @returns {boolean}
   */
  isGlitchActive() {
    return this._glitchActive;
  }

  /**
   * 清空 / Clear
   */
  clear() {
    this._dust = [];
    this._aurora = [];
    this._rays = [];
  }
}
