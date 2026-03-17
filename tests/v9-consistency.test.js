/**
 * V9 Version Consistency Tests
 * Verifies VERSION alignment across key V9 files and scans for prohibited text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

describe('V9 Version Consistency', () => {
  it('index.js VERSION matches openclaw.plugin.json', () => {
    const indexContent = readFileSync(join(ROOT, 'src/index.js'), 'utf-8');
    const pluginJson = JSON.parse(readFileSync(join(ROOT, 'openclaw.plugin.json'), 'utf-8'));

    const versionMatch = indexContent.match(/VERSION\s*=\s*'([^']+)'/);
    expect(versionMatch).not.toBeNull();
    expect(versionMatch[1]).toBe(pluginJson.version);
  });

  it('swarm-core-v9.js VERSION starts with 9.', () => {
    const content = readFileSync(join(ROOT, 'src/swarm-core-v9.js'), 'utf-8');
    expect(content).toContain("VERSION = '9.");
  });

  it('package.json version matches plugin version', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    const plugin = JSON.parse(readFileSync(join(ROOT, 'openclaw.plugin.json'), 'utf-8'));
    expect(pkg.version).toBe(plugin.version);
  });

  it('no V8 legacy directories remain in src/', () => {
    const legacyDirs = [
      'src/L0-field', 'src/L1-infrastructure', 'src/L2-communication',
      'src/L3-agent', 'src/L4-orchestration', 'src/L5-application', 'src/L6-monitoring',
    ];
    for (const dir of legacyDirs) {
      expect(existsSync(join(ROOT, dir)), `${dir} should not exist`).toBe(false);
    }
  });

  it('V8 god object swarm-core.js does not exist', () => {
    expect(existsSync(join(ROOT, 'src/swarm-core.js'))).toBe(false);
  });

  it('V9 domain directories exist', () => {
    const v9Dirs = [
      'src/core', 'src/communication', 'src/intelligence',
      'src/orchestration', 'src/quality', 'src/observe', 'src/bridge',
    ];
    for (const dir of v9Dirs) {
      expect(existsSync(join(ROOT, dir)), `${dir} should exist`).toBe(true);
    }
  });

  it('V9 configSchema has 7-domain keys', () => {
    const plugin = JSON.parse(readFileSync(join(ROOT, 'openclaw.plugin.json'), 'utf-8'));
    const props = plugin.configSchema?.properties || {};

    const v9Keys = [
      'field', 'store', 'communication', 'intelligence',
      'orchestration', 'quality', 'observe',
    ];
    for (const key of v9Keys) {
      expect(props[key], `configSchema should have ${key}`).toBeDefined();
    }
  });
});
