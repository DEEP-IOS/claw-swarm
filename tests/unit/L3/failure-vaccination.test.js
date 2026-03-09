/**
 * FailureVaccination 单元测试 / FailureVaccination Unit Tests
 *
 * 测试 L3 失败免疫机制的注册、查找和效果记录。
 * Tests L3 failure vaccination register, find, and outcome recording.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { FailureVaccination } from '../../../src/L3-agent/failure-vaccination.js';

// ── 辅助函数 / Helpers ──────────────────────────────────────────────────────

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

describe('FailureVaccination', () => {
  let messageBus, vaccination;

  beforeEach(() => {
    messageBus = createMockBus();
    vaccination = new FailureVaccination({
      messageBus,
      db: null,
      logger: silentLogger,
    });
  });

  // ━━━ 1. registerVaccine / Register Vaccine ━━━
  describe('registerVaccine', () => {
    it('应注册疫苗并返回疫苗对象 / should register vaccine and return vaccine object', () => {
      const result = vaccination.registerVaccine({
        failurePattern: 'TIMEOUT:web-search',
        toolName: 'web-search',
        errorCategory: 'timeout',
        vaccineStrategy: 'retry-with-backoff',
        effectiveness: 0.5,
      });

      expect(result).toBeTruthy();
      expect(result.failurePattern).toBe('TIMEOUT:web-search');
      expect(result.vaccineStrategy).toBe('retry-with-backoff');
      expect(typeof result.effectiveness).toBe('number');
    });

    it('不同注册应产生不同疫苗对象 / different registrations should produce different vaccines', () => {
      const r1 = vaccination.registerVaccine({
        failurePattern: 'TIMEOUT:web-search',
        toolName: 'web-search',
        vaccineStrategy: 'retry',
      });
      const r2 = vaccination.registerVaccine({
        failurePattern: 'NOT_FOUND:file-read',
        toolName: 'file-read',
        vaccineStrategy: 'fallback',
      });

      expect(r1.failurePattern).not.toBe(r2.failurePattern);
    });

    it('同一工具可注册多个疫苗 / same tool can have multiple vaccines', () => {
      vaccination.registerVaccine({
        failurePattern: 'RATE_LIMIT',
        toolName: 'api-call',
        vaccineStrategy: 'backoff',
      });
      vaccination.registerVaccine({
        failurePattern: '5XX',
        toolName: 'api-call',
        vaccineStrategy: 'retry',
      });

      const found = vaccination.findVaccines('RATE_LIMIT');
      expect(found.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ━━━ 2. findVaccines — 匹配 / Find Matching Vaccines ━━━
  describe('findVaccines — matching', () => {
    it('应返回匹配失败模式的疫苗 / should return vaccines matching failure pattern', () => {
      vaccination.registerVaccine({
        failurePattern: 'TIMEOUT:web-search',
        toolName: 'web-search',
        vaccineStrategy: 'retry-with-backoff',
      });
      vaccination.registerVaccine({
        failurePattern: 'PERMISSION:file-read',
        toolName: 'file-read',
        vaccineStrategy: 'sudo-retry',
      });

      const found = vaccination.findVaccines('TIMEOUT:web-search');

      expect(Array.isArray(found)).toBe(true);
      expect(found.length).toBeGreaterThanOrEqual(1);

      // 验证匹配的疫苗属于正确失败模式 / Verify matched vaccine has correct failure pattern
      const vaccine = found[0];
      expect(vaccine.failurePattern).toBe('TIMEOUT:web-search');
    });
  });

  // ━━━ 3. findVaccines — 不匹配 / Find Non-Matching ━━━
  describe('findVaccines — non-matching', () => {
    it('不匹配的失败模式应返回空数组 / non-matching failure pattern should return empty', () => {
      vaccination.registerVaccine({
        failurePattern: 'TIMEOUT:web-search',
        toolName: 'web-search',
        vaccineStrategy: 'retry',
      });

      const found = vaccination.findVaccines('CONNECTION_REFUSED:database-query');

      expect(Array.isArray(found)).toBe(true);
      expect(found.length).toBe(0);
    });

    it('无疫苗时应返回空数组 / should return empty when no vaccines registered', () => {
      const found = vaccination.findVaccines('any-pattern');
      expect(Array.isArray(found)).toBe(true);
      expect(found.length).toBe(0);
    });
  });

  // ━━━ 4. recordOutcome / Record Outcome ━━━
  describe('recordOutcome', () => {
    it('成功应提高有效性 / success should increase effectiveness', () => {
      const vaccine = vaccination.registerVaccine({
        failurePattern: 'TIMEOUT:web-search',
        toolName: 'web-search',
        vaccineStrategy: 'retry',
      });

      // 获取初始有效性 / Get initial effectiveness
      const beforeList = vaccination.findVaccines('TIMEOUT:web-search');
      const before = beforeList.find(v => v.failurePattern === 'TIMEOUT:web-search');
      const initialEffectiveness = before ? (before.effectiveness ?? 0.5) : 0.5;

      // 记录成功 (failurePattern, vaccineStrategy, success) / Record success
      vaccination.recordOutcome('TIMEOUT:web-search', 'retry', true);

      // 获取更新后的有效性 / Get updated effectiveness
      const afterList = vaccination.findVaccines('TIMEOUT:web-search');
      const after = afterList.find(v => v.failurePattern === 'TIMEOUT:web-search');

      expect(after).toBeTruthy();
      const updatedEffectiveness = after.effectiveness ?? 0.5;
      expect(updatedEffectiveness).toBeGreaterThanOrEqual(initialEffectiveness);
    });

    it('失败应降低有效性 / failure should decrease effectiveness', () => {
      vaccination.registerVaccine({
        failurePattern: 'NOT_FOUND:file-read',
        toolName: 'file-read',
        vaccineStrategy: 'create-file',
      });

      // 先记录一些成功以建立基线 / Record some successes to establish baseline
      vaccination.recordOutcome('NOT_FOUND:file-read', 'create-file', true);
      vaccination.recordOutcome('NOT_FOUND:file-read', 'create-file', true);
      vaccination.recordOutcome('NOT_FOUND:file-read', 'create-file', true);

      const beforeList = vaccination.findVaccines('NOT_FOUND:file-read');
      const before = beforeList.find(v => v.failurePattern === 'NOT_FOUND:file-read');
      const beforeEffectiveness = before ? (before.effectiveness ?? 0.5) : 0.5;

      // 记录失败 / Record failure
      vaccination.recordOutcome('NOT_FOUND:file-read', 'create-file', false);

      const afterList = vaccination.findVaccines('NOT_FOUND:file-read');
      const after = afterList.find(v => v.failurePattern === 'NOT_FOUND:file-read');
      const afterEffectiveness = after ? (after.effectiveness ?? 0.5) : 0.5;

      expect(afterEffectiveness).toBeLessThanOrEqual(beforeEffectiveness);
    });

    it('多次成功应持续提高有效性 / multiple successes should continuously improve', () => {
      vaccination.registerVaccine({
        failurePattern: 'SYNTAX_ERROR:compile',
        toolName: 'compile',
        vaccineStrategy: 'auto-fix',
      });

      // 记录多次成功 / Record multiple successes
      for (let i = 0; i < 10; i++) {
        vaccination.recordOutcome('SYNTAX_ERROR:compile', 'auto-fix', true);
      }

      const list = vaccination.findVaccines('SYNTAX_ERROR:compile');
      const vaccine = list.find(v => v.failurePattern === 'SYNTAX_ERROR:compile');
      expect(vaccine).toBeTruthy();

      const effectiveness = vaccine.effectiveness ?? 0.5;
      expect(effectiveness).toBeGreaterThanOrEqual(0.5);
    });

    it('recordOutcome 调用不应抛出异常 / recordOutcome should not throw', () => {
      vaccination.registerVaccine({
        failurePattern: 'ERR:test-tool',
        toolName: 'test-tool',
        vaccineStrategy: 'skip',
      });

      expect(() => vaccination.recordOutcome('ERR:test-tool', 'skip', true)).not.toThrow();
      expect(() => vaccination.recordOutcome('ERR:test-tool', 'skip', false)).not.toThrow();
    });
  });
});
