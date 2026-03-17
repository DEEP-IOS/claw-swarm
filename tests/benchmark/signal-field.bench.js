/**
 * Claw-Swarm V8.0 — Signal Field 性能基准 / Signal Field Performance Benchmark
 *
 * Phase 0 基线测量：deposit / sense / gradient / acoSelect 核心操作。
 * Phase 0 baseline: deposit / sense / gradient / acoSelect core operations.
 *
 * 运行 / Run:  npx vitest bench tests/benchmark/signal-field.bench.js
 *
 * @module tests/benchmark/signal-field.bench
 */

import { describe, bench, beforeEach } from 'vitest';
import { createSignal, SignalType, SignalSubtype, SourceKind } from '../../src/L0-field/signal.js';
import { ScopeGraph } from '../../src/L0-field/scope-graph.js';
import { SignalField } from '../../src/L0-field/signal-field.js';
import { getNativeCore } from '../../src/L0-field/native-core.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silent = { info() {}, warn() {}, error() {}, debug() {} };

/** 构建 session→tasks→agents 拓扑 / Build realistic session->tasks->agents topology */
function buildGraph(graph, tasks, agentsPerTask) {
  const s = graph.registerSession('bench-sess');
  const tAddrs = [], aAddrs = [];
  for (let t = 0; t < tasks; t++) {
    tAddrs.push(graph.registerTask(`t-${t}`, 'bench-sess'));
    for (let a = 0; a < agentsPerTask; a++)
      aAddrs.push(graph.registerAgent(`a-${t}-${a}`, 'bench-sess', `t-${t}`));
  }
  return { s, tAddrs, aAddrs };
}

/** 标准测试信号配置 / Standard test signal opts */
const trailOpts = (origin) => ({
  type: SignalType.BIOCHEMICAL, subtype: SignalSubtype.TRAIL,
  source: { kind: SourceKind.WORKER, id: 'bench' }, origin, intensity: 0.7,
});

// ── 1 & 2: deposit() ────────────────────────────────────────────────────────

describe('deposit() 性能 / deposit performance', () => {
  let field, addrs;
  beforeEach(() => {
    field = new SignalField({ logger: silent });
    addrs = buildGraph(field.graph, 2, 5); // ~13 节点 / ~13 nodes
  });

  // 单信号沉淀，小图 / Single deposit, small graph
  bench('deposit() — single signal (10-node)', () => {
    field.deposit(trailOpts(addrs.aAddrs[0]));
  });

  // 带 BFS 传播，100 节点树 / Deposit + BFS propagation, 100-node tree
  bench('deposit() — with propagation (100-node)', () => {
    const f = new SignalField({ logger: silent });
    buildGraph(f.graph, 10, 10); // ~112 nodes
    f.deposit({
      type: SignalType.BIOCHEMICAL, subtype: SignalSubtype.ALARM,
      source: { kind: SourceKind.SYSTEM, id: 'b' },
      origin: '/session/bench-sess', intensity: 0.9,
    });
  });
});

// ── 3 & 4: sense() ──────────────────────────────────────────────────────────

describe('sense() 性能 / sense performance', () => {
  let field, target;
  beforeEach(() => {
    field = new SignalField({ logger: silent });
    const a = buildGraph(field.graph, 2, 5);
    target = a.aAddrs[0];
    for (let i = 0; i < 10; i++) field.deposit(trailOpts(target)); // 预沉淀 10 条
  });

  // 小范围感知 / Small scope sense (~10 signals)
  bench('sense() — small scope (~10 signals)', () => {
    field.sense(target);
  });

  // 大范围 + 类型过滤 / Large scope with type filtering (~100 signals)
  bench('sense() — large scope filtered (~100 signals)', () => {
    const f = new SignalField({ logger: silent });
    const a = buildGraph(f.graph, 2, 5);
    const pos = a.tAddrs[0];
    const types = [SignalType.BIOCHEMICAL, SignalType.STIGMERGIC, SignalType.EPISODIC];
    const subs  = [SignalSubtype.TRAIL, SignalSubtype.POST, SignalSubtype.MEMORY];
    for (let i = 0; i < 100; i++) {
      f.deposit({ type: types[i % 3], subtype: subs[i % 3],
        source: { kind: SourceKind.WORKER, id: `a-${i}` },
        origin: pos, intensity: 0.3 + Math.random() * 0.6 });
    }
    f.sense(pos, { type: SignalType.BIOCHEMICAL, minIntensity: 0.2 });
  });
});

