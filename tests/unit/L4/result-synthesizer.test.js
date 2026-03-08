/**
 * ResultSynthesizer 单元测试 / ResultSynthesizer Unit Tests
 *
 * 纯计算模块, 不需要数据库。测试 Jaccard 去重、冲突检测、指标聚合。
 * Pure computation module, no DB needed. Tests Jaccard dedup, conflict detection, metrics aggregation.
 *
 * 覆盖: merge, computeJaccard, detectDuplicates, detectConflicts, aggregateMetrics
 * Covers: merge, computeJaccard, detectDuplicates, detectConflicts, aggregateMetrics
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ResultSynthesizer } from '../../../src/L4-orchestration/result-synthesizer.js';

// 静默 logger / Silent logger
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

describe('ResultSynthesizer', () => {
  let synthesizer;

  beforeEach(() => {
    synthesizer = new ResultSynthesizer({
      config: { similarityThreshold: 0.6, minTextLength: 10 },
      logger: silentLogger,
    });
  });

  // ━━━ 1. 空输入 / Empty Input ━━━
  describe('merge - empty input', () => {
    it('空数组应返回空的合并结果 / empty array should return empty merge result', () => {
      const result = synthesizer.merge([]);

      expect(result.merged.completed).toHaveLength(0);
      expect(result.merged.failed).toHaveLength(0);
      expect(result.duplicates).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
      expect(result.metrics.completedCount).toBe(0);
      expect(result.metrics.failedCount).toBe(0);
      expect(result.metrics.avgQuality).toBe(0);
    });

    it('null 输入应返回空的合并结果 / null should return empty merge result', () => {
      const result = synthesizer.merge(null);

      expect(result.merged.completed).toHaveLength(0);
      expect(result.merged.failed).toHaveLength(0);
    });
  });

  // ━━━ 2. 分类 completed vs failed / Classify Completed vs Failed ━━━
  describe('merge - classify completed vs failed', () => {
    it('应正确区分已完成和失败的角色 / should correctly classify completed and failed roles', () => {
      const roles = [
        { role: 'architect', result: { output: 'design document generated successfully' } },
        { role: 'developer', result: { output: 'code implementation complete and tested' } },
        { role: 'tester', result: { error: 'Test suite crashed unexpectedly' } },
        { role: 'reviewer', result: { status: 'failed', error: 'Review timeout' } },
      ];

      const result = synthesizer.merge(roles);

      expect(result.merged.completed).toHaveLength(2);
      expect(result.merged.failed).toHaveLength(2);

      // 验证已完成角色 / Verify completed roles
      const completedRoles = result.merged.completed.map((c) => c.role);
      expect(completedRoles).toContain('architect');
      expect(completedRoles).toContain('developer');

      // 验证失败角色 / Verify failed roles
      const failedRoles = result.merged.failed.map((f) => f.role);
      expect(failedRoles).toContain('tester');
      expect(failedRoles).toContain('reviewer');
    });
  });

  // ━━━ 3. Jaccard 相似度 - 相同文本 / Identical Texts ━━━
  describe('computeJaccard - identical texts', () => {
    it('完全相同的文本应返回 1.0 / identical texts should return 1.0', () => {
      const text = 'the quick brown fox jumps over the lazy dog again and again';
      const similarity = synthesizer.computeJaccard(text, text);

      expect(similarity).toBe(1.0);
    });

    it('两个空字符串应返回 1.0 / two empty strings should return 1.0', () => {
      expect(synthesizer.computeJaccard('', '')).toBe(1.0);
    });
  });

  // ━━━ 4. Jaccard 相似度 - 不同文本 / Different Texts ━━━
  describe('computeJaccard - different texts', () => {
    it('完全不同的文本应返回低相似度 / completely different texts should have low similarity', () => {
      const textA = 'the quick brown fox jumps over the lazy dog';
      const textB = 'python programming language features include list comprehension generators decorators';
      const similarity = synthesizer.computeJaccard(textA, textB);

      expect(similarity).toBeLessThan(0.5);
    });

    it('一空一非空应返回 0.0 / one empty one non-empty should return 0.0', () => {
      expect(synthesizer.computeJaccard('hello world test', '')).toBe(0.0);
      expect(synthesizer.computeJaccard('', 'hello world test')).toBe(0.0);
    });
  });

  // ━━━ 5. 重复检测 / Duplicate Detection ━━━
  describe('detectDuplicates', () => {
    it('相似输出应被标记为重复 / similar outputs should be flagged as duplicates', () => {
      const results = [
        {
          role: 'dev-1',
          result: {
            output: 'implemented the user authentication module with JWT token validation and refresh token support for secure access',
          },
        },
        {
          role: 'dev-2',
          result: {
            output: 'implemented the user authentication module with JWT token validation and refresh token support for access control',
          },
        },
        {
          role: 'designer',
          result: {
            output: 'created wireframes and mockups for the dashboard layout with responsive grid system and dark theme colors',
          },
        },
      ];

      const duplicates = synthesizer.detectDuplicates(results, 0.5);

      // dev-1 和 dev-2 应被标记为重复 / dev-1 and dev-2 should be flagged
      expect(duplicates.length).toBeGreaterThanOrEqual(1);
      const pair = duplicates.find(
        (d) => (d.roleA === 'dev-1' && d.roleB === 'dev-2') ||
               (d.roleA === 'dev-2' && d.roleB === 'dev-1'),
      );
      expect(pair).toBeDefined();
      expect(pair.similarity).toBeGreaterThanOrEqual(0.5);
    });

    it('不相似输出不应被标记 / dissimilar outputs should not be flagged', () => {
      const results = [
        {
          role: 'architect',
          result: {
            output: 'designed the microservice architecture with event driven communication patterns between services',
          },
        },
        {
          role: 'devops',
          result: {
            output: 'configured kubernetes deployment manifests with horizontal pod autoscaling and service mesh integration',
          },
        },
      ];

      const duplicates = synthesizer.detectDuplicates(results, 0.6);
      expect(duplicates).toHaveLength(0);
    });
  });

  // ━━━ 6. 冲突检测 / Conflict Detection ━━━
  describe('detectConflicts', () => {
    it('同一文件被多个角色修改应被标记为冲突 / same file modified by multiple roles should be flagged', () => {
      const artifacts = {
        developer: {
          output: 'Modified src/auth/login.js and src/auth/middleware.js for new auth flow',
        },
        security: {
          output: 'Updated src/auth/login.js to add input sanitization and rate limiting',
        },
      };

      const conflicts = synthesizer.detectConflicts(artifacts);

      // src/auth/login.js 被两个角色修改 / Modified by two roles
      const loginConflict = conflicts.find((c) => c.filePath.includes('login.js'));
      expect(loginConflict).toBeDefined();
      expect(loginConflict.roles).toContain('developer');
      expect(loginConflict.roles).toContain('security');
      expect(loginConflict.resolution).toBeTruthy();
    });

    it('无交叉文件应返回空冲突列表 / no overlapping files should return empty conflicts', () => {
      const artifacts = {
        frontend: { output: 'Created src/components/Button.tsx' },
        backend: { output: 'Created src/api/routes.js' },
      };

      const conflicts = synthesizer.detectConflicts(artifacts);
      expect(conflicts).toHaveLength(0);
    });
  });

  // ━━━ 7. 指标聚合 / Metrics Aggregation ━━━
  describe('aggregateMetrics', () => {
    it('应正确计算完成数、失败数和平均质量 / should compute correct counts and averages', () => {
      const completed = [
        { role: 'arch', result: {}, gate: { score: 0.9 } },
        { role: 'dev', result: {}, gate: { score: 0.8 } },
        { role: 'test', result: {}, gate: { score: 0.7 } },
      ];
      const failed = [
        { role: 'review', error: 'timeout' },
      ];

      const metrics = synthesizer.aggregateMetrics(completed, failed);

      expect(metrics.completedCount).toBe(3);
      expect(metrics.failedCount).toBe(1);
      // 平均质量: (0.9 + 0.8 + 0.7) / 3 = 0.8 / Avg quality = 0.8
      expect(metrics.avgQuality).toBe(0.8);
    });

    it('无 gate 分数时使用默认值 0.7 / should use default 0.7 when no gate score', () => {
      const completed = [
        { role: 'dev', result: {} },
        { role: 'test', result: {} },
      ];

      const metrics = synthesizer.aggregateMetrics(completed);

      expect(metrics.completedCount).toBe(2);
      expect(metrics.failedCount).toBe(0);
      // 默认: (0.7 + 0.7) / 2 = 0.7 / Default: 0.7
      expect(metrics.avgQuality).toBe(0.7);
    });

    it('空 completed 列表应返回零值 / empty completed should return zeros', () => {
      const metrics = synthesizer.aggregateMetrics([], [{ role: 'x', error: 'e' }]);

      expect(metrics.completedCount).toBe(0);
      expect(metrics.failedCount).toBe(1);
      expect(metrics.avgQuality).toBe(0);
    });
  });
});
