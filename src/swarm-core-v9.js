/**
 * SwarmCoreV9 - Top-level V9 orchestrator.
 *
 * Creates the dual foundation (SignalStore field + DomainStore persistence),
 * lazily imports the 5 runtime subsystems, verifies field-mediated coupling,
 * and manages the full lifecycle for the full V9 design
 * (7 autonomous domains + dual foundation).
 *
 * @module swarm-core-v9
 * @version 9.0.0
 */

import { SignalStore } from './core/field/signal-store.js';
import { EventBus } from './core/bus/event-bus.js';
import { DomainStore } from './core/store/domain-store.js';
import { ALL_DIMENSIONS } from './core/field/types.js';

// ─── Safe dynamic import helper ─────────────────────────────────────────────

/**
 * Attempt a dynamic import. Returns null if the module is not found.
 * This allows SwarmCoreV9 to start even when some domain indexes
 * are not yet created (e.g., communication/index.js).
 *
 * @param {string} specifier - Module specifier
 * @returns {Promise<Object|null>}
 */
async function tryImport(specifier) {
  try {
    return await import(specifier);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND') {
      return null;
    }
    throw err;
  }
}

// ─── Constants ──────────────────────────────────────────────────────────────

const RUNTIME_DOMAIN_IDS = Object.freeze([
  'communication',
  'intelligence',
  'orchestration',
  'quality',
  'observe',
]);

const ARCHITECTURE_DOMAIN_IDS = Object.freeze([
  'core',
  ...RUNTIME_DOMAIN_IDS,
  'bridge',
]);

const RUNTIME_DOMAIN_COUNT = RUNTIME_DOMAIN_IDS.length;
const ARCHITECTURE_DOMAIN_COUNT = ARCHITECTURE_DOMAIN_IDS.length;
const VERSION = '9.0.0';

// ─── SwarmCoreV9 ────────────────────────────────────────────────────────────

export class SwarmCoreV9 {
  /**
   * @param {Object} [config={}]        - Full configuration tree
   * @param {Object} [messageBus]       - Shared EventBus (created if not provided)
   */
  constructor(config = {}, messageBus) {
    this.config = config;
    this.bus = messageBus || new EventBus();
    this._ready = false;
    this._startedAt = null;
    this._version = VERSION;

    // ── Dual foundation ───────────────────────────────────────────
    this.field = new SignalStore({
      eventBus: this.bus,
      ...(config.field || {}),
    });
    const storeConfig = config.store || {};
    this.store = new DomainStore({
      domain: storeConfig.domain || 'swarm',
      snapshotDir: storeConfig.snapshotDir || (config._dataDir
        ? `${config._dataDir}/snapshots`
        : `${process.env.HOME || process.env.USERPROFILE}/.openclaw/claw-swarm/snapshots`),
      snapshotIntervalMs: storeConfig.snapshotIntervalMs || 30000,
    });

    // ── Domain references (lazy init in initialize()) ─────────────
    this.communication = null;
    this.intelligence = null;
    this.orchestration = null;
    this.quality = null;
    this.observe = null;
    this.bridge = null;

    // ── Initialization metadata ───────────────────────────────────
    this._initErrors = [];
    this._couplingResult = null;
    this._domainRefs = {
      communication: null,
      intelligence: null,
      orchestration: null,
      quality: null,
      observe: null,
      bridge: null,
    };
  }

  // ─── Initialization ───────────────────────────────────────────────

