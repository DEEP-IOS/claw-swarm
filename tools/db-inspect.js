#!/usr/bin/env node
/**
 * Claw-Swarm V5.0 — Database Inspector / 数据库检查工具
 *
 * Post-test analysis: query all 34 tables and generate a data report.
 * 测试后分析：查询所有 34 张表并生成数据报告。
 *
 * Usage / 用法:
 *   node tools/db-inspect.js                           # Full inspection / 完整检查
 *   node tools/db-inspect.js --table agents             # Specific table / 指定表
 *   node tools/db-inspect.js --summary                  # Counts only / 仅统计
 *   node tools/db-inspect.js --output report.json       # Save to file / 保存到文件
 *   node tools/db-inspect.js --db path/to/db            # Custom DB path / 自定义数据库路径
 */

import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ── Config ──────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (flag) => args[args.indexOf(flag) + 1];
const hasFlag = (flag) => args.includes(flag);

const DB_PATH = getArg('--db') || join(homedir(), '.openclaw', 'claw-swarm', 'claw-swarm.db');
const TARGET_TABLE = getArg('--table') || null;
const SUMMARY_ONLY = hasFlag('--summary');
const OUTPUT_FILE = getArg('--output') || null;

// ── Colors ──────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
};

// ── Main ────────────────────────────────────────────────────

function main() {
  console.log(`\n${C.bold}${C.cyan}  🔍 Claw-Swarm Database Inspector${C.reset}\n`);

  if (!existsSync(DB_PATH)) {
    console.log(`${C.red}  Database not found: ${DB_PATH}${C.reset}`);
    console.log(`${C.dim}  Run tests first to create the database.${C.reset}\n`);
    process.exit(1);
  }

  console.log(`${C.dim}  DB: ${DB_PATH}${C.reset}\n`);

  const db = new DatabaseSync(DB_PATH, { readOnly: true });

  // Get all tables
  const tables = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  ).all().map(r => r.name);

  console.log(`${C.dim}  Tables found: ${tables.length}${C.reset}\n`);

  const report = {
    inspectedAt: new Date().toISOString(),
    dbPath: DB_PATH,
    tableCount: tables.length,
    tables: {},
  };

  if (TARGET_TABLE) {
    if (!tables.includes(TARGET_TABLE)) {
      console.log(`${C.red}  Table "${TARGET_TABLE}" not found.${C.reset}`);
      console.log(`${C.dim}  Available: ${tables.join(', ')}${C.reset}\n`);
      process.exit(1);
    }
    inspectTable(db, TARGET_TABLE, report);
  } else {
    for (const table of tables) {
      inspectTable(db, table, report);
    }
  }

  // ── Print Summary ──
  console.log(`\n${C.bold}${C.cyan}  ═══ Table Summary ═══${C.reset}\n`);

  const summary = Object.entries(report.tables)
    .sort((a, b) => b[1].rowCount - a[1].rowCount);

  let totalRows = 0;
  for (const [name, info] of summary) {
    const countStr = String(info.rowCount).padStart(6);
    const color = info.rowCount > 0 ? C.green : C.dim;
    console.log(`  ${color}${countStr}${C.reset}  ${name}`);
    totalRows += info.rowCount;
  }

  console.log(`\n  ${C.bold}Total rows: ${totalRows}${C.reset}\n`);

  // ── Key Data Highlights ──
  printHighlights(db, report);

  // ── Save Output ──
  if (OUTPUT_FILE) {
    writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`${C.green}  Report saved to: ${OUTPUT_FILE}${C.reset}\n`);
  }

  db.close();
}

function inspectTable(db, tableName, report) {
  const count = db.prepare(`SELECT COUNT(*) as c FROM "${tableName}"`).get().c;
  const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();

  const tableInfo = {
    rowCount: count,
    columns: columns.map(c => ({ name: c.name, type: c.type, pk: !!c.pk })),
  };

  if (!SUMMARY_ONLY && count > 0 && count <= 100) {
    // Include sample data for small tables
    tableInfo.rows = db.prepare(`SELECT * FROM "${tableName}" ORDER BY rowid DESC LIMIT 20`).all();
  } else if (!SUMMARY_ONLY && count > 100) {
    tableInfo.sampleRows = db.prepare(`SELECT * FROM "${tableName}" ORDER BY rowid DESC LIMIT 5`).all();
    tableInfo.note = `Showing 5 of ${count} rows`;
  }

  report.tables[tableName] = tableInfo;
}

