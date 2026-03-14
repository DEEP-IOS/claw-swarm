/**
 * 蜂巢主渲染控制器 / Hive Main Rendering Controller
 *
 * 编排三层画布渲染 + 8 个子系统:
 *   canvas-bg — 六角网格底纹 + 热力图 (按需重绘)
 *   canvas-fx — 粒子 + 轨迹 + 环境特效 (60Hz)
 *   canvas-fg — 蜜蜂 + 子代理 + 交互光束 (60Hz 渲染, 30Hz 物理)
 *
 * V7.0 子系统:
 *   HoneycombGrid   — 六角网格 + 活动热力图
 *   BeeRenderer      — 生物形态蜜蜂 + 12 行为 + Disney 原则
 *   BoidsSystem      — 7 种力 + 270° 视角 + 动量守恒
 *   ParticleSystem   — 10 种粒子类型
 *   TrailSystem      — 方向性 Bezier 轨迹
 *   InteractionBeams — 关系光束 + 流动箭头
 *   SubAgentOrbit    — 子代理轨道 + 孵化动画
 *   AtmosphericFX    — 尘埃 + 扫描线 + Glitch
 *
 * @module console/canvas/HiveRenderer
 * @author DEEP-IOS
 */

import { HoneycombGrid } from './HoneycombGrid.js';
import { BeeRenderer } from './BeeRenderer.js';
import { BoidsSystem } from './BoidsSystem.js';
import { ParticleSystem } from './ParticleSystem.js';
import { TrailSystem } from './TrailSystem.js';
import { InteractionBeams } from './InteractionBeams.js';
import { SubAgentOrbit } from './SubAgentOrbit.js';
import { AtmosphericFX } from './AtmosphericFX.js';
import SemanticZoom from './SemanticZoom.js';
import ContractNetAnimation from './ContractNetAnimation.js';
import FreshnessIndicator, { calcFreshness } from './FreshnessIndicator.js';
import MorphTransitionEngine from './MorphTransition.js';
import { VIEW_TINTS, ROLE_COLORS, MODE_COLORS, hexToRgba } from '../bridge/colors.js';

// ── 物理与渲染常量 / Physics & render constants ──
const PHYSICS_INTERVAL = 33;   // 30Hz ≈ 33ms
const DUST_PROBABILITY = 0.1;  // 每帧生成尘埃的概率 / Per-frame dust spawn chance
const QUEEN_PROBABILITY = 0.02; // architect 蜂王粒子 / Queen particle for architects
const BG_REDRAW_INTERVAL = 500; // 背景重绘最小间隔 (ms) / Min bg redraw interval

export class HiveRenderer {
  /**
   * @param {Object} canvases - 三层画布引用 / Three canvas layer refs
   * @param {HTMLCanvasElement} canvases.canvasBg - 背景层 / Background layer
   * @param {HTMLCanvasElement} canvases.canvasFx - 特效层 / FX layer
   * @param {HTMLCanvasElement} canvases.canvasFg - 前景层 / Foreground layer
   */
  constructor({ canvasBg, canvasFx, canvasFg }) {
    // 画布与上下文 / Canvas elements and contexts
    this._canvasBg = canvasBg;
    this._canvasFx = canvasFx;
    this._canvasFg = canvasFg;
    this.ctxBg = canvasBg.getContext('2d');
    this.ctxFx = canvasFx.getContext('2d');
    this.ctxFg = canvasFg.getContext('2d');

    // 尺寸 (逻辑像素) / Dimensions in logical pixels
    this.width = 0;
    this.height = 0;

    // ── 核心子系统 / Core sub-systems ──
    this.grid = new HoneycombGrid(this.ctxBg, 0, 0);
    this.beeRenderer = new BeeRenderer();
    this.boids = new BoidsSystem();
    this.particles = new ParticleSystem(500);

    // ── V7.0 新子系统 / V7.0 new sub-systems ──
    this.trails = new TrailSystem();
    this.beams = new InteractionBeams();
    this.orbits = new SubAgentOrbit();
    this.atmosphere = new AtmosphericFX();

    // ── V7.0 高级子系统 / V7.0 advanced sub-systems ──
    this.semanticZoom = new SemanticZoom();
    this.contractNet = new ContractNetAnimation();
    this.freshness = new FreshnessIndicator();
    this.morphTransition = new MorphTransitionEngine();

    // 渲染状态 / Render state
    this.view = 'hive';
    this.selectedId = null;
    this.time = 0;
    this.lastPhysics = 0;
    this.lastBgRedraw = 0;
    this.bgDirty = true;
    this.running = false;
    this.animId = null;

    // 功能开关 / Feature toggles
    this.showEdges = false;
    this.showTrails = true;
    this.showSubAgents = true;
    this.perfMode = false;
    this.animationSpeed = 1;
    this.particleDensity = 1;
    this.envParticlesEnabled = true;
    this.glitchEnabled = true;
    this.targetFps = 60;
    this.adaptiveParticleMultiplier = 1;
    this._lastRenderTs = 0;

    // 信息素缓存 (从 store 同步) / Pheromone cache
    this._pheromones = { trail: 0, alarm: 0, recruit: 0, dance: 0, queen: 0, food: 0, danger: 0 };

    // 网络边缓存 / Network edges cache
    this._networkEdges = [];
    this._tasks = [];
    this._taskPositions = new Map();
    this._agentTaskById = new Map();

    // 模式颜色 / Mode color
    this._modeColor = null;

    // 帧计数 (用于周期操作) / Frame counter
    this._frameCount = 0;
  }

