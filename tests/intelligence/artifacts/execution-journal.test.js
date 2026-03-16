/**
 * ExecutionJournal 单元测试
 * Tests: log, getEntries, generateReport, getTimeline, bus events
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionJournal } from '../../../src/intelligence/artifacts/execution-journal.js';
import { DomainStore } from '../../../src/core/store/domain-store.js';
import { SignalStore } from '../../../src/core/field/signal-store.js';
import { EventBus } from '../../../src/core/bus/event-bus.js';
import os from 'node:os';
import path from 'node:path';

describe('ExecutionJournal', () => {
  let field, bus, store, journal;

  beforeEach(() => {
    const tmpDir = path.join(os.tmpdir(), `ej-test-${Date.now()}`);
    field = new SignalStore();
    bus = new EventBus();
    store = new DomainStore({ domain: 'test-journal', snapshotDir: tmpDir });
    journal = new ExecutionJournal({ field, bus, store });
  });

  it('log → getEntries 全流程', () => {
    const entry = journal.log('dag-1', {
      phase: 'research',
      agentId: 'agent-a',
      action: 'scanned codebase',
      outcome: 'success',
    });

    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('sequence');
    expect(entry.phase).toBe('research');
    expect(entry.agentId).toBe('agent-a');

    const entries = journal.getEntries('dag-1');
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('scanned codebase');
  });

  it('log 补全 timestamp 和 sequence', () => {
    const e1 = journal.log('dag-t', { phase: 'planning', action: 'step 1' });
    const e2 = journal.log('dag-t', { phase: 'implementation', action: 'step 2' });

    expect(typeof e1.timestamp).toBe('number');
    expect(e1.sequence).toBe(1);
    expect(e2.sequence).toBe(2);
    expect(e2.timestamp).toBeGreaterThanOrEqual(e1.timestamp);
  });

  it('getEntries 按 phase 过滤', () => {
    journal.log('dag-f', { phase: 'research', action: 'a1', outcome: 'success' });
    journal.log('dag-f', { phase: 'implementation', action: 'a2', outcome: 'success' });
    journal.log('dag-f', { phase: 'research', action: 'a3', outcome: 'success' });

    const research = journal.getEntries('dag-f', 'research');
    expect(research).toHaveLength(2);

    const impl = journal.getEntries('dag-f', 'implementation');
    expect(impl).toHaveLength(1);
  });

  it('generateReport 输出包含所有条目', () => {
    journal.log('dag-r', { phase: 'research', agentId: 'bot-1', action: 'explored files', outcome: 'success' });
    journal.log('dag-r', { phase: 'implementation', agentId: 'bot-2', action: 'wrote code', outcome: 'failure', reasoning: 'syntax error' });

    const report = journal.generateReport('dag-r');

    expect(report).toContain('explored files');
    expect(report).toContain('wrote code');
    expect(report).toContain('syntax error');
    expect(report).toContain('bot-1');
    expect(report).toContain('bot-2');
  });

  it('generateReport 包含 "## 任务执行报告" 标题', () => {
    journal.log('dag-h', { phase: 'review', action: 'reviewed', outcome: 'success' });
    const report = journal.generateReport('dag-h');
    expect(report).toContain('## 任务执行报告');
  });

  it('getTimeline 按 phase 分组', () => {
    journal.log('dag-tl', { phase: 'research', action: 'r1', outcome: 'success' });
    journal.log('dag-tl', { phase: 'implementation', action: 'i1', outcome: 'success' });
    journal.log('dag-tl', { phase: 'research', action: 'r2', outcome: 'success' });
    journal.log('dag-tl', { phase: 'review', action: 'rv1', outcome: 'success' });

    const timeline = journal.getTimeline('dag-tl');

    // Should have 3 phases: research, implementation, review
    expect(timeline).toHaveLength(3);
    expect(timeline[0].phase).toBe('research');
    expect(timeline[0].entries).toHaveLength(2);
    expect(timeline[1].phase).toBe('implementation');
    expect(timeline[1].entries).toHaveLength(1);
    expect(timeline[2].phase).toBe('review');

    // Each timeline entry should have startTs and endTs
    for (const segment of timeline) {
      expect(segment).toHaveProperty('startTs');
      expect(segment).toHaveProperty('endTs');
      expect(segment.startTs).toBeLessThanOrEqual(segment.endTs);
    }
  });

  it('journal.entry.added 事件', () => {
    const handler = vi.fn();
    bus.subscribe('journal.entry.added', handler);

    journal.log('dag-e', { phase: 'planning', action: 'planned', outcome: 'success' });

    expect(handler).toHaveBeenCalledTimes(1);
    const envelope = handler.mock.calls[0][0];
    expect(envelope.data.dagId).toBe('dag-e');
    expect(envelope.data.entry.action).toBe('planned');
  });

  it('getEntries returns empty array for unknown dagId', () => {
    expect(journal.getEntries('nonexistent')).toEqual([]);
  });
});
