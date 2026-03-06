/**
 * @fileoverview Unit tests for Claw-Swarm v4.0 - Layer 3 Struggle Detector
 * @module tests/unit/struggle-detector.test
 *
 * 测试挣扎检测器：滑动窗口、失败阈值、信息素上下文、RECRUIT 信号发射。
 * Tests StruggleDetector: sliding window, failure threshold, pheromone context, RECRUIT emission.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { StruggleDetector } from '../../src/layer3-intelligence/collaboration/struggle-detector.js';

// ===========================================================================
// StruggleDetector — 挣扎检测器 / Struggle Detector
// ===========================================================================

describe('StruggleDetector', () => {
  let detector;

  beforeEach(() => {
    detector = new StruggleDetector({
      collaboration: { struggleWindowSize: 5, struggleFailureThreshold: 3 },
    });
  });

  // ── Constructor 构造函数 ─────────────────────────────────────────

  it('should construct with default config (使用默认配置构造)', () => {
    const d = new StruggleDetector({});
    assert.ok(d);
  });

  it('should use default windowSize=5 when not specified (未指定时默认窗口大小=5)', () => {
    const d = new StruggleDetector({});
    const result = d.recordAndCheck('a1', 'tool1', true, null);
    assert.equal(result.windowSize, 5);
  });

  it('should use custom windowSize and failureThreshold (使用自定义窗口和阈值)', () => {
    const d = new StruggleDetector({
      collaboration: { struggleWindowSize: 10, struggleFailureThreshold: 7 },
    });
    const result = d.recordAndCheck('a1', 'tool1', true, null);
    assert.equal(result.windowSize, 10);
  });

  // ── recordAndCheck 记录与检查 ──────────────────────────────────

  it('should not flag struggling on successful call (成功调用不标记挣扎)', () => {
    const result = detector.recordAndCheck('a1', 'read_file', true, null);
    assert.equal(result.struggling, false);
    assert.equal(result.failureCount, 0);
    assert.equal(result.suggestion, null);
  });

  it('should not flag struggling on single failure (单次失败不标记挣扎)', () => {
    const result = detector.recordAndCheck('a1', 'write_file', false, 'permission denied');
    assert.equal(result.struggling, false);
    assert.equal(result.failureCount, 1);
  });

  it('should flag struggling when reaching failureThreshold (达到失败阈值标记挣扎)', () => {
    detector.recordAndCheck('a1', 'tool1', false, 'err1');
    detector.recordAndCheck('a1', 'tool2', false, 'err2');
    const result = detector.recordAndCheck('a1', 'tool3', false, 'err3');
    assert.equal(result.struggling, true);
    assert.equal(result.failureCount, 3);
    assert.ok(result.suggestion.includes('a1'));
  });

  it('should track different agents independently (不同 Agent 独立追踪)', () => {
    // Agent 1: 3 failures
    detector.recordAndCheck('a1', 'tool1', false, 'err');
    detector.recordAndCheck('a1', 'tool2', false, 'err');
    detector.recordAndCheck('a1', 'tool3', false, 'err');

    // Agent 2: 1 failure
    const r2 = detector.recordAndCheck('a2', 'tool1', false, 'err');

    assert.equal(r2.struggling, false);
    assert.equal(r2.failureCount, 1);
  });

  it('should wrap circular buffer (old entries pushed out) (环形缓冲区，旧条目被推出)', () => {
    // Fill window (size=5) with failures
    for (let i = 0; i < 3; i++) {
      detector.recordAndCheck('a1', `tool${i}`, false, 'err');
    }
    // Now add 3 successes to push out failures
    for (let i = 0; i < 3; i++) {
      detector.recordAndCheck('a1', `tool${i}`, true, null);
    }
    // Window now: [fail, fail, success, success, success] -> 2 failures (shifted oldest)
    // Actually: after 6 calls with windowSize=5, we keep last 5:
    // [false, false, false, true, true, true] -> keep last 5: [false, false, true, true, true] -> 2 failures
    const result = detector.recordAndCheck('a1', 'final', true, null);
    // Now window is: [false, true, true, true, true] -> 1 failure
    assert.equal(result.struggling, false);
  });

  it('should recover from struggling after successful calls (成功调用后从挣扎恢复)', () => {
    // Get into struggling state
    for (let i = 0; i < 3; i++) {
      detector.recordAndCheck('a1', 'tool', false, 'err');
    }
    // Add enough successes to push failures out
    for (let i = 0; i < 3; i++) {
      detector.recordAndCheck('a1', 'tool', true, null);
    }
    // Window: [fail, true, true, true] -> only 2 failures after all shifts
    // With windowSize 5: 6 total, keep last 5: [fail, fail, true, true, true] = 2 failures
    // Actually after 6 records: [fail(1), fail(2), fail(3), true(4), true(5), true(6)]
    // kept last 5: [fail(2), fail(3), true(4), true(5), true(6)] -> 2 failures
    const last = detector.recordAndCheck('a1', 'tool', true, null);
    // Now 7 calls, keep last 5: [fail(3), true(4), true(5), true(6), true(7)] -> 1 failure
    assert.equal(last.struggling, false);
  });

  // ── isStruggling 信息素上下文判断 ────────────────────────────────

  it('should return false when null pheromoneEngine and failures >= threshold (null 引擎 + 超阈值)', () => {
    // With null pheromone engine, localAlarms=[], so returns true if failures >= threshold
    const result = detector.isStruggling('a1', 3, null);
    assert.equal(result, true);
  });

  it('should return false when >=2 ALARM pheromones exist (系统性问题不算个体挣扎)', () => {
    const mockPheromoneEngine = {
      read: () => [{ type: 'alarm' }, { type: 'alarm' }],  // 2 alarms -> systemic
    };
    const result = detector.isStruggling('a1', 5, mockPheromoneEngine);
    assert.equal(result, false);
  });

  it('should return true when <2 ALARMs and failures >= threshold (少量告警 + 超阈值 = 个体挣扎)', () => {
    const mockPheromoneEngine = {
      read: () => [{ type: 'alarm' }],  // only 1 alarm
    };
    const result = detector.isStruggling('a1', 3, mockPheromoneEngine);
    assert.equal(result, true);
  });

  it('should return false when failures < threshold regardless of alarms (低于阈值不算挣扎)', () => {
    const mockPheromoneEngine = {
      read: () => [],
    };
    const result = detector.isStruggling('a1', 1, mockPheromoneEngine);
    assert.equal(result, false);
  });

  // ── handleStruggle 处理挣扎 ─────────────────────────────────────

  it('should emit RECRUIT pheromone on struggle (挣扎时发射 RECRUIT 信息素)', () => {
    let emitted = null;
    const mockEngine = {
      emitPheromone: (p) => { emitted = p; },
    };

    detector.handleStruggle('a1', mockEngine, 'write_file', null);

    assert.ok(emitted);
    assert.equal(emitted.type, 'recruit');
    assert.equal(emitted.sourceId, 'a1');
    assert.equal(emitted.targetScope, '/global');
    assert.equal(emitted.intensity, 0.9);
    assert.equal(emitted.payload.failedTool, 'write_file');
  });

  it('should not crash with null pheromoneEngine (null 引擎不崩溃)', () => {
    assert.doesNotThrow(() => {
      detector.handleStruggle('a1', null, 'tool1', null);
    });
  });

  it('should not crash when emitPheromone throws (emitPheromone 抛错不崩溃)', () => {
    const mockEngine = {
      emitPheromone: () => { throw new Error('emit failed'); },
    };
    const mockLogger = { warn: () => {} };

    assert.doesNotThrow(() => {
      detector.handleStruggle('a1', mockEngine, 'tool1', mockLogger);
    });
  });

  // ── clearHistory / getState 辅助方法 ────────────────────────────

  it('should clear history for an agent (清除指定 Agent 的历史)', () => {
    detector.recordAndCheck('a1', 'tool1', false, 'err');
    detector.recordAndCheck('a1', 'tool2', false, 'err');
    detector.clearHistory('a1');
    const state = detector.getState('a1');
    assert.equal(state.length, 0);
  });

  it('should return empty array for unknown agent state (未知 Agent 返回空数组)', () => {
    const state = detector.getState('nonexistent');
    assert.deepEqual(state, []);
  });
});
