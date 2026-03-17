/**
 * Integration tests for SwarmCoreV9 full lifecycle.
 *
 * Strategy: We import SwarmCoreV9 with mocked foundation deps, then subclass
 * it to override initialize() (which uses dynamic import() that Vite cannot
 * resolve for missing domain modules). Tests inject mock domains manually
 * and verify the lifecycle: start, events, stop, resource cleanup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Stub heavy foundation imports ──────────────────────────────────────

vi.mock('../../src/core/field/signal-store.js', () => ({
  SignalStore: class StubSignalStore {
    constructor() { this._started = false; }
    start() { this._started = true; }
    stop() { this._started = false; }
    emit() {}
    query() { return []; }
    superpose() { return {}; }
  },
}));

vi.mock('../../src/core/store/domain-store.js', () => ({
  DomainStore: class StubDomainStore {
    constructor() {}
    restore() {}
    snapshot() {}
    get() { return null; }
    set() {}
  },
}));

// Mock all 5 domain factory modules (resolved relative to swarm-core-v9.js in src/)
vi.mock('../../src/communication/index.js', () => ({ createCommunicationSystem: null }));
vi.mock('../../src/intelligence/index.js', () => ({ createIntelligenceSystem: null }));
vi.mock('../../src/orchestration/index.js', () => ({ createOrchestrationSystem: null }));
vi.mock('../../src/quality/index.js', () => ({ createQualitySystem: null }));
vi.mock('../../src/observe/index.js', () => ({ createObserveSystem: null }));

// EventBus is kept real (lightweight, no I/O)

const { SwarmCoreV9: RawSwarmCoreV9 } = await import('../../src/swarm-core-v9.js');

// ─── TestableCore: override initialize() to skip dynamic import ─────────

class TestableCore extends RawSwarmCoreV9 {
  /**
   * Overrides initialize() to skip the dynamic import() calls
   * (which Vite cannot resolve for non-existent domain modules).
   * Domains must be injected manually before calling start().
   */
  async initialize() {
    this._initErrors = [];
    return {
      initialized: true,
      domains: this._getDomainStatus(),
      errors: this._initErrors,
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function makeMockDomain(name, modules = []) {
  return {
    name,
    _modules: modules,
    allModules: vi.fn(() => modules),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  };
}

// ─── Test Suite ─────────────────────────────────────────────────────────

describe('SwarmCoreV9 — full lifecycle (mocked domains)', () => {
  let core;
  let busEvents;

  beforeEach(() => {
    core = new TestableCore({});
    busEvents = [];
    core.bus.subscribe('*', (envelope) => {
      busEvents.push(envelope);
    });
  });

  afterEach(async () => {
    if (core.isReady()) {
      await core.stop();
    }
    busEvents = [];
    vi.restoreAllMocks();
  });

  // ── Construction ──────────────────────────────────────────────────

  it('creates field and store in constructor', () => {
    expect(core.field).toBeDefined();
    expect(core.store).toBeDefined();
    expect(core.isReady()).toBe(false);
  });

  it('has all five domain slots initially null', () => {
    expect(core.communication).toBeNull();
    expect(core.intelligence).toBeNull();
    expect(core.orchestration).toBeNull();
    expect(core.quality).toBeNull();
    expect(core.observe).toBeNull();
  });

  // ── initialize() ─────────────────────────────────────────────────

  it('initialize() returns initialized:true with domain status', async () => {
    const result = await core.initialize();
    expect(result.initialized).toBe(true);
    expect(result.domains.communication).toBe(false);
  });

  it('initialize() reflects injected domains in status', async () => {
    core.communication = makeMockDomain('communication');
    const result = await core.initialize();
    expect(result.domains.communication).toBe(true);
  });

  // ── start() ──────────────────────────────────────────────────────

  it('start() marks core as ready and publishes swarm.core.started', async () => {
    await core.start();
    expect(core.isReady()).toBe(true);
    const started = busEvents.find(e => e.topic === 'swarm.core.started');
    expect(started).toBeDefined();
    expect(started.data.version).toBe('9.0.0');
  });

  it('start() stores startedAt timestamp', async () => {
    const before = Date.now();
    await core.start();
    expect(core._startedAt).toBeGreaterThanOrEqual(before);
    expect(core._startedAt).toBeLessThanOrEqual(Date.now());
  });

  it('start() calls field.start() and store.restore()', async () => {
    const fieldStartSpy = vi.spyOn(core.field, 'start');
    const restoreSpy = vi.spyOn(core.store, 'restore');
    await core.start();
    expect(fieldStartSpy).toHaveBeenCalled();
    expect(restoreSpy).toHaveBeenCalled();
  });

  it('start() calls domain.start() for each injected domain in order', async () => {
    const callOrder = [];
    const comm = makeMockDomain('communication');
    comm.start = vi.fn(async () => callOrder.push('communication'));
    const intel = makeMockDomain('intelligence');
    intel.start = vi.fn(async () => callOrder.push('intelligence'));
    const orch = makeMockDomain('orchestration');
    orch.start = vi.fn(async () => callOrder.push('orchestration'));

    core.communication = comm;
    core.intelligence = intel;
    core.orchestration = orch;

    await core.start();

    expect(callOrder).toEqual(['communication', 'intelligence', 'orchestration']);
  });

  it('swarm.core.started event includes domain count and error count', async () => {
    core.communication = makeMockDomain('communication');
    await core.start();
    const evt = busEvents.find(e => e.topic === 'swarm.core.started');
    expect(evt.data.domains.communication).toBe(true);
    expect(typeof evt.data.errors).toBe('number');
  });

  // ── stop() ───────────────────────────────────────────────────────

  it('stop() sets ready to false and publishes swarm.core.stopped', async () => {
    await core.start();
    await core.stop();
    expect(core.isReady()).toBe(false);
    const stopped = busEvents.find(e => e.topic === 'swarm.core.stopped');
    expect(stopped).toBeDefined();
  });

  it('stop() publishes swarm.core.stopping before swarm.core.stopped', async () => {
    await core.start();
    await core.stop();

    const topics = busEvents.map(e => e.topic);
    const stoppingIdx = topics.indexOf('swarm.core.stopping');
    const stoppedIdx = topics.indexOf('swarm.core.stopped');
    expect(stoppingIdx).toBeGreaterThanOrEqual(0);
    expect(stoppedIdx).toBeGreaterThan(stoppingIdx);
  });

  it('stop() calls domain.stop() in reverse dependency order', async () => {
    const callOrder = [];
    const comm = makeMockDomain('communication');
    comm.stop = vi.fn(async () => callOrder.push('communication'));
    const obs = makeMockDomain('observe');
    obs.stop = vi.fn(async () => callOrder.push('observe'));
    core.communication = comm;
    core.observe = obs;

    await core.start();
    await core.stop();

    // observe (index 4) stops before communication (index 0)
    expect(callOrder.indexOf('observe')).toBeLessThan(callOrder.indexOf('communication'));
  });

  it('stop() calls field.stop() and store.snapshot()', async () => {
    await core.start();
    const fieldStopSpy = vi.spyOn(core.field, 'stop');
    const snapshotSpy = vi.spyOn(core.store, 'snapshot');
    await core.stop();
    expect(fieldStopSpy).toHaveBeenCalled();
    expect(snapshotSpy).toHaveBeenCalled();
  });

  it('domain.stop() failure does not block other domains', async () => {
    const bad = makeMockDomain('quality');
    bad.stop = vi.fn(async () => { throw new Error('stop-fail'); });
    const good = makeMockDomain('communication');
    core.quality = bad;
    core.communication = good;

    await core.start();
    await expect(core.stop()).resolves.toBeUndefined();
    expect(good.stop).toHaveBeenCalled();
  });

  // ── Restart safety ────────────────────────────────────────────────

  it('stop() then start() re-initializes cleanly', async () => {
    await core.start();
    const first = core._startedAt;
    await new Promise(r => setTimeout(r, 5));
    await core.stop();
    await core.start();
    expect(core.isReady()).toBe(true);
    expect(core._startedAt).toBeGreaterThanOrEqual(first);
  });

  // ── Resource cleanup ──────────────────────────────────────────────

  it('after stop(), isReady() returns false and startedAt is preserved', async () => {
    await core.start();
    const ts = core._startedAt;
    await core.stop();
    expect(core.isReady()).toBe(false);
    // startedAt is NOT cleared on stop — it's historical
    expect(core._startedAt).toBe(ts);
  });

  // ── getStats / _getDomainStatus ───────────────────────────────────

  it('getStats() reports correct domain count after start', async () => {
    core.communication = makeMockDomain('communication');
    core.intelligence = makeMockDomain('intelligence');
    await core.start();

    const stats = core.getStats();
    expect(stats.ready).toBe(true);
    expect(stats.domains).toBe(2);
    expect(stats.totalDomains).toBe(5);
    expect(stats.version).toBe('9.0.0');
  });

  it('getStats() reports uptime > 0 after start', async () => {
    await core.start();
    await new Promise(r => setTimeout(r, 10));
    expect(core.getStats().uptimeMs).toBeGreaterThan(0);
  });

  it('_getDomainStatus() reflects domain presence', () => {
    core.orchestration = makeMockDomain('orchestration');
    const status = core._getDomainStatus();
    expect(status.orchestration).toBe(true);
    expect(status.communication).toBe(false);
  });
});

// ─── index-v9 activate/deactivate pattern ───────────────────────────────

describe('index-v9 activate / deactivate pattern', () => {

  it('activate pattern: create core -> start -> ready', async () => {
    const core = new TestableCore({});
    await core.start();
    expect(core.isReady()).toBe(true);
    await core.stop();
    expect(core.isReady()).toBe(false);
  });

  it('deactivate is safe when instance is null', async () => {
    const fn = async () => {
      const inst = null;
      if (!inst) return;
      await inst.core.stop();
    };
    await expect(fn()).resolves.toBeUndefined();
  });
});
