/**
 * database-schemas.js
 * Claw-Swarm V5.1 - Complete Database Schema Definitions
 * Claw-Swarm V5.1 - 完全なデータベーススキーマ定義
 *
 * Defines ALL 38 table DDL statements, PRAGMA settings,
 * and the createAllTables() bootstrap function.
 * 全38テーブルのDDL文、PRAGMAの設定、およびcreateAllTables()ブートストラップ関数を定義する。
 *
 * Tables breakdown:
 *   - Metadata:              1 table   (swarm_meta)
 *   - Memory Engine Legacy:  6 tables  (memories, daily_summaries, checkpoints, events, tasks, event_cursors)
 *   - Swarm Orchestration:   5 tables  (swarm_tasks, swarm_roles, swarm_checkpoints, swarm_artifacts, swarm_locks)
 *   - Governance:           11 tables  (agents .. evaluation_queue)
 *   - Pheromone:             1 table   (pheromones)
 *   - Persona:               1 table   (persona_outcomes)
 *   - Orchestration Stats:   2 tables  (role_execution_stats, task_state_transitions)
 *   - NEW V5.0:              7 tables  (knowledge_nodes .. execution_plans)
 *   - NEW V5.1:              4 tables  (breaker_state, repair_memory, dead_letter_tasks, task_affinity)
 *   Total:                  38 tables
 */

'use strict';

// ---------------------------------------------------------------------------
// Schema version / スキーマバージョン
// ---------------------------------------------------------------------------
const SCHEMA_VERSION = 6;

// ---------------------------------------------------------------------------
// PRAGMA settings (inherited from v4.x, tuned for WAL + concurrent reads)
// PRAGMA設定（v4.xから継承、WAL + 並行読み取り向けに最適化）
// ---------------------------------------------------------------------------
const PRAGMA_SETTINGS = [
  'PRAGMA journal_mode = WAL',        // Write-Ahead Logging for concurrency / 並行処理用WALモード
  'PRAGMA synchronous = NORMAL',      // Balance durability vs speed / 耐久性と速度のバランス
  'PRAGMA busy_timeout = 5000',       // Wait up to 5s on lock contention / ロック競合時に最大5秒待機
  'PRAGMA foreign_keys = ON',         // Enforce referential integrity / 参照整合性を強制
  'PRAGMA cache_size = -8000',        // ~8 MB page cache / 約8MBのページキャッシュ
  'PRAGMA mmap_size = 268435456',     // 256 MB memory-mapped I/O / 256MBのメモリマップドI/O
];

