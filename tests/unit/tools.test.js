/**
 * @fileoverview Unit tests for Claw-Swarm v4.0 - Layer 4 Tools
 * @module tests/unit/tools.test
 *
 * 测试工具定义、输入模式和处理函数验证。
 * Tests tool definitions, input schemas, and handler validation.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  collaborateToolDefinition,
  createCollaborateHandler,
} from '../../src/layer4-adapter/tools/collaborate-tool.js';

import {
  pheromoneToolDefinition,
  createPheromoneHandler,
} from '../../src/layer4-adapter/tools/pheromone-tool.js';

import {
  swarmManageToolDefinition,
  createSwarmManageHandler,
} from '../../src/layer4-adapter/tools/swarm-manage-tool.js';

// ===========================================================================
// collaborateToolDefinition — 协作工具定义 / Collaborate Tool Definition
// ===========================================================================

describe('collaborateToolDefinition', () => {
  it('should have required tool definition fields (应有必需的工具定义字段)', () => {
    assert.equal(collaborateToolDefinition.name, 'collaborate');
    assert.ok(collaborateToolDefinition.description);
    assert.ok(collaborateToolDefinition.parameters);
  });

  it('should have object-type parameters with properties (参数应为 object 类型并有属性)', () => {
    assert.equal(collaborateToolDefinition.parameters.type, 'object');
    assert.ok(collaborateToolDefinition.parameters.properties);
    assert.ok(collaborateToolDefinition.parameters.properties.target);
    assert.ok(collaborateToolDefinition.parameters.properties.message);
  });

  it('should require target and message (应要求 target 和 message)', () => {
    assert.deepEqual(collaborateToolDefinition.parameters.required, ['target', 'message']);
  });
});

// ===========================================================================
// createCollaborateHandler — 协作工具处理函数 / Collaborate Handler
// ===========================================================================

describe('createCollaborateHandler', () => {
  let handler;
  let emittedPheromone;

  beforeEach(() => {
    emittedPheromone = null;
    const mockEngines = {
      pheromone: {
        emitPheromone: (p) => { emittedPheromone = p; },
      },
    };
    handler = createCollaborateHandler(mockEngines, {}, { info: () => {}, warn: () => {} });
  });

  it('should return a function (返回一个函数)', () => {
    assert.equal(typeof handler, 'function');
  });

  it('should handle pheromone channel (处理 pheromone 通道)', () => {
    const result = handler(
      { target: 'agent-2', message: 'hello', channel: 'pheromone', urgency: 'medium' },
      { agentId: 'agent-1' },
    );
    assert.equal(result.success, true);
    assert.equal(result.channel, 'pheromone');
    assert.equal(result.target, 'agent-2');
    assert.ok(emittedPheromone);
    assert.equal(emittedPheromone.type, 'dance');
  });

  it('should handle direct channel (处理 direct 通道)', () => {
    const result = handler(
      { target: 'agent-2', message: 'hello', channel: 'direct' },
      { agentId: 'agent-1' },
    );
    assert.equal(result.success, true);
    assert.equal(result.channel, 'direct');
    assert.ok(result.instruction);
  });

  it('should fail for unknown channel (未知通道应失败)', () => {
    const result = handler(
      { target: 'agent-2', message: 'hello', channel: 'unknown' },
      { agentId: 'agent-1' },
    );
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  it('should fail when pheromone engine not available (信息素引擎不可用时失败)', () => {
    const h = createCollaborateHandler({}, {}, { info: () => {}, warn: () => {} });
    const result = h(
      { target: 'agent-2', message: 'hello', channel: 'pheromone' },
      { agentId: 'agent-1' },
    );
    assert.equal(result.success, false);
    assert.ok(result.error.includes('not enabled'));
  });

  it('should map critical urgency to alarm pheromone type (critical 紧急度映射为 alarm)', () => {
    handler(
      { target: 'agent-2', message: 'urgent!', channel: 'pheromone', urgency: 'critical' },
      { agentId: 'agent-1' },
    );
    assert.equal(emittedPheromone.type, 'alarm');
    assert.equal(emittedPheromone.intensity, 1.0);
  });

  it('should use broadcast scope for target=broadcast (broadcast 目标使用 /global 作用域)', () => {
    handler(
      { target: 'broadcast', message: 'hi all', channel: 'pheromone' },
      { agentId: 'agent-1' },
    );
    assert.equal(emittedPheromone.targetScope, '/global');
  });
});

// ===========================================================================
// pheromoneToolDefinition — 信息素工具定义 / Pheromone Tool Definition
// ===========================================================================

describe('pheromoneToolDefinition', () => {
  it('should have required tool definition fields (应有必需的工具定义字段)', () => {
    assert.equal(pheromoneToolDefinition.name, 'pheromone');
    assert.ok(pheromoneToolDefinition.description);
    assert.ok(pheromoneToolDefinition.parameters);
  });

  it('should have object-type parameters (参数应为 object 类型)', () => {
    assert.equal(pheromoneToolDefinition.parameters.type, 'object');
    assert.ok(pheromoneToolDefinition.parameters.properties.action);
  });

  it('should require action param (应要求 action 参数)', () => {
    assert.deepEqual(pheromoneToolDefinition.parameters.required, ['action']);
  });
});

// ===========================================================================
// createPheromoneHandler — 信息素工具处理函数 / Pheromone Handler
// ===========================================================================

describe('createPheromoneHandler', () => {
  it('should return a function (返回一个函数)', () => {
    const handler = createPheromoneHandler({}, {}, { info: () => {} });
    assert.equal(typeof handler, 'function');
  });

  it('should fail when pheromone engine not enabled (信息素引擎未启用时失败)', () => {
    const handler = createPheromoneHandler({}, {}, { info: () => {} });
    const result = handler({ action: 'emit', type: 'trail' }, {});
    assert.equal(result.success, false);
    assert.ok(result.error.includes('not enabled'));
  });

  it('should handle emit action (处理 emit 动作)', () => {
    let emitted = null;
    const handler = createPheromoneHandler(
      { pheromone: { emitPheromone: (p) => { emitted = p; } } },
      {}, { info: () => {} },
    );
    const result = handler(
      { action: 'emit', type: 'trail', scope: '/global', message: 'test' },
      { agentId: 'a1' },
    );
    assert.equal(result.success, true);
    assert.equal(result.action, 'emit');
    assert.ok(emitted);
  });

  it('should require type for emit action (emit 动作需要 type)', () => {
    const handler = createPheromoneHandler(
      { pheromone: { emitPheromone: () => {} } },
      {}, { info: () => {} },
    );
    const result = handler({ action: 'emit' }, { agentId: 'a1' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('type is required'));
  });

  it('should handle read action (处理 read 动作)', () => {
    const handler = createPheromoneHandler(
      {
        pheromone: {
          read: () => [
            { type: 'trail', currentIntensity: 0.8, source_id: 'a2', payload: {} },
          ],
        },
      },
      {}, { info: () => {} },
    );
    const result = handler({ action: 'read', scope: '/global' }, { agentId: 'a1' });
    assert.equal(result.success, true);
    assert.equal(result.action, 'read');
    assert.equal(result.signals.length, 1);
    assert.equal(result.signals[0].from, 'a2');
  });

  it('should fail for unknown action (未知动作应失败)', () => {
    const handler = createPheromoneHandler(
      { pheromone: {} },
      {}, { info: () => {} },
    );
    const result = handler({ action: 'unknown' }, {});
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Unknown action'));
  });
});

// ===========================================================================
// swarmManageToolDefinition — 蜂群管理工具定义 / Swarm Manage Tool Definition
// ===========================================================================

describe('swarmManageToolDefinition', () => {
  it('should have required tool definition fields (应有必需的工具定义字段)', () => {
    assert.equal(swarmManageToolDefinition.name, 'swarm_manage');
    assert.ok(swarmManageToolDefinition.description);
    assert.ok(swarmManageToolDefinition.parameters);
  });

  it('should have object-type parameters (参数应为 object 类型)', () => {
    assert.equal(swarmManageToolDefinition.parameters.type, 'object');
    assert.ok(swarmManageToolDefinition.parameters.properties.action);
  });

  it('should require action param (应要求 action 参数)', () => {
    assert.deepEqual(swarmManageToolDefinition.parameters.required, ['action']);
  });
});

// ===========================================================================
// createSwarmManageHandler — 蜂群管理处理函数 / Swarm Manage Handler
// ===========================================================================

describe('createSwarmManageHandler', () => {
  let handler;

  beforeEach(() => {
    const mockEngines = {
      monitor: {
        getTaskStatus: (taskId) => ({ taskId, status: 'running' }),
        listTasks: (filter) => [{ id: 't1', status: filter || 'all' }],
        getReport: (taskId) => ({ taskId, report: 'done' }),
      },
    };
    handler = createSwarmManageHandler(mockEngines, {}, { info: () => {} });
  });

  it('should return a function (返回一个函数)', () => {
    assert.equal(typeof handler, 'function');
  });

  it('should handle status action with taskId (处理带 taskId 的 status 动作)', () => {
    const result = handler({ action: 'status', taskId: 't1' });
    assert.equal(result.taskId, 't1');
    assert.equal(result.status, 'running');
  });

  it('should require taskId for status action (status 动作需要 taskId)', () => {
    const result = handler({ action: 'status' });
    assert.ok(result.error);
    assert.ok(result.error.includes('taskId'));
  });

  it('should handle list action (处理 list 动作)', () => {
    const result = handler({ action: 'list' });
    assert.ok(result.tasks);
    assert.equal(result.tasks.length, 1);
  });

  it('should handle report action (处理 report 动作)', () => {
    const result = handler({ action: 'report', taskId: 't1' });
    assert.equal(result.taskId, 't1');
  });

  it('should fail for unknown action (未知动作应失败)', () => {
    const result = handler({ action: 'unknown' });
    assert.ok(result.error);
    assert.ok(result.error.includes('Unknown action'));
  });
});
