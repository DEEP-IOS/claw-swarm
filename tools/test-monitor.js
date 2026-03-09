#!/usr/bin/env node
/**
 * Claw-Swarm V5.0 — Test Monitor / 测试监控工具
 *
 * Real-time monitoring + data collection during production testing.
 * 在生产测试期间进行实时监控和数据收集。
 *
 * Usage / 用法:
 *   node tools/test-monitor.js                    # Start monitoring / 开始监控
 *   node tools/test-monitor.js --duration 3600    # Run for 1 hour / 运行1小时
 *   node tools/test-monitor.js --output report    # Custom output dir / 自定义输出目录
 *   node tools/test-monitor.js --port 19100       # Custom dashboard port / 自定义端口
 */

import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ── Config ──────────────────────────────────────────────────

const DASHBOARD_PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '19100', 10);
const DASHBOARD_URL = `http://localhost:${DASHBOARD_PORT}`;
const DURATION_SEC = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--duration') || '0', 10);
const OUTPUT_DIR = process.argv.find((_, i, a) => a[i - 1] === '--output') || `test-reports/${timestamp()}`;
const POLL_INTERVAL_MS = 3000;   // Metrics polling interval / 指标轮询间隔
const SSE_RECONNECT_MS = 5000;   // SSE reconnect delay / SSE 重连延迟

// ── State ───────────────────────────────────────────────────

const state = {
  startTime: Date.now(),
  events: [],           // All SSE events / 所有 SSE 事件
  metricsSnapshots: [], // Periodic metrics / 定期指标快照
  errors: [],           // Errors captured / 捕获的错误
  toolCalls: [],        // Tool call events / 工具调用事件
  summary: {
    totalEvents: 0,
    eventsByTopic: {},
    toolCallCount: 0,
    agentSpawns: 0,
    pheromoneEmissions: 0,
    qualityEvaluations: 0,
    memoryOperations: 0,
    errors: 0,
  },
};

// ── Helpers ──────────────────────────────────────────────────

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function ts() {
  return new Date().toISOString().slice(11, 23);
}

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  bold: '\x1b[1m',
  bgBlack: '\x1b[40m',
};

