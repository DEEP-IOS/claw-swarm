/**
 * ReputationLedger V6.2 寄生检测单元测试 / Parasite Detection Unit Tests
 *
 * V6.2 L3: 寄生 Agent 检测 + 贡献率分析
 * V6.2 L3: Parasite agent detection + contribution profile analysis
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReputationLedger } from '../../../src/L3-agent/reputation-ledger.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function createMockBus() {
  return { publish: vi.fn(), subscribe: vi.fn(() => () => {}) };
}

function createMockAgentRepo() {
  const capabilities = new Map();
  return {
    listAgents: vi.fn(() => [
      { id: 'agent-worker', name: 'Worker' },
      { id: 'agent-parasite', name: 'Parasite' },
      { id: 'agent-new', name: 'New' },
    ]),
    getAgent: vi.fn(() => ({})),
    getCapabilities: vi.fn((agentId) => {
      return capabilities.has(agentId) ? [...capabilities.get(agentId)] : [];
    }),
    createCapability: vi.fn((agentId, dimension, score) => {
      if (!capabilities.has(agentId)) capabilities.set(agentId, []);
      const list = capabilities.get(agentId);
      const idx = list.findIndex((c) => c.dimension === dimension);
      if (idx >= 0) list[idx].score = score;
      else list.push({ dimension, score });
    }),
  };
}

/**
 * 为 agent 批量记录声誉事件 / Bulk-record reputation events for an agent
 */
