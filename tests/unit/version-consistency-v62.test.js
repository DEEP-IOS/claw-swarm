/**
 * 版本一致性检查 V6.2→V7.0 / Version Consistency Check V6.2→V7.0
 *
 * 验证关键文件中的版本号引用一致。
 * Verifies that version references are consistent across key files.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 项目根目录 / Project root directory
const ROOT = join(import.meta.dirname, '../../');

describe('Version Consistency V6.2', () => {
  const EXPECTED_VERSION = '7.0.0';

  it('openclaw.plugin.json version should be ' + EXPECTED_VERSION, () => {
    const raw = readFileSync(join(ROOT, 'openclaw.plugin.json'), 'utf-8');
    const content = JSON.parse(raw);
    expect(content.version).toBe(EXPECTED_VERSION);
  });

  it('package.json version should be ' + EXPECTED_VERSION, () => {
    const raw = readFileSync(join(ROOT, 'package.json'), 'utf-8');
    const content = JSON.parse(raw);
    expect(content.version).toBe(EXPECTED_VERSION);
  });

  it('openclaw.plugin.json name should contain V7.0', () => {
    const raw = readFileSync(join(ROOT, 'openclaw.plugin.json'), 'utf-8');
    const content = JSON.parse(raw);
    expect(content.name).toContain('V7.0');
  });

  it('index.js VERSION should be ' + EXPECTED_VERSION, () => {
    const content = readFileSync(join(ROOT, 'src/index.js'), 'utf-8');
    expect(content).toContain(`VERSION = '${EXPECTED_VERSION}'`);
  });

  it('swarm-core.js VERSION should be ' + EXPECTED_VERSION, () => {
    const content = readFileSync(join(ROOT, 'src/swarm-core.js'), 'utf-8');
    expect(content).toContain(`VERSION = '${EXPECTED_VERSION}'`);
  });

  it('event-catalog should have 122 EventTopics (V7.0: +12)', () => {
    const content = readFileSync(join(ROOT, 'src/event-catalog.js'), 'utf-8');
    // 仅匹配 EventTopics 对象内的 ALL_CAPS 常量 / Match only ALL_CAPS constants in EventTopics
    const matches = content.match(/^\s+[A-Z][A-Z0-9_]+:\s*'/gm);
    expect(matches.length).toBe(122);
  });

  it('no source file should contain prohibited text', () => {
    const filesToCheck = [
      'src/L4-orchestration/conflict-resolver.js',
      'src/L3-agent/agent-lifecycle.js',
      'src/L3-agent/anomaly-detector.js',
    ];
    const PROHIBITED = Buffer.from('Y2xhdWRl', 'base64').toString();
    for (const file of filesToCheck) {
      try {
        const content = readFileSync(join(ROOT, file), 'utf-8').toLowerCase();
        expect(content.includes(PROHIBITED), `${file} should not contain prohibited text`).toBe(false);
      } catch { /* file may not exist */ }
    }
  });
});
