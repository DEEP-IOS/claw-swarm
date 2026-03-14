/**
 * ConflictResolver -- 冲突解决器 + 共识投票 / Conflict Resolver + Consensus Voting
 *
 * 审计优化路线图 P1-2 + P3-1 实现。
 * Audit optimization roadmap P1-2 + P3-1 implementation.
 *
 * 三级冲突解决机制 / Three-level conflict resolution:
 *   Level 1: P2P 协商 — 双方交换投标分数, 高分胜出
 *            P2P Negotiation — two agents exchange bid scores, higher wins
 *   Level 2: 加权投票 — 所有相关 Agent 按 trust 加权投票, 2/3 多数通过, 多轮共识 (P3-1)
 *            Weighted Voting — all related agents vote weighted by trust, 2/3 majority, multi-round (P3-1)
 *   Level 3: 声誉仲裁 — 最高 trust 的 Agent 仲裁
 *            Reputation Arbitration — highest trust agent arbitrates
 *
 * 冲突对象格式 / Conflict object shape:
 *   {
 *     conflictId: string,
 *     resourceId: string,
 *     contestants: [{ agentId, bidScore }],
 *     context: { cfpId?, taskId? }
 *   }
 *
 * @module L4-orchestration/conflict-resolver
 * @version 6.2.0
 * @author DEEP-IOS
 */

import { nanoid } from 'nanoid';
import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 解决级别枚举 / Resolution level enum */
const ResolutionLevel = Object.freeze({
  P2P: 'p2p',
  WEIGHTED_VOTE: 'weighted_vote',
  REPUTATION_ARBITRATION: 'reputation_arbitration',
});

/** 默认 P2P 超时 (ms) / Default P2P timeout */
const DEFAULT_P2P_TIMEOUT_MS = 3000;

/** 默认最大投票轮数 / Default max voting rounds */
const DEFAULT_MAX_VOTING_ROUNDS = 3;

/** 默认多数门槛 (2/3) / Default majority threshold */
const DEFAULT_MAJORITY_THRESHOLD = 0.667;

/** 组件标识 / Component source identifier */
const SOURCE = 'ConflictResolver';

// ============================================================================
// ConflictResolver 类 / ConflictResolver Class
// ============================================================================

export class ConflictResolver {
  /**
   * @param {Object} deps - 依赖注入 / Dependency injection
   * @param {Object} deps.messageBus - MessageBus 实例 / MessageBus instance
   * @param {Object} deps.reputationLedger - ReputationLedger 实例 / ReputationLedger instance
   * @param {Object} deps.logger - 日志器 / Logger
   * @param {Object} [deps.config] - 配置项 / Configuration
   * @param {number} [deps.config.maxVotingRounds=3] - 最大投票轮数 / Max voting rounds
   * @param {number} [deps.config.majorityThreshold=0.667] - 多数门槛 / Majority threshold
   * @param {number} [deps.config.p2pTimeoutMs=3000] - P2P 超时 / P2P timeout
   */
  constructor({ messageBus, reputationLedger, logger, config = {} }) {
    /** @private */
    this._messageBus = messageBus;
    /** @private */
    this._reputationLedger = reputationLedger;
    /** @private */
    this._logger = logger || console;

    /** @private 最大投票轮数 / Max voting rounds */
    this._maxVotingRounds = config.maxVotingRounds ?? DEFAULT_MAX_VOTING_ROUNDS;
    /** @private 多数门槛 / Majority threshold */
    this._majorityThreshold = config.majorityThreshold ?? DEFAULT_MAJORITY_THRESHOLD;
    /** @private P2P 超时 (ms) / P2P timeout */
    this._p2pTimeoutMs = config.p2pTimeoutMs ?? DEFAULT_P2P_TIMEOUT_MS;

    // ── 统计信息 / Statistics ──

    /** @private 各级别解决计数 / Resolution count by level */
    this._resolutionCounts = {
      [ResolutionLevel.P2P]: 0,
      [ResolutionLevel.WEIGHTED_VOTE]: 0,
      [ResolutionLevel.REPUTATION_ARBITRATION]: 0,
    };

    /** @private 总冲突数 / Total conflicts processed */
    this._totalConflicts = 0;

    /** @private 各级别累计耗时 (ms) / Cumulative elapsed time by level */
    this._totalElapsedMs = {
      [ResolutionLevel.P2P]: 0,
      [ResolutionLevel.WEIGHTED_VOTE]: 0,
      [ResolutionLevel.REPUTATION_ARBITRATION]: 0,
    };

    /** @private 投票轮数分布 / Voting rounds distribution */
    this._votingRoundsDistribution = new Map();
  }

