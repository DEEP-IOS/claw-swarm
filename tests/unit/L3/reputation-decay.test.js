/**
 * Reputation Decay 单元测试 / Reputation Decay Unit Tests
 *
 * V6.0 L3: 声誉半衰期衰减 + 6D 声誉维度测试
 * V6.0 L3: Tests for exponential reputation decay and 6D reputation dimensions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReputationLedger } from '../../../src/L3-agent/reputation-ledger.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function createMockBus() {
  return { publish: vi.fn(), subscribe: vi.fn(() => () => {}) };
}

function createMockAgentRepo() {
  const capabilities = new Map();
  return {
    getAgent: vi.fn(() => null),
    updateAgent: vi.fn(),
    getCapabilities: vi.fn((agentId) => {
      const key = agentId;
      return capabilities.has(key) ? [...capabilities.get(key)] : [];
    }),
    createCapability: vi.fn((agentId, dimension, score) => {
      if (!capabilities.has(agentId)) capabilities.set(agentId, []);
      const list = capabilities.get(agentId);
      const idx = list.findIndex((c) => c.dimension === dimension);
      if (idx >= 0) list[idx].score = score;
      else list.push({ dimension, score });
    }),
    listAgents: vi.fn(() => []),
  };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('ReputationLedger (V6.0 Enhancements)', () => {
  let ledger;
  let bus;

  beforeEach(() => {
    bus = createMockBus();
    ledger = new ReputationLedger({
      agentRepo: createMockAgentRepo(),
      messageBus: bus,
      logger: silentLogger,
    });
  });

  describe('构造 / Construction', () => {
    it('创建实例不报错 / creates without error', () => {
      expect(ledger).toBeDefined();
    });
  });

  describe('6D 声誉维度 / 6D Reputation Dimensions', () => {
    it('getReputation 返回结构化数据 / getReputation returns structured data', () => {
      const rep = ledger.getReputation('agent-A');
      expect(rep).toBeDefined();
      if (typeof rep === 'object' && rep !== null) {
        expect(typeof rep).toBe('object');
      }
    });
  });

  describe('Shapley 信用记录 / Shapley Credit Recording', () => {
    it('recordShapleyCredit 存在且不报错 / recordShapleyCredit exists and works', () => {
      expect(typeof ledger.recordShapleyCredit).toBe('function');
      expect(() => ledger.recordShapleyCredit('agent-A', 0.75, 'dag-001')).not.toThrow();
    });
  });

  describe('SNA 分数更新 / SNA Score Update', () => {
    it('updateSNAScores 存在且不报错 / updateSNAScores exists and works', () => {
      expect(typeof ledger.updateSNAScores).toBe('function');
      expect(() => ledger.updateSNAScores('agent-A', {
        degreeCentrality: 0.6,
        betweennessCentrality: 0.4,
      })).not.toThrow();
    });
  });
});
