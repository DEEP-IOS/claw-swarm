/**
 * @fileoverview Unit tests for Claw-Swarm v4.0 - Layer 1 Core Types
 * @module tests/unit/types.test
 *
 * 测试所有 20 个枚举的冻结状态和值正确性。
 * Tests all 20 enums for frozen state and value correctness.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  // 14 enums inherited from v3.0 + 1 added for orchestration
  TaskStatus,
  RoleStatus,
  StrategyType,
  ExecutionStrategy,
  ExecutionMode,
  MonitorMode,
  LogLevel,
  AgentTier,
  AgentStatus,
  CapabilityDimension,
  VoteType,
  VoteChoice,
  VoteStatus,
  BehaviorTag,
  SkillLevel,
  // 5 enums new in v4.0
  PheromoneType,
  PersonaRole,
  CollaborationStrategy,
  CollaborationChannel,
  SubsystemName,
} from '../../src/layer1-core/types.js';

// ---------------------------------------------------------------------------
// Helper: run standard checks on an enum
// 辅助函数：对枚举执行标准检查
// ---------------------------------------------------------------------------

/**
 * Generate describe block for a single enum.
 * @param {string} enumName
 * @param {object} enumObj
 * @param {Record<string, string>} expectedEntries - { KEY: 'value', ... }
 */
function describeEnum(enumName, enumObj, expectedEntries) {
  describe(enumName, () => {
    // 冻结检查 / Frozen check
    it(`should be frozen (不可变)`, () => {
      assert.ok(Object.isFrozen(enumObj), `${enumName} must be Object.freeze()-d`);
    });

    // 键数量一致 / Key count matches
    it(`should contain exactly ${Object.keys(expectedEntries).length} keys`, () => {
      assert.equal(
        Object.keys(enumObj).length,
        Object.keys(expectedEntries).length,
        `${enumName} key count mismatch`,
      );
    });

    // 每个键值对匹配 / Each key-value pair matches
    for (const [key, value] of Object.entries(expectedEntries)) {
      it(`${enumName}.${key} === '${value}'`, () => {
        assert.equal(enumObj[key], value);
      });
    }
  });
}

// ===========================================================================
// v3.0 inherited enums (14)
// 从 v3.0 继承的枚举（14 个）
// ===========================================================================

describe('Layer 1 Core Types - v3.0 inherited enums', () => {
  // 1. TaskStatus — 任务状态
  describeEnum('TaskStatus', TaskStatus, {
    PENDING: 'pending',
    INITIALIZING: 'initializing',
    RUNNING: 'running',
    EXECUTING: 'executing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    RETRYING: 'retrying',
    BLOCKED: 'blocked',
  });

  // 2. RoleStatus — 角色状态
  describeEnum('RoleStatus', RoleStatus, {
    IDLE: 'idle',
    ACTIVE: 'active',
    COMPLETED: 'completed',
    FAILED: 'failed',
  });

  // 3. StrategyType — 策略类型
  describeEnum('StrategyType', StrategyType, {
    SEQUENTIAL: 'sequential',
    PARALLEL: 'parallel',
    CONDITIONAL: 'conditional',
    ITERATIVE: 'iterative',
    PIPELINE: 'pipeline',
  });

  // 4. ExecutionStrategy — 编排执行策略
  describeEnum('ExecutionStrategy', ExecutionStrategy, {
    SIMULATED: 'simulated',
    LIVE: 'live',
  });

  // 5. ExecutionMode — 执行模式
  describeEnum('ExecutionMode', ExecutionMode, {
    AUTO: 'auto',
    MANUAL: 'manual',
    SEMI_AUTO: 'semi-auto',
    DEPENDENCY: 'dependency',
  });

  // 6. MonitorMode — 监控模式
  describeEnum('MonitorMode', MonitorMode, {
    NONE: 'none',
    BASIC: 'basic',
    DEFAULT: 'default',
    DETAILED: 'detailed',
    VERBOSE: 'verbose',
  });

  // 6. LogLevel — 日志级别
  describeEnum('LogLevel', LogLevel, {
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error',
    FATAL: 'fatal',
  });

  // 7. AgentTier — 代理层级
  describeEnum('AgentTier', AgentTier, {
    JUNIOR: 'junior',
    MID: 'mid',
    SENIOR: 'senior',
    LEAD: 'lead',
  });

  // 8. AgentStatus — 代理状态
  describeEnum('AgentStatus', AgentStatus, {
    ONLINE: 'online',
    OFFLINE: 'offline',
    BUSY: 'busy',
    ERROR: 'error',
  });

  // 9. CapabilityDimension — 能力维度
  describeEnum('CapabilityDimension', CapabilityDimension, {
    SPEED: 'speed',
    QUALITY: 'quality',
    RELIABILITY: 'reliability',
    CREATIVITY: 'creativity',
    COST: 'cost',
  });

  // 10. VoteType — 投票类型
  describeEnum('VoteType', VoteType, {
    PROMOTION: 'promotion',
    DEMOTION: 'demotion',
    ALLOCATION: 'allocation',
    POLICY: 'policy',
  });

  // 11. VoteChoice — 投票选择
  describeEnum('VoteChoice', VoteChoice, {
    APPROVE: 'approve',
    REJECT: 'reject',
    ABSTAIN: 'abstain',
  });

  // 12. VoteStatus — 投票状态
  describeEnum('VoteStatus', VoteStatus, {
    OPEN: 'open',
    CLOSED: 'closed',
    PASSED: 'passed',
    REJECTED: 'rejected',
  });

  // 13. BehaviorTag — 行为标签
  describeEnum('BehaviorTag', BehaviorTag, {
    COOPERATIVE: 'cooperative',
    INDEPENDENT: 'independent',
    AGGRESSIVE: 'aggressive',
    CAUTIOUS: 'cautious',
    ADAPTIVE: 'adaptive',
  });

  // 14. SkillLevel — 技能水平
  describeEnum('SkillLevel', SkillLevel, {
    NOVICE: 'novice',
    INTERMEDIATE: 'intermediate',
    ADVANCED: 'advanced',
    EXPERT: 'expert',
  });
});

