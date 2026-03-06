/**
 * @fileoverview Claw-Swarm v4.0 - Layer 1 Unified Database Module
 * @module layer1-core/db
 * @author DEEP-IOS
 *
 * ============================================================================
 * 功能概述 / Function Overview
 * ============================================================================
 * 本模块是 Claw-Swarm v4.0 的统一数据库层，合并了 OME 的记忆引擎 CRUD 操作与
 * Swarm Lite v3.0 的编排/治理 CRUD 操作，并新增了 v4.0 的信息素引擎和
 * 人格进化表。
 *
 * This module is the unified database layer for Claw-Swarm v4.0, merging OME's
 * memory engine CRUD operations with Swarm Lite v3.0's orchestration/governance
 * CRUD operations, and adding v4.0's pheromone engine and persona evolution tables.
 *
 * 架构设计 / Architecture Design:
 *   - 接口优先，按领域组织函数 / Interface-first, functions organized by domain
 *   - 单例模式管理数据库连接 / Singleton pattern for database connection
 *   - WAL 模式确保并发读取 + 快速写入 / WAL mode for concurrent reads + fast writes
 *   - 所有写入使用参数化查询 / All writes use parameterized queries
 *   - JSON 字段写入时序列化、读取时解析 / JSON fields are stringified on write, parsed on read
 *
 * 包含的表 / Tables Included (25 total):
 *   METADATA (1):        swarm_meta
 *   MEMORY ENGINE (6):   memories, daily_summaries, checkpoints, events, tasks, event_cursors
 *   ORCHESTRATION (5):   swarm_tasks, swarm_roles, swarm_checkpoints, swarm_artifacts, swarm_locks
 *   GOVERNANCE (11):     agents, capabilities, capability_details, skills, contributions,
 *                        votes, vote_results, behavior_tags, collaboration_history,
 *                        event_log, evaluation_queue
 *   PHEROMONE (1):       pheromones
 *   PERSONA (1):         persona_outcomes
 * ============================================================================
 */

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

// ============================================================================
// 单例模式 / Singleton Pattern
// ============================================================================

/** @type {DatabaseSync | null} */
let _db = null;

/**
 * 初始化数据库（幂等） / Initialize the database (idempotent)
 * 如果已初始化则返回现有实例。自动创建父目录。
 * Returns existing instance if already initialized. Creates parent directories automatically.
 *
 * @param {string} dbPath - 数据库文件完整路径 / Full path to the SQLite database file
 * @returns {DatabaseSync}
 */
export function initDb(dbPath) {
  if (_db) return _db;

  // 确保父目录存在 / Ensure parent directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _db = new DatabaseSync(dbPath);

  // WAL 模式：并发读取 + 快速写入 / WAL mode: concurrent reads + fast writes
  _db.exec('PRAGMA journal_mode = WAL');
  _db.exec('PRAGMA synchronous = NORMAL');
  _db.exec('PRAGMA busy_timeout = 5000');
  _db.exec('PRAGMA foreign_keys = ON');

  // 创建所有表和索引 / Create all tables and indexes
  _db.exec(SCHEMA);

  return _db;
}

/**
 * 获取当前数据库实例 / Get the current database instance
 * 未初始化时抛出错误。
 * Throws if the database has not been initialized.
 *
 * @returns {DatabaseSync}
 * @throws {Error} 数据库未初始化 / Database not initialized
 */
export function getDb() {
  if (!_db) throw new Error('Database not initialized. Call initDb() first.');
  return _db;
}

/**
 * 关闭数据库连接 / Close the database connection
 * 可安全重复调用。
 * Safe to call multiple times.
 */
export function closeDb() {
  if (_db) {
    try { _db.close(); } catch { /* already closed / 已关闭 */ }
    _db = null;
  }
}

// ============================================================================
// 数据库模式 / Database Schema (25 tables)
// ============================================================================

