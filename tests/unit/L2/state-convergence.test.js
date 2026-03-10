/**
 * StateConvergence 单元测试 / StateConvergence Unit Tests
 *
 * SWIM fault detection, anti-entropy scan, convergence metrics.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StateConvergence } from '../../../src/L2-communication/state-convergence.js';

// ━━━ Helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function createMockBus() {
  const _subs = {};
  return {
    publish(topic, data) { if (_subs[topic]) for (const cb of _subs[topic]) cb(data); },
    subscribe(topic, cb) { if (!_subs[topic]) _subs[topic] = []; _subs[topic].push(cb); },
    _subs,
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

// ━━━ Tests ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('StateConvergence', () => {
  let sc;
  let bus;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = createMockBus();
    sc = new StateConvergence({ messageBus: bus, logger });
  });

  afterEach(() => {
    sc.dispose();
    vi.useRealTimers();
  });

  // ━━━ Constructor ━━━

  describe('constructor', () => {
    it('creates with default state', () => {
      expect(sc._agents.size).toBe(0);
      expect(sc._started).toBe(false);
      expect(sc._metrics.driftCount).toBe(0);
    });
  });

  // ━━━ recordHeartbeat ━━━

  describe('recordHeartbeat', () => {
    it('registers new agent as ALIVE', () => {
      sc.recordHeartbeat('agent-1');
      const info = sc.getAgentState('agent-1');
      expect(info).not.toBeNull();
      expect(info.state).toBe('alive');
      expect(info.suspectSince).toBeNull();
    });

    it('updates lastSeen for existing agent', () => {
      sc.recordHeartbeat('agent-1');
      const first = sc.getAgentState('agent-1').lastSeen;

      vi.advanceTimersByTime(1000);
      sc.recordHeartbeat('agent-1');
      const second = sc.getAgentState('agent-1').lastSeen;

      expect(second).toBeGreaterThan(first);
    });

    it('revives suspect agent back to ALIVE', () => {
      sc.recordHeartbeat('agent-1');
      // Force agent into suspect state
      const entry = sc._agents.get('agent-1');
      entry.state = 'suspect';
      entry.suspectSince = Date.now() - 5000;

      sc.recordHeartbeat('agent-1');
      const info = sc.getAgentState('agent-1');
      expect(info.state).toBe('alive');
      expect(info.suspectSince).toBeNull();
    });
  });

  // ━━━ _probeHeartbeats ━━━

  describe('_probeHeartbeats', () => {
    it('transitions alive → suspect after suspect timeout', () => {
      sc.recordHeartbeat('agent-1');
      // Move time past suspect timeout (default 15 000 ms)
      vi.advanceTimersByTime(16000);
      sc._probeHeartbeats();

      expect(sc.getAgentState('agent-1').state).toBe('suspect');
    });

    it('transitions suspect → dead after confirm timeout', () => {
      sc.recordHeartbeat('agent-1');
      // Move past suspect timeout
      vi.advanceTimersByTime(16000);
      sc._probeHeartbeats();
      expect(sc.getAgentState('agent-1').state).toBe('suspect');

      // Move past confirm dead timeout (default 30 000 ms)
      vi.advanceTimersByTime(31000);
      sc._probeHeartbeats();
      expect(sc.getAgentState('agent-1').state).toBe('dead');
    });
  });

  // ━━━ getSuspects / getDeadAgents ━━━

  describe('getSuspects', () => {
    it('returns only suspect agents', () => {
      sc.recordHeartbeat('a1');
      sc.recordHeartbeat('a2');
      sc.recordHeartbeat('a3');

      sc._agents.get('a2').state = 'suspect';
      sc._agents.get('a2').suspectSince = Date.now();

      const suspects = sc.getSuspects();
      expect(suspects).toEqual(['a2']);
    });
  });

  describe('getDeadAgents', () => {
    it('returns only dead agents', () => {
      sc.recordHeartbeat('a1');
      sc.recordHeartbeat('a2');
      sc._agents.get('a1').state = 'dead';

      const dead = sc.getDeadAgents();
      expect(dead).toEqual(['a1']);
      expect(dead).not.toContain('a2');
    });
  });

  // ━━━ runAntiEntropy ━━━

  describe('runAntiEntropy', () => {
    it('counts dead agents as drifts', () => {
      sc.recordHeartbeat('a1');
      sc.recordHeartbeat('a2');
      sc._agents.get('a1').state = 'dead';
      sc._agents.get('a2').state = 'dead';

      const result = sc.runAntiEntropy();
      expect(result.drifts).toBe(2);
      expect(sc._metrics.driftCount).toBe(2);
    });
  });

  // ━━━ getConvergenceStats ━━━

  describe('getConvergenceStats', () => {
    it('returns correct structure', () => {
      sc.recordHeartbeat('a1');
      sc.recordHeartbeat('a2');
      sc._agents.get('a2').state = 'suspect';

      const stats = sc.getConvergenceStats();
      expect(stats).toMatchObject({
        totalAgents: 2,
        aliveAgents: 1,
        suspectAgents: 1,
        deadAgents: 0,
        driftCount: 0,
        repairCount: 0,
        repairSuccessRate: 1,
        started: false,
      });
      expect(stats).toHaveProperty('avgConvergenceTimeMs');
      expect(stats).toHaveProperty('measurementCount');
    });
  });

  // ━━━ startHeartbeat / dispose ━━━

  describe('startHeartbeat / dispose', () => {
    it('starts timers and dispose cleans them up', () => {
      sc.startHeartbeat(1000);
      expect(sc._started).toBe(true);
      expect(sc._heartbeatTimer).not.toBeNull();
      expect(sc._antiEntropyTimer).not.toBeNull();

      sc.dispose();
      expect(sc._started).toBe(false);
      expect(sc._heartbeatTimer).toBeNull();
      expect(sc._antiEntropyTimer).toBeNull();
      expect(sc._agents.size).toBe(0);
    });
  });

  // ━━━ Event publishing ━━━

  describe('event publishing', () => {
    it('publishes agent.suspect when agent times out', () => {
      const events = [];
      bus.subscribe('agent.suspect', (e) => events.push(e));

      sc.recordHeartbeat('agent-x');
      vi.advanceTimersByTime(16000);
      sc._probeHeartbeats();

      expect(events.length).toBe(1);
      expect(events[0].agentId).toBe('agent-x');
      expect(events[0]).toHaveProperty('elapsedMs');
    });

    it('publishes agent.confirmed.dead after confirm timeout', () => {
      const events = [];
      bus.subscribe('agent.confirmed.dead', (e) => events.push(e));

      sc.recordHeartbeat('agent-x');
      vi.advanceTimersByTime(16000);
      sc._probeHeartbeats(); // alive → suspect

      vi.advanceTimersByTime(31000);
      sc._probeHeartbeats(); // suspect → dead

      expect(events.length).toBe(1);
      expect(events[0].agentId).toBe('agent-x');
      expect(events[0]).toHaveProperty('totalDownMs');
    });
  });
});
