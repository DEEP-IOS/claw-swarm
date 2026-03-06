/**
 * Unit tests for AgentRegistry (ported from Swarm Lite v3.0)
 *
 * Tests the facade API for agent lifecycle management: registration,
 * profile retrieval, availability queries, tier filtering, skill
 * certification, and deactivation.
 *
 * Uses node:test + node:assert/strict (no external libraries).
 * Each run creates a fresh SQLite DB in :memory:, cleaned up in after().
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../src/layer1-core/db.js';
import { AgentRegistry } from '../../src/layer2-engines/governance/agent-registry.js';
import { CapabilityEngine } from '../../src/layer2-engines/governance/capability-engine.js';
import { ReputationLedger } from '../../src/layer2-engines/governance/reputation-ledger.js';
import { EvaluationQueue } from '../../src/layer2-engines/governance/evaluation-queue.js';
import { GovernanceError } from '../../src/layer1-core/errors.js';

describe('AgentRegistry', () => {
  let registry, engine, ledger, evalQueue;

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
    voting: { promotionThreshold: 0.6, admissionThreshold: 0.5, voteExpiryHours: 24, maxVotesPerAgentPerDay: 20 },
    allocation: { skillWeight: 0.4, historyWeight: 0.3, loadWeight: 0.2, collaborationWeight: 0.1 },
    contribution: { baseMultiplier: 10, timeBonus: 1.2, innovationBonus: 1.3, collaborationBonus: 1.1 },
    performance: {
      cache: { enabled: true, ttl: 300000 },
      asyncQueue: { enabled: true, batchSize: 10, flushInterval: 5000 },
      precompute: { enabled: false, updateInterval: 3600000 },
    },
    autoEvaluation: { enabled: false, interval: 86400000 },
  };

  /** Counter to generate unique agent IDs per test run. */
  let idCounter = 0;
  function uniqueId(prefix = 'test-agent') {
    return `test-${prefix}-${Date.now()}-${++idCounter}`;
  }

  before(() => {
    db.initDb(':memory:');
    evalQueue = new EvaluationQueue(govConfig);
    ledger = new ReputationLedger(govConfig);
    engine = new CapabilityEngine(govConfig);
    engine.setLedger(ledger);
    engine.setEvaluationQueue(evalQueue);
    registry = new AgentRegistry(engine, ledger, govConfig);
  });

  after(() => {
    evalQueue.shutdown();
    db.closeDb();
  });

  // -------------------------------------------------------------------------
  // register()
  // -------------------------------------------------------------------------

  describe('register()', () => {
    it('creates an agent successfully', () => {
      const id = uniqueId('reg');
      const result = registry.register({ id, name: 'Agent Alpha' });

      assert.ok(result, 'register should return the agent profile');
      assert.equal(result.id, id);
      assert.equal(result.name, 'Agent Alpha');
      assert.equal(result.role, 'general');
      assert.equal(result.tier, 'trainee');
      assert.equal(result.status, 'active');
    });

    it('throws GovernanceError for duplicate agent', () => {
      const id = uniqueId('dup');
      registry.register({ id, name: 'First Agent' });

      assert.throws(
        () => registry.register({ id, name: 'Duplicate Agent' }),
        (err) => {
          assert.ok(err instanceof GovernanceError, 'should be GovernanceError');
          // GovernanceError hardcodes code='GOVERNANCE_ERROR' in constructor
          assert.equal(err.code, 'GOVERNANCE_ERROR');
          assert.ok(err.message.includes('already registered'));
          return true;
        },
      );
    });

    it('throws GovernanceError when missing id', () => {
      assert.throws(
        () => registry.register({ name: 'No ID Agent' }),
        (err) => {
          assert.ok(err instanceof GovernanceError, 'should be GovernanceError');
          assert.equal(err.code, 'GOVERNANCE_ERROR');
          assert.ok(err.message.includes('requires id and name'));
          return true;
        },
      );
    });

    it('throws GovernanceError when missing name', () => {
      assert.throws(
        () => registry.register({ id: uniqueId('noname') }),
        (err) => {
          assert.ok(err instanceof GovernanceError, 'should be GovernanceError');
          assert.equal(err.code, 'GOVERNANCE_ERROR');
          assert.ok(err.message.includes('requires id and name'));
          return true;
        },
      );
    });
  });

  // -------------------------------------------------------------------------
  // getProfile()
  // -------------------------------------------------------------------------

  describe('getProfile()', () => {
    it('returns agent profile with capabilities', () => {
      const id = uniqueId('profile');
      registry.register({ id, name: 'Profile Agent' });

      const profile = registry.getProfile(id);

      assert.ok(profile, 'profile should not be null');
      assert.equal(profile.id, id);
      assert.equal(profile.name, 'Profile Agent');
      assert.ok(Array.isArray(profile.capabilities), 'profile should include capabilities array');
      assert.ok(profile.capabilities.length > 0, 'capabilities should be initialized');

      // Verify all four dimensions are present
      const dims = profile.capabilities.map(c => c.dimension).sort();
      assert.deepEqual(dims, ['collaboration', 'delivery', 'innovation', 'technical']);

      assert.ok(Array.isArray(profile.skills), 'profile should include skills array');
      assert.ok(Array.isArray(profile.tags), 'profile should include tags array');
    });

    it('returns null for non-existent agent', () => {
      const profile = registry.getProfile('test-nonexistent-agent-xyz');
      assert.equal(profile, null);
    });
  });

  // -------------------------------------------------------------------------
  // getAvailableAgents()
  // -------------------------------------------------------------------------

  describe('getAvailableAgents()', () => {
    it('returns only active agents', () => {
      const activeId = uniqueId('active');
      const inactiveId = uniqueId('inactive');

      registry.register({ id: activeId, name: 'Active Agent' });
      registry.register({ id: inactiveId, name: 'Inactive Agent' });
      registry.deactivate(inactiveId);

      const available = registry.getAvailableAgents();
      const ids = available.map(a => a.id);

      assert.ok(ids.includes(activeId), 'active agent should be in the list');
      assert.ok(!ids.includes(inactiveId), 'inactive agent should not be in the list');
    });
  });

  // -------------------------------------------------------------------------
  // getAgentsByTier()
  // -------------------------------------------------------------------------

  describe('getAgentsByTier()', () => {
    it('filters agents correctly by tier', () => {
      const traineeId = uniqueId('trainee');
      const juniorId = uniqueId('junior');

      registry.register({ id: traineeId, name: 'Trainee Agent', tier: 'trainee' });
      registry.register({ id: juniorId, name: 'Junior Agent', tier: 'junior' });

      const trainees = registry.getAgentsByTier('trainee');
      const juniors = registry.getAgentsByTier('junior');

      const traineeIds = trainees.map(a => a.id);
      const juniorIds = juniors.map(a => a.id);

      assert.ok(traineeIds.includes(traineeId), 'trainee should appear in trainee tier');
      assert.ok(!traineeIds.includes(juniorId), 'junior should not appear in trainee tier');
      assert.ok(juniorIds.includes(juniorId), 'junior should appear in junior tier');
      assert.ok(!juniorIds.includes(traineeId), 'trainee should not appear in junior tier');
    });
  });

  // -------------------------------------------------------------------------
  // certifySkill()
  // -------------------------------------------------------------------------

  describe('certifySkill()', () => {
    it('adds skill to agent', () => {
      const id = uniqueId('skill');
      registry.register({ id, name: 'Skill Agent' });

      registry.certifySkill(id, 'javascript', 'advanced', 'Passed assessment');

      const skills = registry.getSkills(id);
      const jsSkill = skills.find(s => s.skill_name === 'javascript');

      assert.ok(jsSkill, 'javascript skill should exist');
      assert.equal(jsSkill.level, 'advanced');
      assert.equal(jsSkill.evidence, 'Passed assessment');
    });
  });

  // -------------------------------------------------------------------------
  // deactivate()
  // -------------------------------------------------------------------------

  describe('deactivate()', () => {
    it('sets agent status to inactive', () => {
      const id = uniqueId('deactivate');
      registry.register({ id, name: 'Deactivate Agent' });

      // Verify initially active
      const beforeProfile = registry.getProfile(id);
      assert.equal(beforeProfile.status, 'active');

      registry.deactivate(id);

      // Clear cache so we get fresh data
      engine.clearCache(id);
      const afterProfile = registry.getProfile(id);
      assert.equal(afterProfile.status, 'inactive');
    });
  });
});
