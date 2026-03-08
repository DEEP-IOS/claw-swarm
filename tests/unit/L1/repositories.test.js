/**
 * Repository 单元测试 / Repository Unit Tests
 *
 * 测试全部 8 个 Repository 的 CRUD 操作。
 * Tests CRUD operations for all 8 Repositories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../../src/L1-infrastructure/database/database-manager.js';
import { TABLE_SCHEMAS } from '../../../src/L1-infrastructure/schemas/database-schemas.js';
import { PheromoneRepository } from '../../../src/L1-infrastructure/database/repositories/pheromone-repo.js';
import { TaskRepository } from '../../../src/L1-infrastructure/database/repositories/task-repo.js';
import { AgentRepository } from '../../../src/L1-infrastructure/database/repositories/agent-repo.js';
import { KnowledgeRepository } from '../../../src/L1-infrastructure/database/repositories/knowledge-repo.js';
import { EpisodicRepository } from '../../../src/L1-infrastructure/database/repositories/episodic-repo.js';
import { ZoneRepository } from '../../../src/L1-infrastructure/database/repositories/zone-repo.js';
import { PlanRepository } from '../../../src/L1-infrastructure/database/repositories/plan-repo.js';
import { PheromoneTypeRepository } from '../../../src/L1-infrastructure/database/repositories/pheromone-type-repo.js';

let dbManager;

function setupDb() {
  dbManager = new DatabaseManager({ memory: true });
  dbManager.open(TABLE_SCHEMAS);
}

function teardownDb() {
  dbManager.close();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PheromoneRepository
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('PheromoneRepository', () => {
  let repo;

  beforeEach(() => { setupDb(); repo = new PheromoneRepository(dbManager); });
  afterEach(teardownDb);

  it('should insert and query pheromones', () => {
    repo.insert({ id: 'p1', type: 'trail', sourceId: 'a1', targetScope: '/task/1', intensity: 0.8 });
    const results = repo.query('/task/1');
    expect(results.length).toBe(1);
    expect(results[0].type).toBe('trail');
    expect(results[0].intensity).toBe(0.8);
  });

  it('should upsert (reinforce) pheromones', () => {
    repo.upsert({ type: 'trail', sourceId: 'a1', targetScope: '/t/1', intensity: 0.5 });
    repo.upsert({ type: 'trail', sourceId: 'a1', targetScope: '/t/1', intensity: 0.3 });
    const results = repo.query('/t/1');
    expect(results[0].intensity).toBeCloseTo(0.8);
  });

  it('should filter by type', () => {
    repo.insert({ id: 'p1', type: 'trail', sourceId: 'a1', targetScope: '/t/1' });
    repo.insert({ id: 'p2', type: 'alarm', sourceId: 'a1', targetScope: '/t/1' });
    const trails = repo.query('/t/1', { type: 'trail' });
    expect(trails.length).toBe(1);
    expect(trails[0].type).toBe('trail');
  });

  it('should update intensity', () => {
    repo.insert({ id: 'p1', type: 'trail', sourceId: 'a1', targetScope: '/t/1', intensity: 1.0 });
    repo.updateIntensity('p1', 0.5);
    const results = repo.query('/t/1');
    expect(results[0].intensity).toBe(0.5);
  });

  it('should delete expired pheromones', () => {
    const past = Date.now() - 1000;
    repo.insert({ id: 'p1', type: 'trail', sourceId: 'a1', targetScope: '/t/1', expiresAt: past });
    const deleted = repo.deleteExpired();
    expect(deleted).toBe(1);
    expect(repo.count()).toBe(0);
  });

  it('should batch update intensities', () => {
    repo.insert({ id: 'p1', type: 'trail', sourceId: 'a1', targetScope: '/t/1', intensity: 1.0 });
    repo.insert({ id: 'p2', type: 'alarm', sourceId: 'a1', targetScope: '/t/1', intensity: 0.8 });
    repo.batchUpdateIntensity([{ id: 'p1', intensity: 0.5 }, { id: 'p2', intensity: 0.3 }]);
    const all = repo.getAll();
    expect(all.find(p => p.id === 'p1').intensity).toBe(0.5);
    expect(all.find(p => p.id === 'p2').intensity).toBe(0.3);
  });

  it('should trim to limit', () => {
    for (let i = 0; i < 5; i++) {
      repo.insert({ id: `p${i}`, type: 'trail', sourceId: 'a1', targetScope: '/t/1', intensity: i * 0.1 });
    }
    const deleted = repo.trimToLimit(3);
    expect(deleted).toBe(2);
    expect(repo.count()).toBe(3);
  });

  it('should trim by decayed intensity — preferring stale high-intensity over fresh low-intensity', () => {
    const now = Date.now();
    // Stale pheromone: high original intensity (1.0) but created 100 min ago with fast decay
    // Decayed value ≈ 1.0 * exp(-0.15 * 100) ≈ 0.0000003 (effectively dead)
    repo.insert({ id: 'stale', type: 'alarm', sourceId: 'a1', targetScope: '/t/1', intensity: 1.0, decayRate: 0.15, updatedAt: now - 100 * 60000 });
    // Fresh pheromone: lower original intensity (0.3) but just created
    // Decayed value ≈ 0.3 (still alive)
    repo.insert({ id: 'fresh', type: 'trail', sourceId: 'a1', targetScope: '/t/1', intensity: 0.3, decayRate: 0.05, updatedAt: now });

    const deleted = repo.trimToLimit(1);
    expect(deleted).toBe(1);
    // The stale pheromone should be deleted (lower decayed value), keeping the fresh one
    const remaining = repo.getAll();
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe('fresh');
  });

  it('should parse payload JSON', () => {
    repo.insert({ id: 'p1', type: 'trail', sourceId: 'a1', targetScope: '/t/1', payload: { key: 'val' } });
    const results = repo.query('/t/1');
    expect(results[0].payload).toEqual({ key: 'val' });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TaskRepository
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('TaskRepository', () => {
  let repo;

  beforeEach(() => { setupDb(); repo = new TaskRepository(dbManager); });
  afterEach(teardownDb);

  it('should create and get tasks', () => {
    repo.createTask('t1', { objective: 'test' }, 'simulated');
    const task = repo.getTask('t1');
    expect(task.config.objective).toBe('test');
    expect(task.status).toBe('pending');
  });

  it('should update task status', () => {
    repo.createTask('t1', { objective: 'test' });
    repo.updateTaskStatus('t1', 'running');
    expect(repo.getTask('t1').status).toBe('running');
  });

  it('should list tasks with filter', () => {
    repo.createTask('t1', { o: '1' });
    repo.createTask('t2', { o: '2' });
    repo.updateTaskStatus('t1', 'completed');
    const pending = repo.listTasks('pending');
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe('t2');
  });

  it('should create and get roles', () => {
    repo.createTask('t1', {});
    repo.createRole('r1', 't1', 'architect', 'Design system', '["design"]', 10);
    const roles = repo.getRolesByTask('t1');
    expect(roles.length).toBe(1);
    expect(roles[0].name).toBe('architect');
    expect(roles[0].capabilities).toEqual(['design']);
  });

  it('should manage locks', () => {
    expect(repo.acquireLock('res1', 'owner1', 60000)).toBe(true);
    expect(repo.isLocked('res1')).toBe(true);
    expect(repo.acquireLock('res1', 'owner2', 60000)).toBe(false);
    expect(repo.releaseLock('res1', 'owner1')).toBe(true);
    expect(repo.isLocked('res1')).toBe(false);
  });

  it('should record and query role execution stats', () => {
    repo.insertRoleExecutionStat({ roleName: 'architect', durationMs: 5000, success: true, qualityScore: 0.9 });
    repo.insertRoleExecutionStat({ roleName: 'architect', durationMs: 7000, success: true, qualityScore: 0.8 });
    const stats = repo.getRoleDurationStats('architect');
    expect(stats.count).toBe(2);
    expect(stats.avg).toBe(6000);
    expect(stats.min).toBe(5000);
    expect(stats.max).toBe(7000);
  });

  it('should record state transitions', () => {
    repo.insertStateTransition({ taskId: 't1', fromState: 'pending', toState: 'running', reason: 'start' });
    repo.insertStateTransition({ taskId: 't1', fromState: 'running', toState: 'completed' });
    const transitions = repo.getStateTransitions('t1');
    expect(transitions.length).toBe(2);
    expect(transitions[0].from_state).toBe('pending');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AgentRepository
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('AgentRepository', () => {
  let repo;

  beforeEach(() => { setupDb(); repo = new AgentRepository(dbManager); });
  afterEach(teardownDb);

  it('should create and get agents', () => {
    const id = repo.createAgent({ name: 'Alice', role: 'developer' });
    const agent = repo.getAgent(id);
    expect(agent.name).toBe('Alice');
    expect(agent.tier).toBe('trainee');
    expect(agent.total_score).toBe(50);
  });

  it('should update agent fields', () => {
    const id = repo.createAgent({ name: 'Bob' });
    repo.updateAgent(id, { tier: 'senior', total_score: 90 });
    const agent = repo.getAgent(id);
    expect(agent.tier).toBe('senior');
    expect(agent.total_score).toBe(90);
  });

  it('should list agents sorted by score', () => {
    repo.createAgent({ id: 'a1', name: 'Low' });
    repo.createAgent({ id: 'a2', name: 'High' });
    repo.updateAgent('a2', { total_score: 95 });
    const list = repo.listAgents();
    expect(list[0].name).toBe('High');
  });

  it('should manage capabilities', () => {
    repo.createAgent({ id: 'a1', name: 'A' });
    repo.createCapability('a1', 'coding', 80);
    repo.createCapability('a1', 'testing', 60);
    const caps = repo.getCapabilities('a1');
    expect(caps.length).toBe(2);
  });

  it('should clamp capability scores', () => {
    repo.createAgent({ id: 'a1', name: 'A' });
    repo.createCapability('a1', 'coding', 50);
    repo.updateCapabilityScore('a1', 'coding', 150); // should clamp to 100
    const caps = repo.getCapabilities('a1');
    expect(caps[0].score).toBe(100);
  });

  it('should manage skills', () => {
    repo.createAgent({ id: 'a1', name: 'A' });
    repo.createSkill('a1', 'typescript', 'expert');
    expect(repo.getAgentSkillLevel('a1', 'typescript')).toBe('expert');
  });

  it('should manage contributions', () => {
    repo.createAgent({ id: 'a1', name: 'A' });
    repo.createContribution({ agentId: 'a1', points: 10 });
    repo.createContribution({ agentId: 'a1', points: 20 });
    expect(repo.getTotalPoints('a1')).toBe(30);
  });

  it('should record collaboration and compute scores', () => {
    repo.createAgent({ id: 'a1', name: 'A' });
    repo.createAgent({ id: 'a2', name: 'B' });
    repo.recordCollaboration('a2', 'a1', 't1', 0.8);
    repo.recordCollaboration('a1', 'a2', 't2', 0.6);
    const score = repo.getCollaborationScore('a1', 'a2');
    expect(score).toBeCloseTo(0.7);
  });

  it('should log events', () => {
    repo.logEvent('task_completed', 'a1', { taskId: 't1' });
    const logs = repo.getRecentEventLogs(10);
    expect(logs.length).toBe(1);
    expect(logs[0].event_type).toBe('task_completed');
  });

  it('should manage evaluation queue', () => {
    repo.createAgent({ id: 'a1', name: 'A' });
    repo.enqueueEvaluation('a1', { speed: 0.8 });
    expect(repo.getPendingEvaluationCount()).toBe(1);
    const evals = repo.dequeueEvaluations();
    expect(evals[0].updates.speed).toBe(0.8);
    repo.markEvaluationProcessed(evals[0].id);
    expect(repo.getPendingEvaluationCount()).toBe(0);
  });

  it('should manage persona outcomes', () => {
    repo.recordPersonaOutcome({ personaId: 'p1', taskType: 'coding', success: true, qualityScore: 0.9 });
    repo.recordPersonaOutcome({ personaId: 'p1', taskType: 'coding', success: true, qualityScore: 0.8 });
    repo.recordPersonaOutcome({ personaId: 'p1', taskType: 'coding', success: false, qualityScore: 0.3 });
    const stats = repo.getPersonaStats('p1', 'coding');
    expect(stats.count).toBe(3);
    expect(stats.successRate).toBeCloseTo(2/3);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// KnowledgeRepository
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('KnowledgeRepository', () => {
  let repo;

  beforeEach(() => { setupDb(); repo = new KnowledgeRepository(dbManager); });
  afterEach(teardownDb);

  it('should create and get nodes', () => {
    const id = repo.createNode({ nodeType: 'concept', label: 'TypeScript' });
    const node = repo.getNode(id);
    expect(node.label).toBe('TypeScript');
    expect(node.nodeType).toBe('concept');
    expect(node.importance).toBe(0.5);
  });

  it('should search nodes by label', () => {
    repo.createNode({ nodeType: 'concept', label: 'TypeScript' });
    repo.createNode({ nodeType: 'concept', label: 'JavaScript' });
    repo.createNode({ nodeType: 'tool', label: 'React' });
    const results = repo.searchNodes('Script');
    expect(results.length).toBe(2);
  });

  it('should create edges and traverse', () => {
    const n1 = repo.createNode({ nodeType: 'concept', label: 'Node.js' });
    const n2 = repo.createNode({ nodeType: 'concept', label: 'Express' });
    repo.createEdge({ sourceId: n1, targetId: n2, edgeType: 'uses' });

    const outEdges = repo.getOutEdges(n1);
    expect(outEdges.length).toBe(1);
    expect(outEdges[0].targetId).toBe(n2);
  });

  it('should BFS traverse with hops', () => {
    const n1 = repo.createNode({ nodeType: 'concept', label: 'A' });
    const n2 = repo.createNode({ nodeType: 'concept', label: 'B' });
    const n3 = repo.createNode({ nodeType: 'concept', label: 'C' });
    repo.createEdge({ sourceId: n1, targetId: n2, edgeType: 'related_to' });
    repo.createEdge({ sourceId: n2, targetId: n3, edgeType: 'related_to' });

    const results = repo.bfsTraverse(n1, 2);
    expect(results.length).toBe(3); // A, B, C
    expect(results[0].depth).toBe(0);
    expect(results[2].depth).toBe(2);
  });

  it('should find shortest path', () => {
    const a = repo.createNode({ nodeType: 'concept', label: 'A' });
    const b = repo.createNode({ nodeType: 'concept', label: 'B' });
    const c = repo.createNode({ nodeType: 'concept', label: 'C' });
    repo.createEdge({ sourceId: a, targetId: b, edgeType: 'uses' });
    repo.createEdge({ sourceId: b, targetId: c, edgeType: 'uses' });
    repo.createEdge({ sourceId: a, targetId: c, edgeType: 'uses' }); // shortcut

    const path = repo.shortestPath(a, c);
    expect(path.length).toBe(2); // A → C direct
  });

  it('should merge nodes', () => {
    const a = repo.createNode({ nodeType: 'concept', label: 'JS' });
    const b = repo.createNode({ nodeType: 'concept', label: 'JavaScript' });
    const c = repo.createNode({ nodeType: 'tool', label: 'Node' });
    repo.createEdge({ sourceId: b, targetId: c, edgeType: 'uses' });

    repo.mergeNodes(a, b); // merge B into A
    expect(repo.getNode(b)).toBeNull(); // B deleted
    const outEdges = repo.getOutEdges(a);
    expect(outEdges.length).toBe(1);
    expect(outEdges[0].targetId).toBe(c);
  });

  it('should delete node and its edges', () => {
    const a = repo.createNode({ nodeType: 'concept', label: 'A' });
    const b = repo.createNode({ nodeType: 'concept', label: 'B' });
    repo.createEdge({ sourceId: a, targetId: b, edgeType: 'uses' });

    repo.deleteNode(a);
    expect(repo.getNode(a)).toBeNull();
    expect(repo.countEdges()).toBe(0);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EpisodicRepository
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('EpisodicRepository', () => {
  let repo;

  beforeEach(() => { setupDb(); repo = new EpisodicRepository(dbManager); });
  afterEach(teardownDb);

  it('should record and recall events', () => {
    repo.record({ agentId: 'a1', eventType: 'action', subject: 'agent', predicate: 'created', object: 'file.js' });
    const events = repo.recall('a1');
    expect(events.length).toBe(1);
    expect(events[0].subject).toBe('agent');
    expect(events[0].predicate).toBe('created');
  });

  it('should filter by event type', () => {
    repo.record({ agentId: 'a1', eventType: 'action', subject: 's', predicate: 'p' });
    repo.record({ agentId: 'a1', eventType: 'error', subject: 's', predicate: 'p' });
    const errors = repo.recall('a1', { eventType: 'error' });
    expect(errors.length).toBe(1);
  });

  it('should search by keyword', () => {
    repo.record({ agentId: 'a1', eventType: 'action', subject: 'typescript', predicate: 'compiled' });
    repo.record({ agentId: 'a1', eventType: 'action', subject: 'python', predicate: 'executed' });
    const ts = repo.recall('a1', { keyword: 'typescript' });
    expect(ts.length).toBe(1);
  });

  it('should prune old low-importance events', () => {
    // Insert old event with low importance
    const oldTimestamp = Date.now() - 90 * 86400000; // 90 days ago
    dbManager.run(
      'INSERT INTO episodic_events (id, agent_id, event_type, subject, predicate, importance, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
      'old1', 'a1', 'action', 's', 'p', 0.1, oldTimestamp,
    );
    // Insert recent event
    repo.record({ agentId: 'a1', eventType: 'action', subject: 's', predicate: 'p', importance: 0.9 });

    const pruned = repo.prune(30, 0.1);
    expect(pruned).toBe(1);
    expect(repo.count('a1')).toBe(1);
  });

  it('should get events by session', () => {
    repo.record({ agentId: 'a1', eventType: 'action', subject: 's', predicate: 'p', sessionId: 'sess1' });
    repo.record({ agentId: 'a1', eventType: 'action', subject: 's', predicate: 'p', sessionId: 'sess2' });
    const events = repo.getBySession('sess1');
    expect(events.length).toBe(1);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ZoneRepository
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('ZoneRepository', () => {
  let repo;

  beforeEach(() => { setupDb(); repo = new ZoneRepository(dbManager); });
  afterEach(teardownDb);

  it('should create and get zones', () => {
    const id = repo.createZone({ name: 'frontend', techStack: ['react', 'typescript'] });
    const zone = repo.getZone(id);
    expect(zone.name).toBe('frontend');
    expect(zone.techStack).toEqual(['react', 'typescript']);
  });

  it('should find zone by name', () => {
    repo.createZone({ name: 'backend' });
    const zone = repo.getZoneByName('backend');
    expect(zone).not.toBeNull();
    expect(zone.name).toBe('backend');
  });

  it('should manage members', () => {
    // 先创建 agent (FK 约束) / Create agents first (FK constraint)
    const agentRepo = new AgentRepository(dbManager);
    agentRepo.createAgent({ id: 'a1', name: 'Agent1' });
    agentRepo.createAgent({ id: 'a2', name: 'Agent2' });

    const zoneId = repo.createZone({ name: 'test' });
    repo.addMember(zoneId, 'a1', 'leader');
    repo.addMember(zoneId, 'a2');

    const members = repo.getMembers(zoneId);
    expect(members.length).toBe(2);
    expect(repo.getMemberCount(zoneId)).toBe(2);
  });

  it('should get agent zones', () => {
    const agentRepo = new AgentRepository(dbManager);
    agentRepo.createAgent({ id: 'a1', name: 'Agent1' });

    const z1 = repo.createZone({ name: 'z1' });
    const z2 = repo.createZone({ name: 'z2' });
    repo.addMember(z1, 'a1');
    repo.addMember(z2, 'a1');
    const zones = repo.getAgentZones('a1');
    expect(zones.length).toBe(2);
  });

  it('should delete zone and memberships', () => {
    const agentRepo = new AgentRepository(dbManager);
    agentRepo.createAgent({ id: 'a1', name: 'Agent1' });

    const id = repo.createZone({ name: 'temp' });
    repo.addMember(id, 'a1');
    repo.deleteZone(id);
    expect(repo.getZone(id)).toBeNull();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PlanRepository
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('PlanRepository', () => {
  let repo;

  beforeEach(() => { setupDb(); repo = new PlanRepository(dbManager); });
  afterEach(teardownDb);

  it('should create and get plans', () => {
    const id = repo.create({ planData: { roles: ['dev', 'test'] }, createdBy: 'orchestrator' });
    const plan = repo.get(id);
    expect(plan.planData.roles).toEqual(['dev', 'test']);
    expect(plan.status).toBe('draft');
  });

  it('should update plan status', () => {
    const id = repo.create({ planData: {} });
    repo.updateStatus(id, 'validated');
    expect(repo.get(id).status).toBe('validated');
  });

  it('should list plans with filter', () => {
    repo.create({ planData: {} });
    repo.create({ planData: {} });
    const id3 = repo.create({ planData: {} });
    repo.updateStatus(id3, 'completed');
    const drafts = repo.list('draft');
    expect(drafts.length).toBe(2);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PheromoneTypeRepository
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('PheromoneTypeRepository', () => {
  let repo;

  beforeEach(() => { setupDb(); repo = new PheromoneTypeRepository(dbManager); });
  afterEach(teardownDb);

  it('should register and get types', () => {
    repo.register({ name: 'custom_trail', decayRate: 0.03, mmasMin: 0.1, mmasMax: 2.0 });
    const type = repo.getByName('custom_trail');
    expect(type.decayRate).toBe(0.03);
    expect(type.mmasMin).toBe(0.1);
    expect(type.mmasMax).toBe(2.0);
  });

  it('should check existence', () => {
    expect(repo.exists('x')).toBe(false);
    repo.register({ name: 'x' });
    expect(repo.exists('x')).toBe(true);
  });

  it('should list all types', () => {
    repo.register({ name: 'a_type' });
    repo.register({ name: 'b_type' });
    const list = repo.list();
    expect(list.length).toBe(2);
    expect(list[0].name).toBe('a_type'); // sorted by name
  });
});
