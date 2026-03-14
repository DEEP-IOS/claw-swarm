/**
 * Compute Worker — 通用计算分发 / General-Purpose Computation Worker
 *
 * 处理 CPU 密集的数学计算:
 * - kMeans: K-means++ 聚类
 * - criticalPath: 关键路径分析 (CPM)
 * - gepTournament: GEP 锦标赛选择
 * - mutualInfo: 互信息计算
 * - complementarity: 能力互补度
 *
 * Handles CPU-intensive mathematical computations:
 * - kMeans: K-means++ clustering
 * - criticalPath: Critical Path Method (CPM)
 * - gepTournament: GEP tournament selection
 * - mutualInfo: Mutual information calculation
 * - complementarity: Capability complementarity
 *
 * @module L1-infrastructure/workers/compute-worker
 * @author DEEP-IOS
 */

import { parentPort } from 'node:worker_threads';

// ━━━ K-Means++ 聚类 / K-Means++ Clustering ━━━

/**
 * K-means++ 初始化 / K-means++ initialization
 * @private
 */
function _kmeansppInit(vectors, k) {
  const centroids = [];
  const n = vectors.length;
  const dim = vectors[0].length;

  // 随机选第一个质心 / Random first centroid
  centroids.push([...vectors[Math.floor(Math.random() * n)]]);

  for (let c = 1; c < k; c++) {
    // 计算 D^2 距离 / Compute D^2 distances
    const distances = new Float64Array(n);
    let totalDist = 0;

    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      for (const centroid of centroids) {
        const d = _euclideanDistSq(vectors[i], centroid, dim);
        if (d < minDist) minDist = d;
      }
      distances[i] = minDist;
      totalDist += minDist;
    }

    // D^2 加权概率选择 / D^2 weighted probability selection
    const r = Math.random() * totalDist;
    let cumulative = 0;
    let chosen = 0;
    for (let i = 0; i < n; i++) {
      cumulative += distances[i];
      if (cumulative >= r) {
        chosen = i;
        break;
      }
    }
    centroids.push([...vectors[chosen]]);
  }

  return centroids;
}

/**
 * 欧氏距离平方 / Squared Euclidean distance
 * @private
 */
function _euclideanDistSq(a, b, dim) {
  let sum = 0;
  for (let d = 0; d < dim; d++) {
    const diff = a[d] - b[d];
    sum += diff * diff;
  }
  return sum;
}

/**
 * K-means 聚类 / K-means clustering
 */
function handleKMeans({ vectors, k, maxIterations = 100, threshold = 0.001 }) {
  if (!vectors || vectors.length === 0 || k <= 0) {
    return { centroids: [], assignments: [], converged: false, iterations: 0 };
  }

  const n = vectors.length;
  const dim = vectors[0].length;
  k = Math.min(k, n);

  // K-means++ 初始化
  let centroids = _kmeansppInit(vectors, k);
  let assignments = new Int32Array(n);
  let converged = false;
  let iterations = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations++;

    // 分配阶段 / Assignment step
    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      let bestCluster = 0;
      for (let c = 0; c < k; c++) {
        const d = _euclideanDistSq(vectors[i], centroids[c], dim);
        if (d < minDist) {
          minDist = d;
          bestCluster = c;
        }
      }
      assignments[i] = bestCluster;
    }

    // 更新质心 / Update centroids
    const newCentroids = Array.from({ length: k }, () => new Float64Array(dim));
    const counts = new Int32Array(k);

    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let d = 0; d < dim; d++) {
        newCentroids[c][d] += vectors[i][d];
      }
    }

    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        for (let d = 0; d < dim; d++) {
          newCentroids[c][d] /= counts[c];
        }
      }
    }

    // 收敛检查 / Convergence check
    let maxShift = 0;
    for (let c = 0; c < k; c++) {
      const shift = Math.sqrt(_euclideanDistSq(centroids[c], newCentroids[c], dim));
      if (shift > maxShift) maxShift = shift;
    }

    centroids = newCentroids.map((c) => Array.from(c));

    if (maxShift < threshold) {
      converged = true;
      break;
    }
  }

  return {
    centroids,
    assignments: Array.from(assignments),
    converged,
    iterations,
  };
}

