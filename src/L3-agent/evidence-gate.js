/**
 * EvidenceGate — 证据纪律层 / Evidence Discipline Layer
 *
 * V5.4: Agent 产出需标注证据来源, 分三层纪律:
 * - PRIMARY:       正文引用 — 直接来源 (API 返回值、文档引用、代码输出)
 * - CORROBORATION: 交叉验证 — 2+ 来源互证
 * - INFERENCE:     推论推断 — 从已有数据逻辑推导
 *
 * 每条证据附带来源可靠度分数, 整体计算 claimScore。
 * 不达标的 claim 被降级或标记, 防止未经验证的推断冒充事实。
 *
 * V5.4: Agent outputs must tag evidence sources, classified into 3 tiers:
 * - PRIMARY:       Verbatim source — direct API response, document citation, code output
 * - CORROBORATION: Cross-validation — confirmed by 2+ independent sources
 * - INFERENCE:     Deduction — logical inference from available data
 *
 * Each evidence carries a source reliability score. Overall claimScore is computed.
 * Claims below the standard are downgraded or flagged.
 *
 * @module L3-agent/evidence-gate
 * @version 5.4.0
 * @author DEEP-IOS
 */

import { randomUUID } from 'node:crypto';
import { EventTopics, wrapEvent } from '../event-catalog.js';

const SOURCE = 'evidence-gate';

// ============================================================================
// 常量 / Constants
// ============================================================================

/**
 * 证据层级枚举 / Evidence tier enum
 *
 * PRIMARY       — 最高可信: 直接引用源数据 (API response, code output, document verbatim)
 * CORROBORATION — 中等可信: 多源交叉验证 (2+ independent sources agree)
 * INFERENCE     — 较低可信: 逻辑推断 (deduced from available data, may be wrong)
 */
export const EVIDENCE_TIERS = {
  PRIMARY:       'PRIMARY',
  CORROBORATION: 'CORROBORATION',
  INFERENCE:     'INFERENCE',
};

/** 各层级默认权重 / Default tier weights */
const TIER_WEIGHTS = {
  [EVIDENCE_TIERS.PRIMARY]:       1.0,
  [EVIDENCE_TIERS.CORROBORATION]: 0.75,
  [EVIDENCE_TIERS.INFERENCE]:     0.4,
};

/** 默认最低证据质量阈值 / Default minimum evidence quality threshold */
const DEFAULT_MIN_SCORE = 0.3;

/** Claim 缓存最大容量 / Max cached claims */
const MAX_CLAIMS = 200;

// ============================================================================
// EvidenceGate 类 / EvidenceGate Class
// ============================================================================

