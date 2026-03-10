/**
 * EvidenceGate V5.4 单元测试 / EvidenceGate V5.4 Unit Tests
 *
 * 测试证据纪律层的所有核心功能:
 * Tests all core features of the Evidence Discipline Layer:
 * - 三层证据分级 (PRIMARY/CORROBORATION/INFERENCE)
 * - Claim 注册、证据附加、评估、报告
 * - 证据质量分数计算
 * - 交叉验证加成
 * - 统计追踪
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EvidenceGate, EVIDENCE_TIERS } from '../../../src/L3-agent/evidence-gate.js';

// ── 模拟依赖 / Mock Dependencies ──

function createMockBus() {
  const _published = [];
  return {
    publish(topic, data) { _published.push({ topic, data }); },
    subscribe() {},
    _published,
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

// ── Tests ──

describe('EvidenceGate', () => {
  let gate;
  let mockBus;

  beforeEach(() => {
    mockBus = createMockBus();
    gate = new EvidenceGate({
      messageBus: mockBus,
      logger,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // EVIDENCE_TIERS 常量
  // ═══════════════════════════════════════════════════════════════════════

  describe('EVIDENCE_TIERS', () => {
    it('导出三层证据类型 / exports 3 evidence tiers', () => {
      expect(EVIDENCE_TIERS.PRIMARY).toBe('PRIMARY');
      expect(EVIDENCE_TIERS.CORROBORATION).toBe('CORROBORATION');
      expect(EVIDENCE_TIERS.INFERENCE).toBe('INFERENCE');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 构造函数 / Constructor
  // ═══════════════════════════════════════════════════════════════════════

  describe('constructor', () => {
    it('可无依赖创建 / can be created with no deps', () => {
      const bareGate = new EvidenceGate({});
      expect(bareGate).toBeDefined();
      expect(bareGate.getStats().claimsRegistered).toBe(0);
    });

    it('支持自定义 minScore / supports custom minScore', () => {
      const customGate = new EvidenceGate({ config: { minScore: 0.6 }, logger });
      expect(customGate.getStats().minScore).toBe(0.6);
    });

    it('支持自定义 tierWeights / supports custom tier weights', () => {
      const customGate = new EvidenceGate({
        config: { tierWeights: { PRIMARY: 0.8 } },
        logger,
      });
      expect(customGate).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // registerClaim
  // ═══════════════════════════════════════════════════════════════════════

  describe('registerClaim', () => {
    it('注册空 claim → INSUFFICIENT / empty claim → INSUFFICIENT', () => {
      const result = gate.registerClaim({
        agentId: 'D1',
        content: 'A股大盘走势看涨',
      });
      expect(result.claimId).toBeDefined();
      expect(result.score).toBe(0);
      expect(result.verdict).toBe('INSUFFICIENT');
    });

    it('注册带 PRIMARY 证据的 claim → PASS / claim with PRIMARY evidence → PASS', () => {
      const result = gate.registerClaim({
        agentId: 'D1',
        content: 'Tushare API 返回 3500 点',
        evidences: [
          { tier: 'PRIMARY', source: 'api:tushare.daily', reliability: 0.9, summary: 'API response data' },
        ],
      });
      expect(result.score).toBeGreaterThan(0);
      expect(result.verdict).toBe('PASS');
      expect(result.tierBreakdown.primary).toBe(1);
    });

    it('使用自定义 claimId / uses custom claimId', () => {
      const result = gate.registerClaim({
        claimId: 'claim-test-123',
        agentId: 'D3',
        content: '测试声明',
      });
      expect(result.claimId).toBe('claim-test-123');
    });

    it('更新统计 / updates statistics', () => {
      gate.registerClaim({ agentId: 'D1', content: '声明1' });
      gate.registerClaim({ agentId: 'D2', content: '声明2' });
      expect(gate.getStats().claimsRegistered).toBe(2);
    });

    it('发布 EVIDENCE_CLAIM_REGISTERED 事件 / publishes registration event', () => {
      gate.registerClaim({
        agentId: 'D1',
        content: '测试',
        evidences: [{ tier: 'PRIMARY', source: 'test', reliability: 0.8 }],
      });
      const events = mockBus._published.filter(e => e.topic === 'evidence.claim.registered');
      expect(events.length).toBe(1);
      expect(events[0].data.payload.agentId).toBe('D1');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // attachEvidence
  // ═══════════════════════════════════════════════════════════════════════

  describe('attachEvidence', () => {
    it('向已注册 claim 附加证据 / attach evidence to existing claim', () => {
      const { claimId } = gate.registerClaim({
        agentId: 'D1',
        content: '声明',
      });

      const result = gate.attachEvidence(claimId, {
        tier: 'PRIMARY',
        source: 'api:data',
        reliability: 0.8,
        summary: '接口返回数据',
      });

      expect(result).not.toBeNull();
      expect(result.score).toBeGreaterThan(0);
      expect(result.verdict).toBe('PASS');
    });

    it('不存在的 claimId 返回 null / unknown claimId returns null', () => {
      expect(gate.attachEvidence('nonexistent', {
        tier: 'PRIMARY',
        source: 'test',
      })).toBeNull();
    });

    it('附加后分数更新 / score updates after attachment', () => {
      const { claimId } = gate.registerClaim({
        agentId: 'D1',
        content: '声明',
        evidences: [{ tier: 'INFERENCE', source: 'logic', reliability: 0.3 }],
      });
      const initial = gate.getClaim(claimId).score;

      gate.attachEvidence(claimId, {
        tier: 'PRIMARY',
        source: 'api:verified',
        reliability: 0.9,
      });
      const after = gate.getClaim(claimId).score;

      expect(after).toBeGreaterThan(initial);
    });

    it('更新证据统计 / updates evidence stats', () => {
      const { claimId } = gate.registerClaim({
        agentId: 'D1',
        content: '声明',
      });
      gate.attachEvidence(claimId, { tier: 'PRIMARY', source: 'test' });
      gate.attachEvidence(claimId, { tier: 'CORROBORATION', source: 'test2' });

      const stats = gate.getStats();
      expect(stats.evidencesAttached).toBe(2);
      expect(stats.tierCounts.PRIMARY).toBe(1);
      expect(stats.tierCounts.CORROBORATION).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // evaluateClaim
  // ═══════════════════════════════════════════════════════════════════════

  describe('evaluateClaim', () => {
    it('评估高质量 claim → PASS + meetsStandard / high quality → PASS', () => {
      const { claimId } = gate.registerClaim({
        agentId: 'D1',
        content: 'API 数据确认',
        evidences: [
          { tier: 'PRIMARY', source: 'api:tushare', reliability: 0.9 },
        ],
      });

      const result = gate.evaluateClaim(claimId);
      expect(result.verdict).toBe('PASS');
      expect(result.meetsStandard).toBe(true);
    });

    it('评估低质量 claim → FAIL / low quality → FAIL', () => {
      const { claimId } = gate.registerClaim({
        agentId: 'D3',
        content: '我觉得应该这样',
        evidences: [
          { tier: 'INFERENCE', source: 'speculation', reliability: 0.1 },
        ],
      });

      const result = gate.evaluateClaim(claimId);
      expect(result.verdict).toBe('FAIL');
      expect(result.meetsStandard).toBe(false);
    });

    it('评估空证据 claim → INSUFFICIENT / no evidence → INSUFFICIENT', () => {
      const { claimId } = gate.registerClaim({
        agentId: 'D2',
        content: '未验证声明',
      });

      const result = gate.evaluateClaim(claimId);
      expect(result.verdict).toBe('INSUFFICIENT');
      expect(result.meetsStandard).toBe(false);
    });

    it('不存在的 claimId 返回 null / unknown claimId returns null', () => {
      expect(gate.evaluateClaim('nonexistent')).toBeNull();
    });

    it('更新 passed/failed 统计 / updates pass/fail stats', () => {
      const { claimId: passId } = gate.registerClaim({
        agentId: 'D1',
        content: '通过',
        evidences: [{ tier: 'PRIMARY', source: 'api', reliability: 0.9 }],
      });
      const { claimId: failId } = gate.registerClaim({
        agentId: 'D3',
        content: '失败',
        evidences: [{ tier: 'INFERENCE', source: 'guess', reliability: 0.1 }],
      });

      gate.evaluateClaim(passId);
      gate.evaluateClaim(failId);

      const stats = gate.getStats();
      expect(stats.evaluations).toBe(2);
      expect(stats.passed).toBe(1);
      expect(stats.failed).toBe(1);
    });

    it('发布 EVIDENCE_CLAIM_EVALUATED 事件 / publishes evaluation event', () => {
      const { claimId } = gate.registerClaim({
        agentId: 'D1',
        content: '测试',
        evidences: [{ tier: 'PRIMARY', source: 'test', reliability: 0.8 }],
      });
      gate.evaluateClaim(claimId);

      const events = mockBus._published.filter(e => e.topic === 'evidence.claim.evaluated');
      expect(events.length).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // meetsStandard
  // ═══════════════════════════════════════════════════════════════════════

  describe('meetsStandard', () => {
    it('高质量 claim 达标 / high quality claim meets standard', () => {
      const { claimId } = gate.registerClaim({
        agentId: 'D1',
        content: '声明',
        evidences: [{ tier: 'PRIMARY', source: 'api', reliability: 0.8 }],
      });
      expect(gate.meetsStandard(claimId)).toBe(true);
    });

    it('低质量 claim 不达标 / low quality claim fails standard', () => {
      const { claimId } = gate.registerClaim({
        agentId: 'D3',
        content: '声明',
        evidences: [{ tier: 'INFERENCE', source: 'guess', reliability: 0.1 }],
      });
      expect(gate.meetsStandard(claimId)).toBe(false);
    });

    it('支持自定义最低分 / supports custom min score', () => {
      const { claimId } = gate.registerClaim({
        agentId: 'D1',
        content: '声明',
        evidences: [{ tier: 'CORROBORATION', source: 'src', reliability: 0.5 }],
      });
      // 默认 minScore=0.3, 这个 claim 的分数 = 0.75 * 0.5 = 0.375 > 0.3 → true
      expect(gate.meetsStandard(claimId)).toBe(true);
      // 自定义 minScore=0.5 → 0.375 < 0.5 → false
      expect(gate.meetsStandard(claimId, 0.5)).toBe(false);
    });

    it('不存在的 claim 返回 false / unknown claim returns false', () => {
      expect(gate.meetsStandard('nonexistent')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 分数计算 / Score Computation
  // ═══════════════════════════════════════════════════════════════════════

  describe('score computation', () => {
    it('PRIMARY 证据权重最高 / PRIMARY has highest weight', () => {
      const { claimId: primaryId } = gate.registerClaim({
        agentId: 'D1',
        content: '声明',
        evidences: [{ tier: 'PRIMARY', source: 'api', reliability: 0.5 }],
      });
      const { claimId: inferenceId } = gate.registerClaim({
        agentId: 'D1',
        content: '声明',
        evidences: [{ tier: 'INFERENCE', source: 'logic', reliability: 0.5 }],
      });

      const primaryScore = gate.getClaim(primaryId).score;
      const inferenceScore = gate.getClaim(inferenceId).score;
      expect(primaryScore).toBeGreaterThan(inferenceScore);
    });

    it('多源交叉验证获得加成 / multi-source corroboration gets bonus', () => {
      const { claimId: singleId } = gate.registerClaim({
        agentId: 'D1',
        content: '声明',
        evidences: [
          { tier: 'CORROBORATION', source: 'src1', reliability: 0.5 },
        ],
      });
      const { claimId: multiId } = gate.registerClaim({
        agentId: 'D1',
        content: '声明',
        evidences: [
          { tier: 'CORROBORATION', source: 'src1', reliability: 0.5 },
          { tier: 'CORROBORATION', source: 'src2', reliability: 0.5 },
        ],
      });

      const singleScore = gate.getClaim(singleId).score;
      const multiScore = gate.getClaim(multiId).score;
      // multiScore 应该更高 (包含 +0.1 加成)
      expect(multiScore).toBeGreaterThan(singleScore);
    });

    it('reliability 影响分数 / reliability affects score', () => {
      const { claimId: highRelId } = gate.registerClaim({
        agentId: 'D1',
        content: '声明',
        evidences: [{ tier: 'PRIMARY', source: 'api', reliability: 0.9 }],
      });
      const { claimId: lowRelId } = gate.registerClaim({
        agentId: 'D1',
        content: '声明',
        evidences: [{ tier: 'PRIMARY', source: 'api', reliability: 0.2 }],
      });

      expect(gate.getClaim(highRelId).score).toBeGreaterThan(gate.getClaim(lowRelId).score);
    });

    it('分数范围 [0, 1] / score in [0, 1] range', () => {
      // 极高分
      const { claimId: highId } = gate.registerClaim({
        agentId: 'D1',
        content: '声明',
        evidences: [
          { tier: 'PRIMARY', source: 'api1', reliability: 1.0 },
          { tier: 'PRIMARY', source: 'api2', reliability: 1.0 },
          { tier: 'CORROBORATION', source: 'src', reliability: 1.0 },
          { tier: 'CORROBORATION', source: 'src2', reliability: 1.0 },
        ],
      });
      expect(gate.getClaim(highId).score).toBeLessThanOrEqual(1);
      expect(gate.getClaim(highId).score).toBeGreaterThanOrEqual(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getClaimReport
  // ═══════════════════════════════════════════════════════════════════════

  describe('getClaimReport', () => {
    it('生成可读报告 / generates readable report', () => {
      const { claimId } = gate.registerClaim({
        agentId: 'D1',
        content: 'A股走势看涨',
        evidences: [
          { tier: 'PRIMARY', source: 'api:tushare', reliability: 0.9, summary: 'daily data' },
          { tier: 'CORROBORATION', source: 'agent:D2', reliability: 0.7, summary: 'D2 confirmed' },
          { tier: 'INFERENCE', source: 'logic', reliability: 0.4, summary: 'trend analysis' },
        ],
      });

      const report = gate.getClaimReport(claimId);
      expect(report).toContain('证据报告');
      expect(report).toContain('D1');
      expect(report).toContain('正文引用: 1');
      expect(report).toContain('交叉验证: 1');
      expect(report).toContain('推论推断: 1');
      expect(report).toContain('正文');
      expect(report).toContain('api:tushare');
    });

    it('不存在的 claim 返回 null / unknown claim returns null', () => {
      expect(gate.getClaimReport('nonexistent')).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getClaim / getClaimsByAgent
  // ═══════════════════════════════════════════════════════════════════════

  describe('query', () => {
    it('getClaim 返回完整 claim / getClaim returns full claim', () => {
      const { claimId } = gate.registerClaim({
        agentId: 'D1',
        content: '声明内容',
        taskId: 'task-123',
        evidences: [{ tier: 'PRIMARY', source: 'api', reliability: 0.8 }],
      });

      const claim = gate.getClaim(claimId);
      expect(claim.agentId).toBe('D1');
      expect(claim.taskId).toBe('task-123');
      expect(claim.evidences.length).toBe(1);
      expect(claim.tierBreakdown.primary).toBe(1);
    });

    it('getClaim 不存在返回 null / getClaim unknown returns null', () => {
      expect(gate.getClaim('nonexistent')).toBeNull();
    });

    it('getClaimsByAgent 按 agent 过滤 / getClaimsByAgent filters by agent', () => {
      gate.registerClaim({ agentId: 'D1', content: '声明1' });
      gate.registerClaim({ agentId: 'D1', content: '声明2' });
      gate.registerClaim({ agentId: 'D2', content: '声明3' });

      const d1Claims = gate.getClaimsByAgent('D1');
      expect(d1Claims.length).toBe(2);

      const d2Claims = gate.getClaimsByAgent('D2');
      expect(d2Claims.length).toBe(1);
    });

    it('getClaimsByAgent 返回空数组 / returns empty for unknown agent', () => {
      expect(gate.getClaimsByAgent('nonexistent')).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // createEvidence 工厂方法
  // ═══════════════════════════════════════════════════════════════════════

  describe('createEvidence', () => {
    it('创建标准 PRIMARY 证据 / creates standard PRIMARY evidence', () => {
      const ev = EvidenceGate.createEvidence('PRIMARY', 'api:tushare', {
        reliability: 0.9,
        summary: 'daily data',
      });
      expect(ev.tier).toBe('PRIMARY');
      expect(ev.source).toBe('api:tushare');
      expect(ev.reliability).toBe(0.9);
      expect(ev.summary).toBe('daily data');
      expect(ev.timestamp).toBeGreaterThan(0);
    });

    it('reliability 被裁剪到 [0, 1] / reliability clamped to [0, 1]', () => {
      const ev1 = EvidenceGate.createEvidence('PRIMARY', 'test', { reliability: 1.5 });
      expect(ev1.reliability).toBe(1);

      const ev2 = EvidenceGate.createEvidence('PRIMARY', 'test', { reliability: -0.5 });
      expect(ev2.reliability).toBe(0);
    });

    it('无效 tier 抛出错误 / invalid tier throws error', () => {
      expect(() => EvidenceGate.createEvidence('INVALID', 'test')).toThrow('Invalid evidence tier');
    });

    it('默认 reliability = 0.5 / default reliability is 0.5', () => {
      const ev = EvidenceGate.createEvidence('INFERENCE', 'logic');
      expect(ev.reliability).toBe(0.5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getStats
  // ═══════════════════════════════════════════════════════════════════════

  describe('getStats', () => {
    it('返回综合统计 / returns comprehensive statistics', () => {
      gate.registerClaim({
        agentId: 'D1',
        content: '声明1',
        evidences: [{ tier: 'PRIMARY', source: 'api', reliability: 0.9 }],
      });
      const { claimId } = gate.registerClaim({
        agentId: 'D2',
        content: '声明2',
        evidences: [{ tier: 'INFERENCE', source: 'guess', reliability: 0.1 }],
      });
      gate.evaluateClaim(claimId);

      const stats = gate.getStats();
      expect(stats.claimsRegistered).toBe(2);
      expect(stats.evidencesAttached).toBe(2);
      expect(stats.evaluations).toBe(1);
      expect(stats.activeClaims).toBe(2);
      expect(stats.minScore).toBe(0.3);
      expect(stats.tierCounts.PRIMARY).toBe(1);
      expect(stats.tierCounts.INFERENCE).toBe(1);
    });

    it('passRate 正确计算 / passRate calculated correctly', () => {
      const { claimId: id1 } = gate.registerClaim({
        agentId: 'D1',
        content: '通过',
        evidences: [{ tier: 'PRIMARY', source: 'api', reliability: 0.9 }],
      });
      const { claimId: id2 } = gate.registerClaim({
        agentId: 'D2',
        content: '失败',
      });

      gate.evaluateClaim(id1);
      gate.evaluateClaim(id2);

      expect(gate.getStats().passRate).toBe(0.5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 边界情况 / Edge Cases
  // ═══════════════════════════════════════════════════════════════════════

  describe('edge cases', () => {
    it('无效证据 tier 降级为 INFERENCE / invalid tier falls back to INFERENCE', () => {
      const { claimId } = gate.registerClaim({
        agentId: 'D1',
        content: '声明',
        evidences: [{ tier: 'INVALID_TIER', source: 'test', reliability: 0.5 }],
      });
      const claim = gate.getClaim(claimId);
      expect(claim.evidences[0].tier).toBe('INFERENCE');
    });

    it('reliability 超限被裁剪 / out-of-range reliability clamped', () => {
      const { claimId } = gate.registerClaim({
        agentId: 'D1',
        content: '声明',
        evidences: [{ tier: 'PRIMARY', source: 'test', reliability: 5.0 }],
      });
      const claim = gate.getClaim(claimId);
      expect(claim.evidences[0].reliability).toBe(1);
    });

    it('content 超长被截断 / long content truncated', () => {
      const { claimId } = gate.registerClaim({
        agentId: 'D1',
        content: 'A'.repeat(1000),
      });
      const claim = gate.getClaim(claimId);
      expect(claim.content.length).toBeLessThanOrEqual(500);
    });

    it('超过 MAX_CLAIMS 自动清理 / exceeding MAX_CLAIMS auto-cleanup', () => {
      // 注册 210 个 claims
      for (let i = 0; i < 210; i++) {
        gate.registerClaim({ agentId: 'D1', content: `claim-${i}` });
      }
      expect(gate.getStats().activeClaims).toBeLessThanOrEqual(200);
    });

    it('无 messageBus 不影响功能 / works without messageBus', () => {
      const bareGate = new EvidenceGate({ logger });
      const { claimId } = bareGate.registerClaim({
        agentId: 'D1',
        content: '测试',
        evidences: [{ tier: 'PRIMARY', source: 'api', reliability: 0.8 }],
      });
      expect(bareGate.evaluateClaim(claimId).verdict).toBe('PASS');
    });

    it('空证据对象被跳过 / null evidence skipped', () => {
      const { claimId } = gate.registerClaim({
        agentId: 'D1',
        content: '声明',
        evidences: [null, undefined, { tier: null }, { tier: 'PRIMARY', source: 'api', reliability: 0.8 }],
      });
      const claim = gate.getClaim(claimId);
      // null, undefined, {tier:null} 被跳过, 只有最后一条有效
      expect(claim.evidences.length).toBe(1);
    });
  });
});
