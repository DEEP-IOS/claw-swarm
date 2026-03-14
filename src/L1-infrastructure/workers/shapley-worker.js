/**
 * Shapley Worker — 蒙特卡洛 Shapley 信用分配 / Monte Carlo Shapley Credit Assignment Worker
 *
 * 实现蒙特卡洛近似 Shapley 值:
 * φᵢ ≈ (1/M) × Σ_{m=1}^{M} [v(Sₘ∪{i}) - v(Sₘ)]
 *
 * 联盟价值函数:
 * v(S) = qualityScore × completionRate × (1 - latencyPenalty)
 *
 * Implements Monte Carlo approximation of Shapley values:
 * φᵢ ≈ (1/M) × Σ_{m=1}^{M} [v(Sₘ∪{i}) - v(Sₘ)]
 *
 * Coalition value function:
 * v(S) = qualityScore × completionRate × (1 - latencyPenalty)
 *
 * @module L1-infrastructure/workers/shapley-worker
 * @author DEEP-IOS
 */

import { parentPort } from 'node:worker_threads';

// ━━━ 联盟价值函数 / Coalition Value Function ━━━

/**
 * 计算联盟价值 / Compute coalition value
 * v(S) = qualityScore × completionRate × (1 - latencyPenalty)
 *
 * @param {Set<string>} coalition - 联盟成员 agent IDs
 * @param {Map<string, Object>} agentContributions - agent 贡献数据
 * @returns {number} 联盟价值 [0, 1]
 */
function coalitionValue(coalition, agentContributions) {
  if (coalition.size === 0) return 0;

  let totalQuality = 0;
  let totalCompleted = 0;
  let totalAssigned = 0;
  let totalLatencyPenalty = 0;
  let count = 0;

  for (const agentId of coalition) {
    const contrib = agentContributions.get(agentId);
    if (!contrib) continue;

    totalQuality += contrib.qualityScore || 0;
    totalCompleted += contrib.completedTasks || 0;
    totalAssigned += contrib.assignedTasks || 0;
    totalLatencyPenalty += contrib.latencyPenalty || 0;
    count++;
  }

  if (count === 0) return 0;

  const avgQuality = totalQuality / count;
  const completionRate = totalAssigned > 0 ? totalCompleted / totalAssigned : 0;
  const avgLatencyPenalty = Math.min(totalLatencyPenalty / count, 1);

  return avgQuality * completionRate * (1 - avgLatencyPenalty);
}

// ━━━ 蒙特卡洛 Shapley / Monte Carlo Shapley ━━━

/**
 * Fisher-Yates 洗牌 / Fisher-Yates shuffle
 * @private
 */
function _shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 蒙特卡洛 Shapley 值计算 / Monte Carlo Shapley value computation
 *
 * @param {Object} params
 * @param {string[]} params.agentIds - 参与的 agent ID 列表
 * @param {Object} params.contributions - agent 贡献数据 { agentId: { qualityScore, completedTasks, assignedTasks, latencyPenalty } }
 * @param {number} [params.samples=100] - 蒙特卡洛采样次数
 * @returns {Object} { credits: { agentId: shapleyValue }, samples, totalValue }
 */
function handleShapleyCredit({ agentIds, contributions, samples = 100 }) {
  if (!agentIds || agentIds.length === 0) {
    return { credits: {}, samples: 0, totalValue: 0 };
  }

  const contribMap = new Map();
  for (const id of agentIds) {
    contribMap.set(id, contributions[id] || {});
  }

  // 每个 agent 的边际贡献累加器 / Marginal contribution accumulator
  const marginalSums = new Map();
  for (const id of agentIds) {
    marginalSums.set(id, 0);
  }

  const n = agentIds.length;

  for (let m = 0; m < samples; m++) {
    // 随机排列 / Random permutation
    const perm = _shuffle([...agentIds]);
    const coalition = new Set();

    for (let i = 0; i < n; i++) {
      const agent = perm[i];

      // v(S) — 不含当前 agent / Without current agent
      const vWithout = coalitionValue(coalition, contribMap);

      // v(S ∪ {i}) — 含当前 agent / With current agent
      coalition.add(agent);
      const vWith = coalitionValue(coalition, contribMap);

      // 边际贡献 / Marginal contribution
      marginalSums.set(agent, marginalSums.get(agent) + (vWith - vWithout));
    }
  }

  // 平均化得到 Shapley 值 / Average to get Shapley values
  const credits = {};
  let totalValue = 0;

  for (const id of agentIds) {
    credits[id] = marginalSums.get(id) / samples;
    totalValue += credits[id];
  }

  return { credits, samples, totalValue };
}

/**
 * 简化 Shapley (2 agent 精确计算)
 * Simplified Shapley (exact computation for 2 agents)
 */
function handleShapleyExact2({ agentA, agentB, contributions }) {
  const contribMap = new Map();
  contribMap.set(agentA, contributions[agentA] || {});
  contribMap.set(agentB, contributions[agentB] || {});

  const vEmpty = 0;
  const vA = coalitionValue(new Set([agentA]), contribMap);
  const vB = coalitionValue(new Set([agentB]), contribMap);
  const vAB = coalitionValue(new Set([agentA, agentB]), contribMap);

  // Shapley 精确公式 (2人) / Exact Shapley for 2 players
  // φ_A = [v({A}) + (v({A,B}) - v({B}))] / 2
  const phiA = (vA + (vAB - vB)) / 2;
  const phiB = (vB + (vAB - vA)) / 2;

  return {
    credits: { [agentA]: phiA, [agentB]: phiB },
    totalValue: vAB,
    exact: true,
  };
}

// ━━━ 消息分发 / Message Dispatch ━━━

const HANDLERS = {
  shapleyCredit: handleShapleyCredit,
  shapleyExact2: handleShapleyExact2,
};

parentPort.on('message', (msg) => {
  if (msg.type !== 'task') return;

  const handler = HANDLERS[msg.taskType];
  if (!handler) {
    parentPort.postMessage({
      type: 'result',
      id: msg.id,
      error: `Unknown task type: ${msg.taskType}`,
    });
    return;
  }

  try {
    const result = handler(msg.payload);
    parentPort.postMessage({
      type: 'result',
      id: msg.id,
      result,
    });
  } catch (err) {
    parentPort.postMessage({
      type: 'result',
      id: msg.id,
      error: err.message,
    });
  }
});

// 导出供测试使用 / Export for testing
export {
  handleShapleyCredit,
  handleShapleyExact2,
  coalitionValue,
};
