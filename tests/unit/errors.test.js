/**
 * @fileoverview Unit tests for Claw-Swarm v4.0 - Layer 1 Error Hierarchy
 * @module tests/unit/errors.test
 *
 * 测试所有 11 个错误类的存在性、继承链和自定义属性。
 * Tests all 11 error classes for existence, inheritance chain, and custom properties.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SwarmError,
  SwarmValidationError,
  SwarmTimeoutError,
  SwarmConflictError,
  SwarmDBError,
  SwarmTopologyError,
  CircuitOpenError,
  LockLostError,
  GovernanceError,
  VotingError,
  PheromoneError,
} from '../../src/layer1-core/errors.js';

// ===========================================================================
// Base class: SwarmError — 基础错误类
// ===========================================================================

describe('SwarmError (base class / 基类)', () => {
  it('should be constructable with message only (仅消息构造)', () => {
    const err = new SwarmError('test error');
    assert.equal(err.message, 'test error');
    assert.equal(err.code, 'SWARM_ERROR');
    assert.deepEqual(err.context, {});
    assert.equal(err.name, 'SwarmError');
  });

  it('should accept code and context parameters (接受 code 和 context)', () => {
    const ctx = { taskId: 'test-task-1' };
    const err = new SwarmError('with context', 'CUSTOM_CODE', ctx);
    assert.equal(err.code, 'CUSTOM_CODE');
    assert.deepEqual(err.context, ctx);
  });

  it('should extend Error (继承自 Error)', () => {
    const err = new SwarmError('extend check');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof SwarmError);
  });

  it('should have a valid ISO timestamp (包含有效 ISO 时间戳)', () => {
    const before = new Date().toISOString();
    const err = new SwarmError('timestamp check');
    const after = new Date().toISOString();
    assert.ok(err.timestamp >= before && err.timestamp <= after);
  });

  it('should have a stack trace (包含堆栈追踪)', () => {
    const err = new SwarmError('stack check');
    assert.ok(typeof err.stack === 'string');
    assert.ok(err.stack.length > 0);
  });

  it('should serialize to JSON via toJSON() (可通过 toJSON 序列化)', () => {
    const err = new SwarmError('json check', 'JSON_CODE', { key: 'val' });
    const json = err.toJSON();
    assert.equal(json.name, 'SwarmError');
    assert.equal(json.message, 'json check');
    assert.equal(json.code, 'JSON_CODE');
    assert.deepEqual(json.context, { key: 'val' });
    assert.ok(json.timestamp);
    assert.ok(json.stack);
  });
});

// ===========================================================================
// Derived classes — 派生错误类
// ===========================================================================

describe('SwarmValidationError', () => {
  it('should inherit from SwarmError (继承自 SwarmError)', () => {
    const err = new SwarmValidationError('bad input');
    assert.ok(err instanceof SwarmError);
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'SwarmValidationError');
    assert.equal(err.code, 'VALIDATION_ERROR');
    assert.equal(err.message, 'bad input');
  });
});

describe('SwarmTimeoutError', () => {
  it('should carry timeoutMs property (携带 timeoutMs 属性)', () => {
    const err = new SwarmTimeoutError('timed out', 5000, { op: 'fetch' });
    assert.ok(err instanceof SwarmError);
    assert.equal(err.name, 'SwarmTimeoutError');
    assert.equal(err.code, 'TIMEOUT_ERROR');
    assert.equal(err.timeoutMs, 5000);
    assert.deepEqual(err.context, { op: 'fetch' });
  });
});

describe('SwarmConflictError', () => {
  it('should carry resource property (携带 resource 属性)', () => {
    const err = new SwarmConflictError('conflict', 'test-resource-1');
    assert.ok(err instanceof SwarmError);
    assert.equal(err.name, 'SwarmConflictError');
    assert.equal(err.code, 'CONFLICT_ERROR');
    assert.equal(err.resource, 'test-resource-1');
  });
});

describe('SwarmDBError', () => {
  it('should carry operation property (携带 operation 属性)', () => {
    const err = new SwarmDBError('db failed', 'INSERT');
    assert.ok(err instanceof SwarmError);
    assert.equal(err.name, 'SwarmDBError');
    assert.equal(err.code, 'DB_ERROR');
    assert.equal(err.operation, 'INSERT');
  });
});

describe('SwarmTopologyError', () => {
  it('should carry cycle array property (携带 cycle 数组属性)', () => {
    const cycle = ['A', 'B', 'C', 'A'];
    const err = new SwarmTopologyError('cycle detected', cycle);
    assert.ok(err instanceof SwarmError);
    assert.equal(err.name, 'SwarmTopologyError');
    assert.equal(err.code, 'TOPOLOGY_ERROR');
    assert.deepEqual(err.cycle, cycle);
  });
});

describe('CircuitOpenError', () => {
  it('should carry retryAfterMs property (携带 retryAfterMs 属性)', () => {
    const err = new CircuitOpenError('circuit open', 30000);
    assert.ok(err instanceof SwarmError);
    assert.equal(err.name, 'CircuitOpenError');
    assert.equal(err.code, 'CIRCUIT_OPEN');
    assert.equal(err.retryAfterMs, 30000);
  });
});

describe('LockLostError', () => {
  it('should carry resource and owner properties (携带 resource 和 owner 属性)', () => {
    const err = new LockLostError('lock lost', 'test-resource-1', 'test-agent-1');
    assert.ok(err instanceof SwarmError);
    assert.equal(err.name, 'LockLostError');
    assert.equal(err.code, 'LOCK_LOST');
    assert.equal(err.resource, 'test-resource-1');
    assert.equal(err.owner, 'test-agent-1');
  });
});

describe('GovernanceError', () => {
  it('should carry agentId property (携带 agentId 属性)', () => {
    const err = new GovernanceError('gov failed', 'test-agent-1');
    assert.ok(err instanceof SwarmError);
    assert.equal(err.name, 'GovernanceError');
    assert.equal(err.code, 'GOVERNANCE_ERROR');
    assert.equal(err.agentId, 'test-agent-1');
  });
});

describe('VotingError', () => {
  it('should carry voteId property (携带 voteId 属性)', () => {
    const err = new VotingError('vote failed', 'test-vote-1');
    assert.ok(err instanceof SwarmError);
    assert.equal(err.name, 'VotingError');
    assert.equal(err.code, 'VOTING_ERROR');
    assert.equal(err.voteId, 'test-vote-1');
  });
});

describe('PheromoneError (v4.0 new / 新增)', () => {
  it('should carry pheromoneType property (携带 pheromoneType 属性)', () => {
    const err = new PheromoneError('pheromone failed', 'alarm', { scope: '/global' });
    assert.ok(err instanceof SwarmError);
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'PheromoneError');
    assert.equal(err.code, 'PHEROMONE_ERROR');
    assert.equal(err.pheromoneType, 'alarm');
    assert.deepEqual(err.context, { scope: '/global' });
  });
});

// ===========================================================================
// Cross-cutting concerns — 横切关注点
// ===========================================================================

describe('Error hierarchy cross-cutting', () => {
  it('all 11 error classes should be constructable (所有 11 个错误类均可构造)', () => {
    const classes = [
      SwarmError,
      SwarmValidationError,
      SwarmTimeoutError,
      SwarmConflictError,
      SwarmDBError,
      SwarmTopologyError,
      CircuitOpenError,
      LockLostError,
      GovernanceError,
      VotingError,
      PheromoneError,
    ];
    assert.equal(classes.length, 11);
    for (const Cls of classes) {
      assert.ok(typeof Cls === 'function', `${Cls.name} should be a constructor`);
    }
  });

  it('all derived errors should be instanceof SwarmError (所有派生错误均为 SwarmError 实例)', () => {
    const instances = [
      new SwarmValidationError('v'),
      new SwarmTimeoutError('t', 1000),
      new SwarmConflictError('c', 'r'),
      new SwarmDBError('d', 'SELECT'),
      new SwarmTopologyError('tp', ['A']),
      new CircuitOpenError('co', 5000),
      new LockLostError('ll', 'res', 'own'),
      new GovernanceError('g', 'agent'),
      new VotingError('vt', 'vote'),
      new PheromoneError('p', 'trail'),
    ];
    for (const err of instances) {
      assert.ok(err instanceof SwarmError, `${err.name} must be instanceof SwarmError`);
      assert.ok(err instanceof Error, `${err.name} must be instanceof Error`);
    }
  });

  it('error names should not all be "SwarmError" (派生类 name 应各不相同)', () => {
    const names = new Set([
      new SwarmValidationError('v').name,
      new SwarmTimeoutError('t', 1000).name,
      new SwarmConflictError('c', 'r').name,
      new SwarmDBError('d', 'SELECT').name,
      new SwarmTopologyError('tp', []).name,
      new CircuitOpenError('co', 5000).name,
      new LockLostError('ll', 'r', 'o').name,
      new GovernanceError('g', 'a').name,
      new VotingError('vt', 'v').name,
      new PheromoneError('p', 'trail').name,
    ]);
    // All 10 derived classes should have unique names
    assert.equal(names.size, 10);
    assert.ok(!names.has('SwarmError'), 'Derived class names should differ from SwarmError');
  });
});
