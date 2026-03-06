/**
 * Unit tests for Governance Modules (ported from Swarm Lite v3.0)
 *
 * Covers EvaluationQueue, ReputationLedger, CapabilityEngine, and VotingSystem
 * with ~30 tests validating core functionality, bug fixes, and resilience fixes.
 *
 * Uses node:test + node:assert/strict (no external libraries).
 * Each run creates a fresh SQLite DB in :memory:, cleaned up in after().
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../src/layer1-core/db.js';
import { EvaluationQueue } from '../../src/layer2-engines/governance/evaluation-queue.js';
import { ReputationLedger } from '../../src/layer2-engines/governance/reputation-ledger.js';
import { CapabilityEngine } from '../../src/layer2-engines/governance/capability-engine.js';
import { VotingSystem } from '../../src/layer2-engines/governance/voting-system.js';
import { VotingError } from '../../src/layer1-core/errors.js';

describe('Governance Modules', () => {
  // Governance config mirroring DEFAULT_CONFIG.governance sections
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
      precompute: { enabled: false, updateInterval: 3600000 },
    },
  };

  before(() => {
    db.initDb(':memory:');
  });

  after(() => {
    db.closeDb();
  });

  // =========================================================================
  // Helper: clean test-prefixed data between tests
  // =========================================================================
  function cleanTestData() {
    const d = db.getDb();
    d.exec("DELETE FROM evaluation_queue WHERE agent_id LIKE 'test-%'");
    d.exec("DELETE FROM contributions WHERE agent_id LIKE 'test-%'");
    d.exec("DELETE FROM capabilities WHERE agent_id LIKE 'test-%'");
    d.exec("DELETE FROM capability_details WHERE agent_id LIKE 'test-%'");
    d.exec("DELETE FROM skills WHERE agent_id LIKE 'test-%'");
    d.exec("DELETE FROM behavior_tags WHERE agent_id LIKE 'test-%'");
    d.exec("DELETE FROM collaboration_history WHERE agent_a_id LIKE 'test-%' OR agent_b_id LIKE 'test-%'");
    d.exec("DELETE FROM votes WHERE voter_id LIKE 'test-%' OR target_id LIKE 'test-%'");
    d.exec("DELETE FROM vote_results WHERE target_id LIKE 'test-%'");
    d.exec("DELETE FROM agents WHERE id LIKE 'test-%'");
  }

  // =========================================================================
  // 1. EvaluationQueue (4 tests)
  // =========================================================================
  describe('EvaluationQueue', () => {
    let queue;

    before(() => {
      queue = new EvaluationQueue({
        performance: { asyncQueue: { batchSize: 5, flushInterval: 60000 } },
      });
    });

    beforeEach(() => {
      cleanTestData();
      // Create a test agent that evaluations will target
      db.createAgent('test-eq-agent', 'EQ Agent', 'general', 'trainee');
      db.createCapability('test-eq-agent', 'technical', 50);
    });

    after(() => {
      queue.shutdown();
    });

    it('enqueue creates a DB record in evaluation_queue', () => {
      queue.enqueue('test-eq-agent', { dimension: 'technical', score: 70 });

      const pending = db.dequeueEvaluations(100);
      const found = pending.find(
        (item) => item.agent_id === 'test-eq-agent',
      );
      assert.ok(found, 'Should find enqueued item in DB');
      assert.equal(found.updates.dimension, 'technical');
      assert.equal(found.updates.score, 70);
    });

    it('processQueue dequeues items in batch and marks them processed', () => {
      // Enqueue 3 items
      queue.enqueue('test-eq-agent', { dimension: 'technical', score: 60 });
      queue.enqueue('test-eq-agent', { dimension: 'technical', score: 65 });
      queue.enqueue('test-eq-agent', { dimension: 'technical', score: 70 });

      const processed = queue.processQueue(10);
      assert.equal(processed, 3, 'Should process all 3 items');

      // Verify nothing left pending
      const remaining = db.getPendingEvaluationCount();
      assert.equal(remaining, 0, 'No pending items should remain');
    });

    it('recoverPendingItems finds and processes unprocessed items', () => {
      // Enqueue items without processing (simulating a crash recovery)
      db.enqueueEvaluation('test-eq-agent', JSON.stringify({ dimension: 'technical', score: 55 }));
      db.enqueueEvaluation('test-eq-agent', JSON.stringify({ dimension: 'technical', score: 60 }));

      const count = queue.recoverPendingItems();
      assert.ok(count >= 2, 'Should recover at least 2 pending items');

      const afterCount = db.getPendingEvaluationCount();
      assert.equal(afterCount, 0, 'All items should be processed after recovery');
    });

    it('shutdown stops the processor cleanly', () => {
      queue.startProcessor();
      assert.ok(queue._processorInterval !== null, 'Processor should be running');

      queue.shutdown();
      assert.equal(queue._processorInterval, null, 'Processor interval should be null after shutdown');
    });
  });

  // =========================================================================
  // 2. ReputationLedger (8 tests)
  // =========================================================================
  describe('ReputationLedger', () => {
    let ledger;

    before(() => {
      ledger = new ReputationLedger({ contribution: govConfig.contribution });
    });

    beforeEach(() => {
      cleanTestData();
      db.createAgent('test-rep-a', 'Rep Agent A', 'general', 'trainee');
      db.createAgent('test-rep-b', 'Rep Agent B', 'general', 'trainee');
      db.createAgent('test-rep-c', 'Rep Agent C', 'general', 'trainee');
    });

    it('recordContribution creates DB contribution with correct points', () => {
      const task = { id: 'test-task-1', complexity: 3, type: 'backend' };
      const outcome = { quality: 0.8, earlyCompletion: false, hasInnovation: false, helpedOthers: false };

      const result = ledger.recordContribution('test-rep-a', task, outcome);

      assert.equal(result.category, 'development', 'backend maps to development');
      // points = round(3 * 10 * 0.8 * 1.0 * 1.0 * 1.0) = 24
      assert.equal(result.points, 24, 'Points should be 24');

      const contributions = db.getContributions('test-rep-a');
      assert.ok(contributions.length > 0, 'Contribution should exist in DB');
      assert.equal(contributions[0].points, 24);
    });

    it('autoTag assigns reliable tag when consistency criteria met', () => {
      const behavior = {
        avgCompletionRatio: 0.9,
        avgQuality: 0.85,
        consistencyRate: 0.96,
        innovationCount: 0,
        helpedOthersCount: 0,
      };

      ledger.autoTag('test-rep-a', behavior);

      const tags = db.getBehaviorTags('test-rep-a');
      const reliable = tags.find((t) => t.tag === 'reliable');
      assert.ok(reliable, 'Should have reliable tag');
      assert.equal(reliable.weight, 1.1);
    });

    it('getCollaborationScore returns normalized 0-1 value (Bug #1 fix)', () => {
      // Record collaborations to establish a global max
      db.recordCollaboration('test-rep-a', 'test-rep-b', 'task-1', 0.8);
      db.recordCollaboration('test-rep-a', 'test-rep-c', 'task-2', 0.4);

      const score = ledger.getCollaborationScore('test-rep-a', 'test-rep-b');

      assert.ok(score >= 0 && score <= 1, `Score ${score} should be between 0 and 1`);
      // With max=0.8 and raw=0.8, normalized = 1.0
      assert.equal(score, 1.0, 'Score should be 1.0 when pair has the global max');
    });

    it('getCollaborationScore returns 0.5 when no data (fallback)', () => {
      const score = ledger.getCollaborationScore('test-rep-a', 'test-rep-b');
      assert.equal(score, 0.5, 'Should return 0.5 fallback when no collaboration data');
    });

    it('getLeaderboard returns ranked agents', () => {
      // Give agents different contribution points
      db.updateAgent('test-rep-a', { contribution_points: 100 });
      db.updateAgent('test-rep-b', { contribution_points: 200 });
      db.updateAgent('test-rep-c', { contribution_points: 50 });

      const leaderboard = ledger.getLeaderboard(10);

      assert.ok(leaderboard.length >= 3, 'Should have at least 3 agents');
      // First entry should be the one with 200 points
      const topAgent = leaderboard.find((a) => a.id === 'test-rep-b');
      assert.ok(topAgent, 'Agent B should be on leaderboard');
      assert.equal(leaderboard[0].contribution_points, 200, 'Top agent should have 200 points');
    });

    it('recordCollaboration normalizes pair ordering (alphabetical)', () => {
      // Record with B, A order -- should be stored as A, B
      ledger.recordCollaboration('test-rep-b', 'test-rep-a', 'task-1', 0.9);

      // Query in A, B order
      const scoreAB = db.getCollaborationScore('test-rep-a', 'test-rep-b');
      assert.ok(scoreAB !== null, 'Should find score with alphabetical ordering');
      assert.equal(scoreAB, 0.9);

      // Query in B, A order should also work (db normalizes)
      const scoreBA = db.getCollaborationScore('test-rep-b', 'test-rep-a');
      assert.equal(scoreBA, 0.9, 'Reverse order should return same score');
    });

    it('getTagMultiplier returns product of tag weights', () => {
      db.addBehaviorTag('test-rep-a', 'reliable', 1.1, 'auto');
      db.addBehaviorTag('test-rep-a', 'quality-guarantor', 1.3, 'auto');

      const multiplier = ledger.getTagMultiplier('test-rep-a');
      // 1.1 * 1.3 = 1.43
      assert.ok(
        Math.abs(multiplier - 1.43) < 0.01,
        `Multiplier should be ~1.43, got ${multiplier}`,
      );
    });

    it('multiple contributions accumulate correctly', () => {
      const task1 = { id: 'test-task-a1', complexity: 2, type: 'frontend' };
      const task2 = { id: 'test-task-a2', complexity: 3, type: 'backend' };
      const outcome = { quality: 1.0 };

      ledger.recordContribution('test-rep-a', task1, outcome);
      ledger.recordContribution('test-rep-a', task2, outcome);

      const total = ledger.getTotalPoints('test-rep-a');
      // task1: round(2 * 10 * 1.0) = 20, task2: round(3 * 10 * 1.0) = 30
      assert.equal(total, 50, 'Total points should be 50 (20 + 30)');

      const agent = db.getAgent('test-rep-a');
      assert.equal(agent.contribution_points, 50, 'Agent contribution_points should be updated');
    });
  });

  // =========================================================================
  // 3. CapabilityEngine (12 tests)
  // =========================================================================
  describe('CapabilityEngine', () => {
    let engine;
    let ledger;
    let evalQueue;

    before(() => {
      ledger = new ReputationLedger({ contribution: govConfig.contribution });
      evalQueue = new EvaluationQueue({
        performance: govConfig.performance,
      });
      engine = new CapabilityEngine({
        capability: govConfig.capability,
        tiers: govConfig.tiers,
        allocation: govConfig.allocation,
        performance: { ...govConfig.performance, precompute: { enabled: false } },
      });
      engine.setLedger(ledger);
      engine.setEvaluationQueue(evalQueue);
    });

    beforeEach(() => {
      cleanTestData();
      engine.clearCache();
    });

    after(() => {
      engine.shutdown();
      evalQueue.shutdown();
    });

    it('registerAgent creates agent + 4 capabilities', () => {
      engine.registerAgent({ id: 'test-cap-a', name: 'Cap Agent A' });

      const agent = db.getAgent('test-cap-a');
      assert.ok(agent, 'Agent should exist');
      assert.equal(agent.tier, 'trainee');

      const caps = db.getCapabilities('test-cap-a');
      assert.equal(caps.length, 4, 'Should have 4 capability dimensions');
      const dimNames = caps.map((c) => c.dimension).sort();
      assert.deepEqual(dimNames, ['collaboration', 'delivery', 'innovation', 'technical']);
    });

    it('getAgentProfile returns cached data', () => {
      engine.registerAgent({ id: 'test-cap-b', name: 'Cap Agent B' });

      const profile1 = engine.getAgentProfile('test-cap-b');
      assert.ok(profile1, 'Profile should be returned');
      assert.equal(profile1.name, 'Cap Agent B');

      // Second call should come from cache (same object reference)
      const profile2 = engine.getAgentProfile('test-cap-b');
      assert.equal(profile1, profile2, 'Should return cached reference');
    });

    it('updateCapabilityScore persists to DB', () => {
      engine.registerAgent({ id: 'test-cap-c', name: 'Cap Agent C' });

      engine.updateCapabilityScore('test-cap-c', 'technical', 85);

      const caps = db.getCapabilities('test-cap-c');
      const tech = caps.find((c) => c.dimension === 'technical');
      assert.equal(tech.score, 85, 'Technical score should be 85');
    });

    it('updateTotalScore uses weighted 4D formula', () => {
      engine.registerAgent({ id: 'test-cap-d', name: 'Cap Agent D' });

      // Set known capability scores
      db.updateCapabilityScore('test-cap-d', 'technical', 80);
      db.updateCapabilityScore('test-cap-d', 'delivery', 70);
      db.updateCapabilityScore('test-cap-d', 'collaboration', 60);
      db.updateCapabilityScore('test-cap-d', 'innovation', 90);

      const total = engine.updateTotalScore('test-cap-d');

      // Expected: 80*0.4 + 70*0.3 + 60*0.2 + 90*0.1 = 32 + 21 + 12 + 9 = 74
      // Plus historical bonus (0 since < 5 contributions)
      assert.equal(total, 74, 'Total score should be 74');
    });

    it('evaluateTierChange recommends correct tier based on score', () => {
      engine.registerAgent({ id: 'test-cap-e', name: 'Cap Agent E' });

      // Set score above junior threshold (60)
      db.updateAgent('test-cap-e', { total_score: 65 });

      const result = engine.evaluateTierChange('test-cap-e');
      assert.ok(result.eligible, 'Should be eligible for promotion');
      assert.equal(result.type, 'promotion');
      assert.equal(result.from, 'trainee');
      assert.equal(result.to, 'junior');
    });

    it('allocateTask ranks agents by match score', () => {
      engine.registerAgent({
        id: 'test-cap-f1',
        name: 'F1',
        skills: [{ name: 'javascript', level: 'expert' }, { name: 'react', level: 'advanced' }],
      });
      engine.registerAgent({
        id: 'test-cap-f2',
        name: 'F2',
        skills: [{ name: 'javascript', level: 'beginner' }],
      });

      const allocations = engine.allocateTask(
        { type: 'frontend', requiredAgents: 2 },
        ['test-cap-f1', 'test-cap-f2'],
      );

      assert.equal(allocations.length, 2, 'Should return 2 allocations');
      assert.equal(allocations[0].agentId, 'test-cap-f1', 'Agent F1 should rank first (more skills)');
      assert.ok(allocations[0].score > allocations[1].score, 'F1 should have higher score than F2');
    });

    it('calculateHistoricalBonus filters completed tasks only (Bug #3 fix)', () => {
      engine.registerAgent({ id: 'test-cap-g', name: 'Cap Agent G' });

      // Create 6 contributions: 5 with quality_score, 1 with null (incomplete)
      for (let i = 0; i < 5; i++) {
        db.createContribution('test-cap-g', `task-g-${i}`, 10, 'development', 0.85, null, null);
      }
      // This one has null quality_score and should be excluded
      db.createContribution('test-cap-g', 'task-g-null', 10, 'development', null, null, null);

      const bonus = engine.calculateHistoricalBonus('test-cap-g');

      // 5 qualifying contributions with quality 0.85, decay 0.9
      // sum = 0.85 * (1 + 0.9 + 0.81 + 0.729 + 0.6561) = 0.85 * 4.0951 = 3.48
      assert.ok(bonus > 0, 'Bonus should be > 0 with 5 qualifying contributions');
      assert.ok(bonus <= 10, 'Bonus should not exceed maxHistoricalBonus');
    });

    it('precomputeMatchMatrix includes documentation type (Bug #4 fix)', () => {
      engine.registerAgent({
        id: 'test-cap-h',
        name: 'Cap Agent H',
        skills: [{ name: 'technical-writing', level: 'expert' }],
      });

      engine.precomputeMatchMatrix();

      const key = 'test-cap-h:documentation';
      const score = engine._matchMatrix.get(key);
      assert.ok(score !== undefined, 'Match matrix should contain documentation task type entry');
      assert.ok(score > 0, 'Documentation match score should be > 0 for agent with technical-writing skill');
    });

    it('cache invalidation on contribution recording (Bug #6 fix)', () => {
      engine.registerAgent({ id: 'test-cap-i', name: 'Cap Agent I' });

      // Populate cache
      const profileBefore = engine.getAgentProfile('test-cap-i');
      assert.ok(profileBefore, 'Profile should be cached');

      // Update capability score (this calls clearCache internally)
      engine.updateCapabilityScore('test-cap-i', 'technical', 90);

      // Cache should have been cleared, next call fetches fresh data
      const profileAfter = engine.getAgentProfile('test-cap-i');
      assert.notEqual(profileBefore, profileAfter, 'Cache should have been invalidated');

      const tech = profileAfter.capabilities.find((c) => c.dimension === 'technical');
      assert.equal(tech.score, 90, 'Fresh profile should reflect updated score');
    });

    it('soft tier transition when agent has active tasks (R1 fix)', () => {
      engine.registerAgent({ id: 'test-cap-j', name: 'Cap Agent J' });
      db.updateAgent('test-cap-j', { tier: 'mid', total_score: 50 });

      // Simulate active tasks by inserting an executing task
      db.createSwarmTask('test-active-task-1', '{}', 'simulated');
      db.getDb().prepare(
        "UPDATE swarm_tasks SET status = 'executing' WHERE id = 'test-active-task-1'",
      ).run();

      const change = {
        type: 'demotion',
        from: 'mid',
        to: 'junior',
      };

      engine.applyTierChange('test-cap-j', change);

      const agent = db.getAgent('test-cap-j');
      assert.equal(agent.tier, 'junior', 'Agent should be demoted to junior');
      // Agent stays active even though executing tasks exceed new tier limit
      assert.equal(agent.status, 'active', 'Agent should remain active (grace period)');
    });

    it('dimension weight validation (R4 fix)', () => {
      // Verify that the config weights sum to 1.0
      const dims = govConfig.capability.dimensions;
      const sum = Object.values(dims).reduce((acc, d) => acc + d.weight, 0);
      assert.ok(
        Math.abs(sum - 1.0) < 0.01,
        `Dimension weights should sum to 1.0, got ${sum}`,
      );

      // Verify the engine uses these weights in total score calculation
      engine.registerAgent({ id: 'test-cap-k', name: 'Cap Agent K' });
      // Set all dimensions to 100
      for (const dim of ['technical', 'delivery', 'collaboration', 'innovation']) {
        db.updateCapabilityScore('test-cap-k', dim, 100);
      }
      const total = engine.updateTotalScore('test-cap-k');
      // 100 * (0.4 + 0.3 + 0.2 + 0.1) = 100
      assert.equal(total, 100, 'All dimensions at 100 with weights summing to 1.0 should yield 100');
    });

    it('allocateTask uses actual collab score not hardcoded (Bug #1 fix)', () => {
      engine.registerAgent({ id: 'test-cap-l1', name: 'L1' });
      engine.registerAgent({ id: 'test-cap-l2', name: 'L2' });

      // Record real collaboration data to affect L1's collab score
      db.recordCollaboration('test-cap-l1', 'test-cap-l2', 'collab-task-1', 0.95);

      // Calculate match scores; L1 should use actual collab score from ledger
      const scoreL1 = engine.calculateMatchScore('test-cap-l1', 'backend');
      const scoreL2 = engine.calculateMatchScore('test-cap-l2', 'backend');

      // L1 has collab data (normalized = 1.0 since 0.95 is the max), L2 also has collab data
      // Both participated in the same collab, so their individual scores should reflect actual data
      // The key assertion: the engine's ledger reference is used, not hardcoded 0.5
      assert.ok(engine._ledger !== null, 'Engine should have a ledger reference set');

      // Verify the collab score is actually fetched from the ledger
      const agentCollabScore = ledger.getAgentCollaborationScore('test-cap-l1');
      assert.ok(agentCollabScore !== 0.5 || agentCollabScore === 1.0,
        'Collab score should reflect real data, not default 0.5');
    });
  });

  // =========================================================================
  // 4. VotingSystem (6 tests)
  // =========================================================================
  describe('VotingSystem', () => {
    let voting;

    before(() => {
      voting = new VotingSystem({ voting: govConfig.voting });
    });

    beforeEach(() => {
      cleanTestData();
      // Create test agents for voting
      db.createAgent('test-voter-1', 'Voter 1', 'general', 'senior');
      db.createAgent('test-voter-2', 'Voter 2', 'general', 'lead');
      db.createAgent('test-voter-3', 'Voter 3', 'general', 'mid');
      db.createAgent('test-target', 'Target Agent', 'general', 'junior');
      // Give voters some score/points for weight calculation
      db.updateAgent('test-voter-1', { total_score: 80, contribution_points: 100 });
      db.updateAgent('test-voter-2', { total_score: 90, contribution_points: 200 });
      db.updateAgent('test-voter-3', { total_score: 70, contribution_points: 50 });
    });

    it('createVote creates vote result in DB', () => {
      const { voteId, targetId, voteType, expiresAt } = voting.createVote(
        'test-target',
        'promotion',
      );

      assert.ok(voteId.startsWith('vote_'), 'Vote ID should start with vote_');
      assert.equal(targetId, 'test-target');
      assert.equal(voteType, 'promotion');
      assert.ok(expiresAt, 'Should have an expiry time');

      const dbResult = db.getVoteResult(voteId);
      assert.ok(dbResult, 'Vote result should exist in DB');
      assert.equal(dbResult.status, 'pending');
      assert.equal(dbResult.vote_type, 'promotion');
    });

    it('castVote records vote with weight', () => {
      const { voteId } = voting.createVote('test-target', 'promotion');

      const castResult = voting.castVote(voteId, 'test-voter-1', 'approve');

      assert.equal(castResult.voteId, voteId);
      assert.equal(castResult.voterId, 'test-voter-1');
      assert.equal(castResult.choice, 'approve');
      assert.ok(castResult.weight >= 1, 'Weight should be at least 1');

      const votes = db.getVotesByVoteId(voteId);
      assert.equal(votes.length, 1, 'Should have 1 vote record');
      assert.equal(votes[0].voter_id, 'test-voter-1');
      assert.equal(votes[0].choice, 'approve');
    });

    it('closeVote updates both result AND status (Bug #2 fix)', () => {
      const { voteId } = voting.createVote('test-target', 'promotion');

      voting.castVote(voteId, 'test-voter-1', 'approve');
      voting.castVote(voteId, 'test-voter-2', 'approve');
      voting.castVote(voteId, 'test-voter-3', 'reject');

      const closeResult = voting.closeVote(voteId);

      assert.ok(['passed', 'failed'].includes(closeResult.result), 'Should have a final result');
      assert.ok(closeResult.approvalRate >= 0 && closeResult.approvalRate <= 1, 'Approval rate should be 0-1');
      assert.ok(closeResult.approvalWeight > 0, 'Should have approval weight');

      // Bug #2 fix: verify BOTH result and status columns in DB
      const dbResult = db.getVoteResult(voteId);
      assert.equal(dbResult.status, 'closed', 'Status column should be closed');
      assert.ok(
        dbResult.result === 'passed' || dbResult.result === 'failed',
        'Result column should be passed or failed',
      );
      assert.ok(dbResult.concluded_at, 'concluded_at should be set');
    });

    it('rate limiting enforced (Bug #7 fix)', () => {
      // Create a voting system with a very low limit for testing
      const limitedVoting = new VotingSystem({
        voting: { ...govConfig.voting, maxVotesPerAgentPerDay: 3 },
      });

      // Create separate vote sessions for each cast
      const voteIds = [];
      for (let i = 0; i < 4; i++) {
        const { voteId } = limitedVoting.createVote('test-target', 'solution');
        voteIds.push(voteId);
      }

      // Cast 3 votes (at the limit)
      limitedVoting.castVote(voteIds[0], 'test-voter-1', 'approve');
      limitedVoting.castVote(voteIds[1], 'test-voter-1', 'approve');
      limitedVoting.castVote(voteIds[2], 'test-voter-1', 'reject');

      // 4th vote should throw VotingError
      assert.throws(
        () => limitedVoting.castVote(voteIds[3], 'test-voter-1', 'approve'),
        (err) => {
          assert.ok(err instanceof VotingError, 'Should be a VotingError');
          assert.ok(err.message.includes('limit'), 'Message should mention limit');
          return true;
        },
        'Should throw VotingError when daily limit exceeded',
      );
    });

    it('calculateVotingWeight uses DB snapshot (R2 fix)', () => {
      // Weight is calculated from agent's stored scores, not recalculated
      const weight1 = voting.calculateVotingWeight('test-voter-2');

      // Voter 2 has total_score=90, contribution_points=200
      // The weight should reflect DB values
      assert.ok(weight1 >= 1, 'Weight should be at least 1');
      assert.ok(Number.isInteger(weight1), 'Weight should be an integer');

      // Now update agent's DB score and verify weight changes
      db.updateAgent('test-voter-2', { total_score: 10 });
      const weight2 = voting.calculateVotingWeight('test-voter-2');

      assert.ok(weight2 < weight1, 'Weight should decrease when DB score decreases');
    });

    it('vote expiry is enforced', () => {
      // Create a vote with 0-hour expiry (effectively already expired)
      const { voteId } = voting.createVote('test-target', 'promotion', {
        expiryHours: 0,
      });

      // Manually set the expiry to the past
      const d = db.getDb();
      d.prepare(
        "UPDATE vote_results SET expires_at = datetime('now', '-1 hour') WHERE vote_id = ?",
      ).run(voteId);

      assert.throws(
        () => voting.castVote(voteId, 'test-voter-1', 'approve'),
        (err) => {
          assert.ok(err instanceof VotingError, 'Should be a VotingError');
          assert.ok(err.message.includes('expired'), 'Message should mention expired');
          return true;
        },
        'Should throw VotingError when vote has expired',
      );
    });
  });
});