function log(color, prefix, msg) {
  console.log(`${C.dim}${ts()}${C.reset} ${color}${prefix}${C.reset} ${msg}`);
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── SSE Client ──────────────────────────────────────────────

let sseAbortController = null;

async function connectSSE() {
  log(C.cyan, '[SSE]', `Connecting to ${DASHBOARD_URL}/events ...`);

  sseAbortController = new AbortController();

  try {
    const res = await fetch(`${DASHBOARD_URL}/events`, {
      signal: sseAbortController.signal,
      headers: { 'Accept': 'text/event-stream' },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    log(C.green, '[SSE]', 'Connected! Streaming events...');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE format: "event: topic\ndata: json\n\n"
      const parts = buffer.split('\n\n');
      buffer = parts.pop(); // Keep incomplete last part

      for (const part of parts) {
        if (!part.trim()) continue;
        const lines = part.split('\n');
        let eventType = 'message';
        let data = '';

        for (const line of lines) {
          if (line.startsWith('event:')) eventType = line.slice(6).trim();
          else if (line.startsWith('data:')) data = line.slice(5).trim();
        }

        if (data) {
          handleSSEEvent(eventType, data);
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    log(C.red, '[SSE]', `Connection error: ${err.message}`);
    log(C.yellow, '[SSE]', `Reconnecting in ${SSE_RECONNECT_MS / 1000}s...`);
    setTimeout(connectSSE, SSE_RECONNECT_MS);
  }
}

function handleSSEEvent(topic, rawData) {
  let data;
  try {
    data = JSON.parse(rawData);
  } catch {
    data = { raw: rawData };
  }

  const event = {
    timestamp: Date.now(),
    topic,
    data,
  };

  // Store event
  state.events.push(event);
  state.summary.totalEvents++;

  // Categorize
  const category = topic.split('.')[0];
  state.summary.eventsByTopic[topic] = (state.summary.eventsByTopic[topic] || 0) + 1;

  // Track specifics
  if (topic.startsWith('agent.') && topic.includes('spawn')) {
    state.summary.agentSpawns++;
  }
  if (topic.startsWith('pheromone.')) {
    state.summary.pheromoneEmissions++;
  }
  if (topic.startsWith('quality.')) {
    state.summary.qualityEvaluations++;
  }
  if (topic.startsWith('memory.')) {
    state.summary.memoryOperations++;
  }
  if (topic.includes('error') || topic.includes('fail') || topic.includes('abort')) {
    state.summary.errors++;
    state.errors.push(event);
  }

  // Live console output
  const colorMap = {
    task: C.blue,
    agent: C.green,
    pheromone: C.magenta,
    quality: C.yellow,
    memory: C.cyan,
    zone: C.bold,
    system: C.dim,
  };
  const color = colorMap[category] || C.reset;
  const preview = typeof data === 'object'
    ? JSON.stringify(data).slice(0, 120)
    : String(data).slice(0, 120);
  log(color, `[${topic}]`, preview);

  // Append to event log file
  appendToLog('events.jsonl', event);
}

// ── Metrics Poller ──────────────────────────────────────────

let metricsTimer = null;

async function pollMetrics() {
  try {
    const [metricsRes, statsRes] = await Promise.all([
      fetch(`${DASHBOARD_URL}/api/metrics`).then(r => r.json()),
      fetch(`${DASHBOARD_URL}/api/stats`).then(r => r.json()),
    ]);

    const snapshot = {
      timestamp: Date.now(),
      elapsedSec: Math.round((Date.now() - state.startTime) / 1000),
      metrics: metricsRes,
      stats: statsRes,
    };

    state.metricsSnapshots.push(snapshot);
    appendToLog('metrics.jsonl', snapshot);

    // Periodic summary to console
    if (state.metricsSnapshots.length % 10 === 0) {
      printMetricsSummary(metricsRes, statsRes);
    }
  } catch (err) {
    // Dashboard might not be running yet
    if (state.metricsSnapshots.length === 0) {
      log(C.yellow, '[METRICS]', `Dashboard not reachable: ${err.message}`);
    }
  }
}

function printMetricsSummary(metrics, stats) {
  const red = metrics.red || {};
  const swarm = metrics.swarm || {};
  const bc = stats.broadcaster || {};

  console.log('');
  console.log(`${C.bold}${C.cyan}═══ Metrics Snapshot ═══${C.reset}`);
  console.log(`  ${C.dim}Elapsed:${C.reset} ${Math.round((Date.now() - state.startTime) / 1000)}s`);
  console.log(`  ${C.dim}RED:${C.reset} rate=${red.rate || 0} | errorRate=${((red.errorRate || 0) * 100).toFixed(1)}% | avgDuration=${Math.round(red.avgDuration || 0)}ms`);
  console.log(`  ${C.dim}Swarm:${C.reset} tasks=${(swarm.tasksCompleted || 0)}/${(swarm.tasksFailed || 0)} | agents=${swarm.agentEvents || 0} | pheromones=${swarm.pheromoneEvents || 0} | memory=${swarm.memoryEvents || 0} | quality=${swarm.qualityEvents || 0}`);
  console.log(`  ${C.dim}SSE:${C.reset} clients=${bc.clientCount || 0} | broadcasts=${bc.totalBroadcasts || 0}`);
  console.log(`${C.bold}${C.cyan}════════════════════════${C.reset}`);
  console.log('');
}

// ── File I/O ────────────────────────────────────────────────

function appendToLog(filename, data) {
  try {
    ensureDir(OUTPUT_DIR);
    appendFileSync(join(OUTPUT_DIR, filename), JSON.stringify(data) + '\n', 'utf-8');
  } catch { /* ignore write errors during monitoring */ }
}

function writeReport() {
  ensureDir(OUTPUT_DIR);
  const elapsed = Math.round((Date.now() - state.startTime) / 1000);

  // ── Summary Report ──
  const report = {
    generatedAt: new Date().toISOString(),
    duration: `${elapsed}s`,
    totalEvents: state.summary.totalEvents,
    eventsByTopic: state.summary.eventsByTopic,
    agentSpawns: state.summary.agentSpawns,
    pheromoneEmissions: state.summary.pheromoneEmissions,
    qualityEvaluations: state.summary.qualityEvaluations,
    memoryOperations: state.summary.memoryOperations,
    errorCount: state.summary.errors,
    metricsSnapshots: state.metricsSnapshots.length,
    lastMetrics: state.metricsSnapshots[state.metricsSnapshots.length - 1] || null,
    errors: state.errors.map(e => ({
      timestamp: new Date(e.timestamp).toISOString(),
      topic: e.topic,
      data: e.data,
    })),
  };

  writeFileSync(join(OUTPUT_DIR, 'report.json'), JSON.stringify(report, null, 2), 'utf-8');

  // ── Markdown Report ──
  const md = `# Claw-Swarm Test Report

Generated: ${new Date().toISOString()}
Duration: ${elapsed}s

## Summary

| Metric | Value |
|--------|-------|
| Total Events | ${report.totalEvents} |
| Agent Spawns | ${report.agentSpawns} |
| Pheromone Emissions | ${report.pheromoneEmissions} |
| Quality Evaluations | ${report.qualityEvaluations} |
| Memory Operations | ${report.memoryOperations} |
| Errors | ${report.errorCount} |
| Metrics Snapshots | ${report.metricsSnapshots} |

## Events by Topic

| Topic | Count |
|-------|-------|
${Object.entries(report.eventsByTopic)
  .sort((a, b) => b[1] - a[1])
  .map(([topic, count]) => `| ${topic} | ${count} |`)
  .join('\n')}

## RED Metrics (Last Snapshot)

${report.lastMetrics ? `| Metric | Value |
|--------|-------|
| Request Rate | ${report.lastMetrics.metrics?.red?.rate || 0} |
| Error Rate | ${((report.lastMetrics.metrics?.red?.errorRate || 0) * 100).toFixed(1)}% |
| Avg Duration | ${Math.round(report.lastMetrics.metrics?.red?.avgDuration || 0)}ms |
| Tasks Completed | ${report.lastMetrics.metrics?.swarm?.tasksCompleted || 0} |
| Tasks Failed | ${report.lastMetrics.metrics?.swarm?.tasksFailed || 0} |` : 'No metrics collected.'}

## Errors

${report.errors.length === 0 ? 'No errors captured.' :
  report.errors.map(e => `### ${e.timestamp}\n- **Topic:** ${e.topic}\n- **Data:** \`${JSON.stringify(e.data).slice(0, 200)}\``).join('\n\n')}

---

## Raw Data Files

- \`events.jsonl\` — All SSE events (one JSON per line)
- \`metrics.jsonl\` — Periodic metrics snapshots (every ${POLL_INTERVAL_MS / 1000}s)
- \`report.json\` — Machine-readable summary

*Generated by claw-swarm test-monitor*
`;

  writeFileSync(join(OUTPUT_DIR, 'report.md'), md, 'utf-8');

  log(C.green, '[REPORT]', `Written to ${OUTPUT_DIR}/`);
  log(C.dim, '  ', `report.json  — Machine-readable summary`);
  log(C.dim, '  ', `report.md    — Human-readable report`);
  log(C.dim, '  ', `events.jsonl — ${state.events.length} events`);
  log(C.dim, '  ', `metrics.jsonl — ${state.metricsSnapshots.length} snapshots`);
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log(`${C.bold}${C.cyan}  🐝 Claw-Swarm V5.0 Test Monitor${C.reset}`);
  console.log(`${C.dim}  Dashboard: ${DASHBOARD_URL}${C.reset}`);
  console.log(`${C.dim}  Output:    ${OUTPUT_DIR}/${C.reset}`);
  console.log(`${C.dim}  Duration:  ${DURATION_SEC > 0 ? DURATION_SEC + 's' : 'Until Ctrl+C'}${C.reset}`);
  console.log('');

  ensureDir(OUTPUT_DIR);

  // Write session metadata
  writeFileSync(join(OUTPUT_DIR, 'session.json'), JSON.stringify({
    startedAt: new Date().toISOString(),
    dashboardUrl: DASHBOARD_URL,
    pollIntervalMs: POLL_INTERVAL_MS,
    durationSec: DURATION_SEC || 'unlimited',
    nodeVersion: process.version,
    platform: process.platform,
  }, null, 2), 'utf-8');

  // Start SSE event stream
  connectSSE();

  // Start metrics polling
  metricsTimer = setInterval(pollMetrics, POLL_INTERVAL_MS);
  pollMetrics(); // Immediate first poll

  // Auto-stop after duration
  if (DURATION_SEC > 0) {
    setTimeout(() => {
      log(C.yellow, '[MONITOR]', `Duration ${DURATION_SEC}s reached. Stopping...`);
      shutdown();
    }, DURATION_SEC * 1000);
  }

  // Graceful shutdown
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log(C.green, '[MONITOR]', 'Monitoring started. Press Ctrl+C to stop and generate report.');
}

function shutdown() {
  log(C.yellow, '[MONITOR]', 'Shutting down...');

  if (sseAbortController) sseAbortController.abort();
  if (metricsTimer) clearInterval(metricsTimer);

  // Final metrics poll
  pollMetrics().finally(() => {
    console.log('');
    printFinalSummary();
    writeReport();
    console.log('');
    process.exit(0);
  });
}

function printFinalSummary() {
  const elapsed = Math.round((Date.now() - state.startTime) / 1000);

  console.log(`${C.bold}${C.cyan}╔══════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║     Test Monitor — Final Summary         ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════╝${C.reset}`);
  console.log(`  Duration:          ${elapsed}s`);
  console.log(`  Total Events:      ${state.summary.totalEvents}`);
  console.log(`  Agent Spawns:      ${state.summary.agentSpawns}`);
  console.log(`  Pheromone Signals:  ${state.summary.pheromoneEmissions}`);
  console.log(`  Quality Evals:     ${state.summary.qualityEvaluations}`);
  console.log(`  Memory Ops:        ${state.summary.memoryOperations}`);
  console.log(`  Errors:            ${state.errors.length > 0 ? C.red : C.green}${state.summary.errors}${C.reset}`);
  console.log('');

  if (Object.keys(state.summary.eventsByTopic).length > 0) {
    console.log(`  ${C.dim}Top events:${C.reset}`);
    Object.entries(state.summary.eventsByTopic)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([topic, count]) => {
        console.log(`    ${topic}: ${count}`);
      });
  }
}

main().catch(err => {
  console.error(`${C.red}[FATAL] ${err.message}${C.reset}`);
  process.exit(1);
});