  /**
   * 调整所有画布尺寸 / Resize all canvases with DPR
   */
  resize(w, h) {
    this.width = w;
    this.height = h;
    const dpr = window.devicePixelRatio || 1;

    for (const canvas of [this._canvasBg, this._canvasFx, this._canvasFg]) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    this.grid.resize(w, h);
    this.boids.setDimensions(w, h);
    this.atmosphere.resize(w, h);
    if (this._tasks.length > 0) {
      this.syncTasks(this._tasks);
    } else {
      this._computeTargetsForView(this.view);
    }
    this.bgDirty = true;
  }

  /**
   * 切换视图 (含形变过渡) / Switch view with morph transition
   */
  setView(view) {
    const prevView = this.view;
    this.view = view;
    this.bgDirty = true;
    this.atmosphere.setEnabled({ scanlines: view === 'control' });

    // 视图语义切换: 重新计算 Boids 目标位 / Semantic retarget for Boids
    this._computeTargetsForView(view);

    // 启动形变过渡 / Start morph transition
    if (prevView && prevView !== view && this.width > 0) {
      const agentPositions = this.boids.getAgents().map((b) => ({ id: b.id, x: b.x, y: b.y }));
      this.morphTransition.start(prevView, view, agentPositions, this.width, this.height);
      // 视图切换瞬间给每只蜂一个变化爆发 / visual burst on view switch
      for (const b of this.boids.getAgents()) {
        this.particles.emit(b.x, b.y, 'change', this.perfMode ? 3 : 8);
      }
    }
  }

  /**
   * 设置选中代理 / Set selected agent ID
   */
  setSelectedId(id) {
    this.selectedId = id;
  }

  /**
   * 设置功能开关 / Set feature toggles
   */
  setShowEdges(show) { this.showEdges = show; }
  setShowTrails(show) { this.showTrails = show; }
  setShowSubAgents(show) { this.showSubAgents = show; }
  setAnimationSpeed(speed) {
    const n = Number(speed);
    this.animationSpeed = Number.isFinite(n) ? Math.max(0.1, Math.min(3, n)) : 1;
  }
  setParticleDensity(density) {
    const n = Number(density);
    this.particleDensity = Number.isFinite(n) ? Math.max(0.1, Math.min(2, n)) : 1;
    this._syncParticleBudget();
  }
  setEnvParticlesEnabled(enabled) {
    this.envParticlesEnabled = Boolean(enabled);
    this.atmosphere.setEnabled({ dust: this.envParticlesEnabled && !this.perfMode });
  }
  setGlitchEnabled(enabled) {
    this.glitchEnabled = Boolean(enabled);
    this.atmosphere.setEnabled({ glitch: this.glitchEnabled });
  }
  setTargetFps(fps) {
    const n = Number(fps);
    this.targetFps = Number.isFinite(n) ? Math.max(24, Math.min(60, n)) : 60;
  }
  setAdaptiveParticleMultiplier(multiplier) {
    const n = Number(multiplier);
    this.adaptiveParticleMultiplier = Number.isFinite(n) ? Math.max(0.2, Math.min(1.5, n)) : 1;
  }
  _syncParticleBudget() {
    const base = this.perfMode ? 140 : 500;
    this.particles.maxParticles = Math.max(80, Math.round(base * this.particleDensity));
  }
  setPerfMode(mode) {
    this.perfMode = mode;
    this.atmosphere.setEnabled({ dust: this.envParticlesEnabled && !mode });
    this._syncParticleBudget();
  }

