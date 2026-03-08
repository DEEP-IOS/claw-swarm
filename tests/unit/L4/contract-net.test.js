/**
 * ContractNet 单元测试 / ContractNet Unit Tests
 *
 * 无需真实数据库, 使用 mock 测试 FIPA 合同网协议。
 * No real DB needed, uses mocks to test FIPA Contract Net Protocol.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContractNet } from '../../../src/L4-orchestration/contract-net.js';

// 静默 logger / Silent logger
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// Mock MessageBus / 模拟消息总线
const mockBus = { publish() {}, subscribe() {} };

describe('ContractNet', () => {
  let cn;

  beforeEach(() => {
    cn = new ContractNet({
      messageBus: mockBus,
      config: { defaultTimeout: 5000 },
      logger: silentLogger,
    });
  });

  afterEach(() => {
    // 清理所有超时 / Clean up all timeouts
    cn.destroy();
  });

  // ━━━ 1. createCFP 创建开放 CFP / creates open CFP ━━━
  describe('createCFP', () => {
    it('应创建状态为 open 的 CFP / should create a CFP with open status', () => {
      const cfpId = cn.createCFP('task-1', { coding: 0.8 });

      expect(cfpId).toBeTruthy();
      const status = cn.getCFPStatus(cfpId);
      expect(status).not.toBeNull();
      expect(status.status).toBe('open');
      expect(status.taskId).toBe('task-1');
      expect(status.bidCount).toBe(0);
    });
  });

  // ━━━ 2. submitBid 添加投标 / adds bid to CFP ━━━
  describe('submitBid', () => {
    it('应成功添加投标到 CFP / should add bid to the CFP', () => {
      const cfpId = cn.createCFP('task-2', { coding: 0.7 });
      const bidId = cn.submitBid(cfpId, 'agent-A', {
        capabilityMatch: 0.85,
        workloadFactor: 0.7,
        successRate: 0.9,
        opportunityCost: 0.1,
      });

      expect(bidId).toBeTruthy();
      const status = cn.getCFPStatus(cfpId);
      expect(status.bidCount).toBe(1);
    });

    it('重复投标应抛出错误 / duplicate bid should throw error', () => {
      const cfpId = cn.createCFP('task-dup', { coding: 0.5 });
      cn.submitBid(cfpId, 'agent-X', { capabilityMatch: 0.5 });

      expect(() => {
        cn.submitBid(cfpId, 'agent-X', { capabilityMatch: 0.6 });
      }).toThrow();
    });
  });

  // ━━━ 3. evaluateBids 返回最高分赢家 / returns winner with highest score ━━━
  describe('evaluateBids', () => {
    it('应返回综合分最高的 Agent 作为赢家 / should return agent with highest combined score as winner', () => {
      const cfpId = cn.createCFP('task-3', { coding: 0.8 });

      // Agent-A: 低分 / Low score
      cn.submitBid(cfpId, 'agent-A', {
        capabilityMatch: 0.3,
        workloadFactor: 0.3,
        successRate: 0.3,
        opportunityCost: 0.5,
        reputation: 0.3,
        resource: 0.3,
      });

      // Agent-B: 高分 / High score
      cn.submitBid(cfpId, 'agent-B', {
        capabilityMatch: 0.95,
        workloadFactor: 0.9,
        successRate: 0.95,
        opportunityCost: 0.05,
        reputation: 0.9,
        resource: 0.9,
      });

      const result = cn.evaluateBids(cfpId);

      expect(result.winner).not.toBeNull();
      expect(result.winner.agentId).toBe('agent-B');
      expect(result.bids).toHaveLength(2);
      expect(result.scores).toHaveLength(2);
      // 分数应降序 / Scores should be descending
      expect(result.scores[0]).toBeGreaterThanOrEqual(result.scores[1]);
    });

    it('无投标应返回 null winner / no bids should return null winner', () => {
      const cfpId = cn.createCFP('task-empty', {});
      const result = cn.evaluateBids(cfpId);
      expect(result.winner).toBeNull();
      expect(result.bids).toHaveLength(0);
    });
  });

  // ━━━ 4. awardContract 转换 CFP 为 awarded / transitions CFP to awarded ━━━
  describe('awardContract', () => {
    it('应将 CFP 状态转为 awarded 并创建合同 / should transition CFP to awarded and create contract', () => {
      const cfpId = cn.createCFP('task-4', { coding: 0.6 });
      cn.submitBid(cfpId, 'agent-winner', { capabilityMatch: 0.9, successRate: 0.8 });
      cn.evaluateBids(cfpId);

      const contractId = cn.awardContract(cfpId, 'agent-winner');
      expect(contractId).toBeTruthy();

      const cfpStatus = cn.getCFPStatus(cfpId);
      expect(cfpStatus.status).toBe('awarded');
      expect(cfpStatus.winnerId).toBe('agent-winner');
      expect(cfpStatus.contractId).toBe(contractId);
    });

    it('未投标的 Agent 不能获得合同 / non-bidding agent should not be awarded', () => {
      const cfpId = cn.createCFP('task-4b', {});
      cn.submitBid(cfpId, 'agent-A', { capabilityMatch: 0.5 });

      expect(() => {
        cn.awardContract(cfpId, 'agent-nonexistent');
      }).toThrow();
    });
  });

  // ━━━ 5. completeContract 标记完成 / marks contract as done ━━━
  describe('completeContract', () => {
    it('应将合同标记为完成 / should mark contract as completed', () => {
      const cfpId = cn.createCFP('task-5', {});
      cn.submitBid(cfpId, 'agent-C', { capabilityMatch: 0.7 });
      cn.evaluateBids(cfpId);
      const contractId = cn.awardContract(cfpId, 'agent-C');

      cn.completeContract(contractId, { output: 'done' });

      const stats = cn.getStats();
      expect(stats.completed).toBeGreaterThanOrEqual(1);
    });

    it('已完成合同不能再次完成 / completed contract cannot be completed again', () => {
      const cfpId = cn.createCFP('task-5b', {});
      cn.submitBid(cfpId, 'agent-D', { capabilityMatch: 0.6 });
      cn.evaluateBids(cfpId);
      const contractId = cn.awardContract(cfpId, 'agent-D');
      cn.completeContract(contractId);

      expect(() => cn.completeContract(contractId)).toThrow();
    });
  });

  // ━━━ 6. failContract 标记失败 / marks contract as failed ━━━
  describe('failContract', () => {
    it('应将合同标记为失败 / should mark contract as failed', () => {
      const cfpId = cn.createCFP('task-6', {});
      cn.submitBid(cfpId, 'agent-E', { capabilityMatch: 0.5 });
      cn.evaluateBids(cfpId);
      const contractId = cn.awardContract(cfpId, 'agent-E');

      cn.failContract(contractId, new Error('timeout'));

      const stats = cn.getStats();
      expect(stats.failed).toBeGreaterThanOrEqual(1);
    });
  });

  // ━━━ 7. computeBidScore 分数范围 / returns value between 0-1 ━━━
  describe('computeBidScore', () => {
    it('应返回 [0, 1] 之间的值 / should return value between 0 and 1', () => {
      const score1 = cn.computeBidScore({
        capabilityMatch: 1.0,
        workloadFactor: 1.0,
        successRate: 1.0,
        opportunityCost: 0,
      });
      expect(score1).toBeGreaterThanOrEqual(0);
      expect(score1).toBeLessThanOrEqual(1);

      const score2 = cn.computeBidScore({
        capabilityMatch: 0,
        workloadFactor: 0,
        successRate: 0,
        opportunityCost: 1.0,
      });
      expect(score2).toBeGreaterThanOrEqual(0);
      expect(score2).toBeLessThanOrEqual(1);
    });

    it('高能力匹配应有更高分 / higher capability match should yield higher score', () => {
      const highCap = cn.computeBidScore({ capabilityMatch: 0.9, successRate: 0.5 });
      const lowCap = cn.computeBidScore({ capabilityMatch: 0.1, successRate: 0.5 });
      expect(highCap).toBeGreaterThan(lowCap);
    });
  });

  // ━━━ 8. CFP 超时 / CFP timeout ━━━
  describe('CFP timeout', () => {
    it('超时后 CFP 应变为 expired / CFP should become expired after timeout', async () => {
      // 使用极短超时 / Use very short timeout
      const shortCn = new ContractNet({
        messageBus: mockBus,
        config: { defaultTimeout: 50 },
        logger: silentLogger,
      });

      const cfpId = shortCn.createCFP('task-timeout', {});
      expect(shortCn.getCFPStatus(cfpId).status).toBe('open');

      // 等待超时 / Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 120));

      expect(shortCn.getCFPStatus(cfpId).status).toBe('expired');

      const stats = shortCn.getStats();
      expect(stats.expired).toBeGreaterThanOrEqual(1);

      shortCn.destroy();
    });
  });
});