// ---------------------------------------------------------------------------
// Table schemas / テーブルスキーマ
// Each entry: { name, sql, indexes }
// ---------------------------------------------------------------------------
const TABLE_SCHEMAS = [

  // =========================================================================
  //  1. METADATA / メタデータ  (1 table)
  // =========================================================================

  {
    // swarm_meta - Key-value store for system metadata
    // swarm_meta - システムメタデータ用のキーバリューストア
    name: 'swarm_meta',
    sql: `
      CREATE TABLE IF NOT EXISTS swarm_meta (
        key   TEXT PRIMARY KEY,
        value TEXT
      )
    `,
    indexes: [],
  },

  // =========================================================================
  //  2. MEMORY ENGINE LEGACY / メモリエンジンレガシー  (6 tables)
  //     Kept for migration compatibility from v4.x
  //     v4.xからのマイグレーション互換性のために維持
  // =========================================================================

  {
    // memories - Core memory entries with scope/layer taxonomy
    // memories - スコープ/レイヤー分類によるコアメモリエントリ
    name: 'memories',
    sql: `
      CREATE TABLE IF NOT EXISTS memories (
        id          TEXT PRIMARY KEY,
        scope       TEXT NOT NULL,
        layer       TEXT NOT NULL,
        agent_id    TEXT,
        content     TEXT NOT NULL,
        importance  REAL DEFAULT 0.5,
        tags        TEXT,
        date        TEXT,
        version     INTEGER DEFAULT 1,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at  TEXT
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_memories_scope       ON memories (scope)',
      'CREATE INDEX IF NOT EXISTS idx_memories_layer       ON memories (layer)',
      'CREATE INDEX IF NOT EXISTS idx_memories_agent_id    ON memories (agent_id)',
      'CREATE INDEX IF NOT EXISTS idx_memories_importance  ON memories (importance DESC)',
      'CREATE INDEX IF NOT EXISTS idx_memories_date        ON memories (date)',
      'CREATE INDEX IF NOT EXISTS idx_memories_expires_at  ON memories (expires_at)',
    ],
  },

  {
    // daily_summaries - Aggregated daily summaries per agent
    // daily_summaries - エージェントごとの日次集約サマリー
    name: 'daily_summaries',
    sql: `
      CREATE TABLE IF NOT EXISTS daily_summaries (
        date       TEXT NOT NULL,
        agent_id   TEXT NOT NULL,
        summary    TEXT,
        topics     TEXT,
        stats      TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (date, agent_id)
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_daily_summaries_agent_id ON daily_summaries (agent_id)',
    ],
  },

  {
    // checkpoints - Session/agent checkpoints for recovery
    // checkpoints - リカバリ用のセッション/エージェントチェックポイント
    name: 'checkpoints',
    sql: `
      CREATE TABLE IF NOT EXISTS checkpoints (
        id          TEXT PRIMARY KEY,
        agent_id    TEXT,
        session_id  TEXT,
        trigger     TEXT,
        mechanical  TEXT,
        summary     TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_checkpoints_agent_id   ON checkpoints (agent_id)',
      'CREATE INDEX IF NOT EXISTS idx_checkpoints_session_id ON checkpoints (session_id)',
    ],
  },

  {
    // events - System event stream (append-only)
    // events - システムイベントストリーム（追記専用）
    name: 'events',
    sql: `
      CREATE TABLE IF NOT EXISTS events (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        type         TEXT NOT NULL,
        source_agent TEXT,
        scope        TEXT,
        payload      TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_events_type         ON events (type)',
      'CREATE INDEX IF NOT EXISTS idx_events_source_agent ON events (source_agent)',
      'CREATE INDEX IF NOT EXISTS idx_events_scope        ON events (scope)',
      'CREATE INDEX IF NOT EXISTS idx_events_created_at   ON events (created_at)',
    ],
  },

  {
    // tasks - Legacy task tracking (v4.x collaborative tasks)
    // tasks - レガシータスクトラッキング（v4.x共同タスク）
    name: 'tasks',
    sql: `
      CREATE TABLE IF NOT EXISTS tasks (
        task_id      TEXT PRIMARY KEY,
        created_by   TEXT,
        owner        TEXT,
        acting_owner TEXT,
        participants TEXT,
        objective    TEXT,
        status       TEXT DEFAULT 'pending',
        data         TEXT,
        version      INTEGER DEFAULT 1,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_tasks_owner   ON tasks (owner)',
      'CREATE INDEX IF NOT EXISTS idx_tasks_status  ON tasks (status)',
    ],
  },

  {
    // event_cursors - Per-agent read position in the event stream
    // event_cursors - イベントストリーム内のエージェントごとの読み取り位置
    name: 'event_cursors',
    sql: `
      CREATE TABLE IF NOT EXISTS event_cursors (
        agent_id      TEXT PRIMARY KEY,
        last_event_id INTEGER NOT NULL DEFAULT 0
      )
    `,
    indexes: [],
  },

  // =========================================================================
  //  3. SWARM ORCHESTRATION / スウォームオーケストレーション  (5 tables)
  // =========================================================================

  {
    // swarm_tasks - Top-level orchestrated tasks with idempotency
    // swarm_tasks - 冪等性を持つトップレベルのオーケストレーションタスク
    name: 'swarm_tasks',
    sql: `
      CREATE TABLE IF NOT EXISTS swarm_tasks (
        id              TEXT PRIMARY KEY,
        config          TEXT,
        status          TEXT NOT NULL DEFAULT 'pending',
        strategy        TEXT,
        retry_count     INTEGER DEFAULT 0,
        error           TEXT,
        idempotency_key TEXT UNIQUE,
        expired_at      TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_swarm_tasks_status     ON swarm_tasks (status)',
      'CREATE INDEX IF NOT EXISTS idx_swarm_tasks_created_at ON swarm_tasks (created_at)',
      'CREATE INDEX IF NOT EXISTS idx_swarm_tasks_expired_at ON swarm_tasks (expired_at)',
    ],
  },

  {
    // swarm_roles - Role assignments within a swarm task
    // swarm_roles - スウォームタスク内のロール割り当て
    name: 'swarm_roles',
    sql: `
      CREATE TABLE IF NOT EXISTS swarm_roles (
        id           TEXT PRIMARY KEY,
        task_id      TEXT NOT NULL REFERENCES swarm_tasks(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        description  TEXT,
        capabilities TEXT,
        priority     INTEGER DEFAULT 0,
        depends_on   TEXT,
        status       TEXT NOT NULL DEFAULT 'pending',
        result       TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_swarm_roles_task_id ON swarm_roles (task_id)',
      'CREATE INDEX IF NOT EXISTS idx_swarm_roles_status  ON swarm_roles (status)',
      'CREATE INDEX IF NOT EXISTS idx_swarm_roles_name    ON swarm_roles (name)',
    ],
  },

  {
    // swarm_checkpoints - Fine-grained checkpoints per role
    // swarm_checkpoints - ロールごとの細粒度チェックポイント
    name: 'swarm_checkpoints',
    sql: `
      CREATE TABLE IF NOT EXISTS swarm_checkpoints (
        id         TEXT PRIMARY KEY,
        task_id    TEXT NOT NULL REFERENCES swarm_tasks(id) ON DELETE CASCADE,
        role_name  TEXT,
        trigger    TEXT,
        data       TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_swarm_checkpoints_task_id   ON swarm_checkpoints (task_id)',
      'CREATE INDEX IF NOT EXISTS idx_swarm_checkpoints_role_name ON swarm_checkpoints (role_name)',
    ],
  },

  {
    // swarm_artifacts - Output artifacts produced by roles
    // swarm_artifacts - ロールが生成する出力アーティファクト
    name: 'swarm_artifacts',
    sql: `
      CREATE TABLE IF NOT EXISTS swarm_artifacts (
        id         TEXT PRIMARY KEY,
        task_id    TEXT NOT NULL REFERENCES swarm_tasks(id) ON DELETE CASCADE,
        role_name  TEXT,
        type       TEXT,
        path       TEXT,
        content    TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_swarm_artifacts_task_id   ON swarm_artifacts (task_id)',
      'CREATE INDEX IF NOT EXISTS idx_swarm_artifacts_role_name ON swarm_artifacts (role_name)',
      'CREATE INDEX IF NOT EXISTS idx_swarm_artifacts_type      ON swarm_artifacts (type)',
    ],
  },

  {
    // swarm_locks - Distributed resource locking with expiry
    // swarm_locks - 有効期限付き分散リソースロック
    name: 'swarm_locks',
    sql: `
      CREATE TABLE IF NOT EXISTS swarm_locks (
        resource    TEXT PRIMARY KEY,
        owner       TEXT NOT NULL,
        acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at  TEXT
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_swarm_locks_owner      ON swarm_locks (owner)',
      'CREATE INDEX IF NOT EXISTS idx_swarm_locks_expires_at ON swarm_locks (expires_at)',
    ],
  },

  // =========================================================================
  //  4. GOVERNANCE / ガバナンス  (11 tables)
  // =========================================================================

  {
    // agents - Agent registry with scoring and status tracking
    // agents - スコアリングとステータス追跡を持つエージェントレジストリ
    name: 'agents',
    sql: `
      CREATE TABLE IF NOT EXISTS agents (
        id                  TEXT PRIMARY KEY,
        name                TEXT NOT NULL,
        role                TEXT,
        tier                TEXT DEFAULT 'bronze',
        status              TEXT DEFAULT 'active',
        total_score         REAL DEFAULT 0,
        contribution_points REAL DEFAULT 0,
        failure_count       INTEGER DEFAULT 0,
        success_count       INTEGER DEFAULT 0,
        created_at          TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
        last_active         TEXT
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_agents_role        ON agents (role)',
      'CREATE INDEX IF NOT EXISTS idx_agents_tier        ON agents (tier)',
      'CREATE INDEX IF NOT EXISTS idx_agents_status      ON agents (status)',
      'CREATE INDEX IF NOT EXISTS idx_agents_total_score ON agents (total_score DESC)',
      'CREATE INDEX IF NOT EXISTS idx_agents_last_active ON agents (last_active)',
    ],
  },

  {
    // capabilities - Per-agent capability dimension scores
    // capabilities - エージェントごとの能力次元スコア
    name: 'capabilities',
    sql: `
      CREATE TABLE IF NOT EXISTS capabilities (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        dimension  TEXT NOT NULL,
        score      REAL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (agent_id, dimension)
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_capabilities_agent_id  ON capabilities (agent_id)',
      'CREATE INDEX IF NOT EXISTS idx_capabilities_dimension ON capabilities (dimension)',
    ],
  },

  {
    // capability_details - Granular sub-dimension capability scores
    // capability_details - 詳細なサブ次元の能力スコア
    name: 'capability_details',
    sql: `
      CREATE TABLE IF NOT EXISTS capability_details (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        dimension     TEXT NOT NULL,
        sub_dimension TEXT NOT NULL,
        score         REAL DEFAULT 0,
        updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (agent_id, dimension, sub_dimension)
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_capability_details_agent_id  ON capability_details (agent_id)',
      'CREATE INDEX IF NOT EXISTS idx_capability_details_dimension ON capability_details (dimension)',
    ],
  },

  {
    // skills - Certified skills per agent with expiry and evidence
    // skills - 有効期限とエビデンス付きのエージェントごとの認定スキル
    name: 'skills',
    sql: `
      CREATE TABLE IF NOT EXISTS skills (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        skill_name   TEXT NOT NULL,
        level        INTEGER DEFAULT 1,
        certified_at TEXT,
        expires_at   TEXT,
        evidence     TEXT,
        verified_by  TEXT,
        UNIQUE (agent_id, skill_name)
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_skills_agent_id   ON skills (agent_id)',
      'CREATE INDEX IF NOT EXISTS idx_skills_skill_name ON skills (skill_name)',
      'CREATE INDEX IF NOT EXISTS idx_skills_level      ON skills (level DESC)',
      'CREATE INDEX IF NOT EXISTS idx_skills_expires_at ON skills (expires_at)',
    ],
  },

  {
    // contributions - Quantified agent contributions with quality metrics
    // contributions - 品質メトリクス付きの定量化されたエージェント貢献
    name: 'contributions',
    sql: `
      CREATE TABLE IF NOT EXISTS contributions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        task_id       TEXT,
        points        REAL DEFAULT 0,
        category      TEXT,
        quality_score REAL,
        impact_score  REAL,
        timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
        metadata      TEXT
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_contributions_agent_id  ON contributions (agent_id)',
      'CREATE INDEX IF NOT EXISTS idx_contributions_task_id   ON contributions (task_id)',
      'CREATE INDEX IF NOT EXISTS idx_contributions_category  ON contributions (category)',
      'CREATE INDEX IF NOT EXISTS idx_contributions_timestamp ON contributions (timestamp)',
    ],
  },

  {
    // votes - Individual vote records for governance decisions
    // votes - ガバナンス決定のための個別投票記録
    name: 'votes',
    sql: `
      CREATE TABLE IF NOT EXISTS votes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        vote_id    TEXT NOT NULL,
        voter_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        target_id  TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        vote_type  TEXT NOT NULL,
        choice     TEXT NOT NULL,
        weight     REAL DEFAULT 1.0,
        timestamp  TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_votes_vote_id    ON votes (vote_id)',
      'CREATE INDEX IF NOT EXISTS idx_votes_voter_id   ON votes (voter_id)',
      'CREATE INDEX IF NOT EXISTS idx_votes_target_id  ON votes (target_id)',
      'CREATE INDEX IF NOT EXISTS idx_votes_vote_type  ON votes (vote_type)',
      'CREATE INDEX IF NOT EXISTS idx_votes_expires_at ON votes (expires_at)',
    ],
  },

  {
    // vote_results - Aggregated results of concluded votes
    // vote_results - 終了した投票の集約結果
    name: 'vote_results',
    sql: `
      CREATE TABLE IF NOT EXISTS vote_results (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        vote_id           TEXT NOT NULL UNIQUE,
        target_id         TEXT,
        vote_type         TEXT,
        result            TEXT,
        status            TEXT DEFAULT 'pending',
        total_weight      REAL DEFAULT 0,
        approval_weight   REAL DEFAULT 0,
        rejection_weight  REAL DEFAULT 0,
        expires_at        TEXT,
        concluded_at      TEXT
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_vote_results_target_id ON vote_results (target_id)',
      'CREATE INDEX IF NOT EXISTS idx_vote_results_vote_type ON vote_results (vote_type)',
      'CREATE INDEX IF NOT EXISTS idx_vote_results_status    ON vote_results (status)',
    ],
  },

  {
    // behavior_tags - Behavioral labels assigned to agents
    // behavior_tags - エージェントに割り当てられた行動ラベル
    name: 'behavior_tags',
    sql: `
      CREATE TABLE IF NOT EXISTS behavior_tags (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        tag         TEXT NOT NULL,
        weight      REAL DEFAULT 1.0,
        assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
        source      TEXT,
        UNIQUE (agent_id, tag)
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_behavior_tags_agent_id ON behavior_tags (agent_id)',
      'CREATE INDEX IF NOT EXISTS idx_behavior_tags_tag      ON behavior_tags (tag)',
    ],
  },

  {
    // collaboration_history - Pairwise agent collaboration outcomes
    // collaboration_history - エージェント間のペアワイズ協力結果
    name: 'collaboration_history',
    sql: `
      CREATE TABLE IF NOT EXISTS collaboration_history (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_a_id          TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        agent_b_id          TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        task_id             TEXT,
        collaboration_score REAL,
        timestamp           TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_collaboration_history_agent_a  ON collaboration_history (agent_a_id)',
      'CREATE INDEX IF NOT EXISTS idx_collaboration_history_agent_b  ON collaboration_history (agent_b_id)',
      'CREATE INDEX IF NOT EXISTS idx_collaboration_history_task_id  ON collaboration_history (task_id)',
      'CREATE INDEX IF NOT EXISTS idx_collaboration_history_timestamp ON collaboration_history (timestamp)',
    ],
  },

  {
    // event_log - General audit/event log with severity
    // event_log - 重要度付きの汎用監査/イベントログ
    name: 'event_log',
    sql: `
      CREATE TABLE IF NOT EXISTS event_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        agent_id   TEXT,
        details    TEXT,
        severity   TEXT DEFAULT 'info',
        timestamp  TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_event_log_event_type ON event_log (event_type)',
      'CREATE INDEX IF NOT EXISTS idx_event_log_agent_id   ON event_log (agent_id)',
      'CREATE INDEX IF NOT EXISTS idx_event_log_severity   ON event_log (severity)',
      'CREATE INDEX IF NOT EXISTS idx_event_log_timestamp  ON event_log (timestamp)',
    ],
  },

  {
    // evaluation_queue - Pending agent evaluations for async processing
    // evaluation_queue - 非同期処理用の保留中のエージェント評価
    name: 'evaluation_queue',
    sql: `
      CREATE TABLE IF NOT EXISTS evaluation_queue (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        updates      TEXT,
        status       TEXT DEFAULT 'pending',
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        processed_at TEXT
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_evaluation_queue_agent_id ON evaluation_queue (agent_id)',
      'CREATE INDEX IF NOT EXISTS idx_evaluation_queue_status   ON evaluation_queue (status)',
    ],
  },

  // =========================================================================
  //  5. PHEROMONE / フェロモン  (1 table)
  // =========================================================================

  {
    // pheromones - Stigmergic signals for indirect agent coordination
    // pheromones - 間接的なエージェント調整のためのスティグマジックシグナル
    name: 'pheromones',
    sql: `
      CREATE TABLE IF NOT EXISTS pheromones (
        id           TEXT PRIMARY KEY,
        type         TEXT NOT NULL,
        source_id    TEXT,
        target_scope TEXT,
        intensity    REAL DEFAULT 1.0,
        payload      TEXT,
        decay_rate   REAL DEFAULT 0.1,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at   TEXT
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_pheromones_type         ON pheromones (type)',
      'CREATE INDEX IF NOT EXISTS idx_pheromones_source_id    ON pheromones (source_id)',
      'CREATE INDEX IF NOT EXISTS idx_pheromones_target_scope ON pheromones (target_scope)',
      'CREATE INDEX IF NOT EXISTS idx_pheromones_intensity    ON pheromones (intensity DESC)',
      'CREATE INDEX IF NOT EXISTS idx_pheromones_expires_at   ON pheromones (expires_at)',
    ],
  },

  // =========================================================================
  //  6. PERSONA / ペルソナ  (1 table)
  // =========================================================================

  {
    // persona_outcomes - Recorded outcomes per persona/task-type
    // persona_outcomes - ペルソナ/タスクタイプごとの記録された成果
    name: 'persona_outcomes',
    sql: `
      CREATE TABLE IF NOT EXISTS persona_outcomes (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        persona_id    TEXT NOT NULL,
        task_type     TEXT,
        success       INTEGER DEFAULT 0,
        quality_score REAL,
        duration_ms   INTEGER,
        notes         TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_persona_outcomes_persona_id ON persona_outcomes (persona_id)',
      'CREATE INDEX IF NOT EXISTS idx_persona_outcomes_task_type  ON persona_outcomes (task_type)',
      'CREATE INDEX IF NOT EXISTS idx_persona_outcomes_success    ON persona_outcomes (success)',
      'CREATE INDEX IF NOT EXISTS idx_persona_outcomes_created_at ON persona_outcomes (created_at)',
    ],
  },

  // =========================================================================
  //  7. ORCHESTRATION STATS / オーケストレーション統計  (2 tables)
  // =========================================================================

  {
    // role_execution_stats - Per-role performance statistics
    // role_execution_stats - ロールごとのパフォーマンス統計
    name: 'role_execution_stats',
    sql: `
      CREATE TABLE IF NOT EXISTS role_execution_stats (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        role_name     TEXT NOT NULL,
        task_type     TEXT,
        duration_ms   INTEGER,
        success       INTEGER DEFAULT 0,
        quality_score REAL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_role_execution_stats_role_name  ON role_execution_stats (role_name)',
      'CREATE INDEX IF NOT EXISTS idx_role_execution_stats_task_type  ON role_execution_stats (task_type)',
      'CREATE INDEX IF NOT EXISTS idx_role_execution_stats_success    ON role_execution_stats (success)',
      'CREATE INDEX IF NOT EXISTS idx_role_execution_stats_created_at ON role_execution_stats (created_at)',
    ],
  },

  {
    // task_state_transitions - State machine audit trail for tasks
    // task_state_transitions - タスクのステートマシン監査証跡
    name: 'task_state_transitions',
    sql: `
      CREATE TABLE IF NOT EXISTS task_state_transitions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id    TEXT NOT NULL,
        role_name  TEXT,
        from_state TEXT,
        to_state   TEXT NOT NULL,
        reason     TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_task_state_transitions_task_id    ON task_state_transitions (task_id)',
      'CREATE INDEX IF NOT EXISTS idx_task_state_transitions_role_name  ON task_state_transitions (role_name)',
      'CREATE INDEX IF NOT EXISTS idx_task_state_transitions_to_state   ON task_state_transitions (to_state)',
      'CREATE INDEX IF NOT EXISTS idx_task_state_transitions_created_at ON task_state_transitions (created_at)',
    ],
  },

  // =========================================================================
  //  8. NEW V5.0 TABLES / V5.0 新規テーブル  (7 tables)
  // =========================================================================

  {
    // knowledge_nodes - Vertices in the knowledge graph
    // knowledge_nodes - 知識グラフの頂点
    name: 'knowledge_nodes',
    sql: `
      CREATE TABLE IF NOT EXISTS knowledge_nodes (
        id         TEXT PRIMARY KEY,
        node_type  TEXT NOT NULL,
        label      TEXT NOT NULL,
        properties TEXT,
        importance REAL DEFAULT 0.5,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_node_type  ON knowledge_nodes (node_type)',
      'CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_label      ON knowledge_nodes (label)',
      'CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_importance ON knowledge_nodes (importance DESC)',
    ],
  },

  {
    // knowledge_edges - Directed edges in the knowledge graph
    // knowledge_edges - 知識グラフの有向辺
    name: 'knowledge_edges',
    sql: `
      CREATE TABLE IF NOT EXISTS knowledge_edges (
        id         TEXT PRIMARY KEY,
        source_id  TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
        target_id  TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
        edge_type  TEXT NOT NULL,
        weight     REAL DEFAULT 1.0,
        properties TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_knowledge_edges_source_id ON knowledge_edges (source_id)',
      'CREATE INDEX IF NOT EXISTS idx_knowledge_edges_target_id ON knowledge_edges (target_id)',
      'CREATE INDEX IF NOT EXISTS idx_knowledge_edges_edge_type ON knowledge_edges (edge_type)',
      'CREATE INDEX IF NOT EXISTS idx_knowledge_edges_weight    ON knowledge_edges (weight DESC)',
    ],
  },

  {
    // episodic_events - Temporal event records with SVO triples
    // episodic_events - SVO三つ組を持つ時系列イベント記録
    name: 'episodic_events',
    sql: `
      CREATE TABLE IF NOT EXISTS episodic_events (
        id         TEXT PRIMARY KEY,
        agent_id   TEXT,
        event_type TEXT NOT NULL,
        subject    TEXT,
        predicate  TEXT,
        object     TEXT,
        context    TEXT,
        importance REAL DEFAULT 0.5,
        reward     REAL DEFAULT 0,
        timestamp  TEXT NOT NULL DEFAULT (datetime('now')),
        session_id TEXT
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_episodic_events_agent_id   ON episodic_events (agent_id)',
      'CREATE INDEX IF NOT EXISTS idx_episodic_events_event_type ON episodic_events (event_type)',
      'CREATE INDEX IF NOT EXISTS idx_episodic_events_subject    ON episodic_events (subject)',
      'CREATE INDEX IF NOT EXISTS idx_episodic_events_timestamp  ON episodic_events (timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_episodic_events_session_id ON episodic_events (session_id)',
      'CREATE INDEX IF NOT EXISTS idx_episodic_events_importance ON episodic_events (importance DESC)',
    ],
  },

  {
    // zones - Organizational zones / domains within the swarm
    // zones - スウォーム内の組織ゾーン/ドメイン
    name: 'zones',
    sql: `
      CREATE TABLE IF NOT EXISTS zones (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        description TEXT,
        tech_stack  TEXT,
        leader_id   TEXT,
        config      TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_zones_leader_id ON zones (leader_id)',
    ],
  },

  {
    // zone_memberships - Many-to-many zone-agent assignments
    // zone_memberships - 多対多のゾーン-エージェント割り当て
    name: 'zone_memberships',
    sql: `
      CREATE TABLE IF NOT EXISTS zone_memberships (
        zone_id   TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
        agent_id  TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        role      TEXT,
        joined_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (zone_id, agent_id)
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_zone_memberships_agent_id ON zone_memberships (agent_id)',
      'CREATE INDEX IF NOT EXISTS idx_zone_memberships_role     ON zone_memberships (role)',
    ],
  },

  {
    // pheromone_types - Configurable pheromone type definitions (MMAS bounds)
    // pheromone_types - 設定可能なフェロモンタイプ定義（MMAS境界）
    name: 'pheromone_types',
    sql: `
      CREATE TABLE IF NOT EXISTS pheromone_types (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL UNIQUE,
        decay_rate   REAL DEFAULT 0.1,
        max_ttl_min  INTEGER DEFAULT 1440,
        mmas_min     REAL DEFAULT 0.01,
        mmas_max     REAL DEFAULT 10.0,
        description  TEXT,
        created_by   TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_pheromone_types_created_by ON pheromone_types (created_by)',
    ],
  },

  {
    // execution_plans - Structured task execution plans with maturity scoring
    // execution_plans - 成熟度スコアリング付きの構造化タスク実行計画
    name: 'execution_plans',
    sql: `
      CREATE TABLE IF NOT EXISTS execution_plans (
        id              TEXT PRIMARY KEY,
        task_id         TEXT,
        plan_data       TEXT,
        status          TEXT DEFAULT 'draft',
        created_by      TEXT,
        maturity_score  REAL DEFAULT 0,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_execution_plans_task_id        ON execution_plans (task_id)',
      'CREATE INDEX IF NOT EXISTS idx_execution_plans_status         ON execution_plans (status)',
      'CREATE INDEX IF NOT EXISTS idx_execution_plans_created_by     ON execution_plans (created_by)',
      'CREATE INDEX IF NOT EXISTS idx_execution_plans_maturity_score ON execution_plans (maturity_score DESC)',
    ],
  },
  // =========================================================================
  //  9. NEW V5.1 TABLES / V5.1 新規テーブル  (4 tables)
  // =========================================================================

  {
    // breaker_state - Per-tool circuit breaker persistence
    // breaker_state - ツールごとの断路器状態永続化
    name: 'breaker_state',
    sql: `
      CREATE TABLE IF NOT EXISTS breaker_state (
        tool_name    TEXT PRIMARY KEY,
        state        TEXT NOT NULL DEFAULT 'CLOSED',
        failures     INTEGER DEFAULT 0,
        last_failure INTEGER,
        opened_at    INTEGER,
        half_open_at INTEGER,
        updated_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_breaker_state_state ON breaker_state (state)',
    ],
  },

  {
    // repair_memory - Adaptive repair strategies for tool errors (V5.2 ready)
    // repair_memory - ツールエラー用の適応型修復戦略（V5.2対応）
    name: 'repair_memory',
    sql: `
      CREATE TABLE IF NOT EXISTS repair_memory (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        error_signature TEXT NOT NULL,
        tool_name       TEXT NOT NULL,
        error_type      TEXT,
        field_path      TEXT,
        strategy        TEXT NOT NULL,
        affinity        REAL DEFAULT 0.5,
        hit_count       INTEGER DEFAULT 0,
        last_hit_at     INTEGER,
        created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        UNIQUE (error_signature, strategy)
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_repair_memory_error_signature ON repair_memory (error_signature)',
      'CREATE INDEX IF NOT EXISTS idx_repair_memory_tool_name       ON repair_memory (tool_name)',
      'CREATE INDEX IF NOT EXISTS idx_repair_memory_affinity        ON repair_memory (affinity DESC)',
    ],
  },

  {
    // dead_letter_tasks - Permanently failed tasks structured record (DLQ)
    // dead_letter_tasks - 永久失敗タスクの構造化記録（DLQ）
    name: 'dead_letter_tasks',
    sql: `
      CREATE TABLE IF NOT EXISTS dead_letter_tasks (
        id               TEXT PRIMARY KEY,
        dag_id           TEXT,
        task_node_id     TEXT,
        agent_id         TEXT,
        original_params  TEXT,
        retry_history    TEXT,
        failure_category TEXT,
        created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        reprocessed_at   INTEGER,
        resolution       TEXT
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_dead_letter_tasks_dag_id           ON dead_letter_tasks (dag_id)',
      'CREATE INDEX IF NOT EXISTS idx_dead_letter_tasks_agent_id         ON dead_letter_tasks (agent_id)',
      'CREATE INDEX IF NOT EXISTS idx_dead_letter_tasks_failure_category ON dead_letter_tasks (failure_category)',
      'CREATE INDEX IF NOT EXISTS idx_dead_letter_tasks_created_at       ON dead_letter_tasks (created_at)',
    ],
  },

  {
    // task_affinity - Agent-task type affinity matrix for optimized allocation
    // task_affinity - 最適化された割り当てのためのエージェント-タスクタイプ親和性マトリックス
    name: 'task_affinity',
    sql: `
      CREATE TABLE IF NOT EXISTS task_affinity (
        agent_id     TEXT NOT NULL,
        task_type    TEXT NOT NULL,
        affinity     REAL DEFAULT 0.5,
        total_tasks  INTEGER DEFAULT 0,
        successes    INTEGER DEFAULT 0,
        avg_duration REAL DEFAULT 0,
        last_updated INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        PRIMARY KEY (agent_id, task_type)
      )
    `,
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_task_affinity_agent_id  ON task_affinity (agent_id)',
      'CREATE INDEX IF NOT EXISTS idx_task_affinity_task_type ON task_affinity (task_type)',
      'CREATE INDEX IF NOT EXISTS idx_task_affinity_affinity  ON task_affinity (affinity DESC)',
    ],
  },
];

// ---------------------------------------------------------------------------
// createAllTables(db) - Bootstrap all tables, indexes, and seed metadata
// createAllTables(db) - 全テーブル、インデックスを作成し、メタデータをシードする
// ---------------------------------------------------------------------------

/**
 * Creates all 38 tables and their indexes inside a single transaction.
 * Also seeds swarm_meta with the current schema version.
 * 単一トランザクション内で全38テーブルとインデックスを作成する。
 * また、現在のスキーマバージョンでswarm_metaをシードする。
 *
 * @param {import('better-sqlite3').Database} db - A better-sqlite3 database instance
 * @returns {{ tablesCreated: number, indexesCreated: number }} Summary counts
 */
function createAllTables(db) {
  // 1. Apply PRAGMA settings (must run outside transaction for some pragmas)
  // 1. PRAGMA設定を適用する（一部のPRAGMAはトランザクション外で実行が必要）
  for (const pragma of PRAGMA_SETTINGS) {
    db.pragma(pragma.replace(/^PRAGMA\s+/i, ''));
  }

  let tablesCreated = 0;
  let indexesCreated = 0;

  // 2. Create all tables and indexes in a transaction
  // 2. トランザクション内で全テーブルとインデックスを作成する
  const migrate = db.transaction(() => {
    for (const schema of TABLE_SCHEMAS) {
      db.exec(schema.sql);
      tablesCreated++;

      for (const indexSql of schema.indexes) {
        db.exec(indexSql);
        indexesCreated++;
      }
    }

    // 3. Seed schema version into swarm_meta
    // 3. スキーマバージョンをswarm_metaにシードする
    const upsert = db.prepare(`
      INSERT INTO swarm_meta (key, value)
      VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    upsert.run(String(SCHEMA_VERSION));
  });

  migrate();

  return { tablesCreated, indexesCreated };
}

// ---------------------------------------------------------------------------
// Exports / エクスポート
// ---------------------------------------------------------------------------
export {
  SCHEMA_VERSION,
  PRAGMA_SETTINGS,
  TABLE_SCHEMAS,
  createAllTables,
};