// ━━━ 关键路径分析 / Critical Path Method ━━━

/**
 * CPM 分析 / Critical Path Analysis
 */
function handleCriticalPath({ roles }) {
  if (!roles || roles.length === 0) {
    return { criticalPath: [], totalDuration: 0, roleAnalysis: {}, parallelismFactor: 0 };
  }

  const roleMap = new Map();
  for (const r of roles) {
    roleMap.set(r.name, {
      name: r.name,
      duration: r.duration || 1,
      dependencies: r.dependencies || [],
      es: 0, ef: 0, ls: 0, lf: 0, slack: 0,
    });
  }

  // Kahn 拓扑排序 / Kahn's topological sort
  const inDegree = new Map();
  const adjList = new Map();
  for (const [name, role] of roleMap) {
    inDegree.set(name, 0);
    adjList.set(name, []);
  }
  for (const [name, role] of roleMap) {
    for (const dep of role.dependencies) {
      if (roleMap.has(dep)) {
        adjList.get(dep).push(name);
        inDegree.set(name, (inDegree.get(name) || 0) + 1);
      }
    }
  }

  const topoOrder = [];
  const queue = [];
  for (const [name, deg] of inDegree) {
    if (deg === 0) queue.push(name);
  }
  while (queue.length > 0) {
    const node = queue.shift();
    topoOrder.push(node);
    for (const succ of adjList.get(node) || []) {
      inDegree.set(succ, inDegree.get(succ) - 1);
      if (inDegree.get(succ) === 0) queue.push(succ);
    }
  }

  if (topoOrder.length !== roleMap.size) {
    return { criticalPath: [], totalDuration: 0, roleAnalysis: {}, parallelismFactor: 0, error: 'Cyclic dependency detected' };
  }

  // 前向遍历 ES/EF / Forward pass
  for (const name of topoOrder) {
    const role = roleMap.get(name);
    let maxPredEF = 0;
    for (const dep of role.dependencies) {
      const pred = roleMap.get(dep);
      if (pred && pred.ef > maxPredEF) maxPredEF = pred.ef;
    }
    role.es = maxPredEF;
    role.ef = role.es + role.duration;
  }

  // 总工期 / Total duration
  let totalDuration = 0;
  for (const role of roleMap.values()) {
    if (role.ef > totalDuration) totalDuration = role.ef;
  }

  // 后向遍历 LS/LF / Backward pass
  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const name = topoOrder[i];
    const role = roleMap.get(name);
    const successors = adjList.get(name) || [];

    if (successors.length === 0) {
      role.lf = totalDuration;
    } else {
      let minSuccLS = Infinity;
      for (const succ of successors) {
        const s = roleMap.get(succ);
        if (s.ls < minSuccLS) minSuccLS = s.ls;
      }
      role.lf = minSuccLS;
    }
    role.ls = role.lf - role.duration;
    role.slack = role.ls - role.es;
  }

  // 提取关键路径 / Extract critical path
  const criticalPath = topoOrder.filter((name) => {
    const role = roleMap.get(name);
    return Math.abs(role.slack) < 0.001;
  });

  // 并行度 / Parallelism factor
  const sumDurations = roles.reduce((s, r) => s + (r.duration || 1), 0);
  const parallelismFactor = totalDuration > 0 ? sumDurations / totalDuration : 1;

  // 构建 roleAnalysis / Build role analysis
  const roleAnalysis = {};
  for (const [name, role] of roleMap) {
    roleAnalysis[name] = {
      es: role.es,
      ef: role.ef,
      ls: role.ls,
      lf: role.lf,
      slack: role.slack,
      isCritical: Math.abs(role.slack) < 0.001,
    };
  }

  return { criticalPath, totalDuration, roleAnalysis, parallelismFactor };
}

// ━━━ GEP 锦标赛选择 / GEP Tournament Selection ━━━

/**
 * GEP 锦标赛 / GEP Tournament
 */
