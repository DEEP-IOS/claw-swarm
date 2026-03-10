#!/usr/bin/env node
/**
 * V5.3 端到端验证脚本 — 证明 advisory context 在真实插件 hook 管线中被注入
 *
 * 模拟 OpenClaw 调用 register(api) 的完整流程:
 * 1. 调用 plugin.register(mockApi) 注册所有 hooks
 * 2. 按 priority 顺序触发 before_prompt_build
 * 3. 捕获返回的 prependSystemContext
 * 4. 验证 advisory 内容是否存在
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// 创建临时 in-memory DB 目录
const tmpDir = join(homedir(), '.openclaw', 'claw-swarm');
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
const testDbPath = join(tmpDir, 'verify-e2e-test.db');

// 动态 import plugin
const pluginModule = await import('../src/index.js');
const plugin = pluginModule.default;

// ═══════════════════════════════════════════════════════
// Mock OpenClaw API — 捕获 hooks 注册
// ═══════════════════════════════════════════════════════
const registeredHooks = new Map(); // event -> [{handler, priority}]
const registeredTools = [];

const mockApi = {
  pluginConfig: {
    dbPath: testDbPath,
    pheromone: { decayIntervalMs: 999999, decayRate: 0.05 },
    memory: { inMemory: true, maxFocus: 5, maxContext: 15, maxScratch: 30 },
    orchestration: { qualityGates: true, pipelineBreaker: true },
    gossip: { fanout: 3, heartbeatMs: 999999 },
    dashboard: { enabled: false },
    // V5.3: 确保 swarmAdvisor 启用
    swarmAdvisor: { enabled: true },
  },
  logger: {
    info: () => {},
    warn: () => {},
    debug: () => {},
    error: console.error,
  },
  resolvePath: (p) => join(tmpDir, p),

  on(event, handler, opts = {}) {
    if (!registeredHooks.has(event)) registeredHooks.set(event, []);
    registeredHooks.get(event).push({
      handler,
      priority: opts.priority ?? 100,
    });
    // 按 priority 排序
    registeredHooks.get(event).sort((a, b) => a.priority - b.priority);
  },

  registerTool(tool) {
    registeredTools.push(tool);
  },
};

// ═══════════════════════════════════════════════════════
// 注册插件
// ═══════════════════════════════════════════════════════
console.log('═══════════════════════════════════════════════════');
console.log('  V5.3 端到端验证: advisory context 注入到 LLM prompt');
console.log('═══════════════════════════════════════════════════\n');

try {
  plugin.register(mockApi);
} catch (err) {
  console.log(`Plugin register warning: ${err.message}`);
}

const bpbHooks = registeredHooks.get('before_prompt_build') || [];
console.log(`[Step 1] 已注册 before_prompt_build hooks: ${bpbHooks.length} 个`);
bpbHooks.forEach((h, i) => {
  console.log(`  hook[${i}] priority=${h.priority}`);
});

// ═══════════════════════════════════════════════════════
// 测试 A: 复杂任务 (应注入完整能力画像)
// ═══════════════════════════════════════════════════════
console.log('\n──────────────────────────────────');
console.log('  测试 A: 复杂自然语言任务');
console.log('──────────────────────────────────');

const complexEvent = {
  userMessage: '帮我全面分析A股大盘近期走势，需要调研Tushare daily接口获取最近3个月的上证指数数据，然后用Python做均线交叉和MACD技术分析，最后给出操作建议',
};
const ctx = {};

let finalResult = null;
for (const hook of bpbHooks) {
  try {
    const r = await hook.handler(complexEvent, ctx);
    if (r && typeof r === 'object') {
      finalResult = { ...(finalResult || {}), ...r };
    }
  } catch (err) {
    // non-fatal
  }
}

console.log(`\n[Result] prependSystemContext 存在? ${!!finalResult?.prependSystemContext}`);
if (finalResult?.prependSystemContext) {
  const ctx = finalResult.prependSystemContext;
  console.log(`[Result] 长度: ${ctx.length} 字符`);
  console.log(`[Result] 包含 "蜂群协作能力": ${ctx.includes('蜂群协作能力')}`);
  console.log(`[Result] 包含 "D1(侦察蜂)": ${ctx.includes('D1(侦察蜂)')}`);
  console.log(`[Result] 包含 "D3(工蜂)": ${ctx.includes('D3(工蜂)')}`);
  console.log(`[Result] 包含 "D2(审查蜂)": ${ctx.includes('D2(审查蜂)')}`);
  console.log(`[Result] 包含 "swarm_plan": ${ctx.includes('swarm_plan')}`);
  console.log(`[Result] 包含 "如果你认为不需要协作": ${ctx.includes('如果你认为不需要协作')}`);
  console.log(`\n[完整内容]:`);
  console.log('┌─────────────────────────────────────────┐');
  console.log(ctx);
  console.log('└─────────────────────────────────────────┘');
} else {
  console.log('[FAIL] ❌ prependSystemContext 为空! advisory 没有被注入!');
}

// ═══════════════════════════════════════════════════════
// 测试 B: 简单任务 (应仅注入简短提示)
// ═══════════════════════════════════════════════════════
console.log('\n──────────────────────────────────');
console.log('  测试 B: 简单任务');
console.log('──────────────────────────────────');

const simpleEvent = { userMessage: '你好' };
let simpleResult = null;
for (const hook of bpbHooks) {
  try {
    const r = await hook.handler(simpleEvent, {});
    if (r && typeof r === 'object') {
      simpleResult = { ...(simpleResult || {}), ...r };
    }
  } catch { /* non-fatal */ }
}

