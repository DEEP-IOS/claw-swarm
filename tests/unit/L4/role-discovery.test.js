/**
 * RoleDiscovery 单元测试 / RoleDiscovery Unit Tests
 *
 * 无需真实数据库, 使用 mock agentRepo 测试 DRDA 角色发现算法。
 * No real DB needed, uses mock agentRepo to test DRDA role discovery algorithm.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RoleDiscovery } from '../../../src/L4-orchestration/role-discovery.js';

// 静默 logger / Silent logger
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// Mock MessageBus / 模拟消息总线
const mockBus = { publish() {}, subscribe() {} };

// Mock AgentRepository / 模拟 Agent 数据仓库
const mockAgentRepo = {
  getAgent(id) { return { id, name: `Agent ${id}` }; },
  listAgents() { return []; },
};

/**
 * 创建模拟 Agent 配置 / Create mock agent profile
 *
 * @param {string} id
 * @param {Record<string, number>} capabilities - 8D 能力分数
 * @returns {Object}
 */
function createAgentProfile(id, capabilities) {
  return { id, name: `Agent-${id}`, capabilities };
}

describe('RoleDiscovery', () => {
  let discovery;

  beforeEach(() => {
    discovery = new RoleDiscovery({
      agentRepo: mockAgentRepo,
      messageBus: mockBus,
      logger: silentLogger,
    });
  });

  // ━━━ 1. encodeAgent 特征编码 / produces feature vector of expected length ━━━
  describe('encodeAgent', () => {
    it('应生成长度为 8 的特征向量 / should produce feature vector of length 8', () => {
      const agent = createAgentProfile('a1', {
        coding: 0.9,
        architecture: 0.3,
        testing: 0.7,
        documentation: 0.2,
        security: 0.5,
        performance: 0.8,
        communication: 0.4,
        domain: 0.6,
      });

      const vector = discovery.encodeAgent(agent);

      expect(vector).toHaveLength(8);
      expect(vector[0]).toBeCloseTo(0.9, 4); // coding
      expect(vector[2]).toBeCloseTo(0.7, 4); // testing
    });

    it('缺失维度应使用默认值 0.5 / missing dimensions should default to 0.5', () => {
      const agent = createAgentProfile('a2', { coding: 0.8 });
      const vector = discovery.encodeAgent(agent);

      expect(vector).toHaveLength(8);
      expect(vector[0]).toBeCloseTo(0.8, 4); // coding = 0.8
      expect(vector[1]).toBeCloseTo(0.5, 4); // architecture = default 0.5
    });

    it('值应被 clamp 到 [0, 1] / values should be clamped to [0, 1]', () => {
      const agent = createAgentProfile('a3', { coding: 1.5, testing: -0.3 });
      const vector = discovery.encodeAgent(agent);

      expect(vector[0]).toBeLessThanOrEqual(1);  // coding clamped
      expect(vector[2]).toBeGreaterThanOrEqual(0); // testing clamped
    });
  });

  // ━━━ 2. kMeansClustering 收敛测试 / converges on simple 2-cluster data ━━━
  describe('kMeansClustering', () => {
    it('应对明显分离的两组数据收敛 / should converge on clearly separated 2-cluster data', () => {
      // 簇 A: 高值向量 / Cluster A: high-value vectors
      // 簇 B: 低值向量 / Cluster B: low-value vectors
      const vectors = [
        [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9], // A
        [0.85, 0.88, 0.92, 0.87, 0.91, 0.86, 0.89, 0.93], // A
        [0.88, 0.92, 0.87, 0.91, 0.86, 0.93, 0.88, 0.90], // A
        [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1], // B
        [0.12, 0.08, 0.15, 0.11, 0.09, 0.13, 0.07, 0.14], // B
        [0.08, 0.11, 0.09, 0.12, 0.10, 0.07, 0.13, 0.08], // B
      ];

      const result = discovery.kMeansClustering(vectors, 2, {
        maxIterations: 100,
        threshold: 0.001,
      });

      expect(result.converged).toBe(true);
      expect(result.centroids).toHaveLength(2);
      expect(result.assignments).toHaveLength(6);
      expect(result.iterations).toBeLessThanOrEqual(100);

      // 前 3 个应属于同一簇, 后 3 个属于另一簇
      // First 3 should belong to same cluster, last 3 to other
      expect(result.assignments[0]).toBe(result.assignments[1]);
      expect(result.assignments[1]).toBe(result.assignments[2]);
      expect(result.assignments[3]).toBe(result.assignments[4]);
      expect(result.assignments[4]).toBe(result.assignments[5]);
      expect(result.assignments[0]).not.toBe(result.assignments[3]);
    });

    it('单数据点聚类应正常 / single data point clustering should work', () => {
      const vectors = [[0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]];
      const result = discovery.kMeansClustering(vectors, 1, { maxIterations: 10 });

      expect(result.centroids).toHaveLength(1);
      expect(result.assignments).toHaveLength(1);
      expect(result.assignments[0]).toBe(0);
    });
  });

  // ━━━ 3. centroidToTemplate 模板推导 / generates valid role template ━━━
  describe('centroidToTemplate', () => {
    it('应生成有效的角色模板 / should generate valid role template', () => {
      const centroid = [0.8, 0.3, 0.7, 0.2, 0.5, 0.9, 0.4, 0.6];
      const members = [
        createAgentProfile('m1', { coding: 0.8 }),
        createAgentProfile('m2', { coding: 0.7 }),
      ];

      const template = discovery.centroidToTemplate(centroid, members);

      // 基础结构验证 / Basic structure validation
      expect(template.id).toMatch(/^drda-/);
      expect(template.name).toMatch(/^discovered-/);
      expect(template.centroid).toHaveLength(8);
      expect(template.capabilities).toBeDefined();
      expect(template.memberAgentIds).toHaveLength(2);
      expect(template.clusterSize).toBe(2);

      // 能力值应与质心匹配 / Capabilities should match centroid
      expect(template.capabilities.coding).toBeCloseTo(0.8, 3);
      expect(template.capabilities.performance).toBeCloseTo(0.9, 3);
    });

    it('名称应基于主导维度 / name should be based on dominant dimension', () => {
      // performance (index 5) 最高 / performance (index 5) is highest
      const centroid = [0.1, 0.1, 0.1, 0.1, 0.1, 0.99, 0.1, 0.1];
      const template = discovery.centroidToTemplate(centroid, [createAgentProfile('x', {})]);

      expect(template.name).toBe('discovered-performance');
    });
  });

  // ━━━ 4. discover 端到端 / end-to-end with mock agents ━━━
  describe('discover end-to-end', () => {
    it('应从 Agent 列表中发现角色 / should discover roles from agent list', () => {
      // 创建两组特征明显不同的 Agent / Create two groups with distinct features
      const agents = [
        // 编码型 Agent / Coding-focused agents
        createAgentProfile('coder-1', { coding: 0.9, architecture: 0.3, testing: 0.2, documentation: 0.1, security: 0.2, performance: 0.3, communication: 0.1, domain: 0.1 }),
        createAgentProfile('coder-2', { coding: 0.85, architecture: 0.25, testing: 0.15, documentation: 0.15, security: 0.15, performance: 0.25, communication: 0.15, domain: 0.15 }),
        createAgentProfile('coder-3', { coding: 0.88, architecture: 0.28, testing: 0.18, documentation: 0.12, security: 0.18, performance: 0.28, communication: 0.12, domain: 0.12 }),
        // 沟通型 Agent / Communication-focused agents
        createAgentProfile('comm-1', { coding: 0.1, architecture: 0.1, testing: 0.1, documentation: 0.8, security: 0.1, performance: 0.1, communication: 0.9, domain: 0.8 }),
        createAgentProfile('comm-2', { coding: 0.15, architecture: 0.15, testing: 0.15, documentation: 0.75, security: 0.15, performance: 0.15, communication: 0.85, domain: 0.75 }),
        createAgentProfile('comm-3', { coding: 0.12, architecture: 0.12, testing: 0.12, documentation: 0.78, security: 0.12, performance: 0.12, communication: 0.88, domain: 0.78 }),
      ];

      const roles = discovery.discover(agents, { k: 2 });

      expect(roles.length).toBe(2);

      // 每个角色应有成员 / Each role should have members
      for (const role of roles) {
        expect(role.id).toBeTruthy();
        expect(role.name).toBeTruthy();
        expect(role.capabilities).toBeDefined();
        expect(role.clusterSize).toBeGreaterThan(0);
        expect(role.memberAgentIds.length).toBeGreaterThan(0);
      }

      // 两个角色的名称应不同 / Two roles should have different names
      expect(roles[0].name).not.toBe(roles[1].name);
    });

    it('空 Agent 列表应返回空 / empty agent list should return empty', () => {
      const roles = discovery.discover([]);
      expect(roles).toHaveLength(0);
    });

    it('单个 Agent 应返回单一角色 / single agent should return single role', () => {
      const agents = [
        createAgentProfile('solo', { coding: 0.7, testing: 0.8 }),
      ];

      const roles = discovery.discover(agents, { k: 3 });

      expect(roles).toHaveLength(1);
      expect(roles[0].clusterSize).toBe(1);
    });
  });
});