// ===========================================================================
// v4.0 new enums (5)
// v4.0 新增枚举（5 个）
// ===========================================================================

describe('Layer 1 Core Types - v4.0 new enums', () => {
  // 15. PheromoneType — 信息素类型
  describeEnum('PheromoneType', PheromoneType, {
    TRAIL: 'trail',
    ALARM: 'alarm',
    RECRUIT: 'recruit',
    QUEEN: 'queen',
    DANCE: 'dance',
  });

  // 16. PersonaRole — 人格角色
  describeEnum('PersonaRole', PersonaRole, {
    SCOUT_BEE: 'scout-bee',
    WORKER_BEE: 'worker-bee',
    GUARD_BEE: 'guard-bee',
    QUEEN_MESSENGER: 'queen-messenger',
  });

  // 17. CollaborationStrategy — 协作策略
  describeEnum('CollaborationStrategy', CollaborationStrategy, {
    PARALLEL: 'parallel',
    PIPELINE: 'pipeline',
    DEBATE: 'debate',
    STIGMERGY: 'stigmergy',
  });

  // 18. CollaborationChannel — 协作通道
  describeEnum('CollaborationChannel', CollaborationChannel, {
    PHEROMONE: 'pheromone',
    MEMORY: 'memory',
    DIRECT: 'direct',
  });

  // 19. SubsystemName — 子系统名称
  describeEnum('SubsystemName', SubsystemName, {
    MEMORY: 'memory',
    PHEROMONE: 'pheromone',
    GOVERNANCE: 'governance',
    SOUL: 'soul',
    COLLABORATION: 'collaboration',
    ORCHESTRATION: 'orchestration',
  });
});

// ===========================================================================
// Immutability enforcement — 不可变性防护
// ===========================================================================

describe('Enum immutability enforcement', () => {
  it('should reject assignment to a frozen enum value (赋值应被忽略)', () => {
    // In strict mode this would throw; in sloppy mode the value simply stays unchanged
    const original = TaskStatus.PENDING;
    try { TaskStatus.PENDING = 'hacked'; } catch { /* expected in strict mode */ }
    assert.equal(TaskStatus.PENDING, original);
  });

  it('should reject adding new keys to a frozen enum (新增键应被忽略)', () => {
    const keysBefore = Object.keys(PheromoneType).length;
    try { PheromoneType.NEW_KEY = 'new'; } catch { /* expected in strict mode */ }
    assert.equal(Object.keys(PheromoneType).length, keysBefore);
  });
});
