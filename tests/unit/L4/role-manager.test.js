/**
 * RoleManager 单元测试 / RoleManager Unit Tests
 *
 * 测试角色模板管理、生命周期、相似角色合并、僵尸清理。
 * Tests role template management, lifecycle, similar role merging, stale pruning.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RoleManager } from '../../../src/L4-orchestration/role-manager.js';

describe('RoleManager', () => {
  let rm;

  beforeEach(() => {
    rm = new RoleManager();
  });

  // ── 基础 CRUD / Basic CRUD ──

  it('should have 7 built-in templates', () => {
    const templates = rm.listTemplates();
    expect(templates.length).toBe(7);
    const names = templates.map(t => t.name).sort();
    expect(names).toEqual(['analyst', 'architect', 'designer', 'developer', 'devops', 'reviewer', 'tester']);
  });

  it('should register and retrieve a custom template', () => {
    rm.registerTemplate({
      name: 'security-specialist',
      description: 'Security focused role',
      capabilities: { coding: 0.5, architecture: 0.4, testing: 0.6, documentation: 0.3, security: 0.95, performance: 0.4, communication: 0.5, domain: 0.4 },
      keywords: ['security', 'vulnerability', 'audit'],
      systemPrompt: 'You are a security specialist.',
    });
    const t = rm.getTemplate('security-specialist');
    expect(t).not.toBeNull();
    expect(t.name).toBe('security-specialist');
    expect(t.capabilities.security).toBe(0.95);
  });

  it('should match role by task description', () => {
    const match = rm.matchRole('write unit tests for the authentication module');
    expect(match).not.toBeNull();
    expect(match.name).toBe('tester');
  });

  // ── 执行统计 + 生命周期元数据 / Execution Stats + Lifecycle Metadata ──

  it('should track execution stats and update _meta.lastUsedAt', () => {
    rm.registerTemplate({
      name: 'custom-role',
      description: 'A custom role',
      capabilities: { coding: 0.9, architecture: 0.1, testing: 0.1, documentation: 0.1, security: 0.1, performance: 0.1, communication: 0.1, domain: 0.1 },
      keywords: ['custom'],
      systemPrompt: 'Custom role',
    });

    rm.recordExecution('custom-role', { success: true, quality: 0.85, duration: 1000 });
    rm.recordExecution('custom-role', { success: false, quality: 0.3, duration: 500 });

    const stats = rm.getRoleStats('custom-role');
    expect(stats.executions).toBe(2);
    expect(stats.successes).toBe(1);
    expect(stats.failures).toBe(1);
    expect(stats.successRate).toBe(0.5);

    // _meta should be updated
    const t = rm.getTemplate('custom-role');
    expect(t._meta).toBeDefined();
    expect(t._meta.usageCount).toBe(2);
  });

  // ── 相似角色合并 / Similar Role Merging ──

  it('should merge highly similar roles instead of creating duplicates', () => {
    // Register a custom role
    rm.registerTemplate({
      name: 'code-writer',
      description: 'Writes code',
      capabilities: { coding: 0.95, architecture: 0.5, testing: 0.6, documentation: 0.4, security: 0.4, performance: 0.6, communication: 0.5, domain: 0.5 },
      keywords: ['code', 'write'],
      systemPrompt: 'Write code.',
    });

    const before = rm.listTemplates().length;

    // Register a nearly identical role (same capability vector)
    const mergedName = rm.registerTemplate({
      name: 'coder',
      description: 'Codes things',
      capabilities: { coding: 0.95, architecture: 0.5, testing: 0.6, documentation: 0.4, security: 0.4, performance: 0.6, communication: 0.5, domain: 0.5 },
      keywords: ['coder', 'programming'],
      systemPrompt: 'Code things.',
    });

    const after = rm.listTemplates().length;

    // Should not create a new template — merged into existing similar one
    // (either 'developer' builtin or 'code-writer' custom, since cosine similarity > 0.95)
    expect(after).toBeLessThanOrEqual(before);
  });

  // ── 僵尸角色清理 / Stale Role Pruning ──

  it('should prune stale non-builtin roles', () => {
    // Manually inject a stale role with old metadata
    rm.registerTemplate({
      name: 'old-role',
      description: 'An old role',
      capabilities: { coding: 0.1, architecture: 0.1, testing: 0.1, documentation: 0.9, security: 0.1, performance: 0.1, communication: 0.1, domain: 0.9 },
      keywords: ['old'],
      systemPrompt: 'Old role.',
    });

    // Manually backdate the metadata
    const template = rm.getTemplate('old-role');
    // Access internal template via _templates Map
    const internal = rm._templates.get('old-role');
    if (internal?._meta) {
      internal._meta.createdAt = Date.now() - 60 * 24 * 60 * 60 * 1000; // 60 days ago
      internal._meta.lastUsedAt = Date.now() - 60 * 24 * 60 * 60 * 1000;
      internal._meta.usageCount = 1; // below threshold
    }

    const pruned = rm.pruneStaleRoles({ maxAgeDays: 30, minUsage: 3 });
    expect(pruned).toContain('old-role');
    expect(rm.getTemplate('old-role')).toBeNull();
  });

  it('should never prune built-in templates', () => {
    const pruned = rm.pruneStaleRoles({ maxAgeDays: 0, minUsage: 999 });
    expect(pruned.length).toBe(0);

    // All 7 built-ins should still be present
    expect(rm.listTemplates().length).toBeGreaterThanOrEqual(7);
  });
});