  /**
   * 设置模式颜色 / Set mode color for center gradient
   * @param {string} mode - EXPLORE/EXPLOIT/URGENT/RELIABLE/CONSERVE
   */
  setModeColor(mode) {
    this._modeColor = MODE_COLORS[mode] || null;
    this.bgDirty = true;
  }

  /**
   * 同步信息素 / Sync pheromones
   */
  syncPheromones(pheromones) {
    const prev = this._pheromones;
    this._pheromones = { ...pheromones };

    // 传递 alarm 级别给 boids / Pass alarm level to boids
    this.boids.setAlarmLevel(pheromones.alarm || 0);
    if ((pheromones.danger || 0) > 0.25) {
      const zones = this.boids.getAgents()
        .filter((b) => b.state === 'ERROR' || b.state === 'REPORTING')
        .slice(0, 4)
        .map((b) => ({ x: b.x, y: b.y }));
      this.boids.setDangerZones(zones);
    } else {
      this.boids.setDangerZones([]);
    }

    // 信息素蒸发粒子 (检测衰减) / Pheromone evaporation particles
    if (!this.perfMode) {
      for (const key of ['trail', 'recruit', 'dance']) {
        if (prev[key] > 0.3 && pheromones[key] < prev[key] - 0.1) {
          // 在随机位置发射蒸发粒子 / Emit evaporation at random locations
          const count = Math.floor((prev[key] - pheromones[key]) * 5 * this.particleDensity);
          for (let i = 0; i < count; i++) {
            this.particles.emit(
              Math.random() * this.width,
              Math.random() * this.height,
              'evaporate', 1,
            );
          }
        }
      }

      // recruit/queen 信息素提升时强化可见轨迹 / reinforce visibility when pheromone increases
      const recruitRise = (pheromones.recruit || 0) - (prev.recruit || 0);
      if (recruitRise > 0.08) {
        for (const b of this.boids.getAgents()) {
          this.particles.emit(b.x, b.y, 'recruit', Math.max(1, Math.round(this.particleDensity)));
          this.grid.addPheromoneDeposit(b.x, b.y, recruitRise * 0.4);
        }
      }
    }
  }

  /**
   * 同步网络边 / Sync network edges
   */
  syncNetworkEdges(edges) {
    this._networkEdges = edges || [];
  }

  /**
   * 同步子代理 / Sync sub-agents
   */
  syncSubAgents(subAgents) {
    this.orbits.sync(subAgents, ROLE_COLORS);
  }

  /**
   * 同步任务数据 / Sync task data
   * @param {Array<Object>} tasks
   */
  syncTasks(tasks) {
    this._tasks = Array.isArray(tasks) ? tasks : [];
    this._taskPositions = new Map();
    this._agentTaskById = new Map();

    const laneCenters = [0.12, 0.30, 0.5, 0.72, 0.88];
    for (let i = 0; i < this._tasks.length; i++) {
      const t = this._tasks[i];
      const phase = String(t?.phase || t?.status || '').toUpperCase();
      let lane = 2;
      if (phase.includes('CFP') || phase.includes('PENDING')) lane = 0;
      else if (phase.includes('BID')) lane = 1;
      else if (phase.includes('EXEC')) lane = 2;
      else if (phase.includes('QUAL')) lane = 3;
      else if (phase.includes('DONE') || phase.includes('COMPLETE')) lane = 4;

      const taskId = t?.id || t?.taskId || `task-${i}`;
      this._taskPositions.set(taskId, {
        x: this.width * laneCenters[lane],
        y: 120 + (i % 6) * 64,
      });

      const assignee = t?.agent || t?.assigneeId || t?.agentId || null;
      if (assignee) this._agentTaskById.set(assignee, taskId);
    }

    this.boids.setTaskPositions(this._taskPositions);
    this._computeTargetsForView(this.view);
  }

