/**
 * @fileoverview Claw-Swarm v4.0 - Layer 1 Database Migration Module
 * @module layer1-core/db-migration
 * @author DEEP-IOS
 *
 * ============================================================================
 * 功能概述 / Function Overview
 * ============================================================================
 * 本模块负责 Claw-Swarm v4.0 统一数据库的版本迁移、备份和外部数据库导入。
 * This module handles version migration, backup, and external database import
 * for the Claw-Swarm v4.0 unified database.
 *
 * 迁移策略 / Migration Strategy:
 *   - 主 db.js 使用 CREATE TABLE IF NOT EXISTS 创建全部 25 张表
 *     Main db.js creates all 25 tables via CREATE TABLE IF NOT EXISTS
 *   - 迁移函数主要处理：版本追踪、ALTER TABLE 模式演化、数据导入
 *     Migration functions primarily handle: version tracking, ALTER TABLE schema evolution, data import
 *   - 版本链：v0 -> v1（核心表）-> v2（治理表）-> v3（信息素 + 人格进化表）
 *     Version chain: v0 -> v1 (core tables) -> v2 (governance tables) -> v3 (pheromone + persona tables)
 *
 * 导入支持 / Import Support:
 *   - importOmeDatabase():       从 OME 数据库导入记忆引擎数据
 *                                Import memory engine data from OME database
 *   - importSwarmLiteDatabase(): 从 Swarm Lite v3.0 导入编排/治理数据
 *                                Import orchestration/governance data from Swarm Lite v3.0
 * ============================================================================
 */

import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as db from './db.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/**
 * 当前模式版本 / Current schema version
 * 每次添加新迁移时递增。
 * Incremented each time a new migration is added.
 */
export const SCHEMA_VERSION = 3;

// ============================================================================
// 迁移入口 / Migration Entry Point
// ============================================================================

/**
 * 运行数据库迁移 / Run database migrations
 * 读取当前版本，按序列应用迁移，更新版本号。
 * Reads current version, applies migrations in sequence, updates version number.
 */
export function migrate() {
  const currentVersionStr = db.getMeta('schema_version');
  const currentVersion = currentVersionStr ? parseInt(currentVersionStr, 10) : 0;

  if (currentVersion >= SCHEMA_VERSION) return;

  // ── v0 -> v1：核心表（元数据 + 编排 + 记忆）──
  // ── v0 -> v1: Core tables (metadata + orchestration + memory) ──
  if (currentVersion < 1) {
    migrateV0ToV1();
  }

  // ── v1 -> v2：治理表（11 张表）──
  // ── v1 -> v2: Governance tables (11 tables) ──
  if (currentVersion < 2) {
    migrateV1ToV2();
  }

  // ── v2 -> v3：信息素 + 人格进化表 ──
  // ── v2 -> v3: Pheromone + persona evolution tables ──
  if (currentVersion < 3) {
    migrateV2ToV3();
  }
}

// ============================================================================
// 迁移函数 / Migration Functions
// ============================================================================

/**
 * 迁移 v0 -> v1：初始模式 / Migration v0 -> v1: Initial schema
 * 核心表已由 db.js 的 SCHEMA 常量通过 CREATE TABLE IF NOT EXISTS 创建。
 * Core tables are already created by db.js's SCHEMA constant via CREATE TABLE IF NOT EXISTS.
 * 此迁移仅记录版本号。
 * This migration only records the version number.
 *
 * 包含的表 / Tables included:
 *   - swarm_meta（元数据）/ swarm_meta (metadata)
 *   - memories, daily_summaries, checkpoints, events, tasks, event_cursors（记忆引擎）/ (memory engine)
 *   - swarm_tasks, swarm_roles, swarm_checkpoints, swarm_artifacts, swarm_locks（编排）/ (orchestration)
 */