function printHighlights(db, report) {
  console.log(`${C.bold}${C.cyan}  ═══ Key Data Highlights ═══${C.reset}\n`);

  // Agents
  try {
    const agents = db.prepare(`SELECT id, name, role, tier, status FROM agents ORDER BY rowid DESC LIMIT 10`).all();
    if (agents.length > 0) {
      console.log(`  ${C.bold}Agents (last ${agents.length}):${C.reset}`);
      for (const a of agents) {
        const statusColor = a.status === 'active' ? C.green : a.status === 'offline' ? C.dim : C.yellow;
        console.log(`    ${a.id?.slice(0, 8)}  ${a.name || '-'}  ${a.role || '-'}  ${a.tier || '-'}  ${statusColor}${a.status}${C.reset}`);
      }
      console.log('');
    }
  } catch { /* table might not exist */ }

  // Tasks
  try {
    const tasks = db.prepare(`SELECT id, description, status, assignee_id FROM tasks ORDER BY rowid DESC LIMIT 10`).all();
    if (tasks.length > 0) {
      console.log(`  ${C.bold}Tasks (last ${tasks.length}):${C.reset}`);
      for (const t of tasks) {
        const desc = (t.description || '').slice(0, 50);
        const statusColor = t.status === 'completed' ? C.green : t.status === 'failed' ? C.red : C.yellow;
        console.log(`    ${t.id?.slice(0, 8)}  ${statusColor}${t.status || '-'}${C.reset}  ${desc}`);
      }
      console.log('');
    }
  } catch { /* table might not exist */ }

  // Pheromones
  try {
    const pheromones = db.prepare(`SELECT type, target_scope, intensity, payload FROM pheromones ORDER BY rowid DESC LIMIT 10`).all();
    if (pheromones.length > 0) {
      console.log(`  ${C.bold}Pheromones (last ${pheromones.length}):${C.reset}`);
      for (const p of pheromones) {
        const typeColor = p.type === 'alarm' ? C.red : p.type === 'trail' ? C.green : C.magenta;
        const intensity = (p.intensity || 0).toFixed(2);
        console.log(`    ${typeColor}${(p.type || '').padEnd(8)}${C.reset} ${(p.target_scope || '').padEnd(20)}  intensity=${intensity}`);
      }
      console.log('');
    }
  } catch { /* table might not exist */ }

  // Quality Evaluations
  try {
    const evals = db.prepare(`SELECT id, task_id, score, verdict, passed FROM quality_evaluations ORDER BY rowid DESC LIMIT 5`).all();
    if (evals.length > 0) {
      console.log(`  ${C.bold}Quality Evaluations (last ${evals.length}):${C.reset}`);
      for (const e of evals) {
        const passColor = e.passed ? C.green : C.red;
        console.log(`    ${e.id?.slice(0, 8)}  score=${(e.score || 0).toFixed(2)}  ${passColor}${e.verdict || (e.passed ? 'PASS' : 'FAIL')}${C.reset}`);
      }
      console.log('');
    }
  } catch { /* table might not exist */ }

  // Episodic Events
  try {
    const events = db.prepare(`SELECT event_type, subject, predicate, object, importance FROM episodic_events ORDER BY rowid DESC LIMIT 5`).all();
    if (events.length > 0) {
      console.log(`  ${C.bold}Episodic Memory (last ${events.length}):${C.reset}`);
      for (const e of events) {
        console.log(`    [${e.event_type}] ${e.subject} ${e.predicate} ${e.object || ''} (importance=${(e.importance || 0).toFixed(1)})`);
      }
      console.log('');
    }
  } catch { /* table might not exist */ }

  // Knowledge Graph
  try {
    const nodes = db.prepare(`SELECT COUNT(*) as c FROM knowledge_nodes`).get().c;
    const edges = db.prepare(`SELECT COUNT(*) as c FROM knowledge_edges`).get().c;
    if (nodes > 0 || edges > 0) {
      console.log(`  ${C.bold}Knowledge Graph:${C.reset} ${nodes} nodes, ${edges} edges`);

      const topNodes = db.prepare(`SELECT label, node_type, importance FROM knowledge_nodes ORDER BY importance DESC LIMIT 5`).all();
      for (const n of topNodes) {
        console.log(`    [${n.node_type}] ${n.label} (importance=${(n.importance || 0).toFixed(1)})`);
      }
      console.log('');
    }
  } catch { /* table might not exist */ }

  // Zones
  try {
    const zones = db.prepare(`SELECT name, description, tech_stack, leader_id FROM zones`).all();
    if (zones.length > 0) {
      console.log(`  ${C.bold}Zones (${zones.length}):${C.reset}`);
      for (const z of zones) {
        const stack = z.tech_stack ? JSON.parse(z.tech_stack).join(', ') : '-';
        console.log(`    ${z.name}: ${stack} ${z.leader_id ? `(leader: ${z.leader_id.slice(0, 8)})` : ''}`);
      }
      console.log('');
    }
  } catch { /* table might not exist */ }

  // Execution Plans
  try {
    const plans = db.prepare(`SELECT id, status, maturity_score, created_at FROM execution_plans ORDER BY rowid DESC LIMIT 5`).all();
    if (plans.length > 0) {
      console.log(`  ${C.bold}Execution Plans (last ${plans.length}):${C.reset}`);
      for (const p of plans) {
        console.log(`    ${p.id?.slice(0, 8)}  status=${p.status}  maturity=${(p.maturity_score || 0).toFixed(2)}`);
      }
      console.log('');
    }
  } catch { /* table might not exist */ }
}

main();