  /**
   * 从 store 同步代理数据并计算目标位置 / Sync agents from store and compute targets
   */
  syncAgents(agents) {
    const withTaskHints = Array.isArray(agents)
      ? agents.map((a) => ({
          ...a,
          taskId: a?.taskId || a?.currentTaskId || this._agentTaskById.get(a?.id) || null,
        }))
      : [];
    this.boids.setAgents(withTaskHints);
    this._computeTargetsForView(this.view);
  }

  /**
   * 根据视图计算目标位 / Compute boid target positions by view
   * @private
   */
  _computeTargetsForView(view) {
    const agents = this.boids.getAgents();
    const count = agents.length;
    if (count === 0) return;

    const targetMap = [];
    const w = this.width;
    const h = this.height;
    const phaseOf = (task) => (task?.phase || task?.status || '').toUpperCase();

    if (view === 'pipeline') {
      const laneX = [0.1, 0.3, 0.5, 0.7, 0.9];
      const taskById = new Map(this._tasks.map((t, idx) => [t?.id || t?.taskId || `task-${idx}`, t]));
      for (let i = 0; i < count; i++) {
        const bee = agents[i];
        const taskId = bee?.taskId || this._agentTaskById.get(bee?.id) || null;
        const task = taskId ? taskById.get(taskId) : null;
        const phase = phaseOf(task || bee);
        let lane = i % laneX.length;
        if (phase.includes('CFP') || phase.includes('PENDING')) lane = 0;
        else if (phase.includes('BID')) lane = 1;
        else if (phase.includes('EXEC')) lane = 2;
        else if (phase.includes('QUAL')) lane = 3;
        else if (phase.includes('DONE') || phase.includes('COMPLETE')) lane = 4;
        const taskPos = taskId ? this._taskPositions.get(taskId) : null;
        targetMap.push({
          id: bee.id,
          x: taskPos?.x ?? (w * laneX[lane]),
          y: taskPos?.y ?? (120 + Math.floor(i / laneX.length) * 86),
        });
      }
    } else if (view === 'cognition') {
      const layerY = [0.22, 0.5, 0.78];
      for (let i = 0; i < count; i++) {
        const layer = i % 3;
        const slot = Math.floor(i / 3);
        const cols = Math.max(2, Math.ceil(count / 3));
        targetMap.push({
          id: agents[i].id,
          x: 80 + (slot / (cols - 1 || 1)) * (w - 160),
          y: h * layerY[layer],
        });
      }
    } else if (view === 'ecology') {
      const colX = [0.18, 0.5, 0.82];
      for (let i = 0; i < count; i++) {
        const bee = agents[i];
        const abc = String(bee.abc || '').toLowerCase();
        let col = 0;
        if (abc === 'onlooker') col = 1;
        else if (abc === 'scout') col = 2;
        targetMap.push({
          id: bee.id,
          x: w * colX[col],
          y: 108 + Math.floor(i / 3) * 80,
        });
      }
    } else if (view === 'network') {
      const cx = w * 0.5;
      const cy = h * 0.5;
      const ring = Math.min(w, h) * 0.32;
      for (let i = 0; i < count; i++) {
        const t = (i / Math.max(count, 1)) * Math.PI * 2;
        const radius = ring * (0.55 + 0.45 * Math.sin(i * 1.7 + this.time * 0.4) ** 2);
        targetMap.push({
          id: agents[i].id,
          x: cx + Math.cos(t) * radius,
          y: cy + Math.sin(t) * radius,
        });
      }
    } else if (view === 'control') {
      const cols = Math.max(2, Math.ceil(Math.sqrt(count)));
      const rows = Math.ceil(count / cols);
      const padX = 96;
      const padY = 120;
      const cellW = (w - padX * 2) / Math.max(cols, 1);
      const cellH = (h - padY * 2) / Math.max(rows, 1);
      for (let i = 0; i < count; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        targetMap.push({
          id: agents[i].id,
          x: padX + col * cellW + cellW * 0.5,
          y: padY + row * cellH + cellH * 0.5,
        });
      }
    } else {
      // hive 默认布局
      const cx = w * 0.5;
      const cy = h * 0.5;
      const maxRadius = Math.min(w, h) * 0.35;
      if (count === 1) {
        targetMap.push({ id: agents[0].id, x: cx, y: cy });
      } else {
        let placed = 0;
        let ring = 0;
        while (placed < count) {
          ring++;
          const radius = maxRadius * (ring / Math.ceil(Math.sqrt(count)));
          const perRing = ring === 1 ? 1 : Math.floor(2 * Math.PI * ring);
          const toPlace = Math.min(perRing, count - placed);
          for (let i = 0; i < toPlace; i++) {
            const angle = (i / toPlace) * Math.PI * 2 - Math.PI / 2;
            const r = ring === 1 ? 0 : radius;
            targetMap.push({
              id: agents[placed].id,
              x: cx + Math.cos(angle) * r,
              y: cy + Math.sin(angle) * r,
            });
            placed++;
          }
        }
      }
    }

    this.boids.setTargets(targetMap);
  }