// ── 5: gradient() ────────────────────────────────────────────────────────────

describe('gradient() 性能 / gradient performance', () => {
  bench('gradient() — 5 neighbors', () => {
    const f = new SignalField({ logger: silent });
    const a = buildGraph(f.graph, 1, 5);
    a.aAddrs.forEach((addr, i) => f.deposit({
      type: SignalType.BIOCHEMICAL, subtype: SignalSubtype.TRAIL,
      source: { kind: SourceKind.WORKER, id: `g-${i}` },
      origin: addr, intensity: 0.2 + i * 0.15,
    }));
    f.gradient(a.tAddrs[0], SignalType.BIOCHEMICAL);
  });
});

// ── 6 & 7: ScopeGraph 操作 / ScopeGraph operations ──────────────────────────

describe('ScopeGraph 性能 / ScopeGraph performance', () => {
  // 节点添加 / Node addition
  bench('ScopeGraph.addNode()', () => {
    const g = new ScopeGraph({ logger: silent });
    g.addNode(`/bench/${Math.random()}`, { kind: 'task' });
  });

  // BFS 传播，100 节点 / BFS propagation, 100-node graph
  bench('ScopeGraph.propagationField() — 100-node BFS', () => {
    const g = new ScopeGraph({ logger: silent });
    g.addNode('/swarm/global', { kind: 'global' });
    g.addNode('/session/bfs', { kind: 'session' });
    g.addEdge('/session/bfs', '/swarm/global', { spreadFactor: 0.3 });
    for (let i = 0; i < 10; i++) {
      const t = `/task/bfs-${i}`;
      g.addNode(t, { kind: 'task' });
      g.addEdge(t, '/session/bfs', { spreadFactor: 0.4 });
      for (let j = 0; j < 9; j++) {
        const a = `/agent/bfs-${i}-${j}`;
        g.addNode(a, { kind: 'agent' });
        g.addEdge(a, t, { spreadFactor: 0.5 });
      }
    }
    const sig = createSignal({
      type: SignalType.BIOCHEMICAL, subtype: SignalSubtype.ALARM,
      source: { kind: SourceKind.SYSTEM, id: 'bfs' },
      origin: '/session/bfs', intensity: 1.0,
    });
    g.propagationField('/session/bfs', sig);
  });
});

// ── 8: createSignal() 工厂 / Factory ────────────────────────────────────────

describe('createSignal() 性能 / createSignal performance', () => {
  bench('createSignal() — factory with MMAS clamping', () => {
    createSignal({
      type: SignalType.BIOCHEMICAL, subtype: SignalSubtype.TRAIL,
      source: { kind: SourceKind.WORKER, id: 'fac' },
      origin: '/agent/fac', intensity: 1.5, // 触发 MMAS 夹紧 / triggers clamping
      valence: 0.3, payload: { tool: 'search', tokens: 150 },
    });
  });
});

// ── 9: 完整流程 / Full cycle ─────────────────────────────────────────────────

describe('完整流程 / Full cycle', () => {
  bench('deposit + sense (end-to-end)', () => {
    const f = new SignalField({ logger: silent });
    const a = buildGraph(f.graph, 2, 3);
    f.deposit({ type: SignalType.BIOCHEMICAL, subtype: SignalSubtype.DANCE,
      source: { kind: SourceKind.WORKER, id: 'cyc' },
      origin: a.aAddrs[0], intensity: 0.8, payload: { ok: true } });
    f.sense(a.aAddrs[0]);
    f.sense(a.tAddrs[0], { type: SignalType.BIOCHEMICAL });
  });
});

// ── 10: ACO 选择 / ACO select ────────────────────────────────────────────────

describe('ACO 算法 / ACO algorithm', () => {
  const core = getNativeCore();
  const pheromones = [0.8, 0.6, 0.3, 0.9, 0.4, 0.7, 0.2, 0.5, 0.1, 0.85];
  const heuristics = [0.5, 0.7, 0.9, 0.3, 0.6, 0.4, 0.8, 0.2, 0.95, 0.35];

  bench('acoSelect() — 10 candidates', () => {
    core.acoSelect(pheromones, heuristics, 1.0, 2.0);
  });
});