function migrateV0ToV1() {
  const database = db.getDb();

  // 验证核心表存在 / Verify core tables exist
  const coreTables = [
    'swarm_meta', 'memories', 'daily_summaries', 'checkpoints',
    'events', 'tasks', 'event_cursors',
    'swarm_tasks', 'swarm_roles', 'swarm_checkpoints', 'swarm_artifacts', 'swarm_locks',
  ];

  for (const table of coreTables) {
    const row = database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(table);
    if (!row) {
      throw new Error(`Migration v0->v1 failed: expected table '${table}' not found. Ensure initDb() was called first.`);
    }
  }

  db.setMeta('schema_version', '1');
}

/**
 * 迁移 v1 -> v2：治理表 / Migration v1 -> v2: Governance tables
 * 11 张治理表已由 db.js 的 SCHEMA 常量创建。
 * 11 governance tables are already created by db.js's SCHEMA constant.
 * 此迁移验证表存在并记录版本号。
 * This migration verifies tables exist and records the version number.
 *
 * 包含的表 / Tables included:
 *   agents, capabilities, capability_details, skills, contributions,
 *   votes, vote_results, behavior_tags, collaboration_history,
 *   event_log, evaluation_queue
 */
function migrateV1ToV2() {
  const database = db.getDb();

  // 验证治理表存在 / Verify governance tables exist
  const governanceTables = [
    'agents', 'capabilities', 'capability_details', 'skills', 'contributions',
    'votes', 'vote_results', 'behavior_tags', 'collaboration_history',
    'event_log', 'evaluation_queue',
  ];

  for (const table of governanceTables) {
    const row = database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(table);
    if (!row) {
      throw new Error(`Migration v1->v2 failed: expected table '${table}' not found. Ensure initDb() was called first.`);
    }
  }

  db.setMeta('schema_version', '2');
}

/**
 * 迁移 v2 -> v3：信息素 + 人格进化 / Migration v2 -> v3: Pheromone + persona evolution
 * 这两张 v4.0 新表已由 db.js 的 SCHEMA 常量创建。
 * These two v4.0 tables are already created by db.js's SCHEMA constant.
 * 此迁移验证表存在并记录版本号。
 * This migration verifies tables exist and records the version number.
 *
 * 包含的表 / Tables included:
 *   pheromones, persona_outcomes
 */
function migrateV2ToV3() {
  const database = db.getDb();

  // 验证 v4.0 新表存在 / Verify v4.0 new tables exist
  const v4Tables = ['pheromones', 'persona_outcomes'];

  for (const table of v4Tables) {
    const row = database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(table);
    if (!row) {
      throw new Error(`Migration v2->v3 failed: expected table '${table}' not found. Ensure initDb() was called first.`);
    }
  }

  db.setMeta('schema_version', '3');
}

// ============================================================================
// 带备份的迁移 / Migration with Backup
// ============================================================================

/**
 * 自动备份后运行迁移 / Run migration with automatic backup
 * 在迁移前备份数据库文件，迁移在事务中执行。
 * Backs up the database file before migration. Migration runs within a transaction.
 *
 * @param {string} dbPath - 数据库文件路径 / Database file path
 */
export function migrateWithBackup(dbPath) {
  // 迁移前自动备份 / Auto-backup before migration
  if (fs.existsSync(dbPath)) {
    const backupPath = `${dbPath}.backup-${Date.now()}`;
    fs.copyFileSync(dbPath, backupPath);

    // 同时备份 WAL 和 SHM 文件（如果存在）/ Also backup WAL and SHM files if they exist
    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;
    if (fs.existsSync(walPath)) {
      fs.copyFileSync(walPath, `${backupPath}-wal`);
    }
    if (fs.existsSync(shmPath)) {
      fs.copyFileSync(shmPath, `${backupPath}-shm`);
    }
  }

  // 在事务中运行迁移 / Run migration within a transaction
  db.withTransaction(() => {
    migrate();
  });
}

// ============================================================================
// 外部数据库导入 / External Database Import
// ============================================================================

/**
 * 从 OME 数据库导入数据 / Import data from an OME database
 * 导入记忆引擎的 6 张表数据。幂等：通过 swarm_meta 标记防止重复导入。
 * Imports data from the 6 memory engine tables. Idempotent: uses swarm_meta flag to prevent duplicate imports.
 *
 * @param {string} omeDbPath - OME 数据库文件路径 / Path to the OME database file
 * @returns {{ memoriesImported: number, checkpointsImported: number, summariesImported: number, eventsImported: number, tasksImported: number, cursorsImported: number }}
 */