console.log(`\n[Result] prependSystemContext 存在? ${!!simpleResult?.prependSystemContext}`);
if (simpleResult?.prependSystemContext) {
  const ctx = simpleResult.prependSystemContext;
  console.log(`[Result] 长度: ${ctx.length} 字符`);
  console.log(`[Result] 包含完整画像 "蜂群协作能力": ${ctx.includes('蜂群协作能力')}`);
  console.log(`[Result] 包含简短提示 "D1/D3/D2 待命": ${ctx.includes('D1/D3/D2 待命')}`);
  console.log(`\n[完整内容]:`);
  console.log('┌─────────────────────────────────────────┐');
  console.log(ctx);
  console.log('└─────────────────────────────────────────┘');
}

// ═══════════════════════════════════════════════════════
// 结论
// ═══════════════════════════════════════════════════════
console.log('\n══════════════════════════════════');
console.log('  验证结论');
console.log('══════════════════════════════════');

const complexHasAdvisory = finalResult?.prependSystemContext?.includes('蜂群协作能力');
const complexHasD1D3D2 = finalResult?.prependSystemContext?.includes('D1(侦察蜂)');
const complexHasSwarmPlan = finalResult?.prependSystemContext?.includes('swarm_plan');
const simpleIsMinimal = simpleResult?.prependSystemContext?.includes('待命') &&
                        !simpleResult?.prependSystemContext?.includes('蜂群协作能力');

console.log(`  ✓/✗ 复杂任务注入完整能力画像: ${complexHasAdvisory ? '✅ PASS' : '❌ FAIL'}`);
console.log(`  ✓/✗ 复杂任务包含 D1/D3/D2 描述: ${complexHasD1D3D2 ? '✅ PASS' : '❌ FAIL'}`);
console.log(`  ✓/✗ 复杂任务建议 swarm_plan:    ${complexHasSwarmPlan ? '✅ PASS' : '❌ FAIL'}`);
console.log(`  ✓/✗ 简单任务仅简短提示:          ${simpleIsMinimal ? '✅ PASS' : '❌ FAIL'}`);

const allPass = complexHasAdvisory && complexHasD1D3D2 && complexHasSwarmPlan && simpleIsMinimal;
console.log(`\n  ${allPass ? '🎉 全部通过! V5.3 蜂群决策赋能已验证解决原始问题。' : '⚠️ 部分失败，需要进一步调查。'}`);
console.log(`  LLM 在 before_prompt_build 时会收到包含 D1/D3/D2 能力画像和`);
console.log(`  swarm_plan 建议的 system context，从而做出知情决策。\n`);

// 清理
try { if (existsSync(testDbPath)) unlinkSync(testDbPath); } catch { /* ok */ }

// 触发 gateway_stop 清理
const stopHooks = registeredHooks.get('gateway_stop') || [];
for (const hook of stopHooks) {
  try { await hook.handler(); } catch { /* ok */ }
}
