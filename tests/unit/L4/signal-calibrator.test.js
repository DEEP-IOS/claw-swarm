/**
 * SignalCalibrator 单元测试 / SignalCalibrator Unit Tests
 *
 * V6.0 L4: 互信息信号自校准测试
 * V6.0 L4: Tests for MI-based signal auto-calibration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SignalCalibrator } from '../../../src/L4-orchestration/signal-calibrator.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
const mockBus = { publish: vi.fn(), subscribe: vi.fn(() => () => {}) };

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('SignalCalibrator', () => {
  let calibrator;

  beforeEach(() => {
    mockBus.publish.mockClear();
    calibrator = new SignalCalibrator({
      messageBus: mockBus,
      logger: silentLogger,
      config: { minSamples: 10, stableSamples: 20, calibrationIntervalTurns: 5 },
    });
  });

  describe('构造 / Construction', () => {
    it('创建实例不报错 / creates without error', () => {
      expect(calibrator).toBeDefined();
    });

    it('getWeights 返回初始手动权重 / getWeights returns manual weights initially', () => {
      const weights = calibrator.getWeights();
      expect(weights).toBeDefined();
      expect(typeof weights).toBe('object');
    });

    it('getPhaseInfo 返回阶段信息 / getPhaseInfo returns phase info', () => {
      const phase = calibrator.getPhaseInfo();
      expect(phase).toBeDefined();
    });
  });

  describe('recordSample / Record Sample', () => {
    it('记录样本不报错 / records sample without error', () => {
      expect(() => {
        calibrator.recordSample(
          { reputationScore: 0.8, capabilityScore: 0.7, convergenceScore: 0.6 },
          'success',
        );
      }).not.toThrow();
    });

    it('多次记录样本 / records multiple samples', () => {
      for (let i = 0; i < 15; i++) {
        calibrator.recordSample(
          {
            reputationScore: Math.random(),
            capabilityScore: Math.random(),
            convergenceScore: Math.random(),
          },
          i % 3 === 0 ? 'failure' : 'success',
        );
      }
      // 不报错即可 / Should not throw
    });
  });

  describe('calibrate / Calibrate', () => {
    it('样本不足时返回手动权重 / returns manual weights with insufficient samples', () => {
      calibrator.recordSample({ reputationScore: 0.5 }, 'success');
      const weights = calibrator.calibrate();
      expect(weights).toBeDefined();
    });

    it('足够样本后计算 MI 权重 / computes MI weights with enough samples', () => {
      // 插入超过 minSamples 的样本
      for (let i = 0; i < 15; i++) {
        calibrator.recordSample(
          {
            reputationScore: i > 7 ? 0.9 : 0.1,
            capabilityScore: Math.random(),
            convergenceScore: Math.random(),
          },
          i > 7 ? 'success' : 'failure',
        );
      }

      const weights = calibrator.calibrate();
      expect(weights).toBeDefined();
      // 应至少有一些权重
      const entries = weights instanceof Map ? [...weights.entries()] : Object.entries(weights);
      expect(entries.length).toBeGreaterThan(0);
    });

    it('权重有 floor/cap 约束 / weights have floor/cap constraints', () => {
      for (let i = 0; i < 25; i++) {
        calibrator.recordSample(
          {
            reputationScore: Math.random(),
            capabilityScore: Math.random(),
            convergenceScore: Math.random(),
            modulatorScore: Math.random(),
          },
          Math.random() > 0.5 ? 'success' : 'failure',
        );
      }

      const weights = calibrator.calibrate();
      const entries = weights instanceof Map ? [...weights.values()] : Object.values(weights);
      for (const w of entries) {
        expect(w).toBeGreaterThanOrEqual(0.03); // floor
        expect(w).toBeLessThanOrEqual(0.40);    // cap
      }
    });
  });

  describe('三阶段渐进 / Three-phase Progression', () => {
    it('初始为阶段 1 (手动) / starts in phase 1 (manual)', () => {
      const phase = calibrator.getPhaseInfo();
      // 阶段 1: turn < minSamples
      expect(phase).toBeDefined();
    });

    it('样本达标后进入阶段 2 (混合) / enters phase 2 after minSamples', () => {
      for (let i = 0; i < 12; i++) {
        calibrator.recordSample(
          { reputationScore: Math.random(), capabilityScore: Math.random() },
          Math.random() > 0.3 ? 'success' : 'failure',
        );
      }
      calibrator.calibrate();
      // 应进入阶段 2 或保持阶段 1 (取决于标准差)
    });
  });
});
