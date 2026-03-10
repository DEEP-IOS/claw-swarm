import { describe, it, expect, beforeEach } from 'vitest';
import { GovernanceMetrics } from '../../../src/L4-orchestration/governance-metrics.js';

function createMockBus() {
  const _subs = {};
  const events = [];
  return {
    publish(topic, data) { events.push({ topic, data }); if (_subs[topic]) for (const cb of _subs[topic]) cb(data); },
    subscribe(topic, cb) { if (!_subs[topic]) _subs[topic] = []; _subs[topic].push(cb); },
    events,
  };
}
const logger = { info() {}, warn() {}, error() {}, debug() {} };

describe('GovernanceMetrics', () => {
  let bus, gm;

  beforeEach(() => {
    bus = createMockBus();
    gm = new GovernanceMetrics({ messageBus: bus, logger });
  });

  // --- computeAuditScore ---
  describe('computeAuditScore', () => {
    it('returns 1.0 when no decisions recorded', () => {
      expect(gm.computeAuditScore()).toBe(1.0);
    });

    it('returns correct ratio of decisions with results', () => {
      gm._recordDecision('advisory', { turnId: 't1' });
      gm._recordDecision('advisory', { turnId: 't2' });
      gm._recordCollabResult({ turnId: 't1', swarmUsed: true, success: true, cost: 1 });
      expect(gm.computeAuditScore()).toBe(0.5);
    });
  });

  // --- computePolicyCompliance ---
  describe('computePolicyCompliance', () => {
    it('returns 1.0 when no globalModulator', () => {
      expect(gm.computePolicyCompliance()).toBe(1.0);
    });

    it('returns stability-based score when globalModulator provided', () => {
      const modulator = { getStats: () => ({ switchStability: 3 }) };
      const gm2 = new GovernanceMetrics({ messageBus: bus, globalModulator: modulator, logger });
      // MIN_EXPECTED_STABILITY = 5, so score = min(3/5, 1.0) = 0.6
      expect(gm2.computePolicyCompliance()).toBe(0.6);
    });
  });

  // --- computeROI ---
  describe('computeROI', () => {
    it('returns zeros when no collaboration results', () => {
      const roi = gm.computeROI();
      expect(roi).toEqual({ roi: 0, swarmSuccessRate: 0, soloSuccessRate: 0, avgCost: 0 });
    });

    it('calculates correct swarm vs solo success rates', () => {
      gm._recordCollabResult({ turnId: 't1', swarmUsed: true, success: true, cost: 2 });
      gm._recordCollabResult({ turnId: 't2', swarmUsed: true, success: false, cost: 2 });
      gm._recordCollabResult({ turnId: 't3', swarmUsed: false, success: true, cost: 0 });
      const roi = gm.computeROI();
      expect(roi.swarmSuccessRate).toBe(0.5);
      expect(roi.soloSuccessRate).toBe(1.0);
    });

    it('computes ROI = (swarmSuccessRate - soloSuccessRate) / avgCost', () => {
      gm._recordCollabResult({ turnId: 't1', swarmUsed: true, success: true, cost: 4 });
      gm._recordCollabResult({ turnId: 't2', swarmUsed: true, success: true, cost: 6 });
      gm._recordCollabResult({ turnId: 't3', swarmUsed: false, success: false, cost: 0 });
      const roi = gm.computeROI();
      // swarmRate=1.0, soloRate=0, avgCost=5 => roi = 1.0/5 = 0.2
      expect(roi.roi).toBe(0.2);
      expect(roi.avgCost).toBe(5);
    });
  });

  // --- getGovernanceSummary ---
  describe('getGovernanceSummary', () => {
    it('returns object with audit, policy, roi, totalCollabResults', () => {
      const summary = gm.getGovernanceSummary();
      expect(summary).toHaveProperty('audit');
      expect(summary).toHaveProperty('policy');
      expect(summary).toHaveProperty('roi');
      expect(summary).toHaveProperty('totalCollabResults');
      expect(summary.audit.score).toBe(1.0);
      expect(summary.totalCollabResults).toBe(0);
    });
  });

  // --- maybePublishReport ---
  describe('maybePublishReport', () => {
    it('publishes after REPORT_INTERVAL_TURNS (20) turns', () => {
      for (let i = 1; i < 20; i++) gm.maybePublishReport(i);
      const before = bus.events.filter(e => e.topic === 'governance.report').length;
      expect(before).toBe(0);

      gm.maybePublishReport(20);
      const after = bus.events.filter(e => e.topic === 'governance.report');
      expect(after.length).toBe(1);
      expect(after[0].data.turn).toBe(20);
    });
  });

  // --- _recordDecision ---
  describe('_recordDecision', () => {
    it('buffers decision events', () => {
      gm._recordDecision('advisory', { turnId: 't1' });
      gm._recordDecision('mode_switch', { turnId: 't2' });
      expect(gm._decisionEvents).toHaveLength(2);
      expect(gm._decisionEvents[0].type).toBe('advisory');
      expect(gm._decisionEvents[1].turnId).toBe('t2');
      expect(gm._decisionEvents[0].hasResult).toBe(false);
    });
  });

  // --- _recordCollabResult ---
  describe('_recordCollabResult', () => {
    it('marks corresponding decisions as hasResult', () => {
      gm._recordDecision('advisory', { turnId: 't5' });
      expect(gm._decisionEvents[0].hasResult).toBe(false);

      gm._recordCollabResult({ turnId: 't5', swarmUsed: true, success: true, cost: 1 });
      expect(gm._decisionEvents[0].hasResult).toBe(true);
      expect(gm._collabResults).toHaveLength(1);
    });
  });
});
