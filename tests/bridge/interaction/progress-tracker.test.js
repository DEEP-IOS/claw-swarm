/**
 * Unit tests for bridge/interaction/progress-tracker.js
 * ProgressTracker: step recording, summaries, notification throttling, multi-session isolation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProgressTracker } from '../../../src/bridge/interaction/progress-tracker.js';

describe('ProgressTracker', () => {
  let bus;
  let tracker;

  beforeEach(() => {
    bus = { publish: vi.fn() };
    tracker = new ProgressTracker({ bus });
    vi.restoreAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────

  it('initialises with default config values', () => {
    expect(tracker._notifyIntervalMs).toBe(30000);
    expect(tracker._notifyStepInterval).toBe(5);
    expect(tracker._steps.size).toBe(0);
  });

  it('accepts custom config overrides', () => {
    const custom = new ProgressTracker({ bus, config: { notifyIntervalMs: 5000, notifyStepInterval: 3 } });
    expect(custom._notifyIntervalMs).toBe(5000);
    expect(custom._notifyStepInterval).toBe(3);
  });

  // ── recordStep ───────────────────────────────────────────────────

  it('adds steps to the correct dagId', () => {
    tracker.recordStep('dag-1', { tool: 'file_write', description: 'Wrote index.js' });
    tracker.recordStep('dag-1', { tool: 'shell', description: 'Ran tests' });

    const steps = tracker.getSteps('dag-1');
    expect(steps).toHaveLength(2);
    expect(steps[0].description).toBe('Wrote index.js');
    expect(steps[1].tool).toBe('shell');
  });

  it('publishes progress.step.recorded on the bus', () => {
    tracker.recordStep('dag-1', { tool: 'grep' });
    expect(bus.publish).toHaveBeenCalledWith(
      'progress.step.recorded',
      expect.objectContaining({ dagId: 'dag-1', total: 1 }),
    );
  });

  it('defaults description to tool name when description is omitted', () => {
    tracker.recordStep('dag-1', { tool: 'read_file' });
    expect(tracker.getSteps('dag-1')[0].description).toBe('read_file');
  });

  // ── getSummary ───────────────────────────────────────────────────

  it('returns "No steps recorded." for unknown dagId', () => {
    expect(tracker.getSummary('nope')).toBe('No steps recorded.');
  });

  it('returns formatted summary with numbered steps', () => {
    tracker.recordStep('dag-2', { tool: 'edit', description: 'Edited config', filesChanged: ['a.json'] });
    tracker.recordStep('dag-2', { tool: 'test', description: 'Ran suite' });

    const summary = tracker.getSummary('dag-2');
    expect(summary).toContain('Completed 2 step(s)');
    expect(summary).toContain('1. Edited config [1 file(s)]');
    expect(summary).toContain('2. Ran suite');
  });

  // ── Notification throttle: time-based ────────────────────────────

  it('allows first notification (no prior notify timestamp)', () => {
    tracker.recordStep('dag-t', { tool: 'x' });
    expect(tracker.shouldNotify('dag-t')).toBe(true);
  });

  it('suppresses notification within 30 s window', () => {
    tracker.recordStep('dag-t', { tool: 'x' });
    // First call sets the timestamp
    tracker.shouldNotify('dag-t');
    // Immediately again -> within 30 s, not on step boundary
    tracker.recordStep('dag-t', { tool: 'y' });
    expect(tracker.shouldNotify('dag-t')).toBe(false);
  });

  // ── Notification throttle: step-count ────────────────────────────

  it('triggers notification every 5 steps', () => {
    // Use custom tracker with very long time interval so only step count fires
    const t = new ProgressTracker({ bus, config: { notifyIntervalMs: 999999, notifyStepInterval: 5 } });
    // Record 4 steps — first call to shouldNotify will fire (time-based, first time)
    for (let i = 0; i < 4; i++) t.recordStep('dag-s', { tool: `t${i}` });
    t.shouldNotify('dag-s'); // fires first-time time-based, sets lastNotifyAt
    // step 5 hits the multiple-of-5 boundary
    t.recordStep('dag-s', { tool: 't4' });
    expect(t.shouldNotify('dag-s')).toBe(true);
  });

  // ── getEstimate ──────────────────────────────────────────────────

  it('returns null when fewer than 2 steps exist', () => {
    tracker.recordStep('dag-e', { tool: 'x' });
    expect(tracker.getEstimate('dag-e')).toBeNull();
  });

  // ── cleanup (reset) ──────────────────────────────────────────────

  it('removes all data for a dagId', () => {
    tracker.recordStep('dag-c', { tool: 'a' });
    tracker.cleanup('dag-c');
    expect(tracker.getSteps('dag-c')).toEqual([]);
    expect(tracker.getSummary('dag-c')).toBe('No steps recorded.');
  });

  // ── Multi-session isolation ──────────────────────────────────────

  it('isolates steps between different dagIds', () => {
    tracker.recordStep('dag-A', { tool: 'write' });
    tracker.recordStep('dag-A', { tool: 'test' });
    tracker.recordStep('dag-B', { tool: 'read' });

    expect(tracker.getSteps('dag-A')).toHaveLength(2);
    expect(tracker.getSteps('dag-B')).toHaveLength(1);

    tracker.cleanup('dag-A');
    expect(tracker.getSteps('dag-A')).toEqual([]);
    expect(tracker.getSteps('dag-B')).toHaveLength(1);
  });

  // ── getStats ─────────────────────────────────────────────────────

  it('returns aggregate stats across all tracked DAGs', () => {
    tracker.recordStep('d1', { tool: 'a' });
    tracker.recordStep('d2', { tool: 'b' });
    tracker.recordStep('d2', { tool: 'c' });

    const stats = tracker.getStats();
    expect(stats.trackedDags).toBe(2);
    expect(stats.totalSteps).toBe(3);
  });
});