  // --------------------------------------------------------------------------
  // 主入口 / Main Entry
  // --------------------------------------------------------------------------

  /**
   * 解决冲突 — 依次尝试三级解决机制, 逐级升级
   * Resolve conflict — escalates through 3 levels sequentially
   *
   * @param {Object} conflict - 冲突对象 / Conflict object
   * @param {string} conflict.conflictId - 冲突 ID
   * @param {string} conflict.resourceId - 争夺的资源 ID / Contested resource ID
   * @param {Array<{agentId: string, bidScore: number}>} conflict.contestants - 竞争者列表 / Contestants
   * @param {Object} [conflict.context] - 上下文 / Context (cfpId, taskId)
   * @returns {Object} 解决结果 / Resolution result
   */
  resolveConflict(conflict) {
    const startTime = Date.now();
    this._totalConflicts++;

    const conflictId = conflict.conflictId || `cf_${nanoid(12)}`;
    const normalizedConflict = { ...conflict, conflictId };

    this._logger.info(
      { conflictId, resourceId: conflict.resourceId, contestants: conflict.contestants.length },
      'conflict detected / 冲突已检测',
    );

    // 发布冲突检测事件 / Publish conflict detected event
    this._publish('conflict.detected', {
      conflictId,
      resourceId: conflict.resourceId,
      contestants: conflict.contestants.map(c => c.agentId),
      context: conflict.context || {},
    });

    // ── 参数校验 / Parameter validation ──
    if (!conflict.contestants || conflict.contestants.length < 2) {
      this._logger.warn({ conflictId }, 'conflict requires at least 2 contestants / 冲突至少需要 2 个竞争者');
      return this._buildResult(normalizedConflict, null, 'invalid', 'insufficient_contestants', 0);
    }

    // ── Level 1: P2P 协商 / P2P Negotiation ──
    if (conflict.contestants.length === 2) {
      const [a, b] = conflict.contestants;
      const p2pResult = this._negotiateP2P(a.agentId, b.agentId, a.bidScore, b.bidScore);

      if (p2pResult.resolved) {
        const elapsed = Date.now() - startTime;
        this._recordResolution(ResolutionLevel.P2P, elapsed);

        this._logger.info(
          { conflictId, winner: p2pResult.winnerId, level: ResolutionLevel.P2P },
          'conflict resolved via P2P / 冲突通过 P2P 协商解决',
        );

        this._publish('conflict.resolved', {
          conflictId,
          resourceId: conflict.resourceId,
          winnerId: p2pResult.winnerId,
          level: ResolutionLevel.P2P,
          reason: p2pResult.reason,
          elapsedMs: elapsed,
        });

        return this._buildResult(normalizedConflict, p2pResult.winnerId, ResolutionLevel.P2P, p2pResult.reason, elapsed);
      }

      // P2P 平局, 升级 / P2P tie, escalate
      this._logger.info(
        { conflictId },
        'P2P negotiation tied, escalating to weighted vote / P2P 协商平局, 升级到加权投票',
      );
      this._publish('conflict.escalated', {
        conflictId,
        fromLevel: ResolutionLevel.P2P,
        toLevel: ResolutionLevel.WEIGHTED_VOTE,
        reason: 'p2p_tie',
      });
    }

    // ── Level 2: 加权投票 (P3-1 共识投票) / Weighted Voting (P3-1 Consensus Voting) ──
    const voters = conflict.contestants;
    const voteResult = this._weightedVote(normalizedConflict, voters);

    if (voteResult.resolved) {
      const elapsed = Date.now() - startTime;
      this._recordResolution(ResolutionLevel.WEIGHTED_VOTE, elapsed);
      this._recordVotingRounds(voteResult.roundsUsed);

      this._logger.info(
        { conflictId, winner: voteResult.winnerId, rounds: voteResult.roundsUsed, level: ResolutionLevel.WEIGHTED_VOTE },
        'conflict resolved via weighted vote / 冲突通过加权投票解决',
      );

      this._publish('conflict.resolved', {
        conflictId,
        resourceId: conflict.resourceId,
        winnerId: voteResult.winnerId,
        level: ResolutionLevel.WEIGHTED_VOTE,
        roundsUsed: voteResult.roundsUsed,
        voteDetails: voteResult.details,
        elapsedMs: elapsed,
      });

      return this._buildResult(
        normalizedConflict, voteResult.winnerId, ResolutionLevel.WEIGHTED_VOTE,
        `consensus_round_${voteResult.roundsUsed}`, Date.now() - startTime,
        { roundsUsed: voteResult.roundsUsed, voteDetails: voteResult.details },
      );
    }

    // 投票未达共识, 升级到仲裁 / Vote did not reach consensus, escalate to arbitration
    this._logger.info(
      { conflictId, rounds: voteResult.roundsUsed },
      'weighted vote failed to reach consensus, escalating to arbitration / 加权投票未达共识, 升级到声誉仲裁',
    );
    this._publish('conflict.escalated', {
      conflictId,
      fromLevel: ResolutionLevel.WEIGHTED_VOTE,
      toLevel: ResolutionLevel.REPUTATION_ARBITRATION,
      reason: 'no_consensus',
      roundsAttempted: voteResult.roundsUsed,
    });

    // ── Level 3: 声誉仲裁 / Reputation Arbitration ──
    const arbitrationResult = this._reputationArbitrate(normalizedConflict, voters);
    const elapsed = Date.now() - startTime;
    this._recordResolution(ResolutionLevel.REPUTATION_ARBITRATION, elapsed);

    this._logger.info(
      { conflictId, winner: arbitrationResult.winnerId, arbiter: arbitrationResult.arbiterId, level: ResolutionLevel.REPUTATION_ARBITRATION },
      'conflict resolved via reputation arbitration / 冲突通过声誉仲裁解决',
    );

    this._publish('conflict.resolved', {
      conflictId,
      resourceId: conflict.resourceId,
      winnerId: arbitrationResult.winnerId,
      level: ResolutionLevel.REPUTATION_ARBITRATION,
      arbiterId: arbitrationResult.arbiterId,
      reason: arbitrationResult.reason,
      elapsedMs: elapsed,
    });

    return this._buildResult(
      normalizedConflict, arbitrationResult.winnerId, ResolutionLevel.REPUTATION_ARBITRATION,
      arbitrationResult.reason, elapsed,
      { arbiterId: arbitrationResult.arbiterId },
    );
  }