const SCHEMA = `
-- ═══════════════════════════════════════════════════════════════════════════════
-- METADATA — 元数据
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS swarm_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- MEMORY ENGINE (from OME) — 记忆引擎（来自 OME）
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS memories (
  id          TEXT PRIMARY KEY,
  scope       TEXT NOT NULL,
  layer       TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  content     TEXT NOT NULL,
  importance  REAL DEFAULT 0.5,
  tags        TEXT,
  date        TEXT NOT NULL,
  version     INTEGER DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  expires_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mem_scope      ON memories(scope, layer);
CREATE INDEX IF NOT EXISTS idx_mem_date       ON memories(date);
CREATE INDEX IF NOT EXISTS idx_mem_date_agent ON memories(date, agent_id);

CREATE TABLE IF NOT EXISTS daily_summaries (
  date        TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  summary     TEXT NOT NULL,
  topics      TEXT,
  stats       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (date, agent_id)
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  trigger     TEXT NOT NULL,
  mechanical  TEXT NOT NULL,
  summary     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cp_agent ON checkpoints(agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT NOT NULL,
  source_agent TEXT NOT NULL,
  scope        TEXT NOT NULL,
  payload      TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id      TEXT PRIMARY KEY,
  created_by   TEXT NOT NULL,
  owner        TEXT NOT NULL,
  acting_owner TEXT,
  participants TEXT NOT NULL,
  objective    TEXT NOT NULL,
  status       TEXT DEFAULT 'active',
  data         TEXT NOT NULL,
  version      INTEGER DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS event_cursors (
  agent_id      TEXT PRIMARY KEY,
  last_event_id INTEGER DEFAULT 0
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- SWARM ORCHESTRATION (from v3.0) — 蜂群编排（来自 v3.0）
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS swarm_tasks (
  id              TEXT PRIMARY KEY,
  config          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  strategy        TEXT NOT NULL DEFAULT 'simulated',
  retry_count     INTEGER DEFAULT 0,
  error           TEXT,
  idempotency_key TEXT,
  expired_at      TEXT DEFAULT (datetime('now', '+7 days')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stasks_idempotency ON swarm_tasks(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stasks_status             ON swarm_tasks(status);
CREATE INDEX IF NOT EXISTS idx_stasks_expired            ON swarm_tasks(expired_at);

CREATE TABLE IF NOT EXISTS swarm_roles (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  capabilities TEXT,
  priority     INTEGER DEFAULT 0,
  depends_on   TEXT DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'pending',
  result       TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES swarm_tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_sroles_task ON swarm_roles(task_id);

CREATE TABLE IF NOT EXISTS swarm_checkpoints (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL,
  role_name  TEXT NOT NULL,
  trigger    TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES swarm_tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_scp_task ON swarm_checkpoints(task_id);

CREATE TABLE IF NOT EXISTS swarm_artifacts (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL,
  role_name  TEXT NOT NULL,
  type       TEXT NOT NULL,
  path       TEXT,
  content    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES swarm_tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_sart_task ON swarm_artifacts(task_id);

CREATE TABLE IF NOT EXISTS swarm_locks (
  resource    TEXT PRIMARY KEY,
  owner       TEXT NOT NULL,
  acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- GOVERNANCE (from v3.0) — 治理（来自 v3.0）
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agents (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'general',
  tier               TEXT NOT NULL DEFAULT 'trainee',
  status             TEXT NOT NULL DEFAULT 'active',
  total_score        REAL DEFAULT 50,
  contribution_points INTEGER DEFAULT 0,
  failure_count      INTEGER DEFAULT 0,
  success_count      INTEGER DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  last_active        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agents_tier   ON agents(tier);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_score  ON agents(total_score DESC);

CREATE TABLE IF NOT EXISTS capabilities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id   TEXT NOT NULL,
  dimension  TEXT NOT NULL,
  score      REAL DEFAULT 50,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  UNIQUE(agent_id, dimension)
);
CREATE INDEX IF NOT EXISTS idx_cap_agent ON capabilities(agent_id);

CREATE TABLE IF NOT EXISTS capability_details (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id      TEXT NOT NULL,
  dimension     TEXT NOT NULL,
  sub_dimension TEXT NOT NULL,
  score         REAL DEFAULT 50,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  UNIQUE(agent_id, dimension, sub_dimension)
);

CREATE TABLE IF NOT EXISTS skills (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id     TEXT NOT NULL,
  skill_name   TEXT NOT NULL,
  level        TEXT DEFAULT 'beginner',
  certified_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT,
  evidence     TEXT,
  verified_by  TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  UNIQUE(agent_id, skill_name)
);
CREATE INDEX IF NOT EXISTS idx_skills_agent ON skills(agent_id);

CREATE TABLE IF NOT EXISTS contributions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id      TEXT NOT NULL,
  task_id       TEXT,
  points        INTEGER DEFAULT 0,
  category      TEXT,
  quality_score REAL,
  impact_score  REAL,
  timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
  metadata      TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_contrib_agent ON contributions(agent_id);
CREATE INDEX IF NOT EXISTS idx_contrib_time  ON contributions(timestamp DESC);

CREATE TABLE IF NOT EXISTS votes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  vote_id   TEXT NOT NULL,
  voter_id  TEXT NOT NULL,
  target_id TEXT NOT NULL,
  vote_type TEXT NOT NULL,
  choice    TEXT,
  weight    REAL DEFAULT 1,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  FOREIGN KEY (voter_id)  REFERENCES agents(id),
  FOREIGN KEY (target_id) REFERENCES agents(id)
);
CREATE INDEX IF NOT EXISTS idx_votes_voteid ON votes(vote_id);
CREATE INDEX IF NOT EXISTS idx_votes_target ON votes(target_id);

CREATE TABLE IF NOT EXISTS vote_results (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  vote_id          TEXT NOT NULL UNIQUE,
  target_id        TEXT NOT NULL,
  vote_type        TEXT NOT NULL,
  result           TEXT DEFAULT 'pending',
  status           TEXT DEFAULT 'pending',
  total_weight     REAL DEFAULT 0,
  approval_weight  REAL DEFAULT 0,
  rejection_weight REAL DEFAULT 0,
  expires_at       TEXT,
  concluded_at     TEXT
);

CREATE TABLE IF NOT EXISTS behavior_tags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id    TEXT NOT NULL,
  tag         TEXT NOT NULL,
  weight      REAL DEFAULT 1.0,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  source      TEXT DEFAULT 'auto',
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  UNIQUE(agent_id, tag)
);

CREATE TABLE IF NOT EXISTS collaboration_history (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_a_id          TEXT NOT NULL,
  agent_b_id          TEXT NOT NULL,
  task_id             TEXT,
  collaboration_score REAL DEFAULT 0,
  timestamp           TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_a_id) REFERENCES agents(id),
  FOREIGN KEY (agent_b_id) REFERENCES agents(id)
);

CREATE TABLE IF NOT EXISTS event_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  agent_id   TEXT,
  details    TEXT,
  severity   TEXT DEFAULT 'info',
  timestamp  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_eventlog_type ON event_log(event_type);
CREATE INDEX IF NOT EXISTS idx_eventlog_time ON event_log(timestamp DESC);

CREATE TABLE IF NOT EXISTS evaluation_queue (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id     TEXT NOT NULL,
  updates      TEXT NOT NULL,
  status       TEXT DEFAULT 'pending',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
CREATE INDEX IF NOT EXISTS idx_evalq_status ON evaluation_queue(status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PHEROMONE ENGINE (new v4.0) — 信息素引擎（v4.0 新增）
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pheromones (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  source_id    TEXT NOT NULL,
  target_scope TEXT NOT NULL,
  intensity    REAL NOT NULL DEFAULT 1.0,
  payload      TEXT,
  decay_rate   REAL NOT NULL DEFAULT 0.01,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  expires_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pher_scope     ON pheromones(target_scope, type);
CREATE INDEX IF NOT EXISTS idx_pher_intensity ON pheromones(intensity DESC);
CREATE INDEX IF NOT EXISTS idx_pher_expires   ON pheromones(expires_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PERSONA EVOLUTION (new v4.0) — 人格进化（v4.0 新增）
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS persona_outcomes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id    TEXT NOT NULL,
  task_type     TEXT NOT NULL,
  success       INTEGER NOT NULL DEFAULT 0,
  quality_score REAL,
  duration_ms   INTEGER,
  notes         TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_persona_id   ON persona_outcomes(persona_id, task_type);
CREATE INDEX IF NOT EXISTS idx_persona_type ON persona_outcomes(task_type);
`;

// ============================================================================
// 事务辅助 / Transaction Helper
// ============================================================================

/**
 * 在事务中执行函数 / Execute a function within a transaction
 * 自动 ROLLBACK 处理错误。遇到 SQLITE_BUSY 时指数退避重试。
 * Auto-ROLLBACK on error. Exponential backoff retry on SQLITE_BUSY.
 *
 * @template T
 * @param {() => T} fn - 在事务中执行的同步函数 / Synchronous function to execute within the transaction
 * @returns {T} fn 的返回值 / Return value of fn
 * @throws {Error} 所有重试耗尽或非 BUSY 错误 / All retries exhausted or non-BUSY error
 */
export function withTransaction(fn) {
  const db = getDb();
  const SQLITE_BUSY_MAX_RETRIES = 3;

  for (let attempt = 0; attempt <= SQLITE_BUSY_MAX_RETRIES; attempt++) {
    try {
      db.exec('BEGIN IMMEDIATE');
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      // 尝试回滚（即使事务已结束也安全） / Attempt ROLLBACK (safe even if transaction already ended)
      try { db.exec('ROLLBACK'); } catch { /* ignore / 忽略 */ }

      const isBusy =
        err.code === 'SQLITE_BUSY' ||
        (err.message && err.message.includes('SQLITE_BUSY')) ||
        (err.message && err.message.includes('database is locked'));

      if (isBusy && attempt < SQLITE_BUSY_MAX_RETRIES) {
        // 指数退避：50ms, 100ms, 200ms / Exponential backoff: 50ms, 100ms, 200ms
        const delay = Math.pow(2, attempt) * 50;
        const end = Date.now() + delay;
        while (Date.now() < end) { /* busy wait (sync) / 忙等待（同步） */ }
        continue;
      }

      throw err;
    }
  }
}

// ============================================================================
// ═══ META OPERATIONS ═══ 元数据操作
// ============================================================================

/**
 * 从 swarm_meta 获取值 / Retrieve a value from swarm_meta
 *
 * @param {string} key - 键 / Key
 * @returns {string | null} 值或 null / Value or null
 */
export function getMeta(key) {
  const db = getDb();
  const stmt = db.prepare('SELECT value FROM swarm_meta WHERE key = ?');
  const row = stmt.get(key);
  return row ? row.value : null;
}

/**
 * 向 swarm_meta 插入或更新值 / Insert or update a value in swarm_meta
 *
 * @param {string} key - 键 / Key
 * @param {string} value - 值 / Value
 */
export function setMeta(key, value) {
  const db = getDb();
  const stmt = db.prepare('INSERT OR REPLACE INTO swarm_meta (key, value) VALUES (?, ?)');
  stmt.run(key, value);
}

