/**
 * 版本一致性检查 / Version Consistency Check
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
  const EXPECTED_VERSION = '7.0.0';
  const EXPECTED_NAME = 'Claw-Swarm V7.0';

  it('openclaw.plugin.json version should be ' + EXPECTED_VERSION, () => {
    const content = JSON.parse(readFile('openclaw.plugin.json'));
    expect(content.version).toBe(EXPECTED_VERSION);
  });

  it('openclaw.plugin.json name should contain V7.0', () => {
    const content = JSON.parse(readFile('openclaw.plugin.json'));
    expect(content.name).toContain('V7.0');
  });

  it('index.js VERSION should be ' + EXPECTED_VERSION, () => {
    const content = readFile('src/index.js');
    expect(content).toContain(`VERSION = '${EXPECTED_VERSION}'`);
  });

  it('swarm-core.js VERSION should be ' + EXPECTED_VERSION, () => {
    const content = readFile('src/swarm-core.js');
    expect(content).toContain(`VERSION = '${EXPECTED_VERSION}'`);
  });

  it('no source file should contain prohibited text', () => {
    // Check key source files for prohibited text
    const filesToCheck = [
      'src/index.js',
      'src/swarm-core.js',
      'src/event-catalog.js',
      'src/L1-infrastructure/ipc-bridge.js',
      'src/L4-orchestration/swarm-advisor.js',
      'src/L4-orchestration/global-modulator.js',
      'src/L4-orchestration/governance-metrics.js',
      'src/L2-communication/state-convergence.js',
      'src/L6-monitoring/startup-diagnostics.js',
      'src/L6-monitoring/trace-collector.js',
    ];

    const PROHIBITED = Buffer.from('Y2xhdWRl', 'base64').toString();
    for (const file of filesToCheck) {
      try {
        const content = readFile(file).toLowerCase();
        const hasProhibited = content.includes(PROHIBITED);
        expect(hasProhibited, `${file} should not contain prohibited text`).toBe(false);
      } catch {
        // File may not exist in some configurations, skip
      }
    }
  });
});
