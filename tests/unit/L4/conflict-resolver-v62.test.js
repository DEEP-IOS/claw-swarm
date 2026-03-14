/**
 * ConflictResolver V6.2 单元测试 / ConflictResolver V6.2 Unit Tests
 *
 * 无需真实数据库, 使用 mock 测试三级冲突解决机制。
 * No real DB needed, uses mocks to test three-level conflict resolution.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictResolver } from '../../../src/L4-orchestration/conflict-resolver.js';

// 静默 logger / Silent logger
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

describe('ConflictResolver', () => {
  let resolver;
  let messageBus;
  let reputationLedger;

  beforeEach(() => {
    messageBus = {
      publish: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    };

    reputationLedger = {
      computeTrust: vi.fn((agentId) => {
        if (agentId === 'agent-high') return 900;
        if (agentId === 'agent-mid') return 500;
        return 100;
      }),
      getLeaderboard: vi.fn(() => [{ agentId: 'agent-high', trust: 900 }]),
    };

    resolver = new ConflictResolver({
      messageBus,
      reputationLedger,
      logger: silentLogger,
    });
  });

  // ━━━ 1. 构造实例 / Instance creation ━━━

  it('should create ConflictResolver instance', () => {
    expect(resolver).toBeDefined();
    expect(resolver).toBeInstanceOf(ConflictResolver);
  });

  // ━━━ 2. P2P 协商 — 高分胜出 / P2P negotiation — 2-agent conflict ━━━

  it('should resolve 2-agent conflict via P2P negotiation', () => {
    const result = resolver.resolveConflict({
      conflictId: 'cf-1',
      resourceId: 'res-1',
      contestants: [
        { agentId: 'agent-high', bidScore: 80 },
        { agentId: 'agent-mid', bidScore: 60 },
      ],
      context: { taskId: 'task-1' },
    });

    expect(result.resolved).toBe(true);
    expect(result.winnerId).toBe('agent-high');
    expect(result.level).toBe('p2p');
    expect(result.reason).toBe('higher_bid_score');
  });

  // ━━━ 3. P2P 高投标分胜出 / P2P picks higher bidScore ━━━

  it('P2P should pick higher bidScore', () => {
    const result = resolver.resolveConflict({
      conflictId: 'cf-bid',
      resourceId: 'res-bid',
      contestants: [
        { agentId: 'agent-mid', bidScore: 95 },
        { agentId: 'agent-high', bidScore: 40 },
      ],
    });

    expect(result.resolved).toBe(true);
    // agent-mid has higher bidScore even though lower trust
    expect(result.winnerId).toBe('agent-mid');
    expect(result.level).toBe('p2p');
    expect(result.reason).toBe('higher_bid_score');
  });

  // ━━━ 4. P2P 平分时 trust 作为 tiebreaker / P2P trust tiebreaker ━━━

  it('P2P should use trust as tiebreaker when scores equal', () => {
    const result = resolver.resolveConflict({
      conflictId: 'cf-tie',
      resourceId: 'res-tie',
      contestants: [
        { agentId: 'agent-mid', bidScore: 50 },
        { agentId: 'agent-high', bidScore: 50 },
      ],
    });

    expect(result.resolved).toBe(true);
    // agent-high has trust 900 vs agent-mid trust 500
    expect(result.winnerId).toBe('agent-high');
    expect(result.level).toBe('p2p');
    expect(result.reason).toBe('trust_tiebreaker');
  });

  // ━━━ 5. P2P 失败, 升级到投票 / Escalate to voting when P2P fails ━━━

  it('should escalate to voting when P2P fails', () => {
    // 两个 trust 相同的 agent, bidScore 也相同 -> P2P 完全平局 -> 升级
    // Two agents with same trust and same bidScore -> complete tie -> escalate
    const sameTrustLedger = {
      computeTrust: vi.fn(() => 500),
      getLeaderboard: vi.fn(() => []),
    };

    const escalateResolver = new ConflictResolver({
      messageBus,
      reputationLedger: sameTrustLedger,
      logger: silentLogger,
      config: { maxVotingRounds: 3 },
    });

    const result = escalateResolver.resolveConflict({
      conflictId: 'cf-escalate',
      resourceId: 'res-esc',
      contestants: [
        { agentId: 'agent-x', bidScore: 50 },
        { agentId: 'agent-y', bidScore: 50 },
      ],
    });

    expect(result.resolved).toBe(true);
    // Should have escalated past P2P
    expect(result.level).not.toBe('p2p');
  });

  // ━━━ 6. 加权投票 2/3 多数通过 / Weighted voting 2/3 majority ━━━

  it('weighted voting should select agent with 2/3 majority', () => {
    // 3 个竞争者: agent-high (trust 900) 投自己, agent-mid (trust 500) 投 agent-high (highest bidScore),
    // agent-low (trust 100) 投 agent-high (highest bidScore)
    // agent-high 加权票: 900 + 500 + 100 = 1500 (全部), 占 100% > 2/3
    const result = resolver.resolveConflict({
      conflictId: 'cf-vote',
      resourceId: 'res-vote',
      contestants: [
        { agentId: 'agent-high', bidScore: 90 },
        { agentId: 'agent-mid', bidScore: 70 },
        { agentId: 'agent-low', bidScore: 30 },
      ],
    });

    expect(result.resolved).toBe(true);
    expect(result.winnerId).toBe('agent-high');
    // 3 contestants skips P2P (only for exactly 2), goes straight to voting
    expect(result.level).toBe('weighted_vote');
  });

  // ━━━ 7. 投票失败升级到仲裁 / Escalate to arbitration when voting fails ━━━

  it('should escalate to arbitration when voting fails', () => {
    // 所有 agent trust 相同, 都投自己 -> 无法达到 2/3 多数 -> 仲裁
    // All agents same trust, all vote for self -> no 2/3 majority -> arbitration
    const equalTrustLedger = {
      computeTrust: vi.fn(() => 100),
      getLeaderboard: vi.fn(() => []),
    };

    const arbResolver = new ConflictResolver({
      messageBus,
      reputationLedger: equalTrustLedger,
      logger: silentLogger,
      config: { maxVotingRounds: 1 },
    });

    const result = arbResolver.resolveConflict({
      conflictId: 'cf-arb',
      resourceId: 'res-arb',
      contestants: [
        { agentId: 'a1', bidScore: 50 },
        { agentId: 'a2', bidScore: 50 },
        { agentId: 'a3', bidScore: 50 },
      ],
    });

    expect(result.resolved).toBe(true);
    expect(result.level).toBe('reputation_arbitration');
  });

  // ━━━ 8. 仲裁选择最高 trust / Arbitration picks highest trust ━━━

  it('arbitration should pick highest trust agent', () => {
    // 强制进入仲裁: 所有 agent trust 相同让投票无法达成共识
    // Force arbitration: all agents same trust so voting can't reach consensus
    const equalTrustLedger = {
      computeTrust: vi.fn(() => 100),
      getLeaderboard: vi.fn(() => []),
    };

    const arbResolver = new ConflictResolver({
      messageBus,
      reputationLedger: equalTrustLedger,
      logger: silentLogger,
      config: { maxVotingRounds: 1 },
    });

    // bidScore 不同, 仲裁者选择最高 bidScore 的 agent
    // Different bidScores, arbiter selects highest bidScore agent
    const result = arbResolver.resolveConflict({
      conflictId: 'cf-arb-pick',
      resourceId: 'res-arb-pick',
      contestants: [
        { agentId: 'a1', bidScore: 30 },
        { agentId: 'a2', bidScore: 90 },
        { agentId: 'a3', bidScore: 50 },
      ],
    });

    expect(result.resolved).toBe(true);
    expect(result.winnerId).toBe('a2');
    expect(result.level).toBe('reputation_arbitration');
  });

  // ━━━ 9~12. 事件发布 / Event publishing ━━━

  it('should publish conflict.detected event', () => {
    resolver.resolveConflict({
      conflictId: 'cf-ev-det',
      resourceId: 'res-ev',
      contestants: [
        { agentId: 'agent-high', bidScore: 80 },
        { agentId: 'agent-mid', bidScore: 60 },
      ],
    });

    const detectedCalls = messageBus.publish.mock.calls.filter(
      ([topic]) => topic === 'conflict.detected',
    );
    expect(detectedCalls.length).toBeGreaterThanOrEqual(1);

    const payload = detectedCalls[0][1].payload;
    expect(payload.conflictId).toBe('cf-ev-det');
    expect(payload.contestants).toEqual(['agent-high', 'agent-mid']);
  });

  it('should publish conflict.resolved event', () => {
    resolver.resolveConflict({
      conflictId: 'cf-ev-res',
      resourceId: 'res-ev-2',
      contestants: [
        { agentId: 'agent-high', bidScore: 80 },
        { agentId: 'agent-mid', bidScore: 60 },
      ],
    });

    const resolvedCalls = messageBus.publish.mock.calls.filter(
      ([topic]) => topic === 'conflict.resolved',
    );
    expect(resolvedCalls.length).toBeGreaterThanOrEqual(1);

    const payload = resolvedCalls[0][1].payload;
    expect(payload.conflictId).toBe('cf-ev-res');
    expect(payload.winnerId).toBe('agent-high');
    expect(payload.level).toBe('p2p');
  });

  it('should publish conflict.escalated event', () => {
    // 制造 P2P 平局, 触发升级事件 / Create P2P tie to trigger escalation event
    const sameTrustLedger = {
      computeTrust: vi.fn(() => 500),
      getLeaderboard: vi.fn(() => []),
    };

    const escResolver = new ConflictResolver({
      messageBus,
      reputationLedger: sameTrustLedger,
      logger: silentLogger,
    });

    escResolver.resolveConflict({
      conflictId: 'cf-ev-esc',
      resourceId: 'res-ev-3',
      contestants: [
        { agentId: 'agent-a', bidScore: 50 },
        { agentId: 'agent-b', bidScore: 50 },
      ],
    });

    const escalatedCalls = messageBus.publish.mock.calls.filter(
      ([topic]) => topic === 'conflict.escalated',
    );
    expect(escalatedCalls.length).toBeGreaterThanOrEqual(1);

    const payload = escalatedCalls[0][1].payload;
    expect(payload.conflictId).toBe('cf-ev-esc');
    expect(payload.fromLevel).toBe('p2p');
    expect(payload.toLevel).toBe('weighted_vote');
  });

  it('should publish consensus.vote.started event', () => {
    // 3 个竞争者会跳过 P2P, 直接进入投票 / 3 contestants skip P2P, go to voting
    resolver.resolveConflict({
      conflictId: 'cf-ev-vote',
      resourceId: 'res-ev-4',
      contestants: [
        { agentId: 'agent-high', bidScore: 90 },
        { agentId: 'agent-mid', bidScore: 70 },
        { agentId: 'agent-low', bidScore: 30 },
      ],
    });

    const voteStartedCalls = messageBus.publish.mock.calls.filter(
      ([topic]) => topic === 'consensus.vote.started',
    );
    expect(voteStartedCalls.length).toBeGreaterThanOrEqual(1);

    const payload = voteStartedCalls[0][1].payload;
    expect(payload.conflictId).toBe('cf-ev-vote');
    expect(payload.round).toBe(1);
    expect(payload.candidateIds).toContain('agent-high');
  });

  // ━━━ 13. 统计跟踪 / Statistics tracking ━━━

  it('should track resolution statistics', () => {
    // 解决两个冲突 / Resolve two conflicts
    resolver.resolveConflict({
      conflictId: 'cf-s1',
      resourceId: 'res-s1',
      contestants: [
        { agentId: 'agent-high', bidScore: 80 },
        { agentId: 'agent-mid', bidScore: 60 },
      ],
    });
    resolver.resolveConflict({
      conflictId: 'cf-s2',
      resourceId: 'res-s2',
      contestants: [
        { agentId: 'agent-high', bidScore: 70 },
        { agentId: 'agent-low', bidScore: 30 },
      ],
    });

    const stats = resolver.getStats();
    expect(stats.totalConflicts).toBe(2);
  });

  // ━━━ 14. getStats 各级别计数 / getStats counts per level ━━━

  it('getStats should return correct counts per level', () => {
    // P2P 解决 / P2P resolution
    resolver.resolveConflict({
      conflictId: 'cf-lv1',
      resourceId: 'res-lv1',
      contestants: [
        { agentId: 'agent-high', bidScore: 80 },
        { agentId: 'agent-mid', bidScore: 60 },
      ],
    });

    const stats = resolver.getStats();
    expect(stats.resolutionCounts.p2p).toBeGreaterThanOrEqual(1);
    expect(stats.averageElapsedMs).toBeDefined();
    expect(stats.votingRoundsDistribution).toBeDefined();
  });

  // ━━━ 15. 单个竞争者 / Single contestant ━━━

  it('should handle single contestant gracefully', () => {
    const result = resolver.resolveConflict({
      conflictId: 'cf-single',
      resourceId: 'res-single',
      contestants: [{ agentId: 'agent-solo', bidScore: 100 }],
    });

    // 少于 2 个竞争者, 应返回 resolved: false
    // Fewer than 2 contestants, should return resolved: false
    expect(result.resolved).toBe(false);
    expect(result.winnerId).toBeNull();
    expect(result.reason).toBe('insufficient_contestants');
  });
});