// ============================================================================
// ═══ MEMORY OPERATIONS (from OME) ═══ 记忆操作（来自 OME）
// ============================================================================

/**
 * 写入一条记忆 / Write a memory entry
 *
 * @param {{
 *   scope: string,
 *   layer: string,
 *   agentId: string,
 *   content: string,
 *   importance?: number,
 *   tags?: string[],
 *   date?: string,
 *   expiresAt?: number
 * }} params
 * @returns {string} 记忆 ID / Memory ID
 */
export function writeMemory({ scope, layer, agentId, content, importance, tags, date, expiresAt }) {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  const dateStr = date || new Date().toISOString().split('T')[0];

  const stmt = db.prepare(`
    INSERT INTO memories (id, scope, layer, agent_id, content, importance, tags, date, version, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `);
  stmt.run(
    id, scope, layer, agentId, content,
    importance ?? 0.5,
    tags ? JSON.stringify(tags) : null,
    dateStr, now, now,
    expiresAt ?? null
  );
  return id;
}

/**
 * 按条件读取记忆（排除已过期） / Read memories by filters (excludes expired)
 *
 * @param {{
 *   scope?: string,
 *   layer?: string,
 *   agentId?: string,
 *   date?: string,
 *   limit?: number
 * }} [params={}]
 * @returns {Array<Object>} 记忆列表 / List of memory objects
 */
export function readMemories({ scope, layer, agentId, date, limit } = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  if (scope) { conditions.push('scope = ?'); params.push(scope); }
  if (layer) { conditions.push('layer = ?'); params.push(layer); }
  if (agentId) { conditions.push('agent_id = ?'); params.push(agentId); }
  if (date) { conditions.push('date = ?'); params.push(date); }

  // 排除已过期记忆 / Exclude expired memories
  conditions.push('(expires_at IS NULL OR expires_at > ?)');
  params.push(Date.now());

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = limit ? `LIMIT ${Number(limit)}` : 'LIMIT 100';

  const stmt = db.prepare(`SELECT * FROM memories ${where} ORDER BY created_at DESC ${limitClause}`);
  const rows = stmt.all(...params);
  return rows.map(row => ({
    ...row,
    tags: row.tags ? JSON.parse(row.tags) : null,
  }));
}

/**
 * 按日期范围读取记忆 / Read memories by date range
 *
 * @param {string} startDate - 开始日期 YYYY-MM-DD / Start date
 * @param {string} endDate - 结束日期 YYYY-MM-DD / End date
 * @param {{ agentId?: string, layer?: string }} [opts={}] - 附加过滤 / Additional filters
 * @returns {Array<Object>} 记忆列表 / List of memory objects
 */
export function readMemoriesByDateRange(startDate, endDate, opts = {}) {
  const db = getDb();
  const conditions = ['date >= ?', 'date <= ?'];
  const params = [startDate, endDate];

  if (opts.agentId) { conditions.push('agent_id = ?'); params.push(opts.agentId); }
  if (opts.layer) { conditions.push('layer = ?'); params.push(opts.layer); }

  // 排除已过期记忆 / Exclude expired memories
  conditions.push('(expires_at IS NULL OR expires_at > ?)');
  params.push(Date.now());

  const stmt = db.prepare(`SELECT * FROM memories WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC LIMIT 500`);
  return stmt.all(...params).map(row => ({
    ...row,
    tags: row.tags ? JSON.parse(row.tags) : null,
  }));
}

/**
 * 保存检查点 / Save a checkpoint
 *
 * @param {{
 *   agentId: string,
 *   sessionId: string,
 *   trigger: string,
 *   mechanical: object,
 *   summary?: object | null
 * }} params
 * @returns {string} 检查点 ID / Checkpoint ID
 */
export function saveCheckpoint({ agentId, sessionId, trigger, mechanical, summary }) {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO checkpoints (id, agent_id, session_id, trigger, mechanical, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id, agentId, sessionId, trigger,
    JSON.stringify(mechanical),
    summary ? JSON.stringify(summary) : null,
    now
  );
  return id;
}

/**
 * 获取代理的最新检查点 / Get the latest checkpoint for an agent
 *
 * @param {string} agentId - 代理 ID / Agent ID
 * @returns {Object | null} 检查点对象（JSON 字段已解析）/ Checkpoint object (JSON fields parsed)
 */
export function getLatestCheckpoint(agentId) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM checkpoints WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1');
  const row = stmt.get(agentId);
  if (!row) return null;
  return {
    ...row,
    mechanical: JSON.parse(row.mechanical),
    summary: row.summary ? JSON.parse(row.summary) : null,
  };
}

/**
 * 获取代理的最近检查点 / Get recent checkpoints for an agent
 *
 * @param {string} agentId - 代理 ID / Agent ID
 * @param {number} [limit=3] - 返回数量 / Number to return
 * @returns {Array<Object>} 检查点列表（JSON 字段已解析）/ List of checkpoints (JSON fields parsed)
 */
export function getRecentCheckpoints(agentId, limit = 3) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM checkpoints WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?');
  const rows = stmt.all(agentId, limit);
  return rows.map(row => ({
    ...row,
    mechanical: JSON.parse(row.mechanical),
    summary: row.summary ? JSON.parse(row.summary) : null,
  }));
}

/**
 * 获取每日摘要 / Get daily summary
 *
 * @param {string} date - 日期 YYYY-MM-DD / Date
 * @param {string} [agentId='_all'] - 代理 ID / Agent ID
 * @returns {Object | null} 摘要对象（JSON 字段已解析）/ Summary object (JSON fields parsed)
 */
export function getDailySummary(date, agentId = '_all') {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM daily_summaries WHERE date = ? AND agent_id = ?');
  const row = stmt.get(date, agentId);
  if (!row) return null;
  return {
    ...row,
    topics: row.topics ? JSON.parse(row.topics) : null,
    stats: row.stats ? JSON.parse(row.stats) : null,
  };
}

/**
 * 插入或更新每日摘要 / Upsert daily summary
 *
 * @param {{
 *   date: string,
 *   agentId: string,
 *   summary: string,
 *   topics?: string[],
 *   stats?: object
 * }} params
 */
export function upsertDailySummary({ date, agentId, summary, topics, stats }) {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO daily_summaries (date, agent_id, summary, topics, stats, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, agent_id) DO UPDATE SET
      summary = excluded.summary,
      topics = excluded.topics,
      stats = excluded.stats,
      updated_at = excluded.updated_at
  `);
  stmt.run(
    date, agentId, summary,
    topics ? JSON.stringify(topics) : null,
    stats ? JSON.stringify(stats) : null,
    now, now
  );
}

/**
 * 获取代理的事件游标 / Get event cursor for an agent
 *
 * @param {string} agentId - 代理 ID / Agent ID
 * @returns {number} 最后处理的事件 ID / Last processed event ID
 */
export function getEventCursor(agentId) {
  const db = getDb();
  const stmt = db.prepare('SELECT last_event_id FROM event_cursors WHERE agent_id = ?');
  const row = stmt.get(agentId);
  return row ? row.last_event_id : 0;
}

/**
 * 更新代理的事件游标 / Update event cursor for an agent
 *
 * @param {string} agentId - 代理 ID / Agent ID
 * @param {number} lastEventId - 最后处理的事件 ID / Last processed event ID
 */
export function updateEventCursor(agentId, lastEventId) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO event_cursors (agent_id, last_event_id)
    VALUES (?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET last_event_id = excluded.last_event_id
  `);
  stmt.run(agentId, lastEventId);
}

