/**
 * Tooltip 数据结构 / Tooltip Data Structure
 *
 * 所有 UI 元素的双语 Tooltip 内容。
 *
 * @module constants/tooltips-data
 * @author DEEP-IOS
 */

/**
 * @typedef {Object} TooltipDef
 * @property {string} en - 英文标题
 * @property {string} zh - 中文标题
 * @property {string} descEn - 英文描述
 * @property {string} descZh - 中文描述
 * @property {string} [icon] - 图标
 */

/** @type {Record<string, TooltipDef>} */
export const TOOLTIPS = {
  // ── Views / 视图 ──
  'view.hive':      { en: 'Hive View', zh: '蜂巢视图', descEn: 'Main overview with bee agents in honeycomb', descZh: '蜂群代理在蜂巢中的主概览' },
  'view.pipeline':  { en: 'Pipeline View', zh: '流水线视图', descEn: 'Task flow from CFP to Done', descZh: '任务从 CFP 到完成的流程' },
  'view.cognition': { en: 'Cognition View', zh: '认知视图', descEn: 'Memory system: Working / Episodic / Semantic', descZh: '记忆系统: 工作记忆 / 情景记忆 / 语义记忆' },
  'view.ecology':   { en: 'Ecology View', zh: '生态视图', descEn: 'Species evolution and ABC roles', descZh: '物种进化和 ABC 角色分布' },
  'view.network':   { en: 'Network View', zh: '网络视图', descEn: 'Agent interaction graph and centrality', descZh: '代理交互图和中心性分析' },
  'view.control':   { en: 'Control View', zh: '控制视图', descEn: 'System metrics and PI controller', descZh: '系统指标和 PI 控制器' },

  // ── Pheromones / 信息素 ──
  'phero.trail':   { en: 'Trail', zh: '轨迹', descEn: 'Marks successful paths', descZh: '标记成功路径' },
  'phero.alarm':   { en: 'Alarm', zh: '警报', descEn: 'Signals danger or failure', descZh: '信号危险或失败' },
  'phero.recruit': { en: 'Recruit', zh: '招募', descEn: 'Attracts idle agents', descZh: '吸引空闲代理' },
  'phero.dance':   { en: 'Dance', zh: '舞蹈', descEn: 'Quality signal via waggle dance', descZh: '通过摇摆舞传递质量信号' },
  'phero.queen':   { en: 'Queen', zh: '蜂王', descEn: 'Leadership authority signal', descZh: '领导权威信号' },
  'phero.food':    { en: 'Food', zh: '食物', descEn: 'Points to high-value tasks', descZh: '指向高价值任务' },
  'phero.danger':  { en: 'Danger', zh: '危险', descEn: 'Marks hazardous areas', descZh: '标记危险区域' },

  // ── Metrics / 指标 ──
  'metric.rate':      { en: 'Rate', zh: '速率', descEn: 'Tasks completed per minute', descZh: '每分钟完成任务数' },
  'metric.errorRate': { en: 'Error Rate', zh: '错误率', descEn: 'Percentage of failed tasks', descZh: '失败任务百分比' },
  'metric.duration':  { en: 'Duration', zh: '持续时间', descEn: 'Average task completion time', descZh: '平均任务完成时间' },
  'metric.health':    { en: 'Health', zh: '健康度', descEn: 'Overall system health score (0-100)', descZh: '整体系统健康分数 (0-100)' },
  'metric.budget':    { en: 'Budget', zh: '预算', descEn: 'Token budget consumption', descZh: 'Token 预算消耗' },

  // ── Breaker / 断路器 ──
  'breaker.state':   { en: 'Circuit Breaker', zh: '断路器', descEn: 'CLOSED=normal, OPEN=circuit tripped, HALF_OPEN=testing', descZh: 'CLOSED=正常, OPEN=断路, HALF_OPEN=测试恢复' },

  // ── Mode / 模式 ──
  'mode.current':    { en: 'Global Mode', zh: '全局模式', descEn: 'EXPLOIT/EXPLORE/URGENT/RELIABLE', descZh: '利用/探索/紧急/稳定' },

  // ── Agent Properties / Agent 属性 ──
  'agent.tier':      { en: 'Tier', zh: '层级', descEn: 'junior / mid / senior / lead', descZh: '初级 / 中级 / 高级 / 主管' },
  'agent.abc':       { en: 'ABC Role', zh: 'ABC 角色', descEn: 'Artificial Bee Colony: Employed/Onlooker/Scout', descZh: '人工蜂群: 雇佣蜂/旁观蜂/侦察蜂' },
  'agent.species':   { en: 'Species', zh: '物种', descEn: 'Agent type evolved by Species Evolver', descZh: '由物种进化器进化的代理类型' },

  // ── Cold Start / 冷启动 ──
  'coldStart':       { en: 'Cold Start', zh: '冷启动', descEn: 'System warm-up phase until threshold tasks complete', descZh: '系统预热阶段直到阈值任务完成' },

  // ── PI Controller / PI 控制器 ──
  'pi.controller':   { en: 'PI Controller', zh: 'PI 控制器', descEn: 'Proportional-Integral feedback controller', descZh: '比例-积分反馈控制器' },

  // ── Shapley / Shapley ──
  'shapley':         { en: 'Shapley Credits', zh: 'Shapley 信用', descEn: 'Fair value attribution via Monte Carlo Shapley', descZh: '通过 Monte Carlo Shapley 的公平价值归因' },

  // ── Signal Weights / 信号权重 ──
  'signals':         { en: 'Signal Weights', zh: '信号权重', descEn: 'Calibrated signal importance via Mutual Information', descZh: '通过互信息校准的信号重要性' },
};

/**
 * 获取 Tooltip / Get tooltip
 * @param {string} key
 * @returns {TooltipDef|null}
 */
export function getTooltip(key) {
  return TOOLTIPS[key] || null;
}
