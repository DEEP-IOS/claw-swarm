/**
 * AnomalyDetector V6.2 单元测试 / AnomalyDetector V6.2 Unit Tests
 *
 * 测试 L3 负选择异常检测器: 基线维护、σ 阈值检测、
 * 延迟/质量异常、手动检查、异常历史、FailureVaccination 联动等。
 *
 * Tests L3 negative-selection anomaly detector: baseline maintenance,
 * sigma threshold detection, latency/quality anomalies, manual check,
 * anomaly history, FailureVaccination integration, etc.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnomalyDetector } from '../../../src/L3-agent/anomaly-detector.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function createMockBus() {
  return {
    publish: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  };
}

function createMockVaccination() {
  return {
    findSimilar: vi.fn(() => []),
  };
}

/**
 * 记录 N 条正常延迟结果 (均值约 100±5)
 * Record N normal latency results (mean ~100 +/- 5)
 */
function recordNormalResults(detector, agentId, count = 12) {
  for (let i = 0; i < count; i++) {
    detector.recordResult(agentId, {
      latencyMs: 100 + (i % 5) - 2, // 98, 99, 100, 101, 102 循环
      quality: 0.85 + (i % 3) * 0.01,
      taskType: 'summarize',
    });
  }
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('AnomalyDetector (V6.2)', () => {
  let messageBus;
  let failureVaccination;
  let detector;

  beforeEach(() => {
    messageBus = createMockBus();
    failureVaccination = createMockVaccination();
    detector = new AnomalyDetector({
      messageBus,
      failureVaccination,
      logger: silentLogger,
      config: {
        windowSize: 20,
        sigmaThreshold: 2.0,
        minSamples: 5,
      },
    });
  });

  // ━━━ 1. 实例创建 / Instance Creation ━━━

  it('should create AnomalyDetector instance', () => {
    expect(detector).toBeInstanceOf(AnomalyDetector);
    const stats = detector.getStats();
    expect(stats.totalRecords).toBe(0);
    expect(stats.totalAnomalies).toBe(0);
    expect(stats.agentsTracked).toBe(0);
  });

  // ━━━ 2. 阈值内无异常 / No anomaly below threshold ━━━

  it('should record results without anomaly when below threshold', () => {
    recordNormalResults(detector, 'agent-1', 10);
    // 再记录一条正常范围内的结果 / Record one more within normal range
    const { anomalies } = detector.recordResult('agent-1', {
      latencyMs: 101,
      quality: 0.86,
      taskType: 'summarize',
    });
    expect(anomalies).toEqual([]);
  });

  // ━━━ 3. 偏离 >2σ 检测异常 / Detect anomaly when >2σ deviation ━━━

  it('should detect anomaly when metric deviates >2\u03C3', () => {
    // 先记录 12 条正常结果建立基线 / Record 12 normal results for baseline
    recordNormalResults(detector, 'agent-1', 12);

    // 记录一条异常高延迟 / Record an abnormally high latency
    const { anomalies } = detector.recordResult('agent-1', {
      latencyMs: 500,
      quality: 0.85,
      taskType: 'summarize',
    });

    expect(anomalies.length).toBeGreaterThanOrEqual(1);
    const latencyAnomaly = anomalies.find(a => a.metric === 'latencyMs');
    expect(latencyAnomaly).toBeTruthy();
    expect(latencyAnomaly.value).toBe(500);
    expect(latencyAnomaly.sigmas).toBeGreaterThan(2);
  });

  // ━━━ 4. 样本不足时不检测 / No detection with insufficient samples ━━━

  it('should not detect anomaly with insufficient samples', () => {
    // 只记录 3 条 (低于 minSamples=5) / Only 3 records (below minSamples=5)
    for (let i = 0; i < 3; i++) {
      detector.recordResult('agent-1', { latencyMs: 100 });
    }
    // 即使极端值也不应触发 / Even extreme value should not trigger
    const { anomalies } = detector.recordResult('agent-1', { latencyMs: 9999 });
    expect(anomalies).toEqual([]);
  });

  // ━━━ 5. 每个 agent 独立基线 / Per-agent baseline ━━━

  it('should maintain baseline per agent', () => {
    // agent-fast: 正常延迟 ~100ms / Normal latency ~100ms
    recordNormalResults(detector, 'agent-fast', 12);
    // agent-slow: 正常延迟 ~1000ms / Normal latency ~1000ms
    for (let i = 0; i < 12; i++) {
      detector.recordResult('agent-slow', {
        latencyMs: 1000 + (i % 5) - 2,
        taskType: 'analyze',
      });
    }

    // 100ms 对 agent-fast 正常, 对 agent-slow 异常
    // 100ms is normal for agent-fast, anomalous for agent-slow
    const fastResult = detector.recordResult('agent-fast', { latencyMs: 102 });
    expect(fastResult.anomalies).toEqual([]);

    const slowResult = detector.recordResult('agent-slow', { latencyMs: 100 });
    const latencyAnomaly = slowResult.anomalies.find(a => a.metric === 'latencyMs');
    expect(latencyAnomaly).toBeTruthy();
  });

  // ━━━ 6. getBaseline 返回均值和标准差 / getBaseline returns mean and stdDev ━━━

  it('getBaseline should return mean and stdDev', () => {
    recordNormalResults(detector, 'agent-1', 10);

    const baseline = detector.getBaseline('agent-1');
    expect(baseline).toHaveProperty('latencyMs');
    expect(baseline.latencyMs).toHaveProperty('mean');
    expect(baseline.latencyMs).toHaveProperty('stdDev');
    expect(baseline.latencyMs.mean).toBeGreaterThan(0);
    expect(typeof baseline.latencyMs.stdDev).toBe('number');

    // 不存在的 agent 应返回空对象 / Non-existent agent returns empty object
    const empty = detector.getBaseline('unknown-agent');
    expect(empty).toEqual({});
  });

  // ━━━ 7. 延迟异常检测 / Latency anomaly detection ━━━

  it('should detect latency anomaly', () => {
    recordNormalResults(detector, 'agent-1', 12);

    // 极高延迟 / Extreme high latency
    const { anomalies } = detector.recordResult('agent-1', {
      latencyMs: 500,
      taskType: 'summarize',
    });

    const latencyAnomaly = anomalies.find(a => a.metric === 'latencyMs');
    expect(latencyAnomaly).toBeTruthy();
    expect(latencyAnomaly.agentId).toBe('agent-1');
    expect(latencyAnomaly.metric).toBe('latencyMs');
    expect(latencyAnomaly.mean).toBeLessThan(200);
  });

  // ━━━ 8. 质量异常检测 / Quality anomaly detection ━━━

  it('should detect quality anomaly', () => {
    // 建立高质量基线 / Establish high-quality baseline
    for (let i = 0; i < 12; i++) {
      detector.recordResult('agent-1', {
        latencyMs: 100,
        quality: 0.9 + (i % 3) * 0.01,
        taskType: 'review',
      });
    }

    // 极低质量 / Extreme low quality
    const { anomalies } = detector.recordResult('agent-1', {
      latencyMs: 100,
      quality: 0.1,
      taskType: 'review',
    });

    const qualityAnomaly = anomalies.find(a => a.metric === 'quality');
    expect(qualityAnomaly).toBeTruthy();
    expect(qualityAnomaly.value).toBe(0.1);
  });

  // ━━━ 9. checkAnomaly 不录入 / checkAnomaly without recording ━━━

  it('checkAnomaly should work without recording', () => {
    recordNormalResults(detector, 'agent-1', 12);

    const statsBefore = detector.getStats();
    const totalBefore = statsBefore.totalRecords;

    // 手动检查 (不影响窗口) / Manual check (does not affect window)
    const result = detector.checkAnomaly('agent-1', { latencyMs: 500 });
    expect(result.isAnomaly).toBe(true);
    expect(result.details.length).toBeGreaterThanOrEqual(1);
    expect(result.details[0].metric).toBe('latencyMs');
    expect(result.details[0].sigmas).toBeGreaterThan(2);

    // 确认 totalRecords 没变 / Confirm totalRecords unchanged
    const statsAfter = detector.getStats();
    expect(statsAfter.totalRecords).toBe(totalBefore);

    // 没有基线的 agent 返回非异常 / Agent without baseline returns no anomaly
    const noBaseline = detector.checkAnomaly('unknown', { latencyMs: 500 });
    expect(noBaseline.isAnomaly).toBe(false);
    expect(noBaseline.details).toEqual([]);
  });

  // ━━━ 10. getAnomalyHistory / Anomaly History ━━━

  it('getAnomalyHistory should return recent anomalies', () => {
    recordNormalResults(detector, 'agent-1', 12);

    // 触发两次异常 / Trigger two anomalies
    detector.recordResult('agent-1', { latencyMs: 500, taskType: 'test' });
    detector.recordResult('agent-1', { latencyMs: 600, taskType: 'test' });

    const history = detector.getAnomalyHistory('agent-1', { limit: 10 });
    expect(history.length).toBeGreaterThanOrEqual(2);
    // 最新的在前 / Most recent first
    expect(history[0].value).toBe(600);
    expect(history[1].value).toBe(500);

    // 不存在的 agent 返回空 / Non-existent agent returns empty
    expect(detector.getAnomalyHistory('unknown')).toEqual([]);
  });

  // ━━━ 11. FailureVaccination 联动 / FailureVaccination integration ━━━

  it('should call failureVaccination.findSimilar on anomaly', () => {
    failureVaccination.findSimilar.mockReturnValue([
      { vaccineStrategy: 'retry-with-backoff', effectiveness: 0.8 },
    ]);

    recordNormalResults(detector, 'agent-1', 12);

    const { anomalies } = detector.recordResult('agent-1', {
      latencyMs: 500,
      taskType: 'summarize',
    });

    expect(failureVaccination.findSimilar).toHaveBeenCalledWith('summarize');
    const latencyAnomaly = anomalies.find(a => a.metric === 'latencyMs');
    expect(latencyAnomaly).toBeTruthy();
    expect(latencyAnomaly.vaccines).toBeTruthy();
    expect(latencyAnomaly.vaccines.length).toBe(1);
    expect(latencyAnomaly.vaccines[0].vaccineStrategy).toBe('retry-with-backoff');
  });

  // ━━━ 12. getStats 全局统计 / Global statistics ━━━

  it('getStats should return global statistics', () => {
    recordNormalResults(detector, 'agent-1', 12);
    recordNormalResults(detector, 'agent-2', 8);
    detector.recordResult('agent-1', { latencyMs: 500 });

    const stats = detector.getStats();
    expect(stats.totalRecords).toBe(12 + 8 + 1);
    expect(stats.agentsTracked).toBe(2);
    expect(stats.totalAnomalies).toBeGreaterThanOrEqual(1);
  });
});
