/**
 * PheromoneEngine — 信息素引擎 / Pheromone Engine
 *
 * 蜂群通信的核心引擎。管理信息素的发射、读取、累积强化和衰减清理。
 *
 * Core engine for swarm communication. Manages pheromone emission, reading,
 * intensity reinforcement, and decay cleanup.
 *
 * [WHY] 信息素系统解决了 OpenClaw 子代理间的"间接通信"问题：
 * 1. 时效性语境 — Memory 是永久的，pheromone 有衰减（紧迫感+新鲜度）
 * 2. 广播通信 — 一对多信号，Agent 无需知道其他 Agent 的存在
 * 3. 累积强化 — 多个 Agent 发同类型信息素时 intensity 叠加（群体共识）
 * 4. 零成本感知 — 通过 before_agent_start 注入，Agent 被动接收
 *
 * Pheromone system solves "indirect communication" between OpenClaw subagents:
 * 1. Time-sensitive context — Memory is permanent, pheromones decay (urgency+freshness)
 * 2. Broadcast — One-to-many signals, agents don't need to know each other
 * 3. Reinforcement — Multiple agents emitting same type stack intensity (group consensus)
 * 4. Zero-cost awareness — Injected via before_agent_start, agents passively receive
 *
 * @module pheromone-engine
 * @author DEEP-IOS
 */

import { randomUUID } from 'node:crypto';
import * as db from '../../layer1-core/db.js';
import { PHEROMONE_DEFAULTS, MIN_INTENSITY } from './pheromone-types.js';
import { calculateCurrentIntensity, isExpired, formatPheromoneForSnapshot } from './pheromone-decay.js';

export class PheromoneEngine {
  constructor(config) {
    this.config = config;
    // maxPheromones limit to prevent DB bloat
    this._maxPheromones = config.pheromone?.maxPheromones ?? 1000;
  }

  /**
   * 发射信息素信号 / Emit a pheromone signal
   *
   * If a pheromone of the same type+scope+source already exists and hasn't expired,
   * its intensity is REINFORCED (accumulated). This models how multiple ants
   * strengthening a trail creates consensus.
   *
   * 如果相同 type+scope+source 的信息素已存在且未过期，
   * 其强度会被累积强化。这模拟了多只蚂蚁强化同一条路径的群体共识。
   *
   * @param {{ type: string, sourceId: string, targetScope: string, intensity?: number, payload?: any, decayRate?: number }} params
   * @returns {string} pheromone id
   */
  emitPheromone({ type, sourceId, targetScope, intensity = 1.0, payload, decayRate }) {
    const defaults = PHEROMONE_DEFAULTS[type] || PHEROMONE_DEFAULTS.trail;
    const rate = decayRate ?? defaults.decayRate;
    const maxTTL = defaults.maxTTLMinutes;
    const now = Date.now();

    // Try reinforcement first (upsert)
    const result = db.upsertPheromone({
      type, sourceId, targetScope,
      intensity, payload: payload ? JSON.stringify(payload) : null,
      decayRate: rate,
    });

    // If over limit, clean oldest
    const count = db.countPheromones();
    if (count > this._maxPheromones) {
      db.deleteExpiredPheromones(now);
    }

    return result || randomUUID();
  }

  /**
   * 读取指定范围内的活跃信息素 / Read active pheromones in a scope
   *
   * Returns pheromones with real-time intensity calculation (decay applied
   * at read-time without DB write, for performance).
   *
   * @param {string} targetScope - e.g. '/global', '/agent/agent-1', '/task/task-123'
   * @param {{ type?: string, minIntensity?: number }} [options={}]
   * @returns {Array<object>} Pheromones sorted by intensity DESC
   */
  read(targetScope, { type, minIntensity = MIN_INTENSITY } = {}) {
    const rows = db.queryPheromones(targetScope, type, 0); // get all, filter in JS
    const now = Date.now();

    return rows
      .map(row => {
        const currentIntensity = calculateCurrentIntensity(
          row.intensity, row.decay_rate, row.updated_at, now
        );
        return {
          ...row,
          currentIntensity,
          payload: row.payload ?? null,
        };
      })
      .filter(p => p.currentIntensity >= minIntensity)
      .sort((a, b) => b.currentIntensity - a.currentIntensity);
  }

  /**
   * 构建信息素快照字符串用于上下文注入 / Build snapshot string for context injection
   *
   * Format:
   * [Pheromone Signals]
   * - ALARM(0.82): 'Build failure in /api/auth' from agent-2
   * - RECRUIT(0.65): 'Need help with database migration' from agent-3
   *
   * @param {string} agentId - Current agent (for scope resolution)
   * @param {string[]} scopes - Scopes to read from
   * @returns {string} Formatted snapshot or empty string
   */
  buildSnapshot(agentId, scopes) {
    const allPheromones = [];

    for (const scope of scopes) {
      const pheromones = this.read(scope);
      allPheromones.push(...pheromones);
    }

    if (allPheromones.length === 0) return '';

    // Deduplicate by id, keep highest intensity
    const deduped = new Map();
    for (const p of allPheromones) {
      if (!deduped.has(p.id) || deduped.get(p.id).currentIntensity < p.currentIntensity) {
        deduped.set(p.id, p);
      }
    }

    const sorted = [...deduped.values()]
      .sort((a, b) => b.currentIntensity - a.currentIntensity)
      .slice(0, 10); // Max 10 signals in context

    const lines = sorted.map(p => formatPheromoneForSnapshot(p));
    return `[Pheromone Signals]\n${lines.join('\n')}`;
  }

  /**
   * 执行衰减清理（由后台服务定期调用）/ Run decay cleanup (called by background service)
   *
   * [WHY] Performance optimization — uses indexed batch DELETE instead of full table scan.
   * 当 pheromones 表有 100k 行时，全表扫描会阻塞 SQLite。
   * 使用 idx_pher_expires 索引的批量 DELETE 避免全表扫描。
   *
   * @returns {{ deleted: number }} Count of pheromones cleaned up
   */
  decayPass() {
    const now = Date.now();
    const deleted = db.deleteExpiredPheromones(now);
    return { deleted };
  }

  /**
   * 清理所有过期信息素 / Cleanup all expired pheromones
   * @returns {{ deleted: number }}
   */
  cleanup() {
    return this.decayPass();
  }
}
