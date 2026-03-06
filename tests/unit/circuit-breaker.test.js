/**
 * @fileoverview Unit tests for Claw-Swarm v4.0 - Layer 1 Circuit Breaker
 * @module tests/unit/circuit-breaker.test
 *
 * 测试熔断器的状态转换、持久化和行为。
 * Tests circuit breaker state transitions, persistence, and behavior.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { initDb, closeDb, getMeta, setMeta } from '../../src/layer1-core/db.js';
import { CircuitBreaker, CircuitState } from '../../src/layer1-core/circuit-breaker.js';

// ===========================================================================
// Setup / Teardown
// ===========================================================================

describe('CircuitBreaker', () => {
  /** @type {typeof import('../../src/layer1-core/db.js')} */
  let dbModule;

  before(() => {
    initDb(':memory:');
    // The CircuitBreaker constructor expects a db object with getMeta / setMeta
    dbModule = { getMeta, setMeta };
  });

  after(() => {
    closeDb();
  });

  // Clear persisted state before each test to ensure isolation
  // 每个测试前清除持久化状态以确保隔离
  beforeEach(() => {
    setMeta('circuit_breaker_state', '');
  });

  // =========================================================================
  // Initial state — 初始状态
  // =========================================================================

  describe('Initial state (初始状态)', () => {
    it('should start in CLOSED state (初始状态应为 CLOSED)', () => {
      const cb = new CircuitBreaker(dbModule);
      assert.equal(cb.state, 'closed');
      assert.equal(cb.failureCount, 0);
    });

    it('should allow execution when CLOSED (CLOSED 状态允许执行)', () => {
      const cb = new CircuitBreaker(dbModule);
      assert.equal(cb.canExecute(), true);
    });
  });

  // =========================================================================
  // CLOSED -> OPEN transition — 关闭到打开的转换
  // =========================================================================

  describe('CLOSED -> OPEN transition (关闭 -> 打开)', () => {
    it('should open after N consecutive failures (N 次连续失败后打开)', () => {
      const threshold = 3;
      const cb = new CircuitBreaker(dbModule, { failureThreshold: threshold });

      for (let i = 0; i < threshold; i++) {
        cb.recordFailure();
      }

      assert.equal(cb.state, 'open');
      assert.equal(cb.failureCount, threshold);
    });

    it('should not open before reaching the threshold (未达阈值时不打开)', () => {
      const cb = new CircuitBreaker(dbModule, { failureThreshold: 5 });
      cb.recordFailure();
      cb.recordFailure();
      assert.equal(cb.state, 'closed');
      assert.equal(cb.failureCount, 2);
    });

    it('should reset failure count on success while CLOSED (CLOSED 时成功重置失败计数)', () => {
      const cb = new CircuitBreaker(dbModule, { failureThreshold: 5 });
      cb.recordFailure();
      cb.recordFailure();
      cb.recordSuccess();
      assert.equal(cb.failureCount, 0);
      assert.equal(cb.state, 'closed');
    });
  });

  // =========================================================================
  // OPEN state behavior — 打开状态行为
  // =========================================================================

  describe('OPEN state behavior (打开状态行为)', () => {
    it('should reject execution when OPEN and cooldown not elapsed (OPEN 且冷却未过时拒绝执行)', () => {
      const cb = new CircuitBreaker(dbModule, {
        failureThreshold: 2,
        cooldownMs: 60000, // 60 seconds
      });
      cb.recordFailure();
      cb.recordFailure();
      assert.equal(cb.state, 'open');
      assert.equal(cb.canExecute(), false);
    });
  });

  // =========================================================================
  // OPEN -> HALF_OPEN transition — 打开到半开的转换
  // =========================================================================

  describe('OPEN -> HALF_OPEN transition (打开 -> 半开)', () => {
    it('should transition to HALF_OPEN after cooldown (冷却期后转为 HALF_OPEN)', () => {
      const cb = new CircuitBreaker(dbModule, {
        failureThreshold: 2,
        cooldownMs: 1, // 1ms cooldown for testing
      });
      cb.recordFailure();
      cb.recordFailure();
      assert.equal(cb.state, 'open');

      // Wait for cooldown (we set it to 1ms so this should already work)
      // Force lastFailureTime to the past
      cb.lastFailureTime = Date.now() - 100;

      const canExec = cb.canExecute();
      assert.equal(canExec, true);
      assert.equal(cb.state, 'half-open');
    });
  });

  // =========================================================================
  // HALF_OPEN -> CLOSED transition — 半开到关闭的转换
  // =========================================================================

  describe('HALF_OPEN -> CLOSED transition (半开 -> 关闭)', () => {
    it('should return to CLOSED after enough successful probes (足够成功探测后返回 CLOSED)', () => {
      const cb = new CircuitBreaker(dbModule, {
        failureThreshold: 2,
        cooldownMs: 1,
        halfOpenMaxAttempts: 3,
      });

      // Trip to OPEN
      cb.recordFailure();
      cb.recordFailure();
      assert.equal(cb.state, 'open');

      // Force cooldown elapsed
      cb.lastFailureTime = Date.now() - 100;
      cb.canExecute(); // transitions to half-open
      assert.equal(cb.state, 'half-open');

      // Successful probes
      cb.recordSuccess();
      assert.equal(cb.state, 'half-open');
      cb.recordSuccess();
      assert.equal(cb.state, 'half-open');
      cb.recordSuccess(); // third probe — should close
      assert.equal(cb.state, 'closed');
      assert.equal(cb.failureCount, 0);
    });
  });

  // =========================================================================
  // HALF_OPEN -> OPEN (failure re-trips) — 半开时失败重新打开
  // =========================================================================

  describe('HALF_OPEN -> OPEN on failure (半开时失败重新打开)', () => {
    it('should re-open on failure during HALF_OPEN (HALF_OPEN 期间失败重新打开)', () => {
      const cb = new CircuitBreaker(dbModule, {
        failureThreshold: 2,
        cooldownMs: 1,
        halfOpenMaxAttempts: 3,
      });

      // Trip to OPEN
      cb.recordFailure();
      cb.recordFailure();

      // Force cooldown elapsed -> HALF_OPEN
      cb.lastFailureTime = Date.now() - 100;
      cb.canExecute();
      assert.equal(cb.state, 'half-open');

      // Failure during half-open — should re-trip
      cb.recordFailure();
      assert.equal(cb.state, 'open');
    });
  });

  // =========================================================================
  // State persistence — 状态持久化
  // =========================================================================

  describe('State persistence (状态持久化)', () => {
    it('should persist state to DB (将状态持久化到数据库)', () => {
      const cb = new CircuitBreaker(dbModule, { failureThreshold: 2 });
      cb.recordFailure();
      cb.recordFailure();
      assert.equal(cb.state, 'open');

      // Read persisted state
      const raw = getMeta('circuit_breaker_state');
      assert.ok(raw, 'Persisted state should exist');
      const saved = JSON.parse(raw);
      assert.equal(saved.state, 'open');
      assert.equal(saved.failureCount, 2);
    });

    it('should load state from DB on construction (构造时从数据库加载状态)', () => {
      // Persist an OPEN state with recent failure (within cooldown)
      const state = JSON.stringify({
        state: 'open',
        failureCount: 5,
        lastFailureTime: Date.now(), // recent — within cooldown
        consecutiveSuccesses: 0,
      });
      setMeta('circuit_breaker_state', state);

      const cb = new CircuitBreaker(dbModule, {
        failureThreshold: 5,
        cooldownMs: 60000,
      });
      // Should restore OPEN state since cooldown hasn't elapsed
      assert.equal(cb.state, 'open');
    });

    it('should reset to CLOSED if cooldown has elapsed during load (加载时冷却期已过则重置为 CLOSED)', () => {
      // Persist an OPEN state with old failure (beyond cooldown)
      const state = JSON.stringify({
        state: 'open',
        failureCount: 5,
        lastFailureTime: Date.now() - 120000, // 2 minutes ago
        consecutiveSuccesses: 0,
      });
      setMeta('circuit_breaker_state', state);

      const cb = new CircuitBreaker(dbModule, {
        failureThreshold: 5,
        cooldownMs: 30000, // 30 seconds
      });
      // Should auto-reset to CLOSED because 2min > 30s cooldown
      assert.equal(cb.state, 'closed');
      assert.equal(cb.failureCount, 0);
    });
  });

  // =========================================================================
  // getState — 状态查询
  // =========================================================================

  describe('getState (状态查询)', () => {
    it('should return complete state info (返回完整状态信息)', () => {
      const cb = new CircuitBreaker(dbModule, {
        failureThreshold: 5,
        cooldownMs: 30000,
        halfOpenMaxAttempts: 3,
      });

      const info = cb.getState();
      assert.equal(info.state, 'closed');
      assert.equal(info.failureCount, 0);
      assert.equal(info.lastFailureTime, null);
      assert.equal(info.consecutiveSuccesses, 0);
      assert.equal(info.failureThreshold, 5);
      assert.equal(info.cooldownMs, 30000);
      assert.equal(info.halfOpenMaxAttempts, 3);
    });
  });

  // =========================================================================
  // CircuitState export — 状态常量导出
  // =========================================================================

  describe('CircuitState constants', () => {
    it('should export CLOSED, OPEN, HALF_OPEN constants (导出状态常量)', () => {
      assert.equal(CircuitState.CLOSED, 'closed');
      assert.equal(CircuitState.OPEN, 'open');
      assert.equal(CircuitState.HALF_OPEN, 'half-open');
    });

    it('should be frozen (应被冻结)', () => {
      assert.ok(Object.isFrozen(CircuitState));
    });
  });
});
