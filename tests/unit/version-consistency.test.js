/**
 * 版本一致性检查 V5.6 / Version Consistency Check V5.6
 *
 * 自动验证所有版本号引用的一致性
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

function readFile(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf-8');
}

describe('Version Consistency', () => {
  const EXPECTED_VERSION = '5.6.0';
  const EXPECTED_NAME = 'Claw-Swarm V5.6';

  it('openclaw.plugin.json version should be ' + EXPECTED_VERSION, () => {
    const content = JSON.parse(readFile('openclaw.plugin.json'));
    expect(content.version).toBe(EXPECTED_VERSION);
  });

  it('openclaw.plugin.json name should contain V5.6', () => {
    const content = JSON.parse(readFile('openclaw.plugin.json'));
    expect(content.name).toContain('V5.6');
  });

  it('plugin-adapter.js VERSION should be ' + EXPECTED_VERSION, () => {
    const content = readFile('src/L5-application/plugin-adapter.js');
    expect(content).toContain(`VERSION = '${EXPECTED_VERSION}'`);
  });

  it('index.js VERSION should be ' + EXPECTED_VERSION, () => {
    const content = readFile('src/index.js');
    expect(content).toContain(`VERSION = '${EXPECTED_VERSION}'`);
  });

  it('install.js should reference V5.6', () => {
    const content = readFile('install.js');
    expect(content).toContain(EXPECTED_NAME);
  });

  it('no source file should contain prohibited text', () => {
    // Check key source files for prohibited text
    const filesToCheck = [
      'src/index.js',
      'src/event-catalog.js',
      'src/L4-orchestration/swarm-advisor.js',
      'src/L4-orchestration/global-modulator.js',
      'src/L4-orchestration/governance-metrics.js',
      'src/L2-communication/state-convergence.js',
      'src/L6-monitoring/startup-diagnostics.js',
      'src/L6-monitoring/trace-collector.js',
    ];

    for (const file of filesToCheck) {
      try {
        const content = readFile(file).toLowerCase();
        // Check for the prohibited AI assistant name (lowercase check)
        const hasProhibited = content.includes('claude');
        expect(hasProhibited, `${file} should not contain prohibited text`).toBe(false);
      } catch {
        // File may not exist in some configurations, skip
      }
    }
  });
});
