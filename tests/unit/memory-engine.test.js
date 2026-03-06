/**
 * Unit tests for Memory Engine components
 *
 * Tests agent-resolver (resolveAgentId, isNewSession) and config
 * utilities (isFileModifyingTool) that were originally in OME.
 *
 * Ported from OME unit.test.js to Claw-Swarm v4.0.
 *
 * Note: OME's message-utils (truncate, extractMessageText, formatDuration)
 * are not present in the v4.0 codebase and are therefore not tested here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveAgentId, isNewSession } from '../../src/layer2-engines/memory/agent-resolver.js';
import { isFileModifyingTool, DEFAULT_CONFIG } from '../../src/layer1-core/config.js';

// The v4.0 agent-resolver functions expect a config with top-level
// agentResolution and injection keys (the old OME config shape).
// In v4.0, these live under DEFAULT_CONFIG.memory.
const MEMORY_CONFIG = DEFAULT_CONFIG.memory;

describe('Memory Engine Utils', () => {
  describe('agent-resolver', () => {
    it('should resolve from ctx.agentId', () => {
      const ctx = { agentId: 'agent-alpha' };
      assert.equal(resolveAgentId(ctx, null, MEMORY_CONFIG), 'agent-alpha');
    });

    it('should resolve from sessionKey', () => {
      const ctx = { sessionKey: 'agent:main:channel' };
      assert.equal(resolveAgentId(ctx, null, MEMORY_CONFIG), 'main');
    });

    it('should fallback to default value', () => {
      const ctx = {};
      assert.equal(resolveAgentId(ctx, null, MEMORY_CONFIG), 'main');
    });

    it('should detect new session', () => {
      const state = { sessionId: 'sess-1' };
      const ctx = { sessionId: 'sess-2' };
      assert.equal(isNewSession(state, ctx), true);

      const ctxSame = { sessionId: 'sess-1' };
      assert.equal(isNewSession(state, ctxSame), false);
    });
  });

  describe('config', () => {
    it('should correctly identify file modifying tools', () => {
      assert.equal(isFileModifyingTool('write', {}, DEFAULT_CONFIG), true);
      assert.equal(isFileModifyingTool('edit_file', {}, DEFAULT_CONFIG), true);
      assert.equal(isFileModifyingTool('read', {}, DEFAULT_CONFIG), false);
    });

    it('should detect bash commands with file operations', () => {
      assert.equal(isFileModifyingTool('bash', { command: 'echo test > file.txt' }, DEFAULT_CONFIG), true);
      assert.equal(isFileModifyingTool('bash', { command: 'ls -la' }, DEFAULT_CONFIG), false);
    });

    it('should detect file paths in params', () => {
      assert.equal(isFileModifyingTool('custom', { filePath: '/tmp/test.txt' }, DEFAULT_CONFIG), true);
      assert.equal(isFileModifyingTool('custom', { path: '/tmp/test.txt' }, DEFAULT_CONFIG), true);
    });
  });
});