  /**
   * Dynamically import all domain factory modules and create subsystems.
   * Uses tryImport so missing domains degrade gracefully.
   */
  async initialize() {
    this._initErrors = [];

    // ── Import domain factories ─────────────────────────────────
    const [commMod, intelMod, orchMod, qualMod, obsMod] = await Promise.all([
      tryImport('./communication/index.js'),
      tryImport('./intelligence/index.js'),
      tryImport('./orchestration/index.js'),
      tryImport('./quality/index.js'),
      tryImport('./observe/index.js'),
    ]);

    // ── Create domains in dependency order ──────────────────────

    // Communication (no deps on other domains)
    if (commMod?.createCommunicationSystem) {
      try {
        this.communication = commMod.createCommunicationSystem({
          field: this.field,
          bus: this.bus,
          store: this.store,
          config: this.config.communication || {},
        });
        this._domainRefs.communication = this.communication;
      } catch (err) {
        this._initErrors.push({ domain: 'communication', error: err.message });
      }
    }

    // Intelligence (no deps on other domains)
    if (intelMod?.createIntelligenceSystem) {
      try {
        this.intelligence = intelMod.createIntelligenceSystem({
          field: this.field,
          bus: this.bus,
          store: this.store,
          communication: this.communication,
          config: this.config.intelligence || {},
        });
        this._domainRefs.intelligence = this.intelligence;
      } catch (err) {
        this._initErrors.push({ domain: 'intelligence', error: err.message });
      }
    }

    // Orchestration (may reference intelligence for capability/role data)
    if (orchMod?.createOrchestrationSystem) {
      try {
        this.orchestration = orchMod.createOrchestrationSystem({
          field: this.field,
          bus: this.bus,
          store: this.store,
          capabilityEngine: this.intelligence?.getCapabilityEngine?.() ?? null,
          hybridRetrieval: this.intelligence?.getHybridRetrieval?.() ?? null,
          roleRegistry: this.intelligence?.getRoleRegistry?.() ?? null,
          modelCapability: this.intelligence?.getModelCapability?.() ?? null,
          artifactRegistry: this.intelligence?.getArtifactRegistry?.() ?? null,
          intentClassifier: this.intelligence?.understanding?.intent ?? null,
          scopeEstimator: this.intelligence?.understanding?.scope ?? null,
          config: this.config.orchestration || {},
        });
        this._domainRefs.orchestration = this.orchestration;
      } catch (err) {
        this._initErrors.push({ domain: 'orchestration', error: err.message });
      }
    }

    // Quality (needs reputationCRDT from intelligence)
    if (qualMod?.createQualitySystem) {
      try {
        const reputationCRDT = this.intelligence?.getReputationCRDT?.()
          ?? { increment() {}, decrement() {}, get() { return 0; } };
        this.quality = qualMod.createQualitySystem({
          field: this.field,
          bus: this.bus,
          store: this.store,
          reputationCRDT,
          config: this.config.quality || {},
        });
        this._domainRefs.quality = this.quality;
      } catch (err) {
        this._initErrors.push({ domain: 'quality', error: err.message });
      }
    }

    // Observe (references all other domains for dashboard/metrics)
    if (obsMod?.createObserveSystem) {
      try {
        this.observe = obsMod.createObserveSystem({
          field: this.field,
          bus: this.bus,
          store: this.store,
          domains: this._domainRefs,
          config: this.config.observe || {},
        });
        this._domainRefs.observe = this.observe;
      } catch (err) {
        this._initErrors.push({ domain: 'observe', error: err.message });
      }
    }

    return {
      initialized: true,
      domains: this._getDomainStatus(),
      errors: this._initErrors,
    };
  }

  // ─── Coupling Verification ────────────────────────────────────────

