/**
 * @fileoverview Unit tests for Claw-Swarm v4.0 - Layer 4 Hooks
 * @module tests/unit/hooks.test
 *
 * 测试 Agent 生命周期钩子：启动前、工具调用后、结束、消息发送。
 * Tests Agent lifecycle hooks: before-start, after-tool-call, end, message-sending.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { handleBeforeAgentStart } from '../../src/layer4-adapter/hooks/before-agent-start.js';
import { handleAfterToolCall } from '../../src/layer4-adapter/hooks/after-tool-call.js';
import { handleAgentEnd } from '../../src/layer4-adapter/hooks/agent-end.js';
import { handleMessageSending } from '../../src/layer4-adapter/hooks/message-sending.js';

// ===========================================================================
// Helper: mock logger
// ===========================================================================
const mockLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

// ===========================================================================
// handleBeforeAgentStart — Agent 启动前钩子 / Before Agent Start Hook
// ===========================================================================

describe('handleBeforeAgentStart', () => {
  it('should export a function (导出一个函数)', () => {
    assert.equal(typeof handleBeforeAgentStart, 'function');
  });

  it('should return object with prependContext when memory enabled (内存启用时返回 prependContext)', () => {
    const config = { memory: { enabled: true }, collaboration: {}, pheromone: {} };
    const engines = {
      buildPrependContext: () => 'Memory context here',
    };
    const result = handleBeforeAgentStart(
      {}, { agentId: 'a1' }, engines, config, mockLogger, {},
    );
    assert.ok(result);
    assert.ok(result.prependContext.includes('Memory context here'));
  });

  it('should inject peer directory when collaboration enabled (协作启用时注入同伴目录)', () => {
    const config = { memory: {}, collaboration: { enabled: true }, pheromone: {} };
    const engines = {};
    const api = {
      config: {
        agents: [
          { id: 'a1', label: 'Main' },
          { id: 'a2', label: 'Helper', skills: ['coding'] },
        ],
      },
    };
    const result = handleBeforeAgentStart(
      {}, { agentId: 'a1' }, engines, config, mockLogger, api,
    );
    assert.ok(result);
    assert.ok(result.prependContext.includes('[Peer Directory]'));
    assert.ok(result.prependContext.includes('a2'));
    // Should exclude self
    assert.ok(!result.prependContext.includes('- a1'));
  });

  it('should inject pheromone snapshot when pheromone enabled (信息素启用时注入快照)', () => {
    const config = { memory: {}, collaboration: {}, pheromone: { enabled: true } };
    const engines = {
      pheromone: {
        buildSnapshot: () => '[Pheromone Snapshot]\n- trail: 0.8',
      },
    };
    const result = handleBeforeAgentStart(
      {}, { agentId: 'a1' }, engines, config, mockLogger, {},
    );
    assert.ok(result);
    assert.ok(result.prependContext.includes('[Pheromone Snapshot]'));
  });

  it('should return undefined when no context parts (无上下文部分时返回 undefined)', () => {
    const config = { memory: {}, collaboration: {}, pheromone: {} };
    const result = handleBeforeAgentStart(
      {}, { agentId: 'a1' }, {}, config, mockLogger, {},
    );
    assert.equal(result, undefined);
  });

  it('should handle missing/null dependencies gracefully (优雅处理缺失/null 依赖)', () => {
    const config = { memory: { enabled: true }, collaboration: { enabled: true }, pheromone: { enabled: true } };
    const engines = {
      buildPrependContext: () => { throw new Error('boom'); },
      pheromone: {
        buildSnapshot: () => { throw new Error('boom'); },
      },
    };
    // Should not throw, should log warnings
    assert.doesNotThrow(() => {
      handleBeforeAgentStart({}, {}, engines, config, mockLogger, {});
    });
  });

  it('should resolve agentId from ctx, then event, then default (从 ctx/event/默认值解析 agentId)', () => {
    const config = { memory: { enabled: true }, collaboration: {}, pheromone: {} };
    const engines = {
      buildPrependContext: (agentId) => `Agent: ${agentId}`,
    };

    // From ctx
    let result = handleBeforeAgentStart(
      {}, { agentId: 'from-ctx' }, engines, config, mockLogger, {},
    );
    assert.ok(result.prependContext.includes('from-ctx'));

    // From event when ctx has no agentId
    result = handleBeforeAgentStart(
      { agentId: 'from-event' }, {}, engines, config, mockLogger, {},
    );
    assert.ok(result.prependContext.includes('from-event'));

    // Default
    result = handleBeforeAgentStart(
      {}, {}, engines, config, mockLogger, {},
    );
    assert.ok(result.prependContext.includes('main'));
  });
});

// ===========================================================================
// handleAfterToolCall — 工具调用后钩子 / After Tool Call Hook
// ===========================================================================

describe('handleAfterToolCall', () => {
  it('should export a function (导出一个函数)', () => {
    assert.equal(typeof handleAfterToolCall, 'function');
  });

  it('should call trackToolCall when memory enabled and agentState exists (内存启用且有 agentState 时调用 trackToolCall)', () => {
    let tracked = false;
    const config = { memory: { enabled: true } };
    const engines = {
      agentState: {
        trackToolCall: () => { tracked = true; },
      },
    };
    const event = { toolName: 'read_file', params: {}, result: 'ok', error: null };

    handleAfterToolCall(event, { agentId: 'a1' }, engines, config, mockLogger);
    assert.equal(tracked, true);
  });

  it('should not crash when memory disabled (内存关闭时不崩溃)', () => {
    const config = { memory: {} };
    assert.doesNotThrow(() => {
      handleAfterToolCall({ toolName: 'test' }, {}, {}, config, mockLogger);
    });
  });

  it('should not crash when agentState is null (agentState 为 null 时不崩溃)', () => {
    const config = { memory: { enabled: true } };
    assert.doesNotThrow(() => {
      handleAfterToolCall({ toolName: 'test' }, {}, {}, config, mockLogger);
    });
  });

  it('should handle trackToolCall throwing error (trackToolCall 抛错时不崩溃)', () => {
    const config = { memory: { enabled: true } };
    const engines = {
      agentState: {
        trackToolCall: () => { throw new Error('tracking failed'); },
      },
    };
    assert.doesNotThrow(() => {
      handleAfterToolCall({ toolName: 'test' }, { agentId: 'a1' }, engines, config, mockLogger);
    });
  });
});

// ===========================================================================
// handleAgentEnd — Agent 结束钩子 / Agent End Hook
// ===========================================================================

describe('handleAgentEnd', () => {
  it('should export a function (导出一个函数)', () => {
    assert.equal(typeof handleAgentEnd, 'function');
  });

  it('should emit trail pheromone when pheromone enabled (信息素启用时发射 trail 信息素)', () => {
    let emitted = null;
    const config = { memory: {}, pheromone: { enabled: true } };
    const engines = {
      pheromone: {
        emitPheromone: (p) => { emitted = p; },
      },
    };

    handleAgentEnd({}, { agentId: 'a1', sessionId: 's1' }, engines, config, mockLogger);
    assert.ok(emitted);
    assert.equal(emitted.type, 'trail');
    assert.equal(emitted.sourceId, 'a1');
    assert.equal(emitted.payload.event, 'agent_end');
  });

  it('should not crash when pheromone disabled (信息素关闭时不崩溃)', () => {
    const config = { memory: {}, pheromone: {} };
    assert.doesNotThrow(() => {
      handleAgentEnd({}, { agentId: 'a1' }, {}, config, mockLogger);
    });
  });

  it('should not crash when pheromone engine throws (信息素引擎抛错时不崩溃)', () => {
    const config = { memory: {}, pheromone: { enabled: true } };
    const engines = {
      pheromone: {
        emitPheromone: () => { throw new Error('emit failed'); },
      },
    };
    assert.doesNotThrow(() => {
      handleAgentEnd({}, { agentId: 'a1' }, engines, config, mockLogger);
    });
  });

  it('should handle missing ctx gracefully (优雅处理缺失的 ctx)', () => {
    const config = { memory: {}, pheromone: { enabled: true } };
    let emitted = null;
    const engines = {
      pheromone: {
        emitPheromone: (p) => { emitted = p; },
      },
    };
    assert.doesNotThrow(() => {
      handleAgentEnd({ agentId: 'from-event' }, undefined, engines, config, mockLogger);
    });
    // Should resolve agentId from event
    assert.equal(emitted.sourceId, 'from-event');
  });
});

// ===========================================================================
// handleMessageSending — 消息发送钩子 / Message Sending Hook
// ===========================================================================

describe('handleMessageSending', () => {
  it('should export a function (导出一个函数)', () => {
    assert.equal(typeof handleMessageSending, 'function');
  });

  it('should return undefined when content is empty (内容为空时返回 undefined)', () => {
    const result = handleMessageSending(
      { content: '' }, {}, {}, { collaboration: { mentionFixer: true } }, mockLogger,
    );
    assert.equal(result, undefined);
  });

  it('should return undefined when mentionFixer disabled (mentionFixer 关闭时返回 undefined)', () => {
    const result = handleMessageSending(
      { content: 'Hello @agent-2' }, {}, {}, { collaboration: {} }, mockLogger,
    );
    assert.equal(result, undefined);
  });

  it('should return undefined when no @mentions found (无 @提及时返回 undefined)', () => {
    const result = handleMessageSending(
      { content: 'Hello world, no mentions here' },
      {}, {}, { collaboration: { mentionFixer: true } }, mockLogger,
    );
    assert.equal(result, undefined);
  });

  it('should fix @mention matching known peer (修复匹配已知同伴的 @提及)', () => {
    const engines = {
      peerDirectory: {
        getDirectory: () => [
          { id: 'agent-2', label: 'Helper' },
          { id: 'agent-3', label: 'Guard' },
        ],
      },
    };
    const config = { collaboration: { mentionFixer: true } };
    const result = handleMessageSending(
      { content: 'Hey @agent-2, can you help?' }, {}, engines, config, mockLogger,
    );
    assert.ok(result);
    assert.ok(result.content.includes('collaborate tool'));
    assert.ok(!result.content.includes('@agent-2'));
  });

  it('should not fix @mention for unknown peers (不修复未知同伴的 @提及)', () => {
    const engines = {
      peerDirectory: {
        getDirectory: () => [{ id: 'agent-2' }],
      },
    };
    const config = { collaboration: { mentionFixer: true } };
    const result = handleMessageSending(
      { content: 'Hey @unknown-agent, can you help?' }, {}, engines, config, mockLogger,
    );
    // No known peer matched, so no change
    assert.equal(result, undefined);
  });

  it('should handle null peerDirectory gracefully (null peerDirectory 不崩溃)', () => {
    const config = { collaboration: { mentionFixer: true } };
    const result = handleMessageSending(
      { content: 'Hey @agent-2, can you help?' }, {}, {}, config, mockLogger,
    );
    // No peers found, no change
    assert.equal(result, undefined);
  });

  it('should fix multiple mentions in one message (一条消息修复多个提及)', () => {
    const engines = {
      peerDirectory: {
        getDirectory: () => [
          { id: 'agent-2' },
          { id: 'agent-3' },
        ],
      },
    };
    const config = { collaboration: { mentionFixer: true } };
    const result = handleMessageSending(
      { content: 'Hey @agent-2 and @agent-3, let us work together' },
      {}, engines, config, mockLogger,
    );
    assert.ok(result);
    assert.ok(!result.content.includes('@agent-2'));
    assert.ok(!result.content.includes('@agent-3'));
  });

  it('should match by label as well as id (同时匹配 label 和 id)', () => {
    const engines = {
      peerDirectory: {
        getDirectory: () => [{ id: 'agent-2', label: 'Helper', name: 'helper-agent' }],
      },
    };
    const config = { collaboration: { mentionFixer: true } };
    const result = handleMessageSending(
      { content: 'Hey @Helper, can you help?' }, {}, engines, config, mockLogger,
    );
    assert.ok(result);
    assert.ok(result.content.includes('collaborate tool'));
  });
});