export class EvidenceGate {
  /**
   * @param {Object} deps
   * @param {Object} [deps.messageBus]
   * @param {Object} [deps.logger]
   * @param {Object} [deps.config]
   * @param {number} [deps.config.minScore] - 最低证据分数
   * @param {Object} [deps.config.tierWeights] - 自定义层级权重
   */
  constructor({ messageBus, logger, config = {} } = {}) {
    this._messageBus = messageBus || null;
    this._logger = logger || console;

    /** @type {number} 最低证据分数 */
    this._minScore = config.minScore ?? DEFAULT_MIN_SCORE;

    /** @type {Object} 层级权重 */
    this._tierWeights = { ...TIER_WEIGHTS, ...config.tierWeights };

    /** @type {Map<string, Object>} claim 缓存 */
    this._claims = new Map();

    /** @type {Object} 统计 */
    this._stats = {
      claimsRegistered: 0,
      evidencesAttached: 0,
      evaluations: 0,
      passed: 0,
      failed: 0,
      tierCounts: {
        [EVIDENCE_TIERS.PRIMARY]: 0,
        [EVIDENCE_TIERS.CORROBORATION]: 0,
        [EVIDENCE_TIERS.INFERENCE]: 0,
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Claim 注册 / Claim Registration
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 注册一条声明及其支持证据
   * Register a claim with supporting evidence
   *
   * @param {Object} params
   * @param {string} [params.claimId] - 声明 ID (自动生成)
   * @param {string} params.agentId - 产出 agent
   * @param {string} params.content - 声明内容摘要
   * @param {string} [params.taskId] - 关联任务 ID
   * @param {Array<Object>} [params.evidences=[]] - 初始证据列表
   * @returns {Object} { claimId, score, tierBreakdown }
   */
  registerClaim({ claimId, agentId, content, taskId, evidences = [] }) {
    const id = claimId || randomUUID();

    const claim = {
      claimId: id,
      agentId,
      content: (content || '').substring(0, 500),
      taskId: taskId || null,
      evidences: [],
      score: 0,
      verdict: 'PENDING',  // PENDING | PASS | FAIL | INSUFFICIENT
      createdAt: Date.now(),
    };

    // 附加初始证据
    for (const ev of evidences) {
      this._addEvidence(claim, ev);
    }

    // 计算初始分数
    this._computeScore(claim);

    this._claims.set(id, claim);
    this._stats.claimsRegistered++;
    this._cleanupOldClaims();

    this._publish(EventTopics.EVIDENCE_CLAIM_REGISTERED, {
      claimId: id,
      agentId,
      score: claim.score,
      evidenceCount: claim.evidences.length,
      verdict: claim.verdict,
    });

    return {
      claimId: id,
      score: claim.score,
      verdict: claim.verdict,
      tierBreakdown: this._getTierBreakdown(claim),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 证据附加 / Evidence Attachment
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 向已注册的 claim 附加证据
   * Attach additional evidence to an existing claim
   *
   * @param {string} claimId
   * @param {Object} evidence
   * @param {string} evidence.tier - EVIDENCE_TIERS.*
   * @param {string} evidence.source - 来源标识 (e.g., 'api:tushare.daily', 'agent:D1')
   * @param {number} [evidence.reliability=0.5] - 来源可靠度 [0, 1]
   * @param {string} [evidence.summary] - 证据摘要
   * @returns {Object|null} 更新后的 { score, verdict, tierBreakdown } 或 null
   */
  attachEvidence(claimId, evidence) {
    const claim = this._claims.get(claimId);
    if (!claim) return null;

    this._addEvidence(claim, evidence);
    this._computeScore(claim);

    return {
      score: claim.score,
      verdict: claim.verdict,
      tierBreakdown: this._getTierBreakdown(claim),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 评估 / Evaluation
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 评估 claim 的证据质量
   * Evaluate claim evidence quality
   *
   * @param {string} claimId
   * @returns {Object|null} { score, verdict, tierBreakdown, meetsStandard } 或 null
   */
  evaluateClaim(claimId) {
    const claim = this._claims.get(claimId);
    if (!claim) return null;

    this._stats.evaluations++;
    this._computeScore(claim);

    const meetsStandard = claim.score >= this._minScore;
    if (meetsStandard) {
      this._stats.passed++;
    } else {
      this._stats.failed++;
    }

    this._publish(EventTopics.EVIDENCE_CLAIM_EVALUATED, {
      claimId,
      agentId: claim.agentId,
      score: claim.score,
      verdict: claim.verdict,
      meetsStandard,
      evidenceCount: claim.evidences.length,
    });

    return {
      score: claim.score,
      verdict: claim.verdict,
      tierBreakdown: this._getTierBreakdown(claim),
      meetsStandard,
    };
  }

  /**
   * 检查 claim 是否达到指定证据标准
   * Check if a claim meets a specific evidence standard
   *
   * @param {string} claimId
   * @param {number} [minScore] - 自定义最低分 (默认使用 this._minScore)
   * @returns {boolean}
   */
  meetsStandard(claimId, minScore) {
    const claim = this._claims.get(claimId);
    if (!claim) return false;

    this._computeScore(claim);
    return claim.score >= (minScore ?? this._minScore);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 报告 / Report
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 生成 claim 的人类可读证据报告
   * Generate human-readable evidence report for a claim
   *
   * @param {string} claimId
   * @returns {string|null}
   */
  getClaimReport(claimId) {
    const claim = this._claims.get(claimId);
    if (!claim) return null;

    this._computeScore(claim);

    const lines = [
      `[证据报告] claim=${claimId.substring(0, 8)}... agent=${claim.agentId}`,
      `声明: ${claim.content.substring(0, 100)}`,
      `综合得分: ${claim.score.toFixed(3)} (${claim.verdict})`,
      `证据数量: ${claim.evidences.length}`,
    ];

    const breakdown = this._getTierBreakdown(claim);
    if (breakdown.primary > 0) lines.push(`  正文引用: ${breakdown.primary} 条`);
    if (breakdown.corroboration > 0) lines.push(`  交叉验证: ${breakdown.corroboration} 条`);
    if (breakdown.inference > 0) lines.push(`  推论推断: ${breakdown.inference} 条`);

    if (claim.evidences.length > 0) {
      lines.push('证据明细:');
      for (const ev of claim.evidences.slice(0, 10)) {
        const tierLabel = ev.tier === EVIDENCE_TIERS.PRIMARY ? '正文'
          : ev.tier === EVIDENCE_TIERS.CORROBORATION ? '交叉' : '推论';
        lines.push(`  [${tierLabel}] ${ev.source} (可靠度: ${ev.reliability.toFixed(2)}) — ${(ev.summary || '').substring(0, 60)}`);
      }
      if (claim.evidences.length > 10) {
        lines.push(`  ... 另有 ${claim.evidences.length - 10} 条证据`);
      }
    }

    return lines.join('\n');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 查询 / Query
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 获取 claim 状态
   * @param {string} claimId
   * @returns {Object|null}
   */
  getClaim(claimId) {
    const claim = this._claims.get(claimId);
    if (!claim) return null;
    return {
      ...claim,
      evidences: claim.evidences.map(e => ({ ...e })),
      tierBreakdown: this._getTierBreakdown(claim),
    };
  }

  /**
   * 按 agent 查询所有 claims
   * @param {string} agentId
   * @returns {Array<Object>}
   */
  getClaimsByAgent(agentId) {
    const results = [];
    for (const claim of this._claims.values()) {
      if (claim.agentId === agentId) {
        results.push({
          claimId: claim.claimId,
          score: claim.score,
          verdict: claim.verdict,
          evidenceCount: claim.evidences.length,
          createdAt: claim.createdAt,
        });
      }
    }
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 辅助工厂 / Helper Factory
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 创建标准证据对象 (工厂方法)
   * Create standard evidence object (factory method)
   *
   * @param {string} tier - EVIDENCE_TIERS.*
   * @param {string} source - 来源标识
   * @param {Object} [opts]
   * @param {number} [opts.reliability=0.5]
   * @param {string} [opts.summary]
   * @returns {Object} 标准证据对象
   */
  static createEvidence(tier, source, { reliability = 0.5, summary = '' } = {}) {
    if (!EVIDENCE_TIERS[tier]) {
      throw new Error(`Invalid evidence tier: ${tier}. Must be one of ${Object.keys(EVIDENCE_TIERS).join(', ')}`);
    }
    return {
      tier,
      source,
      reliability: Math.max(0, Math.min(1, reliability)),
      summary: (summary || '').substring(0, 200),
      timestamp: Date.now(),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 统计 / Statistics
  // ══════════════════════════════════════════════════════════════════════════

  getStats() {
    return {
      ...this._stats,
      tierCounts: { ...this._stats.tierCounts },
      activeClaims: this._claims.size,
      minScore: this._minScore,
      passRate: this._stats.evaluations > 0
        ? Math.round((this._stats.passed / this._stats.evaluations) * 10000) / 10000
        : 0,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 内部方法 / Internal
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 添加证据到 claim (内部)
   * @private
   */
  _addEvidence(claim, evidence) {
    if (!evidence || !evidence.tier) return;

    const tier = EVIDENCE_TIERS[evidence.tier] ? evidence.tier : EVIDENCE_TIERS.INFERENCE;
    const ev = {
      tier,
      source: evidence.source || 'unknown',
      reliability: Math.max(0, Math.min(1, evidence.reliability ?? 0.5)),
      summary: (evidence.summary || '').substring(0, 200),
      timestamp: evidence.timestamp || Date.now(),
    };

    claim.evidences.push(ev);
    this._stats.evidencesAttached++;
    if (this._stats.tierCounts[tier] !== undefined) {
      this._stats.tierCounts[tier]++;
    }
  }

  /**
   * 计算 claim 的证据质量分数
   * Compute claim evidence quality score
   *
   * 公式 / Formula:
   *   score = sum(tierWeight_i * reliability_i) / max(count, 1)
   *   但为了奖励多源验证, 当有 ≥2 CORROBORATION 时 +0.1 加成
   *   To reward multi-source validation, +0.1 bonus when ≥2 CORROBORATION
   *
   * @private
   */
  _computeScore(claim) {
    if (claim.evidences.length === 0) {
      claim.score = 0;
      claim.verdict = 'INSUFFICIENT';
      return;
    }

    let weightedSum = 0;
    let corroborationCount = 0;

    for (const ev of claim.evidences) {
      const tierWeight = this._tierWeights[ev.tier] ?? TIER_WEIGHTS[EVIDENCE_TIERS.INFERENCE];
      weightedSum += tierWeight * ev.reliability;
      if (ev.tier === EVIDENCE_TIERS.CORROBORATION) {
        corroborationCount++;
      }
    }

    let score = weightedSum / claim.evidences.length;

    // 多源交叉验证加成: ≥2 个 CORROBORATION → +0.1
    // Multi-source corroboration bonus: ≥2 CORROBORATION → +0.1
    if (corroborationCount >= 2) {
      score += 0.1;
    }

    claim.score = Math.round(Math.max(0, Math.min(1, score)) * 10000) / 10000;

    // 判定 / Verdict
    if (claim.score >= this._minScore) {
      claim.verdict = 'PASS';
    } else if (claim.evidences.length === 0) {
      claim.verdict = 'INSUFFICIENT';
    } else {
      claim.verdict = 'FAIL';
    }
  }

  /**
   * 获取 claim 的层级分布
   * @private
   */
  _getTierBreakdown(claim) {
    const breakdown = { primary: 0, corroboration: 0, inference: 0 };
    for (const ev of claim.evidences) {
      if (ev.tier === EVIDENCE_TIERS.PRIMARY) breakdown.primary++;
      else if (ev.tier === EVIDENCE_TIERS.CORROBORATION) breakdown.corroboration++;
      else breakdown.inference++;
    }
    return breakdown;
  }

  /**
   * 清理超出容量的旧 claim
   * @private
   */
  _cleanupOldClaims() {
    if (this._claims.size <= MAX_CLAIMS) return;

    const entries = [...this._claims.entries()]
      .sort((a, b) => a[1].createdAt - b[1].createdAt);

    const toRemove = entries.length - MAX_CLAIMS;
    for (let i = 0; i < toRemove; i++) {
      this._claims.delete(entries[i][0]);
    }
  }

  /**
   * 发布事件
   * @private
   */
  _publish(topic, payload) {
    if (!this._messageBus) return;
    try {
      this._messageBus.publish(topic, wrapEvent(topic, payload, SOURCE));
    } catch { /* non-fatal */ }
  }
}
