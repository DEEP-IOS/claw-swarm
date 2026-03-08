/**
 * DashboardService 单元测试 / DashboardService Unit Tests
 *
 * 测试 L6 仪表板服务的构造、端口配置和运行状态 (不启动真实服务器)。
 * Tests L6 dashboard service constructor, port config, and running state
 * (without starting a real server).
 */

import { describe, it, expect } from 'vitest';
import { DashboardService } from '../../../src/L6-monitoring/dashboard-service.js';

// ── 辅助函数 / Helpers ──────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function createMockBroadcaster() {
  return {
    addClient: () => (() => {}),
    removeClient: () => {},
    getStats: () => ({ broadcasting: true, clientCount: 0, totalBroadcasts: 0 }),
  };
}

function createMockMetrics() {
  return {
    getSnapshot: () => ({ red: { rate: 0, errorRate: 0, avgDuration: 0 }, swarm: {} }),
    getStats: () => ({ running: false, totalRequests: 0, totalErrors: 0 }),
  };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('DashboardService', () => {
  it('构造函数初始化 / constructor initializes', () => {
    const svc = new DashboardService({
      stateBroadcaster: createMockBroadcaster(),
      metricsCollector: createMockMetrics(),
      logger: silentLogger,
    });
    expect(svc).toBeDefined();
    expect(svc.isRunning()).toBe(false);
  });

  it('默认端口 19100 / default port 19100', () => {
    const svc = new DashboardService({
      stateBroadcaster: createMockBroadcaster(),
      metricsCollector: createMockMetrics(),
      logger: silentLogger,
    });
    expect(svc.getPort()).toBe(19100);
  });

  it('自定义端口 / custom port', () => {
    const svc = new DashboardService({
      stateBroadcaster: createMockBroadcaster(),
      metricsCollector: createMockMetrics(),
      logger: silentLogger,
      port: 8888,
    });
    expect(svc.getPort()).toBe(8888);
  });

  it('stop 在未启动时不报错 / stop without start does not throw', async () => {
    const svc = new DashboardService({
      stateBroadcaster: createMockBroadcaster(),
      metricsCollector: createMockMetrics(),
      logger: silentLogger,
    });
    await expect(svc.stop()).resolves.not.toThrow();
  });

  it('isRunning 初始为 false / isRunning initially false', () => {
    const svc = new DashboardService({
      stateBroadcaster: createMockBroadcaster(),
      metricsCollector: createMockMetrics(),
      logger: silentLogger,
    });
    expect(svc.isRunning()).toBe(false);
  });
});
