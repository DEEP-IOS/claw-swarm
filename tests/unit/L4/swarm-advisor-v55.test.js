/**
 * SwarmAdvisor V5.5 单元测试 / SwarmAdvisor V5.5 Unit Tests
 *
 * 测试 V5.5 新增: GlobalModulator 集成、降级评估、紧急度指示
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SwarmAdvisor } from '../../../src/L4-orchestration/swarm-advisor.js';

function createMockBus() {
  const events = [];
  return {
    publish(topic, data) { events.push({ topic, data }); },
    subscribe() {},
    events,
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

describe('SwarmAdvisor V5.5 Enhancements', () => {
  let advisor;
  let mockBus;

  beforeEach(() => {
    mockBus = createMockBus();
    advisor = new SwarmAdvisor({
      messageBus: mockBus,
      logger,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // setGlobalModulator
  // ═══════════════════════════════════════════════════════════════════════

  describe('setGlobalModulator', () => {
    it('should accept globalModulator instance', () => {
      const mockModulator = {
        getModulationFactors() {
          return { thresholdMult: 0.8, costTolerance: 1.3, evidenceStrictness: 0.7 };
        },
        getCurrentMode() { return 'EXPLORE'; },
      };
      advisor.setGlobalModulator(mockModulator);
      expect(advisor._globalModulator).toBe(mockModulator);
    });

    it('should handle null gracefully', () => {
      advisor.setGlobalModulator(null);
      expect(advisor._globalModulator).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // isHighStimulus with GlobalModulator
  // ═══════════════════════════════════════════════════════════════════════

  describe('isHighStimulus with GlobalModulator', () => {
    it('should use default threshold without modulator', () => {
      // 默认阈值 0.5，高于阈值应返回 true
      const result = advisor.isHighStimulus(0.6);
      expect(result).toBe(true);
    });

    it('should apply thresholdMult from modulator (EXPLORE lowers threshold)', () => {
      const mockModulator = {
        getModulationFactors() {
          return { thresholdMult: 0.8, costTolerance: 1.3, evidenceStrictness: 0.7 };
        },
      };
      advisor.setGlobalModulator(mockModulator);
      // EXPLORE: threshold = 0.5 * 0.8 = 0.4, stimulus 0.45 > 0.4 → true
      const result = advisor.isHighStimulus(0.45);
      expect(result).toBe(true);
    });

    it('should apply thresholdMult from modulator (EXPLOIT raises threshold)', () => {
      const mockModulator = {
        getModulationFactors() {
          return { thresholdMult: 1.3, costTolerance: 0.8, evidenceStrictness: 1.2 };
        },
      };
      advisor.setGlobalModulator(mockModulator);
      // EXPLOIT: threshold = 0.5 * 1.3 = 0.65, stimulus 0.6 < 0.65 → false
      const result = advisor.isHighStimulus(0.6);
      expect(result).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // computeStimulus (基础功能验证)
  // ═══════════════════════════════════════════════════════════════════════

  describe('computeStimulus', () => {
    it('should return 0 for empty input', () => {
      expect(advisor.computeStimulus('')).toBe(0);
    });

    it('should return low value for short simple input', () => {
      const s = advisor.computeStimulus('hello');
      expect(s).toBeLessThan(0.3);
    });

    it('should return higher value for complex multi-step input', () => {
      const s = advisor.computeStimulus(
        '请帮我分析这个项目的架构，然后调研最佳实践方案，最后生成一份报告'
      );
      expect(s).toBeGreaterThan(0.3);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Turn 隔离 / Turn Isolation
  // ═══════════════════════════════════════════════════════════════════════

  describe('turn isolation', () => {
    it('should create independent turn entries', () => {
      advisor.resetTurn('turn-1');
      advisor.resetTurn('turn-2');
      expect(advisor._turns.size).toBe(2);
    });

    it('should not interfere between turns', () => {
      advisor.resetTurn('turn-1');
      advisor.resetTurn('turn-2');
      advisor.markSwarmToolUsed('turn-1');
      const t1 = advisor._turns.get('turn-1');
      const t2 = advisor._turns.get('turn-2');
      expect(t1.swarmToolCalled).toBe(true);
      expect(t2.swarmToolCalled).toBe(false);
    });

    it('should auto-cleanup old turns beyond MAX_TURNS', () => {
      // Create more than MAX_TURNS entries
      for (let i = 0; i < 55; i++) {
        advisor.resetTurn(`turn-${i}`);
      }
      expect(advisor._turns.size).toBeLessThanOrEqual(50);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // buildCapabilityProfile
  // ═══════════════════════════════════════════════════════════════════════

  describe('buildCapabilityProfile', () => {
    it('should contain D1/D3/D2 descriptions', () => {
      const profile = advisor.buildCapabilityProfile();
      expect(profile).toContain('D1');
      expect(profile).toContain('D3');
      expect(profile).toContain('D2');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // buildAdvisoryContext
  // ═══════════════════════════════════════════════════════════════════════

  describe('buildAdvisoryContext', () => {
    it('should return short context for low stimulus', () => {
      const ctx = advisor.buildAdvisoryContext('hello', 0.2);
      expect(ctx.length).toBeLessThan(200);
    });

    it('should return detailed context for high stimulus', () => {
      const ctx = advisor.buildAdvisoryContext('complex analysis task', 0.8);
      expect(ctx.length).toBeGreaterThan(100);
    });
  });
});
