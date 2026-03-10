#!/usr/bin/env node
/**
 * V5.3 SwarmAdvisor 端到端诊断脚本
 * 模拟 Layer 0 → Layer 1 → Phase 3 的完整流程
 */
import { SwarmAdvisor } from '../src/L4-orchestration/swarm-advisor.js';
import { buildSwarmContextFallback } from '../src/L3-agent/swarm-context-engine.js';

// 模拟依赖
const mockLogger = { info: console.log, debug: () => {}, warn: console.warn };
const mockMessageBus = { publish: () => {} };
const mockPheromoneEngine = {
  emitPheromone: (p) => console.log(`  [信息素] type=${p.type} intensity=${p.intensity.toFixed(3)}`),
};

// 创建 SwarmAdvisor (无 ResponseThreshold → 硬阈值 0.5)
const advisor = new SwarmAdvisor({
  logger: mockLogger,
  messageBus: mockMessageBus,
  pheromoneEngine: mockPheromoneEngine,
});

console.log('=== V5.3 SwarmAdvisor 端到端诊断 ===\n');

// ── 测试 1: 复杂任务 ──
console.log('── 测试 1: 复杂任务 ──');
const complexInput = '帮我全面分析A股大盘近期走势，需要调研Tushare daily接口获取最近3个月的上证指数数据，然后用Python做均线交叉和MACD技术分析，最后给出操作建议';

// Layer 0
const layer0Result = advisor.handleLayer0(complexInput, 'test-turn-1');
const state1 = advisor.getTurnState('test-turn-1');
console.log(`  stimulus = ${state1.stimulus.toFixed(4)}`);
console.log(`  isHighStimulus = ${advisor.isHighStimulus(state1.stimulus)}`);

// Layer 1
const layer1Result = advisor.handleLayer1(complexInput, 'test-turn-1');
console.log(`  Layer 1 result = ${layer1Result ? 'HAS CONTEXT' : 'NULL'}`);
if (layer1Result?.context) {
  console.log(`  context length = ${layer1Result.context.length}`);
  console.log(`  context preview:\n---`);
  console.log(layer1Result.context.substring(0, 500));
  console.log('---');
}

// Phase 3: 合并
const swarmCtx = buildSwarmContextFallback({
  advisory: layer1Result?.context || null,
});
console.log(`\n  Phase 3 prependSystemContext length = ${swarmCtx?.length || 0}`);
console.log(`  contains advisory = ${swarmCtx?.includes('蜂群') || false}`);

// ── 测试 2: 简单任务 ──
console.log('\n── 测试 2: 简单任务 ──');
const simpleInput = '你好';
advisor.handleLayer0(simpleInput, 'test-turn-2');
const state2 = advisor.getTurnState('test-turn-2');
console.log(`  stimulus = ${state2.stimulus.toFixed(4)}`);
console.log(`  isHighStimulus = ${advisor.isHighStimulus(state2.stimulus)}`);

const layer1Simple = advisor.handleLayer1(simpleInput, 'test-turn-2');
console.log(`  Layer 1 result = ${layer1Simple ? 'HAS CONTEXT' : 'NULL'}`);
if (layer1Simple?.context) {
  console.log(`  context preview: ${layer1Simple.context.substring(0, 100)}`);
}

// ── 统计 ──
console.log('\n── 统计 ──');
const stats = advisor.getStats();
console.log(`  layer0Fires = ${stats.layer0Fires}`);
console.log(`  layer1Injections = ${stats.layer1Injections}`);
console.log(`  avgStimulus = ${stats.avgStimulus.toFixed(4)}`);

advisor.destroy();
console.log('\n✅ 诊断完成');
