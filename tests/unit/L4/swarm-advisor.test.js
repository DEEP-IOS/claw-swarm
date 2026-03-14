/**
 * SwarmAdvisor V5.4 单元测试 / SwarmAdvisor V5.4 Unit Tests
 *
 * 测试蜂群主路径路由引擎的所有核心功能:
 * Tests all core features of the Swarm Main-Path Routing Engine:
 * - 多信号聚合 / Multi-signal aggregation
 * - 工具安全分级 T0/T1/T2 / Tool safety classification
 * - 信号源连线 / Signal source wiring
 * - 权重重分配 / Weight redistribution
 * - PI 控制器反馈 / PI controller feedback
 * - Turn 级状态隔离 / Turn-level state isolation
 * - Layer 0/1 入口 / Layer 0/1 entry points
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SwarmAdvisor, ARBITER_MODES } from '../../../src/L4-orchestration/swarm-advisor.js';

// ── 模拟依赖 / Mock Dependencies ──

function createMockBus() {
  const _published = [];
  return {
    publish(topic, data) { _published.push({ topic, data }); },
    subscribe() {},
    _published,
  };
}

function createMockPheromoneEngine() {
  const _pheromones = [];
  return {
    emitPheromone(opts) {
      _pheromones.push(opts);
      return `ph_${Date.now()}`;
    },
    _pheromones,
  };
}

function createMockResponseThreshold() {
  let _threshold = 0.5;
  const _adjustments = [];
  return {
    shouldRespond(agentId, taskType, stimulus) {
      return stimulus > _threshold;
    },
    adjust(agentId, taskType, rate) {
      const oldThreshold = _threshold;
      // 简化 PI 控制器: rate > target → 降低阈值
      const error = 0.5 - rate; // target=0.5
      _threshold = Math.max(0.1, Math.min(0.9, _threshold + error * 0.1));
      _adjustments.push({ agentId, taskType, rate, oldThreshold, newThreshold: _threshold });
      return { oldThreshold, newThreshold: _threshold };
    },
    getThreshold(agentId, taskType) {
      return _threshold;
    },
    _adjustments,
    _setThreshold(v) { _threshold = v; },
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

// ── Tests ──

describe('SwarmAdvisor', () => {
  let advisor;
  let mockBus;
  let mockPheromone;
  let mockRT;

  beforeEach(() => {
    mockBus = createMockBus();
    mockPheromone = createMockPheromoneEngine();
    mockRT = createMockResponseThreshold();

    advisor = new SwarmAdvisor({
      responseThreshold: mockRT,
      pheromoneEngine: mockPheromone,
      messageBus: mockBus,
      logger,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // computeStimulus
  // ═══════════════════════════════════════════════════════════════════════

  describe('computeStimulus', () => {
    it('空输入返回 0 / empty input returns 0', () => {
      expect(advisor.computeStimulus('')).toBe(0);
      expect(advisor.computeStimulus(null)).toBe(0);
      expect(advisor.computeStimulus(undefined)).toBe(0);
    });

    it('简短输入刺激值低 / short input produces low stimulus', () => {
      const stimulus = advisor.computeStimulus('你好');
      expect(stimulus).toBeLessThan(0.3);
    });

    it('复杂任务刺激值高 / complex task produces high stimulus', () => {
      const stimulus = advisor.computeStimulus(
        '帮我分析A股大盘走势，首先调研 Tushare daily API 接口获取数据，' +
        '然后进行技术分析，最后比较不同指标的结果并评估趋势'
      );
      expect(stimulus).toBeGreaterThan(0.5);
    });

    it('包含动作动词提高刺激 / action verbs increase stimulus', () => {
      const low = advisor.computeStimulus('今天天气怎么样');
      const high = advisor.computeStimulus('分析并评估这个方案的优缺点，然后设计改进方案');
      expect(high).toBeGreaterThan(low);
    });

    it('多步骤指示符提高刺激 / multi-step indicators increase stimulus', () => {
      const single = advisor.computeStimulus('帮我写一个函数');
      const multi = advisor.computeStimulus('首先分析需求，然后设计架构，最后编写代码');
      expect(multi).toBeGreaterThan(single);
    });

    it('数据源引用提高刺激 / data source references increase stimulus', () => {
      const noData = advisor.computeStimulus('帮我写个函数');
      const withData = advisor.computeStimulus('从 GitHub API 和数据库获取数据进行分析');
      expect(withData).toBeGreaterThan(noData);
    });

    it('结果在 [0, 1] 范围 / result is in [0, 1] range', () => {
      const inputs = [
        '',
        '你好',
        '分析并评估这个非常复杂的多维度方案，首先从 API 获取数据，然后比较，最后统计汇总结果并验证',
        'a'.repeat(500),
      ];
      for (const input of inputs) {
        const s = advisor.computeStimulus(input);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }
    });

    it('CJK 字符按 3x 信息密度计算 / CJK chars counted at 3x density', () => {
      // 88 个中文字符 → effectiveLength = 264 → lengthScore ≈ 0.78
      // 88 个英文字符 → effectiveLength = 88  → lengthScore ≈ 0.10
      const chineseText = '帮我分析这个复杂的多维度方案的可行性和潜在风险评估以及相关的技术方案对比和最终结论' +
        '包括数据分析和市场趋势预测以及竞争对手分析'; // ~50 chars with keywords
      const englishText = 'a'.repeat(chineseText.length); // same char count, no keywords

      const chStim = advisor.computeStimulus(chineseText);
      const enStim = advisor.computeStimulus(englishText);

      // 中文应该因为 CJK 乘数获得更高的 lengthScore
      expect(chStim).toBeGreaterThan(enStim);
    });

    it('中等长度中文任务应获得合理刺激值 / medium Chinese task gets reasonable stimulus', () => {
      // 真实场景: 88 字符中文任务（之前 proof log 中的例子）
      const realTask = '请帮我分析Node.js的Worker Threads和Cluster模块的适用场景差异，然后基于分析结果设计一个混合并发架构方案，需要同时处理CPU密集型任务';
      const stimulus = advisor.computeStimulus(realTask);
      // 应该 > 0.5 (中等复杂度), 修复前只有 ~0.52 因为 lengthScore 被低估
      expect(stimulus).toBeGreaterThan(0.5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // _computeEffectiveLength (CJK 感知)
  // ═══════════════════════════════════════════════════════════════════════

  describe('_computeEffectiveLength', () => {
    it('纯英文文本 effectiveLength = 字符数 / pure ASCII effectiveLength = char count', () => {
      expect(advisor._computeEffectiveLength('hello world')).toBe(11);
    });

    it('纯中文文本 effectiveLength = 字符数 × 3 / pure CJK effectiveLength = chars × 3', () => {
      // 5 个 CJK 字符 → 15
      expect(advisor._computeEffectiveLength('你好世界啊')).toBe(15);
    });

    it('中英混合文本正确计算 / mixed CJK+ASCII correctly computed', () => {
      // '分析 API 数据' → 3 CJK(分析数) + ... let me be exact
      // '分析API数据' → 分(CJK) 析(CJK) A(ASCII) P(ASCII) I(ASCII) 数(CJK) 据(CJK) = 4*3 + 3 = 15
      expect(advisor._computeEffectiveLength('分析API数据')).toBe(4 * 3 + 3);
    });

    it('空字符串返回 0 / empty string returns 0', () => {
      expect(advisor._computeEffectiveLength('')).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // isHighStimulus
  // ═══════════════════════════════════════════════════════════════════════

  describe('isHighStimulus', () => {
    it('使用 ResponseThreshold.shouldRespond / uses ResponseThreshold.shouldRespond', () => {
      mockRT._setThreshold(0.3);
      expect(advisor.isHighStimulus(0.5)).toBe(true);
      expect(advisor.isHighStimulus(0.2)).toBe(false);
    });

    it('无 ResponseThreshold 时使用硬阈值 0.5 / fallback to 0.5 without RT', () => {
      const bareAdvisor = new SwarmAdvisor({ logger });
      expect(bareAdvisor.isHighStimulus(0.6)).toBe(true);
      expect(bareAdvisor.isHighStimulus(0.4)).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // buildCapabilityProfile
  // ═══════════════════════════════════════════════════════════════════════

  describe('buildCapabilityProfile', () => {
    it('包含 D1/D3/D2 能力描述 / contains D1/D3/D2 capability descriptions', () => {
      const profile = advisor.buildCapabilityProfile();
      expect(profile).toContain('D1(侦察蜂)');
      expect(profile).toContain('D3(工蜂)');
      expect(profile).toContain('D2(审查蜂)');
      expect(profile).toContain('蜂群协作能力');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // buildAdvisoryContext
  // ═══════════════════════════════════════════════════════════════════════

  describe('buildAdvisoryContext', () => {
    it('高刺激时包含完整能力画像 / high stimulus includes full capability profile', () => {
      mockRT._setThreshold(0.3);
      const ctx = advisor.buildAdvisoryContext('复杂任务', 0.8);
      expect(ctx).toContain('蜂群协作能力');
      expect(ctx).toContain('D1(侦察蜂)');
      expect(ctx).toContain('D3(工蜂)');
      expect(ctx).toContain('D2(审查蜂)');
      expect(ctx).toContain('任务分析');
      expect(ctx).toContain('swarm_run');
    });

    it('低刺激时仅简短"D1/D3/D2 待命" / low stimulus shows brief standby text', () => {
      mockRT._setThreshold(0.6);
      const ctx = advisor.buildAdvisoryContext('你好', 0.2);
      expect(ctx).toContain('D1/D3/D2 待命');
      expect(ctx).not.toContain('蜂群协作能力');
    });

    it('包含刺激值数字 / contains stimulus value', () => {
      mockRT._setThreshold(0.3);
      const ctx = advisor.buildAdvisoryContext('复杂分析任务', 0.72);
      expect(ctx).toContain('0.72');
    });

    it('强建议包含具体调用示例 / strong rec includes call example', () => {
      mockRT._setThreshold(0.3);
      const ctx = advisor.buildAdvisoryContext('复杂任务', 0.8);
      expect(ctx).toContain('swarm_run');
      expect(ctx).toContain('goal:');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // buildTaskAnalysis
  // ═══════════════════════════════════════════════════════════════════════

  describe('buildTaskAnalysis', () => {
    it('高复杂度标注"高" / high complexity labeled "高"', () => {
      const text = advisor.buildTaskAnalysis('复杂分析', 0.8);
      expect(text).toContain('高');
    });

    it('检测多分析维度 / detects multi-analysis dimensions', () => {
      const text = advisor.buildTaskAnalysis('分析市场趋势并比较竞品，评估投资风险', 0.7);
      expect(text).toContain('多分析维度');
    });

    it('检测数据源引用 / detects data source references', () => {
      const text = advisor.buildTaskAnalysis('从 API 获取数据', 0.6);
      expect(text).toContain('需外部数据源');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // buildRecommendation
  // ═══════════════════════════════════════════════════════════════════════

  describe('buildRecommendation', () => {
    it('高 surplus 时产生行动指令 / high surplus produces action directive', () => {
      mockRT._setThreshold(0.3);
      const rec = advisor.buildRecommendation(0.8);
      expect(rec).toContain('请使用 swarm_run');
      expect(rec).toContain('goal:');
    });

    it('中等 surplus 时产生建议 + 调用示例 / medium surplus produces suggestion with example', () => {
      mockRT._setThreshold(0.4);
      const rec = advisor.buildRecommendation(0.6);
      expect(rec).toContain('swarm_run');
      expect(rec).toContain('goal:');
    });

    it('低 surplus 时产生弱提示 / low surplus produces mild hint', () => {
      mockRT._setThreshold(0.45);
      const rec = advisor.buildRecommendation(0.5);
      expect(rec).toContain('swarm_run');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // handleLayer0
  // ═══════════════════════════════════════════════════════════════════════

  describe('handleLayer0', () => {
    it('计算并存储刺激值 / computes and stores stimulus', () => {
      const result = advisor.handleLayer0('分析API数据', 'turn-1');
      expect(result.stimulus).toBeGreaterThan(0);
      expect(result.turnId).toBe('turn-1');

      const state = advisor.getTurnState('turn-1');
      expect(state.stimulus).toBe(result.stimulus);
    });

    it('emit recruit 信息素 / emits recruit pheromone', () => {
      advisor.handleLayer0('帮我分析一下市场', 'turn-2');
      // stimulus > 0.1 时应该 emit
      if (advisor.computeStimulus('帮我分析一下市场') > 0.1) {
        expect(mockPheromone._pheromones.length).toBeGreaterThan(0);
        expect(mockPheromone._pheromones[0].type).toBe('recruit');
      }
    });

    it('发布 SWARM_ADVISORY_INJECTED 事件 / publishes SWARM_ADVISORY_INJECTED event', () => {
      advisor.handleLayer0('测试', 'turn-3');
      const advisoryEvents = mockBus._published.filter(
        e => e.topic === 'swarm.advisory.injected'
      );
      expect(advisoryEvents.length).toBeGreaterThan(0);
      expect(advisoryEvents[0].data.payload.layer).toBe(0);
    });

    it('更新统计数据 / updates statistics', () => {
      advisor.handleLayer0('任务一', 't1');
      advisor.handleLayer0('任务二', 't2');

      const stats = advisor.getStats();
      expect(stats.layer0Fires).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // handleLayer1
  // ═══════════════════════════════════════════════════════════════════════

  describe('handleLayer1', () => {
    it('高刺激时返回上下文 / returns context for high stimulus', () => {
      mockRT._setThreshold(0.3);
      advisor.handleLayer0('分析API数据并评估结果，首先获取数据源文档', 'turn-h');

      const result = advisor.handleLayer1('分析API数据并评估结果，首先获取数据源文档', 'turn-h');
      expect(result).not.toBeNull();
      expect(result.context).toContain('蜂群');
    });

    it('无 turn 状态时返回 null / returns null when no turn state', () => {
      const result = advisor.handleLayer1('任何输入', 'nonexistent');
      expect(result).toBeNull();
    });

    it('总是返回上下文 (低刺激也有简短提示) / always returns context (brief hint for low stimulus)', () => {
      advisor.handleLayer0('你好', 'turn-l');
      const result = advisor.handleLayer1('你好', 'turn-l');
      expect(result).not.toBeNull();
      expect(result.context).toContain('待命');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // recordOutcome (PI 控制器反馈)
  // ═══════════════════════════════════════════════════════════════════════

  describe('recordOutcome', () => {
    it('helpful → adjust(0.8) / helpful triggers high activity rate', () => {
      advisor.recordOutcome('turn-x', true);
      expect(mockRT._adjustments.length).toBe(1);
      expect(mockRT._adjustments[0].rate).toBe(0.8);
    });

    it('not helpful → adjust(0.2) / not helpful triggers low activity rate', () => {
      advisor.recordOutcome('turn-y', false);
      expect(mockRT._adjustments.length).toBe(1);
      expect(mockRT._adjustments[0].rate).toBe(0.2);
    });

    it('无 ResponseThreshold 时安全跳过 / safe skip without RT', () => {
      const bareAdvisor = new SwarmAdvisor({ logger });
      // 不应抛出
      expect(() => bareAdvisor.recordOutcome('turn-z', true)).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Turn 隔离 / Turn Isolation
  // ═══════════════════════════════════════════════════════════════════════

  describe('turn isolation', () => {
    it('resetTurn 创建独立条目 / resetTurn creates independent entries', () => {
      advisor.resetTurn('t1');
      advisor.resetTurn('t2');

      const s1 = advisor.getTurnState('t1');
      const s2 = advisor.getTurnState('t2');
      expect(s1).toBeDefined();
      expect(s2).toBeDefined();
      expect(s1.turnId).toBe('t1');
      expect(s2.turnId).toBe('t2');
    });

    it('快速连发 2 条消息, 两个 turn 状态互不干扰 / rapid fire 2 messages, states are independent', () => {
      // 模拟用户快速发送两条消息
      advisor.handleLayer0('简单问候', 'turn-a');
      advisor.handleLayer0('帮我分析复杂的API数据并首先调研文档然后统计', 'turn-b');

      const stateA = advisor.getTurnState('turn-a');
      const stateB = advisor.getTurnState('turn-b');

      // 两个 turn 的刺激值不同
      expect(stateA.stimulus).not.toBe(stateB.stimulus);
      // B 的刺激应该更高
      expect(stateB.stimulus).toBeGreaterThan(stateA.stimulus);
    });

    it('markSwarmToolUsed 只影响指定 turn / markSwarmToolUsed only affects target turn', () => {
      advisor.handleLayer0('任务1', 't1');
      advisor.handleLayer0('任务2', 't2');

      advisor.markSwarmToolUsed('t1');

      expect(advisor.getTurnState('t1').swarmToolCalled).toBe(true);
      expect(advisor.getTurnState('t2').swarmToolCalled).toBe(false);
    });

    it('超过 MAX_TURNS(50) 自动清理最旧条目 / exceeding MAX_TURNS auto-cleans oldest', () => {
      // 创建 55 个 turn
      for (let i = 0; i < 55; i++) {
        advisor.resetTurn(`turn-${i}`);
      }

      // 应该只保留 50 个
      const stats = advisor.getStats();
      expect(stats.activeTurns).toBeLessThanOrEqual(50);

      // 最旧的 5 个应该被清理
      expect(advisor.getTurnState('turn-0')).toBeUndefined();
      expect(advisor.getTurnState('turn-4')).toBeUndefined();
      // 最新的应该还在
      expect(advisor.getTurnState('turn-54')).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 构造函数 + 生命周期 / Constructor + Lifecycle
  // ═══════════════════════════════════════════════════════════════════════

  describe('constructor and lifecycle', () => {
    it('可以无依赖创建 / can be created with no dependencies', () => {
      const bareAdvisor = new SwarmAdvisor({});
      expect(bareAdvisor).toBeDefined();
      expect(bareAdvisor.getStats().layer0Fires).toBe(0);
    });

    it('destroy 清理所有 turn / destroy clears all turns', () => {
      advisor.handleLayer0('任务', 't1');
      advisor.handleLayer0('任务', 't2');
      expect(advisor.getStats().activeTurns).toBe(2);

      advisor.destroy();
      expect(advisor.getStats().activeTurns).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getStats
  // ═══════════════════════════════════════════════════════════════════════

  describe('getStats', () => {
    it('返回综合统计 / returns comprehensive statistics', () => {
      advisor.handleLayer0('测试任务', 't1');
      advisor.markSwarmToolUsed('t1');

      const stats = advisor.getStats();
      expect(stats.layer0Fires).toBe(1);
      expect(stats.swarmToolUsages).toBe(1);
      expect(stats.currentThreshold).toBeDefined();
      expect(stats.avgStimulus).toBeDefined();
      expect(stats.activeTurns).toBe(1);
    });

    it('avgStimulus 正确计算 / avgStimulus calculated correctly', () => {
      advisor.handleLayer0('短', 't1');
      advisor.handleLayer0('帮我分析复杂的多步骤任务并首先从API获取数据然后评估', 't2');

      const stats = advisor.getStats();
      expect(stats.avgStimulus).toBeGreaterThan(0);
      expect(stats.avgStimulus).toBeLessThanOrEqual(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // checkToolRouting / Tool Routing State Machine
  // ═══════════════════════════════════════════════════════════════════════

  describe('checkToolRouting', () => {
    it('T0/T1 swarm 工具始终放行 / T0/T1 swarm tools always allowed', () => {
      advisor.handleLayer0('帮我分析复杂的多步骤API任务并首先调研文档然后统计评估', 'turn-r1');
      // 确保 swarmPlanRequired 为 true
      const state = advisor.getTurnState('turn-r1');
      expect(state.swarmPlanRequired).toBe(true);

      // V6.3: T0 只读工具放行
      expect(advisor.checkToolRouting('turn-r1', 'swarm_query')).toBeUndefined();
      // V6.3: T1 swarm_run, swarm_dispatch 放行
      expect(advisor.checkToolRouting('turn-r1', 'swarm_run')).toBeUndefined();
      expect(advisor.checkToolRouting('turn-r1', 'swarm_dispatch')).toBeUndefined();
    });

    it('T2 工具在 swarm 未完成时被引导 / T2 tools guided when swarm not completed', () => {
      advisor.handleLayer0('帮我分析复杂的多步骤API任务并首先调研文档然后统计评估', 'turn-t2');
      expect(advisor.getTurnState('turn-t2').swarmPlanRequired).toBe(true);

      // V6.3: swarm_spawn 已废弃为 EXTERNAL, 在 PREPLAN/BRAKE 中被 block
      const result = advisor.checkToolRouting('turn-t2', 'swarm_spawn');
      expect(result).toBeDefined();
      expect(result.block).toBe(true);
      expect(result.blockReason).toContain('swarm_run');

      // 完成 swarm 后 T2 放行
      advisor.markSwarmToolUsed('turn-t2');
      expect(advisor.checkToolRouting('turn-t2', 'swarm_spawn')).toBeUndefined();
    });

    it('高刺激 turn 中, 非 swarm 工具被 block / high stimulus blocks non-swarm tools', () => {
      advisor.handleLayer0('帮我分析复杂的多步骤API任务并首先调研文档然后统计评估', 'turn-r2');
      expect(advisor.getTurnState('turn-r2').swarmPlanRequired).toBe(true);

      const result = advisor.checkToolRouting('turn-r2', 'Read');
      expect(result).toBeDefined();
      expect(result.block).toBe(true);
      expect(result.blockReason).toContain('swarm_run');
    });

    it('swarm tool 完成后放行所有工具 / after swarm tool used, all tools allowed', () => {
      advisor.handleLayer0('帮我分析复杂的多步骤API任务并首先调研文档然后统计评估', 'turn-r3');
      expect(advisor.getTurnState('turn-r3').swarmPlanRequired).toBe(true);

      // 标记 swarm tool 完成
      advisor.markSwarmToolUsed('turn-r3');

      // 之后所有工具放行
      expect(advisor.checkToolRouting('turn-r3', 'Read')).toBeUndefined();
      expect(advisor.checkToolRouting('turn-r3', 'Exec')).toBeUndefined();
      expect(advisor.checkToolRouting('turn-r3', 'Bash')).toBeUndefined();
    });

    it('低刺激 turn 不触发路由约束 / low stimulus turns have no routing constraint', () => {
      advisor.handleLayer0('你好', 'turn-r4');
      expect(advisor.getTurnState('turn-r4').swarmPlanRequired).toBe(false);

      // 不 block 任何工具
      expect(advisor.checkToolRouting('turn-r4', 'Read')).toBeUndefined();
      expect(advisor.checkToolRouting('turn-r4', 'Exec')).toBeUndefined();
    });

    it('不存在的 turnId 安全返回 undefined / unknown turnId returns undefined', () => {
      expect(advisor.checkToolRouting('nonexistent', 'Read')).toBeUndefined();
    });

    it('blockReason 包含用户输入摘要 / blockReason includes user input summary', () => {
      const input = '请帮我分析Node.js的Worker Threads和Cluster模块的适用场景差异，然后基于分析结果设计一个混合并发架构方案，需要同时处理CPU密集型任务和高并发I/O请求，最后给出完整的代码实现和性能测试方案';
      advisor.handleLayer0(input, 'turn-r5');
      // 这个长输入应触发高刺激
      expect(advisor.getTurnState('turn-r5').swarmPlanRequired).toBe(true);

      const result = advisor.checkToolRouting('turn-r5', 'Bash');
      expect(result?.block).toBe(true);
      expect(result.blockReason).toContain('swarm_run');
      // blockReason 包含截取的用户输入
      expect(result.blockReason).toContain('分析');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // V5.4: aggregateSignals (多信号聚合)
  // ═══════════════════════════════════════════════════════════════════════

  describe('aggregateSignals', () => {
    it('无信号源时 composite = textStimulus / without engines composite equals text stimulus', () => {
      const bareAdvisor = new SwarmAdvisor({ logger });
      const { composite, signals } = bareAdvisor.aggregateSignals('帮我分析API数据并首先调研文档然后统计');
      // 无信号源时, 所有权重分配给 text
      expect(composite).toBe(signals.textStimulus);
      expect(signals.pressureSignal).toBe(0);
      expect(signals.failureSignal).toBe(0);
      expect(signals.breakerSignal).toBe(0);
      expect(signals.boardSignal).toBe(0);
    });

    it('返回 5 路信号分解 / returns 5-channel signal breakdown', () => {
      const { signals } = advisor.aggregateSignals('分析任务');
      expect(signals).toHaveProperty('textStimulus');
      expect(signals).toHaveProperty('pressureSignal');
      expect(signals).toHaveProperty('failureSignal');
      expect(signals).toHaveProperty('breakerSignal');
      expect(signals).toHaveProperty('boardSignal');
      expect(signals).toHaveProperty('composite');
    });

    it('composite 在 [0, 1] 范围 / composite is in [0, 1]', () => {
      const inputs = ['', '你好', '分析并评估多步骤API任务首先然后最后'];
      for (const input of inputs) {
        const { composite } = advisor.aggregateSignals(input);
        expect(composite).toBeGreaterThanOrEqual(0);
        expect(composite).toBeLessThanOrEqual(1);
      }
    });

    it('PheromoneResponseMatrix 信号提升 composite / PRM signal boosts composite', () => {
      const mockPRM = {
        getStats: () => ({ trackedTasks: 5, escalations: 3, scans: 10, recruitsEmitted: 3, k: 0.3, escalationThreshold: 0.9 }),
      };
      const advisorWithPRM = new SwarmAdvisor({
        pheromoneResponseMatrix: mockPRM,
        logger,
      });
      const bareAdvisor = new SwarmAdvisor({ logger });

      const input = '帮我分析一下';
      const withPRM = advisorWithPRM.aggregateSignals(input);
      const without = bareAdvisor.aggregateSignals(input);

      expect(withPRM.composite).toBeGreaterThan(without.composite);
      expect(withPRM.signals.pressureSignal).toBeGreaterThan(0);
    });

    it('FailureVaccination 信号提升 composite / FV signal boosts composite', () => {
      const mockFV = {
        getStats: () => ({ vaccinesCreated: 5, applied: 10, successes: 8, misses: 2, cachedVaccines: 4 }),
      };
      const advisorWithFV = new SwarmAdvisor({
        failureVaccination: mockFV,
        logger,
      });
      const bareAdvisor = new SwarmAdvisor({ logger });

      const input = '帮我处理一个任务';
      const withFV = advisorWithFV.aggregateSignals(input);
      const without = bareAdvisor.aggregateSignals(input);

      expect(withFV.composite).toBeGreaterThan(without.composite);
      expect(withFV.signals.failureSignal).toBeGreaterThan(0);
    });

    it('ToolResilience OPEN breaker 提升 composite / open breaker boosts composite', () => {
      const mockTR = {
        getCircuitBreakerStates: () => ({ 'Bash': 'OPEN', 'Read': 'CLOSED', 'Write': 'CLOSED' }),
      };
      const advisorWithTR = new SwarmAdvisor({
        toolResilience: mockTR,
        logger,
      });
      const bareAdvisor = new SwarmAdvisor({ logger });

      const input = '执行任务';
      const withTR = advisorWithTR.aggregateSignals(input);
      const without = bareAdvisor.aggregateSignals(input);

      expect(withTR.composite).toBeGreaterThan(without.composite);
      expect(withTR.signals.breakerSignal).toBeGreaterThan(0);
    });

    it('StigmergicBoard 活跃公告提升 composite / active posts boost composite', () => {
      const mockBoard = {
        getStats: () => ({ posted: 10, read: 5, expired: 2, activePosts: 4 }),
      };
      const advisorWithBoard = new SwarmAdvisor({
        stigmergicBoard: mockBoard,
        logger,
      });
      const bareAdvisor = new SwarmAdvisor({ logger });

      const input = '处理任务';
      const withBoard = advisorWithBoard.aggregateSignals(input);
      const without = bareAdvisor.aggregateSignals(input);

      expect(withBoard.composite).toBeGreaterThan(without.composite);
      expect(withBoard.signals.boardSignal).toBeGreaterThan(0);
    });

    it('全信号源连接时权重分配正确 / all sources connected weight distribution correct', () => {
      const advisorFull = new SwarmAdvisor({
        pheromoneResponseMatrix: { getStats: () => ({ trackedTasks: 0, escalations: 0 }) },
        failureVaccination: { getStats: () => ({ cachedVaccines: 0, applied: 0, successes: 0 }) },
        toolResilience: { getCircuitBreakerStates: () => ({}) },
        stigmergicBoard: { getStats: () => ({ activePosts: 0 }) },
        logger,
      });
      // 当所有信号源连接但都返回 0 信号时, composite 只来自 text
      const { signals } = advisorFull.aggregateSignals('帮我分析API');
      expect(signals.pressureSignal).toBe(0);
      expect(signals.failureSignal).toBe(0);
      expect(signals.breakerSignal).toBe(0);
      expect(signals.boardSignal).toBe(0);
      // composite 应该 < textStimulus (因为 text 权重只有 0.35)
      expect(signals.composite).toBeLessThan(signals.textStimulus);
    });

    it('引擎异常不影响聚合 / engine errors do not break aggregation', () => {
      const advisorBroken = new SwarmAdvisor({
        pheromoneResponseMatrix: { getStats: () => { throw new Error('broken'); } },
        failureVaccination: { getStats: () => { throw new Error('broken'); } },
        toolResilience: { getCircuitBreakerStates: () => { throw new Error('broken'); } },
        stigmergicBoard: { getStats: () => { throw new Error('broken'); } },
        logger,
      });
      // 不应抛出, 且 composite 应该等于纯文本 (因为异常信号为 0 但引擎"存在"所以权重被分配)
      expect(() => advisorBroken.aggregateSignals('测试')).not.toThrow();
      const { composite } = advisorBroken.aggregateSignals('测试');
      expect(composite).toBeGreaterThanOrEqual(0);
    });

    it('更新 signalAggregations 统计 / updates signalAggregations stat', () => {
      advisor.aggregateSignals('测试1');
      advisor.aggregateSignals('测试2');
      expect(advisor.getStats().signalAggregations).toBeGreaterThanOrEqual(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // V5.4: 工具安全分级 / Tool Safety Classification
  // ═══════════════════════════════════════════════════════════════════════

  describe('tool safety classification', () => {
    it('T0 只读工具正确分类 / T0 read-only tools classified correctly', () => {
      // V6.3: 9→3 工具精简 / 9→3 tool consolidation
      expect(SwarmAdvisor.getToolSafetyClass('swarm_query')).toBe('T0_READONLY');
    });

    it('T1 有限范围工具正确分类 / T1 scoped tools classified correctly', () => {
      // V6.3: 9→3 工具精简
      expect(SwarmAdvisor.getToolSafetyClass('swarm_run')).toBe('T1_SCOPED');
      expect(SwarmAdvisor.getToolSafetyClass('swarm_dispatch')).toBe('T1_SCOPED');
    });

    it('废弃工具返回 EXTERNAL / deprecated tools return EXTERNAL', () => {
      // V6.3: 已废弃工具不再有安全分级, 返回 EXTERNAL
      expect(SwarmAdvisor.getToolSafetyClass('swarm_spawn')).toBe('EXTERNAL');
      expect(SwarmAdvisor.getToolSafetyClass('swarm_memory')).toBe('EXTERNAL');
      expect(SwarmAdvisor.getToolSafetyClass('swarm_plan')).toBe('EXTERNAL');
      expect(SwarmAdvisor.getToolSafetyClass('swarm_pheromone')).toBe('EXTERNAL');
    });

    it('未知工具返回 EXTERNAL / unknown tools return EXTERNAL', () => {
      expect(SwarmAdvisor.getToolSafetyClass('Read')).toBe('EXTERNAL');
      expect(SwarmAdvisor.getToolSafetyClass('Bash')).toBe('EXTERNAL');
      expect(SwarmAdvisor.getToolSafetyClass('unknown_tool')).toBe('EXTERNAL');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // V5.4: handleLayer0 信号存储 / Layer0 signal storage
  // ═══════════════════════════════════════════════════════════════════════

  describe('handleLayer0 V5.4 signals', () => {
    it('turn 状态存储信号分解 / turn state stores signal breakdown', () => {
      advisor.handleLayer0('分析API数据', 'turn-sig');
      const state = advisor.getTurnState('turn-sig');
      expect(state.signals).toBeDefined();
      expect(state.signals.textStimulus).toBeDefined();
      expect(state.signals.composite).toBeDefined();
    });

    it('recruit 信息素 payload 包含 signals / recruit pheromone payload includes signals', () => {
      advisor.handleLayer0('帮我分析复杂API', 'turn-phero');
      if (mockPheromone._pheromones.length > 0) {
        const payload = mockPheromone._pheromones[mockPheromone._pheromones.length - 1].payload;
        expect(payload.signals).toBeDefined();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // V5.4: _buildRoutingRationale
  // ═══════════════════════════════════════════════════════════════════════

  describe('_buildRoutingRationale', () => {
    it('无信号时返回空字符串 / returns empty string without signals', () => {
      expect(advisor._buildRoutingRationale(null)).toBe('');
      expect(advisor._buildRoutingRationale(undefined)).toBe('');
    });

    it('高压力信号生成理由 / high pressure signal generates rationale', () => {
      const rationale = advisor._buildRoutingRationale({
        textStimulus: 0.2,
        pressureSignal: 0.5,
        failureSignal: 0,
        breakerSignal: 0,
        boardSignal: 0,
      });
      expect(rationale).toContain('滞留任务');
    });

    it('多信号组合生成多条理由 / multiple signals generate multiple reasons', () => {
      const rationale = advisor._buildRoutingRationale({
        textStimulus: 0.6,
        pressureSignal: 0.5,
        failureSignal: 0.4,
        breakerSignal: 0.3,
        boardSignal: 0.5,
      });
      expect(rationale).toContain(';');
      expect(rationale).toContain('滞留任务');
      expect(rationale).toContain('蜂群修复');
      expect(rationale).toContain('断路器');
      expect(rationale).toContain('公告板');
      expect(rationale).toContain('复杂度');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // V5.4: adaptive-arbiter 四态仲裁 / 4-State Adaptive Arbiter
  // ═══════════════════════════════════════════════════════════════════════

  describe('adaptive arbiter', () => {
    it('ARBITER_MODES 导出 4 种模式 / exports 4 modes', () => {
      expect(ARBITER_MODES.DIRECT).toBe('DIRECT');
      expect(ARBITER_MODES.BIAS_SWARM).toBe('BIAS_SWARM');
      expect(ARBITER_MODES.PREPLAN).toBe('PREPLAN');
      expect(ARBITER_MODES.BRAKE).toBe('BRAKE');
    });

    it('静态访问 ARBITER_MODES / static access to ARBITER_MODES', () => {
      expect(SwarmAdvisor.ARBITER_MODES).toBeDefined();
      expect(SwarmAdvisor.ARBITER_MODES.DIRECT).toBe('DIRECT');
    });

    describe('_computeArbiterMode', () => {
      it('低 composite → DIRECT / low composite gives DIRECT', () => {
        // threshold=0.5, 0.5*0.7=0.35, composite=0.2 < 0.35 → DIRECT
        expect(advisor._computeArbiterMode(0.2, null)).toBe(ARBITER_MODES.DIRECT);
      });

      it('接近阈值 composite → BIAS_SWARM / near-threshold gives BIAS_SWARM', () => {
        // threshold=0.5, 0.35 < composite=0.4 <= 0.5 → BIAS_SWARM
        expect(advisor._computeArbiterMode(0.4, null)).toBe(ARBITER_MODES.BIAS_SWARM);
      });

      it('超过阈值 composite → PREPLAN / above-threshold gives PREPLAN', () => {
        // threshold=0.5, composite=0.7 > 0.5 → PREPLAN (无环境告警)
        expect(advisor._computeArbiterMode(0.7, null)).toBe(ARBITER_MODES.PREPLAN);
        expect(advisor._computeArbiterMode(0.7, { breakerSignal: 0, pressureSignal: 0, failureSignal: 0, boardSignal: 0 })).toBe(ARBITER_MODES.PREPLAN);
      });

      it('超过阈值 + 2个环境告警 → BRAKE / above-threshold + 2 env alerts gives BRAKE', () => {
        expect(advisor._computeArbiterMode(0.7, {
          breakerSignal: 0.5,    // > 0.3 ✓
          pressureSignal: 0.6,   // > 0.5 ✓
          failureSignal: 0.2,    // < 0.4 ✗
          boardSignal: 0.1,      // < 0.5 ✗
        })).toBe(ARBITER_MODES.BRAKE);
      });

      it('超过阈值 + 1个环境告警 → PREPLAN (不足2个) / 1 env alert still PREPLAN', () => {
        expect(advisor._computeArbiterMode(0.7, {
          breakerSignal: 0.5,    // > 0.3 ✓
          pressureSignal: 0.2,   // < 0.5 ✗
          failureSignal: 0.1,    // < 0.4 ✗
          boardSignal: 0.1,      // < 0.5 ✗
        })).toBe(ARBITER_MODES.PREPLAN);
      });

      it('PI 控制器调节阈值后模式边界随之变化 / threshold changes shift mode boundaries', () => {
        mockRT._setThreshold(0.3);
        // 新边界: DIRECT <= 0.21, BIAS_SWARM 0.21-0.30, PREPLAN > 0.30
        expect(advisor._computeArbiterMode(0.15, null)).toBe(ARBITER_MODES.DIRECT);
        expect(advisor._computeArbiterMode(0.25, null)).toBe(ARBITER_MODES.BIAS_SWARM);
        expect(advisor._computeArbiterMode(0.35, null)).toBe(ARBITER_MODES.PREPLAN);
      });

      it('无 ResponseThreshold 时使用默认阈值 0.5 / uses default threshold without RT', () => {
        const bareAdvisor = new SwarmAdvisor({ logger });
        expect(bareAdvisor._computeArbiterMode(0.2, null)).toBe(ARBITER_MODES.DIRECT);
        expect(bareAdvisor._computeArbiterMode(0.4, null)).toBe(ARBITER_MODES.BIAS_SWARM);
        expect(bareAdvisor._computeArbiterMode(0.6, null)).toBe(ARBITER_MODES.PREPLAN);
      });
    });

    describe('handleLayer0 arbiter mode', () => {
      it('低刺激输入 → arbiterMode=DIRECT / low stimulus → DIRECT', () => {
        advisor.handleLayer0('你好', 'turn-d1');
        const state = advisor.getTurnState('turn-d1');
        expect(state.arbiterMode).toBe(ARBITER_MODES.DIRECT);
        expect(state.swarmPlanRequired).toBe(false);
      });

      it('高刺激输入 → arbiterMode=PREPLAN / high stimulus → PREPLAN', () => {
        advisor.handleLayer0(
          '帮我分析复杂的多步骤API任务并首先调研文档然后统计评估',
          'turn-pp1'
        );
        const state = advisor.getTurnState('turn-pp1');
        expect(state.arbiterMode).toBe(ARBITER_MODES.PREPLAN);
        expect(state.swarmPlanRequired).toBe(true); // 向后兼容
      });

      it('arbiterMode 记录到统计 / arbiterMode tracked in stats', () => {
        advisor.handleLayer0('你好', 't-s1');
        advisor.handleLayer0('你好啊', 't-s2');
        advisor.handleLayer0(
          '帮我分析复杂的多步骤API任务并首先调研文档然后统计评估',
          't-s3'
        );
        const stats = advisor.getStats();
        expect(stats.arbiterModes[ARBITER_MODES.DIRECT]).toBeGreaterThanOrEqual(2);
        expect(stats.arbiterModes[ARBITER_MODES.PREPLAN]).toBeGreaterThanOrEqual(1);
      });

      it('事件 payload 包含 arbiterMode / event payload includes arbiterMode', () => {
        advisor.handleLayer0('分析API', 'turn-evt');
        const events = mockBus._published.filter(e => e.topic === 'swarm.advisory.injected');
        const lastEvent = events[events.length - 1];
        expect(lastEvent.data.payload.arbiterMode).toBeDefined();
      });
    });

    describe('BIAS_SWARM mode routing', () => {
      let biasAdvisor;

      beforeEach(() => {
        // 使用低阈值让中等输入落入 BIAS_SWARM 区间
        const lowRT = createMockResponseThreshold();
        lowRT._setThreshold(0.5);
        biasAdvisor = new SwarmAdvisor({
          responseThreshold: lowRT,
          pheromoneEngine: mockPheromone,
          messageBus: mockBus,
          logger,
        });
      });

      it('BIAS_SWARM 模式: T0/T1/EXTERNAL 全部放行 / BIAS_SWARM: T0/T1/EXTERNAL all pass', () => {
        // V6.3: 9→3 精简后无 T2 工具, BIAS_SWARM 仅影响概念上的 T2
        // BIAS_SWARM 下 T0, T1, EXTERNAL 全放行
        const turnId = biasAdvisor.resetTurn('turn-bias');
        const state = biasAdvisor._turns.get(turnId);
        state.arbiterMode = ARBITER_MODES.BIAS_SWARM;
        state.swarmPlanRequired = false;

        // EXTERNAL 放行 (V6.3: 废弃工具也是 EXTERNAL)
        expect(biasAdvisor.checkToolRouting(turnId, 'Read')).toBeUndefined();
        expect(biasAdvisor.checkToolRouting(turnId, 'Bash')).toBeUndefined();
        expect(biasAdvisor.checkToolRouting(turnId, 'swarm_spawn')).toBeUndefined();

        // T0 放行
        expect(biasAdvisor.checkToolRouting(turnId, 'swarm_query')).toBeUndefined();

        // T1 放行
        expect(biasAdvisor.checkToolRouting(turnId, 'swarm_run')).toBeUndefined();
        expect(biasAdvisor.checkToolRouting(turnId, 'swarm_dispatch')).toBeUndefined();
      });
    });

    describe('BRAKE mode routing', () => {
      it('BRAKE 模式 blockReason 包含环境异常提示 / BRAKE blockReason includes env alert', () => {
        const turnId = advisor.resetTurn('turn-brake');
        const state = advisor._turns.get(turnId);
        state.arbiterMode = ARBITER_MODES.BRAKE;
        state.userInput = '紧急任务';

        // V6.3: swarm_spawn 现为 EXTERNAL, 与 Read 走相同路径
        // swarm_spawn (EXTERNAL) blocked in BRAKE
        const t2Result = advisor.checkToolRouting(turnId, 'swarm_spawn');
        expect(t2Result.block).toBe(true);
        expect(t2Result.blockReason).toContain('环境信号异常');

        // Read (EXTERNAL) blocked with BRAKE prefix
        const extResult = advisor.checkToolRouting(turnId, 'Read');
        expect(extResult.block).toBe(true);
        expect(extResult.blockReason).toContain('环境信号异常');
      });

      it('BRAKE 模式 swarm 完成后放行 / BRAKE allows all after swarm done', () => {
        const turnId = advisor.resetTurn('turn-brake2');
        const state = advisor._turns.get(turnId);
        state.arbiterMode = ARBITER_MODES.BRAKE;

        advisor.markSwarmToolUsed(turnId);
        expect(advisor.checkToolRouting(turnId, 'Read')).toBeUndefined();
        expect(advisor.checkToolRouting(turnId, 'swarm_spawn')).toBeUndefined();
      });
    });

    describe('DIRECT mode routing', () => {
      it('DIRECT 模式无约束 / DIRECT has no constraints', () => {
        const turnId = advisor.resetTurn('turn-dir');
        const state = advisor._turns.get(turnId);
        state.arbiterMode = ARBITER_MODES.DIRECT;

        expect(advisor.checkToolRouting(turnId, 'Read')).toBeUndefined();
        expect(advisor.checkToolRouting(turnId, 'Bash')).toBeUndefined();
        expect(advisor.checkToolRouting(turnId, 'swarm_spawn')).toBeUndefined();
        expect(advisor.checkToolRouting(turnId, 'swarm_query')).toBeUndefined();
      });
    });

    describe('buildAdvisoryContext by mode', () => {
      it('BRAKE 模式包含环境告警 / BRAKE includes env alerts', () => {
        mockRT._setThreshold(0.3);
        const ctx = advisor.buildAdvisoryContext('紧急任务', 0.9, {
          textStimulus: 0.6,
          pressureSignal: 0.7,
          failureSignal: 0.5,
          breakerSignal: 0.5,
          boardSignal: 0.6,
        });
        expect(ctx).toContain('紧急行动');
        expect(ctx).toContain('环境告警');
        expect(ctx).toContain('蜂群协作能力');
      });

      it('BIAS_SWARM 模式包含可跳过提示 / BIAS_SWARM includes opt-out hint', () => {
        mockRT._setThreshold(0.5);
        const ctx = advisor.buildAdvisoryContext('中等任务', 0.4, null);
        expect(ctx).toContain('不需要协作');
        expect(ctx).toContain('直接回答');
        expect(ctx).toContain('蜂群协作能力');
        expect(ctx).toContain('swarm_run');
      });

      it('PREPLAN 模式与 V5.3 高信号行为一致 / PREPLAN matches V5.3 high-signal behavior', () => {
        mockRT._setThreshold(0.3);
        const ctx = advisor.buildAdvisoryContext('复杂任务', 0.8, null);
        expect(ctx).toContain('蜂群协作能力');
        expect(ctx).toContain('swarm_run');
        expect(ctx).toContain('任务分析');
        expect(ctx).not.toContain('紧急行动');
        expect(ctx).not.toContain('不需要协作');
      });

      it('DIRECT 模式为简短待命 / DIRECT is brief standby', () => {
        mockRT._setThreshold(0.5);
        const ctx = advisor.buildAdvisoryContext('你好', 0.1, null);
        expect(ctx).toContain('D1/D3/D2 待命');
        expect(ctx).not.toContain('蜂群协作能力');
      });
    });

    describe('_buildBrakeAlert', () => {
      it('无信号时返回空 / returns empty without signals', () => {
        expect(advisor._buildBrakeAlert(null)).toBe('');
        expect(advisor._buildBrakeAlert(undefined)).toBe('');
      });

      it('无告警信号时返回空 / returns empty when no alerts', () => {
        expect(advisor._buildBrakeAlert({
          breakerSignal: 0.1,
          pressureSignal: 0.2,
          failureSignal: 0.1,
          boardSignal: 0.1,
        })).toBe('');
      });

      it('超过告警阈值时生成告警文本 / generates alert text above thresholds', () => {
        const alert = advisor._buildBrakeAlert({
          breakerSignal: 0.5,
          pressureSignal: 0.7,
          failureSignal: 0.5,
          boardSignal: 0.3,
        });
        expect(alert).toContain('环境告警');
        expect(alert).toContain('断路器告警');
        expect(alert).toContain('任务压力');
        expect(alert).toContain('失败免疫');
      });
    });

    describe('backward compatibility', () => {
      it('swarmPlanRequired 从 arbiterMode 正确派生 / swarmPlanRequired derived from arbiterMode', () => {
        // DIRECT → false
        advisor.handleLayer0('你好', 'turn-bc1');
        expect(advisor.getTurnState('turn-bc1').swarmPlanRequired).toBe(false);

        // PREPLAN → true
        advisor.handleLayer0(
          '帮我分析复杂的多步骤API任务并首先调研文档然后统计评估',
          'turn-bc2'
        );
        expect(advisor.getTurnState('turn-bc2').swarmPlanRequired).toBe(true);
      });

      it('markSwarmToolUsed 仍然正确工作 / markSwarmToolUsed still works', () => {
        advisor.handleLayer0(
          '帮我分析复杂的多步骤API任务并首先调研文档然后统计评估',
          'turn-bc3'
        );
        expect(advisor.getTurnState('turn-bc3').swarmPlanCompleted).toBe(false);

        advisor.markSwarmToolUsed('turn-bc3');
        expect(advisor.getTurnState('turn-bc3').swarmPlanCompleted).toBe(true);
        expect(advisor.getTurnState('turn-bc3').swarmToolCalled).toBe(true);
      });
    });
  });
});
