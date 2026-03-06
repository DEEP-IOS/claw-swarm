/**
 * Unit tests for strategy implementations
 *
 * Tests BaseStrategy, SimulatedStrategy, SequentialStrategy, and FileBasedStrategy.
 *
 * Ported from Swarm Lite v3.0 to Claw-Swarm v4.0.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

import { BaseStrategy } from '../../src/layer3-intelligence/orchestration/strategies/base-strategy.js';
import { SimulatedStrategy } from '../../src/layer3-intelligence/orchestration/strategies/simulated-strategy.js';
import { SequentialStrategy } from '../../src/layer3-intelligence/orchestration/strategies/sequential-strategy.js';
import { FileBasedStrategy } from '../../src/layer3-intelligence/orchestration/strategies/file-based-strategy.js';
import { SwarmTimeoutError } from '../../src/layer1-core/errors.js';

// -----------------------------------------------------------------------
// Shared fixtures
// -----------------------------------------------------------------------

/**
 * Create a minimal role object for testing.
 */
function makeRole(name = 'Architect', priority = 1) {
  return {
    name,
    description: `Test role ${name}`,
    capabilities: ['design', 'planning'],
    priority,
    dependencies: [],
  };
}

/**
 * Create a minimal execution context.
 */
function makeContext(timeout = 300000) {
  return {
    taskId: `test-task-${randomUUID()}`,
    role: makeRole(),
    sharedMemory: {},
    timeout,
    taskConfig: { description: 'test' },
  };
}

describe('Strategies', () => {
  // -----------------------------------------------------------------------
  // BaseStrategy
  // -----------------------------------------------------------------------

  describe('BaseStrategy', () => {
    it('cannot be instantiated directly', () => {
      assert.throws(
        () => new BaseStrategy('test'),
        (err) => {
          assert.ok(err.message.includes('abstract'));
          return true;
        },
      );
    });
  });

  // -----------------------------------------------------------------------
  // SimulatedStrategy
  // -----------------------------------------------------------------------

  describe('SimulatedStrategy', () => {
    it('execute returns completed RoleResult', async () => {
      const strategy = new SimulatedStrategy();
      const role = makeRole('Architect', 1);
      const ctx = makeContext();

      const result = await strategy.execute(role, 'Test prompt', ctx);

      assert.equal(result.role, 'Architect');
      assert.equal(result.status, 'completed');
      assert.ok(result.output.includes('Simulated output'));
      assert.ok(result.output.includes('Architect'));
      assert.ok(typeof result.duration === 'number');
      assert.ok(result.duration >= 0);
    });

    it('generates correct artifacts for each role', async () => {
      const strategy = new SimulatedStrategy();

      // Architect artifacts
      const archResult = await strategy.execute(
        makeRole('Architect', 1),
        'prompt',
        makeContext(),
      );
      assert.ok(archResult.artifacts.includes('architecture.md'));
      assert.ok(archResult.artifacts.includes('api-spec.yaml'));

      // FrontendDev artifacts
      const feResult = await strategy.execute(
        makeRole('FrontendDev', 2),
        'prompt',
        makeContext(),
      );
      assert.ok(feResult.artifacts.includes('App.jsx'));

      // BackendDev artifacts
      const beResult = await strategy.execute(
        makeRole('BackendDev', 2),
        'prompt',
        makeContext(),
      );
      assert.ok(beResult.artifacts.includes('server.js'));

      // Unknown role gets default artifact
      const unknownResult = await strategy.execute(
        makeRole('UnknownRole', 5),
        'prompt',
        makeContext(),
      );
      assert.deepEqual(unknownResult.artifacts, ['output.md']);
    });
  });

  // -----------------------------------------------------------------------
  // SequentialStrategy
  // -----------------------------------------------------------------------

  describe('SequentialStrategy', () => {
    it('execute returns structured output', async () => {
      const strategy = new SequentialStrategy();
      const role = makeRole('BackendDev', 2);
      const ctx = makeContext();

      const result = await strategy.execute(role, 'Build an API', ctx);

      assert.equal(result.role, 'BackendDev');
      assert.equal(result.status, 'completed');
      assert.ok(typeof result.output === 'string');

      // Output should be valid JSON
      const parsed = JSON.parse(result.output);
      assert.ok(parsed.prompt, 'Should include prompt in output');
      assert.ok(Array.isArray(parsed.deliverables));
      assert.ok(Array.isArray(parsed.artifacts));
    });

    it('execute times out with SwarmTimeoutError (very short timeout)', async () => {
      // Create a strategy whose _executeWork we override to be slow
      const strategy = new SequentialStrategy({ defaultTimeout: 10 });

      // Override _executeWork to simulate a slow operation
      const originalWork = strategy._executeWork.bind(strategy);
      strategy._executeWork = async (role, prompt, context) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return originalWork(role, prompt, context);
      };

      const role = makeRole('SlowRole', 1);
      const ctx = makeContext(10); // 10ms timeout in context

      await assert.rejects(
        () => strategy.execute(role, 'slow work', ctx),
        (err) => {
          assert.ok(err instanceof SwarmTimeoutError);
          assert.ok(err.message.includes('exceeded timeout'));
          return true;
        },
      );
    });
  });

  // -----------------------------------------------------------------------
  // FileBasedStrategy
  // -----------------------------------------------------------------------

  describe('FileBasedStrategy', () => {
    it('falls back to simulated on orphan timeout (very short timeout)', async () => {
      const taskDir = path.join(os.tmpdir(), `swarm-fbs-test-${randomUUID()}`);

      const strategy = new FileBasedStrategy({
        taskDir,
        orphanTimeout: 100, // 100ms -- no external agent will respond
      });

      const role = makeRole('Architect', 1);
      const ctx = makeContext();

      const result = await strategy.execute(role, 'test prompt', ctx);

      // Should fall back to simulated strategy output
      assert.equal(result.role, 'Architect');
      assert.equal(result.status, 'completed');
      assert.ok(result.output.includes('Simulated output'));

      // Cleanup
      try { fs.rmSync(taskDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });
  });
});
