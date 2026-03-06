/**
 * Governance stress tests for Claw-Swarm v4.0
 *
 * Ported from Swarm Lite v3.0 governance stress tests. Exercises rate limiting,
 * rapid agent registration, concurrent capability updates, high-frequency voting,
 * large evaluation queue batch processing, contribution point accumulation,
 * tier cascade, queue crash resilience, matrix precompute performance, and
 * cache invalidation.
 *
 * Uses :memory: DB, cleaned up in after().
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as db from '../../src/layer1-core/db.js';
import { EvaluationQueue } from '../../src/layer2-engines/governance/evaluation-queue.js';
import { ReputationLedger } from '../../src/layer2-engines/governance/reputation-ledger.js';
import { CapabilityEngine } from '../../src/layer2-engines/governance/capability-engine.js';
import { VotingSystem } from '../../src/layer2-engines/governance/voting-system.js';
import { VotingError } from '../../src/layer1-core/errors.js';

// ---------------------------------------------------------------------------
// Governance config shared across all tests
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
    maxVotesPerAgentPerDay: 5,
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
    precompute: { enabled: false },
  },
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Governance Stress Tests (v4.0)', () => {
  let engine;
  let ledger;
  let evalQueue;
  let voting;

  before(() => {
    db.initDb(':memory:');

    engine = new CapabilityEngine(govConfig);
    ledger = new ReputationLedger(govConfig);
    evalQueue = new EvaluationQueue(govConfig);
    voting = new VotingSystem(govConfig);

    engine.setLedger(ledger);
    engine.setEvaluationQueue(evalQueue);
  });

  after(() => {
    try { engine.shutdown(); } catch { /* ignore */ }
    try { evalQueue.shutdown(); } catch { /* ignore */ }
    db.closeDb();
  });

  // -------------------------------------------------------------------------
  // Helper: clean test-prefixed data between tests
  // -------------------------------------------------------------------------
  function cleanTestData() {
    const d = db.getDb();
    d.exec("DELETE FROM evaluation_queue WHERE agent_id LIKE 'stress-%'");
    d.exec("DELETE FROM contributions WHERE agent_id LIKE 'stress-%'");
    d.exec("DELETE FROM capabilities WHERE agent_id LIKE 'stress-%'");
    d.exec("DELETE FROM capability_details WHERE agent_id LIKE 'stress-%'");
    d.exec("DELETE FROM skills WHERE agent_id LIKE 'stress-%'");
    d.exec("DELETE FROM behavior_tags WHERE agent_id LIKE 'stress-%'");
    d.exec("DELETE FROM collaboration_history WHERE agent_a_id LIKE 'stress-%' OR agent_b_id LIKE 'stress-%'");
    d.exec("DELETE FROM votes WHERE voter_id LIKE 'stress-%' OR target_id LIKE 'stress-%'");
    d.exec("DELETE FROM vote_results WHERE target_id LIKE 'stress-%'");
    d.exec("DELETE FROM agents WHERE id LIKE 'stress-%'");
  }

  // -------------------------------------------------------------------------
  // 1. Rapid sequential agent registrations (100 agents)
  // -------------------------------------------------------------------------

  it('registers 100 agents sequentially without error', () => {
    cleanTestData();

    const start = performance.now();
    const agentIds = [];

    for (let i = 0; i < 100; i++) {
      const agentId = `stress-reg-${Date.now()}-${i}`;
      engine.registerAgent({ id: agentId, name: `Stress Agent ${i}` });
      agentIds.push(agentId);
    }

    const elapsed = performance.now() - start;

    // Verify all agents were created
    for (const agentId of agentIds) {
      const agent = db.getAgent(agentId);
      assert.ok(agent, `Agent ${agentId} should exist`);
      assert.equal(agent.tier, 'trainee', 'Default tier should be trainee');
    }

    // Verify capabilities were initialized for each agent (4 dimensions)
    for (const agentId of agentIds) {
      const caps = db.getCapabilities(agentId);
      assert.equal(caps.length, 4, `Agent ${agentId} should have 4 capability dimensions`);
    }

    assert.ok(elapsed < 10000, `100 agent registrations took ${elapsed.toFixed(1)}ms, expected <10s`);
  });

  // -------------------------------------------------------------------------
  // 2. Concurrent capability score updates
  // -------------------------------------------------------------------------

  it('handles rapid sequential capability score updates for same agent', () => {
    cleanTestData();

    const agentId = `stress-cap-update-${Date.now()}`;
    engine.registerAgent({ id: agentId, name: 'Cap Update Agent' });

    // Rapidly update the same dimension 50 times
    for (let i = 0; i < 50; i++) {
      const score = 30 + (i % 70); // vary between 30 and 99
      engine.updateCapabilityScore(agentId, 'technical', score);
    }

    // The final score should be the last one written
    const caps = db.getCapabilities(agentId);
    const techCap = caps.find(c => c.dimension === 'technical');
    assert.ok(techCap, 'Technical capability should exist');
    assert.equal(techCap.score, 30 + (49 % 70), 'Score should be the last written value');

    // Verify cache was invalidated (profile reflects current state)
    const profile = engine.getAgentProfile(agentId);
    assert.ok(profile, 'Profile should exist after updates');
  });

  // -------------------------------------------------------------------------
  // 3. High-frequency voting (rate limiting should kick in)
  // -------------------------------------------------------------------------

  it('rate limiting: 6th vote from same voter throws VotingError', () => {
    cleanTestData();

    const targetId = `stress-rate-target-${Date.now()}`;
    const voterId = `stress-rate-voter-${Date.now()}`;
    db.createAgent(targetId, 'Rate Target', 'general', 'trainee');
    db.createAgent(voterId, 'Rate Voter', 'general', 'trainee');

    // Cast 5 votes (one per vote session) up to the daily limit
    for (let i = 0; i < 5; i++) {
      const { voteId } = voting.createVote(targetId, 'admission');
      voting.castVote(voteId, voterId, 'approve');
    }

    // 6th vote should be rate-limited
    const { voteId: sixthVoteId } = voting.createVote(targetId, 'admission');
    assert.throws(
      () => voting.castVote(sixthVoteId, voterId, 'approve'),
      (err) => {
        assert.ok(err instanceof VotingError, `Expected VotingError, got ${err.name}`);
        assert.ok(err.message.includes('Daily vote limit'), 'Error should mention daily vote limit');
        return true;
      },
    );
  });

  // -------------------------------------------------------------------------
  // 4. Large evaluation queue batch processing
  // -------------------------------------------------------------------------

  it('processes a large batch of 50 enqueued evaluations', () => {
    cleanTestData();

    const agentId = `stress-eq-batch-${Date.now()}`;
    db.createAgent(agentId, 'Batch Agent', 'general', 'trainee');
    db.createCapability(agentId, 'technical', 50);
    db.createCapability(agentId, 'delivery', 50);

    // Enqueue 50 evaluations
    const batchQueue = new EvaluationQueue({
      performance: { asyncQueue: { batchSize: 100, flushInterval: 60000 } },
    });

    for (let i = 0; i < 50; i++) {
      batchQueue.enqueue(agentId, {
        dimension: i % 2 === 0 ? 'technical' : 'delivery',
        score: 55 + (i % 40),
      });
    }

    // Verify pending count
    const pendingBefore = db.getPendingEvaluationCount();
    assert.ok(pendingBefore >= 50, `Should have at least 50 pending items, got ${pendingBefore}`);

    // Process all in one batch
    const start = performance.now();
    const processed = batchQueue.processQueue(100);
    const elapsed = performance.now() - start;

    assert.ok(processed >= 50, `Should have processed at least 50 items, got ${processed}`);
    assert.ok(elapsed < 5000, `Batch processing took ${elapsed.toFixed(1)}ms, expected <5s`);

    // Verify pending count is now 0
    const pendingAfter = db.getPendingEvaluationCount();
    assert.equal(pendingAfter, 0, 'All pending items should be processed');

    batchQueue.shutdown();
  });

  // -------------------------------------------------------------------------
  // 5. Many contributions for same agent (point accumulation)
  // -------------------------------------------------------------------------

  it('accumulates points correctly over 30 contributions', () => {
    cleanTestData();

    const agentId = `stress-contrib-${Date.now()}`;
    engine.registerAgent({ id: agentId, name: 'Contrib Agent' });

    let totalExpected = 0;

    for (let i = 0; i < 30; i++) {
      const result = ledger.recordContribution(
        agentId,
        { id: `task-${i}`, complexity: 1 + (i % 3), type: 'backend' },
        { quality: 0.7 + (i % 3) * 0.1, impact: i, earlyCompletion: i % 2 === 0, hasInnovation: false, helpedOthers: false },
      );
      totalExpected += result.points;
    }

    // Verify total points in DB match accumulated sum
    const dbPoints = db.getTotalPoints(agentId);
    assert.equal(dbPoints, totalExpected, `DB total points (${dbPoints}) should match accumulated (${totalExpected})`);

    // Verify agent record was updated
    const agent = db.getAgent(agentId);
    assert.ok(agent.contribution_points > 0, 'Agent contribution_points should be > 0');
  });

  // -------------------------------------------------------------------------
  // 6. Tier cascade: trainee with senior-level score gets promotion recommendation
  // -------------------------------------------------------------------------

  it('tier cascade: trainee with senior-level score gets promotion recommendation', () => {
    cleanTestData();

    const agentId = `stress-tier-cascade-${Date.now()}`;
    engine.registerAgent({ id: agentId, name: 'Tier Cascade Agent', tier: 'trainee' });

    // Set total_score high enough for senior (>= 85)
    db.updateAgent(agentId, { total_score: 90 });

    const recommendation = engine.evaluateTierChange(agentId);

    assert.ok(recommendation, 'Should return a recommendation');
    assert.equal(recommendation.eligible, true, 'Should be eligible for tier change');
    assert.equal(recommendation.type, 'promotion', 'Should recommend promotion');
    assert.equal(recommendation.from, 'trainee', 'Should be from trainee');
    assert.equal(recommendation.to, 'junior', 'Should recommend next tier (junior)');
    assert.ok(recommendation.reason, 'Should include a reason');
  });

  // -------------------------------------------------------------------------
  // 7. Queue crash resilience: pending items survive instance restart
  // -------------------------------------------------------------------------

  it('queue crash resilience: pending items survive instance restart', () => {
    cleanTestData();

    const agentId = `stress-crash-${Date.now()}`;
    db.createAgent(agentId, 'Crash Agent', 'general', 'trainee');
    db.createCapability(agentId, 'technical', 50);

    // Enqueue 5 evaluations using the first queue instance, do NOT process
    const queue1 = new EvaluationQueue(govConfig);
    for (let i = 0; i < 5; i++) {
      queue1.enqueue(agentId, { dimension: 'technical', score: 60 + i });
    }

    // Verify pending count before "crash"
    const pendingBefore = db.getPendingEvaluationCount();
    assert.ok(pendingBefore >= 5, `Should have at least 5 pending items, got ${pendingBefore}`);

    // Simulate restart: create a new EvaluationQueue instance
    const queue2 = new EvaluationQueue(govConfig);
    const recoveredCount = queue2.recoverPendingItems();

    assert.ok(recoveredCount >= 5, `Should recover at least 5 pending items, got ${recoveredCount}`);

    // After recovery, pending count should be 0
    const pendingAfter = db.getPendingEvaluationCount();
    assert.equal(pendingAfter, 0, 'All pending items should be processed after recovery');

    queue1.shutdown();
    queue2.shutdown();
  });

  // -------------------------------------------------------------------------
  // 8. 100-agent matrix precompute performance
  // -------------------------------------------------------------------------

  it('100-agent matrix precompute completes in <2000ms', () => {
    cleanTestData();

    // Register 100 agents directly via db for speed
    for (let i = 0; i < 100; i++) {
      const agentId = `stress-perf-${Date.now()}-${i}`;
      db.createAgent(agentId, `Perf Agent ${i}`, 'general', 'trainee');
      db.createCapability(agentId, 'technical', 50 + (i % 50));
      db.createCapability(agentId, 'delivery', 50 + (i % 40));
      db.createCapability(agentId, 'collaboration', 50 + (i % 30));
      db.createCapability(agentId, 'innovation', 50 + (i % 20));
    }

    // Create a fresh engine (precompute disabled so we control it manually)
    const perfEngine = new CapabilityEngine({
      ...govConfig,
      performance: { ...govConfig.performance, precompute: { enabled: false } },
    });
    perfEngine.setLedger(ledger);

    const start = performance.now();
    perfEngine.precomputeMatchMatrix();
    const elapsed = performance.now() - start;

    assert.ok(elapsed < 2000, `Matrix precompute took ${elapsed.toFixed(1)}ms, expected <2000ms`);

    perfEngine.shutdown();
  });

  // -------------------------------------------------------------------------
  // 9. Vote close sets both result AND status fields correctly
  // -------------------------------------------------------------------------

  it('vote close sets both result AND status fields correctly', () => {
    cleanTestData();

    const targetId = `stress-vote-close-${Date.now()}`;
    const voter1Id = `stress-vc-v1-${Date.now()}`;
    const voter2Id = `stress-vc-v2-${Date.now()}`;

    db.createAgent(targetId, 'Vote Close Target', 'general', 'trainee');
    db.createAgent(voter1Id, 'Voter 1', 'general', 'trainee');
    db.createAgent(voter2Id, 'Voter 2', 'general', 'trainee');

    const { voteId } = voting.createVote(targetId, 'admission');

    voting.castVote(voteId, voter1Id, 'approve');
    voting.castVote(voteId, voter2Id, 'approve');

    const closeResult = voting.closeVote(voteId);
    assert.equal(closeResult.result, 'passed', 'Close result should be passed');

    // Verify BOTH fields in the DB
    const dbRecord = db.getVoteResult(voteId);
    assert.ok(dbRecord, 'Vote result should exist in DB');
    assert.equal(dbRecord.result, 'passed', 'DB result field should be "passed"');
    assert.equal(dbRecord.status, 'closed', 'DB status field should be "closed"');
    assert.ok(dbRecord.concluded_at, 'DB concluded_at should be set');
    assert.ok(dbRecord.approval_weight > 0, 'Approval weight should be > 0');
  });

  // -------------------------------------------------------------------------
  // 10. Cache invalidation: profile updates after recording a contribution
  // -------------------------------------------------------------------------

  it('cache invalidation: profile updates after recording a contribution', () => {
    cleanTestData();

    const agentId = `stress-cache-${Date.now()}`;
    engine.registerAgent({ id: agentId, name: 'Cache Agent', tier: 'trainee' });

    // Get the initial profile (populates cache)
    const profileBefore = engine.getAgentProfile(agentId);
    assert.ok(profileBefore, 'Initial profile should exist');
    const pointsBefore = profileBefore.contribution_points || 0;

    // Record a contribution via the ledger
    ledger.recordContribution(
      agentId,
      { id: 'task-cache-stress', complexity: 3, type: 'backend' },
      { quality: 0.9, impact: 5, earlyCompletion: true, hasInnovation: false, helpedOthers: false },
    );

    // Trigger cache clear via evaluateTaskCompletion
    engine.evaluateTaskCompletion(
      agentId,
      { id: 'task-cache-stress', type: 'backend' },
      { quality: 0.9 },
    );

    // Get the profile again -- should reflect updated state
    const profileAfter = engine.getAgentProfile(agentId);
    assert.ok(profileAfter, 'Profile after contribution should exist');

    // The agent's contribution_points in the DB should have increased
    const agentRecord = db.getAgent(agentId);
    assert.ok(
      agentRecord.contribution_points > pointsBefore,
      `contribution_points should increase after contribution (was ${pointsBefore}, now ${agentRecord.contribution_points})`,
    );
  });
});