  /**
   * 启动动画循环 / Start animation loop
   */
  start() {
    if (this.running) return;
    this.running = true;

    const frame = (timestamp) => {
      if (!this.running) return;

      const minFrameInterval = 1000 / this.targetFps;
      if (this._lastRenderTs && timestamp - this._lastRenderTs < minFrameInterval) {
        this.animId = requestAnimationFrame(frame);
        return;
      }

      const frameDt = this._lastRenderTs ? (timestamp - this._lastRenderTs) / 1000 : 0.016;
      this._lastRenderTs = timestamp;
      this.time = timestamp / 1000;
      this._frameCount++;
      const dt = frameDt * this.animationSpeed;
      const emissionScale = Math.max(
        0.05,
        this.particleDensity * this.adaptiveParticleMultiplier * (this.perfMode ? 0.6 : 1),
      );

      // ── 高级子系统更新 / Advanced sub-system updates ──
      this.semanticZoom.update(dt);
      this.freshness.update(dt);

      // ── 形变过渡更新 / Morph transition update ──
      const morphState = this.morphTransition.update(performance.now(), dt);

      // ── ContractNet 动画更新 / ContractNet animation update ──
      if (this.contractNet.active) {
        this.contractNet.update(performance.now());
      }

      // ── 物理 30Hz / Physics at 30Hz ──
      if (timestamp - this.lastPhysics > PHYSICS_INTERVAL) {
        const physicsDt = 0.033 * this.animationSpeed;
        this.boids.tick(physicsDt);
        this.orbits.tick(physicsDt);
        this.beams.tick(physicsDt);
        this.lastPhysics = timestamp;
      }

      // ── 形变过渡: 覆盖 Agent 位置 / Morph: override agent positions ──
      if (morphState.active) {
        const boids = this.boids.getAgents();
        for (const bee of boids) {
          const morphPos = morphState.agentPositions.get(bee.id);
          if (morphPos) {
            bee.x = morphPos.x;
            bee.y = morphPos.y;
          }
        }
      }

      // ── 粒子 60Hz / Particles at 60Hz ──
      this.particles.tick(dt);
      this.atmosphere.tick(dt, this._pheromones.alarm || 0, this.view);

      // ── 环境尘埃 / Ambient dust ──
      if (!this.perfMode && this.envParticlesEnabled && Math.random() < DUST_PROBABILITY * emissionScale) {
        this.particles.emit(
          Math.random() * this.width,
          Math.random() * this.height,
          'dust', 1,
        );
      }

      // ── Agent 状态粒子 + 热力图 + 信息素粒子 / Agent particles + heatmap + pheromone particles ──
      const boids = this.boids.getAgents();
      for (const bee of boids) {
        // 记录轨迹 / Record trail
        if (this.showTrails) {
          this.trails.record(bee.id, bee.x, bee.y, bee.role);
        }

        // 活动热力图 (每 5 帧记录一次) / Activity heatmap (every 5 frames)
        if (this._frameCount % 5 === 0) {
          this.grid.addHeat(bee.x, bee.y, 0.008);
        }

        if ((this._pheromones.trail || 0) > 0.35 && this._frameCount % 12 === 0) {
          this.grid.addPheromoneDeposit(bee.x, bee.y, 0.01 + this._pheromones.trail * 0.015);
        }

        // EXECUTING 金色粒子 / EXECUTING golden particles
        if (bee.state === 'EXECUTING' && Math.random() < 0.05 * emissionScale) {
          this.particles.emit(bee.x, bee.y, 'trail', 1);
        }
        // REPORTING 舞蹈粒子 / REPORTING dance particles
        if (bee.state === 'REPORTING' && Math.random() < 0.03 * emissionScale) {
          this.particles.emit(bee.x, bee.y, 'dance', 1);
        }

        // Architect 蜂王粒子 / Architect queen particles
        if (bee.role === 'architect' && !this.perfMode && Math.random() < QUEEN_PROBABILITY * emissionScale) {
          this.particles.emit(bee.x, bee.y, 'queen', 1);
        }

        if ((this._pheromones.food || 0) > 0.35 && bee.state === 'EXECUTING' && Math.random() < 0.02 * emissionScale) {
          this.particles.emit(bee.x, bee.y, 'energy', 1, {
            targetX: this.width * 0.5,
            targetY: this.height * 0.5,
          });
        }
      }

      // ── 信息素驱动粒子 / Pheromone-driven particles ──
      if (!this.perfMode) {
        // food 信息素 → 食物粒子 / Food pheromone → food particles
        if (this._pheromones.food > 0.3 && Math.random() < 0.02 * emissionScale) {
          this.particles.emit(
            Math.random() * this.width,
            Math.random() * this.height,
            'food', 1,
          );
        }
        // danger 信息素 → 危险粒子 / Danger pheromone → danger particles
        if (this._pheromones.danger > 0.4 && Math.random() < 0.03 * emissionScale) {
          this.particles.emit(
            Math.random() * this.width,
            Math.random() * this.height,
            'danger', 1,
          );
        }
        // alarm 信息素 → 警报粒子 / Alarm pheromone → alarm particles
        if (this._pheromones.alarm > 0.5 && Math.random() < 0.04 * emissionScale) {
          this.particles.emit(
            this.width * 0.5 + (Math.random() - 0.5) * this.width * 0.6,
            this.height * 0.5 + (Math.random() - 0.5) * this.height * 0.6,
            'alarm', 2,
          );
        }
      }

      // ── 更新交互光束位置 / Update beam positions ──
      if (this.showEdges && this._networkEdges.length > 0) {
        const posMap = new Map();
        for (const b of boids) posMap.set(b.id, { x: b.x, y: b.y });
        this.beams.setEdges(this._networkEdges, posMap);
      }

      // ── 背景层 (条件重绘) / Background layer (conditional redraw) ──
      // 热力图需要定期重绘 / Heatmap needs periodic redraw
      const bgNeedsRedraw = this.bgDirty ||
        (this.grid._heatmap.size > 0 && timestamp - this.lastBgRedraw > BG_REDRAW_INTERVAL);

      if (bgNeedsRedraw) {
        this.grid.setDynamicState(this.time, this._pheromones.alarm || 0);
        this.ctxBg.clearRect(0, 0, this.width, this.height);
        this.grid.draw(VIEW_TINTS[this.view] || VIEW_TINTS.hive, this._modeColor);
        this.bgDirty = false;
        this.lastBgRedraw = timestamp;
      }

      // ── 特效层 / FX layer ──
      this.ctxFx.clearRect(0, 0, this.width, this.height);
      if (this.showTrails) {
        this.trails.draw(this.ctxFx, this._pheromones.trail || 0);
      }
      this.particles.draw(this.ctxFx);
      this.atmosphere.draw(this.ctxFx);

      // ── 前景层 / FG layer ──
      this.ctxFg.clearRect(0, 0, this.width, this.height);

      // 交互光束 / Interaction beams
      if (this.showEdges) {
        if (this._networkEdges.length > 0) {
          this.beams.draw(this.ctxFg);
        } else if (boids.length > 1) {
          this._drawEdges(boids);
        }
      }

      // 子代理轨道 / Sub-agent orbits
      if (this.showSubAgents) {
        const parentPos = new Map();
        for (const b of boids) parentPos.set(b.id, { x: b.x, y: b.y });
        this.orbits.draw(this.ctxFg, parentPos);
      }

      // 蜜蜂 (传递信息素给行为判定) / Bees (pass pheromones for behavior)
      for (const bee of boids) {
        bee.selected = (bee.id === this.selectedId);
        this.beeRenderer.draw(this.ctxFg, bee, this.time, this._pheromones);
      }

      // ContractNet 序列动画 / ContractNet sequence animation
      if (this.contractNet.active) {
        this.contractNet.draw(this.ctxFg);
      }

      // 新鲜度指示器 (右上角) / Freshness indicator (top-right corner)
      this.freshness.draw(this.ctxFg, this.width - 16, 16, 8);

      this.animId = requestAnimationFrame(frame);
    };

    this.animId = requestAnimationFrame(frame);
  }

