/**
 * PersonaEvolution 单元测试 / PersonaEvolution Unit Tests
 *
 * 使用真实 DatabaseManager + 内存 SQLite 测试 GEP 引导进化协议。
 * Uses real DatabaseManager + in-memory SQLite to test Guided Evolution Protocol.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../../src/L1-infrastructure/database/database-manager.js';
import { TABLE_SCHEMAS } from '../../../src/L1-infrastructure/schemas/database-schemas.js';
import { AgentRepository } from '../../../src/L1-infrastructure/database/repositories/agent-repo.js';
import { PersonaEvolution } from '../../../src/L3-agent/persona-evolution.js';

// 静默 logger / Silent logger
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// 模拟消息总线 / Mock message bus (records emitted events)
const createMockBus = () => {
  const events = [];
  return { emit(name, data) { events.push({ name, data }); }, events };
};

describe('PersonaEvolution', () => {
  let dbManager, agentRepo, messageBus, evolution;

  beforeEach(() => {
    // 创建内存数据库并初始化所有表 / Create in-memory DB and bootstrap all tables
    dbManager = new DatabaseManager({ memory: true });
    dbManager.open(TABLE_SCHEMAS);
    agentRepo = new AgentRepository(dbManager);
    messageBus = createMockBus();
    evolution = new PersonaEvolution({ agentRepo, messageBus, logger: silentLogger });
  });

  afterEach(() => { dbManager.close(); });

  // ━━━ 1. 记录结果 / Record Outcome ━━━
  describe('recordOutcome', () => {
    it('应将执行结果存储到数据库 / should store persona execution result in DB', () => {
      evolution.recordOutcome({
        personaId: 'persona-alpha',
        taskType: 'coding',
        success: true,
        qualityScore: 0.85,
        durationMs: 3000,
      });

      // 通过 agentRepo 验证持久化 / Verify persistence via agentRepo
      const stats = agentRepo.getPersonaStats('persona-alpha', 'coding');
      expect(stats.count).toBe(1);
      expect(stats.successRate).toBe(1); // 1 次成功 / 1 success

      // 应发出事件 / Should emit event
      expect(messageBus.events.some(e => e.name === 'persona.outcome.recorded')).toBe(true);
    });
  });

  // ━━━ 2. 人格统计 / Persona Stats ━━━
  describe('getPersonaStats', () => {
    it('应返回正确的胜率和执行次数 / should return correct win rate and execution count', () => {
      const pid = 'persona-stats';
      // 记录 3 成功 2 失败 / Record 3 successes, 2 failures
      for (let i = 0; i < 3; i++) {
        evolution.recordOutcome({ personaId: pid, taskType: 'testing', success: true, qualityScore: 0.8 });
      }
      for (let i = 0; i < 2; i++) {
        evolution.recordOutcome({ personaId: pid, taskType: 'testing', success: false, qualityScore: 0.3 });
      }

      const stats = evolution.getPersonaStats(pid);

      expect(stats.executions).toBe(5);
      // 胜率 = 3/5 = 0.6 / Win rate = 3/5 = 0.6
      expect(stats.winRate).toBeCloseTo(0.6, 1);
      expect(stats.avgQuality).toBeGreaterThan(0);
    });
  });

  // ━━━ 3. 检测低绩效 / Detect Underperformers ━━━
  describe('detectUnderperformers', () => {
    it('胜率低于阈值的 agent 应被检测出 / should detect agents with low win rates', () => {
      // 创建两个 agent: 一个低胜率, 一个高胜率
      // Create two agents: one low win rate, one high win rate
      // detectUnderperformers 返回 agent.role 作为 personaId / returns agent.role as personaId
      const lowAgent = agentRepo.createAgent({ name: 'low-perf', role: 'underperformer' });
      const highAgent = agentRepo.createAgent({ name: 'high-perf', role: 'star' });

      // 低胜率: 1 成功 / 6 总计 (≈ 16%) / Low: 1 success out of 6 (~16%)
      for (let i = 0; i < 6; i++) {
        agentRepo.recordPersonaOutcome({
          personaId: lowAgent, taskType: 'coding',
          success: i === 0 ? 1 : 0, qualityScore: 0.3,
        });
      }
      // 高胜率: 5 成功 / 6 总计 (≈ 83%) / High: 5 successes out of 6 (~83%)
      for (let i = 0; i < 6; i++) {
        agentRepo.recordPersonaOutcome({
          personaId: highAgent, taskType: 'coding',
          success: i < 5 ? 1 : 0, qualityScore: 0.9,
        });
      }

      const under = evolution.detectUnderperformers('coding', { threshold: 0.4, minExecutions: 5 });

      // 只有低胜率 agent 应被检测出 / Only the low agent should be detected
      // 注意: 返回的 personaId 是 agent.role, 非 agent.id / Note: returned personaId is agent.role
      expect(under.length).toBeGreaterThanOrEqual(1);
      const ids = under.map(u => u.personaId);
      expect(ids).toContain('underperformer');
      // 高胜率不在列表中 / High performer not in list
      expect(ids).not.toContain('star');
    });
  });

  // ━━━ 4. 变异 / Mutation ━━━
  describe('mutatePersona', () => {
    it('变异应在 ±rate 范围内产生参数变化 / mutation should vary params within +/-rate', () => {
      const personaId = 'persona-mutate';
      const rate = 0.1;

      const result = evolution.mutatePersona(personaId, { mutationRate: rate });

      // 返回值应有 id 和变异元数据 / Result should have id and mutation metadata
      expect(result.id).toContain(personaId);
      expect(result._parentPersonaId).toBe(personaId);
      expect(result._mutationRate).toBe(rate);

      // 默认配置每个参数 = 0.5, 变异后应在 [0.5*(1-rate), 0.5*(1+rate)] 范围内
      // Default config: each param = 0.5; mutated should be within [0.5*(1-rate), 0.5*(1+rate)]
      const mutableParams = ['creativity', 'verbosity', 'riskTolerance', 'detailOrientation',
        'collaborativeness', 'autonomy', 'speed', 'thoroughness'];
      for (const param of mutableParams) {
        const val = result[param];
        // 原始值 0.5, 缩放 [0.9, 1.1] → [0.45, 0.55] / Original 0.5, scale [0.9,1.1] → [0.45,0.55]
        expect(val).toBeGreaterThanOrEqual(0.5 * (1 - rate) - 0.001);
        expect(val).toBeLessThanOrEqual(0.5 * (1 + rate) + 0.001);
      }
    });
  });

  // ━━━ 5. A/B 测试 / A/B Testing ━━━
  describe('startABTest + evaluateABTest', () => {
    it('应创建测试、记录结果并评估胜出者 / should create test, record results, and evaluate winner', () => {
      const testId = evolution.startABTest('personaA', 'personaB', 'coding', { trials: 2 });

      expect(testId).toBeTruthy();
      expect(testId.startsWith('ab_')).toBe(true);

      // 为 personaA 记录好结果 / Record good results for personaA
      evolution.recordABResult(testId, { persona: 'personaA', success: true, quality: 0.9, speed: 0.8 });
      evolution.recordABResult(testId, { persona: 'personaA', success: true, quality: 0.85, speed: 0.7 });

      // 为 personaB 记录差结果 / Record poor results for personaB
      evolution.recordABResult(testId, { persona: 'personaB', success: false, quality: 0.3, speed: 0.5 });
      const allDone = evolution.recordABResult(testId, { persona: 'personaB', success: false, quality: 0.2, speed: 0.4 });

      // 4 个结果 = 2 人格 x 2 次 → 全部完成 / 4 results = 2 personas x 2 trials → all done
      expect(allDone).toBe(true);

      // 评估: personaA 应胜出 / Evaluate: personaA should win
      const evaluation = evolution.evaluateABTest(testId);

      expect(evaluation.winner).toBe('personaA');
      expect(evaluation.metrics.personaA.compositeScore).toBeGreaterThan(
        evaluation.metrics.personaB.compositeScore,
      );
      expect(evaluation.metrics.margin).toBeGreaterThan(0);
    });

    it('无效 testId 应返回 null winner / invalid testId should return null winner', () => {
      const result = evolution.evaluateABTest('nonexistent');
      expect(result.winner).toBeNull();
    });
  });

  // ━━━ 6. 胶囊封装 / Capsule Promotion ━━━
  describe('promoteToCapsule', () => {
    it('胜率 > 70% 的人格应被封装 / persona with >70% win rate should be promoted', () => {
      const pid = 'top-persona';
      // 记录 6 次成功 (100% 胜率) / Record 6 successes (100% win rate)
      for (let i = 0; i < 6; i++) {
        agentRepo.recordPersonaOutcome({
          personaId: pid, taskType: 'coding',
          success: 1, qualityScore: 0.9,
        });
      }

      const capsuleId = evolution.promoteToCapsule(pid);

      expect(capsuleId).toBeTruthy();
      expect(capsuleId.startsWith('capsule_')).toBe(true);

      // 应发出事件 / Should emit capsule event
      const capsuleEvent = messageBus.events.find(e => e.name === 'persona.capsule.promoted');
      expect(capsuleEvent).toBeTruthy();
      expect(capsuleEvent.data.id).toBe(capsuleId);
    });

    it('胜率不足不应封装 / persona with low win rate should not be promoted', () => {
      const pid = 'weak-persona';
      // 记录 6 次: 2 成功 4 失败 (33% 胜率) / 6 records: 2 success 4 fail (33%)
      for (let i = 0; i < 6; i++) {
        agentRepo.recordPersonaOutcome({
          personaId: pid, taskType: 'coding',
          success: i < 2 ? 1 : 0, qualityScore: 0.4,
        });
      }

      const capsuleId = evolution.promoteToCapsule(pid);
      expect(capsuleId).toBeNull();
    });

    it('执行次数不足不应封装 / insufficient executions should not be promoted', () => {
      const pid = 'new-persona';
      // 只有 2 次记录 / Only 2 records
      agentRepo.recordPersonaOutcome({ personaId: pid, taskType: 'coding', success: 1, qualityScore: 0.9 });
      agentRepo.recordPersonaOutcome({ personaId: pid, taskType: 'coding', success: 1, qualityScore: 0.9 });

      const capsuleId = evolution.promoteToCapsule(pid);
      expect(capsuleId).toBeNull();
    });
  });

  // ━━━ 7. 进化历史 / Evolution History ━━━
  describe('getEvolutionHistory', () => {
    it('变异和 A/B 测试应记录到进化日志 / mutation and A/B test should be logged', () => {
      const pid = 'history-persona';

      // 触发变异 / Trigger mutation
      evolution.mutatePersona(pid, { mutationRate: 0.1 });

      // 触发 A/B 测试 / Trigger A/B test
      evolution.startABTest(pid, 'other-persona', 'coding');

      const history = evolution.getEvolutionHistory(pid);

      // 至少有 mutation + ab_test_started 两条记录
      // At least mutation + ab_test_started entries
      expect(history.length).toBeGreaterThanOrEqual(2);

      const types = history.map(e => e.type);
      expect(types).toContain('mutation');
      expect(types).toContain('ab_test_started');

      // 每条记录应有时间戳 / Each entry should have a timestamp
      for (const entry of history) {
        expect(entry.timestamp).toBeGreaterThan(0);
        expect(entry.personaId).toBe(pid);
      }
    });
  });
});
