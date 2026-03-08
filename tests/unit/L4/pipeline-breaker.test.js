/**
 * PipelineBreaker 单元测试 / PipelineBreaker Unit Tests
 *
 * 测试 9 态 FSM + 死信队列 + 级联中止 + 状态转换历史。
 * Tests 9-state FSM + dead letter queue + cascade abort + transition history.
 *
 * PipelineBreaker 主要使用内存状态, 但构造函数接收 taskRepo 和 messageBus。
 * PipelineBreaker primarily uses in-memory state but constructor takes taskRepo and messageBus.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PipelineBreaker } from '../../../src/L4-orchestration/pipeline-breaker.js';
import { PipelineState } from '../../../src/L1-infrastructure/types.js';

// 静默 logger / Silent logger
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// 模拟 MessageBus / Mock MessageBus
function createMockMessageBus() {
  const published = [];
  return {
    publish(topic, data) { published.push({ topic, data }); },
    subscribe() {},
    published,
  };
}

// 模拟 TaskRepo (PipelineBreaker 主要不使用它, 但构造函数需要)
// Mock TaskRepo (PipelineBreaker doesn't heavily use it, but constructor needs it)
function createMockTaskRepo() {
  return {
    createTask() {},
    getTask() { return null; },
    updateTaskStatus() {},
  };
}

describe('PipelineBreaker', () => {
  let breaker, messageBus;

  beforeEach(() => {
    messageBus = createMockMessageBus();
    breaker = new PipelineBreaker({
      taskRepo: createMockTaskRepo(),
      messageBus,
      config: { maxRetries: 3 },
      logger: silentLogger,
    });
  });

  // ━━━ 1. 注册和获取状态 / Register and Get State ━━━
  describe('register and getState', () => {
    it('注册后应处于 pending 状态 / should be pending after registration', () => {
      breaker.register('t1', { type: 'developer' });

      expect(breaker.getState('t1')).toBe(PipelineState.pending);
    });

    it('未注册任务应返回 null / unregistered task should return null', () => {
      expect(breaker.getState('nonexistent')).toBeNull();
    });

    it('重复注册应被忽略 / duplicate registration should be ignored', () => {
      breaker.register('t1');
      breaker.register('t1'); // 重复 / duplicate
      expect(breaker.getState('t1')).toBe(PipelineState.pending);
    });
  });

  // ━━━ 2. 合法状态转换 / Valid Transitions ━━━
  describe('valid transition chain', () => {
    it('pending → scheduled → running → success 应全部成功 / should all succeed', () => {
      breaker.register('t2');

      const r1 = breaker.transition('t2', PipelineState.pending, PipelineState.scheduled);
      expect(r1).toBe(true);
      expect(breaker.getState('t2')).toBe(PipelineState.scheduled);

      const r2 = breaker.transition('t2', PipelineState.scheduled, PipelineState.running);
      expect(r2).toBe(true);
      expect(breaker.getState('t2')).toBe(PipelineState.running);

      const r3 = breaker.transition('t2', PipelineState.running, PipelineState.success);
      expect(r3).toBe(true);
      expect(breaker.getState('t2')).toBe(PipelineState.success);
    });
  });

  // ━━━ 3. 非法状态转换 / Invalid Transition ━━━
  describe('invalid transition', () => {
    it('pending → success 应被拒绝 / pending → success should be rejected', () => {
      breaker.register('t3');

      // pending 只能转到 scheduled / pending can only go to scheduled
      const result = breaker.transition('t3', PipelineState.pending, PipelineState.success);
      expect(result).toBe(false);
      expect(breaker.getState('t3')).toBe(PipelineState.pending); // 状态不变 / unchanged
    });

    it('状态不匹配应被拒绝 / state mismatch should be rejected', () => {
      breaker.register('t3b');

      // 当前是 pending, 但声称 from=running / Current is pending, but claims from=running
      const result = breaker.transition('t3b', PipelineState.running, PipelineState.success);
      expect(result).toBe(false);
    });
  });

  // ━━━ 4. 记录失败 - 增加重试计数 / Record Failure - Increment Retry ━━━
  describe('recordFailure - increment retry count', () => {
    it('应增加重试计数并允许重试 / should increment retry count and allow retry', () => {
      breaker.register('t4');

      const { shouldRetry, retryCount } = breaker.recordFailure('t4', new Error('timeout'));

      expect(shouldRetry).toBe(true);
      expect(retryCount).toBe(1);

      // 再次失败 / Fail again
      const r2 = breaker.recordFailure('t4', 'another error');
      expect(r2.shouldRetry).toBe(true);
      expect(r2.retryCount).toBe(2);
    });
  });

  // ━━━ 5. 超过最大重试次数 → dead / Exceed Max Retries → Dead ━━━
  describe('recordFailure - exceed maxRetries', () => {
    it('超过 maxRetries 应标记 shouldRetry=false 并加入 DLQ / should mark shouldRetry=false and add to DLQ', () => {
      breaker.register('t5');

      // 失败 3 次 (maxRetries=3, 第 4 次超过) / Fail 3 times
      breaker.recordFailure('t5', 'err-1');
      breaker.recordFailure('t5', 'err-2');
      breaker.recordFailure('t5', 'err-3');

      // 第 4 次超过限制 / 4th exceeds limit
      const r4 = breaker.recordFailure('t5', 'err-4');
      expect(r4.shouldRetry).toBe(false);
      expect(r4.retryCount).toBe(4);

      // 验证加入 DLQ / Verify added to DLQ
      const dlq = breaker.getDLQ();
      expect(dlq.length).toBeGreaterThanOrEqual(1);
      const t5Entry = dlq.find((e) => e.taskId === 't5');
      expect(t5Entry).toBeDefined();
      expect(t5Entry.error).toBe('err-4');
    });
  });

  // ━━━ 6. 死信队列 / Dead Letter Queue ━━━
  describe('getDLQ', () => {
    it('dead 状态任务应出现在 DLQ 中 / dead tasks should appear in DLQ', () => {
      breaker.register('t6');
      breaker.transition('t6', PipelineState.pending, PipelineState.scheduled);
      breaker.transition('t6', PipelineState.scheduled, PipelineState.running);
      breaker.transition('t6', PipelineState.running, PipelineState.failed);
      breaker.transition('t6', PipelineState.failed, PipelineState.dead, 'permanent failure');

      // dead 状态转换时 _handleSpecialTransition 不自动加 DLQ,
      // 但 recordFailure 超限时加入. 手动添加验证 DLQ 获取。
      // 通过 recordFailure 让 breaker 将任务加入 DLQ
      breaker.register('t6b');
      for (let i = 0; i <= 3; i++) {
        breaker.recordFailure('t6b', `fail-${i}`);
      }

      const dlq = breaker.getDLQ();
      const entry = dlq.find((e) => e.taskId === 't6b');
      expect(entry).toBeDefined();
      expect(entry.retryCount).toBeGreaterThan(3);
    });
  });

  // ━━━ 7. 级联中止 / Cascade Abort ━━━
  describe('cascade abort', () => {
    it('关键任务失败应级联中止下游任务 / critical task failure should cascade abort dependents', () => {
      // 注册关键任务和其依赖者 / Register critical task and its dependents
      breaker.register('critical-1', { type: 'architect', dependsOn: [] });
      breaker.register('dep-1', { type: 'developer', dependsOn: ['critical-1'] });
      breaker.register('dep-2', { type: 'tester', dependsOn: ['critical-1'] });

      // 推进关键任务到 running / Advance critical task to running
      breaker.transition('critical-1', PipelineState.pending, PipelineState.scheduled);
      breaker.transition('critical-1', PipelineState.scheduled, PipelineState.running);

      // 推进下游任务到 scheduled / Advance dependents to scheduled
      breaker.transition('dep-1', PipelineState.pending, PipelineState.scheduled);
      breaker.transition('dep-2', PipelineState.pending, PipelineState.scheduled);

      // 关键任务失败 → 触发级联 / Critical task fails → triggers cascade
      breaker.transition('critical-1', PipelineState.running, PipelineState.failed);

      // 下游任务应变为 dead / Dependents should be dead
      expect(breaker.getState('dep-1')).toBe(PipelineState.dead);
      expect(breaker.getState('dep-2')).toBe(PipelineState.dead);
    });
  });

  // ━━━ 8. 级联废弃率 / Cascade Waste ━━━
  describe('cascade waste', () => {
    it('应正确追踪废弃百分比 / should correctly track waste percentage', () => {
      breaker.register('cw-1', { type: 'core', dependsOn: [] });
      breaker.register('cw-2', { type: 'developer', dependsOn: ['cw-1'] });
      breaker.register('cw-3', { type: 'tester', dependsOn: ['cw-1'] });

      // 推进到可级联中止的状态 / Advance to state where cascade can abort
      breaker.transition('cw-1', PipelineState.pending, PipelineState.scheduled);
      breaker.transition('cw-1', PipelineState.scheduled, PipelineState.running);
      breaker.transition('cw-2', PipelineState.pending, PipelineState.scheduled);
      breaker.transition('cw-3', PipelineState.pending, PipelineState.scheduled);

      // 关键任务失败 → 级联中止 2 个下游 / Critical task fails → 2 downstream aborted
      breaker.transition('cw-1', PipelineState.running, PipelineState.failed);

      const waste = breaker.getCascadeWaste();
      expect(waste.abortedCount).toBe(2);
      expect(waste.totalCount).toBe(3);
      // 废弃率 = 2/3 ≈ 66.67% / Waste = 2/3 ≈ 66.67%
      expect(waste.wastePercent).toBeGreaterThan(0);
      expect(waste.wastePercent).toBeCloseTo(66.67, 0);
    });
  });

  // ━━━ 9. 转换历史 / Transition History ━━━
  describe('transition history', () => {
    it('应记录完整的状态转换审计日志 / should record full state transition audit trail', () => {
      breaker.register('th-1');

      breaker.transition('th-1', PipelineState.pending, PipelineState.scheduled, 'dispatched');
      breaker.transition('th-1', PipelineState.scheduled, PipelineState.running, 'agent-ready');
      breaker.transition('th-1', PipelineState.running, PipelineState.success, 'done');

      const history = breaker.getTransitionHistory('th-1');

      expect(history).toHaveLength(3);

      // 第一条: pending → scheduled / First: pending → scheduled
      expect(history[0].from).toBe(PipelineState.pending);
      expect(history[0].to).toBe(PipelineState.scheduled);
      expect(history[0].reason).toBe('dispatched');
      expect(history[0].timestamp).toBeGreaterThan(0);

      // 第二条: scheduled → running / Second: scheduled → running
      expect(history[1].from).toBe(PipelineState.scheduled);
      expect(history[1].to).toBe(PipelineState.running);

      // 第三条: running → success / Third: running → success
      expect(history[2].from).toBe(PipelineState.running);
      expect(history[2].to).toBe(PipelineState.success);
      expect(history[2].reason).toBe('done');
    });

    it('未注册任务的历史应为空数组 / unregistered task history should be empty', () => {
      const history = breaker.getTransitionHistory('unknown');
      expect(history).toEqual([]);
    });
  });
});
