/**
 * ExecutionJournal — 执行日志与报告生成
 * Records execution steps and generates structured reports for DAG runs.
 *
 * @module intelligence/artifacts/execution-journal
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js';
import { DIM_KNOWLEDGE, DIM_TRAIL } from '../../core/field/types.js';

// ============================================================================
// Constants
// ============================================================================

const VALID_PHASES = ['research', 'planning', 'implementation', 'review', 'synthesis'];
const VALID_OUTCOMES = ['success', 'failure', 'partial'];

const PHASE_LABELS = {
  research:       '研究阶段',
  planning:       '规划阶段',
  implementation: '实施阶段',
  review:         '评审阶段',
  synthesis:      '综合阶段',
};

// ============================================================================
// ExecutionJournal
// ============================================================================

class ExecutionJournal extends ModuleBase {
  /**
   * @param {object} deps
   * @param {object} deps.field - SignalStore
   * @param {object} deps.bus   - EventBus
   * @param {object} deps.store - DomainStore
   */
  constructor({ field, bus, store }) {
    super();
    this._field = field;
    this._bus   = bus;
    this._store = store;
    /** @type {Map<string, object[]>} dagId → JournalEntry[] */
    this._journals = new Map();
    /** @type {Map<string, number>} dagId → sequence counter */
    this._sequences = new Map();
  }

  static produces()    { return [DIM_KNOWLEDGE]; }
  static consumes()    { return [DIM_TRAIL]; }
  static publishes()   { return ['journal.entry.added', 'journal.report.generated']; }
  static subscribes()  { return ['agent.completed', 'agent.failed', 'artifact.registered']; }

  // --------------------------------------------------------------------------
  // Core operations
  // --------------------------------------------------------------------------

  /**
   * 记录一条日志 / Log a journal entry for a DAG execution.
   * @param {string} dagId
   * @param {object} entry - {phase, agentId, roleId, action, reasoning, outcome, details?}
   * @returns {object} the completed entry
   */
  log(dagId, entry) {
    const seq = (this._sequences.get(dagId) || 0) + 1;
    this._sequences.set(dagId, seq);

    const complete = {
      timestamp: Date.now(),
      sequence:  seq,
      phase:     VALID_PHASES.includes(entry.phase) ? entry.phase : 'implementation',
      agentId:   entry.agentId   || 'unknown',
      roleId:    entry.roleId    || null,
      action:    entry.action    || '',
      reasoning: entry.reasoning || '',
      outcome:   VALID_OUTCOMES.includes(entry.outcome) ? entry.outcome : 'partial',
      details:   entry.details   || null,
    };

    if (!this._journals.has(dagId)) {
      this._journals.set(dagId, []);
    }
    this._journals.get(dagId).push(complete);

    this._bus.publish('journal.entry.added', { dagId, entry: complete });
    return complete;
  }

  /**
   * 生成markdown执行报告 / Generate a markdown execution report.
   * @param {string} dagId
   * @returns {string} markdown report
   */
  generateReport(dagId) {
    const entries = this._journals.get(dagId) || [];
    if (entries.length === 0) return `## 任务执行报告\n\n_无记录_`;

    const grouped = {};
    for (const e of entries) {
      if (!grouped[e.phase]) grouped[e.phase] = [];
      grouped[e.phase].push(e);
    }

    const lines = ['## 任务执行报告', ''];

    for (const phase of VALID_PHASES) {
      const items = grouped[phase];
      if (!items || items.length === 0) continue;

      lines.push(`### ${PHASE_LABELS[phase] || phase}`);
      items.sort((a, b) => a.timestamp - b.timestamp);

      for (const e of items) {
        const time = new Date(e.timestamp).toISOString().slice(11, 19);
        const outcomeTag = e.outcome === 'success' ? '[OK]'
                         : e.outcome === 'failure' ? '[FAIL]'
                         : '[PARTIAL]';
        lines.push(`- [${time}] ${e.agentId}: ${e.action} ${outcomeTag}`);
        if (e.reasoning) {
          lines.push(`  原因：${e.reasoning}`);
        }
      }
      lines.push('');
    }

    const report = lines.join('\n');

    this._field.emit({
      dimension: DIM_KNOWLEDGE,
      scope:     dagId,
      strength:  0.4,
      emitterId: 'execution-journal',
      metadata:  { event: 'report_generated', entryCount: entries.length },
    });

    this._bus.publish('journal.report.generated', { dagId });
    return report;
  }

  // --------------------------------------------------------------------------
  // Query helpers
  // --------------------------------------------------------------------------

  /**
   * 获取日志条目 / Get entries, optionally filtered by phase.
   */
  getEntries(dagId, phase) {
    const list = this._journals.get(dagId) || [];
    return phase ? list.filter(e => e.phase === phase) : list;
  }

  /**
   * 获取时间线 / Get timeline grouped by phase with time spans.
   * @param {string} dagId
   * @returns {object[]} [{phase, startTs, endTs, entries}]
   */
  getTimeline(dagId) {
    const entries = this._journals.get(dagId) || [];
    if (entries.length === 0) return [];

    const grouped = {};
    for (const e of entries) {
      if (!grouped[e.phase]) grouped[e.phase] = [];
      grouped[e.phase].push(e);
    }

    const timeline = [];
    for (const phase of VALID_PHASES) {
      const items = grouped[phase];
      if (!items || items.length === 0) continue;
      items.sort((a, b) => a.timestamp - b.timestamp);
      timeline.push({
        phase,
        startTs: items[0].timestamp,
        endTs:   items[items.length - 1].timestamp,
        entries: items,
      });
    }
    return timeline;
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  /**
   * 持久化单个DAG日志 / Persist journal for a single DAG.
   */
  persist(dagId) {
    const entries = this._journals.get(dagId);
    if (entries) {
      this._store.put('journals', dagId, entries);
    }
  }

  /**
   * 持久化全部日志 / Persist all journals.
   */
  persistAll() {
    for (const [dagId, entries] of this._journals) {
      this._store.put('journals', dagId, entries);
    }
  }

  /**
   * 恢复单个DAG日志 / Restore journal for a single DAG.
   */
  restore(dagId) {
    const data = this._store.get('journals', dagId);
    if (data && Array.isArray(data)) {
      this._journals.set(dagId, data);
      const maxSeq = data.reduce((m, e) => Math.max(m, e.sequence || 0), 0);
      this._sequences.set(dagId, maxSeq);
    }
  }
}

export { ExecutionJournal };
export default ExecutionJournal;
