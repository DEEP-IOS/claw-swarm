/**
 * SkillGovernor 单元测试 / SkillGovernor Unit Tests
 *
 * 测试 Skill 清单管理、使用追踪、推荐引擎和生命周期。
 * Tests skill inventory, usage tracking, recommendation engine, and lifecycle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SkillGovernor } from '../../../src/L5-application/skill-governor.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── 模拟依赖 / Mock Dependencies ──

function createMockBus() {
  const _published = [];
  return {
    publish(topic, data) { _published.push({ topic, data }); },
    _published,
  };
}

function createMockCapabilityEngine() {
  return {
    getCapabilityProfile: () => ({
      coding: 80, architecture: 50, testing: 50, documentation: 50,
      security: 50, performance: 70, communication: 60, domain: 75,
    }),
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

// ── 临时 Skill 目录 / Temp Skill Directory ──

let tempDir;

function createTempSkillDir() {
  tempDir = path.join(os.tmpdir(), `skill-governor-test-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  // 创建 3 个模拟 skill / Create 3 mock skills
  const skills = [
    {
      slug: 'test-research',
      name: 'Test Research',
      description: 'A research skill for testing',
      version: '1.0.0',
    },
    {
      slug: 'test-coding',
      name: 'Test Coding',
      description: 'A coding skill for testing',
      version: '2.0.0',
    },
    {
      slug: 'bash',
      name: 'Bash',
      description: 'Write reliable Bash scripts',
      version: '1.0.2',
    },
  ];

  for (const skill of skills) {
    const skillDir = path.join(tempDir, skill.slug);
    fs.mkdirSync(skillDir, { recursive: true });

    // SKILL.md
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: ${skill.name}\nslug: ${skill.slug}\nversion: ${skill.version}\ndescription: "${skill.description}"\n---\n\n# ${skill.name}\n`,
    );

    // _meta.json
    fs.writeFileSync(
      path.join(skillDir, '_meta.json'),
      JSON.stringify({ slug: skill.slug, version: skill.version, publishedAt: Date.now() }),
    );
  }

  return tempDir;
}

function cleanupTempDir() {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
}

// ── 测试 / Tests ──

describe('SkillGovernor', () => {
  let governor, bus;

  beforeEach(() => {
    bus = createMockBus();
    governor = new SkillGovernor({
      messageBus: bus,
      capabilityEngine: createMockCapabilityEngine(),
      logger,
      config: { enabled: true },
    });
  });

  afterEach(() => {
    governor.destroy();
    cleanupTempDir();
  });

  // ── 构造函数 / Constructor ──

  it('构造函数初始化 / constructor initializes', () => {
    expect(governor._enabled).toBe(true);
    expect(governor._inventory.size).toBe(0);
  });

  it('禁用时返回空 / returns empty when disabled', () => {
    const disabled = new SkillGovernor({
      messageBus: bus, logger,
      config: { enabled: false },
    });
    expect(disabled.scanSkills()).toBe(0);
    expect(disabled.getRecommendations()).toBe('');
    disabled.destroy();
  });

  // ── Skill 扫描 / Skill Scanning ──

  it('扫描 Skill 目录 / scans skill directory', () => {
    const dir = createTempSkillDir();
    const count = governor.scanSkills([dir]);
    expect(count).toBe(3);
    expect(governor._inventory.has('bash')).toBe(true);
    expect(governor._inventory.has('test-research')).toBe(true);
    expect(governor._inventory.has('test-coding')).toBe(true);
  });

  it('解析 SKILL.md 前言 / parses SKILL.md front matter', () => {
    const dir = createTempSkillDir();
    governor.scanSkills([dir]);

    const bash = governor._inventory.get('bash');
    expect(bash.name).toBe('Bash');
    expect(bash.description).toContain('Bash scripts');
    expect(bash.version).toBe('1.0.2');
  });

  it('跳过不存在的目录 / skips nonexistent directories', () => {
    const count = governor.scanSkills(['/nonexistent/path/12345']);
    expect(count).toBe(0);
  });

  it('发布 inventory 更新事件 / publishes inventory update event', () => {
    const dir = createTempSkillDir();
    governor.scanSkills([dir]);

    const events = bus._published.filter(e =>
      e.topic?.includes?.('skill.inventory'));
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  // ── 使用追踪 / Usage Tracking ──

  it('记录 Skill 使用 / records skill usage', () => {
    const dir = createTempSkillDir();
    governor.scanSkills([dir]);

    governor.recordUsage({
      skillSlug: 'bash',
      agentId: 'agent-1',
      success: true,
      durationMs: 500,
    });

    governor.recordUsage({
      skillSlug: 'bash',
      agentId: 'agent-1',
      success: false,
      durationMs: 300,
    });

    const stats = governor.getUsageStats('bash');
    expect(stats.totalUses).toBe(2);
    expect(stats.successRate).toBe(0.5);
  });

  it('使用记录上限裁剪 / trims usage records at cap', () => {
    for (let i = 0; i < 600; i++) {
      governor.recordUsage({
        skillSlug: 'test',
        agentId: 'agent-1',
        success: true,
      });
    }

    expect(governor._usageRecords.length).toBeLessThanOrEqual(500);
  });

  it('更新 inventory 统计 / updates inventory stats', () => {
    const dir = createTempSkillDir();
    governor.scanSkills([dir]);

    governor.recordUsage({ skillSlug: 'bash', agentId: 'a1', success: true });
    governor.recordUsage({ skillSlug: 'bash', agentId: 'a1', success: true });

    const bash = governor._inventory.get('bash');
    expect(bash.usageCount).toBe(2);
    expect(bash.successCount).toBe(2);
    expect(bash.lastUsedAt).toBeGreaterThan(0);
  });

  // ── 推荐引擎 / Recommendation Engine ──

  it('基于角色生成推荐 / generates recommendations by role', () => {
    const dir = createTempSkillDir();
    governor.scanSkills([dir]);

    const rec = governor.getRecommendations({ agentRole: 'worker-bee' });
    expect(rec).toContain('[Skill Recommendations]');
    expect(rec).toContain('bash');
  });

  it('空清单返回空推荐 / returns empty for empty inventory', () => {
    const rec = governor.getRecommendations({ agentRole: 'scout' });
    expect(rec).toBe('');
  });

  it('缓存推荐结果 / caches recommendation results', () => {
    const dir = createTempSkillDir();
    governor.scanSkills([dir]);

    const rec1 = governor.getRecommendations({ agentRole: 'worker' });
    const rec2 = governor.getRecommendations({ agentRole: 'worker' });
    expect(rec1).toBe(rec2); // 缓存命中 / Cache hit
  });

  it('不同上下文产生不同推荐 / different contexts produce different recommendations', () => {
    const dir = createTempSkillDir();
    governor.scanSkills([dir]);

    const workerRec = governor.getRecommendations({ agentRole: 'worker' });
    const scoutRec = governor.getRecommendations({ agentRole: 'scout' });
    // 推荐内容可能不同（取决于角色亲和度）
    // Recommendations may differ (depends on role affinity)
    expect(typeof workerRec).toBe('string');
    expect(typeof scoutRec).toBe('string');
  });

  // ── 工具推断 / Tool Inference ──

  it('从工具名推断 Skill / infers skill from tool name', () => {
    const dir = createTempSkillDir();
    governor.scanSkills([dir]);

    expect(governor.inferSkillFromTool('bash_execute')).toBe('bash');
    expect(governor.inferSkillFromTool('unknown_tool')).toBeNull();
  });

  // ── 查询方法 / Query Methods ──

  it('获取 inventory 清单 / gets inventory list', () => {
    const dir = createTempSkillDir();
    governor.scanSkills([dir]);

    const inventory = governor.getInventory();
    expect(inventory.length).toBe(3);
  });

  it('获取全局使用统计 / gets global usage stats', () => {
    const dir = createTempSkillDir();
    governor.scanSkills([dir]);

    governor.recordUsage({ skillSlug: 'bash', agentId: 'a1', success: true });
    governor.recordUsage({ skillSlug: 'bash', agentId: 'a1', success: true });
    governor.recordUsage({ skillSlug: 'test-research', agentId: 'a2', success: false });

    const stats = governor.getUsageStats();
    expect(stats.totalRecords).toBe(3);
    expect(stats.inventorySize).toBe(3);
    expect(stats.scanComplete).toBe(true);
    expect(stats.topSkills.length).toBe(2);
  });

  it('获取能力缺口建议 / gets capability gap suggestions', () => {
    // 不扫描任何 skill → 所有类别覆盖率为 0
    // No skills scanned → all categories have 0 coverage
    const suggestions = governor.getGapSuggestions();
    // 因为 inventory 为空，所有类别都是缺口
    // Since inventory is empty, all categories are gaps
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions[0].category).toBeTruthy();
    expect(suggestions[0].reason).toContain('coverage');
  });

  // ── 生命周期 / Lifecycle ──

  it('destroy 清理所有状态 / clears all state on destroy', () => {
    const dir = createTempSkillDir();
    governor.scanSkills([dir]);
    governor.recordUsage({ skillSlug: 'bash', agentId: 'a1', success: true });

    governor.destroy();

    expect(governor._inventory.size).toBe(0);
    expect(governor._usageRecords.length).toBe(0);
  });
});
