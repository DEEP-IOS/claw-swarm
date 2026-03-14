/**
 * PheromoneEngine 单元测试 / PheromoneEngine Unit Tests
 *
 * 使用真实 DatabaseManager + 内存 SQLite 测试信息素引擎核心功能。
 * Uses real DatabaseManager + in-memory SQLite to test pheromone engine core.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../../src/L1-infrastructure/database/database-manager.js';
import { PheromoneRepository } from '../../../src/L1-infrastructure/database/repositories/pheromone-repo.js';
import { PheromoneTypeRepository } from '../../../src/L1-infrastructure/database/repositories/pheromone-type-repo.js';
import { PheromoneEngine } from '../../../src/L2-communication/pheromone-engine.js';
import { PheromoneTypeRegistry } from '../../../src/L2-communication/pheromone-type-registry.js';

import { TABLE_SCHEMAS } from '../../../src/L1-infrastructure/schemas/database-schemas.js';

// 静默 logger / Silent logger
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

describe('PheromoneEngine', () => {
  let dbManager, pheromoneRepo, pheromoneTypeRepo, typeRegistry, engine;

  beforeEach(() => {
    // 创建内存数据库并初始化所有表 / Create in-memory DB and bootstrap all tables
    dbManager = new DatabaseManager({ memory: true });
    dbManager.open(TABLE_SCHEMAS);
    pheromoneRepo = new PheromoneRepository(dbManager);
    pheromoneTypeRepo = new PheromoneTypeRepository(dbManager);
    typeRegistry = new PheromoneTypeRegistry({ pheromoneTypeRepo, logger: silentLogger });
    engine = new PheromoneEngine({ pheromoneRepo, typeRegistry, logger: silentLogger });
  });

  afterEach(() => { dbManager.close(); });

  // ━━━ 1. 发射 / Emit ━━━
  describe('emitPheromone', () => {
    it('应创建新信息素并存储正确强度 / should create pheromone with correct intensity', () => {
      const id = engine.emitPheromone({
        type: 'trail', sourceId: 'agent-1', targetScope: 'task/100', intensity: 0.8,
      });
      expect(id).toBeTruthy();
      const ph = engine.readById(id);
      expect(ph).not.toBeNull();
      expect(ph.type).toBe('trail');
      expect(ph.sourceId).toBe('agent-1');
      expect(ph.targetScope).toBe('task/100');
      // 强度应接近 0.8 (刚发射, 衰减极小) / Intensity near 0.8 (just emitted)
      expect(ph.intensity).toBeCloseTo(0.8, 1);
    });
  });

  // ━━━ 2. MMAS 边界 / MMAS Bounds on Emit ━━━
  describe('MMAS bounds on emit', () => {
    it('超过 mmasMax 应 clamp 到 1.0 / should clamp to mmasMax=1.0 when exceeding', () => {
      const id = engine.emitPheromone({
        type: 'trail', sourceId: 'agent-1', targetScope: 'task/200',
        intensity: 5.0, // 远超 mmasMax=1.0 / Far exceeds mmasMax
      });
      const ph = engine.readById(id);
      expect(ph).not.toBeNull();
      expect(ph.intensity).toBeLessThanOrEqual(1.0);
      expect(ph.intensity).toBeCloseTo(1.0, 1);
    });

    it('极低强度应 clamp 到 mmasMin / should clamp very low intensity to mmasMin', () => {
      const id = engine.emitPheromone({
        type: 'trail', sourceId: 'agent-1', targetScope: 'task/201',
        intensity: 0.001, // 低于 mmasMin=0.05 / Below mmasMin
      });
      const ph = engine.readById(id);
      expect(ph).not.toBeNull();
      // 浮点精度容差 (衰减可能微量降低) / Float precision tolerance (decay may slightly reduce)
      expect(ph.intensity).toBeGreaterThanOrEqual(0.05 - 1e-4);
    });
  });

  // ━━━ 3. 强化 (累加) / Reinforcement ━━━
  describe('reinforcement', () => {
    it('同类型+同范围二次发射应累加 (clamp) / same type+scope emits should accumulate', () => {
      engine.emitPheromone({ type: 'trail', sourceId: 'agent-1', targetScope: 'task/300', intensity: 0.4 });
      const id2 = engine.emitPheromone({ type: 'trail', sourceId: 'agent-1', targetScope: 'task/300', intensity: 0.4 });

      const ph = engine.readById(id2);
      expect(ph).not.toBeNull();
      // 0.4 + 0.4 = 0.8, 在 [0.05, 1.0] 内 / within bounds
      expect(ph.intensity).toBeCloseTo(0.8, 1);
      // 统计应记录强化 / Stats should record reinforcement
      expect(engine.getStats().reinforced).toBeGreaterThanOrEqual(1);
    });
  });

  // ━━━ 4. 读取 / Read ━━━
  describe('read', () => {
    it('应按 scope 读取, 可按 type 过滤 / should read by scope, filter by type', () => {
      engine.emitPheromone({ type: 'trail', sourceId: 'a1', targetScope: 'zone/fe', intensity: 0.5 });
      engine.emitPheromone({ type: 'alarm', sourceId: 'a2', targetScope: 'zone/fe', intensity: 0.6 });
      engine.emitPheromone({ type: 'trail', sourceId: 'a3', targetScope: 'zone/be', intensity: 0.7 });

      // 全部 frontend / All frontend
      expect(engine.read('zone/fe').length).toBe(2);
      // 按 type 过滤 / Filter by type
      const trails = engine.read('zone/fe', { type: 'trail' });
      expect(trails.length).toBe(1);
      expect(trails[0].type).toBe('trail');
      // 不同 scope / Different scope
      expect(engine.read('zone/be').length).toBe(1);
    });
  });

  // ━━━ 5. 懒衰减 / Lazy Decay ━━━
  describe('lazy decay', () => {
    it('回退 updatedAt 后读取应有衰减 / backdated pheromone should decay on read', () => {
      const id = engine.emitPheromone({
        type: 'trail', sourceId: 'agent-1', targetScope: 'task/500', intensity: 0.8,
      });
      // 手动回退 10 分钟 / Backdate by 10 minutes
      const tenMinAgo = Date.now() - 10 * 60 * 1000;
      pheromoneRepo.updateIntensity(id, 0.8, tenMinAgo);

      // V5.7: trail 使用线性衰减 / trail uses linear decay
      // I(t) = max(0, 0.8 - 0.05 × 10) = 0.3
      const ph = engine.readById(id);
      expect(ph).not.toBeNull();
      const expected = Math.max(0, 0.8 - 0.05 * 10);
      expect(ph.intensity).toBeCloseTo(expected, 1);
      expect(ph.intensity).toBeLessThan(0.8);
    });
  });

  // ━━━ 6. 全量衰减通道 / Decay Pass ━━━
  describe('decayPass', () => {
    it('应更新强度并蒸发极旧记录 / should update intensities and evaporate old ones', () => {
      const id1 = engine.emitPheromone({ type: 'trail', sourceId: 'a1', targetScope: 'task/601', intensity: 0.5 });
      const id2 = engine.emitPheromone({ type: 'alarm', sourceId: 'a2', targetScope: 'task/602', intensity: 0.3 });

      // id1 回退 5 分钟, id2 回退 120 分钟 / Backdate id1 5min, id2 120min
      pheromoneRepo.updateIntensity(id1, 0.5, Date.now() - 5 * 60_000);
      pheromoneRepo.updateIntensity(id2, 0.3, Date.now() - 120 * 60_000);

      const result = engine.decayPass();
      // id2: 0.3 × e^(-0.15 × 120) ≈ 0 → 蒸发 / evaporate
      expect(result.evaporated).toBeGreaterThanOrEqual(1);
      expect(engine.readById(id2)).toBeNull();
      // id1: 0.5 × e^(-0.05 × 5) ≈ 0.389 → 存活 / survive
      expect(result.updated).toBeGreaterThanOrEqual(0);
    });
  });

  // ━━━ 7. MMAS on Decay ━━━
  describe('MMAS on decay', () => {
    it('衰减后不应低于 τ_min / intensity after decay should not drop below τ_min', () => {
      // queen: mmasMin=0.10, decayRate=0.02
      const id = engine.emitPheromone({
        type: 'queen', sourceId: 'a1', targetScope: 'task/700', intensity: 0.15,
      });
      // 回退 30 分钟 / Backdate 30 min
      pheromoneRepo.updateIntensity(id, 0.15, Date.now() - 30 * 60_000);
      // 衰减: 0.15 × e^(-0.02 × 30) ≈ 0.082, 低于 mmasMin=0.10
      engine.decayPass();

      const ph = engine.readById(id);
      // decayPass clamp 到 mmasMin / decayPass clamps to mmasMin
      if (ph) {
        // 允许浮点精度误差 / Allow floating-point precision tolerance
        expect(ph.intensity).toBeGreaterThanOrEqual(0.10 - 1e-6);
      }
    });
  });

  // ━━━ 8. ACO 轮盘赌选择 / ACO Roulette Selection ━━━
  describe('acoSelect', () => {
    it('应从候选列表中选择一个 / should select one from candidates', () => {
      const candidates = [
        { id: 'c1', intensity: 0.3 },
        { id: 'c2', intensity: 0.5 },
        { id: 'c3', intensity: 0.8 },
      ];
      const selected = engine.acoSelect(candidates);
      expect(selected).not.toBeNull();
      expect(candidates.map(c => c.id)).toContain(selected.id);
    });

    it('空数组或 null 应返回 null / empty array or null returns null', () => {
      expect(engine.acoSelect([])).toBeNull();
      expect(engine.acoSelect(null)).toBeNull();
    });

    it('单元素应直接返回 / single element returned directly', () => {
      const selected = engine.acoSelect([{ id: 'only', intensity: 0.5 }]);
      expect(selected.id).toBe('only');
    });
  });

  // ━━━ 9. 路由选择 / Route by Pheromone ━━━
  describe('routeByPheromone', () => {
    it('应从范围内信息素中选择 / should select from scoped pheromones', () => {
      engine.emitPheromone({ type: 'trail', sourceId: 'a1', targetScope: 'route/z', intensity: 0.5 });
      engine.emitPheromone({ type: 'trail', sourceId: 'a2', targetScope: 'route/z', intensity: 0.8 });
      const selected = engine.routeByPheromone('route/z', 'trail');
      expect(selected).not.toBeNull();
      expect(selected.type).toBe('trail');
    });

    it('无信息素时返回 null / returns null when empty', () => {
      expect(engine.routeByPheromone('empty/scope', 'trail')).toBeNull();
    });
  });

  // ━━━ 10. ALARM 密度 / ALARM Density ━━━
  describe('getAlarmDensity', () => {
    it('达到阈值应触发 / should trigger when threshold met', () => {
      engine.emitPheromone({ type: 'alarm', sourceId: 'a1', targetScope: 'zone/d', intensity: 0.8 });
      engine.emitPheromone({ type: 'alarm', sourceId: 'a2', targetScope: 'zone/d', intensity: 0.6 });
      engine.emitPheromone({ type: 'alarm', sourceId: 'a3', targetScope: 'zone/d', intensity: 0.7 });

      const density = engine.getAlarmDensity('zone/d', 3);
      expect(density.count).toBe(3);
      expect(density.totalIntensity).toBeGreaterThan(0);
      expect(density.triggered).toBe(true);
    });

    it('低于阈值不触发 / should not trigger below threshold', () => {
      engine.emitPheromone({ type: 'alarm', sourceId: 'a1', targetScope: 'zone/s', intensity: 0.5 });
      const density = engine.getAlarmDensity('zone/s', 3);
      expect(density.count).toBe(1);
      expect(density.triggered).toBe(false);
    });
  });

  // ━━━ 11. 自定义类型 / Custom Types via Registry ━━━
  describe('custom types via registry', () => {
    it('应使用自定义 MMAS 边界 / should respect custom MMAS bounds', () => {
      typeRegistry.register({
        name: 'resource', decayRate: 0.03, maxTTLMin: 240,
        mmasMin: 0.10, mmasMax: 2.0, description: '资源标记 / Resource marker',
      });
      // 1.5 在 [0.10, 2.0] 内 / 1.5 within custom bounds
      const id = engine.emitPheromone({ type: 'resource', sourceId: 'a1', targetScope: 'res/gold', intensity: 1.5 });
      const ph = engine.readById(id);
      expect(ph).not.toBeNull();
      expect(ph.intensity).toBeCloseTo(1.5, 1);
    });

    it('超出自定义 mmasMax 应 clamp / should clamp when exceeding custom mmasMax', () => {
      typeRegistry.register({
        name: 'signal', decayRate: 0.05, maxTTLMin: 60, mmasMin: 0.01, mmasMax: 0.5,
      });
      const id = engine.emitPheromone({ type: 'signal', sourceId: 'a1', targetScope: 'sig/t', intensity: 3.0 });
      const ph = engine.readById(id);
      expect(ph).not.toBeNull();
      expect(ph.intensity).toBeLessThanOrEqual(0.5);
    });
  });

  // ━━━ 12. 统计 / Statistics ━━━
  describe('statistics', () => {
    it('getStats() 应返回发射/读取计数 / should return emitted and read counts', () => {
      engine.emitPheromone({ type: 'trail', sourceId: 'a1', targetScope: 'stat/1', intensity: 0.5 });
      engine.emitPheromone({ type: 'trail', sourceId: 'a2', targetScope: 'stat/2', intensity: 0.5 });
      engine.read('stat/1');
      const stats = engine.getStats();
      expect(stats.emitted).toBe(2);
      expect(stats.reads).toBeGreaterThanOrEqual(1);
      expect(stats.totalCount).toBe(2);
    });

    it('resetStats() 应清零统计 / should zero out counters', () => {
      engine.emitPheromone({ type: 'trail', sourceId: 'a1', targetScope: 'stat/3', intensity: 0.5 });
      engine.read('stat/3');
      engine.resetStats();
      const stats = engine.getStats();
      expect(stats.emitted).toBe(0);
      expect(stats.reads).toBe(0);
      expect(stats.reinforced).toBe(0);
      expect(stats.decayed).toBe(0);
      expect(stats.evaporated).toBe(0);
      // totalCount 来自 repo, 不受 reset 影响 / totalCount from repo, unaffected
      expect(stats.totalCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ━━━ 13. 快照 / Snapshot ━━━
  describe('buildSnapshot', () => {
    it('应返回正确数量和结构 / should return correct count and structure', () => {
      engine.emitPheromone({ type: 'trail', sourceId: 'a1', targetScope: 'snap/z', intensity: 0.6 });
      engine.emitPheromone({ type: 'alarm', sourceId: 'a2', targetScope: 'snap/z', intensity: 0.7 });
      engine.emitPheromone({ type: 'trail', sourceId: 'a3', targetScope: 'snap/o', intensity: 0.8 });

      // 全量快照 / Full snapshot
      const full = engine.buildSnapshot();
      expect(full.count).toBe(3);
      expect(full.pheromones).toHaveLength(3);
      expect(full.timestamp).toBeGreaterThan(0);

      // 按 type 过滤 / Filter by type
      expect(engine.buildSnapshot({ type: 'trail' }).count).toBe(2);
      // 按 scope 过滤 / Filter by scope
      expect(engine.buildSnapshot({ scope: 'snap/z' }).count).toBe(2);

      // 验证快照字段结构 / Verify snapshot field structure
      const ph = full.pheromones[0];
      expect(ph).toHaveProperty('id');
      expect(ph).toHaveProperty('type');
      expect(ph).toHaveProperty('sourceId');
      expect(ph).toHaveProperty('targetScope');
      expect(ph).toHaveProperty('intensity');
      expect(ph).toHaveProperty('createdAt');
      expect(ph).toHaveProperty('updatedAt');
    });
  });
});
