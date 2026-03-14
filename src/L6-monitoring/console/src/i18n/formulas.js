/**
 * 公式双语名称和参数 / Formula Bilingual Names and Parameters
 *
 * 9 个精确实现的数学公式的展示数据。
 * Display data for 9 precisely-implemented mathematical formulas.
 *
 * @module i18n/formulas
 * @author DEEP-IOS
 */

export const FORMULAS = [
  {
    id: 'mutual-info',
    en: 'Mutual Information',
    zh: '互信息',
    latex: 'MI(X;Y) = \\sum p(x,y) \\cdot \\log\\frac{p(x,y)}{p(x)p(y)}',
    source: 'Information Theory / Physics',
    sourceZh: '信息论 / 物理学',
    file: 'signal-calibrator.js',
    params: [
      { sym: 'p(x,y)', en: 'Joint probability', zh: '联合概率' },
      { sym: 'p(x)', en: 'Marginal probability of X', zh: 'X 的边际概率' },
      { sym: 'p(y)', en: 'Marginal probability of Y', zh: 'Y 的边际概率' },
    ],
  },
  {
    id: 'lotka-volterra',
    en: 'Lotka-Volterra Competition',
    zh: 'Lotka-Volterra 竞争',
    latex: 'dN/dt = rN(1 - N/K) - \\alpha NP',
    source: 'Ecology',
    sourceZh: '生态学',
    file: 'species-evolver.js',
    params: [
      { sym: 'N', en: 'Population size', zh: '种群大小' },
      { sym: 'r', en: 'Intrinsic growth rate', zh: '内禀增长率' },
      { sym: 'K', en: 'Carrying capacity', zh: '环境容纳量' },
      { sym: '\\alpha', en: 'Competition coefficient', zh: '竞争系数' },
      { sym: 'P', en: 'Competitor population', zh: '竞争者种群' },
    ],
  },
  {
    id: 'shapley',
    en: 'Monte Carlo Shapley Value',
    zh: 'Monte Carlo Shapley 值',
    latex: '\\phi_i \\approx \\frac{1}{M} \\sum [v(S \\cup \\{i\\}) - v(S)]',
    source: 'Cooperative Game Theory',
    sourceZh: '合作博弈论',
    file: 'shapley-credit.js',
    params: [
      { sym: '\\phi_i', en: 'Shapley value of player i', zh: '参与者 i 的 Shapley 值' },
      { sym: 'M', en: 'Number of samples', zh: '采样次数' },
      { sym: 'v(S)', en: 'Coalition value function', zh: '联盟价值函数' },
    ],
  },
  {
    id: 'aco-prob',
    en: 'ACO Transition Probability',
    zh: 'ACO 转移概率',
    latex: 'p_{ij} = \\frac{[\\tau_{ij}]^\\alpha \\cdot [\\eta_{ij}]^\\beta}{\\sum_k [\\tau_{ik}]^\\alpha \\cdot [\\eta_{ik}]^\\beta}',
    source: 'Ant Colony Optimization',
    sourceZh: '蚁群优化',
    file: 'pheromone-engine.js',
    params: [
      { sym: '\\tau_{ij}', en: 'Pheromone intensity', zh: '信息素强度' },
      { sym: '\\eta_{ij}', en: 'Heuristic desirability', zh: '启发式吸引力' },
      { sym: '\\alpha', en: 'Pheromone weight', zh: '信息素权重' },
      { sym: '\\beta', en: 'Heuristic weight', zh: '启发式权重' },
    ],
  },
  {
    id: 'pi-controller',
    en: 'PI Controller',
    zh: 'PI 控制器',
    latex: '\\theta_{new} = \\theta_{old} - K_p \\cdot e - K_i \\cdot \\int e',
    source: 'Control Theory',
    sourceZh: '控制论',
    file: 'response-threshold.js',
    params: [
      { sym: 'K_p', en: 'Proportional gain', zh: '比例增益' },
      { sym: 'K_i', en: 'Integral gain', zh: '积分增益' },
      { sym: 'e', en: 'Error signal', zh: '误差信号' },
    ],
  },
  {
    id: 'brandes-betweenness',
    en: 'Brandes Betweenness Centrality',
    zh: 'Brandes 介数中心性',
    latex: 'C_B(v) = \\sum_{s \\neq v \\neq t} \\frac{\\sigma(s,t|v)}{\\sigma(s,t)}',
    source: 'Graph Theory (Brandes)',
    sourceZh: '图论 (Brandes)',
    file: 'sna-analyzer.js',
    params: [
      { sym: '\\sigma(s,t)', en: 'Shortest paths from s to t', zh: 's 到 t 的最短路径数' },
      { sym: '\\sigma(s,t|v)', en: 'Shortest paths through v', zh: '经过 v 的最短路径数' },
    ],
  },
  {
    id: 'ebbinghaus',
    en: 'Ebbinghaus Retention',
    zh: 'Ebbinghaus 遗忘曲线',
    latex: 'R = e^{-t / (\\lambda \\cdot importance)}',
    source: 'Psychology (Ebbinghaus)',
    sourceZh: '心理学 (Ebbinghaus)',
    file: 'episodic-memory.js',
    params: [
      { sym: 'R', en: 'Retention probability', zh: '保留概率' },
      { sym: 't', en: 'Time elapsed', zh: '经过时间' },
      { sym: '\\lambda', en: 'Memory stability', zh: '记忆稳定性' },
    ],
  },
  {
    id: 'complementarity',
    en: 'Skill Complementarity',
    zh: '技能互补性',
    latex: 'complementarity = 1 - cos(A, B)',
    source: 'Ecology (Symbiosis)',
    sourceZh: '生态学 (共生)',
    file: 'skill-symbiosis.js',
    params: [
      { sym: 'A, B', en: 'Capability vectors', zh: '能力向量' },
      { sym: 'cos', en: 'Cosine similarity', zh: '余弦相似度' },
    ],
  },
  {
    id: 'hybrid-6d',
    en: '6D Hybrid Retrieval Score',
    zh: '6维混合检索评分',
    latex: 'S = 0.30 \\cdot sem + 0.20 \\cdot tmp + 0.15 \\cdot imp + 0.10 \\cdot conf + 0.10 \\cdot freq + 0.15 \\cdot ctx',
    source: 'Information Retrieval',
    sourceZh: '信息检索',
    file: 'hybrid-retrieval.js',
    params: [
      { sym: 'sem', en: 'Semantic similarity', zh: '语义相似度' },
      { sym: 'tmp', en: 'Temporal recency', zh: '时间近因' },
      { sym: 'imp', en: 'Importance', zh: '重要性' },
      { sym: 'conf', en: 'Confidence', zh: '置信度' },
      { sym: 'freq', en: 'Frequency', zh: '频率' },
      { sym: 'ctx', en: 'Contextual relevance', zh: '上下文相关性' },
    ],
  },
];
