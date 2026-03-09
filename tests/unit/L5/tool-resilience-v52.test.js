/**
 * ToolResilience V5.2 单元测试 / ToolResilience V5.2 Unit Tests
 *
 * 测试 V5.2 新增功能: 自适应修复记忆 (findRepairStrategy + recordRepairOutcome)
 * Tests V5.2 additions: adaptive repair memory (findRepairStrategy + recordRepairOutcome)
 *
 * 注意: ToolResilience 导入 Ajv 和 CircuitBreaker，测试使用 db: null 以简化依赖。
 * Note: ToolResilience imports Ajv and CircuitBreaker. Tests use db: null to simplify deps.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolResilience } from '../../../src/L5-application/tool-resilience.js';

// ── 模拟依赖 / Mock Dependencies ──

const logger = { info() {}, warn() {}, error() {}, debug() {} };

function createMockBus() {
  const _published = [];
  return {
    publish(topic, data) { _published.push({ topic, data }); },
    subscribe() {},
    _published,
  };
}

/**
 * 创建内存模拟 DB，实现 prepare().all() / prepare().get() / prepare().run()
 * Create in-memory mock DB implementing prepare().all() / prepare().get() / prepare().run()
 */
function createMockDb() {
  const rows = [];

  return {
    prepare(sql) {
      return {
        all(...params) {
          // 模拟 SELECT 查询: 根据 tool_name 过滤 / Mock SELECT: filter by tool_name
          if (sql.includes('SELECT')) {
            const toolName = params[0];
            return rows.filter(r => r.tool_name === toolName);
          }
          return [];
        },
        get(...params) {
          // 模拟 SELECT 单行 / Mock SELECT single row
          if (sql.includes('SELECT')) {
            const [toolName, errorPattern, strategy] = params;
            return rows.find(r =>
              r.tool_name === toolName &&
              r.error_pattern === errorPattern &&
              r.strategy === strategy
            ) || undefined;
          }
          return undefined;
        },
        run(...params) {
          // 模拟 INSERT/UPDATE / Mock INSERT/UPDATE
          if (sql.includes('INSERT')) {
            rows.push({
              id: rows.length + 1,
              tool_name: params[0],
              error_pattern: params[1],
              strategy: params[2],
              success_count: params[3],
              attempt_count: 1,
            });
          }
        },
      };
    },
    _rows: rows,
  };
}

// ── 测试 / Tests ──

describe('ToolResilience V5.2 — findRepairStrategy', () => {
  it('db 为 null 时返回 null / returns null when no db', () => {
    const resilience = new ToolResilience({
      logger,
      config: {},
      messageBus: createMockBus(),
      db: null,
    });

    const result = resilience.findRepairStrategy('some-tool', 'timeout error');

    expect(result).toBe(null);
  });

  it('无匹配策略时返回 null / returns null when no matching strategies', () => {
    const mockDb = createMockDb();
    const resilience = new ToolResilience({
      logger,
      config: {},
      messageBus: createMockBus(),
      db: mockDb,
    });

    // DB 为空，不应找到任何策略 / DB is empty, no strategies should be found
    const result = resilience.findRepairStrategy('nonexistent-tool', 'unknown error');

    expect(result).toBe(null);
  });

  it('DB 异常时返回 null 不抛异常 / returns null on DB error without throwing', () => {
    const brokenDb = {
      prepare() {
        throw new Error('DB connection lost');
      },
    };
    const resilience = new ToolResilience({
      logger,
      config: {},
      messageBus: createMockBus(),
      db: brokenDb,
    });

    // 不应抛异常 / Should not throw
    const result = resilience.findRepairStrategy('tool-x', 'some error');
    expect(result).toBe(null);
  });
});

describe('ToolResilience V5.2 — recordRepairOutcome', () => {
  it('db 为 null 时不抛异常 / does not throw when no db', () => {
    const resilience = new ToolResilience({
      logger,
      config: {},
      messageBus: createMockBus(),
      db: null,
    });

    // 不应抛异常 / Should not throw
    expect(() => {
      resilience.recordRepairOutcome('some-tool', 'timeout error', 'retry', true);
    }).not.toThrow();
  });

  it('DB 异常时不抛异常 / does not throw on DB error', () => {
    const brokenDb = {
      prepare() {
        throw new Error('DB write failed');
      },
    };
    const resilience = new ToolResilience({
      logger,
      config: {},
      messageBus: createMockBus(),
      db: brokenDb,
    });

    expect(() => {
      resilience.recordRepairOutcome('tool-x', 'error pattern', 'strategy-a', false);
    }).not.toThrow();
  });
});

describe('ToolResilience V5.2 — getCircuitBreakerStates', () => {
  it('初始时返回空对象 / returns empty object initially', () => {
    const resilience = new ToolResilience({
      logger,
      config: {},
      messageBus: createMockBus(),
      db: null,
    });

    const states = resilience.getCircuitBreakerStates();

    expect(states).toEqual({});
  });
});