  /**
   * Verify field-mediated coupling: every produced dimension has at least
   * one consumer, and every consumed dimension has at least one producer.
   *
   * Collects modules from all domains via allModules(), inspects static
   * produces()/consumes() declarations, and validates the graph.
   *
   * @throws {Error} if verification fails with detail on broken/idle dimensions
   * @returns {{ dimensions: number, consumers: number, modules: number }}
   */
  _verifyCoupling() {
    const allModules = this._collectAllModules();

    const producers = new Map();   // dimension -> [moduleName]
    const consumers = new Map();   // dimension -> [moduleName]
    const publishers = new Map();  // event -> [moduleName]
    const subscribers = new Map(); // event -> [moduleName]
    const errors = [];
    const warnings = [];

    for (const mod of allModules) {
      const name = mod?.constructor?.name || 'AnonymousModule';

      // Field dimensions
      const produced = mod?.constructor?.produces?.() || [];
      for (const dim of produced) {
        if (!ALL_DIMENSIONS.includes(dim)) {
          errors.push(`Invalid produced dimension: "${dim}" declared by [${name}]`);
          continue;
        }
        if (!producers.has(dim)) producers.set(dim, []);
        producers.get(dim).push(name);
      }

      const consumed = mod?.constructor?.consumes?.() || [];
      for (const dim of consumed) {
        if (!ALL_DIMENSIONS.includes(dim)) {
          errors.push(`Invalid consumed dimension: "${dim}" declared by [${name}]`);
          continue;
        }
        if (!consumers.has(dim)) consumers.set(dim, []);
        consumers.get(dim).push(name);
      }

      // Bus events
      const published = mod?.constructor?.publishes?.() || [];
      for (const evt of published) {
        if (!publishers.has(evt)) publishers.set(evt, []);
        publishers.get(evt).push(name);
      }

      const subscribed = mod?.constructor?.subscribes?.() || [];
      for (const evt of subscribed) {
        if (!subscribers.has(evt)) subscribers.set(evt, []);
        subscribers.get(evt).push(name);
      }
    }

    // Validate: every produced dim should have a consumer and vice versa

    for (const [dim, prods] of producers) {
      if (!consumers.has(dim)) {
        warnings.push(`Idle dimension: "${dim}" produced by [${prods.join(', ')}] but no consumer`);
      }
    }

    for (const [dim, cons] of consumers) {
      if (!producers.has(dim)) {
        errors.push(`Broken coupling: "${dim}" consumed by [${cons.join(', ')}] but no producer`);
      }
    }

    // Hard errors = broken couplings (consumer with no producer)
    if (errors.length > 0) {
      const detail = errors.concat(warnings).join('\n  ');
      throw new Error(`Coupling verification failed (${errors.length} error(s), ${warnings.length} warning(s)):\n  ${detail}`);
    }

    this._couplingResult = {
      dimensions: producers.size,
      consumers: consumers.size,
      modules: allModules.length,
      warnings,
    };

    this.bus.publish('swarm.coupling.verified', {
      dimensions: producers.size,
      modules: allModules.length,
      warnings: warnings.length,
    });

    return this._couplingResult;
  }

