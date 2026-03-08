/**
 * ConfigManager 单元测试 / ConfigManager Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigManager } from '../../../src/L1-infrastructure/config/config-manager.js';

describe('ConfigManager', () => {
  let cm;

  beforeEach(() => {
    cm = new ConfigManager();
  });

  describe('load', () => {
    it('should load default config when no file provided', () => {
      const config = cm.load();
      expect(config.logLevel).toBe('info');
      expect(config.orchestration.enabled).toBe(true);
      expect(config.orchestration.maxWorkers).toBe(16);
      expect(config.pheromone.enabled).toBe(true);
      expect(config.memory.enabled).toBe(true);
    });

    it('should merge overrides', () => {
      const cm2 = new ConfigManager({
        overrides: { logLevel: 'debug', orchestration: { maxWorkers: 8 } },
      });
      const config = cm2.load();
      expect(config.logLevel).toBe('debug');
      expect(config.orchestration.maxWorkers).toBe(8);
    });

    it('should fallback to defaults on invalid config', () => {
      const cm3 = new ConfigManager({
        overrides: { logLevel: 'INVALID_LEVEL' },
      });
      // Should fall back to defaults without throwing
      const config = cm3.load();
      expect(config.logLevel).toBe('info');
    });
  });

  describe('get', () => {
    it('should get nested values by dot path', () => {
      cm.load();
      expect(cm.get('orchestration.maxWorkers')).toBe(16);
      expect(cm.get('pheromone.mmasBounds.min')).toBe(0.05);
    });

    it('should return default for missing path', () => {
      cm.load();
      expect(cm.get('nonexistent.path', 42)).toBe(42);
    });
  });

  describe('set', () => {
    it('should update config and validate', () => {
      cm.load();
      cm.set('orchestration.maxWorkers', 32);
      expect(cm.get('orchestration.maxWorkers')).toBe(32);
    });

    it('should reject invalid values', () => {
      cm.load();
      expect(() => cm.set('logLevel', 'INVALID')).toThrow();
      expect(cm.get('logLevel')).toBe('info'); // unchanged
    });
  });

  describe('onChange', () => {
    it('should notify listeners on set()', () => {
      cm.load();
      let notified = false;
      cm.onChange((path) => { notified = path === 'orchestration.maxWorkers'; });
      cm.set('orchestration.maxWorkers', 4);
      expect(notified).toBe(true);
    });

    it('should support unsubscribe', () => {
      cm.load();
      let count = 0;
      const unsub = cm.onChange(() => { count++; });
      cm.set('orchestration.maxWorkers', 4);
      expect(count).toBe(1);
      unsub();
      cm.set('orchestration.maxWorkers', 8);
      expect(count).toBe(1); // no more notifications
    });
  });

  describe('V5.0 config sections', () => {
    it('should have MoE routing defaults', () => {
      cm.load();
      const moe = cm.get('orchestration.moeRouting');
      expect(moe.enabled).toBe(true);
      expect(moe.topK).toBe(3);
      expect(moe.minConfidence).toBe(0.3);
    });

    it('should have memory episodic defaults', () => {
      cm.load();
      const ep = cm.get('memory.episodic');
      expect(ep.maxEvents).toBe(1000);
      expect(ep.decayLambdaDays).toBe(30);
    });

    it('should have pheromone MMAS defaults', () => {
      cm.load();
      const bounds = cm.get('pheromone.mmasBounds');
      expect(bounds.min).toBe(0.05);
      expect(bounds.max).toBe(5.0);
    });

    it('should have zones disabled by default', () => {
      cm.load();
      expect(cm.get('zones.enabled')).toBe(false);
    });

    it('should have dashboard disabled by default', () => {
      cm.load();
      expect(cm.get('dashboard.enabled')).toBe(false);
      expect(cm.get('dashboard.port')).toBe(19100);
    });
  });
});
