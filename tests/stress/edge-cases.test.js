/**
 * Edge-case and stress tests for Claw-Swarm v4.0
 *
 * Ported from Swarm Lite v3.0 edge-cases tests. Exercises validation
 * boundaries, error handling, empty/null inputs, very long strings,
 * unicode/emoji, concurrent lock acquire/release, DB operations with
 * closed database, and pheromone intensity edge cases.
 *
 * Uses :memory: DB, cleaned up in after().
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as db from '../../src/layer1-core/db.js';
import { CapabilityEngine } from '../../src/layer2-engines/governance/capability-engine.js';
import { ReputationLedger } from '../../src/layer2-engines/governance/reputation-ledger.js';
import { VotingSystem } from '../../src/layer2-engines/governance/voting-system.js';
import { EvaluationQueue } from '../../src/layer2-engines/governance/evaluation-queue.js';
import {
  GovernanceError,
  VotingError,
} from '../../src/layer1-core/errors.js';

// ---------------------------------------------------------------------------
// Governance config
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
    asyncQueue: { enabled: true, batchSize: 10, flushInterval: 60000 },
    precompute: { enabled: false },
  },
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Edge Cases and Stress Tests (v4.0)', () => {
  let engine;
  let ledger;
  let voting;
  let evalQueue;

  before(() => {
    db.initDb(':memory:');

    engine = new CapabilityEngine(govConfig);
    ledger = new ReputationLedger(govConfig);
    voting = new VotingSystem(govConfig);
    evalQueue = new EvaluationQueue(govConfig);

    engine.setLedger(ledger);
    engine.setEvaluationQueue(evalQueue);
  });

  after(() => {
    try { engine.shutdown(); } catch { /* ignore */ }
    try { evalQueue.shutdown(); } catch { /* ignore */ }
    db.closeDb();
  });

  // -----------------------------------------------------------------------
  // 1. Empty/null inputs to registerAgent
  // -----------------------------------------------------------------------

  it('registerAgent with missing id throws GovernanceError', () => {
    assert.throws(
      () => engine.registerAgent({ name: 'No ID Agent' }),
      (err) => {
        assert.ok(err instanceof GovernanceError, `Expected GovernanceError, got ${err.name}`);
        return true;
      },
    );
  });

  it('registerAgent with missing name throws GovernanceError', () => {
    assert.throws(
      () => engine.registerAgent({ id: `edge-no-name-${Date.now()}` }),
      (err) => {
        assert.ok(err instanceof GovernanceError, `Expected GovernanceError, got ${err.name}`);
        return true;
      },
    );
  });

  // -----------------------------------------------------------------------
  // 2. Very long string (10KB description) in agent name
  // -----------------------------------------------------------------------

  it('agent with very long name (10KB) is stored and retrieved correctly', () => {
    const longName = 'A'.repeat(10_240);
    const agentId = `edge-longname-${Date.now()}`;

    engine.registerAgent({ id: agentId, name: longName });

    const agent = db.getAgent(agentId);
    assert.ok(agent, 'Agent should be created');
    assert.equal(agent.name, longName, 'Long name should be preserved');
  });

  // -----------------------------------------------------------------------
  // 3. Unicode/emoji in agent names and descriptions
  // -----------------------------------------------------------------------

  it('unicode and emoji in agent names are handled correctly', () => {
    const emojiName = '\u{1F916} Robot Agent \u{1F680}\u{2728}';
    const unicodeName = '\u4E2D\u6587\u4EE3\u7406 \u65E5\u672C\u8A9E \uD55C\uAD6D\uC5B4';
    const agentId1 = `edge-emoji-${Date.now()}`;
    const agentId2 = `edge-unicode-${Date.now()}`;

    engine.registerAgent({ id: agentId1, name: emojiName });
    engine.registerAgent({ id: agentId2, name: unicodeName });

    const agent1 = db.getAgent(agentId1);
    const agent2 = db.getAgent(agentId2);

    assert.equal(agent1.name, emojiName, 'Emoji name should be preserved');
    assert.equal(agent2.name, unicodeName, 'Unicode name should be preserved');
  });

  // -----------------------------------------------------------------------
  // 4. Concurrent lock acquire/release
  // -----------------------------------------------------------------------

  it('lock acquire/release: second acquire on same resource returns false', () => {
    const resource = `edge-lock-${randomUUID()}`;
    const owner1 = `owner-1-${randomUUID()}`;
    const owner2 = `owner-2-${randomUUID()}`;

    // First acquire should succeed
    const acquired1 = db.acquireLock(resource, owner1, 60_000);
    assert.equal(acquired1, true, 'First lock acquire should succeed');

    // Second acquire on same resource by different owner should fail
    const acquired2 = db.acquireLock(resource, owner2, 60_000);
    assert.equal(acquired2, false, 'Second lock acquire should fail');

    // Verify the lock is held
    const isLocked = db.isLocked(resource);
    assert.equal(isLocked, true, 'Resource should be locked');

    // Release the lock
    const released = db.releaseLock(resource, owner1);
    assert.equal(released, true, 'Lock should be released');

    // After release, another owner can acquire
    const acquired3 = db.acquireLock(resource, owner2, 60_000);
    assert.equal(acquired3, true, 'Lock should be acquirable after release');

    // Clean up
    db.releaseLock(resource, owner2);
  });

  // -----------------------------------------------------------------------
  // 5. DB operations with closed database
  // -----------------------------------------------------------------------

  it('getDb throws after closeDb is called', () => {
    // Close the current DB
    db.closeDb();

    assert.throws(
      () => db.getDb(),
      (err) => {
        assert.ok(err.message.includes('not initialized'), 'Error should mention not initialized');
        return true;
      },
    );

    // Re-initialize for the remaining tests
    db.initDb(':memory:');
  });

  // -----------------------------------------------------------------------
  // 6. Pheromone operations with intensity edge cases (0, negative, >1)
  // -----------------------------------------------------------------------

  it('pheromone with zero intensity is stored and queryable', () => {
    const id = `phero-zero-${randomUUID()}`;
    db.insertPheromone({
      id,
      type: 'test-signal',
      sourceId: 'source-1',
      targetScope: 'scope-zero-test',
      intensity: 0,
      payload: { test: true },
      decayRate: 0.01,
    });

    // Query with minIntensity = 0 should find it
    const results = db.queryPheromones('scope-zero-test', 'test-signal', 0);
    const found = results.find(r => r.id === id);
    assert.ok(found, 'Pheromone with zero intensity should be found when minIntensity=0');
    assert.equal(found.intensity, 0, 'Intensity should be 0');
  });

  it('pheromone with negative intensity is stored correctly', () => {
    const id = `phero-neg-${randomUUID()}`;
    db.insertPheromone({
      id,
      type: 'test-signal',
      sourceId: 'source-neg',
      targetScope: 'scope-neg-test',
      intensity: -0.5,
      payload: null,
      decayRate: 0.01,
    });

    // Query with minIntensity 0 should NOT find negative intensity
    const results0 = db.queryPheromones('scope-neg-test', 'test-signal', 0);
    const found0 = results0.find(r => r.id === id);
    assert.equal(found0, undefined, 'Negative intensity pheromone should not match minIntensity=0');

    // Query with very low minIntensity should find it
    const resultsNeg = db.queryPheromones('scope-neg-test', 'test-signal', -1);
    const foundNeg = resultsNeg.find(r => r.id === id);
    assert.ok(foundNeg, 'Negative intensity pheromone should be found with minIntensity=-1');
    assert.equal(foundNeg.intensity, -0.5, 'Intensity should be -0.5');
  });

  it('pheromone with intensity > 1 is stored and reinforced correctly', () => {
    // Insert a pheromone with high intensity
    db.upsertPheromone({
      type: 'high-signal',
      sourceId: 'source-high',
      targetScope: 'scope-high-test',
      intensity: 5.0,
      payload: { level: 'high' },
      decayRate: 0.05,
    });

    // Reinforce it
    db.upsertPheromone({
      type: 'high-signal',
      sourceId: 'source-high',
      targetScope: 'scope-high-test',
      intensity: 3.0,
    });

    // Query and verify reinforcement (5.0 + 3.0 = 8.0)
    const results = db.queryPheromones('scope-high-test', 'high-signal', 0);
    assert.ok(results.length > 0, 'Should find the reinforced pheromone');
    assert.equal(results[0].intensity, 8.0, 'Intensity should be 8.0 after reinforcement');
  });

  // -----------------------------------------------------------------------
  // 7. Voting on non-existent vote session
  // -----------------------------------------------------------------------

  it('casting vote on non-existent session throws VotingError', () => {
    const voterId = `edge-voter-${Date.now()}`;
    db.createAgent(voterId, 'Edge Voter', 'general', 'trainee');

    assert.throws(
      () => voting.castVote('non-existent-vote-id', voterId, 'approve'),
      (err) => {
        assert.ok(err instanceof VotingError, `Expected VotingError, got ${err.name}`);
        assert.ok(err.message.includes('not found'), 'Error should mention not found');
        return true;
      },
    );
  });

  // -----------------------------------------------------------------------
  // 8. Duplicate vote in same session throws VotingError
  // -----------------------------------------------------------------------

  it('duplicate vote in same session throws VotingError', () => {
    const targetId = `edge-dup-target-${Date.now()}`;
    const voterId = `edge-dup-voter-${Date.now()}`;
    db.createAgent(targetId, 'Dup Target', 'general', 'trainee');
    db.createAgent(voterId, 'Dup Voter', 'general', 'trainee');

    const { voteId } = voting.createVote(targetId, 'admission');
    voting.castVote(voteId, voterId, 'approve');

    // Second vote from same voter in same session should throw
    assert.throws(
      () => voting.castVote(voteId, voterId, 'reject'),
      (err) => {
        assert.ok(err instanceof VotingError, `Expected VotingError, got ${err.name}`);
        assert.ok(err.message.includes('already voted'), 'Error should mention already voted');
        return true;
      },
    );
  });

  // -----------------------------------------------------------------------
  // 9. SQL injection attempt in agent creation
  // -----------------------------------------------------------------------

  it('SQL injection attempt in agent name is safely handled', () => {
    const maliciousName = "'; DROP TABLE agents; --";
    const agentId = `edge-sqli-${Date.now()}`;

    engine.registerAgent({ id: agentId, name: maliciousName });

    // Verify the agent was stored with the verbatim name
    const agent = db.getAgent(agentId);
    assert.ok(agent, 'Agent should exist after SQL injection attempt');
    assert.equal(agent.name, maliciousName, 'Malicious name should be stored verbatim');

    // Verify the agents table still works
    const allAgents = db.listAgents();
    assert.ok(allAgents.length > 0, 'Agents table should still function');
  });

  // -----------------------------------------------------------------------
  // 10. Historical bonus with no qualifying contributions returns 0
  // -----------------------------------------------------------------------

  it('historical bonus with fewer than 5 qualifying contributions returns 0', () => {
    const agentId = `edge-hist-${Date.now()}`;
    engine.registerAgent({ id: agentId, name: 'Hist Edge Agent' });

    // Create only 3 contributions (below the 5 threshold)
    for (let i = 0; i < 3; i++) {
      db.createContribution(agentId, `task-hist-${i}`, 10, 'development', 0.8, null, null);
    }

    const bonus = engine.calculateHistoricalBonus(agentId);
    assert.equal(bonus, 0, 'Bonus should be 0 with fewer than 5 qualifying contributions');
  });
});
