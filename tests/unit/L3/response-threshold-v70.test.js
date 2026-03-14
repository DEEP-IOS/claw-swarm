/**
 * ResponseThreshold V7.0 增量测试 / ResponseThreshold V7.0 Incremental Tests
 *
 * V7.0 L3: 闭环执行 actuate() 方法测试
 * V7.0 L3: Closed-loop actuation via actuate() method
 *
 * @author DEEP-IOS
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ResponseThreshold } from '../../../src/L3-agent/response-threshold.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** 模拟 MessageBus / Mock MessageBus */
function createMockBus() {
  const published = [];
  return {
    publish(topic, data) { published.push({ topic, data }); },
    subscribe(topic, handler) { return () => {}; },
    _published: published,
  };
}

/**
 * 创建模拟 relayClient / Create mock relay client
 *
 * @param {Object} [overrides]
 * @returns {Object}
 */
function createMockRelayClient(overrides = {}) {
  return {
    patchSession: async (sessionKey, patch) => {
      return { status: 'ok', sessionKey, patch };
    },
    ...overrides,
  };
}

/** 可用模型列表 (按成本升序) / Available models (ascending cost) */
const AVAILABLE_MODELS = [
  { id: 'haiku', costPerKToken: 0.25 },
  { id: 'sonnet', costPerKToken: 3.0 },
  { id: 'opus', costPerKToken: 15.0 },
];

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('ResponseThreshold V7.0 — actuate()', () => {
  let threshold;
  let messageBus;

  beforeEach(() => {
    messageBus = createMockBus();
    threshold = new ResponseThreshold({
      messageBus,
      db: null,
      logger: silentLogger,
      config: {},
    });
  });

  // ━━━ 1. 无 relayClient 时提前返回 / Returns early if no relayClient ━━━
  describe('no relayClient / insufficient resources', () => {
    it('relayClient 为 null 时返回 no_op / returns no_op when relayClient is null', async () => {
      // 初始化阈值数据 / Initialize threshold data
      threshold.getThreshold('agent-1', 'coding');

      const result = await threshold.actuate('agent-1', 'session-key', null, AVAILABLE_MODELS);
      expect(result.action).toBe('no_op');
      expect(result.reason).toBe('insufficient_resources');
    });

    it('relayClient 无 patchSession 方法时返回 no_op / returns no_op when relayClient lacks patchSession', async () => {
      threshold.getThreshold('agent-1', 'coding');

      const result = await threshold.actuate('agent-1', 'session-key', {}, AVAILABLE_MODELS);
      expect(result.action).toBe('no_op');
      expect(result.reason).toBe('insufficient_resources');
    });

    it('sessionKey 为空时返回 no_op / returns no_op when sessionKey is empty', async () => {
      threshold.getThreshold('agent-1', 'coding');
      const client = createMockRelayClient();

      const result = await threshold.actuate('agent-1', '', client, AVAILABLE_MODELS);
      expect(result.action).toBe('no_op');
    });

    it('模型列表不足 2 个时返回 no_op / returns no_op when fewer than 2 models', async () => {
      threshold.getThreshold('agent-1', 'coding');
      const client = createMockRelayClient();

      const result = await threshold.actuate('agent-1', 'session-key', client, [{ id: 'solo' }]);
      expect(result.action).toBe('no_op');
    });
  });

  // ━━━ 2. 低阈值映射到强模型 / Low threshold maps to strong model ━━━
  describe('low threshold maps to strong model', () => {
    it('低阈值 agent 应选择高索引 (昂贵) 模型 / low threshold agent should select high-index (expensive) model', async () => {
      // 制造低阈值: 低活跃率多次调整 → 阈值下降
      // Create low threshold: low activity rate adjustments → threshold drops
      threshold.getThreshold('agent-low', 'coding');
      for (let i = 0; i < 30; i++) {
        threshold.adjust('agent-low', 'coding', 0.0);
      }

      const avgThreshold = threshold.getThreshold('agent-low', 'coding');
      expect(avgThreshold).toBeLessThan(0.3);

      const client = createMockRelayClient();
      const result = await threshold.actuate('agent-low', 'session-1', client, AVAILABLE_MODELS);

      expect(result.action).toBe('model_switch');
      // 低阈值 → 高索引 → opus (最强模型)
      expect(result.model).toBe('opus');
    });
  });

  // ━━━ 3. 高阈值映射到便宜模型 / High threshold maps to cheap model ━━━
  describe('high threshold maps to cheap model', () => {
    it('高阈值 agent 应选择低索引 (便宜) 模型 / high threshold agent should select low-index (cheap) model', async () => {
      // 制造高阈值: 高活跃率多次调整 → 阈值上升
      // Create high threshold: high activity rate adjustments → threshold rises
      threshold.getThreshold('agent-high', 'coding');
      for (let i = 0; i < 30; i++) {
        threshold.adjust('agent-high', 'coding', 1.0);
      }

      const avgThreshold = threshold.getThreshold('agent-high', 'coding');
      expect(avgThreshold).toBeGreaterThan(0.7);

      const client = createMockRelayClient();
      const result = await threshold.actuate('agent-high', 'session-2', client, AVAILABLE_MODELS);

      expect(result.action).toBe('model_switch');
      // 高阈值 → 低索引 → haiku (最便宜模型)
      expect(result.model).toBe('haiku');
    });
  });

  // ━━━ 4. patchSession 被正确调用 / patchSession called correctly ━━━
  describe('patchSession call', () => {
    it('使用正确的 model 参数调用 patchSession / calls patchSession with correct model', async () => {
      // 初始化 agent 阈值 (默认 0.5) / Initialize agent threshold (default 0.5)
      threshold.getThreshold('agent-mid', 'coding');

      let patchedArgs = null;
      const client = createMockRelayClient({
        patchSession: async (sessionKey, patch) => {
          patchedArgs = { sessionKey, patch };
          return { status: 'ok' };
        },
      });

      const result = await threshold.actuate('agent-mid', 'my-session', client, AVAILABLE_MODELS);

      expect(result.action).toBe('model_switch');
      expect(patchedArgs).not.toBeNull();
      expect(patchedArgs.sessionKey).toBe('my-session');
      expect(patchedArgs.patch).toHaveProperty('model');
      expect(typeof patchedArgs.patch.model).toBe('string');
    });

    it('patchSession 失败时返回 actuate_failed / returns actuate_failed on patchSession error', async () => {
      threshold.getThreshold('agent-err', 'coding');

      const client = createMockRelayClient({
        patchSession: async () => { throw new Error('network timeout'); },
      });

      const result = await threshold.actuate('agent-err', 'session-err', client, AVAILABLE_MODELS);
      expect(result.action).toBe('actuate_failed');
      expect(result.error).toBe('network timeout');
    });
  });

  // ━━━ 5. 无阈值数据 / No threshold data ━━━
  describe('no threshold data', () => {
    it('未注册 agent 返回 no_op / returns no_op for unregistered agent', async () => {
      const client = createMockRelayClient();
      const result = await threshold.actuate('unknown-agent', 'session-x', client, AVAILABLE_MODELS);

      expect(result.action).toBe('no_op');
      expect(result.reason).toBe('no_threshold_data');
    });
  });
});
