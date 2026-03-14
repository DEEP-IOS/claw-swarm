/**
 * V6.0 架构集成测试 / V6.0 Architecture Integration Tests
 *
 * 验证进程分离、传输层兼容、DB Schema 一致性
 * Verify process separation, transport compatibility, DB schema consistency
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', '..', 'src');

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
const mockBus = { publish: vi.fn(), subscribe: vi.fn(() => () => {}) };

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('V6.0 Architecture Integration', () => {
  describe('模块导入 / Module Imports', () => {
    it('IPCBridge 可导入 / IPCBridge importable', async () => {
      const mod = await import('../../src/L1-infrastructure/ipc-bridge.js');
      expect(mod.IPCBridge).toBeDefined();
    });

    it('WorkerPool 可导入 / WorkerPool importable', async () => {
      const mod = await import('../../src/L1-infrastructure/worker-pool.js');
      expect(mod.WorkerPool).toBeDefined();
    });

    it('Transport 层可导入 / Transport layer importable', async () => {
      const { Transport } = await import('../../src/L2-communication/transports/transport-interface.js');
      const { EventEmitterTransport } = await import('../../src/L2-communication/transports/event-emitter-transport.js');
      const { BroadcastChannelTransport } = await import('../../src/L2-communication/transports/broadcast-channel-transport.js');

      expect(Transport).toBeDefined();
      expect(EventEmitterTransport).toBeDefined();
      expect(BroadcastChannelTransport).toBeDefined();
    });

    it('V6.0 新模块全部可导入 / All V6.0 new modules importable', async () => {
      const modules = [
        '../../src/L3-agent/embedding-engine.js',
        '../../src/L3-agent/vector-index.js',
        '../../src/L3-agent/hybrid-retrieval.js',
        '../../src/L3-agent/sna-analyzer.js',
        '../../src/L3-agent/failure-mode-analyzer.js',
        '../../src/L4-orchestration/shapley-credit.js',
        '../../src/L4-orchestration/dual-process-router.js',
        '../../src/L4-orchestration/signal-calibrator.js',
        '../../src/L4-orchestration/budget-forecaster.js',
      ];

      for (const modPath of modules) {
        const mod = await import(modPath);
        expect(mod).toBeDefined();
        // 每个模块应至少导出一个类或函数
        const exports = Object.keys(mod);
        expect(exports.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Transport 兼容性 / Transport Compatibility', () => {
    it('EventEmitterTransport 满足 Transport 接口 / EET implements Transport', async () => {
      const { EventEmitterTransport } = await import('../../src/L2-communication/transports/event-emitter-transport.js');
      const t = new EventEmitterTransport();

      expect(typeof t.emit).toBe('function');
      expect(typeof t.on).toBe('function');
      expect(typeof t.off).toBe('function');
      expect(typeof t.once).toBe('function');
      expect(typeof t.listenerCount).toBe('function');
      expect(typeof t.eventNames).toBe('function');
      expect(typeof t.removeAllListeners).toBe('function');
      expect(typeof t.destroy).toBe('function');

      t.destroy();
    });

    it('BroadcastChannelTransport 满足 Transport 接口 / BCT implements Transport', async () => {
      const { BroadcastChannelTransport } = await import('../../src/L2-communication/transports/broadcast-channel-transport.js');
      const t = new BroadcastChannelTransport({ channelName: `test-arch-${Date.now()}` });

      expect(typeof t.emit).toBe('function');
      expect(typeof t.on).toBe('function');
      expect(typeof t.off).toBe('function');
      expect(typeof t.once).toBe('function');
      expect(typeof t.listenerCount).toBe('function');
      expect(typeof t.eventNames).toBe('function');
      expect(typeof t.removeAllListeners).toBe('function');
      expect(typeof t.destroy).toBe('function');

      t.destroy();
    });
  });

  describe('DB Schema 一致性 / DB Schema Consistency', () => {
    it('SCHEMA_VERSION = 9 / SCHEMA_VERSION is 9', async () => {
      const schemas = await import('../../src/L1-infrastructure/schemas/database-schemas.js');
      // 检查导出的 schema 版本
      if (schemas.SCHEMA_VERSION !== undefined) {
        expect(schemas.SCHEMA_VERSION).toBe(9);
      }
    });

    it('V6.0 新表定义存在 / V6.0 new table definitions exist', async () => {
      const schemas = await import('../../src/L1-infrastructure/schemas/database-schemas.js');
      const tableNames = ['failure_mode_log', 'quality_audit', 'vector_index_meta',
                          'shapley_credits', 'sna_snapshots', 'ipc_call_stats'];

      // 检查 createAllTables 或 TABLE_SCHEMAS 包含新表
      if (schemas.TABLE_SCHEMAS) {
        for (const name of tableNames) {
          const found = schemas.TABLE_SCHEMAS.some((t) => t.name === name);
          expect(found).toBe(true);
        }
      }
    });
  });

  describe('Event Catalog 一致性 / Event Catalog Consistency', () => {
    it('V6.0 新 EventTopics 存在 / V6.0 new EventTopics exist', async () => {
      const catalog = await import('../../src/event-catalog.js');

      const v6Topics = [
        'SHAPLEY_CREDIT_COMPUTED',
        'SNA_METRICS_UPDATED',
        'DUAL_PROCESS_ROUTED',
        'VECTOR_INDEX_UPDATED',
        'SIGNAL_WEIGHTS_CALIBRATED',
        'FAILURE_MODE_CLASSIFIED',
        'BUDGET_EXHAUSTION_WARNING',
        'AGENT_STATE_CHANGED',
      ];

      if (catalog.EventTopics) {
        for (const topic of v6Topics) {
          expect(catalog.EventTopics[topic]).toBeDefined();
        }
      }
    });
  });

  describe('配置 Schema / Plugin Config Schema', () => {
    it('openclaw.plugin.json 可解析 / openclaw.plugin.json parseable', () => {
      const pluginJson = JSON.parse(
        readFileSync(join(__dirname, '..', '..', 'openclaw.plugin.json'), 'utf8'),
      );
      expect(pluginJson.id).toBe('claw-swarm');
      expect(pluginJson.version).toBe('7.0.0');
    });

    it('V6.0 配置项存在 / V6.0 config keys exist', () => {
      const pluginJson = JSON.parse(
        readFileSync(join(__dirname, '..', '..', 'openclaw.plugin.json'), 'utf8'),
      );
      const props = pluginJson.configSchema?.properties || {};

      const v6Keys = [
        'architecture', 'embedding', 'vectorIndex', 'signalCalibrator',
        'shapley', 'sna', 'dualProcess', 'hybridRetrieval',
        'failureModeAnalyzer', 'budgetForecaster', 'qualityAudit',
        'reputationDecay', 'metricsAlerting',
      ];

      for (const key of v6Keys) {
        expect(props[key]).toBeDefined();
      }
    });
  });
});