function handleGepTournament({ agentScores, mutationRate = 0.1, stagnant = false }) {
  if (!agentScores || agentScores.length < 2) {
    return { results: [], evolved: 0 };
  }

  const rate = stagnant ? mutationRate * 2 : mutationRate;
  const results = [];
  let evolved = 0;

  // 两两锦标赛 / Pairwise tournament
  const shuffled = [...agentScores].sort(() => Math.random() - 0.5);

  for (let i = 0; i < shuffled.length - 1; i += 2) {
    const a = shuffled[i];
    const b = shuffled[i + 1];

    const winner = a.score >= b.score ? a : b;
    const loser = a.score >= b.score ? b : a;

    // 胜者变异进化 / Winner mutates
    const mutated = Math.random() < rate;
    results.push({
      agentId: winner.agentId,
      action: mutated ? 'evolve' : 'keep',
      mutationRate: mutated ? rate : 0,
      score: winner.score,
    });

    // 败者记录 / Loser recorded
    results.push({
      agentId: loser.agentId,
      action: 'decline',
      mutationRate: 0,
      score: loser.score,
    });
    evolved += mutated ? 1 : 0;
  }

  // 奇数个时最后一个保持 / Odd count: last one keeps
  if (shuffled.length % 2 === 1) {
    const last = shuffled[shuffled.length - 1];
    results.push({
      agentId: last.agentId,
      action: 'keep',
      mutationRate: 0,
      score: last.score,
    });
  }

  return { results, evolved };
}

// ━━━ 互信息计算 / Mutual Information ━━━

/**
 * 离散互信息 / Discrete Mutual Information
 * MI(X;Y) = Σ Σ p(x,y) × log[p(x,y) / (p(x)×p(y))]
 */
function handleMutualInfo({ signalValues, outcomeValues, bins = 10 }) {
  if (!signalValues || !outcomeValues || signalValues.length !== outcomeValues.length) {
    return { mi: 0, error: 'Invalid input arrays' };
  }

  const n = signalValues.length;
  if (n < 10) return { mi: 0, error: 'Insufficient samples' };

  // 离散化 / Discretize
  const discretize = (values) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    return values.map((v) => Math.min(Math.floor(((v - min) / range) * bins), bins - 1));
  };

  const xBins = discretize(signalValues);
  const yBins = discretize(outcomeValues);

  // 联合分布和边缘分布 / Joint and marginal distributions
  const jointCount = new Map();
  const xCount = new Float64Array(bins);
  const yCount = new Float64Array(bins);

  for (let i = 0; i < n; i++) {
    const key = `${xBins[i]}_${yBins[i]}`;
    jointCount.set(key, (jointCount.get(key) || 0) + 1);
    xCount[xBins[i]]++;
    yCount[yBins[i]]++;
  }

  // MI 计算 / MI calculation
  let mi = 0;
  for (const [key, count] of jointCount) {
    const [xb, yb] = key.split('_').map(Number);
    const pxy = count / n;
    const px = xCount[xb] / n;
    const py = yCount[yb] / n;
    if (pxy > 0 && px > 0 && py > 0) {
      mi += pxy * Math.log(pxy / (px * py));
    }
  }

  return { mi: Math.max(0, mi) };
}

// ━━━ 能力互补度 / Capability Complementarity ━━━

/**
 * 余弦相似度互补度 / Cosine-similarity complementarity
 * complementarity = 1 - cosineSimilarity(A, B)
 */
function handleComplementarity({ scoresA, scoresB }) {
  const keys = ['technical', 'delivery', 'collaboration', 'innovation'];
  const vecA = keys.map((k) => scoresA?.[k] || 0);
  const vecB = keys.map((k) => scoresB?.[k] || 0);

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) return { complementarity: 0.5 };

  const cosineSim = dot / (normA * normB);
  return { complementarity: 1 - cosineSim };
}

// ━━━ 消息分发 / Message Dispatch ━━━

const HANDLERS = {
  kMeans: handleKMeans,
  criticalPath: handleCriticalPath,
  gepTournament: handleGepTournament,
  mutualInfo: handleMutualInfo,
  complementarity: handleComplementarity,
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
  handleKMeans,
  handleCriticalPath,
  handleGepTournament,
  handleMutualInfo,
  handleComplementarity,
};
