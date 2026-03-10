/**
 * StartupDiagnostics V5.5 单元测试 / StartupDiagnostics V5.5 Unit Tests
 *
 * 测试 DB 连通性检查、空表检测、模块就绪、数据管道健康度
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { StartupDiagnostics } from '../../../src/L6-monitoring/startup-diagnostics.js';

function createMockDb(schemaVersion = 7) {
  const tables = {
    repair_memory: 0,
    dead_letter_tasks: 0,
    task_affinity: 0,
    trace_spans: 0,
    breaker_state: 0,
  };
  return {
    get(sql, ...params) {
      if (sql.includes('claw_meta')) {
        return { value: String(schemaVersion) };
      }
      // COUNT(*) queries
      for (const [table, count] of Object.entries(tables)) {
        if (sql.includes(table)) {
          return { cnt: count };
        }
      }
      return null;
    },
    run() {},
    all() { return []; },
    _tables: tables,
  };
}

function createMockBus() {
  const events = [];
  return {
    publish(topic, data) { events.push({ topic, data }); },
    subscribe() {},
    events,
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

describe('StartupDiagnostics', () => {
  let diag;
  let mockDb;
  let mockBus;

  beforeEach(() => {
    mockDb = createMockDb();
    mockBus = createMockBus();
    diag = new StartupDiagnostics({ db: mockDb, messageBus: mockBus, logger });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // DB 连通性 / DB Connectivity
  // ═══════════════════════════════════════════════════════════════════════

  describe('checkDbConnectivity', () => {
    it('should report connected with schema version', () => {
      const result = diag.checkDbConnectivity();
      expect(result.connected).toBe(true);
      expect(result.schemaVersion).toBe(7);
      expect(result.error).toBeNull();
    });

    it('should report disconnected when no db', () => {
      const d = new StartupDiagnostics({ logger });
      const result = d.checkDbConnectivity();
      expect(result.connected).toBe(false);
      expect(result.error).toBe('No database instance');
    });

    it('should handle db errors', () => {
      const badDb = {
        get() { throw new Error('DB locked'); },
      };
      const d = new StartupDiagnostics({ db: badDb, logger });
      const result = d.checkDbConnectivity();
      expect(result.connected).toBe(false);
      expect(result.error).toBe('DB locked');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 空表检测 / Empty Table Detection
  // ═══════════════════════════════════════════════════════════════════════

  describe('detectEmptyTables', () => {
    it('should detect all critical tables as empty by default', () => {
      const results = diag.detectEmptyTables();
      expect(results.length).toBe(5);
      expect(results.every(r => r.empty)).toBe(true);
    });

    it('should detect non-empty tables', () => {
      mockDb._tables.repair_memory = 5;
      mockDb._tables.trace_spans = 12;
      const results = diag.detectEmptyTables();
      const repairRow = results.find(r => r.table === 'repair_memory');
      expect(repairRow.empty).toBe(false);
      expect(repairRow.count).toBe(5);
      const traceRow = results.find(r => r.table === 'trace_spans');
      expect(traceRow.empty).toBe(false);
      expect(traceRow.count).toBe(12);
    });

    it('should return empty array when no db', () => {
      const d = new StartupDiagnostics({ logger });
      expect(d.detectEmptyTables()).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 数据管道 / Data Pipelines
  // ═══════════════════════════════════════════════════════════════════════

  describe('checkDataPipelines', () => {
    it('should return pipeline status for all 4 pipelines', () => {
      const pipelines = diag.checkDataPipelines();
      expect(pipelines.length).toBe(4);
      expect(pipelines.every(p => p.status === 'empty')).toBe(true);
    });

    it('should detect active pipelines', () => {
      mockDb._tables.repair_memory = 3;
      const pipelines = diag.checkDataPipelines();
      const strategy = pipelines.find(p => p.pipeline === 'strategy-feedback');
      expect(strategy.status).toBe('active');
      expect(strategy.rowCount).toBe(3);
    });

    it('should report no_db when database unavailable', () => {
      const d = new StartupDiagnostics({ logger });
      const pipelines = d.checkDataPipelines();
      expect(pipelines.every(p => p.status === 'no_db')).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 模块就绪 / Module Readiness
  // ═══════════════════════════════════════════════════════════════════════

  describe('checkModuleReadiness', () => {
    it('should check all key modules', () => {
      const modules = diag.checkModuleReadiness({
        messageBus: {},
        pheromoneEngine: {},
        capabilityEngine: {},
        gossipProtocol: {},
        dbManager: {},
      });
      expect(modules.length).toBeGreaterThan(0);
      const ready = modules.filter(m => m.ready);
      expect(ready.length).toBe(5);
    });

    it('should flag missing required modules', () => {
      const modules = diag.checkModuleReadiness({});
      const missing = modules.filter(m => !m.ready && m.details.includes('required'));
      expect(missing.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 汇总报告 / Summary Report
  // ═══════════════════════════════════════════════════════════════════════

  describe('generateReport', () => {
    it('should generate complete report structure', () => {
      const report = diag.generateReport({
        version: '5.5.0',
        featureFlags: { toolResilience: true },
        engines: { messageBus: {}, pheromoneEngine: {} },
      });

      expect(report).toHaveProperty('version', '5.5.0');
      expect(report).toHaveProperty('pid');
      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('db');
      expect(report).toHaveProperty('emptyTables');
      expect(report).toHaveProperty('dataPipelines');
      expect(report).toHaveProperty('moduleReadiness');
      expect(report).toHaveProperty('featureFlags');
      expect(report).toHaveProperty('health');
      expect(report.health).toHaveProperty('score');
      expect(report.health).toHaveProperty('status');
    });

    it('should compute healthy status for good state', () => {
      mockDb._tables.repair_memory = 1;
      mockDb._tables.trace_spans = 1;
      mockDb._tables.task_affinity = 1;
      mockDb._tables.dead_letter_tasks = 1;

      const report = diag.generateReport({
        version: '5.5.0',
        engines: {
          messageBus: {}, pheromoneEngine: {}, capabilityEngine: {},
          gossipProtocol: {}, dbManager: {},
        },
      });

      expect(report.health.status).toBe('healthy');
      expect(report.health.score).toBeGreaterThanOrEqual(0.8);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 发布报告 / Publish Report
  // ═══════════════════════════════════════════════════════════════════════

  describe('publishReport', () => {
    it('should publish diagnostics event to messageBus', () => {
      diag.publishReport({ version: '5.5.0' });
      expect(mockBus.events.length).toBe(1);
      expect(mockBus.events[0].topic).toBe('startup.diagnostics');
    });

    it('should return the report', () => {
      const report = diag.publishReport({ version: '5.5.0' });
      expect(report).toHaveProperty('version', '5.5.0');
      expect(report).toHaveProperty('health');
    });
  });
});
