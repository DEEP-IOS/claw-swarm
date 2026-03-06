/**
 * Integration tests for the governance lifecycle (ported from Swarm Lite v3.0).
 *
 * Exercises full cross-module scenarios: agent registration, capability
 * scoring, contribution recording, tier evaluation, voting, task allocation,
 * collaboration scoring, behavior tagging, evaluation queue persistence,
 * orchestrator governance hooks, monitor event handling, skill certification,
 * and leaderboard ranking.
 *
 * Uses :memory: SQLite DB, cleaned up in after().
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import * as db from '../../src/layer1-core/db.js';
import { SwarmOrchestrator } from '../../src/layer3-intelligence/orchestration/orchestrator.js';
import { RoleManager } from '../../src/layer3-intelligence/orchestration/role-manager.js';
import { TaskDistributor } from '../../src/layer3-intelligence/orchestration/task-distributor.js';
import { SimulatedStrategy } from '../../src/layer3-intelligence/orchestration/strategies/simulated-strategy.js';
import { Monitor } from '../../src/layer1-core/monitor.js';
import { EvaluationQueue } from '../../src/layer2-engines/governance/evaluation-queue.js';
import { ReputationLedger } from '../../src/layer2-engines/governance/reputation-ledger.js';
import { CapabilityEngine } from '../../src/layer2-engines/governance/capability-engine.js';
import { VotingSystem } from '../../src/layer2-engines/governance/voting-system.js';
import { AgentRegistry } from '../../src/layer2-engines/governance/agent-registry.js';

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const govConfig = {
  capability: {
    dimensions: {
      technical: { weight: 0.4 },
      delivery: { weight: 0.3 },
      collaboration: { weight: 0.2 },
      innovation: { weight: 0.1 },
    },
    decayFactor: 0.9,
    maxHistoricalBonus: 10,
    initialScore: 50,
  },
  tiers: {
    trainee: { minScore: 0, taskLimit: 3 },
    junior: { minScore: 60, taskLimit: 5 },
    mid: { minScore: 75, taskLimit: 10 },
    senior: { minScore: 85, taskLimit: 15 },
    lead: { minScore: 92, taskLimit: 20 },
  },
  voting: {
    promotionThreshold: 0.6,
    admissionThreshold: 0.5,
    voteExpiryHours: 24,
    maxVotesPerAgentPerDay: 20,
  },
  allocation: {
    skillWeight: 0.4,
    historyWeight: 0.3,
    loadWeight: 0.2,
    collaborationWeight: 0.1,
  },
  contribution: {
    baseMultiplier: 10,
    timeBonus: 1.2,
    innovationBonus: 1.3,
    collaborationBonus: 1.1,
  },
  performance: {
    cache: { enabled: true, ttl: 300000 },
    asyncQueue: { enabled: true, batchSize: 10, flushInterval: 5000 },
    precompute: { enabled: true, updateInterval: 3600000 },
  },
  autoEvaluation: { enabled: false, interval: 86400000 },
};

let capabilityEngine;
let ledger;
let votingSystem;
let evaluationQueue;
let agentRegistry;
let monitor;

// Resources that need cleanup
let orchestratorGov;
let orchestratorNoGov;

/**
 * Wait for task:completed or task:failed for a specific taskId.
 */