  // --------------------------------------------------------------------------
  // Level 1: P2P 协商 / P2P Negotiation
  // --------------------------------------------------------------------------

  /**
   * P2P 协商 — 双方交换投标分数, 高分胜出
   * P2P negotiation — two agents exchange bid scores, higher score wins
   *
   * @param {string} agentA - 第一个 Agent ID / First agent ID
   * @param {string} agentB - 第二个 Agent ID / Second agent ID
   * @param {number} scoreA - Agent A 的投标分数 / Agent A bid score
   * @param {number} scoreB - Agent B 的投标分数 / Agent B bid score
   * @returns {{ resolved: boolean, winnerId?: string, reason: string }}
   */
  _negotiateP2P(agentA, agentB, scoreA, scoreB) {
    this._logger.debug(
      { agentA, agentB, scoreA, scoreB },
      'P2P negotiation started / P2P 协商开始',
    );

    // 分数不同, 高分胜出 / Scores differ, higher wins
    if (scoreA !== scoreB) {
      const winnerId = scoreA > scoreB ? agentA : agentB;
      return {
        resolved: true,
        winnerId,
        reason: 'higher_bid_score',
      };
    }

    // 分数相同时, 使用 trust 作为 tiebreaker / Tie: use trust as tiebreaker
    const trustA = this._getAgentTrust(agentA);
    const trustB = this._getAgentTrust(agentB);

    if (trustA !== trustB) {
      const winnerId = trustA > trustB ? agentA : agentB;
      return {
        resolved: true,
        winnerId,
        reason: 'trust_tiebreaker',
      };
    }

    // 完全平局, 无法在 P2P 级别解决 / Complete tie, cannot resolve at P2P level
    return {
      resolved: false,
      reason: 'exact_tie',
    };
  }