// ============================================================================
// ═══ SWARM ORCHESTRATION OPERATIONS (from v3.0) ═══ 蜂群编排操作（来自 v3.0）
// ============================================================================

/**
 * 创建蜂群任务 / Create a swarm task
 *
 * @param {string} id - 任务 ID / Task ID
 * @param {string | object} config - 任务配置（自动序列化为 JSON）/ Task configuration (auto-serialized to JSON)
 * @param {string} [strategy='simulated'] - 执行策略 / Execution strategy
 * @returns {string} 任务 ID / Task ID
 */
export function createSwarmTask(id, config, strategy = 'simulated') {
  const db = getDb();
  const configStr = typeof config === 'string' ? config : JSON.stringify(config);

  const stmt = db.prepare(`
    INSERT INTO swarm_tasks (id, config, status, strategy)
    VALUES (?, ?, 'pending', ?)
  `);
  stmt.run(id, configStr, strategy);
  return id;
}

/**
 * 获取蜂群任务 / Get a swarm task by ID
 *
 * @param {string} id - 任务 ID / Task ID
 * @returns {Object | null} 任务对象（config 已解析）/ Task object (config parsed)
 */
export function getSwarmTask(id) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM swarm_tasks WHERE id = ?');
  const row = stmt.get(id);
  if (!row) return null;
  return {
    ...row,
    config: JSON.parse(row.config),
  };
}

/**
 * 更新蜂群任务状态 / Update swarm task status
 *
 * @param {string} id - 任务 ID / Task ID
 * @param {string} status - 新状态 / New status
 * @param {string | null} [error=null] - 错误信息 / Error message
 */
export function updateSwarmTaskStatus(id, status, error = null) {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE swarm_tasks
    SET status = ?, error = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  stmt.run(status, error, id);
}

/**
 * 列出蜂群任务 / List swarm tasks
 *
 * @param {string | null} [statusFilter=null] - 按状态过滤 / Filter by status
 * @returns {Array<Object>} 任务列表（config 已解析）/ Task list (config parsed)
 */
export function listSwarmTasks(statusFilter = null) {
  const db = getDb();
  let rows;
  if (statusFilter) {
    const stmt = db.prepare('SELECT * FROM swarm_tasks WHERE status = ? ORDER BY created_at DESC');
    rows = stmt.all(statusFilter);
  } else {
    const stmt = db.prepare('SELECT * FROM swarm_tasks ORDER BY created_at DESC');
    rows = stmt.all();
  }
  return rows.map(row => ({
    ...row,
    config: JSON.parse(row.config),
  }));
}

/**
 * 创建蜂群角色 / Create a swarm role
 *
 * @param {string} id - 角色 ID / Role ID
 * @param {string} taskId - 关联任务 ID / Parent task ID
 * @param {string} name - 角色名称 / Role name
 * @param {string | null} [description=null] - 角色描述 / Description
 * @param {string[] | string | null} [capabilities=null] - 能力列表（存储为 JSON）/ Capabilities (stored as JSON)
 * @param {number} [priority=0] - 执行优先级 / Execution priority
 * @param {string[] | string} [dependsOn='[]'] - 依赖列表（存储为 JSON）/ Dependency list (stored as JSON)
 */
export function createSwarmRole(id, taskId, name, description = null, capabilities = null, priority = 0, dependsOn = '[]') {
  const db = getDb();
  const capsStr = Array.isArray(capabilities) ? JSON.stringify(capabilities) : (capabilities || null);
  const depsStr = Array.isArray(dependsOn) ? JSON.stringify(dependsOn) : dependsOn;

  const stmt = db.prepare(`
    INSERT INTO swarm_roles (id, task_id, name, description, capabilities, priority, depends_on)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, taskId, name, description, capsStr, priority, depsStr);
}

/**
 * 获取任务的所有角色 / Get all roles for a task
 *
 * @param {string} taskId - 任务 ID / Task ID
 * @returns {Array<Object>} 角色列表（JSON 字段已解析）/ Role list (JSON fields parsed)
 */
export function getSwarmRolesByTask(taskId) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM swarm_roles WHERE task_id = ? ORDER BY priority ASC');
  const rows = stmt.all(taskId);
  return rows.map(row => ({
    ...row,
    capabilities: row.capabilities ? JSON.parse(row.capabilities) : null,
    depends_on: row.depends_on ? JSON.parse(row.depends_on) : [],
    result: row.result ? JSON.parse(row.result) : null,
  }));
}

/**
 * 更新蜂群角色状态 / Update swarm role status
 *
 * @param {string} id - 角色 ID / Role ID
 * @param {string} status - 新状态 / New status
 * @param {string | object | null} [result=null] - 结果数据 / Result data
 */
export function updateSwarmRoleStatus(id, status, result = null) {
  const db = getDb();
  const resultStr = result != null
    ? (typeof result === 'string' ? result : JSON.stringify(result))
    : null;

  const stmt = db.prepare('UPDATE swarm_roles SET status = ?, result = ? WHERE id = ?');
  stmt.run(status, resultStr, id);
}

/**
 * 保存蜂群检查点 / Save a swarm checkpoint
 *
 * @param {string} id - 检查点 ID / Checkpoint ID
 * @param {string} taskId - 关联任务 ID / Parent task ID
 * @param {string} roleName - 创建此检查点的角色 / Role that created this checkpoint
 * @param {string} trigger - 触发原因 / What triggered the checkpoint
 * @param {string | object} data - 检查点数据 / Checkpoint data
 */
export function saveSwarmCheckpoint(id, taskId, roleName, trigger, data) {
  const db = getDb();
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data);

  const stmt = db.prepare(`
    INSERT INTO swarm_checkpoints (id, task_id, role_name, trigger, data)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, taskId, roleName, trigger, dataStr);
}

/**
 * 获取任务的所有蜂群检查点 / Get all swarm checkpoints for a task
 *
 * @param {string} taskId - 任务 ID / Task ID
 * @returns {Array<Object>} 检查点列表（data 已解析）/ Checkpoint list (data parsed)
 */
export function getSwarmCheckpoints(taskId) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM swarm_checkpoints WHERE task_id = ? ORDER BY created_at ASC');
  const rows = stmt.all(taskId);
  return rows.map(row => ({
    ...row,
    data: JSON.parse(row.data),
  }));
}

/**
 * 创建蜂群工件 / Create a swarm artifact
 *
 * @param {string} id - 工件 ID / Artifact ID
 * @param {string} taskId - 关联任务 ID / Parent task ID
 * @param {string} roleName - 产出角色 / Role that produced this artifact
 * @param {string} type - 工件类型 / Artifact type (e.g. 'file', 'log', 'report')
 * @param {string | null} [artifactPath=null] - 文件路径 / File system path
 * @param {string | null} [content=null] - 内容 / Inline content
 */
export function createSwarmArtifact(id, taskId, roleName, type, artifactPath = null, content = null) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO swarm_artifacts (id, task_id, role_name, type, path, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, taskId, roleName, type, artifactPath, content);
}

/**
 * 获取任务的所有工件 / Get all artifacts for a task
 *
 * @param {string} taskId - 任务 ID / Task ID
 * @returns {Array<Object>} 工件列表 / Artifact list
 */
export function getSwarmArtifactsByTask(taskId) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM swarm_artifacts WHERE task_id = ? ORDER BY created_at ASC');
  return stmt.all(taskId);
}

