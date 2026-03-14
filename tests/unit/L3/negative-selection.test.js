/**
 * NegativeSelection 单元测试 / NegativeSelection Unit Tests
 *
 * V7.0 L3: 负选择免疫检测器测试
 * V7.0 L3: Tests for immune-inspired negative selection anomaly detector
 *
 * @author DEEP-IOS
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NegativeSelection } from '../../../src/L3-agent/negative-selection.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** 模拟 MessageBus / Mock MessageBus */
function createMockBus() {
  const published = [];
  return {
    publish(topic, data) { published.push({ topic, data }); },
    subscribe(topic, handler) { return () => {}; },
    _published: published,
  };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('NegativeSelection', () => {
  let ns;
  let messageBus;

  beforeEach(() => {
    messageBus = createMockBus();
    ns = new NegativeSelection({
      messageBus,
      logger: silentLogger,
      config: {},
    });
  });

  // ━━━ 1. 构造 / Construction ━━━
  describe('构造 / Construction', () => {
    it('创建实例使用默认值 / creates instance with defaults', () => {
      const instance = new NegativeSelection();
      expect(instance).toBeDefined();

      const stats = instance.getStats();
      expect(stats.checks).toBe(0);
      expect(stats.anomaliesDetected).toBe(0);
      expect(stats.customDetectorCount).toBe(0);
      expect(stats.builtinPatternCount).toBeGreaterThan(0);
    });
  });

  // ━━━ 2. detect — 空/干净输出 / Empty & Clean Output ━━━
  describe('detect — non-anomaly for empty/clean output', () => {
    it('空字符串返回非异常 / empty string returns non-anomaly', () => {
      const result = ns.detect('');
      expect(result.isAnomaly).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.matchedPatterns).toEqual([]);
      expect(result.vaccines).toEqual([]);
    });

    it('null 输入返回非异常 / null input returns non-anomaly', () => {
      const result = ns.detect(null);
      expect(result.isAnomaly).toBe(false);
    });

    it('undefined 输入返回非异常 / undefined input returns non-anomaly', () => {
      const result = ns.detect(undefined);
      expect(result.isAnomaly).toBe(false);
    });

    it('干净输出返回非异常 / clean output returns non-anomaly', () => {
      const result = ns.detect('This is a perfectly normal and successful output with no issues at all.');
      expect(result.isAnomaly).toBe(false);
      expect(result.matchedPatterns).toEqual([]);
    });
  });

  // ━━━ 3. detect — 错误关键词 / Error Keywords ━━━
  describe('detect — error keywords', () => {
    it('检测 "error" 关键词 / detects "error" keyword', () => {
      const result = ns.detect('An error occurred while processing the request');
      expect(result.matchedPatterns).toContain('error_keyword');
    });

    it('检测 "exception" 关键词 / detects "exception" keyword', () => {
      const result = ns.detect('Unhandled exception in module handler');
      expect(result.matchedPatterns).toContain('error_keyword');
    });

    it('检测 "stack overflow" 关键词 / detects "stack overflow" keyword', () => {
      const result = ns.detect('Maximum call stack overflow detected in recursive function');
      expect(result.isAnomaly).toBe(true);
      expect(result.matchedPatterns).toContain('resource_exhaust');
    });

    it('检测 "out of memory" 关键词 / detects "out of memory" keyword', () => {
      const result = ns.detect('FATAL: out of memory while allocating buffer');
      expect(result.isAnomaly).toBe(true);
      expect(result.matchedPatterns).toContain('resource_exhaust');
    });
  });

  // ━━━ 4. detect — 速率限制模式 / Rate Limit Pattern ━━━
  describe('detect — rate limit pattern', () => {
    it('检测 "rate limit" 模式 / detects "rate limit" pattern', () => {
      const result = ns.detect('Request failed: rate limit exceeded, please retry later');
      expect(result.matchedPatterns).toContain('rate_limit');
    });

    it('检测 "429" 模式 / detects "429" pattern', () => {
      const result = ns.detect('HTTP 429 Too Many Requests');
      expect(result.matchedPatterns).toContain('rate_limit');
    });
  });

  // ━━━ 5. addDetector — 自定义检测器 / Custom Detector ━━━
  describe('addDetector', () => {
    it('添加自定义检测器并被检测到 / adds custom detector that gets checked', () => {
      ns.addDetector(/timeout exceeded/i, 'custom_timeout', 0.7);

      const stats = ns.getStats();
      expect(stats.customDetectorCount).toBe(1);

      const result = ns.detect('The operation failed because timeout exceeded');
      expect(result.matchedPatterns).toContain('custom_timeout');
    });

    it('权重被限制在 [0.1, 1.0] 范围 / weight is clamped to [0.1, 1.0]', () => {
      ns.addDetector(/test/i, 'test_low', -5);
      ns.addDetector(/test2/i, 'test_high', 100);

      const stats = ns.getStats();
      expect(stats.customDetectorCount).toBe(2);
    });
  });

  // ━━━ 6. buildFromVaccines — 从疫苗库构建 / Build from Vaccines ━━━
  describe('buildFromVaccines', () => {
    it('无 failureVaccination 时返回 0 / returns 0 when no failureVaccination', () => {
      const bare = new NegativeSelection({ logger: silentLogger });
      const count = bare.buildFromVaccines();
      expect(count).toBe(0);
    });

    it('从 FailureVaccination mock 构建检测器 / builds detectors from FailureVaccination mock', () => {
      const mockVaccination = {
        getVaccines() {
          return [
            { errorType: 'ECONNRESET', pattern: 'ECONNRESET' },
            { errorType: 'PermissionDenied', pattern: 'PermissionDenied' },
          ];
        },
        findSimilar() { return []; },
      };

      const nsWithVaccine = new NegativeSelection({
        failureVaccination: mockVaccination,
        messageBus,
        logger: silentLogger,
      });

      const built = nsWithVaccine.buildFromVaccines();
      expect(built).toBe(2);

      const stats = nsWithVaccine.getStats();
      expect(stats.customDetectorCount).toBe(2);
    });
  });

  // ━━━ 7. getStats — 统计 / Statistics ━━━
  describe('getStats', () => {
    it('返回正确的计数 / returns correct counts', () => {
      // 执行几次检测 / Run a few detections
      ns.detect('normal output no problems');
      ns.detect('An error occurred and an exception was thrown');
      ns.detect('stack overflow in recursive call with out of memory');

      const stats = ns.getStats();
      expect(stats.checks).toBe(3);
      expect(stats.anomaliesDetected).toBeGreaterThanOrEqual(1);
      expect(stats.patternMatches).toBeGreaterThanOrEqual(1);
      expect(stats.builtinPatternCount).toBeGreaterThan(0);
      expect(typeof stats.customDetectorCount).toBe('number');
    });
  });
});
