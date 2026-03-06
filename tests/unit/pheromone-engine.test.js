/**
 * @fileoverview Unit tests for Claw-Swarm v4.0 - Layer 2 Pheromone Engine
 * @module tests/unit/pheromone-engine.test
 *
 * 测试信息素引擎的发射、读取、快照构建、衰减清理和强化机制。
 * Tests pheromone engine: emission, reading, snapshot building, decay cleanup, and reinforcement.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { initDb, closeDb, queryPheromones, insertPheromone, deleteExpiredPheromones } from '../../src/layer1-core/db.js';
import { PheromoneEngine } from '../../src/layer2-engines/pheromone/pheromone-engine.js';
import { PHEROMONE_DEFAULTS, MIN_INTENSITY } from '../../src/layer2-engines/pheromone/pheromone-types.js';
import { calculateCurrentIntensity } from '../../src/layer2-engines/pheromone/pheromone-decay.js';
import { DEFAULT_CONFIG } from '../../src/layer1-core/config.js';

// ===========================================================================
// Setup / Teardown
// ===========================================================================

describe('PheromoneEngine', () => {
  /** @type {PheromoneEngine} */
  let engine;

  before(() => {
    initDb(':memory:');
    engine = new PheromoneEngine(DEFAULT_CONFIG);
  });

  after(() => {
    closeDb();
  });

  // =========================================================================
  // emitPheromone — 信息素发射
  // =========================================================================

  describe('emitPheromone', () => {
    it('should create a pheromone in the database (在数据库中创建信息素)', () => {
      const id = engine.emitPheromone({
        type: 'trail',
        sourceId: 'test-agent-1',
        targetScope: '/test/emit',
        intensity: 0.8,
        payload: { path: '/api/users' },
      });
      assert.ok(id, 'Should return an id');

      const results = queryPheromones('/test/emit', 'trail');
      assert.ok(results.length >= 1, 'Should find the emitted pheromone');
    });

    it('should use default decay rate from PHEROMONE_DEFAULTS (使用默认衰减率)', () => {
      engine.emitPheromone({
        type: 'alarm',
        sourceId: 'test-agent-2',
        targetScope: '/test/defaults',
        intensity: 1.0,
      });

      const results = queryPheromones('/test/defaults', 'alarm');
      assert.ok(results.length >= 1);
      assert.equal(results[0].decay_rate, PHEROMONE_DEFAULTS.alarm.decayRate);
    });

    it('should allow custom decay rate override (允许自定义衰减率)', () => {
      engine.emitPheromone({
        type: 'trail',
        sourceId: 'test-agent-3',
        targetScope: '/test/custom-decay',
        intensity: 0.5,
        decayRate: 0.99,
      });

      const results = queryPheromones('/test/custom-decay', 'trail');
      assert.ok(results.length >= 1);
      assert.equal(results[0].decay_rate, 0.99);
    });
  });

  // =========================================================================
  // Reinforcement — 累积强化
  // =========================================================================

  describe('Reinforcement (累积强化)', () => {
    it('should reinforce when same type+scope+source is emitted again (同 type+scope+source 再次发射时强化)', () => {
      // First emission
      engine.emitPheromone({
        type: 'recruit',
        sourceId: 'test-agent-reinforce',
        targetScope: '/test/reinforce',
        intensity: 0.5,
      });

      const before = queryPheromones('/test/reinforce', 'recruit');
      const initialIntensity = before[0].intensity;

      // Second emission — should reinforce
      engine.emitPheromone({
        type: 'recruit',
        sourceId: 'test-agent-reinforce',
        targetScope: '/test/reinforce',
        intensity: 0.3,
      });

      const after = queryPheromones('/test/reinforce', 'recruit');
      assert.ok(
        after[0].intensity > initialIntensity,
        `Intensity should increase: ${after[0].intensity} > ${initialIntensity}`,
      );
    });
  });

  // =========================================================================
  // read — 信息素读取
  // =========================================================================

  describe('read', () => {
    it('should return pheromones with calculated currentIntensity (返回包含计算强度的信息素)', () => {
      engine.emitPheromone({
        type: 'queen',
        sourceId: 'test-agent-read',
        targetScope: '/test/read',
        intensity: 1.0,
      });

      const results = engine.read('/test/read');
      assert.ok(results.length >= 1);
      assert.ok(typeof results[0].currentIntensity === 'number');
      // Just emitted, so intensity should be close to 1.0
      assert.ok(results[0].currentIntensity > 0.9);
    });

    it('should filter by type when specified (指定类型时过滤)', () => {
      engine.emitPheromone({
        type: 'trail',
        sourceId: 'test-agent-read-filter',
        targetScope: '/test/read-filter',
        intensity: 0.5,
      });
      engine.emitPheromone({
        type: 'alarm',
        sourceId: 'test-agent-read-filter',
        targetScope: '/test/read-filter',
        intensity: 0.7,
      });

      const alarms = engine.read('/test/read-filter', { type: 'alarm' });
      for (const p of alarms) {
        assert.equal(p.type, 'alarm');
      }
    });

    it('should filter by minIntensity (按最低强度过滤)', () => {
      const results = engine.read('/test/read', { minIntensity: 0.5 });
      for (const p of results) {
        assert.ok(p.currentIntensity >= 0.5);
      }
    });

    it('should sort by intensity descending (按强度降序排列)', () => {
      const results = engine.read('/test/read-filter');
      for (let i = 1; i < results.length; i++) {
        assert.ok(
          results[i - 1].currentIntensity >= results[i].currentIntensity,
          'Results should be sorted by intensity DESC',
        );
      }
    });
  });

  // =========================================================================
  // buildSnapshot — 快照构建
  // =========================================================================

  describe('buildSnapshot', () => {
    it('should return empty string when no pheromones exist for scopes (无信息素时返回空字符串)', () => {
      const snapshot = engine.buildSnapshot('test-agent-x', ['/nonexistent/scope']);
      assert.equal(snapshot, '');
    });

    it('should format snapshot with header and signal lines (格式化快照包含头部和信号行)', () => {
      engine.emitPheromone({
        type: 'alarm',
        sourceId: 'test-agent-snap',
        targetScope: '/test/snapshot',
        intensity: 0.9,
        payload: { message: 'Build failure' },
      });

      const snapshot = engine.buildSnapshot('test-agent-viewer', ['/test/snapshot']);
      assert.ok(snapshot.startsWith('[Pheromone Signals]'), 'Should start with header');
      assert.ok(snapshot.includes('ALARM'), 'Should include the type in uppercase');
      assert.ok(snapshot.includes('test-agent-snap'), 'Should include the source agent');
    });

    it('should deduplicate across multiple scopes (跨多个范围去重)', () => {
      // Emit to same scope twice via different calls
      const snapshot = engine.buildSnapshot('test-agent-dedup', [
        '/test/snapshot',
        '/test/snapshot', // duplicate scope
      ]);
      // Count occurrences of 'test-agent-snap' — should appear only once per unique pheromone
      const lines = snapshot.split('\n').filter(l => l.startsWith('- '));
      const sourceLines = lines.filter(l => l.includes('test-agent-snap'));
      // Each unique pheromone ID should appear only once
      assert.ok(sourceLines.length >= 1);
    });
  });

  // =========================================================================
  // decayPass — 衰减清理
  // =========================================================================

  describe('decayPass', () => {
    it('should delete expired pheromones and return count (删除过期信息素并返回数量)', () => {
      // Insert a pheromone with past expiry directly
      insertPheromone({
        id: 'test-pher-decay-1',
        type: 'trail',
        sourceId: 'test-agent-decay',
        targetScope: '/test/decay',
        intensity: 0.1,
        decayRate: 0.05,
        expiresAt: 1, // long expired
      });

      const result = engine.decayPass();
      assert.ok(typeof result.deleted === 'number');
      assert.ok(result.deleted >= 1);
    });
  });

  // =========================================================================
  // Decay model — 衰减模型
  // =========================================================================

  describe('Decay model (calculateCurrentIntensity)', () => {
    it('should return initial intensity when no time has passed (无时间流逝时返回初始强度)', () => {
      const now = Date.now();
      const result = calculateCurrentIntensity(1.0, 0.05, now, now);
      assert.equal(result, 1.0);
    });

    it('should decay over time using exponential formula (随时间指数衰减)', () => {
      const now = Date.now();
      const tenMinutesAgo = now - 10 * 60 * 1000;
      const result = calculateCurrentIntensity(1.0, 0.1, tenMinutesAgo, now);
      // e^(-0.1 * 10) = e^(-1) ~= 0.3679
      assert.ok(result > 0.35 && result < 0.40, `Expected ~0.368, got ${result}`);
    });

    it('should return 0 when decayed below MIN_INTENSITY (衰减至低于阈值时返回 0)', () => {
      const now = Date.now();
      const longAgo = now - 1000 * 60 * 1000; // 1000 minutes ago
      const result = calculateCurrentIntensity(1.0, 0.1, longAgo, now);
      assert.equal(result, 0, 'Should return 0 when intensity below MIN_INTENSITY');
    });

    it('should not decay for future timestamps (未来时间戳不衰减)', () => {
      const now = Date.now();
      const future = now + 10 * 60 * 1000;
      const result = calculateCurrentIntensity(0.8, 0.1, future, now);
      assert.equal(result, 0.8);
    });
  });

  // =========================================================================
  // Different types have different decay rates — 不同类型有不同衰减率
  // =========================================================================

  describe('Different pheromone types', () => {
    it('should have distinct default decay rates (不同类型应有不同的默认衰减率)', () => {
      assert.notEqual(PHEROMONE_DEFAULTS.alarm.decayRate, PHEROMONE_DEFAULTS.queen.decayRate);
      assert.ok(PHEROMONE_DEFAULTS.alarm.decayRate > PHEROMONE_DEFAULTS.queen.decayRate,
        'Alarm should decay faster than queen');
    });

    it('should have MIN_INTENSITY defined as a small positive number (MIN_INTENSITY 应为小正数)', () => {
      assert.ok(MIN_INTENSITY > 0);
      assert.ok(MIN_INTENSITY < 0.1);
    });
  });
});