/**
 * 获取分布式锁 / Acquire a distributed lock
 * 仅在锁不存在或已过期时获取成功。
 * Only succeeds if the lock does not exist or has expired.
 *
 * @param {string} resource - 被锁定的资源 / Resource to lock
 * @param {string} owner - 锁持有者 / Lock owner
 * @param {number} ttlMs - 锁存活时间（毫秒）/ Lock time-to-live in milliseconds
 * @returns {boolean} 是否成功获取 / Whether the lock was acquired
 */
export function acquireLock(resource, owner, ttlMs) {
  const db = getDb();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  // 先清理已过期的锁 / Clean up expired locks first
  const cleanStmt = db.prepare("DELETE FROM swarm_locks WHERE resource = ? AND expires_at < datetime('now')");
  cleanStmt.run(resource);

  // 尝试插入（如果已存在则失败）/ Try to insert (fails if already exists)
  try {
    const stmt = db.prepare(`
      INSERT INTO swarm_locks (resource, owner, acquired_at, expires_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(resource, owner, now, expiresAt);
    return true;
  } catch {
    // 锁已被其他持有者持有 / Lock already held by another owner
    return false;
  }
}

/**
 * 释放分布式锁 / Release a distributed lock
 *
 * @param {string} resource - 被锁定的资源 / Resource to unlock
 * @param {string} owner - 锁持有者 / Lock owner
 * @returns {boolean} 是否成功释放 / Whether the lock was released
 */
export function releaseLock(resource, owner) {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM swarm_locks WHERE resource = ? AND owner = ?');
  const result = stmt.run(resource, owner);
  return result.changes > 0;
}

/**
 * 检查资源是否被锁定 / Check if a resource is locked
 *
 * @param {string} resource - 资源标识 / Resource identifier
 * @returns {boolean} 是否被锁定（且未过期）/ Whether the resource is locked (and not expired)
 */
export function isLocked(resource) {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM swarm_locks WHERE resource = ? AND expires_at >= datetime('now')");
  const row = stmt.get(resource);
  return !!row;
}

// ============================================================================
// ═══ GOVERNANCE OPERATIONS (from v3.0) ═══ 治理操作（来自 v3.0）
// ============================================================================

// ─── Agent CRUD ─── 代理管理 ────────────────────────────────────────────────

/**
 * 创建代理 / Create an agent
 *
 * @param {{
 *   id: string,
 *   name: string,
 *   role?: string,
 *   tier?: string,
 *   status?: string
 * }} params
 * @returns {string} 代理 ID / Agent ID
 */
export function createAgent(idOrObj, name, role = 'general', tier = 'trainee', status = 'active') {
  let id;
  if (typeof idOrObj === 'object' && idOrObj !== null) {
    ({ id, name, role = 'general', tier = 'trainee', status = 'active' } = idOrObj);
  } else {
    id = idOrObj;
  }
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO agents (id, name, role, tier, status)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, name, role, tier, status);
  return id;
}

/**
 * 获取代理 / Get an agent by ID
 *
 * @param {string} id - 代理 ID / Agent ID
 * @returns {Object | null} 代理对象 / Agent object or null
 */
export function getAgent(id) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM agents WHERE id = ?');
  return stmt.get(id) || null;
}

/**
 * 更新代理（动态 SQL 构建部分更新）/ Update an agent (dynamic SQL for partial updates)
 *
 * @param {string} id - 代理 ID / Agent ID
 * @param {Object} updates - 要更新的字段 / Fields to update
 */
export function updateAgent(id, updates) {
  const db = getDb();
  const allowed = [
    'name', 'role', 'tier', 'status', 'total_score',
    'contribution_points', 'failure_count', 'success_count', 'last_active',
  ];
  const sets = [];
  const values = [];

  for (const [key, val] of Object.entries(updates)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  values.push(id);

  const stmt = db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`);
  stmt.run(...values);
}

/**
 * 列出代理 / List agents
 *
 * @param {string | null} [statusFilter=null] - 按状态过滤 / Filter by status
 * @returns {Array<Object>} 代理列表 / Agent list
 */
export function listAgents(statusFilter = null) {
  const db = getDb();
  if (statusFilter) {
    const stmt = db.prepare('SELECT * FROM agents WHERE status = ? ORDER BY total_score DESC');
    return stmt.all(statusFilter);
  }
  const stmt = db.prepare('SELECT * FROM agents ORDER BY total_score DESC');
  return stmt.all();
}

// ─── Capability CRUD ─── 能力管理 ───────────────────────────────────────────

/**
 * 创建或替换能力 / Create or replace a capability
 *
 * @param {string} agentId - 代理 ID / Agent ID
 * @param {string} dimension - 能力维度 / Capability dimension
 * @param {number} [score=50] - 分数 (0-100) / Score (0-100)
 */
export function createCapability(agentId, dimension, score = 50) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO capabilities (agent_id, dimension, score, updated_at)
    VALUES (?, ?, ?, datetime('now'))
  `);
  stmt.run(agentId, dimension, Math.max(0, Math.min(100, score)));
}

/**
 * 获取代理的所有能力 / Get all capabilities for an agent
 *
 * @param {string} agentId - 代理 ID / Agent ID
 * @returns {Array<Object>} 能力列表 / Capability list
 */
export function getCapabilities(agentId) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM capabilities WHERE agent_id = ?');
  return stmt.all(agentId);
}

/**
 * 更新能力分数 / Update a capability score
 *
 * @param {string} agentId - 代理 ID / Agent ID
 * @param {string} dimension - 能力维度 / Capability dimension
 * @param {number} score - 新分数 (0-100) / New score (0-100)
 */
export function updateCapabilityScore(agentId, dimension, score) {
  const db = getDb();
  const clamped = Math.max(0, Math.min(100, score));
  const stmt = db.prepare(`
    UPDATE capabilities SET score = ?, updated_at = datetime('now')
    WHERE agent_id = ? AND dimension = ?
  `);
  stmt.run(clamped, agentId, dimension);
}

// ─── Capability Detail CRUD ─── 能力详情管理 ────────────────────────────────

/**
 * 创建或替换能力子维度 / Create or replace a capability sub-dimension
 *
 * @param {string} agentId - 代理 ID / Agent ID
 * @param {string} dimension - 主维度 / Main dimension
 * @param {string} subDimension - 子维度 / Sub-dimension
 * @param {number} [score=50] - 分数 (0-100) / Score (0-100)
 */
export function createCapabilityDetail(agentId, dimension, subDimension, score = 50) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO capability_details (agent_id, dimension, sub_dimension, score, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(agentId, dimension, subDimension, Math.max(0, Math.min(100, score)));
}

/**
 * 获取代理某维度的详情 / Get capability details for an agent in a dimension
 *
 * @param {string} agentId - 代理 ID / Agent ID
 * @param {string} [dimension] - 主维度（可选过滤）/ Main dimension (optional filter)
 * @returns {Array<Object>} 详情列表 / Detail list
 */
export function getCapabilityDetails(agentId, dimension) {
  const db = getDb();
  if (dimension) {
    const stmt = db.prepare('SELECT * FROM capability_details WHERE agent_id = ? AND dimension = ?');
    return stmt.all(agentId, dimension);
  }
  const stmt = db.prepare('SELECT * FROM capability_details WHERE agent_id = ?');
  return stmt.all(agentId);
}

// ─── Skill CRUD ─── 技能管理 ────────────────────────────────────────────────

/**
 * 创建或替换技能 / Create or replace a skill
 *
 * @param {string} agentId - 代理 ID / Agent ID
 * @param {string} skillName - 技能名称 / Skill name
 * @param {string} [level='beginner'] - 技能水平 / Skill level
 * @param {string | null} [evidence=null] - 证据 / Evidence
 * @param {string | null} [verifiedBy=null] - 验证者 / Verified by
 * @param {string | null} [expiresAt=null] - 过期时间 / Expiration time
 */
export function createSkill(agentId, skillName, level = 'beginner', evidence = null, verifiedBy = null, expiresAt = null) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO skills (agent_id, skill_name, level, evidence, verified_by, expires_at, certified_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(agentId, skillName, level, evidence, verifiedBy, expiresAt);
}

/**
 * 获取代理的所有技能 / Get all skills for an agent
 *
 * @param {string} agentId - 代理 ID / Agent ID
 * @returns {Array<Object>} 技能列表 / Skill list
 */
export function getSkills(agentId) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM skills WHERE agent_id = ?');
  return stmt.all(agentId);
}

/**
 * 获取代理的特定技能水平 / Get an agent's specific skill level
 *
 * @param {string} agentId - 代理 ID / Agent ID
 * @param {string} skillName - 技能名称 / Skill name
 * @returns {string | null} 技能水平或 null / Skill level or null
 */
export function getAgentSkillLevel(agentId, skillName) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT level FROM skills
    WHERE agent_id = ? AND skill_name = ?
    AND (expires_at IS NULL OR expires_at > datetime('now'))
  `);
  const row = stmt.get(agentId, skillName);
  return row ? row.level : null;
}

