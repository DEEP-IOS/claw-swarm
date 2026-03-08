/**
 * QualityController 单元测试 / QualityController Unit Tests
 *
 * 使用真实 DatabaseManager + 内存 SQLite 测试 3 层质量门控。
 * Uses real DatabaseManager + in-memory SQLite to test 3-layer quality gate.
 *
 * 覆盖: evaluate (pass/fail), tier escalation, shouldRetry, getQualityReport, recordEvaluation
 * Covers: evaluate (pass/fail), tier escalation, shouldRetry, getQualityReport, recordEvaluation
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../../src/L1-infrastructure/database/database-manager.js';
import { TaskRepository } from '../../../src/L1-infrastructure/database/repositories/task-repo.js';
import { AgentRepository } from '../../../src/L1-infrastructure/database/repositories/agent-repo.js';
import { TABLE_SCHEMAS } from '../../../src/L1-infrastructure/schemas/database-schemas.js';
import {
  QualityController,
  QualityTier,
  QualityVerdict,
} from '../../../src/L4-orchestration/quality-controller.js';

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

describe('QualityController', () => {
  let dbManager, taskRepo, agentRepo, messageBus, qc;

  beforeEach(() => {
    // 创建内存数据库并初始化所有表 / Create in-memory DB and bootstrap all tables
    dbManager = new DatabaseManager({ memory: true });
    dbManager.open(TABLE_SCHEMAS);
    taskRepo = new TaskRepository(dbManager);
    agentRepo = new AgentRepository(dbManager);
    messageBus = createMockMessageBus();
    qc = new QualityController({
      taskRepo,
      agentRepo,
      messageBus,
      config: { maxRetries: 3, autoEscalate: true },
      logger: silentLogger,
    });
  });

  afterEach(() => { dbManager.close(); });

  // ━━━ 1. 高质量结果通过自评 / High Quality Passes Self-Review ━━━
  describe('evaluate - high quality', () => {
    it('高分结果应通过 self-review / high quality result should pass self-review', async () => {
      // 创建任务 / Create task
      taskRepo.createTask('qc-1', { name: 'quality-test' });

      // 使用外部评分直接提供高分 / Provide high scores directly
      const highScores = [
        { dimension: 'correctness', score: 0.9 },
        { dimension: 'completeness', score: 0.85 },
        { dimension: 'code_quality', score: 0.8 },
        { dimension: 'documentation', score: 0.75 },
        { dimension: 'test_coverage', score: 0.8 },
        { dimension: 'performance', score: 0.7 },
        { dimension: 'security', score: 0.7 },
      ];

      const result = await qc.evaluate('qc-1', { output: 'high quality code' }, {
        tier: QualityTier.SELF,
        scores: highScores,
      });

      expect(result.passed).toBe(true);
      expect(result.tier).toBe(QualityTier.SELF);
      expect(result.score).toBeGreaterThanOrEqual(0.6); // self-review 阈值 / threshold
      expect(result.verdict).toBe(QualityVerdict.PASS);
      expect(result.evaluationId).toBeTruthy();
    });
  });

  // ━━━ 2. 低质量结果未通过 / Low Quality Fails ━━━
  describe('evaluate - low quality', () => {
    it('低分结果应未通过 / low quality result should fail', async () => {
      taskRepo.createTask('qc-2', { name: 'low-quality' });

      const lowScores = [
        { dimension: 'correctness', score: 0.1 },
        { dimension: 'completeness', score: 0.1 },
        { dimension: 'code_quality', score: 0.2 },
        { dimension: 'documentation', score: 0.1 },
        { dimension: 'test_coverage', score: 0.1 },
        { dimension: 'performance', score: 0.1 },
        { dimension: 'security', score: 0.1 },
      ];

      const result = await qc.evaluate('qc-2', { error: 'broken code' }, {
        tier: QualityTier.SELF,
        scores: lowScores,
      });

      expect(result.passed).toBe(false);
      expect(result.verdict).toBe(QualityVerdict.FAIL);
      expect(result.score).toBeLessThan(0.6);
    });
  });

  // ━━━ 3. 层级升级 / Tier Escalation ━━━
  describe('evaluate - tier escalation', () => {
    it('失败后应自动升级: self → peer → lead / should escalate: self → peer → lead on failures', async () => {
      taskRepo.createTask('qc-3', { name: 'escalation-test' });

      const lowScores = [
        { dimension: 'correctness', score: 0.1 },
        { dimension: 'completeness', score: 0.1 },
        { dimension: 'code_quality', score: 0.1 },
      ];

      // 第一次: 自动确定为 self-review / First: auto-determine as self-review
      const eval1 = await qc.evaluate('qc-3', {}, { scores: lowScores });
      expect(eval1.tier).toBe(QualityTier.SELF);
      expect(eval1.passed).toBe(false);

      // 第二次: 上次 self 失败, 应升级为 peer / Second: after self fails, escalate to peer
      const eval2 = await qc.evaluate('qc-3', {}, { scores: lowScores });
      expect(eval2.tier).toBe(QualityTier.PEER);
      expect(eval2.passed).toBe(false);

      // 第三次: 上次 peer 失败, 应升级为 lead / Third: after peer fails, escalate to lead
      const eval3 = await qc.evaluate('qc-3', {}, { scores: lowScores });
      expect(eval3.tier).toBe(QualityTier.LEAD);
      expect(eval3.passed).toBe(false);

      // 验证升级事件已发布 / Verify escalation events published
      const escalationEvents = messageBus.published.filter(
        (e) => e.topic === 'quality.escalation.triggered',
      );
      expect(escalationEvents.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ━━━ 4. shouldRetry - 在最大重试次数内 / Within Max Retries ━━━
  describe('shouldRetry - within limit', () => {
    it('失败次数在限制内应返回 true / should return true within max retries', async () => {
      taskRepo.createTask('qc-4', { name: 'retry-within' });

      // 模拟 1 次失败 / Simulate 1 failure
      const lowScores = [
        { dimension: 'correctness', score: 0.1 },
        { dimension: 'completeness', score: 0.1 },
      ];
      await qc.evaluate('qc-4', {}, { tier: QualityTier.SELF, scores: lowScores });

      // failCount = 1, maxRetries = 3 → 应可重试 / should allow retry
      expect(qc.shouldRetry('qc-4')).toBe(true);
    });
  });

  // ━━━ 5. shouldRetry - 超过最大次数 / Exceeding Max Retries ━━━
  describe('shouldRetry - exceeding limit', () => {
    it('超过最大重试次数应返回 false / should return false when exceeding max retries', () => {
      // 直接传入 failCount 参数 / Pass failCount directly
      expect(qc.shouldRetry('qc-5', 3)).toBe(false);
      expect(qc.shouldRetry('qc-5', 5)).toBe(false);
    });
  });

  // ━━━ 6. 质量报告 / Quality Report ━━━
  describe('getQualityReport', () => {
    it('应返回包含分数和趋势的报告 / should return report with scores and trends', async () => {
      taskRepo.createTask('qc-6', { name: 'report-test' });

      // 两次评估, 分数递增 / Two evaluations with increasing scores
      const scores1 = [
        { dimension: 'correctness', score: 0.4 },
        { dimension: 'completeness', score: 0.3 },
      ];
      const scores2 = [
        { dimension: 'correctness', score: 0.7 },
        { dimension: 'completeness', score: 0.6 },
      ];

      await qc.evaluate('qc-6', {}, { tier: QualityTier.SELF, scores: scores1 });
      await qc.evaluate('qc-6', {}, { tier: QualityTier.SELF, scores: scores2 });

      const report = qc.getQualityReport('qc-6');

      expect(report).not.toBeNull();
      expect(report.taskId).toBe('qc-6');
      expect(report.evaluationCount).toBe(2);
      expect(report.latestScore).toBeGreaterThan(0);
      expect(report.latestTier).toBe(QualityTier.SELF);
      expect(report.source).toBe('memory');
      expect(report.dimensionAverages).toBeDefined();

      // 分数趋势应为正 (递增) / Score trend should be positive (increasing)
      expect(report.scoreTrend).toBeGreaterThan(0);

      // 评估历史列表 / Evaluation history list
      expect(report.evaluations).toHaveLength(2);
    });

    it('无历史时应返回 null / should return null with no history', () => {
      taskRepo.createTask('qc-6b', { name: 'no-history' });
      const report = qc.getQualityReport('qc-6b');
      expect(report).toBeNull();
    });
  });

  // ━━━ 7. recordEvaluation 持久化 / Record Evaluation Persistence ━━━
  describe('recordEvaluation', () => {
    it('应将评估记录持久化到历史和数据库 / should persist evaluation to history and DB', () => {
      taskRepo.createTask('qc-7', { name: 'record-test' });

      const evaluation = {
        id: 'eval-001',
        taskId: 'qc-7',
        tier: QualityTier.SELF,
        score: 0.75,
        verdict: QualityVerdict.PASS,
        dimensions: [{ dimension: 'correctness', score: 0.8 }],
        feedback: ['Good job'],
        reviewerId: null,
        timestamp: Date.now(),
      };

      qc.recordEvaluation('qc-7', evaluation);

      // 验证内存历史 / Verify memory history
      const report = qc.getQualityReport('qc-7');
      expect(report).not.toBeNull();
      expect(report.evaluationCount).toBe(1);
      expect(report.latestScore).toBe(0.75);

      // 验证数据库持久化 (通过 checkpoint) / Verify DB persistence (via checkpoint)
      const checkpoints = taskRepo.getCheckpoints('qc-7');
      expect(checkpoints.length).toBeGreaterThanOrEqual(1);
      const cp = checkpoints.find((c) => c.trigger === 'quality_evaluation');
      expect(cp).toBeDefined();
      expect(cp.data.tier).toBe(QualityTier.SELF);
      expect(cp.data.score).toBe(0.75);
    });
  });
});
