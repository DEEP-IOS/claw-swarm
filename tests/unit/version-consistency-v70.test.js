/**
 * 版本一致性检查 V7.0 / Version Consistency Check V7.0
 *
 * 验证所有 V7.0 模块版本号对齐, 新模块正确导出, 事件目录包含 V7.0 主题。
 * Verifies that all V7.0 module versions are aligned, new modules export correctly,
 * and event catalog includes V7.0 event topics.
 *
 * @author DEEP-IOS
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 项目根目录 / Project root directory
const ROOT = join(import.meta.dirname, '../../');

describe('Version Consistency V7.0', () => {
  const EXPECTED_VERSION = '7.0.0';

  // ━━━ 1. swarm-core.js VERSION ━━━
  it('swarm-core.js VERSION === ' + EXPECTED_VERSION, () => {
    const content = readFileSync(join(ROOT, 'src/swarm-core.js'), 'utf-8');
    expect(content).toContain(`VERSION = '${EXPECTED_VERSION}'`);
  });

  // ━━━ 2. plugin-adapter.js VERSION ━━━
  it('plugin-adapter.js VERSION === ' + EXPECTED_VERSION, () => {
    const content = readFileSync(join(ROOT, 'src/L5-application/plugin-adapter.js'), 'utf-8');
    expect(content).toContain(`VERSION = '${EXPECTED_VERSION}'`);
  });

  // ━━━ 3. openclaw.plugin.json version ━━━
  it('openclaw.plugin.json version === ' + EXPECTED_VERSION, () => {
    const raw = readFileSync(join(ROOT, 'openclaw.plugin.json'), 'utf-8');
    const content = JSON.parse(raw);
    expect(content.version).toBe(EXPECTED_VERSION);
  });

  // ━━━ 4. event-catalog V7.0 事件主题 / V7.0 Event Topics ━━━
  describe('event-catalog has V7.0 event topics', () => {
    let catalogContent;

    // 读取一次 / Read once
    try {
      catalogContent = readFileSync(join(ROOT, 'src/event-catalog.js'), 'utf-8');
    } catch { catalogContent = ''; }

    it('包含 SESSION_PATCHED 主题 / contains SESSION_PATCHED topic', () => {
      expect(catalogContent).toContain('SESSION_PATCHED');
    });

    it('包含 PI_CONTROLLER_ACTUATED 主题 / contains PI_CONTROLLER_ACTUATED topic', () => {
      expect(catalogContent).toContain('PI_CONTROLLER_ACTUATED');
    });

    it('包含 NEGATIVE_SELECTION_TRIGGERED 主题 / contains NEGATIVE_SELECTION_TRIGGERED topic', () => {
      expect(catalogContent).toContain('NEGATIVE_SELECTION_TRIGGERED');
    });

    it('包含 BUDGET_DEGRADATION_APPLIED 主题 / contains BUDGET_DEGRADATION_APPLIED topic', () => {
      expect(catalogContent).toContain('BUDGET_DEGRADATION_APPLIED');
    });
  });

  // ━━━ 5. NegativeSelection 模块正确导出 / NegativeSelection module exports correctly ━━━
  it('NegativeSelection module exports correctly', async () => {
    const mod = await import('../../src/L3-agent/negative-selection.js');
    expect(mod.NegativeSelection).toBeDefined();
    expect(typeof mod.NegativeSelection).toBe('function');

    // 实例化测试 / Instantiation test
    const instance = new mod.NegativeSelection();
    expect(typeof instance.detect).toBe('function');
    expect(typeof instance.addDetector).toBe('function');
    expect(typeof instance.buildFromVaccines).toBe('function');
    expect(typeof instance.getStats).toBe('function');
  });

  // ━━━ 6. BudgetForecaster 包含 V7.0 方法 / BudgetForecaster has V7.0 methods ━━━
  it('BudgetForecaster has recommendDegradation and priceTask methods', async () => {
    const mod = await import('../../src/L4-orchestration/budget-forecaster.js');
    expect(mod.BudgetForecaster).toBeDefined();

    const instance = new mod.BudgetForecaster();
    expect(typeof instance.recommendDegradation).toBe('function');
    expect(typeof instance.priceTask).toBe('function');

    // 基本调用不抛错 / Basic calls do not throw
    expect(() => instance.recommendDegradation(1000, 5)).not.toThrow();
    expect(() => instance.priceTask('test', 0.5)).not.toThrow();
  });
});