// ─── Contribution CRUD ─── 贡献管理 ─────────────────────────────────────────

/**
 * 记录贡献 / Record a contribution
 *
 * @param {{
 *   agentId: string,
 *   taskId?: string,
 *   points?: number,
 *   category?: string,
 *   qualityScore?: number,
 *   impactScore?: number,
 *   metadata?: object
 * }} params
 */
export function createContribution(agentIdOrObj, taskId, points = 0, category = null, qualityScore = null, impactScore = null, metadata = null) {
  let agentId;
  if (typeof agentIdOrObj === 'object' && agentIdOrObj !== null) {
    ({ agentId, taskId, points = 0, category = null, qualityScore = null, impactScore = null, metadata = null } = agentIdOrObj);
  } else {
    agentId = agentIdOrObj;
  }
  const db = getDb();
  const metaStr = metadata != null
    ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata))
    : null;

  const stmt = db.prepare(`
    INSERT INTO contributions (agent_id, task_id, points, category, quality_score, impact_score, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(agentId, taskId, points, category, qualityScore, impactScore, metaStr);
}

/**
 * 获取代理的贡献记录 / Get contributions for an agent
 *
 * @param {string} agentId - 代理 ID / Agent ID
 * @param {number} [limit=50] - 返回数量 / Number to return
 * @returns {Array<Object>} 贡献列表 / Contribution list
 */
export function getContributions(agentId, limit = 50) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM contributions WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ?');
  return stmt.all(agentId, limit);
}

/**
 * 获取代理的总积分 / Get total contribution points for an agent
 *
 * @param {string} agentId - 代理 ID / Agent ID
 * @returns {number} 总积分 / Total points
 */
export function getTotalPoints(agentId) {
  const db = getDb();
  const stmt = db.prepare('SELECT COALESCE(SUM(points), 0) AS total FROM contributions WHERE agent_id = ?');
  const row = stmt.get(agentId);
  return row.total;
}

// ─── Vote CRUD ─── 投票管理 ─────────────────────────────────────────────────

/**
 * 创建投票记录 / Create a vote record
 *
 * @param {{
 *   voteId: string,
 *   voterId: string,
 *   targetId: string,
 *   voteType: string,
 *   choice: string,
 *   weight?: number,
 *   expiresAt?: string
 * }} params
 */
export function createVoteRecord(voteIdOrObj, voterId, targetId, voteType, choice, weight = 1, expiresAt = null) {
  let voteId;
  if (typeof voteIdOrObj === 'object' && voteIdOrObj !== null) {
    ({ voteId, voterId, targetId, voteType, choice, weight = 1, expiresAt = null } = voteIdOrObj);
  } else {
    voteId = voteIdOrObj;
  }
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO votes (vote_id, voter_id, target_id, vote_type, choice, weight, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(voteId, voterId, targetId, voteType, choice, weight, expiresAt);
}

/**
 * 获取投票议题的所有投票 / Get all votes for a vote topic
 *
 * @param {string} voteId - 投票议题 ID / Vote topic ID
 * @returns {Array<Object>} 投票列表 / Vote list
 */
export function getVotesByVoteId(voteId) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM votes WHERE vote_id = ? ORDER BY timestamp ASC');
  return stmt.all(voteId);
}

/**
 * 创建投票结果 / Create a vote result
 *
 * @param {{
 *   voteId: string,
 *   targetId: string,
 *   voteType: string,
 *   expiresAt?: string
 * }} params
 */
export function createVoteResult(voteIdOrObj, targetId, voteType, expiresAt = null) {
  let voteId;
  if (typeof voteIdOrObj === 'object' && voteIdOrObj !== null) {
    ({ voteId, targetId, voteType, expiresAt = null } = voteIdOrObj);
  } else {
    voteId = voteIdOrObj;
  }
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO vote_results (vote_id, target_id, vote_type, expires_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(voteId, targetId, voteType, expiresAt);
}

/**
 * 获取投票结果 / Get a vote result
 *
 * @param {string} voteId - 投票议题 ID / Vote topic ID
 * @returns {Object | null} 投票结果 / Vote result or null
 */
export function getVoteResult(voteId) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM vote_results WHERE vote_id = ?');
  return stmt.get(voteId) || null;
}

/**
 * 更新投票结果（动态 SQL）/ Update a vote result (dynamic SQL)
 *
 * @param {string} voteId - 投票议题 ID / Vote topic ID
 * @param {Object} updates - 要更新的字段 / Fields to update
 */
export function updateVoteResult(voteId, updates) {
  const db = getDb();
  const allowed = ['result', 'status', 'total_weight', 'approval_weight', 'rejection_weight', 'concluded_at'];
  const sets = [];
  const values = [];

  for (const [key, val] of Object.entries(updates)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (sets.length === 0) return;

  values.push(voteId);
  const stmt = db.prepare(`UPDATE vote_results SET ${sets.join(', ')} WHERE vote_id = ?`);
  stmt.run(...values);
}

// ─── Behavior Tag CRUD ─── 行为标签管理 ─────────────────────────────────────

/**
 * 添加或替换行为标签 / Add or replace a behavior tag
 *
 * @param {string} agentId - 代理 ID / Agent ID
 * @param {string} tag - 标签 / Tag
 * @param {number} [weight=1.0] - 权重 / Weight
 * @param {string} [source='auto'] - 来源 / Source
 */
export function addBehaviorTag(agentId, tag, weight = 1.0, source = 'auto') {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO behavior_tags (agent_id, tag, weight, source, assigned_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(agentId, tag, weight, source);
}

/**
 * 获取代理的所有行为标签 / Get all behavior tags for an agent
 *
 * @param {string} agentId - 代理 ID / Agent ID
 * @returns {Array<Object>} 标签列表 / Tag list
 */
export function getBehaviorTags(agentId) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM behavior_tags WHERE agent_id = ?');
  return stmt.all(agentId);
}

// ─── Collaboration CRUD ─── 协作管理 ────────────────────────────────────────

/**
 * 记录协作 / Record a collaboration
 * 自动标准化代理对顺序（字母序）以确保一致查询。
 * Automatically normalizes agent pair order (alphabetical) for consistent querying.
 *
 * @param {{
 *   agentAId: string,
 *   agentBId: string,
 *   taskId?: string,
 *   collaborationScore: number
 * }} params
 */
export function recordCollaboration(agentAIdOrObj, agentBId, taskId = null, collaborationScore) {
  let agentAId;
  if (typeof agentAIdOrObj === 'object' && agentAIdOrObj !== null) {
    ({ agentAId, agentBId, taskId = null, collaborationScore } = agentAIdOrObj);
  } else {
    agentAId = agentAIdOrObj;
  }
  const db = getDb();
  // 标准化配对顺序（字母序）/ Normalize pair order (alphabetical)
  const [a, b] = [agentAId, agentBId].sort();

  const stmt = db.prepare(`
    INSERT INTO collaboration_history (agent_a_id, agent_b_id, task_id, collaboration_score)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(a, b, taskId, collaborationScore);
}

