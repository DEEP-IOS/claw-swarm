/**
 * GlobalModulator unit tests
 * Tests the runtime global work-point modulator with hysteresis,
 * minimum dwell time, and mode-specific modulation factors.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { GlobalModulator, WorkMode } from '../../../src/L4-orchestration/global-modulator.js';

function createMockBus() {
  const events = [];
  return {
    publish(topic, data) { events.push({ topic, data }); },
    subscribe() {},
    events,
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

describe('GlobalModulator', () => {
  let bus;
  let mod;

  beforeEach(() => {
    bus = createMockBus();
    mod = new GlobalModulator({ messageBus: bus, logger });
  });

  // --- WorkMode ---
  describe('WorkMode', () => {
    it('is frozen with 4 modes', () => {
      expect(Object.isFrozen(WorkMode)).toBe(true);
      expect(Object.keys(WorkMode)).toHaveLength(4);
      expect(WorkMode).toEqual({
        EXPLORE: 'EXPLORE',
        EXPLOIT: 'EXPLOIT',
        RELIABLE: 'RELIABLE',
        URGENT: 'URGENT',
      });
    });
  });

  // --- Constructor ---
  describe('constructor', () => {
    it('starts in RELIABLE mode', () => {
      expect(mod.getCurrentMode()).toBe(WorkMode.RELIABLE);
    });
  });

  // --- evaluate ---
  describe('evaluate', () => {
    it('stays in RELIABLE with neutral signals', () => {
      // Advance past dwell time
      for (let i = 0; i < 5; i++) {
        mod.evaluate({ failureRate: 0.1, novelty: 0.5, urgencyScore: 0.2 });
      }
      expect(mod.getCurrentMode()).toBe(WorkMode.RELIABLE);
    });

    it('switches to URGENT when failureRate >= 0.4', () => {
      // Need to pass dwell time first (starts at turn 0, lastSwitch 0)
      for (let i = 0; i < 3; i++) {
        mod.evaluate({ failureRate: 0.1, novelty: 0.5, urgencyScore: 0.1 });
      }
      // Now trigger URGENT via high failure rate
      mod.evaluate({ failureRate: 0.5, novelty: 0.5, urgencyScore: 0.1 });
      expect(mod.getCurrentMode()).toBe(WorkMode.URGENT);
    });

    it('switches to URGENT when urgencyScore >= 0.7', () => {
      for (let i = 0; i < 3; i++) {
        mod.evaluate({ failureRate: 0.0, novelty: 0.5, urgencyScore: 0.1 });
      }
      mod.evaluate({ failureRate: 0.0, novelty: 0.5, urgencyScore: 0.8 });
      expect(mod.getCurrentMode()).toBe(WorkMode.URGENT);
    });

    it('switches to EXPLORE when novelty >= 0.7 and failureRate <= 0.15', () => {
      for (let i = 0; i < 3; i++) {
        mod.evaluate({ failureRate: 0.05, novelty: 0.5, urgencyScore: 0.1 });
      }
      mod.evaluate({ failureRate: 0.05, novelty: 0.8, urgencyScore: 0.1 });
      expect(mod.getCurrentMode()).toBe(WorkMode.EXPLORE);
    });

    it('switches to EXPLOIT when novelty <= 0.2', () => {
      for (let i = 0; i < 3; i++) {
        mod.evaluate({ failureRate: 0.1, novelty: 0.5, urgencyScore: 0.1 });
      }
      mod.evaluate({ failureRate: 0.1, novelty: 0.1, urgencyScore: 0.1 });
      expect(mod.getCurrentMode()).toBe(WorkMode.EXPLOIT);
    });

    it('minimum dwell time (3 turns) prevents rapid switching', () => {
      // Turn 1-3: stay in RELIABLE (dwell period from turn 0)
      for (let i = 0; i < 3; i++) {
        mod.evaluate({ failureRate: 0.5, novelty: 0.5, urgencyScore: 0.1 });
      }
      // Dwell not met yet at turn 1-2, so still RELIABLE after 2 evals?
      // Actually evaluate increments _turnCount first, and _lastSwitchTurn starts at 0
      // Turn 1: turnsSinceSwitch=1 < 3 => no switch
      // Turn 2: turnsSinceSwitch=2 < 3 => no switch
      // Turn 3: turnsSinceSwitch=3 >= 3 => switch allowed => URGENT
      // Verify turn 3 switched to URGENT
      expect(mod.getCurrentMode()).toBe(WorkMode.URGENT);

      // Now in URGENT at turn 3 with lastSwitchTurn=3
      // Turn 4: turnsSinceSwitch=1 < 3 => cannot leave URGENT
      mod.evaluate({ failureRate: 0.0, novelty: 0.5, urgencyScore: 0.0 });
      expect(mod.getCurrentMode()).toBe(WorkMode.URGENT);
      // Turn 5: turnsSinceSwitch=2 < 3 => still stuck
      mod.evaluate({ failureRate: 0.0, novelty: 0.5, urgencyScore: 0.0 });
      expect(mod.getCurrentMode()).toBe(WorkMode.URGENT);
    });

    it('hysteresis - URGENT exit requires low thresholds (failureRate<=0.2, urgency<=0.4)', () => {
      // Enter URGENT
      for (let i = 0; i < 3; i++) {
        mod.evaluate({ failureRate: 0.1, novelty: 0.5, urgencyScore: 0.1 });
      }
      mod.evaluate({ failureRate: 0.5, novelty: 0.5, urgencyScore: 0.8 });
      expect(mod.getCurrentMode()).toBe(WorkMode.URGENT);

      // Wait out dwell time inside URGENT
      for (let i = 0; i < 3; i++) {
        mod.evaluate({ failureRate: 0.3, novelty: 0.5, urgencyScore: 0.5 });
      }
      // failureRate=0.3 > 0.2 exit threshold => stays URGENT
      expect(mod.getCurrentMode()).toBe(WorkMode.URGENT);

      // Now drop below exit thresholds
      mod.evaluate({ failureRate: 0.1, novelty: 0.5, urgencyScore: 0.2 });
      expect(mod.getCurrentMode()).toBe(WorkMode.RELIABLE);
    });
  });

  // --- getCurrentMode ---
  describe('getCurrentMode', () => {
    it('returns current mode string', () => {
      expect(mod.getCurrentMode()).toBe('RELIABLE');
      // Force into URGENT
      for (let i = 0; i < 3; i++) {
        mod.evaluate({ failureRate: 0.1, novelty: 0.5, urgencyScore: 0.1 });
      }
      mod.evaluate({ failureRate: 0.5, novelty: 0.5, urgencyScore: 0.8 });
      expect(mod.getCurrentMode()).toBe('URGENT');
    });
  });

  // --- getModulationFactors ---
  describe('getModulationFactors', () => {
    it('returns correct factors per mode', () => {
      // RELIABLE default
      expect(mod.getModulationFactors()).toEqual({
        thresholdMult: 1.0,
        costTolerance: 1.0,
        evidenceStrictness: 1.0,
      });

      // Switch to EXPLORE
      for (let i = 0; i < 3; i++) {
        mod.evaluate({ failureRate: 0.05, novelty: 0.5, urgencyScore: 0.1 });
      }
      mod.evaluate({ failureRate: 0.05, novelty: 0.8, urgencyScore: 0.1 });
      expect(mod.getCurrentMode()).toBe(WorkMode.EXPLORE);
      expect(mod.getModulationFactors()).toEqual({
        thresholdMult: 0.8,
        costTolerance: 1.3,
        evidenceStrictness: 0.7,
      });
    });
  });

  // --- getStats ---
  describe('getStats', () => {
    it('returns modeDistribution, switchCount, switchStability', () => {
      for (let i = 0; i < 4; i++) {
        mod.evaluate({ failureRate: 0.1, novelty: 0.5, urgencyScore: 0.1 });
      }
      const stats = mod.getStats();
      expect(stats.switchCount).toBe(0);
      expect(stats.modeDistribution).toHaveProperty('RELIABLE');
      expect(stats.modeDistribution).toHaveProperty('EXPLORE');
      expect(stats.modeDistribution).toHaveProperty('EXPLOIT');
      expect(stats.modeDistribution).toHaveProperty('URGENT');
      expect(stats.modeDistribution.RELIABLE).toBe(1);
      expect(typeof stats.switchStability).toBe('number');
    });
  });

  // --- _switchMode event ---
  describe('_switchMode', () => {
    it('publishes modulator.mode.switched event', () => {
      for (let i = 0; i < 3; i++) {
        mod.evaluate({ failureRate: 0.1, novelty: 0.5, urgencyScore: 0.1 });
      }
      bus.events.length = 0; // clear
      mod.evaluate({ failureRate: 0.5, novelty: 0.5, urgencyScore: 0.8 });
      expect(mod.getCurrentMode()).toBe(WorkMode.URGENT);

      expect(bus.events).toHaveLength(1);
      const evt = bus.events[0];
      expect(evt.topic).toBe('modulator.mode.switched');
      expect(evt.data.from).toBe(WorkMode.RELIABLE);
      expect(evt.data.to).toBe(WorkMode.URGENT);
      expect(evt.data).toHaveProperty('turn');
      expect(evt.data).toHaveProperty('factors');
      expect(evt.data).toHaveProperty('signals');
    });
  });
});