  /**
   * Collect all ModuleBase instances across all initialized domains.
   * @returns {Array}
   */
  _collectAllModules() {
    const modules = [];
    const domains = [
      this.communication,
      this.intelligence,
      this.orchestration,
      this.quality,
      this.observe,
    ];

    for (const domain of domains) {
      if (!domain) continue;

      // Prefer allModules() method (returns array)
      if (typeof domain.allModules === 'function') {
        const domMods = domain.allModules();
        if (Array.isArray(domMods)) {
          modules.push(...domMods);
          continue;
        }
      }

      // Fallback: _modules array
      if (Array.isArray(domain._modules)) {
        modules.push(...domain._modules);
      } else if (domain._modules && typeof domain._modules === 'object') {
        // _modules might be an object (observe domain uses { metricsCollector, ... })
        modules.push(...Object.values(domain._modules));
      }
    }

    return modules;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────

  /**
   * Full startup sequence:
   * 1. Initialize all domains
   * 2. Restore persisted state
   * 3. Start signal field
   * 4. Verify coupling
   * 5. Start domains in dependency order
   * 6. Mark ready
   */
  async start() {
    await this.initialize();
    const missingDomains = Object.entries(this._getDomainStatus())
      .filter(([, ready]) => !ready)
      .map(([domain]) => domain);

    if (this._initErrors.length > 0 || missingDomains.length > 0) {
      const details = [
        ...this._initErrors.map(({ domain, error }) => `${domain}: ${error}`),
        ...missingDomains.map((domain) => `${domain}: not initialized`),
      ];
      throw new Error(`SwarmCoreV9 initialization failed:\n  ${details.join('\n  ')}`);
    }

    // Restore persisted state
    if (typeof this.store.restore === 'function') {
      await this.store.restore();
    }

    // Start the signal field (GC scheduler, etc.)
    if (typeof this.field.start === 'function') {
      await this.field.start();
    }

    // Verify field-mediated coupling
    this._verifyCoupling();

    // Start domains in dependency order
    const startOrder = [
      this.communication,
      this.intelligence,
      this.orchestration,
      this.quality,
      this.observe,
    ];

    for (const domain of startOrder) {
      if (domain && typeof domain.start === 'function') {
        await domain.start();
      }
    }

    // Wire SignalCalibrator → SignalStore: calibration weights flow into field superposition
    this.bus.on('calibration.completed', (envelope) => {
      const weights = envelope?.data?.weights ?? envelope?.weights;
      if (weights && typeof this.field.setCalibrationWeights === 'function') {
        this.field.setCalibrationWeights(weights);
      }
    });

    this._ready = true;
    this._startedAt = Date.now();
    this.bus.publish('swarm.core.started', {
      ts: this._startedAt,
      version: this._version,
      domains: this._getDomainStatus(),
      errors: this._initErrors.length,
    });

    return {
      ready: true,
      startedAt: this._startedAt,
      domains: this._getDomainStatus(),
      initErrors: this._initErrors,
    };
  }

  setBridge(bridge) {
    this.bridge = bridge ?? null;
    this._domainRefs.bridge = this.bridge;
  }

  /**
   * Graceful shutdown in reverse dependency order.
   */
  async stop() {
    this.bus.publish('swarm.core.stopping', { ts: Date.now() });
    this._ready = false;

    // Stop domains in reverse order
    const stopOrder = [
      this.observe,
      this.quality,
      this.orchestration,
      this.intelligence,
      this.communication,
    ];

    for (const domain of stopOrder) {
      if (domain && typeof domain.stop === 'function') {
        try {
          await domain.stop();
        } catch (_) { /* stop errors are non-fatal */ }
      }
    }

    // Stop signal field (GC scheduler cleanup)
    if (typeof this.field.stop === 'function') {
      try { await this.field.stop(); } catch (_) { /* non-fatal */ }
    }

    // Snapshot persisted state
    if (typeof this.store.snapshot === 'function') {
      try { await this.store.snapshot(); } catch (_) { /* non-fatal */ }
    }

    this.bus.publish('swarm.core.stopped', { ts: Date.now() });
  }

  // ─── Status & Stats ──────────────────────────────────────────────

  /**
   * Whether the system is fully initialized and ready.
   * @returns {boolean}
   */
  isReady() {
    return this._ready;
  }

  /**
   * Get initialization status for each domain.
   * @returns {Object}
   */
  _getDomainStatus() {
    return {
      communication: this.communication !== null,
      intelligence: this.intelligence !== null,
      orchestration: this.orchestration !== null,
      quality: this.quality !== null,
      observe: this.observe !== null,
    };
  }

  /**
   * Return the full V9 architecture status using design semantics.
   * Runtime domains stay separate from the dual foundation and bridge domain.
   *
   * @returns {Object}
   */
  _getArchitectureStatus() {
    const runtimeStatus = this._getDomainStatus();
    const foundationReady = this.field !== null && this.bus !== null && this.store !== null;

    return {
      core: foundationReady,
      ...runtimeStatus,
      bridge: this.bridge !== null,
    };
  }

  /**
   * Return aggregate statistics.
   * @returns {Object}
   */
  getStats() {
    const activeDomains = [
      this.communication, this.intelligence, this.orchestration,
      this.quality, this.observe,
    ].filter(Boolean).length;
    const architectureStatus = this._getArchitectureStatus();

    return {
      ready: this._ready,
      version: this._version,
      startedAt: this._startedAt,
      uptimeMs: this._startedAt ? Date.now() - this._startedAt : 0,
      domains: activeDomains,
      totalDomains: RUNTIME_DOMAIN_COUNT,
      domainStatus: this._getDomainStatus(),
      runtimeSubsystems: {
        active: activeDomains,
        total: RUNTIME_DOMAIN_COUNT,
      },
      architectureDomains: {
        active: Object.values(architectureStatus).filter(Boolean).length,
        total: ARCHITECTURE_DOMAIN_COUNT,
      },
      architectureStatus,
      coupling: this._couplingResult,
      initErrors: this._initErrors.length,
      moduleCount: this._collectAllModules().length,
    };
  }
}
