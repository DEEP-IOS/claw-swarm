/**
 * Integration tests for SwarmCoreV9._verifyCoupling()
 *
 * Uses mock ModuleBase subclasses with static produces/consumes/publishes/subscribes
 * to verify field-mediated coupling validation without real domain modules.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Stub heavy imports ──────────────────────────────────────────────────

vi.mock('../../src/core/field/signal-store.js', () => ({
  SignalStore: class StubSignalStore {
    constructor() {}
    start() {}
    stop() {}
  },
}));

vi.mock('../../src/core/store/domain-store.js', () => ({
  DomainStore: class StubDomainStore {
    constructor() {}
    restore() {}
    snapshot() {}
  },
}));

const { SwarmCoreV9 } = await import('../../src/swarm-core-v9.js');

// ─── Mock module factory ────────────────────────────────────────────────

/**
 * Create a mock ModuleBase subclass with the given static declarations.
 * Returns an instance whose constructor has the required static methods.
 */
function makeMod(name, { produces = [], consumes = [], publishes = [], subscribes = [] } = {}) {
  class Mod {}
  Object.defineProperty(Mod, 'name', { value: name });
  Mod.produces = () => produces;
  Mod.consumes = () => consumes;
  Mod.publishes = () => publishes;
  Mod.subscribes = () => subscribes;
  return new Mod();
}

/**
 * Create a mock domain that returns the given modules from allModules().
 */
function makeDomain(modules) {
  return {
    allModules: () => modules,
    start: async () => {},
    stop: async () => {},
  };
}

// ─── Test Suite ─────────────────────────────────────────────────────────

describe('SwarmCoreV9._verifyCoupling()', () => {
  let core;
  let busEvents;

  beforeEach(() => {
    core = new SwarmCoreV9({});
    busEvents = [];
    core.bus.subscribe('*', (env) => busEvents.push(env));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Happy path: all dimensions coupled ──────────────────────────

  it('passes when every produced dimension has a consumer', () => {
    const producer = makeMod('TaskRouter', { produces: ['urgency', 'complexity'] });
    const consumer = makeMod('PlanEngine', { consumes: ['urgency', 'complexity'] });

    core.communication = makeDomain([producer]);
    core.intelligence = makeDomain([consumer]);

    const result = core._verifyCoupling();
    expect(result.dimensions).toBe(2);
    expect(result.modules).toBe(2);
  });

  it('passes with cross-domain producer/consumer pairs', () => {
    const a = makeMod('SignalEmitter', { produces: ['trust', 'load'] });
    const b = makeMod('QualityChecker', { consumes: ['trust'] });
    const c = makeMod('Scheduler', { consumes: ['load'] });

    core.communication = makeDomain([a]);
    core.quality = makeDomain([b]);
    core.orchestration = makeDomain([c]);

    expect(() => core._verifyCoupling()).not.toThrow();
  });

  // ── Missing consumer (idle dimension = warning, not error) ──────

  it('warns but does not throw when a produced dimension has no consumer', () => {
    const producer = makeMod('Emitter', { produces: ['novelty', 'sentiment'] });
    const consumer = makeMod('Reader', { consumes: ['novelty'] });

    core.communication = makeDomain([producer]);
    core.intelligence = makeDomain([consumer]);

    const result = core._verifyCoupling();
    // 'sentiment' is idle (produced but not consumed) — should appear as warning
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('sentiment');
    expect(result.warnings[0]).toContain('Idle');
  });

  // ── Missing producer (broken coupling = hard error) ─────────────

  it('throws when a consumed dimension has no producer', () => {
    const consumer = makeMod('Orphan', { consumes: ['phantom_dim'] });
    core.communication = makeDomain([consumer]);

    expect(() => core._verifyCoupling()).toThrow(/Coupling verification failed/);
  });

  it('error message includes "Broken coupling" description', () => {
    const consumer = makeMod('Ghost', { consumes: ['missing_dim'] });
    core.quality = makeDomain([consumer]);

    try {
      core._verifyCoupling();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.message).toContain('Broken coupling');
      expect(err.message).toContain('missing_dim');
      expect(err.message).toContain('Ghost');
    }
  });

  it('error message reports error and warning counts', () => {
    // 1 broken (consumed without producer) + 1 idle (produced without consumer)
    const mod = makeMod('Mixed', { produces: ['idle_dim'], consumes: ['broken_dim'] });
    core.communication = makeDomain([mod]);

    try {
      core._verifyCoupling();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.message).toMatch(/1 error\(s\)/);
      expect(err.message).toMatch(/1 warning\(s\)/);
    }
  });

  // ── publishes / subscribes pairing ──────────────────────────────

  it('collects publishes and subscribes from modules (no hard error for mismatch)', () => {
    const pub = makeMod('Publisher', {
      produces: ['urgency'],
      publishes: ['task.created', 'task.completed'],
    });
    const sub = makeMod('Subscriber', {
      consumes: ['urgency'],
      subscribes: ['task.created'],
    });

    core.communication = makeDomain([pub, sub]);
    // Should not throw — bus event mismatches are not hard errors in _verifyCoupling
    const result = core._verifyCoupling();
    expect(result.modules).toBe(2);
  });

  // ── Static method validation ────────────────────────────────────

  it('all mock modules have static produces/consumes returning arrays', () => {
    const mod = makeMod('TestMod', { produces: ['a'], consumes: ['b'] });
    expect(mod.constructor.produces()).toEqual(['a']);
    expect(mod.constructor.consumes()).toEqual(['b']);
    expect(mod.constructor.publishes()).toEqual([]);
    expect(mod.constructor.subscribes()).toEqual([]);
  });

  // ── Bus event publication ───────────────────────────────────────

  it('publishes swarm.coupling.verified on success', () => {
    const a = makeMod('A', { produces: ['dim1'] });
    const b = makeMod('B', { consumes: ['dim1'] });
    core.communication = makeDomain([a]);
    core.intelligence = makeDomain([b]);

    core._verifyCoupling();

    const evt = busEvents.find(e => e.topic === 'swarm.coupling.verified');
    expect(evt).toBeDefined();
    expect(evt.data.dimensions).toBe(1);
    expect(evt.data.modules).toBe(2);
  });

  it('does not publish swarm.coupling.verified on failure', () => {
    const broken = makeMod('Broken', { consumes: ['nonexistent'] });
    core.communication = makeDomain([broken]);

    try { core._verifyCoupling(); } catch { /* expected */ }

    const evt = busEvents.find(e => e.topic === 'swarm.coupling.verified');
    expect(evt).toBeUndefined();
  });

  // ── Empty domains ───────────────────────────────────────────────

  it('handles empty domain (no modules) without error', () => {
    core.communication = makeDomain([]);
    const result = core._verifyCoupling();
    expect(result.dimensions).toBe(0);
    expect(result.modules).toBe(0);
  });

  // ── _collectAllModules ──────────────────────────────────────────

  it('_collectAllModules gathers modules from all non-null domains', () => {
    const m1 = makeMod('M1');
    const m2 = makeMod('M2');
    const m3 = makeMod('M3');
    core.communication = makeDomain([m1]);
    core.quality = makeDomain([m2, m3]);

    const all = core._collectAllModules();
    expect(all).toHaveLength(3);
  });

  it('_collectAllModules skips null domains', () => {
    // All domains null by default
    const all = core._collectAllModules();
    expect(all).toEqual([]);
  });
});
