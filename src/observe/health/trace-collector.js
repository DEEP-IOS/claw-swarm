/**
 * TraceCollector — Jaeger-lite span tracking
 * Stores spans in DomainStore, supports parent-child relationships,
 * and reconstructs trace trees.
 */
export class TraceCollector {
  constructor({ store, config = {} }) {
    this._store = store;
    this._maxSpanAge = config.maxSpanAgeMs ?? 24 * 60 * 60 * 1000; // 24 hours
    this._gcInterval = null;
    this._stats = { totalSpans: 0, completedSpans: 0, totalDurationMs: 0 };
    this._spanCounter = 0;
  }

  /**
   * Generate a unique span ID
   * @returns {string}
   */
  _generateId() {
    return `span-${Date.now()}-${++this._spanCounter}`;
  }

  /**
   * Start a new span and store it
   * @param {string} name - span operation name
   * @param {string|null} [parentSpanId=null] - parent span ID for nesting
   * @param {string|null} [traceId=null] - trace ID (auto-generated if null)
   * @param {Object} [metadata={}] - arbitrary metadata (agentId, toolName, etc.)
   * @returns {string} the new spanId
   */
  startSpan(name, parentSpanId = null, traceId = null, metadata = {}) {
    const spanId = this._generateId();
    const span = {
      spanId,
      traceId: traceId ?? spanId,
      parentSpanId,
      name,
      startTime: Date.now(),
      endTime: null,
      durationMs: null,
      status: 'running',
      metadata,
      events: [],
    };
    this._store.put('observe', `span-${spanId}`, span);
    this._stats.totalSpans++;
    return spanId;
  }

  /**
   * End a span, computing duration and final status
   * @param {string} spanId
   * @param {Object} [metadata={}] - additional metadata; set .failed = true for failure
   * @returns {Object|null} the completed span or null if not found
   */
  endSpan(spanId, metadata = {}) {
    const span = this._store.get('observe', `span-${spanId}`);
    if (!span) return null;
    span.endTime = Date.now();
    span.durationMs = span.endTime - span.startTime;
    span.status = metadata.failed ? 'failed' : 'completed';
    Object.assign(span.metadata, metadata);
    this._store.put('observe', `span-${spanId}`, span);
    this._stats.completedSpans++;
    this._stats.totalDurationMs += span.durationMs;
    return span;
  }

  /**
   * Add a timestamped event to a running span
   * @param {string} spanId
   * @param {Object} event - event payload (name, data, etc.)
   * @returns {boolean} true if event was added
   */
  addEvent(spanId, event) {
    const span = this._store.get('observe', `span-${spanId}`);
    if (!span) return false;
    span.events.push({ ...event, ts: Date.now() });
    this._store.put('observe', `span-${spanId}`, span);
    return true;
  }

  /**
   * Query trace summaries grouped by traceId
   * @param {Object} [filter={}]
   * @param {string} [filter.traceId] - filter by specific traceId
   * @param {string} [filter.agentId] - filter by metadata.agentId
   * @param {number} [filter.since] - only traces with spans after this timestamp
   * @param {number} [filter.until] - only traces with spans before this timestamp
   * @param {number} [filter.limit=50] - max number of traces to return
   * @returns {Array<Object>} trace summaries sorted by startTime descending
   */
  getTraces(filter = {}) {
    const allSpans = this._store.query('observe', (value, key) => {
      if (!key.startsWith('span-')) return false;
      if (filter.traceId && value.traceId !== filter.traceId) return false;
      if (filter.agentId && value.metadata?.agentId !== filter.agentId) return false;
      if (filter.since && value.startTime < filter.since) return false;
      if (filter.until && value.startTime > filter.until) return false;
      return true;
    });

    // Group spans by traceId
    const traceMap = new Map();
    for (const span of allSpans) {
      if (!traceMap.has(span.traceId)) {
        traceMap.set(span.traceId, []);
      }
      traceMap.get(span.traceId).push(span);
    }

    // Build summaries
    const summaries = [];
    for (const [traceId, spans] of traceMap) {
      const rootSpan = spans.find(s => s.parentSpanId === null) ?? spans[0];
      const hasFailure = spans.some(s => s.status === 'failed');
      const allComplete = spans.every(s => s.status === 'completed' || s.status === 'failed');
      const totalDurationMs = rootSpan.durationMs ?? (Date.now() - rootSpan.startTime);

      summaries.push({
        traceId,
        rootSpan: rootSpan.name,
        spanCount: spans.length,
        totalDurationMs,
        startTime: rootSpan.startTime,
        status: hasFailure ? 'failed' : allComplete ? 'completed' : 'running',
      });
    }

    // Sort by startTime descending
    summaries.sort((a, b) => b.startTime - a.startTime);

    const limit = filter.limit ?? 50;
    return summaries.slice(0, limit);
  }

  /**
   * Reconstruct a full trace tree by traceId
   * @param {string} traceId
   * @returns {Object|null} { traceId, rootSpan, spans, totalDurationMs } or null
   */
  getTrace(traceId) {
    const spans = this._store.query('observe', (value, key) => {
      return key.startsWith('span-') && value.traceId === traceId;
    });

    if (spans.length === 0) return null;

    // Build a lookup by spanId
    const spanMap = new Map();
    for (const span of spans) {
      spanMap.set(span.spanId, { ...span, children: [] });
    }

    // Attach children to parents, find root
    let rootSpan = null;
    for (const span of spanMap.values()) {
      if (span.parentSpanId === null) {
        rootSpan = span;
      } else {
        const parent = spanMap.get(span.parentSpanId);
        if (parent) {
          parent.children.push(span);
        } else {
          // Orphan span — treat as root candidate if no root yet
          if (!rootSpan) rootSpan = span;
        }
      }
    }

    // Fallback: use earliest span as root
    if (!rootSpan) {
      rootSpan = [...spanMap.values()].sort((a, b) => a.startTime - b.startTime)[0];
    }

    const totalDurationMs = rootSpan.durationMs ?? (Date.now() - rootSpan.startTime);

    return {
      traceId,
      rootSpan,
      spans: Array.from(spanMap.values()),
      totalDurationMs,
    };
  }

  /**
   * Garbage-collect spans older than _maxSpanAge
   * @private
   */
  _gcExpiredSpans() {
    const cutoff = Date.now() - this._maxSpanAge;
    const expired = this._store.query('observe', (value, key) => {
      return key.startsWith('span-') && value.startTime < cutoff;
    });
    for (const span of expired) {
      this._store.delete('observe', `span-${span.spanId}`);
    }
  }

  /** Start the hourly GC timer */
  start() {
    this._gcInterval = setInterval(() => this._gcExpiredSpans(), 60 * 60 * 1000);
    if (this._gcInterval.unref) this._gcInterval.unref();
  }

  /** Stop the GC timer */
  stop() {
    if (this._gcInterval) {
      clearInterval(this._gcInterval);
      this._gcInterval = null;
    }
  }

  /**
   * Return cumulative stats
   * @returns {{ totalSpans: number, completedSpans: number, avgSpanDuration: number }}
   */
  getStats() {
    return {
      totalSpans: this._stats.totalSpans,
      completedSpans: this._stats.completedSpans,
      avgSpanDuration: this._stats.completedSpans > 0
        ? this._stats.totalDurationMs / this._stats.completedSpans
        : 0,
    };
  }
}