function recordBulkEvents(ledger, agentId, dimension, score, count) {
  for (let i = 0; i < count; i++) {
    ledger.recordEvent(agentId, {
      dimension,
      score,
      taskId: `task-${agentId}-${dimension}-${i}`,
    });
  }
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('ReputationLedger V6.2 Parasite Detection', () => {
  let ledger;
  let bus;
  let agentRepo;

  beforeEach(() => {
    bus = createMockBus();
    agentRepo = createMockAgentRepo();
    ledger = new ReputationLedger({
      agentRepo,
      messageBus: bus,
      logger: silentLogger,
    });

    // ── agent-worker: 健康 Agent (collaboration=0.8, competence=0.7)
    // ── agent-worker: healthy agent (collaboration=80, competence=70)
    recordBulkEvents(ledger, 'agent-worker', 'collaboration', 80, 8);
    recordBulkEvents(ledger, 'agent-worker', 'competence', 70, 8);

    // ── agent-parasite: 寄生 Agent (collaboration=0, competence=90)
    // ── agent-parasite: parasitic agent (collaboration=0, competence=90)
    recordBulkEvents(ledger, 'agent-parasite', 'collaboration', 0, 8);
    recordBulkEvents(ledger, 'agent-parasite', 'competence', 90, 8);

    // ── agent-new: 新 Agent, 事件不足 (仅 2 条)
    // ── agent-new: new agent, insufficient events (only 2)
    recordBulkEvents(ledger, 'agent-new', 'collaboration', 10, 1);
    recordBulkEvents(ledger, 'agent-new', 'competence', 60, 1);

    // 重置 publish mock 计数 / Reset publish mock counts
    bus.publish.mockClear();
  });

  // ── 方法存在性 / Method Existence ──────────────────────────────────────────

  it('should have detectParasites method', () => {
    expect(typeof ledger.detectParasites).toBe('function');
  });

  it('should have getContributionProfile method', () => {
    expect(typeof ledger.getContributionProfile).toBe('function');
  });

  // ── detectParasites 行为 / detectParasites Behavior ────────────────────────

  it('detectParasites should return empty array when no parasites', () => {
    // 全部为健康 Agent / All healthy agents
    agentRepo.listAgents.mockReturnValueOnce([
      { id: 'agent-worker', name: 'Worker' },
    ]);

    const result = ledger.detectParasites();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('detectParasites should detect agent with 0 collaboration but high competence', () => {
    const result = ledger.detectParasites();

    // agent-parasite 应该被检测出来 / agent-parasite should be detected
    const found = result.find((p) => p.agentId === 'agent-parasite');
    expect(found).toBeDefined();
    expect(found.parasiteScore).toBeGreaterThan(0.7);
    expect(found.competence).toBeGreaterThan(0);

    // agent-worker 不应该被检测出来 / agent-worker should NOT be detected
    const worker = result.find((p) => p.agentId === 'agent-worker');
    expect(worker).toBeUndefined();
  });

  it('detectParasites should skip agents with insufficient history', () => {
    const result = ledger.detectParasites();

    // agent-new 只有 2 条事件, 应被跳过 / agent-new has only 2 events, should be skipped
    const newAgent = result.find((p) => p.agentId === 'agent-new');
    expect(newAgent).toBeUndefined();
  });

  it('detectParasites should publish parasite.detected event', () => {
    ledger.detectParasites();

    const parasiteEvents = bus.publish.mock.calls.filter(
      (call) => call[0] === 'parasite.detected',
    );

    expect(parasiteEvents.length).toBeGreaterThanOrEqual(1);

    // 至少有一个是 agent-parasite / At least one is for agent-parasite
    const parasitePayload = parasiteEvents.find(
      (call) => call[1].agentId === 'agent-parasite',
    );
    expect(parasitePayload).toBeDefined();
    expect(parasitePayload[1].parasiteScore).toBeGreaterThan(0);
    expect(parasitePayload[1]).toHaveProperty('contributionRatio');
  });

  it('detectParasites should respect custom threshold', () => {
    // 使用极高阈值 — 不应该检出任何寄生 / Use very high threshold — no parasites
    const highThreshold = ledger.detectParasites({ threshold: 0.99 });
    expect(highThreshold.length).toBe(0);

    // 使用极低阈值 — 应该检出更多 / Use very low threshold — more detections
    const lowThreshold = ledger.detectParasites({ threshold: 0.01 });
    expect(lowThreshold.length).toBeGreaterThanOrEqual(1);
  });

  // ── getContributionProfile 行为 / getContributionProfile Behavior ─────────

  it('getContributionProfile should return contribution metrics', () => {
    const profile = ledger.getContributionProfile('agent-worker');

    expect(profile).toBeDefined();
    expect(typeof profile.contributionRatio).toBe('number');
    expect(typeof profile.collaborationMean).toBe('number');
    expect(typeof profile.competenceMean).toBe('number');
  });

  it('getContributionProfile should compute correct contributionRatio', () => {
    const parasiteProfile = ledger.getContributionProfile('agent-parasite');
    const workerProfile = ledger.getContributionProfile('agent-worker');

    // 寄生 Agent 的贡献率应远低于健康 Agent
    // Parasite agent's contribution ratio should be much lower than healthy agent
    expect(parasiteProfile.contributionRatio).toBeLessThan(workerProfile.contributionRatio);

    // 寄生 Agent 的 collaborationMean 应接近 0
    // Parasite agent's collaborationMean should be near 0
    expect(parasiteProfile.collaborationMean).toBeLessThan(workerProfile.collaborationMean);
  });

  // ── parasiteScore 公式验证 / parasiteScore Formula Validation ─────────────

  it('parasiteScore formula should be correct', () => {
    // 公式: parasiteScore = (1 - normalizedCollab) * normalizedCompetence * activityFactor
    // Formula: parasiteScore = (1 - normalizedCollab) * normalizedCompetence * activityFactor
    // normalizedCollab = collaborationMean / 100
    // normalizedCompetence = competenceMean / 100
    // activityFactor = min(1, eventCount / minEvents)

    const profile = ledger.getContributionProfile('agent-parasite');

    const normalizedCollab = profile.collaborationMean / 100;
    const normalizedCompetence = profile.competenceMean / 100;
    // agent-parasite 有 16 条事件 (8 collab + 8 comp), minEvents 默认 5
    // agent-parasite has 16 events (8 collab + 8 comp), minEvents default 5
    const activityFactor = Math.min(1, 16 / 5);

    const expectedScore = Math.round(
      (1 - normalizedCollab) * normalizedCompetence * activityFactor * 1000,
    ) / 1000;

    const result = ledger.detectParasites();
    const parasite = result.find((p) => p.agentId === 'agent-parasite');

    expect(parasite).toBeDefined();
    expect(parasite.parasiteScore).toBe(expectedScore);
  });
});
