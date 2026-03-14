/**
 * GossipProtocol V6.2 单元测试 / GossipProtocol V6.2 Unit Tests
 *
 * 测试 P2-1/P2-2 新增功能: 记忆共享 (episodicMemory 集成)、
 * 信息素快照同步 (pheromoneEngine 集成)、同步负载构建与合并、
 * sharingPolicy 控制。
 *
 * Tests P2-1/P2-2 new features: memory sharing (episodicMemory integration),
 * pheromone snapshot sync (pheromoneEngine integration), sync payload
 * build & merge, sharingPolicy control.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GossipProtocol } from '../../../src/L2-communication/gossip-protocol.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function createMockBus() {
  return {
    publish: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    on: vi.fn(),
    emit: vi.fn(),
  };
}

function createMockEpisodicMemory() {
  return {
    recall: vi.fn(() => [
      { subject: 's', predicate: 'p', object: 'o', importance: 0.8, eventType: 'action', timestamp: Date.now() },
    ]),
    record: vi.fn(),
  };
}

function createMockPheromoneEngine() {
  return {
    buildSnapshot: vi.fn(() => ({
      pheromones: [
        { type: 'trail', targetScope: '/zone/A', intensity: 0.9, sourceId: 'src-1' },
      ],
    })),
    emitPheromone: vi.fn(),
    read: vi.fn(() => []),
  };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('GossipProtocol P2-1/P2-2 (V6.2)', () => {
  let messageBus;
  let episodicMemory;
  let pheromoneEngine;
  let gp;

  beforeEach(() => {
    messageBus = createMockBus();
    episodicMemory = createMockEpisodicMemory();
    pheromoneEngine = createMockPheromoneEngine();
    gp = new GossipProtocol({
      messageBus,
      logger: silentLogger,
      fanout: 2,
      episodicMemory,
      pheromoneEngine,
    });
  });

  // ━━━ 1. 构造函数接受新依赖 / Constructor accepts new dependencies ━━━

  it('should accept episodicMemory and pheromoneEngine in constructor', () => {
    expect(gp).toBeInstanceOf(GossipProtocol);
    // 内部引用应存在 / Internal references should exist
    expect(gp._episodicMemory).toBe(episodicMemory);
    expect(gp._pheromoneEngine).toBe(pheromoneEngine);
  });

  // ━━━ 2. getSyncStats 初始值 / Initial sync stats ━━━

  it('getSyncStats should return initial zero stats', () => {
    const syncStats = gp.getSyncStats();
    expect(syncStats.memoriesShared).toBe(0);
    expect(syncStats.memoriesReceived).toBe(0);
    expect(syncStats.pheromonesSync).toBe(0);
  });

  // ━━━ 3. _buildSyncPayload 包含记忆摘要 / Includes memory summaries ━━━

  it('_buildSyncPayload should include memory summaries', () => {
    // 需要先注册 agent 状态, recall 才会被调用 / Need registered agent states for recall to be called
    gp.updateState('agent-1', { role: 'worker' });

    const payload = gp._buildSyncPayload();

    expect(payload).toHaveProperty('memorySummaries');
    expect(Array.isArray(payload.memorySummaries)).toBe(true);
    expect(payload.memorySummaries.length).toBeGreaterThan(0);

    // 验证摘要结构 / Verify summary structure
    const summary = payload.memorySummaries[0];
    expect(summary).toHaveProperty('subject', 's');
    expect(summary).toHaveProperty('predicate', 'p');
    expect(summary).toHaveProperty('importance', 0.8);

    // episodicMemory.recall 应被调用 / episodicMemory.recall should have been called
    expect(episodicMemory.recall).toHaveBeenCalled();
  });

  // ━━━ 4. _buildSyncPayload 包含信息素快照 / Includes pheromone snapshot ━━━

  it('_buildSyncPayload should include pheromone snapshot', () => {
    const payload = gp._buildSyncPayload();

    expect(payload).toHaveProperty('pheromoneSnapshot');
    expect(Array.isArray(payload.pheromoneSnapshot)).toBe(true);
    expect(payload.pheromoneSnapshot.length).toBeGreaterThan(0);

    // 验证快照结构 / Verify snapshot structure
    const ph = payload.pheromoneSnapshot[0];
    expect(ph.type).toBe('trail');
    expect(ph.targetScope).toBe('/zone/A');
    expect(ph.intensity).toBe(0.9);
    expect(ph.sourceId).toBe('src-1');

    // pheromoneEngine.buildSnapshot 应被调用 / pheromoneEngine.buildSnapshot should have been called
    expect(pheromoneEngine.buildSnapshot).toHaveBeenCalled();
  });

  // ━━━ 5. _mergeSyncPayload 合并记忆摘要 / Merge memory summaries ━━━

  it('_mergeSyncPayload should merge memory summaries', () => {
    // 模拟 recall 返回空 (无重复) / Mock recall returns empty (no duplicates)
    episodicMemory.recall.mockReturnValue([]);

    const remoteSyncPayload = {
      memorySummaries: [
        { subject: 'remote-s', predicate: 'remote-p', object: 'remote-o', importance: 0.7, eventType: 'observation', agentId: 'remote-agent' },
      ],
      pheromoneSnapshot: [],
    };

    gp._mergeSyncPayload(remoteSyncPayload);

    // 应调用 episodicMemory.record 注入新记忆 / Should call episodicMemory.record to inject
    expect(episodicMemory.record).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'remote-s',
        predicate: 'remote-p',
        object: 'remote-o',
      }),
    );

    // 同步统计应更新 / Sync stats should update
    const syncStats = gp.getSyncStats();
    expect(syncStats.memoriesReceived).toBe(1);
  });

  // ━━━ 6. _mergeSyncPayload 信息素 max 策略 / Pheromone max merge strategy ━━━

  it('_mergeSyncPayload should merge pheromone snapshots with max strategy', () => {
    // 本地无同类信息素 / No local pheromone of same type
    pheromoneEngine.read.mockReturnValue([]);

    const remoteSyncPayload = {
      memorySummaries: [],
      pheromoneSnapshot: [
        { type: 'trail', targetScope: '/zone/B', intensity: 0.7, sourceId: 'remote-src' },
      ],
    };

    gp._mergeSyncPayload(remoteSyncPayload);

    // 远程浓度 0.7 > 本地 0 → 应 emitPheromone / Remote 0.7 > local 0 -> should emit
    expect(pheromoneEngine.emitPheromone).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'trail',
        targetScope: '/zone/B',
        intensity: 0.7, // 差值 = 0.7 - 0 / Delta = 0.7 - 0
      }),
    );

    const syncStats = gp.getSyncStats();
    expect(syncStats.pheromonesSync).toBe(1);
  });

  // ━━━ 7. broadcast 包含同步负载 / Broadcast includes sync payload ━━━

  it('broadcast should include sync payload', () => {
    gp.updateState('sender', { role: 'coordinator' });
    gp.updateState('receiver-1', { role: 'worker' });

    gp.broadcast('sender', { hello: 1 });

    // messageBus.publish 应被调用, 带 syncPayload / Should publish with syncPayload
    expect(messageBus.publish).toHaveBeenCalledWith(
      'gossip.broadcast',
      expect.objectContaining({
        senderId: 'sender',
        message: { hello: 1 },
        syncPayload: expect.objectContaining({
          memorySummaries: expect.any(Array),
          pheromoneSnapshot: expect.any(Array),
        }),
      }),
      expect.any(Object),
    );
  });

  // ━━━ 8. sharingPolicy=none 禁用同步 / Disable sync with policy=none ━━━

  it('sharingPolicy=none should disable sync', () => {
    const gpNoSync = new GossipProtocol({
      messageBus,
      logger: silentLogger,
      fanout: 2,
      episodicMemory,
      pheromoneEngine,
      config: { sharingPolicy: 'none' },
    });

    gpNoSync.updateState('sender', {});
    gpNoSync.updateState('receiver', {});
    gpNoSync.broadcast('sender', { data: 1 });

    // 广播时不应包含 syncPayload / Broadcast should NOT include syncPayload
    const publishCalls = messageBus.publish.mock.calls.filter(c => c[0] === 'gossip.broadcast');
    expect(publishCalls.length).toBe(1);
    const broadcastData = publishCalls[0][1];
    expect(broadcastData).not.toHaveProperty('syncPayload');

    // _mergeSyncPayload 也不应生效 / Merge should also be disabled
    const initialReceived = gpNoSync.getSyncStats().memoriesReceived;
    gpNoSync.mergeState('remote-agent', { x: 1 }, 99, {
      memorySummaries: [{ subject: 's', predicate: 'p', importance: 0.5 }],
      pheromoneSnapshot: [],
    });
    expect(gpNoSync.getSyncStats().memoriesReceived).toBe(initialReceived);

    gpNoSync.destroy();
  });
});