  // --------------------------------------------------------------------------
  // Level 2: 加权投票 (P3-1 共识投票) / Weighted Voting (P3-1 Consensus Voting)
  // --------------------------------------------------------------------------

  /**
   * 加权投票 — 多轮共识投票 (P3-1)
   * Weighted voting — multi-round consensus voting (P3-1)
   *
   * 每轮中, 每个投票者按自身 trust 值加权投票给候选人 (投自己的 bidScore 最高者)。
   * 若某候选人获得 ≥ 2/3 加权票数, 则达成共识; 否则淘汰最低票者进入下一轮。
   *
   * Each round, every voter casts a trust-weighted vote for a candidate.
   * If a candidate receives >= 2/3 weighted votes, consensus is reached.
   * Otherwise, eliminate the lowest-voted candidate and proceed to next round.
   *
   * @param {Object} conflict - 规范化冲突对象 / Normalized conflict object
   * @param {Array<{agentId: string, bidScore: number}>} voters - 投票者列表 / Voter list
   * @returns {{ resolved: boolean, winnerId?: string, roundsUsed: number, details?: Object }}
   */
  _weightedVote(conflict, voters) {
    const { conflictId } = conflict;
    let candidates = [...voters];
    let roundsUsed = 0;

    for (let round = 1; round <= this._maxVotingRounds; round++) {
      roundsUsed = round;

      // 只剩一个候选人, 自动胜出 / Only one candidate left, auto-win
      if (candidates.length <= 1) {
        return {
          resolved: candidates.length === 1,
          winnerId: candidates.length === 1 ? candidates[0].agentId : undefined,
          roundsUsed,
          details: { finalRound: round, method: 'last_standing' },
        };
      }

      this._logger.debug(
        { conflictId, round, candidates: candidates.length },
        'consensus vote round started / 共识投票轮次开始',
      );

      // 发布投票开始事件 / Publish vote started event
      this._publish('consensus.vote.started', {
        conflictId,
        round,
        candidateIds: candidates.map(c => c.agentId),
        voterCount: voters.length,
      });

      // ── 收集加权选票 / Collect weighted ballots ──
      const tally = new Map(); // agentId → weighted vote sum
      let totalWeight = 0;

      for (const candidate of candidates) {
        tally.set(candidate.agentId, 0);
      }

      for (const voter of voters) {
        const trust = this._getAgentTrust(voter.agentId);
        const weight = Math.max(trust, 1); // 最低权重 1 / Minimum weight 1
        totalWeight += weight;

        // 投票策略: 投给 bidScore 最高的候选人 (排除自己以外的考量)
        // Voting strategy: vote for the candidate with the highest bidScore
        const bestCandidate = this._selectVoteTarget(voter, candidates);

        if (bestCandidate && tally.has(bestCandidate.agentId)) {
          tally.set(bestCandidate.agentId, tally.get(bestCandidate.agentId) + weight);
        }
      }

      // ── 检查多数门槛 / Check majority threshold ──
      const threshold = totalWeight * this._majorityThreshold;
      let winner = null;
      let bestWeightedVotes = 0;
      const roundResults = {};

      for (const [agentId, weightedVotes] of tally) {
        const share = totalWeight > 0 ? weightedVotes / totalWeight : 0;
        roundResults[agentId] = {
          weightedVotes,
          share: Math.round(share * 1000) / 1000,
        };

        if (weightedVotes >= threshold && weightedVotes > bestWeightedVotes) {
          winner = agentId;
          bestWeightedVotes = weightedVotes;
        }
      }

      // 发布投票完成事件 / Publish vote completed event
      this._publish('consensus.vote.completed', {
        conflictId,
        round,
        results: roundResults,
        consensusReached: winner !== null,
        winnerId: winner,
        threshold: Math.round(this._majorityThreshold * 1000) / 1000,
      });

      if (winner) {
        return {
          resolved: true,
          winnerId: winner,
          roundsUsed,
          details: { finalRound: round, results: roundResults, method: 'majority_consensus' },
        };
      }

      // ── 未达共识: 淘汰最低得票者 / No consensus: eliminate lowest-voted candidate ──
      let lowestVotes = Infinity;
      let lowestAgentId = null;
      for (const [agentId, weightedVotes] of tally) {
        if (weightedVotes < lowestVotes) {
          lowestVotes = weightedVotes;
          lowestAgentId = agentId;
        }
      }

      if (lowestAgentId) {
        candidates = candidates.filter(c => c.agentId !== lowestAgentId);
        this._logger.debug(
          { conflictId, round, eliminated: lowestAgentId, remaining: candidates.length },
          'candidate eliminated in voting round / 候选人在投票轮次中被淘汰',
        );
      }
    }

    // 所有轮次用尽, 未达共识 / All rounds exhausted, no consensus
    return {
      resolved: false,
      roundsUsed,
      details: { method: 'exhausted' },
    };
  }

