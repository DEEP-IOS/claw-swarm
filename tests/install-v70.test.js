/**
 * V7.0 安装脚本测试 / V7.0 Install Script Tests
 *
 * 测试 install.js V7.0 新增功能:
 *   - detectExistingEnvironment
 *   - inferSwarmRole
 *   - mapRoleToOpenClawAgent (agentMapping 优先级)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../');

// ── inferSwarmRole 测试 ──────────────────────────────────────
// 从 install.js 中提取核心逻辑进行单元测试
// Extract core logic from install.js for unit testing

function inferSwarmRole(agentId, agentConfig) {
  const lower = (agentId || '').toLowerCase();

  // Level 1: keyword matching
  if (lower.includes('scout') || lower.includes('research') || lower.includes('search') ||
      lower.includes('explor') || lower.includes('recon') || lower.includes('survey')) return 'scout';
  if (lower.includes('review') || lower.includes('guard') || lower.includes('audit') ||
      lower.includes('check') || lower.includes('verify') || lower.includes('inspect')) return 'reviewer';
  if (lower.includes('code') || lower.includes('dev') || lower.includes('worker') ||
      lower.includes('implement') || lower.includes('build') || lower.includes('engineer')) return 'coder';
  if (lower.includes('architect') || lower.includes('plan') || lower.includes('design')) return 'architect';
  if (lower.includes('visual') || lower.includes('ui') || lower.includes('ux') ||
      lower.includes('style') || lower.includes('css')) return 'designer';
  if (lower === 'main' || lower.includes('personal') || lower.includes('assistant')) return 'skip';

  // Level 2: model cost inference
  const modelPrimary = (agentConfig?.model?.primary || '').toLowerCase();
  if (modelPrimary) {
    if (modelPrimary.includes('opus') || modelPrimary.includes('gpt-5') ||
        modelPrimary.includes('reasoner') || modelPrimary.includes('o1') ||
        modelPrimary.includes('o4')) return 'reviewer';
    if (modelPrimary.includes('haiku') || modelPrimary.includes('mini') ||
        modelPrimary.includes('flash') || modelPrimary.includes('lite')) return 'scout';
  }

  // Level 3: unknown
  return 'unknown';
}

// ── mapRoleToOpenClawAgent 测试 ──────────────────────────────
// 从 swarm-run-tool.js 中提取核心逻辑

function mapRoleToOpenClawAgent(roleName, agentMapping) {
  const lower = (roleName || '').toLowerCase();

  if (agentMapping) {
    if (agentMapping[lower]) return agentMapping[lower];
    for (const [role, agentId] of Object.entries(agentMapping)) {
      if (lower.includes(role) || role.includes(lower)) return agentId;
    }
    if (agentMapping.coder) return agentMapping.coder;
  }

  if (lower.includes('develop') || lower.includes('coder') || lower.includes('worker') ||
      lower.includes('implement')) return 'mpu-d3';
  if (lower.includes('review') || lower.includes('audit') || lower.includes('guard') ||
      lower.includes('architect') || lower.includes('analys')) return 'mpu-d2';
  if (lower.includes('scout') || lower.includes('research') || lower.includes('search') ||
      lower.includes('explor')) return 'mpu-d1';
  if (lower.includes('design') || lower.includes('visual') || lower.includes('ui') ||
      lower.includes('ux')) return 'mpu-d4';
  return 'mpu-d3';
}

describe('Install V7.0 — inferSwarmRole', () => {
  it('should infer scout from agent ID keywords', () => {
    expect(inferSwarmRole('my-scout-agent', {})).toBe('scout');
    expect(inferSwarmRole('research-bot', {})).toBe('scout');
    expect(inferSwarmRole('explorer-1', {})).toBe('scout');
    expect(inferSwarmRole('recon-unit', {})).toBe('scout');
  });

  it('should infer reviewer from agent ID keywords', () => {
    expect(inferSwarmRole('code-reviewer', {})).toBe('reviewer');
    expect(inferSwarmRole('guard-bot', {})).toBe('reviewer');
    expect(inferSwarmRole('audit-agent', {})).toBe('reviewer');
    expect(inferSwarmRole('checker-1', {})).toBe('reviewer');
  });

  it('should infer coder from agent ID keywords', () => {
    expect(inferSwarmRole('coder-1', {})).toBe('coder');
    expect(inferSwarmRole('dev-agent', {})).toBe('coder');
    expect(inferSwarmRole('worker-bot', {})).toBe('coder');
    expect(inferSwarmRole('builder-1', {})).toBe('coder');
  });

  it('should infer architect from agent ID keywords', () => {
    expect(inferSwarmRole('architect-main', {})).toBe('architect');
    expect(inferSwarmRole('planner-1', {})).toBe('architect');
  });

  it('should infer skip for main/assistant agents', () => {
    expect(inferSwarmRole('main', {})).toBe('skip');
    expect(inferSwarmRole('personal-assistant', {})).toBe('skip');
  });

  it('should use model cost inference when no keyword match', () => {
    // Expensive model → reviewer
    expect(inferSwarmRole('alice', { model: { primary: 'anthropic/opus-4' } })).toBe('reviewer');
    expect(inferSwarmRole('bob', { model: { primary: 'openai/gpt-5' } })).toBe('reviewer');

    // Cheap model → scout
    expect(inferSwarmRole('charlie', { model: { primary: 'anthropic/haiku-3' } })).toBe('scout');
    expect(inferSwarmRole('delta', { model: { primary: 'gemini/flash-2' } })).toBe('scout');
  });

  it('should return unknown when no keyword or model match', () => {
    expect(inferSwarmRole('alice', {})).toBe('unknown');
    expect(inferSwarmRole('bob', { model: {} })).toBe('unknown');
    expect(inferSwarmRole('forge', { model: { primary: 'some-model' } })).toBe('unknown');
  });

  it('should handle empty/null inputs gracefully', () => {
    expect(inferSwarmRole('', {})).toBe('unknown');
    expect(inferSwarmRole(null, {})).toBe('unknown');
    expect(inferSwarmRole(undefined, {})).toBe('unknown');
  });
});

describe('Install V7.0 — mapRoleToOpenClawAgent', () => {
  const customMapping = {
    scout: 'alice',
    coder: 'bob',
    reviewer: 'charlie',
    architect: 'delta',
  };

  it('should prioritize agentMapping over hardcoded defaults', () => {
    expect(mapRoleToOpenClawAgent('scout', customMapping)).toBe('alice');
    expect(mapRoleToOpenClawAgent('coder', customMapping)).toBe('bob');
    expect(mapRoleToOpenClawAgent('reviewer', customMapping)).toBe('charlie');
  });

  it('should fuzzy-match role names in agentMapping', () => {
    // 'developer' includes 'develop' but also matches agentMapping via fuzzy
    expect(mapRoleToOpenClawAgent('scout-leader', customMapping)).toBe('alice');
  });

  it('should fallback to agentMapping.coder for unknown roles', () => {
    expect(mapRoleToOpenClawAgent('unknown-role', customMapping)).toBe('bob');
  });

  it('should use hardcoded defaults when no agentMapping', () => {
    expect(mapRoleToOpenClawAgent('developer', null)).toBe('mpu-d3');
    expect(mapRoleToOpenClawAgent('reviewer', null)).toBe('mpu-d2');
    expect(mapRoleToOpenClawAgent('scout', null)).toBe('mpu-d1');
    expect(mapRoleToOpenClawAgent('designer', null)).toBe('mpu-d4');
  });

  it('should default to mpu-d3 when no match and no agentMapping', () => {
    expect(mapRoleToOpenClawAgent('random', null)).toBe('mpu-d3');
    expect(mapRoleToOpenClawAgent('', null)).toBe('mpu-d3');
  });
});

describe('Install V7.0 — install.js file checks', () => {
  it('install.js should reference V9.0', () => {
    const content = readFileSync(join(ROOT, 'install.js'), 'utf-8');
    expect(content).toContain('V9.0');
  });

  it('install.js should include --no-interactive flag', () => {
    const content = readFileSync(join(ROOT, 'install.js'), 'utf-8');
    expect(content).toContain('--no-interactive');
  });

  it('install.js should include detectExistingEnvironment', () => {
    const content = readFileSync(join(ROOT, 'install.js'), 'utf-8');
    expect(content).toContain('detectExistingEnvironment');
  });

  it('install.js should include interactiveSwarmMapping', () => {
    const content = readFileSync(join(ROOT, 'install.js'), 'utf-8');
    expect(content).toContain('interactiveSwarmMapping');
  });

  it('install.js should include detectWarmStartCapability', () => {
    const content = readFileSync(join(ROOT, 'install.js'), 'utf-8');
    expect(content).toContain('detectWarmStartCapability');
  });

  it('install.js should include V9 7-domain config keys', () => {
    const content = readFileSync(join(ROOT, 'install.js'), 'utf-8');
    expect(content).toContain('field:');
    expect(content).toContain('communication:');
    expect(content).toContain('intelligence:');
    expect(content).toContain('orchestration:');
    expect(content).toContain('quality:');
    expect(content).toContain('observe:');
  });

  it('install.js should include inferSwarmRole with unknown marking', () => {
    const content = readFileSync(join(ROOT, 'install.js'), 'utf-8');
    expect(content).toContain('inferSwarmRole');
    expect(content).toContain("return 'unknown'");
  });

  it('souls/scout.md should exist', () => {
    const content = readFileSync(join(ROOT, 'souls', 'scout.md'), 'utf-8');
    expect(content).toContain('Scout Bee');
    expect(content).toContain('侦察蜂');
  });

  it('V9 run-tool.js should exist in bridge/tools/', () => {
    const content = readFileSync(join(ROOT, 'src/bridge/tools/run-tool.js'), 'utf-8');
    expect(content).toContain('swarm_run');
  });

  it('V9 swarm-core-v9.js should have initialize and coupling verification', () => {
    const content = readFileSync(join(ROOT, 'src/swarm-core-v9.js'), 'utf-8');
    expect(content).toContain('_verifyCoupling');
    expect(content).toContain('initialize');
  });

  it('install.js should create AGENTS.md and SOUL.md templates in relay workspace', () => {
    const content = readFileSync(join(ROOT, 'install.js'), 'utf-8');
    expect(content).toContain('ensureWorkspaceTemplates');
    expect(content).toContain('AGENTS.md');
    expect(content).toContain('SOUL.md');
  });
});
