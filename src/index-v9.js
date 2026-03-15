/**
 * Claw-Swarm V9 — OpenClaw Plugin Entry Point
 *
 * Wires SwarmCoreV9 (domains + field + store) to the OpenClaw plugin API
 * through HookAdapter and tool registrations.
 *
 * Called unconditionally from index.js — V9 is the sole active engine.
 *
 * @module index-v9
 * @version 9.0.0
 * @author DEEP-IOS
 */

import { SwarmCoreV9 } from './swarm-core-v9.js';
import { HookAdapter } from './bridge/hooks/hook-adapter.js';
import { SessionBridge } from './bridge/session/session-bridge.js';
import { ModelFallback } from './bridge/session/model-fallback.js';
import { SpawnClient } from './bridge/session/spawn-client.js';
import { ReadinessGuard } from './bridge/reliability/readiness-guard.js';

// ─── Safe tool import helper ────────────────────────────────────────────────

/**
 * Attempt to dynamically import a tool factory.
 * Returns null if the module does not exist yet.
 * @param {string} specifier
 * @returns {Promise<Function|null>}
 */
async function tryToolImport(specifier, exportName) {
  try {
    const mod = await import(specifier);
    return mod[exportName] || null;
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND') {
      return null;
    }
    throw err;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _instance = null;

// ─── activate / deactivate ──────────────────────────────────────────────────

/**
 * Plugin activate — called by OpenClaw when the plugin is loaded.
 *
 * 1. Create SwarmCoreV9 with dual foundation
 * 2. Create bridge modules (session, model fallback, spawn)
 * 3. Register all 16 hooks via HookAdapter
 * 4. Register all tools (existing + new)
 * 5. Start the core
 * 6. Mark ready
 *
 * @param {Object} app - OpenClaw app instance
 * @returns {Promise<Object>} instance reference
 */
export async function activate(app) {
  const config = app?.getConfig?.() ?? {};
  const bus = app?.getMessageBus?.();

  // ── Create core ─────────────────────────────────────────────────
  const core = new SwarmCoreV9(config, bus);

  // ── Create bridge modules ───────────────────────────────────────
  const sessionBridge = new SessionBridge({
    field: core.field,
    bus: core.bus,
    store: core.store,
  });
  const modelFallback = new ModelFallback(config.modelFallback || {});
  const spawnClient = new SpawnClient(config.spawnClient || {});
  const readinessGuard = new ReadinessGuard(config.readinessGuard || {});

  // ── Register hooks ──────────────────────────────────────────────
  const hookAdapter = new HookAdapter({
    core,
    quality: core.quality,
    observe: core.observe,
    sessionBridge,
    modelFallback,
    spawnClient,
    config: config.hooks || {},
  });
  hookAdapter.registerHooks(app);

  // ── Import tool factories ───────────────────────────────────────
  const toolFactories = await Promise.all([
    tryToolImport('./bridge/tools/run-tool.js', 'createRunTool'),
    tryToolImport('./bridge/tools/query-tool.js', 'createQueryTool'),
    tryToolImport('./bridge/tools/dispatch-tool.js', 'createDispatchTool'),
    tryToolImport('./bridge/tools/checkpoint-tool.js', 'createCheckpointTool'),
    tryToolImport('./bridge/tools/gate-tool.js', 'createGateTool'),
    tryToolImport('./bridge/tools/memory-tool.js', 'createMemoryTool'),
    tryToolImport('./bridge/tools/pheromone-tool.js', 'createPheromoneTool'),
    tryToolImport('./bridge/tools/plan-tool.js', 'createPlanTool'),
    tryToolImport('./bridge/tools/zone-tool.js', 'createZoneTool'),
    tryToolImport('./bridge/tools/spawn-tool.js', 'createSpawnTool'),
  ]);

  // ── Create and register tools ───────────────────────────────────
  const deps = { core, quality: core.quality, sessionBridge, spawnClient };
  const registeredTools = [];

  for (const factory of toolFactories) {
    if (typeof factory === 'function') {
      try {
        const tool = factory(deps);
        if (tool) {
          app?.registerTool?.(tool);
          registeredTools.push(tool.name || 'unnamed');
        }
      } catch (_) {
        // Tool creation failure is non-fatal; log and continue
      }
    }
  }

  // ── Start the core ──────────────────────────────────────────────
  await core.start();

  // ── Update bridge refs that depend on initialized domains ───────
  // quality and observe are null at HookAdapter construction time
  // because core.initialize() runs inside core.start(). Patch them now.
  hookAdapter._quality = core.quality;
  hookAdapter._observe = core.observe;

  readinessGuard.setReady(true, 'V9 core started');

  // ── Store singleton ─────────────────────────────────────────────
  _instance = {
    core,
    hookAdapter,
    sessionBridge,
    spawnClient,
    readinessGuard,
    modelFallback,
    registeredTools,
  };

  return _instance;
}

/**
 * Plugin deactivate — called by OpenClaw when the plugin is unloaded.
 * Stops the core and clears the singleton.
 *
 * @param {Object} app - OpenClaw app instance (unused)
 */
export async function deactivate(app) {
  if (!_instance) return;

  _instance.readinessGuard.setReady(false, 'V9 core stopping');

  try {
    await _instance.core.stop();
  } catch (_) {
    // Stop errors are non-fatal during deactivate
  }

  _instance = null;
}

/**
 * Get the current singleton instance (for testing/inspection).
 * @returns {Object|null}
 */
export function getInstance() {
  return _instance;
}
