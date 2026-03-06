/**
 * @fileoverview Unit tests for Claw-Swarm v4.0 - Layer 1 Config Module
 * @module tests/unit/config.test
 *
 * 测试配置的合并、验证、路径解析和工具检测。
 * Tests config merging, validation, path resolution, and tool detection.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_CONFIG,
  mergeConfig,
  validateConfig,
  resolveDbPath,
  isFileModifyingTool,
} from '../../src/layer1-core/config.js';

// ===========================================================================
// DEFAULT_CONFIG — 默认配置
// ===========================================================================

describe('DEFAULT_CONFIG', () => {
  it('should be frozen at the top level (顶层应冻结)', () => {
    assert.ok(Object.isFrozen(DEFAULT_CONFIG));
  });

  it('should have frozen subsystem objects (子系统对象应冻结)', () => {
    assert.ok(Object.isFrozen(DEFAULT_CONFIG.orchestration));
    assert.ok(Object.isFrozen(DEFAULT_CONFIG.memory));
    assert.ok(Object.isFrozen(DEFAULT_CONFIG.pheromone));
    assert.ok(Object.isFrozen(DEFAULT_CONFIG.governance));
    assert.ok(Object.isFrozen(DEFAULT_CONFIG.soul));
    assert.ok(Object.isFrozen(DEFAULT_CONFIG.collaboration));
  });

  it('should have expected default logLevel (默认日志级别应为 info)', () => {
    assert.equal(DEFAULT_CONFIG.logLevel, 'info');
  });

  it('should have null dbPath by default (默认 dbPath 为 null)', () => {
    assert.equal(DEFAULT_CONFIG.dbPath, null);
  });

  it('should have governance disabled by default (治理子系统默认关闭)', () => {
    assert.equal(DEFAULT_CONFIG.governance.enabled, false);
  });

  it('should have orchestration enabled by default (编排子系统默认开启)', () => {
    assert.equal(DEFAULT_CONFIG.orchestration.enabled, true);
  });
});

// ===========================================================================
// mergeConfig — 配置合并
// ===========================================================================

describe('mergeConfig', () => {
  it('should return defaults when called with no arguments (无参调用返回默认值)', () => {
    const config = mergeConfig();
    assert.equal(config.logLevel, 'info');
    assert.equal(config.orchestration.maxWorkers, 16);
  });

  it('should return defaults when called with empty object (空对象返回默认值)', () => {
    const config = mergeConfig({});
    assert.equal(config.logLevel, 'info');
    assert.equal(config.memory.maxPrependChars, 4000);
  });

  it('should override top-level scalar values (覆盖顶层标量值)', () => {
    const config = mergeConfig({ logLevel: 'debug' });
    assert.equal(config.logLevel, 'debug');
  });

  it('should deep-merge nested objects (深合并嵌套对象)', () => {
    const config = mergeConfig({
      orchestration: { maxWorkers: 8 },
    });
    // Overridden field
    assert.equal(config.orchestration.maxWorkers, 8);
    // Non-overridden field should retain default
    assert.equal(config.orchestration.roleTimeout, 300000);
    assert.equal(config.orchestration.enabled, true);
  });

  it('should silently drop unknown top-level keys (静默丢弃未知顶层键)', () => {
    const config = mergeConfig({ unknownKey: 'should be dropped', logLevel: 'warn' });
    assert.equal(config.logLevel, 'warn');
    assert.equal(config.unknownKey, undefined);
  });

  it('should return a frozen result (返回冻结的结果)', () => {
    const config = mergeConfig({ logLevel: 'error' });
    assert.ok(Object.isFrozen(config));
  });

  it('should deep-merge pheromone subsystem overrides (深合并信息素子系统)', () => {
    const config = mergeConfig({
      pheromone: { maxPheromones: 500 },
    });
    assert.equal(config.pheromone.maxPheromones, 500);
    assert.equal(config.pheromone.enabled, true);
    assert.equal(config.pheromone.decayIntervalMs, 60000);
  });

  it('should deep-merge governance subsystem overrides (深合并治理子系统)', () => {
    const config = mergeConfig({
      governance: { enabled: true },
    });
    assert.equal(config.governance.enabled, true);
    // Nested defaults should be preserved
    assert.equal(config.governance.capability.decayFactor, 0.9);
  });
});

// ===========================================================================
// validateConfig — 配置验证
// ===========================================================================

describe('validateConfig', () => {
  it('should accept the default config without throwing (默认配置应通过验证)', () => {
    assert.doesNotThrow(() => validateConfig(DEFAULT_CONFIG));
  });

  it('should accept a valid merged config (合法合并配置应通过)', () => {
    const config = mergeConfig({ logLevel: 'debug' });
    assert.doesNotThrow(() => validateConfig(config));
  });

  it('should reject an invalid logLevel (拒绝非法 logLevel)', () => {
    const config = mergeConfig({});
    // We need a mutable copy to inject bad values
    const bad = JSON.parse(JSON.stringify(config));
    bad.logLevel = 'verbose_invalid';
    assert.throws(() => validateConfig(bad), { name: 'SwarmValidationError' });
  });

  it('should reject path traversal in dbPath (拒绝 dbPath 中的路径遍历)', () => {
    const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    bad.logLevel = 'info';
    bad.dbPath = '/some/../etc/passwd';
    assert.throws(() => validateConfig(bad), { name: 'SwarmValidationError' });
  });

  it('should reject bad maxWorkers (拒绝非法 maxWorkers)', () => {
    const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    bad.logLevel = 'info';
    bad.orchestration.enabled = true;
    bad.orchestration.maxWorkers = 0; // too low
    assert.throws(() => validateConfig(bad), { name: 'SwarmValidationError' });
  });

  it('should reject maxWorkers > 64 (拒绝超上限 maxWorkers)', () => {
    const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    bad.logLevel = 'info';
    bad.orchestration.enabled = true;
    bad.orchestration.maxWorkers = 100;
    assert.throws(() => validateConfig(bad), { name: 'SwarmValidationError' });
  });

  it('should validate governance dimension weights sum to ~1.0 (治理维度权重之和 ~1.0)', () => {
    const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    bad.logLevel = 'info';
    bad.governance.enabled = true;
    // Corrupt the weights so they don't sum to 1.0
    bad.governance.capability.dimensions = {
      technical: { weight: 0.5 },
      delivery: { weight: 0.5 },
      collaboration: { weight: 0.5 },
      innovation: { weight: 0.5 },
    };
    assert.throws(() => validateConfig(bad), { name: 'SwarmValidationError' });
  });

  it('should validate tier minScores are ascending (等级 minScore 应递增)', () => {
    const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    bad.logLevel = 'info';
    bad.governance.enabled = true;
    // Corrupt tier order
    bad.governance.tiers = {
      trainee: { minScore: 0, taskLimit: 3 },
      junior: { minScore: 60, taskLimit: 5 },
      mid: { minScore: 50, taskLimit: 10 },   // 50 < 60 — not ascending
      senior: { minScore: 85, taskLimit: 15 },
      lead: { minScore: 92, taskLimit: 20 },
    };
    assert.throws(() => validateConfig(bad), { name: 'SwarmValidationError' });
  });

  it('should skip governance validation when disabled (治理关闭时跳过验证)', () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    config.logLevel = 'info';
    config.governance.enabled = false;
    // Corrupt governance data — should not matter when disabled
    config.governance.capability.dimensions = { broken: { weight: 999 } };
    assert.doesNotThrow(() => validateConfig(config));
  });

  it('should validate pheromone config when enabled (信息素子系统开启时验证)', () => {
    const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    bad.logLevel = 'info';
    bad.pheromone.enabled = true;
    bad.pheromone.decayIntervalMs = -1;
    assert.throws(() => validateConfig(bad), { name: 'SwarmValidationError' });
  });

  it('should validate collaboration config when enabled (协作子系统开启时验证)', () => {
    const bad = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    bad.logLevel = 'info';
    bad.collaboration.enabled = true;
    bad.collaboration.struggleWindowSize = -5;
    assert.throws(() => validateConfig(bad), { name: 'SwarmValidationError' });
  });
});

// ===========================================================================
// resolveDbPath — 数据库路径解析
// ===========================================================================

describe('resolveDbPath', () => {
  it('should use basePath when provided (提供 basePath 时使用它)', () => {
    const result = resolveDbPath('/custom/dir');
    assert.equal(result, path.join('/custom/dir', 'swarm.db'));
  });

  it('should fall back to os.tmpdir when no basePath (无 basePath 时回退到临时目录)', () => {
    const result = resolveDbPath();
    assert.equal(result, path.join(os.tmpdir(), 'swarm.db'));
  });

  it('should fall back to os.tmpdir for empty string (空字符串回退到临时目录)', () => {
    // path.join('', 'swarm.db') would be 'swarm.db', but the function uses falsy check
    const result = resolveDbPath('');
    assert.equal(result, path.join(os.tmpdir(), 'swarm.db'));
  });
});

// ===========================================================================
// isFileModifyingTool — 文件修改工具检测
// ===========================================================================

describe('isFileModifyingTool', () => {
  it('should detect tools in the fileModifyTools list (检测工具列表中的工具)', () => {
    assert.ok(isFileModifyingTool('write'));
    assert.ok(isFileModifyingTool('edit'));
    assert.ok(isFileModifyingTool('create'));
    assert.ok(isFileModifyingTool('write_file'));
    assert.ok(isFileModifyingTool('str_replace_editor'));
  });

  it('should return false for non-modifying tools (非修改工具返回 false)', () => {
    assert.equal(isFileModifyingTool('read'), false);
    assert.equal(isFileModifyingTool('list_files'), false);
    assert.equal(isFileModifyingTool('search'), false);
  });

  it('should detect bash write patterns (检测 bash 写入模式)', () => {
    assert.ok(isFileModifyingTool('bash', { command: 'echo "hello" > file.txt' }));
    assert.ok(isFileModifyingTool('bash', { command: 'cp src.txt dest.txt' }));
    assert.ok(isFileModifyingTool('bash', { command: 'rm -rf /tmp/test' }));
    assert.ok(isFileModifyingTool('bash', { command: 'npm install lodash' }));
  });

  it('should return false for bash read-only commands (bash 只读命令返回 false)', () => {
    assert.equal(isFileModifyingTool('bash', { command: 'ls -la' }), false);
    assert.equal(isFileModifyingTool('bash', { command: 'pwd' }), false);
    assert.equal(isFileModifyingTool('bash', { command: 'cat file.txt' }), false);
  });

  it('should detect file_path-like params (检测含文件路径字段的参数)', () => {
    assert.ok(isFileModifyingTool('custom_tool', { file_path: '/some/path.txt' }));
    assert.ok(isFileModifyingTool('custom_tool', { destination: '/output' }));
  });

  it('should return false for unknown tools with no path params (未知工具无路径参数返回 false)', () => {
    assert.equal(isFileModifyingTool('custom_tool', { query: 'search' }), false);
    assert.equal(isFileModifyingTool('custom_tool'), false);
  });
});