  /**
   * 绘制代理连线 (fallback, 无网络边时) / Draw edges (fallback when no network edges)
   * @private
   */
  _drawEdges(boids) {
    const ctx = this.ctxFg;
    const maxDist = 150;

    ctx.save();
    ctx.lineWidth = 0.5;

    for (let i = 0; i < boids.length; i++) {
      for (let j = i + 1; j < boids.length; j++) {
        const a = boids[i], b = boids[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < maxDist) {
          const alpha = (1 - dist / maxDist) * 0.15;
          const color = ROLE_COLORS[a.role] || ROLE_COLORS.default;
          ctx.strokeStyle = hexToRgba(color, alpha);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  /**
   * 停止动画循环 / Stop animation loop
   */
  stop() {
    this.running = false;
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
    this._lastRenderTs = 0;
  }

  /**
   * 处理滚轮缩放 / Handle wheel zoom
   * @param {number} deltaY
   * @param {number} mouseX
   * @param {number} mouseY
   */
  handleWheel(deltaY, mouseX, mouseY) {
    this.semanticZoom.handleWheel(deltaY, mouseX, mouseY);
  }

  /**
   * 更新连接新鲜度 / Update connection freshness
   * @param {boolean} sseConnected
   * @param {number|null} lastEventTime
   */
  updateFreshness(sseConnected, lastEventTime) {
    this.freshness.setLevel(calcFreshness(sseConnected, lastEventTime));
  }

  /**
   * 启动 ContractNet 序列动画 / Start ContractNet sequence animation
   * @param {number} taskX
   * @param {number} taskY
   * @param {Array} bidders
   * @param {string} winnerId
   */
  startContractNetAnimation(taskX, taskY, bidders, winnerId) {
    this.contractNet.start(taskX, taskY, bidders, winnerId);
  }

  /**
   * 处理画布点击 / Handle canvas click
   */
  handleClick(canvasX, canvasY) {
    const boids = this.boids.getAgents();
    let closest = null;
    let minDist = 30;

    for (const b of boids) {
      const dx = b.x - canvasX;
      const dy = b.y - canvasY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        minDist = dist;
        closest = b;
      }
    }

    // Disney 压缩拉伸: 点击时触发 / Disney squash-stretch on click
    if (closest) {
      this.beeRenderer.triggerSquash(closest.id, this.time);
    }

    return closest?.id || null;
  }

  /**
   * 在指定代理位置发射粒子 / Emit particles at agent position
   */
  emitAtAgent(agentId, type, count = 8) {
    const boid = this.boids.getAgents().find((b) => b.id === agentId);
    if (boid) {
      this.particles.emit(boid.x, boid.y, type, count);
    }
  }

  /**
   * 状态变化爆发 / State change burst
   */
  emitChangeBurst(agentId) {
    const boid = this.boids.getAgents().find((b) => b.id === agentId);
    if (boid) {
      this.particles.emit(boid.x, boid.y, 'change', 12);
    }
  }

  /**
   * 全屏红闪 (断路器触发) / Full screen red flash (breaker trigger)
   */
  flashRed() {
    // 发射大量 alarm 粒子覆盖全屏 / Emit alarm particles covering full screen
    for (let i = 0; i < 20; i++) {
      this.particles.emit(
        Math.random() * this.width,
        Math.random() * this.height,
        'alarm', 3,
      );
    }
  }

  /**
   * 销毁渲染器 / Destroy renderer
   */
  destroy() {
    this.stop();
    this.particles.clear();
    this.trails.clear();
    this.beams.clear();
    this.orbits.clear();
    this.atmosphere.clear();
    this.grid.clearHeat();
    this.contractNet.cancel();
    this.morphTransition.cancel();
    this.semanticZoom.reset();
  }
}