  // --------------------------------------------------------------------------
  // Level 3: 声誉仲裁 / Reputation Arbitration
  // --------------------------------------------------------------------------

  /**
   * 声誉仲裁 — 最高 trust 的 Agent 裁决
   * Reputation arbitration — highest trust agent arbitrates
   *
   * 仲裁者选择 bidScore 最高的竞争者; 若 bidScore 相同, 选择 trust 更高者。
   * Arbiter selects contestant with highest bidScore; on tie, selects higher trust.
   *
   * @param {Object} conflict - 规范化冲突对象 / Normalized conflict object
   * @param {Array<{agentId: string, bidScore: number}>} voters - 竞争者列表 / Contestants
   * @returns {{ winnerId: string, arbiterId: string, reason: string }}
   */
  _reputationArbitrate(conflict, voters) {
    // 找到 trust 最高的 Agent 作为仲裁者 / Find agent with highest trust as arbiter
    let arbiterId = null;
    let highestTrust = -1;

    for (const voter of voters) {
      const trust = this._getAgentTrust(voter.agentId);
      if (trust > highestTrust) {
        highestTrust = trust;
        arbiterId = voter.agentId;
      }
    }

    this._logger.debug(
      { conflictId: conflict.conflictId, arbiterId, trust: highestTrust },
      'reputation arbiter selected / 声誉仲裁者已选定',
    );

    // 仲裁者裁决: 选择 bidScore 最高者 / Arbiter decision: select highest bidScore
    let winnerId = null;
    let highestBid = -Infinity;
    let highestBidTrust = -1;

    for (const contestant of voters) {
      const contestantTrust = this._getAgentTrust(contestant.agentId);

      if (
        contestant.bidScore > highestBid ||
        (contestant.bidScore === highestBid && contestantTrust > highestBidTrust)
      ) {
        highestBid = contestant.bidScore;
        highestBidTrust = contestantTrust;
        winnerId = contestant.agentId;
      }
    }

    return {
      winnerId,
      arbiterId,
      reason: 'arbiter_decision',
    };
  }

  // --------------------------------------------------------------------------
  // 统计查询 / Statistics
  // --------------------------------------------------------------------------

  /**
   * 返回解决统计数据 / Returns resolution statistics
   *
   * @returns {Object} 统计数据 / Statistics
   */
  getStats() {
    const avgElapsed = {};
    for (const level of Object.values(ResolutionLevel)) {
      const count = this._resolutionCounts[level];
      avgElapsed[level] = count > 0
        ? Math.round(this._totalElapsedMs[level] / count)
        : 0;
    }

    // 投票轮数分布 / Voting rounds distribution
    const roundsDistribution = {};
    for (const [rounds, count] of this._votingRoundsDistribution) {
      roundsDistribution[rounds] = count;
    }

    return {
      totalConflicts: this._totalConflicts,
      resolutionCounts: { ...this._resolutionCounts },
      averageElapsedMs: avgElapsed,
      votingRoundsDistribution: roundsDistribution,
    };
  }

