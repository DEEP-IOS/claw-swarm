/**
 * ZoneManager 单元测试 / ZoneManager Unit Tests
 *
 * 使用真实 DatabaseManager + TABLE_SCHEMAS 测试 Zone 分区治理管理。
 * Uses real DatabaseManager + TABLE_SCHEMAS to test zone governance management.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../../src/L1-infrastructure/database/database-manager.js';
import { ZoneRepository } from '../../../src/L1-infrastructure/database/repositories/zone-repo.js';
import { AgentRepository } from '../../../src/L1-infrastructure/database/repositories/agent-repo.js';
import { TABLE_SCHEMAS } from '../../../src/L1-infrastructure/schemas/database-schemas.js';
import { ZoneManager } from '../../../src/L4-orchestration/zone-manager.js';

// 静默 logger / Silent logger
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// Mock MessageBus / 模拟消息总线
const mockBus = { publish() {}, subscribe() {} };

describe('ZoneManager', () => {
  let dbManager, zoneRepo, agentRepo, manager;

  beforeEach(() => {
    // 创建内存数据库并初始化所有表 / Create in-memory DB and bootstrap all tables
    dbManager = new DatabaseManager({ memory: true });
    dbManager.open(TABLE_SCHEMAS);

    zoneRepo = new ZoneRepository(dbManager);
    agentRepo = new AgentRepository(dbManager);

    manager = new ZoneManager({
      zoneRepo,
      agentRepo,
      messageBus: mockBus,
      config: {
        jaccardThreshold: 0.3,
        maxMembers: 50,
      },
      logger: silentLogger,
    });
  });

  afterEach(() => {
    dbManager.close();
  });

  // ━━━ 1. createZone + getZone ━━━
  describe('createZone + getZone', () => {
    it('应创建 Zone 并可读取 / should create zone and retrieve it', () => {
      const zoneId = manager.createZone({
        name: 'frontend',
        description: '前端团队 / Frontend team',
        techStack: ['react', 'typescript', 'css'],
      });

      expect(zoneId).toBeTruthy();

      const zone = manager.getZone(zoneId);
      expect(zone).not.toBeNull();
      expect(zone.name).toBe('frontend');
      expect(zone.description).toBe('前端团队 / Frontend team');
      expect(zone.techStack).toContain('react');
      expect(zone.techStack).toContain('typescript');
    });

    it('空名称应抛出错误 / empty name should throw error', () => {
      expect(() => {
        manager.createZone({ name: '' });
      }).toThrow();
    });

    it('不存在的 Zone 应返回 null / non-existent zone should return null', () => {
      expect(manager.getZone('nonexistent')).toBeNull();
    });
  });

  // ━━━ 2. listZones ━━━
  describe('listZones', () => {
    it('应列出所有 Zone / should list all zones', () => {
      manager.createZone({ name: 'zone-a', techStack: ['go'] });
      manager.createZone({ name: 'zone-b', techStack: ['python'] });
      manager.createZone({ name: 'zone-c', techStack: ['rust'] });

      const zones = manager.listZones();
      expect(zones).toHaveLength(3);

      const names = zones.map(z => z.name);
      expect(names).toContain('zone-a');
      expect(names).toContain('zone-b');
      expect(names).toContain('zone-c');
    });

    it('无 Zone 时应返回空数组 / should return empty array when no zones', () => {
      expect(manager.listZones()).toHaveLength(0);
    });
  });

  // ━━━ 3. assignAgent ━━━
  describe('assignAgent', () => {
    it('应将 Agent 分配到 Zone / should assign agent to zone', () => {
      const agentId = agentRepo.createAgent({ name: 'Agent-1' });
      const zoneId = manager.createZone({ name: 'backend', techStack: ['node'] });

      manager.assignAgent(agentId, zoneId);

      const members = manager.getMembers(zoneId);
      expect(members.length).toBe(1);
      expect(members[0].agent_id).toBe(agentId);
      expect(members[0].role).toBe('member');
    });

    it('不存在的 Zone 应抛出错误 / non-existent zone should throw error', () => {
      const agentId = agentRepo.createAgent({ name: 'Agent-2' });

      expect(() => {
        manager.assignAgent(agentId, 'fake-zone');
      }).toThrow();
    });

    it('指定角色应正确保存 / specified role should be saved correctly', () => {
      const agentId = agentRepo.createAgent({ name: 'Agent-3' });
      const zoneId = manager.createZone({ name: 'ops', techStack: ['docker'] });

      manager.assignAgent(agentId, zoneId, 'leader');

      const members = manager.getMembers(zoneId);
      expect(members[0].role).toBe('leader');
    });
  });

  // ━━━ 4. autoAssignAgent Jaccard 匹配 / Jaccard matching ━━━
  describe('autoAssignAgent', () => {
    it('应将 Agent 自动分配到 Jaccard 最高的 Zone / should auto-assign to zone with highest Jaccard', () => {
      // 创建 Agent 并添加技能 / Create agent and add skills
      const agentId = agentRepo.createAgent({ name: 'SkillAgent' });
      agentRepo.createSkill(agentId, 'react');
      agentRepo.createSkill(agentId, 'typescript');
      agentRepo.createSkill(agentId, 'css');

      // 创建多个 Zone / Create multiple zones
      const feZoneId = manager.createZone({
        name: 'frontend',
        techStack: ['react', 'typescript', 'css', 'html'],
      });
      manager.createZone({
        name: 'backend',
        techStack: ['python', 'django', 'postgresql'],
      });

      const result = manager.autoAssignAgent(agentId);

      expect(result).not.toBeNull();
      expect(result.zoneId).toBe(feZoneId);
      // Jaccard = |{react, typescript, css}| / |{react, typescript, css, html}| = 3/4 = 0.75
      expect(result.score).toBeGreaterThan(0.3);

      // 验证确实分配了 / Verify assignment happened
      const members = manager.getMembers(feZoneId);
      expect(members.some(m => m.agent_id === agentId)).toBe(true);
    });

    it('无技能 Agent 应返回 null / agent without skills should return null', () => {
      const agentId = agentRepo.createAgent({ name: 'NoSkillAgent' });
      manager.createZone({ name: 'any-zone', techStack: ['java'] });

      const result = manager.autoAssignAgent(agentId);
      expect(result).toBeNull();
    });

    it('无 Zone 时应返回 null / should return null when no zones exist', () => {
      const agentId = agentRepo.createAgent({ name: 'LonelyAgent' });
      agentRepo.createSkill(agentId, 'go');

      const result = manager.autoAssignAgent(agentId);
      expect(result).toBeNull();
    });
  });

  // ━━━ 5. electLeader 选举 / highest qualified agent elected ━━━
  describe('electLeader', () => {
    it('应选出符合条件的最高分 Agent 为 Leader / should elect highest scoring qualified agent', () => {
      const zoneId = manager.createZone({ name: 'team-lead', techStack: ['js'] });

      // 创建符合条件的 Agent / Create qualified agents
      // Leader 要求: success_rate > 90%, reputation > 800
      const agentA = agentRepo.createAgent({ name: 'AgentA' });
      agentRepo.updateAgent(agentA, { success_count: 95, failure_count: 5, total_score: 900, contribution_points: 500 });

      const agentB = agentRepo.createAgent({ name: 'AgentB' });
      agentRepo.updateAgent(agentB, { success_count: 98, failure_count: 2, total_score: 950, contribution_points: 800 });

      // 不符合条件: 低成功率 / Not qualified: low success rate
      const agentC = agentRepo.createAgent({ name: 'AgentC' });
      agentRepo.updateAgent(agentC, { success_count: 5, failure_count: 10, total_score: 100 });

      // 分配到 Zone / Assign to zone
      manager.assignAgent(agentA, zoneId);
      manager.assignAgent(agentB, zoneId);
      manager.assignAgent(agentC, zoneId);

      const result = manager.electLeader(zoneId);

      expect(result).not.toBeNull();
      // Agent B 应当选 (更高的 success_count, total_score, contribution_points)
      // Agent B should be elected (higher scores)
      expect(result.leaderId).toBe(agentB);
      expect(result.score).toBeGreaterThan(0);

      // Zone 应更新 leader / Zone should have updated leader
      const zone = manager.getZone(zoneId);
      expect(zone.leaderId).toBe(agentB);
    });

    it('无符合条件候选人应返回 null / no qualified candidates should return null', () => {
      const zoneId = manager.createZone({ name: 'no-lead', techStack: ['py'] });

      // 只添加不符合条件的 Agent / Only add unqualified agents
      const agentId = agentRepo.createAgent({ name: 'Junior' });
      agentRepo.updateAgent(agentId, { success_count: 3, failure_count: 7, total_score: 100 });
      manager.assignAgent(agentId, zoneId);

      const result = manager.electLeader(zoneId);
      expect(result).toBeNull();
    });

    it('空 Zone 应返回 null / empty zone should return null', () => {
      const zoneId = manager.createZone({ name: 'empty', techStack: ['rust'] });
      const result = manager.electLeader(zoneId);
      expect(result).toBeNull();
    });
  });

  // ━━━ 6. healthCheck 健康检查 / reports issues ━━━
  describe('healthCheck', () => {
    it('健全的 Zone 应无问题 / healthy zone should have no issues', () => {
      const zoneId = manager.createZone({ name: 'healthy', techStack: ['go'] });

      // 添加成员并设置 leader / Add member and set leader
      const agentId = agentRepo.createAgent({ name: 'HealthyAgent' });
      agentRepo.updateAgent(agentId, { success_count: 99, failure_count: 1, total_score: 950, contribution_points: 600 });
      manager.assignAgent(agentId, zoneId);
      manager.electLeader(zoneId);

      const result = manager.healthCheck(zoneId);
      expect(result.healthy).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('无成员应报告 insufficient_members / no members should report insufficient_members', () => {
      const zoneId = manager.createZone({ name: 'empty-zone', techStack: ['java'] });

      const result = manager.healthCheck(zoneId);
      expect(result.healthy).toBe(false);
      expect(result.issues.some(i => i.includes('insufficient_members'))).toBe(true);
    });

    it('无 leader 应报告 no_leader / no leader should report no_leader', () => {
      const zoneId = manager.createZone({ name: 'leaderless', techStack: ['ts'] });
      const agentId = agentRepo.createAgent({ name: 'Member' });
      manager.assignAgent(agentId, zoneId);

      const result = manager.healthCheck(zoneId);
      expect(result.healthy).toBe(false);
      expect(result.issues.some(i => i.includes('no_leader'))).toBe(true);
    });

    it('空技术栈应报告 empty_tech_stack / empty tech stack should report issue', () => {
      const zoneId = manager.createZone({ name: 'no-stack', techStack: [] });
      const agentId = agentRepo.createAgent({ name: 'Agent' });
      manager.assignAgent(agentId, zoneId);

      const result = manager.healthCheck(zoneId);
      expect(result.issues.some(i => i.includes('empty_tech_stack'))).toBe(true);
    });

    it('不存在的 Zone 应报告 zone_not_found / non-existent zone should report zone_not_found', () => {
      const result = manager.healthCheck('ghost-zone');
      expect(result.healthy).toBe(false);
      expect(result.issues).toContain('zone_not_found');
    });
  });

  // ━━━ 7. computeJaccard 集合相似度 / set similarity ━━━
  describe('computeJaccard', () => {
    it('完全相同集合应返回 1.0 / identical sets should return 1.0', () => {
      const setA = new Set(['a', 'b', 'c']);
      const setB = new Set(['a', 'b', 'c']);
      expect(manager.computeJaccard(setA, setB)).toBeCloseTo(1.0, 4);
    });

    it('完全不同集合应返回 0.0 / disjoint sets should return 0.0', () => {
      const setA = new Set(['a', 'b']);
      const setB = new Set(['c', 'd']);
      expect(manager.computeJaccard(setA, setB)).toBeCloseTo(0, 4);
    });

    it('部分重叠应返回正确比率 / partial overlap should return correct ratio', () => {
      // J({a,b,c}, {b,c,d}) = |{b,c}| / |{a,b,c,d}| = 2/4 = 0.5
      const setA = new Set(['a', 'b', 'c']);
      const setB = new Set(['b', 'c', 'd']);
      expect(manager.computeJaccard(setA, setB)).toBeCloseTo(0.5, 4);
    });

    it('两个空集应返回 0 / two empty sets should return 0', () => {
      expect(manager.computeJaccard(new Set(), new Set())).toBe(0);
    });

    it('一空一非空应返回 0 / one empty one non-empty should return 0', () => {
      expect(manager.computeJaccard(new Set(), new Set(['a']))).toBe(0);
      expect(manager.computeJaccard(new Set(['a']), new Set())).toBe(0);
    });

    it('不对称大小集合应正确计算 / asymmetric sized sets should compute correctly', () => {
      // J({a}, {a,b,c,d,e}) = 1/5 = 0.2
      const setA = new Set(['a']);
      const setB = new Set(['a', 'b', 'c', 'd', 'e']);
      expect(manager.computeJaccard(setA, setB)).toBeCloseTo(0.2, 4);
    });
  });

  // ━━━ 附加: getZoneScope 静态方法 / Additional: getZoneScope static method ━━━
  describe('getZoneScope', () => {
    it('应返回正确的 scope 格式 / should return correct scope format', () => {
      expect(ZoneManager.getZoneScope('zone-123')).toBe('/zone/zone-123');
    });
  });
});
