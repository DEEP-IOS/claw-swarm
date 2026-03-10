/**
 * 版本一致性检查 V5.7 / Version Consistency Check V5.7
 *
 * 验证关键文件中的版本号引用一致。
 * Verifies that version references are consistent across key files.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 项目根目录 / Project root directory
const ROOT = join(import.meta.dirname, '../../');

describe('Version Consistency V5.7', () => {
  const EXPECTED_VERSION = '5.7.0';

  it('openclaw.plugin.json version 应为 5.7.0 / should be 5.7.0', () => {
    const raw = readFileSync(join(ROOT, 'openclaw.plugin.json'), 'utf-8');
    const content = JSON.parse(raw);
    expect(content.version).toBe(EXPECTED_VERSION);
  });

  it('install.js 应包含 V5.7 引用 / should contain V5.7 reference', () => {
    const content = readFileSync(join(ROOT, 'install.js'), 'utf-8');
    expect(content).toContain('V5.7');
  });
});
