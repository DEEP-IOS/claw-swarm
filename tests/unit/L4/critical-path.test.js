/**
 * CriticalPathAnalyzer 单元测试 / CriticalPathAnalyzer Unit Tests
 *
 * 纯计算模块, 不需要数据库。测试 CPM 关键路径分析核心算法。
 * Pure computation module, no DB needed. Tests CPM critical path analysis core algorithm.
 *
 * 覆盖: analyze, isCritical, getSlack, suggestBottleneckSplits, reset
 * Covers: analyze, isCritical, getSlack, suggestBottleneckSplits, reset
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CriticalPathAnalyzer } from '../../../src/L4-orchestration/critical-path.js';

// 静默 logger / Silent logger
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

describe('CriticalPathAnalyzer', () => {
  let analyzer;

  beforeEach(() => {
    analyzer = new CriticalPathAnalyzer({ logger: silentLogger });
  });

  // ━━━ 1. 空角色列表 / Empty Roles List ━━━
  describe('empty roles', () => {
    it('空角色列表应抛出错误 / empty roles list should throw error', () => {
      expect(() => analyzer.analyze([])).toThrow(/empty/i);
      expect(() => analyzer.analyze(null)).toThrow();
    });
  });

  // ━━━ 2. 单角色 / Single Role ━━━
  describe('single role', () => {
    it('单角色的关键路径应包含该角色 / single role critical path should contain that role', () => {
      const result = analyzer.analyze([
        { name: 'solo', duration: 5000 },
      ]);

      expect(result.criticalPath).toEqual(['solo']);
      expect(result.totalDuration).toBe(5000);
      expect(result.criticalPathLength).toBe(1);
    });
  });

  // ━━━ 3. 线性流水线 / Linear Pipeline (A→B→C) ━━━
  describe('linear pipeline (A→B→C)', () => {
    it('关键路径应包含所有节点, 总工期等于各节点时长之和 / critical path should include all, totalDuration = sum', () => {
      const roles = [
        { name: 'A', duration: 1000, dependencies: [] },
        { name: 'B', duration: 2000, dependencies: ['A'] },
        { name: 'C', duration: 3000, dependencies: ['B'] },
      ];

      const result = analyzer.analyze(roles);

      expect(result.criticalPath).toEqual(['A', 'B', 'C']);
      expect(result.totalDuration).toBe(6000); // 1000 + 2000 + 3000
      expect(result.criticalPathLength).toBe(3);
    });
  });

  // ━━━ 4. 并行分支 / Parallel Branches ━━━
  describe('parallel branches', () => {
    it('关键路径应为最长分支 / critical path should be the longest branch', () => {
      // A (1s) → B (5s) → D (1s)   <-- 长分支, 总 7s / long branch
      // A (1s) → C (1s) → D (1s)   <-- 短分支, 总 3s / short branch
      const roles = [
        { name: 'A', duration: 1000, dependencies: [] },
        { name: 'B', duration: 5000, dependencies: ['A'] },
        { name: 'C', duration: 1000, dependencies: ['A'] },
        { name: 'D', duration: 1000, dependencies: ['B', 'C'] },
      ];

      const result = analyzer.analyze(roles);

      // 总工期 = A(1s) + B(5s) + D(1s) = 7s / Total = 7s
      expect(result.totalDuration).toBe(7000);

      // 关键路径: A, B, D (不含 C) / Critical path: A, B, D (not C)
      expect(result.criticalPath).toContain('A');
      expect(result.criticalPath).toContain('B');
      expect(result.criticalPath).toContain('D');
      expect(result.criticalPath).not.toContain('C');
    });
  });

  // ━━━ 5. 松弛时间计算 / Slack Calculation ━━━
  describe('slack calculation', () => {
    it('非关键路径角色应有正的松弛时间 / non-critical roles should have positive slack', () => {
      const roles = [
        { name: 'A', duration: 1000, dependencies: [] },
        { name: 'B', duration: 5000, dependencies: ['A'] }, // 关键 / Critical
        { name: 'C', duration: 1000, dependencies: ['A'] }, // 非关键 / Non-critical
        { name: 'D', duration: 1000, dependencies: ['B', 'C'] },
      ];

      analyzer.analyze(roles);

      // C 是非关键路径, 应有正 slack / C is non-critical, should have positive slack
      const slackC = analyzer.getSlack('C');
      expect(slackC).toBeGreaterThan(0);
      // C 的 slack = B 的时长 - C 的时长 = 4000 / C's slack = 5000 - 1000 = 4000
      expect(slackC).toBe(4000);

      // 关键路径上的 slack 应为 0 / Critical path roles should have 0 slack
      expect(analyzer.getSlack('A')).toBe(0);
      expect(analyzer.getSlack('B')).toBe(0);
      expect(analyzer.getSlack('D')).toBe(0);
    });
  });

  // ━━━ 6. isCritical 查询 / isCritical Query ━━━
  describe('isCritical', () => {
    it('关键路径角色返回 true, 非关键返回 false / critical roles return true, non-critical false', () => {
      const roles = [
        { name: 'A', duration: 1000, dependencies: [] },
        { name: 'B', duration: 5000, dependencies: ['A'] },
        { name: 'C', duration: 1000, dependencies: ['A'] },
        { name: 'D', duration: 1000, dependencies: ['B', 'C'] },
      ];

      analyzer.analyze(roles);

      expect(analyzer.isCritical('A')).toBe(true);
      expect(analyzer.isCritical('B')).toBe(true);
      expect(analyzer.isCritical('D')).toBe(true);
      expect(analyzer.isCritical('C')).toBe(false);

      // 不存在的角色应返回 false / Non-existent role should return false
      expect(analyzer.isCritical('Z')).toBe(false);
    });
  });

  // ━━━ 7. 瓶颈拆分建议 / Bottleneck Split Suggestions ━━━
  describe('suggestBottleneckSplits', () => {
    it('关键路径上的长时角色应得到拆分建议 / long-duration critical role should get split suggestion', () => {
      const roles = [
        { name: 'A', duration: 10000, dependencies: [] },       // 10s, 低于阈值
        { name: 'B', duration: 300000, dependencies: ['A'] },   // 300s, 超过默认阈值 120s
        { name: 'C', duration: 5000, dependencies: ['B'] },
      ];

      analyzer.analyze(roles);

      const suggestions = analyzer.suggestBottleneckSplits(); // 使用默认阈值 120000ms

      expect(suggestions.length).toBeGreaterThanOrEqual(1);

      // B 应在建议列表中 / B should be in suggestions
      const bSuggestion = suggestions.find((s) => s.roleName === 'B');
      expect(bSuggestion).toBeDefined();
      expect(bSuggestion.duration).toBe(300000);
      expect(bSuggestion.splitCount).toBeGreaterThanOrEqual(2);
    });

    it('无超过阈值的角色时应返回空数组 / should return empty if no role exceeds threshold', () => {
      const roles = [
        { name: 'X', duration: 50000, dependencies: [] },
        { name: 'Y', duration: 60000, dependencies: ['X'] },
      ];

      analyzer.analyze(roles);

      const suggestions = analyzer.suggestBottleneckSplits(); // 默认阈值 120000ms
      expect(suggestions).toHaveLength(0);
    });
  });

  // ━━━ 8. 菱形依赖 / Diamond Dependency (A→B, A→C, B→D, C→D) ━━━
  describe('diamond dependency', () => {
    it('菱形依赖应正确计算关键路径和工期 / diamond should compute correct critical path and duration', () => {
      const roles = [
        { name: 'A', duration: 1000, dependencies: [] },
        { name: 'B', duration: 4000, dependencies: ['A'] },
        { name: 'C', duration: 2000, dependencies: ['A'] },
        { name: 'D', duration: 1000, dependencies: ['B', 'C'] },
      ];

      const result = analyzer.analyze(roles);

      // 总工期 = A(1s) + max(B=4s, C=2s) + D(1s) = 6s / Total = 6s
      expect(result.totalDuration).toBe(6000);

      // 关键路径: A → B → D / Critical path: A → B → D
      expect(result.criticalPath).toContain('A');
      expect(result.criticalPath).toContain('B');
      expect(result.criticalPath).toContain('D');
      expect(result.criticalPath).not.toContain('C');

      // C 的 slack = 4000 - 2000 = 2000 / C's slack = 2000
      expect(analyzer.getSlack('C')).toBe(2000);

      // 并行度因子: 总工作量 / 总工期 = 8000/6000 ≈ 1.33
      expect(result.parallelismFactor).toBeGreaterThan(1);
    });
  });

  // ━━━ 9. 重置 / Reset ━━━
  describe('reset', () => {
    it('重置后应清空所有分析状态 / reset should clear all analysis state', () => {
      const roles = [
        { name: 'A', duration: 1000, dependencies: [] },
        { name: 'B', duration: 2000, dependencies: ['A'] },
      ];

      analyzer.analyze(roles);
      expect(analyzer.isCritical('A')).toBe(true);

      analyzer.reset();

      // 重置后 isCritical 应返回 false (未分析) / After reset, isCritical should return false
      expect(analyzer.isCritical('A')).toBe(false);
      expect(analyzer.getSlack('A')).toBe(-1);
    });
  });
});