/**
 * 获取两个代理的平均协作分数 / Get average collaboration score between two agents
 *
 * @param {string} agentAId - 代理 A ID / Agent A ID
 * @param {string} agentBId - 代理 B ID / Agent B ID
 * @returns {number | null} 平均分数或 null / Average score or null
 */
export function getCollaborationScore(agentAId, agentBId) {
  const db = getDb();
  // 标准化配对顺序 / Normalize pair order
  const [a, b] = [agentAId, agentBId].sort();

  const stmt = db.prepare(`
    SELECT AVG(collaboration_score) AS avg_score
    FROM collaboration_history
    WHERE agent_a_id = ? AND agent_b_id = ?
  `);
  const row = stmt.get(a, b);
  return row?.avg_score ?? null;
}

/**
 * 获取全局最高协作分数 / Get the global maximum collaboration score
 *
 * @returns {number | null} 最高分数或 null / Maximum score or null
 */
export function getMaxCollaborationScore() {
  const db = getDb();
  const stmt = db.prepare('SELECT MAX(collaboration_score) AS max_score FROM collaboration_history');
  const row = stmt.get();
  return row?.max_score ?? null;
}

// ─── Event Log CRUD ─── 事件日志管理 ────────────────────────────────────────

/**
 * 记录事件日志 / Log an event
 *
 * @param {string} eventType - 事件类型 / Event type
 * @param {string | null} [agentId=null] - 关联代理 ID / Related agent ID
 * @param {string | object | null} [details=null] - 详情 / Details
 * @param {string} [severity='info'] - 严重程度 / Severity level
 */
export function logEvent(eventType, agentId = null, details = null, severity = 'info') {
  const db = getDb();
  const detailsStr = details != null
    ? (typeof details === 'string' ? details : JSON.stringify(details))
    : null;

  const stmt = db.prepare(`
    INSERT INTO event_log (event_type, agent_id, details, severity)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(eventType, agentId, detailsStr, severity);
}

/**
 * 获取最近的事件日志 / Get recent event logs
 *
 * @param {number} [limit=50] - 返回数量 / Number to return
 * @param {string | null} [eventType=null] - 按事件类型过滤 / Filter by event type
 * @returns {Array<Object>} 事件日志列表 / Event log list
 */
export function getRecentEventLogs(limit = 50, eventType = null) {
  const db = getDb();
  if (eventType) {
    const stmt = db.prepare('SELECT * FROM event_log WHERE event_type = ? ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(eventType, limit);
  }
  const stmt = db.prepare('SELECT * FROM event_log ORDER BY timestamp DESC LIMIT ?');
  return stmt.all(limit);
}

// ─── Evaluation Queue CRUD ─── 评估队列管理 ─────────────────────────────────

/**
 * 将评估入队 / Enqueue an evaluation
 *
 * @param {string} agentId - 代理 ID / Agent ID
 * @param {string | object} updates - 更新数据 / Update data
 */
export function enqueueEvaluation(agentId, updates) {
  const db = getDb();
  const updatesStr = typeof updates === 'string' ? updates : JSON.stringify(updates);
  const stmt = db.prepare(`
    INSERT INTO evaluation_queue (agent_id, updates)
    VALUES (?, ?)
  `);
  stmt.run(agentId, updatesStr);
}

/**
 * 批量出队评估 / Dequeue evaluations in batch
 * 应在调用者的事务内使用。
 * Should be used within the caller's transaction.
 *
 * @param {number} [batchSize=10] - 批量大小 / Batch size
 * @returns {Array<Object>} 评估列表（updates 已解析）/ Evaluation list (updates parsed)
 */
export function dequeueEvaluations(batchSize = 10) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM evaluation_queue
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT ?
  `);
  const rows = stmt.all(batchSize);
  return rows.map(row => ({
    ...row,
    updates: JSON.parse(row.updates),
  }));
}

/**
 * 标记评估为已处理 / Mark an evaluation as processed
 *
 * @param {number} id - 评估记录 ID / Evaluation record ID
 */
export function markEvaluationProcessed(id) {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE evaluation_queue
    SET status = 'processed', processed_at = datetime('now')
    WHERE id = ?
  `);
  stmt.run(id);
}

/**
 * 获取待处理评估数量 / Get pending evaluation count
 *
 * @returns {number} 待处理数量 / Pending count
 */
export function getPendingEvaluationCount() {
  const db = getDb();
  const stmt = db.prepare("SELECT COUNT(*) AS cnt FROM evaluation_queue WHERE status = 'pending'");
  const row = stmt.get();
  return row.cnt;
}

/**
 * 获取投票者今日投票数 / Get votes count today for a voter
 *
 * @param {string} voterId - 投票者 ID / Voter ID
 * @returns {number} 今日投票数 / Today's vote count
 */
export function getVotesCountToday(voterId) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT COUNT(*) AS cnt FROM votes
    WHERE voter_id = ? AND timestamp > datetime('now', '-1 day')
  `);
  const row = stmt.get(voterId);
  return row.cnt;
}

/**
 * 获取代理的平均协作分数 / Get average collaboration score for an agent
 *
 * @param {string} agentId - 代理 ID / Agent ID
 * @returns {number | null} 平均分数或 null / Average score or null
 */
export function getAgentAvgCollaboration(agentId) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT AVG(collaboration_score) AS avg_score
    FROM collaboration_history
    WHERE agent_a_id = ? OR agent_b_id = ?
  `);
  const row = stmt.get(agentId, agentId);
  return row?.avg_score ?? null;
}

// ============================================================================
// ═══ PHEROMONE OPERATIONS (new v4.0) ═══ 信息素操作（v4.0 新增）
// ============================================================================

/**
 * 插入信息素 / Insert a pheromone
 *
 * @param {{
 *   id: string,
 *   type: string,
 *   sourceId: string,
 *   targetScope: string,
 *   intensity?: number,
 *   payload?: object,
 *   decayRate?: number,
 *   createdAt?: number,
 *   updatedAt?: number,
 *   expiresAt?: number
 * }} params
 */
export function insertPheromone({ id, type, sourceId, targetScope, intensity = 1.0, payload = null, decayRate = 0.01, createdAt, updatedAt, expiresAt = null }) {
  const db = getDb();
  const now = Date.now();
  const payloadStr = payload != null ? (typeof payload === 'string' ? payload : JSON.stringify(payload)) : null;

  const stmt = db.prepare(`
    INSERT INTO pheromones (id, type, source_id, target_scope, intensity, payload, decay_rate, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id, type, sourceId, targetScope,
    intensity, payloadStr, decayRate,
    createdAt ?? now,
    updatedAt ?? now,
    expiresAt ?? null
  );
}