  // --------------------------------------------------------------------------
  // 内部辅助 / Internal Helpers
  // --------------------------------------------------------------------------

  /**
   * 获取 Agent 的 trust 评分 / Get agent's trust score
   *
   * @param {string} agentId
   * @returns {number} trust 评分 / Trust score
   * @private
   */
  _getAgentTrust(agentId) {
    try {
      if (this._reputationLedger && typeof this._reputationLedger.computeTrust === 'function') {
        return this._reputationLedger.computeTrust(agentId);
      }
      if (this._reputationLedger && typeof this._reputationLedger.getReputation === 'function') {
        const rep = this._reputationLedger.getReputation(agentId);
        return rep?.trust ?? 50;
      }
    } catch (err) {
      this._logger.warn(
        { agentId, error: err.message },
        'failed to get trust score, using default / 获取 trust 评分失败, 使用默认值',
      );
    }
    return 50; // 默认信任分 / Default trust score
  }

  /**
   * 投票者选择投票目标 / Voter selects vote target
   *
   * 策略: 投票给 bidScore 最高的候选人。若投票者自己是候选人, 投给自己。
   * Strategy: vote for candidate with highest bidScore. If voter is a candidate, vote for self.
   *
   * @param {Object} voter - 投票者 / Voter { agentId, bidScore }
   * @param {Array<Object>} candidates - 候选人列表 / Candidate list
   * @returns {Object|null} 选择的候选人 / Selected candidate
   * @private
   */
  _selectVoteTarget(voter, candidates) {
    // 若投票者自己是候选人, 优先投给自己 / If voter is a candidate, prefer self
    const selfCandidate = candidates.find(c => c.agentId === voter.agentId);
    if (selfCandidate) {
      return selfCandidate;
    }

    // 否则选择 bidScore 最高的候选人 / Otherwise select highest bidScore candidate
    let best = null;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      if (candidate.bidScore > bestScore) {
        bestScore = candidate.bidScore;
        best = candidate;
      }
    }
    return best;
  }

  /**
   * 构建解决结果对象 / Build resolution result object
   *
   * @param {Object} conflict - 冲突对象 / Conflict
   * @param {string|null} winnerId - 胜者 ID / Winner ID
   * @param {string} level - 解决级别 / Resolution level
   * @param {string} reason - 原因 / Reason
   * @param {number} elapsedMs - 耗时 / Elapsed ms
   * @param {Object} [extra] - 额外数据 / Extra data
   * @returns {Object}
   * @private
   */
  _buildResult(conflict, winnerId, level, reason, elapsedMs, extra = {}) {
    return {
      conflictId: conflict.conflictId,
      resourceId: conflict.resourceId,
      resolved: winnerId !== null,
      winnerId,
      level,
      reason,
      elapsedMs,
      ...extra,
    };
  }

  /**
   * 记录解决统计 / Record resolution statistics
   *
   * @param {string} level - 解决级别 / Resolution level
   * @param {number} elapsedMs - 耗时 / Elapsed time
   * @private
   */
  _recordResolution(level, elapsedMs) {
    this._resolutionCounts[level]++;
    this._totalElapsedMs[level] += elapsedMs;
  }

  /**
   * 记录投票轮数分布 / Record voting rounds distribution
   *
   * @param {number} rounds - 使用的轮数 / Rounds used
   * @private
   */
  _recordVotingRounds(rounds) {
    const current = this._votingRoundsDistribution.get(rounds) || 0;
    this._votingRoundsDistribution.set(rounds, current + 1);
  }

  /**
   * 发布事件到 MessageBus / Publish event to MessageBus
   *
   * @param {string} topic - 事件主题 / Event topic
   * @param {Object} payload - 事件负载 / Event payload
   * @private
   */
  _publish(topic, payload) {
    try {
      if (this._messageBus && typeof this._messageBus.publish === 'function') {
        this._messageBus.publish(topic, wrapEvent(topic, payload, SOURCE));
      }
    } catch (err) {
      this._logger.warn(
        { topic, error: err.message },
        'failed to publish event / 发布事件失败',
      );
    }
  }
}