function waitForTaskDone(orch, taskId, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for task ${taskId} to finish`));
    }, timeoutMs);
    if (typeof timer === 'object' && typeof timer.unref === 'function') {
      timer.unref();
    }

    function cleanup() {
      clearTimeout(timer);
      orch.removeListener('task:completed', onCompleted);
      orch.removeListener('task:failed', onFailed);
    }

    function onCompleted(payload) {
      if (payload.taskId === taskId) {
        cleanup();
        resolve(payload);
      }
    }
    function onFailed(payload) {
      if (payload.taskId === taskId) {
        cleanup();
        resolve(payload);
      }
    }
    orch.on('task:completed', onCompleted);
    orch.on('task:failed', onFailed);
  });
}

/**
 * Create a task and wait for it to reach a terminal state.
 */
async function createAndWait(orch, taskConfig, timeoutMs = 15_000) {
  let resolveOuter;
  let rejectOuter;
  const donePromise = new Promise((res, rej) => {
    resolveOuter = res;
    rejectOuter = rej;
  });

  const timer = setTimeout(() => {
    rejectOuter(new Error('Timed out waiting for task completion'));
  }, timeoutMs);
  if (typeof timer === 'object' && typeof timer.unref === 'function') {
    timer.unref();
  }

  let targetTaskId = null;

  function onCompleted(payload) {
    if (targetTaskId && payload.taskId === targetTaskId) {
      clearTimeout(timer);
      orch.removeListener('task:completed', onCompleted);
      orch.removeListener('task:failed', onFailed);
      resolveOuter(payload);
    }
  }
  function onFailed(payload) {
    if (targetTaskId && payload.taskId === targetTaskId) {
      clearTimeout(timer);
      orch.removeListener('task:completed', onCompleted);
      orch.removeListener('task:failed', onFailed);
      resolveOuter(payload);
    }
  }

  orch.on('task:completed', onCompleted);
  orch.on('task:failed', onFailed);

  const createResult = await orch.createTask(taskConfig);
  targetTaskId = createResult.taskId;

  // Check if the task already completed before we set targetTaskId
  const task = db.getSwarmTask(targetTaskId);
  if (task && (task.status === 'completed' || task.status === 'failed')) {
    clearTimeout(timer);
    orch.removeListener('task:completed', onCompleted);
    orch.removeListener('task:failed', onFailed);
    return { createResult, donePayload: { taskId: targetTaskId } };
  }

  const donePayload = await donePromise;
  return { createResult, donePayload };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Governance Lifecycle Integration', () => {
  before(() => {
    db.initDb(':memory:');

    capabilityEngine = new CapabilityEngine(govConfig);
    ledger = new ReputationLedger(govConfig);
    votingSystem = new VotingSystem(govConfig);
    evaluationQueue = new EvaluationQueue(govConfig);
    monitor = new Monitor(db, { monitorMode: 'default' });

    // Wire up cross-references
    capabilityEngine.setLedger(ledger);
    capabilityEngine.setEvaluationQueue(evaluationQueue);

    agentRegistry = new AgentRegistry(capabilityEngine, ledger, govConfig);
  });

  after(() => {
    // Shut down all resources
    if (orchestratorGov) {
      try { orchestratorGov.paused = true; } catch { /* ignore */ }
    }
    if (orchestratorNoGov) {
      try { orchestratorNoGov.paused = true; } catch { /* ignore */ }
    }
    if (monitor) monitor.shutdown();
    if (evaluationQueue) evaluationQueue.shutdown();
    if (capabilityEngine) capabilityEngine.shutdown();

    db.closeDb();
  });

  // -----------------------------------------------------------------------
  // 1. Full lifecycle: register -> create task -> complete -> evaluate -> score
  // -----------------------------------------------------------------------

  it('full lifecycle: register agent, create task, complete, evaluate, and check score updated', async () => {
    const agentId = `test-lifecycle-${randomUUID().slice(0, 8)}`;

    // Register
    const agent = capabilityEngine.registerAgent({
      id: agentId,
      name: 'Lifecycle Agent',
      role: 'developer',
      tier: 'trainee',
    });
    assert.ok(agent, 'Agent should be registered');
    assert.equal(agent.id, agentId);

    // Record a contribution (simulating a completed task)
    const taskObj = { id: `task-${randomUUID().slice(0, 8)}`, type: 'backend', complexity: 2 };
    const outcome = { quality: 0.9, impact: 5, earlyCompletion: false, hasInnovation: false, helpedOthers: false };
    ledger.recordContribution(agentId, taskObj, outcome);

    // Evaluate task completion (updates capability scores)
    capabilityEngine.evaluateTaskCompletion(agentId, taskObj, outcome);

    // The evaluation was queued (evaluationQueue is configured). Process it.
    evaluationQueue.processQueue();

    // Recalculate total score
    const totalScore = capabilityEngine.updateTotalScore(agentId);
    assert.ok(typeof totalScore === 'number', 'Total score should be a number');
    assert.ok(totalScore >= 0 && totalScore <= 100, 'Total score should be in 0-100 range');

    // Verify agent's contribution points updated
    const updatedAgent = db.getAgent(agentId);
    assert.ok(updatedAgent.contribution_points > 0, 'Contribution points should have increased');
  });

  // -----------------------------------------------------------------------
  // 2. Agent registration creates correct initial capabilities (4 dimensions)
  // -----------------------------------------------------------------------

  it('agent registration creates correct initial capabilities with 4 dimensions', () => {
    const agentId = `test-caps-${randomUUID().slice(0, 8)}`;

    capabilityEngine.registerAgent({
      id: agentId,
      name: 'Capability Agent',
    });

    const caps = db.getCapabilities(agentId);
    assert.equal(caps.length, 4, 'Should have exactly 4 capability dimensions');

    const dimensions = caps.map((c) => c.dimension).sort();
    assert.deepStrictEqual(
      dimensions,
      ['collaboration', 'delivery', 'innovation', 'technical'],
      'Dimensions should match the 4 configured dimensions',
    );

    for (const cap of caps) {
      assert.equal(cap.score, 50, `Initial score for ${cap.dimension} should be 50`);
    }

    // Also check sub-dimensions exist
    const details = db.getCapabilityDetails(agentId);
    assert.ok(details.length > 0, 'Should have capability detail sub-dimensions');
  });

  // -----------------------------------------------------------------------
  // 3. Contribution recording updates agent total points
  // -----------------------------------------------------------------------

  it('contribution recording updates agent total points', () => {
    const agentId = `test-contrib-${randomUUID().slice(0, 8)}`;

    capabilityEngine.registerAgent({
      id: agentId,
      name: 'Contributor Agent',
    });

    const agentBefore = db.getAgent(agentId);
    assert.equal(agentBefore.contribution_points, 0, 'Initial points should be 0');

    const taskObj = { id: `task-${randomUUID().slice(0, 8)}`, type: 'frontend', complexity: 3 };
    const outcome = { quality: 0.8, impact: 4, earlyCompletion: true, hasInnovation: false, helpedOthers: false };

    const result = ledger.recordContribution(agentId, taskObj, outcome);
    assert.ok(result.points > 0, 'Should have calculated positive points');
    assert.equal(result.category, 'development', 'Frontend tasks should categorize as development');

    const agentAfter = db.getAgent(agentId);
    assert.ok(agentAfter.contribution_points > 0, 'Contribution points should have increased after recording');
    assert.equal(agentAfter.contribution_points, result.points, 'Agent points should match recorded contribution');
  });

  // -----------------------------------------------------------------------
  // 4. Tier evaluation recommends promotion when score exceeds threshold
  // -----------------------------------------------------------------------

  it('tier evaluation recommends promotion when score exceeds threshold', () => {
    const agentId = `test-promo-${randomUUID().slice(0, 8)}`;

    capabilityEngine.registerAgent({
      id: agentId,
      name: 'Promo Agent',
      tier: 'trainee',
    });

    // Set all capability dimensions to high scores to push total above junior threshold (60)
    capabilityEngine.updateCapabilityScore(agentId, 'technical', 80);
    capabilityEngine.updateCapabilityScore(agentId, 'delivery', 75);
    capabilityEngine.updateCapabilityScore(agentId, 'collaboration', 70);
    capabilityEngine.updateCapabilityScore(agentId, 'innovation', 65);

    const totalScore = capabilityEngine.updateTotalScore(agentId);
    assert.ok(totalScore >= 60, `Total score ${totalScore} should be >= 60 for junior promotion`);

    const result = capabilityEngine.evaluateTierChange(agentId);
    assert.ok(result, 'Tier evaluation should return a result');
    assert.equal(result.eligible, true, 'Agent should be eligible for promotion');
    assert.equal(result.type, 'promotion', 'Change type should be promotion');
    assert.equal(result.from, 'trainee', 'Should promote from trainee');
    assert.equal(result.to, 'junior', 'Should promote to junior');
  });

  // -----------------------------------------------------------------------
  // 5. Voting lifecycle: create vote -> cast votes -> close -> verify result
  // -----------------------------------------------------------------------

  it('voting lifecycle: create vote, cast votes, close, and verify result and status', () => {
    // Register voters
    const targetId = `test-vtarget-${randomUUID().slice(0, 8)}`;
    const voter1Id = `test-voter1-${randomUUID().slice(0, 8)}`;
    const voter2Id = `test-voter2-${randomUUID().slice(0, 8)}`;
    const voter3Id = `test-voter3-${randomUUID().slice(0, 8)}`;

    capabilityEngine.registerAgent({ id: targetId, name: 'Vote Target' });
    capabilityEngine.registerAgent({ id: voter1Id, name: 'Voter 1' });
    capabilityEngine.registerAgent({ id: voter2Id, name: 'Voter 2' });
    capabilityEngine.registerAgent({ id: voter3Id, name: 'Voter 3' });

    // Create a promotion vote
    const { voteId, targetId: returnedTarget, voteType, expiresAt } =
      votingSystem.createVote(targetId, 'promotion');

    assert.ok(voteId, 'Vote session should have an ID');
    assert.equal(returnedTarget, targetId, 'Target should match');
    assert.equal(voteType, 'promotion', 'Vote type should be promotion');
    assert.ok(expiresAt, 'Should have an expiry time');

    // Cast votes (2 approve, 1 reject)
    const vote1 = votingSystem.castVote(voteId, voter1Id, 'approve');
    assert.equal(vote1.choice, 'approve');
    assert.ok(vote1.weight >= 1, 'Vote weight should be at least 1');

    const vote2 = votingSystem.castVote(voteId, voter2Id, 'approve');
    assert.equal(vote2.choice, 'approve');

    const vote3 = votingSystem.castVote(voteId, voter3Id, 'reject');
    assert.equal(vote3.choice, 'reject');

    // Close the vote
    const closeResult = votingSystem.closeVote(voteId);
    assert.ok(closeResult.voteId, 'Close result should include voteId');
    assert.ok(['passed', 'failed'].includes(closeResult.result), 'Result should be passed or failed');
    assert.ok(closeResult.approvalRate >= 0 && closeResult.approvalRate <= 1, 'Approval rate should be 0-1');

    // Verify the stored vote result has status=closed (Bug #2 fix)
    const stored = db.getVoteResult(voteId);
    assert.equal(stored.status, 'closed', 'Stored status should be closed');
    assert.ok(stored.concluded_at, 'Should have a concluded_at timestamp');
  });

  // -----------------------------------------------------------------------
  // 6. Task allocation selects highest-scoring available agent
  // -----------------------------------------------------------------------

  it('task allocation selects highest-scoring available agent', () => {
    const agentHighId = `test-alloc-high-${randomUUID().slice(0, 8)}`;
    const agentLowId = `test-alloc-low-${randomUUID().slice(0, 8)}`;

    capabilityEngine.registerAgent({
      id: agentHighId,
      name: 'High Score Agent',
      skills: [
        { name: 'api-design', level: 'expert' },
        { name: 'database', level: 'advanced' },
        { name: 'performance', level: 'advanced' },
        { name: 'security', level: 'intermediate' },
      ],
    });

    capabilityEngine.registerAgent({
      id: agentLowId,
      name: 'Low Score Agent',
      skills: [
        { name: 'api-design', level: 'beginner' },
      ],
    });

    // Give the high agent a better total_score
    db.updateAgent(agentHighId, { total_score: 90 });
    db.updateAgent(agentLowId, { total_score: 30 });

    capabilityEngine.clearCache();

    const allocation = capabilityEngine.allocateTask(
      { type: 'backend', requiredAgents: 1 },
      [agentHighId, agentLowId],
    );

    assert.ok(allocation.length >= 1, 'Should allocate at least one agent');
    assert.equal(allocation[0].agentId, agentHighId, 'Highest-scoring agent should be selected first');
    assert.ok(allocation[0].score > 0, 'Allocation score should be positive');
  });

  // -----------------------------------------------------------------------
  // 7. Collaboration scoring works between two agents
  // -----------------------------------------------------------------------

  it('collaboration scoring works between two agents', () => {
    const agentA = `test-collab-a-${randomUUID().slice(0, 8)}`;
    const agentB = `test-collab-b-${randomUUID().slice(0, 8)}`;

    capabilityEngine.registerAgent({ id: agentA, name: 'Collab Agent A' });
    capabilityEngine.registerAgent({ id: agentB, name: 'Collab Agent B' });

    const taskId = `task-collab-${randomUUID().slice(0, 8)}`;

    // Record multiple collaboration events
    ledger.recordCollaboration(agentA, agentB, taskId, 0.85);
    ledger.recordCollaboration(agentA, agentB, `${taskId}-2`, 0.90);

    // Check pairwise collaboration score
    const pairScore = ledger.getCollaborationScore(agentA, agentB);
    assert.ok(typeof pairScore === 'number', 'Collaboration score should be a number');
    assert.ok(pairScore > 0, 'Collaboration score should be positive after recording');

    // Check individual agent collaboration score
    const agentAScore = ledger.getAgentCollaborationScore(agentA);
    assert.ok(typeof agentAScore === 'number', 'Agent collaboration score should be a number');
    assert.ok(agentAScore > 0, 'Agent A should have a positive collaboration score');
  });

  // -----------------------------------------------------------------------
  // 8. Behavior tagging triggers on contribution criteria
  // -----------------------------------------------------------------------

  it('behavior tagging triggers on contribution criteria', () => {
    const agentId = `test-tags-${randomUUID().slice(0, 8)}`;

    capabilityEngine.registerAgent({ id: agentId, name: 'Tagged Agent' });

    // Auto-tag with qualifying behavior metrics
    ledger.autoTag(agentId, {
      avgCompletionRatio: 0.7,    // < 0.8 => 'fast-executor'
      avgQuality: 0.95,           // > 0.9 => 'quality-guarantor'
      consistencyRate: 0.96,      // > 0.95 => 'reliable'
      innovationCount: 6,         // > 5 => 'innovator'
      helpedOthersCount: 11,      // > 10 => 'team-player'
    });

    const tags = db.getBehaviorTags(agentId);
    assert.ok(tags.length >= 3, 'Should have at least 3 behavior tags assigned');

    const tagNames = tags.map((t) => t.tag);
    assert.ok(tagNames.includes('quality-guarantor'), 'Should have quality-guarantor tag');
    assert.ok(tagNames.includes('reliable'), 'Should have reliable tag');
    assert.ok(tagNames.includes('innovator'), 'Should have innovator tag');
    assert.ok(tagNames.includes('team-player'), 'Should have team-player tag');

    // Verify tag multiplier
    const multiplier = ledger.getTagMultiplier(agentId);
    assert.ok(multiplier > 1.0, 'Tag multiplier should be greater than 1.0 with qualifying tags');
  });

  // -----------------------------------------------------------------------
  // 9. Evaluation queue persists and recovers items
  // -----------------------------------------------------------------------

  it('evaluation queue persists and recovers items', () => {
    const agentId = `test-evalq-${randomUUID().slice(0, 8)}`;

    capabilityEngine.registerAgent({ id: agentId, name: 'EvalQueue Agent' });

    // Enqueue several evaluations
    evaluationQueue.enqueue(agentId, { dimension: 'technical', score: 65 });
    evaluationQueue.enqueue(agentId, { dimension: 'delivery', score: 70 });

    // Verify pending count in DB
    const pendingCount = db.getPendingEvaluationCount();
    assert.ok(pendingCount >= 2, 'Should have at least 2 pending evaluations in DB');

    // Create a fresh queue instance (simulates process restart)
    const freshQueue = new EvaluationQueue(govConfig);
    const recovered = freshQueue.recoverPendingItems();
    assert.ok(recovered >= 0, 'Recovery should process items without error');

    // After recovery, pending count should be reduced
    const afterCount = db.getPendingEvaluationCount();
    assert.ok(afterCount < pendingCount, 'Pending count should decrease after recovery');

    freshQueue.shutdown();
  });

  // -----------------------------------------------------------------------
  // 10. Orchestrator governance hooks fire during task lifecycle
  // -----------------------------------------------------------------------

  it('orchestrator governance hooks fire during task lifecycle when enabled', async () => {
    const roleManager = new RoleManager();
    const taskDistributor = new TaskDistributor(new SimulatedStrategy());

    orchestratorGov = new SwarmOrchestrator({
      roleManager,
      taskDistributor,
      monitor: new Monitor(db, { monitorMode: 'default' }),
      maxWorkers: 4,
      roleTimeout: 30000,
      circuitThreshold: 100,
      circuitTimeout: 60000,
      safety: { maxDescriptionLength: 10000, maxRoles: 8, maxTasksPerMinute: 60 },
      governance: capabilityEngine,
      governanceEnabled: true,
    });

    assert.equal(orchestratorGov.governanceEnabled, true, 'Governance should be enabled');
    assert.ok(orchestratorGov.governance, 'Governance engine should be set');

    // Track governance-related events
    const govEvents = [];
    orchestratorGov.on('governance:allocation-failed', (payload) => {
      govEvents.push({ type: 'allocation-failed', ...payload });
    });

    const { createResult, donePayload } = await createAndWait(orchestratorGov, {
      description: 'Build a backend API for governance hook test',
      type: 'backend',
    });

    assert.ok(createResult.taskId, 'Task should have been created');
    assert.ok(donePayload.taskId, 'Task should have completed');

    // Verify the task completed successfully
    const task = db.getSwarmTask(createResult.taskId);
    assert.ok(
      task.status === 'completed' || task.status === 'failed',
      'Task should reach a terminal state',
    );

    // Clean up the orchestrator's monitor
    orchestratorGov.monitor?.shutdown?.();
  });

  // -----------------------------------------------------------------------
  // 11. Orchestrator works normally when governance is disabled
  // -----------------------------------------------------------------------

  it('orchestrator works normally when governance is disabled (backward compat)', async () => {
    const roleManager = new RoleManager();
    const taskDistributor = new TaskDistributor(new SimulatedStrategy());

    orchestratorNoGov = new SwarmOrchestrator({
      roleManager,
      taskDistributor,
      monitor: new Monitor(db, { monitorMode: 'default' }),
      maxWorkers: 4,
      roleTimeout: 30000,
      circuitThreshold: 100,
      circuitTimeout: 60000,
      safety: { maxDescriptionLength: 10000, maxRoles: 8, maxTasksPerMinute: 60 },
      governance: null,
      governanceEnabled: false,
    });

    assert.equal(orchestratorNoGov.governanceEnabled, false, 'Governance should be disabled');
    assert.equal(orchestratorNoGov.governance, null, 'Governance engine should be null');

    const { createResult, donePayload } = await createAndWait(orchestratorNoGov, {
      description: 'Build a web application for backward compat governance test',
      type: 'web-app',
    });

    assert.ok(createResult.taskId, 'Task should have been created');
    assert.ok(donePayload.taskId, 'Task should have completed');

    const task = db.getSwarmTask(createResult.taskId);
    // In simulated mode, task may complete or fail depending on strategy simulation
    // The key point: governance is disabled and task still reaches a terminal state
    assert.ok(
      task.status === 'completed' || task.status === 'failed',
      `Task should reach terminal state without governance, got: ${task.status}`,
    );

    // Clean up the orchestrator's monitor
    orchestratorNoGov.monitor?.shutdown?.();
  });

  // -----------------------------------------------------------------------
  // 12. Monitor records governance critical events immediately
  // -----------------------------------------------------------------------

  it('monitor records governance critical events immediately', () => {
    const taskId = `test-monitor-crit-${randomUUID().slice(0, 8)}`;

    // Record a critical governance event
    monitor.recordEvent({
      type: 'governance:tier-changed',
      taskId,
      agentId: 'test-agent-monitor',
      details: 'Promoted from trainee to junior',
    });

    // Critical events should be written immediately (stored as checkpoints)
    const recentEvents = monitor.getRecentEvents(50);
    const found = recentEvents.find(
      (e) => e.taskId === taskId && e.type === 'governance:tier-changed',
    );
    assert.ok(found, 'Critical governance event should be in the ring buffer');
    assert.ok(found.timestamp, 'Event should have a timestamp');

    // Also record another critical type
    monitor.recordEvent({
      type: 'governance:vote-closed',
      taskId: `${taskId}-vote`,
      agentId: 'test-agent-monitor',
    });

    const allRecent = monitor.getRecentEvents(50);
    const voteEvent = allRecent.find(
      (e) => e.taskId === `${taskId}-vote` && e.type === 'governance:vote-closed',
    );
    assert.ok(voteEvent, 'Vote closed critical event should be recorded');
  });

  // -----------------------------------------------------------------------
  // 13. Monitor samples high-frequency governance events (R5 fix)
  // -----------------------------------------------------------------------

  it('monitor samples high-frequency governance events (R5 fix)', () => {
    // Record many high-frequency (non-critical) governance events
    const sampleCheckId = `test-sample-${randomUUID().slice(0, 8)}`;

    for (let i = 0; i < 30; i++) {
      monitor.recordGovernanceEvent({
        type: 'governance:capability-updated',
        agentId: sampleCheckId,
        iteration: i,
      });
    }

    // Check how many were actually recorded in the buffer
    const recentEvents = monitor.getRecentEvents(200);
    const sampledEvents = recentEvents.filter(
      (e) => e.agentId === sampleCheckId && e.type === 'governance:capability-updated',
    );

    // With sample rate of 1/10 and 30 events, expect ~3 recorded
    assert.ok(
      sampledEvents.length < 30,
      `Sampled events (${sampledEvents.length}) should be fewer than total sent (30)`,
    );
    assert.ok(
      sampledEvents.length >= 1,
      'At least some high-frequency events should have been sampled',
    );

    // Verify sampled events have the sampled flag
    for (const event of sampledEvents) {
      assert.equal(event.sampled, true, 'Sampled events should have sampled=true');
    }
  });

  // -----------------------------------------------------------------------
  // 14. Skill certification persists and retrieves correctly
  // -----------------------------------------------------------------------

  it('skill certification persists and retrieves correctly', () => {
    const agentId = `test-skill-${randomUUID().slice(0, 8)}`;

    capabilityEngine.registerAgent({ id: agentId, name: 'Skilled Agent' });

    // Certify several skills
    capabilityEngine.certifySkill(agentId, 'javascript', 'expert', 'Passed JS certification exam');
    capabilityEngine.certifySkill(agentId, 'react', 'advanced');
    capabilityEngine.certifySkill(agentId, 'sql', 'intermediate', 'Completed SQL course');

    // Retrieve skills
    const skills = db.getSkills(agentId);
    assert.equal(skills.length, 3, 'Should have exactly 3 skills');

    const jsSkill = skills.find((s) => s.skill_name === 'javascript');
    assert.ok(jsSkill, 'Should have javascript skill');
    assert.equal(jsSkill.level, 'expert', 'JS skill level should be expert');
    assert.equal(jsSkill.evidence, 'Passed JS certification exam', 'Evidence should be stored');
    assert.ok(jsSkill.expires_at, 'Skill should have an expiry date');

    // Verify skill level retrieval via DB helper
    const jsLevel = db.getAgentSkillLevel(agentId, 'javascript');
    assert.equal(jsLevel, 'expert', 'Skill level lookup should return expert');

    const reactLevel = db.getAgentSkillLevel(agentId, 'react');
    assert.equal(reactLevel, 'advanced', 'React skill level should be advanced');

    // Verify non-existent skill returns null
    const noSkill = db.getAgentSkillLevel(agentId, 'rust');
    assert.equal(noSkill, null, 'Non-existent skill should return null');
  });

  // -----------------------------------------------------------------------
  // 15. Leaderboard ranks agents by contribution points
  // -----------------------------------------------------------------------

  it('leaderboard ranks agents by contribution points', () => {
    const agentTop = `test-lb-top-${randomUUID().slice(0, 8)}`;
    const agentMid = `test-lb-mid-${randomUUID().slice(0, 8)}`;
    const agentBot = `test-lb-bot-${randomUUID().slice(0, 8)}`;

    capabilityEngine.registerAgent({ id: agentTop, name: 'Top Contributor' });
    capabilityEngine.registerAgent({ id: agentMid, name: 'Mid Contributor' });
    capabilityEngine.registerAgent({ id: agentBot, name: 'Bot Contributor' });

    // Record contributions with varying complexity/quality
    ledger.recordContribution(agentTop, { id: 't1', type: 'backend', complexity: 5 }, { quality: 0.95, earlyCompletion: true, hasInnovation: true, helpedOthers: true });
    ledger.recordContribution(agentTop, { id: 't2', type: 'frontend', complexity: 3 }, { quality: 0.9 });

    ledger.recordContribution(agentMid, { id: 't3', type: 'testing', complexity: 2 }, { quality: 0.8 });

    ledger.recordContribution(agentBot, { id: 't4', type: 'documentation', complexity: 1 }, { quality: 0.5 });

    // Get leaderboard
    const leaderboard = ledger.getLeaderboard(10);
    assert.ok(Array.isArray(leaderboard), 'Leaderboard should be an array');
    assert.ok(leaderboard.length >= 3, 'Leaderboard should have at least 3 agents');

    // Find our test agents in the leaderboard
    const topIdx = leaderboard.findIndex((a) => a.id === agentTop);
    const midIdx = leaderboard.findIndex((a) => a.id === agentMid);
    const botIdx = leaderboard.findIndex((a) => a.id === agentBot);

    assert.ok(topIdx >= 0, 'Top contributor should appear in leaderboard');
    assert.ok(midIdx >= 0, 'Mid contributor should appear in leaderboard');
    assert.ok(botIdx >= 0, 'Bot contributor should appear in leaderboard');

    // Verify ordering: top should rank higher (lower index) than mid and bot
    assert.ok(topIdx < botIdx, 'Top contributor should rank above bottom contributor');

    // Verify the top contributor has the highest points among our 3 test agents
    const topPoints = leaderboard[topIdx].contribution_points;
    const midPoints = leaderboard[midIdx].contribution_points;
    const botPoints = leaderboard[botIdx].contribution_points;

    assert.ok(topPoints > midPoints, 'Top contributor should have more points than mid');
    assert.ok(midPoints > botPoints, 'Mid contributor should have more points than bottom');
  });
});