/**
 * 插入或增强信息素（增量强度）/ Upsert a pheromone (reinforcement: add intensity)
 * 如果同类型+来源+范围已存在，则叠加强度并更新。
 * If the same type+source+scope already exists, adds intensity and updates.
 *
 * @param {{
 *   type: string,
 *   sourceId: string,
 *   targetScope: string,
 *   intensity?: number,
 *   payload?: object,
 *   decayRate?: number
 * }} params
 */
export function upsertPheromone({ type, sourceId, targetScope, intensity = 1.0, payload = null, decayRate = 0.01 }) {
  const db = getDb();
  const now = Date.now();
  const id = randomUUID();
  const payloadStr = payload != null ? (typeof payload === 'string' ? payload : JSON.stringify(payload)) : null;

  // 检查是否已存在相同信号 / Check if a matching signal already exists
  const existing = db.prepare(
    'SELECT id, intensity FROM pheromones WHERE type = ? AND source_id = ? AND target_scope = ?'
  ).get(type, sourceId, targetScope);

  if (existing) {
    // 增强：叠加强度 / Reinforce: add intensity
    const newIntensity = existing.intensity + intensity;
    const updateStmt = db.prepare(`
      UPDATE pheromones
      SET intensity = ?, payload = ?, decay_rate = ?, updated_at = ?
      WHERE id = ?
    `);
    updateStmt.run(newIntensity, payloadStr, decayRate, now, existing.id);
  } else {
    // 插入新信号 / Insert new signal
    const insertStmt = db.prepare(`
      INSERT INTO pheromones (id, type, source_id, target_scope, intensity, payload, decay_rate, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `);
    insertStmt.run(id, type, sourceId, targetScope, intensity, payloadStr, decayRate, now, now);
  }
}

/**
 * 按范围和类型查询信息素 / Query pheromones by scope and type
 *
 * @param {string} targetScope - 目标范围 / Target scope
 * @param {string | null} [type=null] - 信息素类型（可选过滤）/ Pheromone type (optional filter)
 * @param {number} [minIntensity=0] - 最低强度阈值 / Minimum intensity threshold
 * @returns {Array<Object>} 信息素列表（payload 已解析）/ Pheromone list (payload parsed)
 */
export function queryPheromones(targetScope, type = null, minIntensity = 0) {
  const db = getDb();
  const conditions = ['target_scope = ?', 'intensity >= ?'];
  const params = [targetScope, minIntensity];

  if (type) {
    conditions.push('type = ?');
    params.push(type);
  }

  // 排除已过期 / Exclude expired
  conditions.push('(expires_at IS NULL OR expires_at > ?)');
  params.push(Date.now());

  const sql = `SELECT * FROM pheromones WHERE ${conditions.join(' AND ')} ORDER BY intensity DESC`;
  const stmt = db.prepare(sql);
  const rows = stmt.all(...params);

  return rows.map(row => ({
    ...row,
    payload: row.payload ? JSON.parse(row.payload) : null,
  }));
}

/**
 * 更新信息素强度 / Update pheromone intensity
 *
 * @param {string} id - 信息素 ID / Pheromone ID
 * @param {number} newIntensity - 新强度 / New intensity
 * @param {number} [updatedAt] - 更新时间戳 / Updated timestamp
 */
export function updatePheromoneIntensity(id, newIntensity, updatedAt) {
  const db = getDb();
  const stmt = db.prepare('UPDATE pheromones SET intensity = ?, updated_at = ? WHERE id = ?');
  stmt.run(newIntensity, updatedAt ?? Date.now(), id);
}

/**
 * 删除已过期的信息素 / Delete expired pheromones
 *
 * @param {number} [nowMs] - 当前时间戳（毫秒）/ Current timestamp in milliseconds
 * @returns {number} 删除的行数 / Number of deleted rows
 */
export function deleteExpiredPheromones(nowMs) {
  const db = getDb();
  const now = nowMs ?? Date.now();
  const stmt = db.prepare('DELETE FROM pheromones WHERE expires_at IS NOT NULL AND expires_at < ?');
  const result = stmt.run(now);
  return result.changes;
}

/**
 * 统计信息素总数 / Count total pheromones
 *
 * @returns {number} 总数 / Total count
 */
export function countPheromones() {
  const db = getDb();
  const stmt = db.prepare('SELECT COUNT(*) AS cnt FROM pheromones');
  const row = stmt.get();
  return row.cnt;
}

// ============================================================================
// ═══ PERSONA EVOLUTION OPERATIONS (new v4.0) ═══ 人格进化操作（v4.0 新增）
// ============================================================================

/**
 * 记录人格执行结果 / Record a persona execution outcome
 *
 * @param {{
 *   personaId: string,
 *   taskType: string,
 *   success: boolean,
 *   qualityScore?: number,
 *   durationMs?: number,
 *   notes?: string
 * }} params
 */
export function recordPersonaOutcome({ personaId, taskType, success, qualityScore = null, durationMs = null, notes = null }) {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO persona_outcomes (persona_id, task_type, success, quality_score, duration_ms, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(personaId, taskType, success ? 1 : 0, qualityScore, durationMs, notes, now);
}

/**
 * 获取人格在特定任务类型上的统计 / Get persona stats for a specific task type
 * 返回：执行次数、成功率、平均质量分数。
 * Returns: count, success rate, average quality score.
 *
 * @param {string} personaId - 人格 ID / Persona ID
 * @param {string} [taskType] - 任务类型（可选过滤）/ Task type (optional filter)
 * @returns {{ count: number, successRate: number, avgQuality: number | null }}
 */
export function getPersonaStats(personaId, taskType) {
  const db = getDb();
  let stmt;
  let row;

  if (taskType) {
    stmt = db.prepare(`
      SELECT
        COUNT(*) AS count,
        COALESCE(AVG(success), 0) AS success_rate,
        AVG(quality_score) AS avg_quality
      FROM persona_outcomes
      WHERE persona_id = ? AND task_type = ?
    `);
    row = stmt.get(personaId, taskType);
  } else {
    stmt = db.prepare(`
      SELECT
        COUNT(*) AS count,
        COALESCE(AVG(success), 0) AS success_rate,
        AVG(quality_score) AS avg_quality
      FROM persona_outcomes
      WHERE persona_id = ?
    `);
    row = stmt.get(personaId);
  }

  return {
    count: row.count,
    successRate: row.success_rate,
    avgQuality: row.avg_quality ?? null,
  };
}

/**
 * 获取特定任务类型的最佳人格 / Get the best persona for a specific task type
 * 按成功率排序，至少需要 3 次执行记录。
 * Sorted by success rate; requires at least 3 execution records.
 *
 * @param {string} taskType - 任务类型 / Task type
 * @returns {{ personaId: string, count: number, successRate: number, avgQuality: number | null } | null}
 */
export function getBestPersona(taskType) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT
      persona_id,
      COUNT(*) AS count,
      AVG(success) AS success_rate,
      AVG(quality_score) AS avg_quality
    FROM persona_outcomes
    WHERE task_type = ?
    GROUP BY persona_id
    HAVING count >= 3
    ORDER BY success_rate DESC, avg_quality DESC
    LIMIT 1
  `);
  const row = stmt.get(taskType);
  if (!row) return null;
  return {
    personaId: row.persona_id,
    count: row.count,
    successRate: row.success_rate,
    avgQuality: row.avg_quality ?? null,
  };
}
