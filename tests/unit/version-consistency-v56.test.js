/**
 * 版本一致性检查 V6.0→V7.0 / Version Consistency Check V6.0→V7.0
 *
 * 验证关键文件中的版本号引用一致。
 * Verifies that version references are consistent across key files.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 项目根目录 / Project root directory
const ROOT = join(import.meta.dirname, '../../');

describe('Version Consistency V6.0', () => {
  const EXPECTED_VERSION = '7.0.0';

  it('openclaw.plugin.json version 应为 7.0.0 / should be 7.0.0', () => {
    const raw = readFileSync(join(ROOT, 'openclaw.plugin.json'), 'utf-8');
    const content = JSON.parse(raw);
    expect(content.version).toBe(EXPECTED_VERSION);
  });

  it('package.json version 应为 7.0.0 / should be 7.0.0', () => {
    const raw = readFileSync(join(ROOT, 'package.json'), 'utf-8');
    const content = JSON.parse(raw);
    expect(content.version).toBe(EXPECTED_VERSION);
  });
});
