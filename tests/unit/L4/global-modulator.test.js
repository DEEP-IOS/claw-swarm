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
    // V6.3: coldStartThreshold=0 跳过冷启动, 保持动态模式切换测试兼容
    // V6.3: Skip cold start so dynamic mode switching tests remain valid
    mod = new GlobalModulator({ messageBus: bus, logger, config: { coldStartThreshold: 0 } });
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
    it('starts in EXPLORE mode (V6.3 cold start)', () => {
      // V6.3: 初始模式为 EXPLORE (冷启动), coldStartThreshold=0 时第一次 evaluate 后切换
      expect(mod.getCurrentMode()).toBe(WorkMode.EXPLORE);
    });
  });

  // --- evaluate ---
  describe('evaluate', () => {
    it('stays in RELIABLE with neutral signals', () => {
      // V6.3: 初始 EXPLORE, novelty<=0.4 触发 EXPLORE 退出→RELIABLE
      // V6.3: Initial EXPLORE, novelty<=0.4 triggers EXPLORE exit→RELIABLE
      for (let i = 0; i < 5; i++) {
        mod.evaluate({ failureRate: 0.1, novelty: 0.3, urgencyScore: 0.2 });
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
      // V6.3: 需要 6 次 evaluate: 3 次冷启动→RELIABLE + 3 次 dwell + 1 次 EXPLOIT
      // Need 6 evals: 3 for cold start→RELIABLE + 3 for dwell + 1 for EXPLOIT
      for (let i = 0; i < 6; i++) {
        mod.evaluate({ failureRate: 0.1, novelty: 0.5, urgencyScore: 0.1 });
      }
      mod.evaluate({ failureRate: 0.1, novelty: 0.1, urgencyScore: 0.1 });
      expect(mod.getCurrentMode()).toBe(WorkMode.EXPLOIT);
    });

    it('minimum dwell time (3 turns) prevents rapid switching', () => {
      // V6.3: coldStartThreshold=0, 初始 EXPLORE
      // Turn 1-3: cold start completes on turn 1, but dwell prevents switch until turn 3
      // Turn 3: EXPLORE→URGENT (failureRate=0.5 >= 0.4)
      for (let i = 0; i < 3; i++) {
        mod.evaluate({ failureRate: 0.5, novelty: 0.5, urgencyScore: 0.1 });
      }
      expect(mod.getCurrentMode()).toBe(WorkMode.URGENT);

      // Now in URGENT with lastSwitchTurn=3
      // Turn 4: turnsSinceSwitch=1 < 3 => cannot leave URGENT
      mod.evaluate({ failureRate: 0.0, novelty: 0.5, urgencyScore: 0.0 });
      expect(mod.getCurrentMode()).toBe(WorkMode.URGENT);
      // Turn 5: turnsSinceSwitch=2 < 3 => still stuck
      mod.evaluate({ failureRate: 0.0, novelty: 0.5, urgencyScore: 0.0 });
      expect(mod.getCurrentMode()).toBe(WorkMode.URGENT);
    });

    it('hysteresis - URGENT exit requires low thresholds (failureRate<=0.2, urgency<=0.4)', () => {
      // V6.3: coldStartThreshold=0, cold start completes on first evaluate
      // Enter URGENT: need 3 turns for dwell from initial EXPLORE, then URGENT trigger
      for (let i = 0; i < 3; i++) {
        mod.evaluate({ failureRate: 0.1, novelty: 0.5, urgencyScore: 0.1 });
      }
      // Turn 3: EXPLORE→RELIABLE, then need to pass dwell again for next switch
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
      // V6.3: 初始为 EXPLORE, 第一次 evaluate 后完成冷启动切换到 RELIABLE
      expect(mod.getCurrentMode()).toBe('EXPLORE');
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
      // V6.3: 初始为 EXPLORE, 第一次 evaluate 后冷启动完成
      expect(mod.getModulationFactors()).toEqual({
        thresholdMult: 0.8,
        costTolerance: 1.3,
        evidenceStrictness: 0.7,
      });

      // V6.3: novelty<=0.4 触发 EXPLORE 退出→RELIABLE (novelty=0.5 不退出 EXPLORE)
      // V6.3: novelty<=0.4 triggers EXPLORE exit→RELIABLE (novelty=0.5 stays EXPLORE)
      for (let i = 0; i < 4; i++) {
        mod.evaluate({ failureRate: 0.1, novelty: 0.3, urgencyScore: 0.1 });
      }
      expect(mod.getCurrentMode()).toBe(WorkMode.RELIABLE);
      expect(mod.getModulationFactors()).toEqual({
        thresholdMult: 1.0,
        costTolerance: 1.0,
        evidenceStrictness: 1.0,
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
      expect(stats.modeDistribution).toHaveProperty('RELIABLE');
      expect(stats.modeDistribution).toHaveProperty('EXPLORE');
      expect(stats.modeDistribution).toHaveProperty('EXPLOIT');
      expect(stats.modeDistribution).toHaveProperty('URGENT');
      // V6.3: 初始 EXPLORE→RELIABLE 算一次切换, 总停留分布包含两个模式
      expect(typeof stats.switchStability).toBe('number');
      // V6.3: 冷启动信息
      expect(stats.coldStart).toBeDefined();
      expect(stats.coldStart.threshold).toBe(0);
    });
  });

  // --- _switchMode event ---
  describe('_switchMode', () => {
    it('publishes modulator.mode.switched event', () => {
      // V6.3: coldStartThreshold=0, 第一次 evaluate 完成冷启动, 可能产生 EXPLORE→RELIABLE 事件
      for (let i = 0; i < 3; i++) {
        mod.evaluate({ failureRate: 0.1, novelty: 0.5, urgencyScore: 0.1 });
      }
      bus.events.length = 0; // clear previous events
      mod.evaluate({ failureRate: 0.5, novelty: 0.5, urgencyScore: 0.8 });
      expect(mod.getCurrentMode()).toBe(WorkMode.URGENT);

      // 找到 URGENT 切换事件 / Find URGENT switch event
      const urgentEvt = bus.events.find(e => e.topic === 'modulator.mode.switched' && e.data.to === WorkMode.URGENT);
      expect(urgentEvt).toBeDefined();
      expect(urgentEvt.data.to).toBe(WorkMode.URGENT);
      expect(urgentEvt.data).toHaveProperty('turn');
      expect(urgentEvt.data).toHaveProperty('factors');
      expect(urgentEvt.data).toHaveProperty('signals');
    });
  });
});
