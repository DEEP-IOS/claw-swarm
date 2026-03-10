/**
 * EvidenceGate V5.5 单元测试 / EvidenceGate V5.5 Unit Tests
 *
 * 测试证据纪律层: claim 注册、证据评估、层级权重、交叉验证加成
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EvidenceGate, EVIDENCE_TIERS } from '../../../src/L3-agent/evidence-gate.js';

function createMockBus() {
  const events = [];
  return {
    publish(topic, data) { events.push({ topic, data }); },
    subscribe() {},
    events,
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

describe('EvidenceGate V5.5', () => {
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
  // Claim 注册 / Claim Registration
  // ═══════════════════════════════════════════════════════════════════════

  describe('registerClaim', () => {
    it('should register claim and return score', () => {
      const result = gate.registerClaim({
        agentId: 'D1',
        content: 'API returns valid data',
        evidences: [
          { tier: 'PRIMARY', source: 'api:test', reliability: 0.9, summary: 'Direct API response' },
        ],
      });
      expect(result).toHaveProperty('claimId');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('verdict');
      expect(result.score).toBeGreaterThan(0);
    });

    it('should auto-generate claimId if not provided', () => {
      const result = gate.registerClaim({
        agentId: 'D1',
        content: 'Test claim',
      });
      expect(result.claimId).toBeDefined();
      expect(result.claimId.length).toBeGreaterThan(0);
    });

    it('should publish EVIDENCE_CLAIM_REGISTERED event', () => {
      gate.registerClaim({
        agentId: 'D1',
        content: 'Test claim',
        evidences: [{ tier: 'PRIMARY', source: 'test', reliability: 0.8 }],
      });
      const evt = mockBus.events.find(e => e.topic === 'evidence.claim.registered');
      expect(evt).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 证据层级权重 / Tier Weight Scoring
  // ═══════════════════════════════════════════════════════════════════════

  describe('tier weight scoring', () => {
    it('should give highest score to PRIMARY evidence', () => {
      const primary = gate.registerClaim({
        agentId: 'D1',
        content: 'Primary claim',
        evidences: [{ tier: 'PRIMARY', source: 'api', reliability: 1.0 }],
      });
      const inference = gate.registerClaim({
        agentId: 'D1',
        content: 'Inference claim',
        evidences: [{ tier: 'INFERENCE', source: 'logic', reliability: 1.0 }],
      });
      // PRIMARY weight=1.0 vs INFERENCE weight=0.4
      expect(primary.score).toBeGreaterThan(inference.score);
    });

    it('should apply corroboration bonus for ≥2 CORROBORATION evidences', () => {
      const singleCorr = gate.registerClaim({
        agentId: 'D1',
        content: 'Single corroboration',
        evidences: [
          { tier: 'CORROBORATION', source: 'src1', reliability: 0.8 },
        ],
      });
      const doubleCorr = gate.registerClaim({
        agentId: 'D1',
        content: 'Double corroboration',
        evidences: [
          { tier: 'CORROBORATION', source: 'src1', reliability: 0.8 },
          { tier: 'CORROBORATION', source: 'src2', reliability: 0.8 },
        ],
      });
      // 双交叉验证应获得 +0.1 加成
      expect(doubleCorr.score).toBeGreaterThan(singleCorr.score);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 评估 / Evaluation
  // ═══════════════════════════════════════════════════════════════════════

  describe('evaluateClaim', () => {
    it('should evaluate claim and return result', () => {
      const { claimId } = gate.registerClaim({
        agentId: 'D3',
        content: 'Code output verified',
        evidences: [{ tier: 'PRIMARY', source: 'code', reliability: 0.9 }],
      });
      const result = gate.evaluateClaim(claimId);
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('verdict');
      expect(result).toHaveProperty('meetsStandard');
      expect(result.meetsStandard).toBe(true);
    });

    it('should fail claim with low evidence', () => {
      const { claimId } = gate.registerClaim({
        agentId: 'D1',
        content: 'Unverified claim',
        evidences: [{ tier: 'INFERENCE', source: 'guess', reliability: 0.1 }],
      });
      const result = gate.evaluateClaim(claimId);
      // INFERENCE weight=0.4 * reliability=0.1 = 0.04 < minScore=0.3
      expect(result.meetsStandard).toBe(false);
      expect(result.verdict).toBe('FAIL');
    });

    it('should publish EVIDENCE_CLAIM_EVALUATED event', () => {
      const { claimId } = gate.registerClaim({
        agentId: 'D3',
        content: 'Test',
        evidences: [{ tier: 'PRIMARY', source: 'test', reliability: 0.8 }],
      });
      gate.evaluateClaim(claimId);
      const evt = mockBus.events.find(e => e.topic === 'evidence.claim.evaluated');
      expect(evt).toBeDefined();
      expect(evt.data.payload).toHaveProperty('meetsStandard');
    });

    it('should return null for non-existent claim', () => {
      expect(gate.evaluateClaim('non-existent')).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 自定义配置 / Custom Config
  // ═══════════════════════════════════════════════════════════════════════

  describe('custom config', () => {
    it('should accept custom minScore', () => {
      const strictGate = new EvidenceGate({
        messageBus: mockBus,
        logger,
        config: { minScore: 0.8 },
      });
      const { claimId } = strictGate.registerClaim({
        agentId: 'D1',
        content: 'Medium evidence',
        evidences: [{ tier: 'CORROBORATION', source: 'src', reliability: 0.8 }],
      });
      // CORROBORATION weight=0.75 * 0.8 = 0.6 < 0.8 custom minScore
      const result = strictGate.evaluateClaim(claimId);
      expect(result.meetsStandard).toBe(false);
    });

    it('should accept custom tierWeights', () => {
      const customGate = new EvidenceGate({
        messageBus: mockBus,
        logger,
        config: { tierWeights: { INFERENCE: 0.9 } },
      });
      const { score } = customGate.registerClaim({
        agentId: 'D1',
        content: 'Boosted inference',
        evidences: [{ tier: 'INFERENCE', source: 'logic', reliability: 1.0 }],
      });
      // Custom INFERENCE weight=0.9 * reliability=1.0 = 0.9
      expect(score).toBeGreaterThan(0.8);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 工厂方法 / Factory Method
  // ═══════════════════════════════════════════════════════════════════════

  describe('createEvidence', () => {
    it('should create standard evidence object', () => {
      const ev = EvidenceGate.createEvidence('PRIMARY', 'api:test', {
        reliability: 0.95,
        summary: 'API response data',
      });
      expect(ev.tier).toBe('PRIMARY');
      expect(ev.source).toBe('api:test');
      expect(ev.reliability).toBe(0.95);
      expect(ev).toHaveProperty('timestamp');
    });

    it('should clamp reliability to [0, 1]', () => {
      const ev = EvidenceGate.createEvidence('PRIMARY', 'test', { reliability: 1.5 });
      expect(ev.reliability).toBe(1);
    });

    it('should throw for invalid tier', () => {
      expect(() => EvidenceGate.createEvidence('INVALID', 'test')).toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // EVIDENCE_TIERS 导出 / EVIDENCE_TIERS Export
  // ═══════════════════════════════════════════════════════════════════════

  describe('EVIDENCE_TIERS', () => {
    it('should export all 3 tiers', () => {
      expect(EVIDENCE_TIERS.PRIMARY).toBe('PRIMARY');
      expect(EVIDENCE_TIERS.CORROBORATION).toBe('CORROBORATION');
      expect(EVIDENCE_TIERS.INFERENCE).toBe('INFERENCE');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 统计 / Statistics
  // ═══════════════════════════════════════════════════════════════════════

  describe('getStats', () => {
    it('should return comprehensive stats', () => {
      gate.registerClaim({
        agentId: 'D1',
        content: 'Test',
        evidences: [
          { tier: 'PRIMARY', source: 'test', reliability: 0.8 },
          { tier: 'CORROBORATION', source: 'test2', reliability: 0.7 },
        ],
      });

      const stats = gate.getStats();
      expect(stats.claimsRegistered).toBe(1);
      expect(stats.evidencesAttached).toBe(2);
      expect(stats.tierCounts.PRIMARY).toBe(1);
      expect(stats.tierCounts.CORROBORATION).toBe(1);
      expect(stats).toHaveProperty('activeClaims');
      expect(stats).toHaveProperty('minScore');
      expect(stats).toHaveProperty('passRate');
    });
  });
});