export function importOmeDatabase(omeDbPath) {
  // 检查是否已导入 / Check if already imported
  const alreadyImported = db.getMeta('ome_imported');
  if (alreadyImported === 'true') {
    return { memoriesImported: 0, checkpointsImported: 0, summariesImported: 0, eventsImported: 0, tasksImported: 0, cursorsImported: 0 };
  }

  if (!fs.existsSync(omeDbPath)) {
    throw new Error(`OME database not found at: ${omeDbPath}`);
  }

  // 以只读模式打开源数据库 / Open source database in read-only mode
  const srcDb = new DatabaseSync(omeDbPath, { readOnly: true });
  const destDb = db.getDb();

  const result = {
    memoriesImported: 0,
    checkpointsImported: 0,
    summariesImported: 0,
    eventsImported: 0,
    tasksImported: 0,
    cursorsImported: 0,
  };

  try {
    // ── 导入 memories / Import memories ──
    const memories = srcDb.prepare('SELECT * FROM memories').all();
    if (memories.length > 0) {
      const insertMem = destDb.prepare(`
        INSERT OR IGNORE INTO memories (id, scope, layer, agent_id, content, importance, tags, date, version, created_at, updated_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const m of memories) {
        insertMem.run(m.id, m.scope, m.layer, m.agent_id, m.content, m.importance, m.tags, m.date, m.version, m.created_at, m.updated_at, m.expires_at);
        result.memoriesImported++;
      }
    }

    // ── 导入 daily_summaries / Import daily summaries ──
    const summaries = srcDb.prepare('SELECT * FROM daily_summaries').all();
    if (summaries.length > 0) {
      const insertSum = destDb.prepare(`
        INSERT OR IGNORE INTO daily_summaries (date, agent_id, summary, topics, stats, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const s of summaries) {
        insertSum.run(s.date, s.agent_id, s.summary, s.topics, s.stats, s.created_at, s.updated_at);
        result.summariesImported++;
      }
    }

    // ── 导入 checkpoints / Import checkpoints ──
    const checkpoints = srcDb.prepare('SELECT * FROM checkpoints').all();
    if (checkpoints.length > 0) {
      const insertCp = destDb.prepare(`
        INSERT OR IGNORE INTO checkpoints (id, agent_id, session_id, trigger, mechanical, summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const c of checkpoints) {
        insertCp.run(c.id, c.agent_id, c.session_id, c.trigger, c.mechanical, c.summary, c.created_at);
        result.checkpointsImported++;
      }
    }

    // ── 导入 events / Import events ──
    try {
      const events = srcDb.prepare('SELECT * FROM events').all();
      if (events.length > 0) {
        const insertEv = destDb.prepare(`
          INSERT OR IGNORE INTO events (id, type, source_agent, scope, payload, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const e of events) {
          insertEv.run(e.id, e.type, e.source_agent, e.scope, e.payload, e.created_at);
          result.eventsImported++;
        }
      }
    } catch {
      // events 表可能不存在于旧版 OME / events table may not exist in older OME versions
    }

    // ── 导入 tasks / Import tasks ──
    try {
      const tasks = srcDb.prepare('SELECT * FROM tasks').all();
      if (tasks.length > 0) {
        const insertTask = destDb.prepare(`
          INSERT OR IGNORE INTO tasks (task_id, created_by, owner, acting_owner, participants, objective, status, data, version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const t of tasks) {
          insertTask.run(t.task_id, t.created_by, t.owner, t.acting_owner, t.participants, t.objective, t.status, t.data, t.version, t.created_at, t.updated_at);
          result.tasksImported++;
        }
      }
    } catch {
      // tasks 表可能不存在于旧版 OME / tasks table may not exist in older OME versions
    }

    // ── 导入 event_cursors / Import event cursors ──
    try {
      const cursors = srcDb.prepare('SELECT * FROM event_cursors').all();
      if (cursors.length > 0) {
        const insertCur = destDb.prepare(`
          INSERT OR IGNORE INTO event_cursors (agent_id, last_event_id)
          VALUES (?, ?)
        `);
        for (const c of cursors) {
          insertCur.run(c.agent_id, c.last_event_id);
          result.cursorsImported++;
        }
      }
    } catch {
      // event_cursors 表可能不存在于旧版 OME / event_cursors table may not exist in older OME versions
    }

    // 标记已导入 / Mark as imported
    db.setMeta('ome_imported', 'true');
    db.setMeta('ome_imported_at', new Date().toISOString());
    db.setMeta('ome_source_path', omeDbPath);

  } finally {
    try { srcDb.close(); } catch { /* ignore / 忽略 */ }
  }

  return result;
}

/**
 * 从 Swarm Lite v3.0 数据库导入数据 / Import data from a Swarm Lite v3.0 database
 * 导入编排表和治理表数据。幂等：通过 swarm_meta 标记防止重复导入。
 * Imports orchestration and governance table data. Idempotent: uses swarm_meta flag to prevent duplicate imports.
 *
 * @param {string} swarmLiteDbPath - Swarm Lite 数据库文件路径 / Path to the Swarm Lite database file
 * @returns {{ tasksImported: number, rolesImported: number, checkpointsImported: number, artifactsImported: number, agentsImported: number, governanceImported: boolean }}
 */
export function importSwarmLiteDatabase(swarmLiteDbPath) {
  // 检查是否已导入 / Check if already imported
  const alreadyImported = db.getMeta('swarmv3_imported');
  if (alreadyImported === 'true') {
    return { tasksImported: 0, rolesImported: 0, checkpointsImported: 0, artifactsImported: 0, agentsImported: 0, governanceImported: false };
  }

  if (!fs.existsSync(swarmLiteDbPath)) {
    throw new Error(`Swarm Lite database not found at: ${swarmLiteDbPath}`);
  }

  // 以只读模式打开源数据库 / Open source database in read-only mode
  const srcDb = new DatabaseSync(swarmLiteDbPath, { readOnly: true });
  const destDb = db.getDb();

  const result = {
    tasksImported: 0,
    rolesImported: 0,
    checkpointsImported: 0,
    artifactsImported: 0,
    agentsImported: 0,
    governanceImported: false,
  };

  try {
    // ══════════════════════════════════════════════════════════════════════════
    // 编排表导入 / Orchestration tables import
    // ══════════════════════════════════════════════════════════════════════════

    // ── 导入 swarm_tasks / Import swarm tasks ──
    const tasks = srcDb.prepare('SELECT * FROM swarm_tasks').all();
    if (tasks.length > 0) {
      const insertTask = destDb.prepare(`
        INSERT OR IGNORE INTO swarm_tasks (id, config, status, strategy, retry_count, error, idempotency_key, expired_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const t of tasks) {
        insertTask.run(t.id, t.config, t.status, t.strategy, t.retry_count, t.error, t.idempotency_key, t.expired_at, t.created_at, t.updated_at);
        result.tasksImported++;
      }
    }

    // ── 导入 swarm_roles / Import swarm roles ──
    const roles = srcDb.prepare('SELECT * FROM swarm_roles').all();
    if (roles.length > 0) {
      const insertRole = destDb.prepare(`
        INSERT OR IGNORE INTO swarm_roles (id, task_id, name, description, capabilities, priority, depends_on, status, result, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of roles) {
        insertRole.run(r.id, r.task_id, r.name, r.description, r.capabilities, r.priority, r.depends_on, r.status, r.result, r.created_at);
        result.rolesImported++;
      }
    }

    // ── 导入 swarm_checkpoints / Import swarm checkpoints ──
    const checkpoints = srcDb.prepare('SELECT * FROM swarm_checkpoints').all();
    if (checkpoints.length > 0) {
      const insertCp = destDb.prepare(`
        INSERT OR IGNORE INTO swarm_checkpoints (id, task_id, role_name, trigger, data, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const c of checkpoints) {
        insertCp.run(c.id, c.task_id, c.role_name, c.trigger, c.data, c.created_at);
        result.checkpointsImported++;
      }
    }

    // ── 导入 swarm_artifacts / Import swarm artifacts ──
    const artifacts = srcDb.prepare('SELECT * FROM swarm_artifacts').all();
    if (artifacts.length > 0) {
      const insertArt = destDb.prepare(`
        INSERT OR IGNORE INTO swarm_artifacts (id, task_id, role_name, type, path, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const a of artifacts) {
        insertArt.run(a.id, a.task_id, a.role_name, a.type, a.path, a.content, a.created_at);
        result.artifactsImported++;
      }
    }

    // ── 导入 swarm_locks（跳过——锁是瞬态的）/ Import swarm_locks (skip — locks are transient) ──
    // 锁不需要跨数据库保留 / Locks don't need to persist across databases

    // ══════════════════════════════════════════════════════════════════════════
    // 治理表导入（如果存在）/ Governance tables import (if they exist)
    // ══════════════════════════════════════════════════════════════════════════

    const hasGovernance = srcDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='agents'"
    ).get();

    if (hasGovernance) {
      result.governanceImported = true;

      // ── 导入 agents / Import agents ──
      const agents = srcDb.prepare('SELECT * FROM agents').all();
      if (agents.length > 0) {
        const insertAgent = destDb.prepare(`
          INSERT OR IGNORE INTO agents (id, name, role, tier, status, total_score, contribution_points, failure_count, success_count, created_at, updated_at, last_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const a of agents) {
          insertAgent.run(a.id, a.name, a.role, a.tier, a.status, a.total_score, a.contribution_points, a.failure_count, a.success_count, a.created_at, a.updated_at, a.last_active);
          result.agentsImported++;
        }
      }

      // ── 导入 capabilities / Import capabilities ──
      try {
        const caps = srcDb.prepare('SELECT * FROM capabilities').all();
        if (caps.length > 0) {
          const insertCap = destDb.prepare(`
            INSERT OR IGNORE INTO capabilities (agent_id, dimension, score, updated_at)
            VALUES (?, ?, ?, ?)
          `);
          for (const c of caps) {
            insertCap.run(c.agent_id, c.dimension, c.score, c.updated_at);
          }
        }
      } catch { /* table may not exist / 表可能不存在 */ }

      // ── 导入 capability_details / Import capability details ──
      try {
        const details = srcDb.prepare('SELECT * FROM capability_details').all();
        if (details.length > 0) {
          const insertDetail = destDb.prepare(`
            INSERT OR IGNORE INTO capability_details (agent_id, dimension, sub_dimension, score, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `);
          for (const d of details) {
            insertDetail.run(d.agent_id, d.dimension, d.sub_dimension, d.score, d.updated_at);
          }
        }
      } catch { /* table may not exist / 表可能不存在 */ }

      // ── 导入 skills / Import skills ──
      try {
        const skills = srcDb.prepare('SELECT * FROM skills').all();
        if (skills.length > 0) {
          const insertSkill = destDb.prepare(`
            INSERT OR IGNORE INTO skills (agent_id, skill_name, level, certified_at, expires_at, evidence, verified_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `);
          for (const s of skills) {
            insertSkill.run(s.agent_id, s.skill_name, s.level, s.certified_at, s.expires_at, s.evidence, s.verified_by);
          }
        }
      } catch { /* table may not exist / 表可能不存在 */ }

      // ── 导入 contributions / Import contributions ──
      try {
        const contribs = srcDb.prepare('SELECT * FROM contributions').all();
        if (contribs.length > 0) {
          const insertContrib = destDb.prepare(`
            INSERT OR IGNORE INTO contributions (agent_id, task_id, points, category, quality_score, impact_score, timestamp, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const c of contribs) {
            insertContrib.run(c.agent_id, c.task_id, c.points, c.category, c.quality_score, c.impact_score, c.timestamp, c.metadata);
          }
        }
      } catch { /* table may not exist / 表可能不存在 */ }

      // ── 导入 votes / Import votes ──
      try {
        const votes = srcDb.prepare('SELECT * FROM votes').all();
        if (votes.length > 0) {
          const insertVote = destDb.prepare(`
            INSERT OR IGNORE INTO votes (vote_id, voter_id, target_id, vote_type, choice, weight, timestamp, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const v of votes) {
            insertVote.run(v.vote_id, v.voter_id, v.target_id, v.vote_type, v.choice, v.weight, v.timestamp, v.expires_at);
          }
        }
      } catch { /* table may not exist / 表可能不存在 */ }

      // ── 导入 vote_results / Import vote results ──
      try {
        const voteResults = srcDb.prepare('SELECT * FROM vote_results').all();
        if (voteResults.length > 0) {
          const insertVR = destDb.prepare(`
            INSERT OR IGNORE INTO vote_results (vote_id, target_id, vote_type, result, status, total_weight, approval_weight, rejection_weight, expires_at, concluded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const vr of voteResults) {
            insertVR.run(vr.vote_id, vr.target_id, vr.vote_type, vr.result, vr.status, vr.total_weight, vr.approval_weight, vr.rejection_weight, vr.expires_at, vr.concluded_at);
          }
        }
      } catch { /* table may not exist / 表可能不存在 */ }

      // ── 导入 behavior_tags / Import behavior tags ──
      try {
        const tags = srcDb.prepare('SELECT * FROM behavior_tags').all();
        if (tags.length > 0) {
          const insertTag = destDb.prepare(`
            INSERT OR IGNORE INTO behavior_tags (agent_id, tag, weight, assigned_at, source)
            VALUES (?, ?, ?, ?, ?)
          `);
          for (const t of tags) {
            insertTag.run(t.agent_id, t.tag, t.weight, t.assigned_at, t.source);
          }
        }
      } catch { /* table may not exist / 表可能不存在 */ }

      // ── 导入 collaboration_history / Import collaboration history ──
      try {
        const collabs = srcDb.prepare('SELECT * FROM collaboration_history').all();
        if (collabs.length > 0) {
          const insertCollab = destDb.prepare(`
            INSERT OR IGNORE INTO collaboration_history (agent_a_id, agent_b_id, task_id, collaboration_score, timestamp)
            VALUES (?, ?, ?, ?, ?)
          `);
          for (const c of collabs) {
            insertCollab.run(c.agent_a_id, c.agent_b_id, c.task_id, c.collaboration_score, c.timestamp);
          }
        }
      } catch { /* table may not exist / 表可能不存在 */ }

      // ── 导入 event_log / Import event log ──
      try {
        const logs = srcDb.prepare('SELECT * FROM event_log').all();
        if (logs.length > 0) {
          const insertLog = destDb.prepare(`
            INSERT OR IGNORE INTO event_log (event_type, agent_id, details, severity, timestamp)
            VALUES (?, ?, ?, ?, ?)
          `);
          for (const l of logs) {
            insertLog.run(l.event_type, l.agent_id, l.details, l.severity, l.timestamp);
          }
        }
      } catch { /* table may not exist / 表可能不存在 */ }

      // ── 导入 evaluation_queue / Import evaluation queue ──
      try {
        const evals = srcDb.prepare('SELECT * FROM evaluation_queue').all();
        if (evals.length > 0) {
          const insertEval = destDb.prepare(`
            INSERT OR IGNORE INTO evaluation_queue (agent_id, updates, status, created_at, processed_at)
            VALUES (?, ?, ?, ?, ?)
          `);
          for (const e of evals) {
            insertEval.run(e.agent_id, e.updates, e.status, e.created_at, e.processed_at);
          }
        }
      } catch { /* table may not exist / 表可能不存在 */ }
    }

    // 标记已导入 / Mark as imported
    db.setMeta('swarmv3_imported', 'true');
    db.setMeta('swarmv3_imported_at', new Date().toISOString());
    db.setMeta('swarmv3_source_path', swarmLiteDbPath);

  } finally {
    try { srcDb.close(); } catch { /* ignore / 忽略 */ }
  }

  return result;
}
