/**
 * WorkspaceOrganizer 单元测试
 * Tests: analyzeStructure, suggestPlacement, scaffoldFeatureDirectory, getConventions cache
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceOrganizer } from '../../../src/intelligence/artifacts/workspace-organizer.js';
import { DomainStore } from '../../../src/core/store/domain-store.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

describe('WorkspaceOrganizer', () => {
  let store, organizer, tmpRoot;

  beforeEach(() => {
    const tmpDir = path.join(os.tmpdir(), `ws-org-test-${Date.now()}`);
    store = new DomainStore({ domain: 'test-workspace', snapshotDir: tmpDir });
    organizer = new WorkspaceOrganizer({ store });

    // Create a temp project directory with standard layout
    tmpRoot = path.join(os.tmpdir(), `ws-project-${Date.now()}`);
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  function createStandardProject() {
    fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'tests'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'config'), { recursive: true });
  }

  function createFlatProject() {
    // No src, no tests, no config - just some files
    fs.writeFileSync(path.join(tmpRoot, 'index.js'), '');
    fs.writeFileSync(path.join(tmpRoot, 'package.json'), '{}');
  }

  it('analyzeStructure: 标准项目 → sourceDir=src, testDir=tests', () => {
    createStandardProject();
    const result = organizer.analyzeStructure(tmpRoot);
    expect(result.type).toBe('standard');
    expect(result.sourceDir).toBe('src');
    expect(result.testDir).toBe('tests');
    expect(result.configDir).toBe('config');
    expect(result.conventions.length).toBeGreaterThan(0);
  });

  it('suggestPlacement: test type → testDir 下', () => {
    createStandardProject();
    const suggested = organizer.suggestPlacement(tmpRoot, 'test', 'foo.test.js');
    expect(suggested).toBe('tests/foo.test.js');
  });

  it('suggestPlacement: code_change → src 目录下', () => {
    createStandardProject();
    const suggested = organizer.suggestPlacement(tmpRoot, 'code_change', 'feature.js');
    expect(suggested).toBe('src/feature.js');
  });

  it('scaffoldFeatureDirectory → 返回数组', () => {
    createStandardProject();
    const dirs = organizer.scaffoldFeatureDirectory(tmpRoot, 'auth');
    expect(Array.isArray(dirs)).toBe(true);
    expect(dirs.length).toBe(4);
    expect(dirs).toContain('src/auth');
    expect(dirs).toContain('src/auth/components');
    expect(dirs).toContain('src/auth/utils');
    expect(dirs).toContain('tests/auth');
  });

  it('getConventions: 缓存工作正常', () => {
    createStandardProject();
    const analyzeSpy = vi.spyOn(organizer, 'analyzeStructure');

    const first = organizer.getConventions(tmpRoot);
    const second = organizer.getConventions(tmpRoot);

    // analyzeStructure should only be called once due to caching
    expect(analyzeSpy).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it('analyzeStructure: flat 项目没有 src 目录', () => {
    createFlatProject();
    const result = organizer.analyzeStructure(tmpRoot);
    expect(result.type).toBe('flat');
    expect(result.sourceDir).toBe('.');
  });
});
