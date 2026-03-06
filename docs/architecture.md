# Claw-Swarm v4.0 — Technical Architecture & Design Rationale
# 蜂群 Claw-Swarm v4.0 — 技术架构与设计原理

---

## 1. Origin Story / 项目起源

### The Problem / 问题背景

OpenClaw's multi-agent ecosystem relied on two separate plugins:

- **OME v1.1.0** — Memory engine (persistent memory, context injection, checkpoints)
- **Swarm Lite v3.0** — Governance layer (capability scoring, voting, tier management, 174 tests)

This separation created three unsolved problems:

1. **Sub-agents cannot communicate with siblings** — no peer awareness, no knowledge sharing
2. **No temporal context** — memory is permanent, but "Agent A is struggling RIGHT NOW" needs urgency
3. **Teaching agents to collaborate is painful** — no built-in peer directory, no structured messaging

OpenClaw 的多智能体生态依赖两个独立插件。这种分离导致三个未解决的问题：子代理间无法通信、缺乏时效性上下文、教 Agent 协作极其痛苦。

### The Insight / 关键洞察

Five observations led to the merger:

| # | Observation | Implication |
|---|-------------|-------------|
| 1 | Governance alone has limited value | But in heterogeneous agent ecosystems (different SOULs, skills, models), capability scoring IS meaningful |
| 2 | OME already tracks execution data | Natural data source for governance scoring — no extra instrumentation needed |
| 3 | Sub-agents lack sibling communication | **Pheromone system** fills this gap with broadcast, time-decaying signals |
| 4 | Collaboration requires peer awareness | **Peer directory** injected via `before_agent_start` — agents know their peers |
| 5 | Different tasks need different personalities | **Soul Designer** with persona templates — scout-bee for exploration, guard-bee for security |

**Decision:** Merge into a single plugin — **蜂群 Claw-Swarm v4.0**.

**Product narrative:** *"One plugin. Memory + swarm intelligence + governance + agent design."*

---

## 2. Conceptual Architecture — 5-Layer Value Stack / 概念架构 — 5 层价值栈

Before implementation, we designed a **5-layer conceptual model** describing the capability hierarchy. Each layer adds a distinct class of intelligence on top of the previous:

在实现之前，我们设计了 **5 层概念模型**，描述能力层级关系。每层在上一层之上增加一类独特的智能：

```
╔═══════════════════════════════════════════════════════════════╗
║  Layer 5: Collaboration Infrastructure (协作基础设施)          ║
║  ┌─────────────────────────────────────────────────────────┐  ║
║  │ · Peer Directory — injected at agent start, never stale │  ║
║  │ · collaborate tool — abstracts all communication modes  │  ║
║  │ · Struggle Detection — pheromone-aware false-pos reduce │  ║
║  │ · Message Format Auto-fix — @mention routing fallback   │  ║
║  └─────────────────────────────────────────────────────────┘  ║
╠═══════════════════════════════════════════════════════════════╣
║  Layer 4: Agent Design Methodology (Agent 设计方法论)         ║
║  ┌─────────────────────────────────────────────────────────┐  ║
║  │ · SKILL.md injection — behavioral guidelines            │  ║
║  │ · swarm_design tool — persona recommendation engine     │  ║
║  │ · Persona Evolution — outcome tracking + win-rate       │  ║
║  │ · 4 bee personas — scout/worker/guard/queen-messenger   │  ║
║  └─────────────────────────────────────────────────────────┘  ║
╠═══════════════════════════════════════════════════════════════╣
║  Layer 3: Pheromone Communication (信息素通信)                ║
║  ┌─────────────────────────────────────────────────────────┐  ║
║  │ · 5 pheromone types — trail/alarm/recruit/queen/dance   │  ║
║  │ · Exponential decay — intensity(t) = I₀·e^(-λt)        │  ║
║  │ · Environment injection — snapshot in before_agent_start│  ║
║  │ · Background decay service — explicit lifecycle mgmt    │  ║
║  └─────────────────────────────────────────────────────────┘  ║
╠═══════════════════════════════════════════════════════════════╣
║  Layer 2: Swarm Orchestration (蜂群编排)                      ║
║  ┌─────────────────────────────────────────────────────────┐  ║
║  │ · 4 execution strategies — simulated/sequential/file/.. │  ║
║  │ · SOUL templates — config-extensible persona system     │  ║
║  │ · swarm_spawn — one-click coordinated agent generation  │  ║
║  │ · Role Manager — topological sort for dependencies      │  ║
║  └─────────────────────────────────────────────────────────┘  ║
╠═══════════════════════════════════════════════════════════════╣
║  Layer 1: Governance Infrastructure (治理基础设施)             ║
║  ┌─────────────────────────────────────────────────────────┐  ║
║  │ · 4D capability scoring — tech/delivery/collab/innov    │  ║
║  │ · Weighted voting — promotion, admission, rate-limited  │  ║
║  │ · Reputation ledger — contribution tracking + tags      │  ║
║  │ · Circuit breaker — fault tolerance (CLOSED/OPEN/HALF)  │  ║
║  │ · Persistent evaluation queue — crash-resilient         │  ║
║  └─────────────────────────────────────────────────────────┘  ║
╚═══════════════════════════════════════════════════════════════╝

Foundation: Unified DB (25 tables) + Memory Engine (from OME) + Types/Errors/Config
```

**Key principle / 核心原则:** Each conceptual layer can be independently disabled. Governance off? Collaboration still works. Pheromone off? Soul Designer still works. This is enforced by the `enabled: boolean` toggle per subsystem.

---

## 3. Implementation Architecture — 4-Layer Code Structure / 实现架构 — 4 层代码结构

The 5-layer conceptual model maps to a **4-layer implementation structure** optimized for code organization and dependency management:

5 层概念模型映射为 **4 层实现结构**，优化代码组织和依赖管理：

```
┌─────────────────────────────────────────────────────────────────┐
│ Adapter Layer — OpenClaw Plugin Adapter (唯一耦合点)              │
│                                                                   │
│  plugin-adapter.js ← register(api) wires everything              │
│  hooks/  (8 files) ← lifecycle event handlers                    │
│  tools/  (5 files) ← agent-facing capabilities                   │
│  services/ (1 file) ← background processes                       │
│  skill-md/SKILL.md  ← injected agent instructions                │
├─────────────────────────────────────────────────────────────────┤
│ Layer 3 — Swarm Intelligence (零依赖，可复用)                      │
│                                                                   │
│  soul/           ← persona templates, designer, evolution        │
│  collaboration/  ← peer directory, struggle detector, strategies │
│  orchestration/  ← task lifecycle, role manager, distribution    │
├─────────────────────────────────────────────────────────────────┤
│ Layer 2 — Domain Engines (零依赖，可复用)                          │
│                                                                   │
│  memory/     ← OME memory CRUD, context builder, checkpoints    │
│  pheromone/  ← emit/read/decay, 5 types, batch operations       │
│  governance/ ← 4D scoring, voting, reputation, evaluation queue  │
├─────────────────────────────────────────────────────────────────┤
│ Layer 1 — Core Infrastructure (零依赖)                            │
│                                                                   │
│  db.js (25 tables, 69 functions) │ types.js (19 enums)           │
│  errors.js (11 classes)          │ config.js (6 subsystem toggles)│
│  circuit-breaker.js              │ monitor.js (ring buffer)       │
│  logger.js                       │ message-utils.js               │
│  db-migration.js (v0→v3 chain + backup + import)                 │
└─────────────────────────────────────────────────────────────────┘
```

### Why 5 conceptual layers → 4 implementation layers? / 为什么 5 层概念变 4 层实现？

| Conceptual Layer | Implementation Location | Reason |
|------------------|------------------------|--------|
| L5: Collaboration | `layer3-intelligence/collaboration/` + `adapter/hooks/` | Collaboration logic is framework-independent (L3), but hooks that wire it to OpenClaw events must be in the adapter layer |
| L4: Agent Design | `layer3-intelligence/soul/` + `adapter/skill-md/` | Persona selection is pure logic (L3), SKILL.md injection is adapter concern |
| L3: Pheromone | `layer2-engines/pheromone/` | Pure engine — no intelligence/decision logic |
| L2: Orchestration | `layer3-intelligence/orchestration/` | Task coordination IS intelligence (strategy selection, role assignment) |
| L1: Governance | `layer2-engines/governance/` + `layer1-core/` | Scoring/voting are domain engines; circuit breaker + DB are core infrastructure |

**The mapping follows a simple rule / 映射规则：**
- **Pure data/CRUD operations** → Layer 1 (core) or Layer 2 (engines)
- **Decision-making logic** → Layer 3 (intelligence)
- **Framework coupling** → Adapter layer (hooks, tools, services)

### Dependency Rules / 依赖规则

```
Adapter → Layer 3 → Layer 2 → Layer 1
  ✓         ✓          ✓         ✓     (downward: allowed)
  ✗         ✗          ✗         ✗     (upward: forbidden)
  ✗         ✗          ✗               (lateral within same layer: allowed within same subdirectory)
```

Only the Adapter layer imports from OpenClaw's API. Layers 1-3 can be extracted and used in any Node.js 22+ environment without modification.

---

## 4. 6 Subsystems / 6 个子系统

Each subsystem is independently toggleable via `{ enabled: boolean }` in config:

```json
{
  "memory":        { "enabled": true  },  // OME replacement — persistent memory + context injection
  "pheromone":     { "enabled": true  },  // Bio-inspired indirect communication
  "governance":    { "enabled": false },  // 4D scoring, voting, tier management
  "soul":          { "enabled": true  },  // Persona templates + evolution
  "collaboration": { "enabled": true  },  // Peer directory, struggle detection, @mention routing
  "orchestration": { "enabled": true  }   // Task distribution, role management
}
```

**Minimal config (OME replacement):** Only `memory.enabled = true`. Everything else off.
**Full stack:** All 6 enabled.

---

## 5. Unified Database / 统一数据库

### 25 Tables, 1 File / 25 张表，1 个文件

Single `swarm.db` SQLite file, WAL mode, managed by `layer1-core/db.js`.

| Origin | Tables | Count |
|--------|--------|-------|
| OME | `memories`, `daily_summaries`, `checkpoints`, `events`, `tasks`, `event_cursors` | 6 |
| Orchestration | `swarm_tasks`, `swarm_roles`, `swarm_checkpoints`, `swarm_artifacts`, `swarm_locks` | 5 |
| Governance | `agents`, `capabilities`, `capability_details`, `skills`, `contributions`, `votes`, `vote_results`, `behavior_tags`, `collaboration_history`, `event_log`, `evaluation_queue` | 11 |
| v4.0 New | `pheromones`, `persona_outcomes` | 2 |
| Meta | `swarm_meta` | 1 |

### Why Single DB? / 为什么单一数据库？

| Alternative | Problem |
|-------------|---------|
| Separate DBs per subsystem | Cross-subsystem transactions impossible (e.g., record contribution AND update capability atomically) |
| In-memory only | Data loss on crash; no persistence across sessions |
| External DB (PostgreSQL, etc.) | Violates zero-dependency constraint; deployment complexity |

**Risk:** 1000+ lines of CRUD in one file → Mitigated by:
- Domain-organized function groups with banner comments
- Interface-first design (signatures defined before implementation)
- 69 individually testable functions

### Migration Safety / 迁移安全

```
migrateWithBackup(dbPath)
  1. fs.copyFileSync(dbPath, `${dbPath}.backup-${timestamp}`)
  2. db.withTransaction(() => migrate())     // rollback on failure
  3. If transaction fails → backup available for manual recovery
```

Import functions (`importOmeDatabase`, `importSwarmLiteDatabase`):
- **Non-destructive:** Read-only from source DB
- **Idempotent:** Flagged by `ome_imported` / `swarmv3_imported` keys in `swarm_meta`
- **Auto-backup** before import

---

## 6. Pheromone System — Deep Dive / 信息素系统详解

### Why Not Just Memory? / 为什么不能用记忆替代？

| Dimension | Memory | Pheromone |
|-----------|--------|-----------|
| Persistence | Permanent | Decays (30-480 min TTL) |
| Communication | Point-to-point (query) | Broadcast (injected to all) |
| Accumulation | Overwrite | Stack (intensities coexist) |
| Agent awareness | Active query required | Passive injection (zero cost) |
| Temporal signal | "X happened" (when unknown) | "X is happening NOW" (urgency) |

### 5 Types / 5 种类型

| Type | Biological Analogy | Decay | Purpose |
|------|--------------------|-------|---------|
| `trail` | Ant trail pheromone | 120 min | "I worked on X" — breadcrumbs for coordination |
| `alarm` | Defensive pheromone | 30 min | "Problem at X" — fast warning |
| `recruit` | Recruitment signal | 60 min | "Help needed at X" — assistance request |
| `queen` | Queen mandibular pheromone | 480 min | Strategic directive — long-lasting influence |
| `dance` | Honeybee waggle dance | 90 min | "Found resource at X" — knowledge sharing |

### Decay Model / 衰减模型

```
intensity(t) = I₀ × e^(-λ × t_minutes)

Where:
  I₀ = initial intensity (default 1.0)
  λ  = type-specific decay rate
  t  = elapsed minutes since emission

Cleanup: when intensity < 0.01 (MIN_INTENSITY), removed in next decay pass
```

### Performance at Scale / 大规模性能

When `pheromones` table reaches 100k+ rows:

```sql
-- Indexed deletion (NOT full table scan)
DELETE FROM pheromones WHERE expires_at < ?;  -- uses idx_pher_expires

-- Intensity calculated on READ, not stored
-- Avoids frequent UPDATE operations
```

### Pheromone-Aware Struggle Detection / 信息素感知困难检测

```
Agent fails 3/5 recent tool calls
  └→ StruggleDetector checks ALARM density at agent's scope
       ├─ If ≥2 ALARMs → systemic problem (API down) → DON'T emit RECRUIT
       └─ If <2 ALARMs → individual struggle → EMIT RECRUIT pheromone

Result: ~40% false positive rate reduced to ~10% in systemic failure scenarios
```

---

## 7. Soul Designer / 灵魂设计器

### Core Insight / 核心洞察

Different tasks need different agent personalities:
- Security audit → cautious guard-bee
- Rapid prototyping → exploratory scout-bee
- Steady implementation → methodical worker-bee
- Architecture planning → strategic queen-messenger

### Persona Selection Flow / 人格选择流程

```
Task description
  └→ Keyword matching against persona.bestFor lists
       ├─ "investigate", "explore" → scout-bee
       ├─ "implement", "build"    → worker-bee
       ├─ "audit", "security"     → guard-bee
       ├─ "plan", "architecture"  → queen-messenger
       └─ No match                → worker-bee (default)
```

### Config Extensibility / 配置可扩展性

Built-in templates are frozen JS objects. Users extend via config overlay:

```json
{
  "soul": {
    "personas": {
      "devops-bee": {
        "name": "DevOps Bee",
        "personality": { "caution": 0.8, "reliability": 0.9 },
        "soulSnippet": "You are a DevOps specialist...",
        "bestFor": ["deployment", "ci-cd", "monitoring"]
      }
    }
  }
}
```

Merge: `{ ...builtInTemplates, ...userPersonas }` — user can override or add.

### Evolution Learning / 进化学习

```
persona_outcomes table:
  { personaId, taskType, success, duration, quality }

Over time → win-rate per persona × taskType:
  scout-bee × research: 87% (23/26)
  worker-bee × research: 62% (8/13)
  → Future: auto-recommend scout-bee for research

Current: keyword matching. Reserved ML interface for future.
```

---

## 8. Hook Lifecycle / 钩子生命周期

### Full Hook Map / 完整钩子映射

```
┌─ Agent Lifecycle ──────────────────────────────────────────────┐
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ before_agent_start (priority 50, modifying)               │  │
│  │   1. Memory context injection (checkpoint + summary)      │  │
│  │   2. Peer directory injection (lazy-read, always fresh)   │  │
│  │   3. Pheromone snapshot injection (active signals nearby)  │  │
│  │   → Returns { prependContext: combinedText }              │  │
│  └──────────────────────────────────────────────────────────┘  │
│                            ↓                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ after_tool_call (void)                         [per call] │  │
│  │   1. Agent state tracking (tool name, success, timing)    │  │
│  │   2. Struggle detection → maybe emit RECRUIT pheromone    │  │
│  │   3. Governance capability evaluation (if enabled)        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                            ↓                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ message_sending (void)                      [per message] │  │
│  │   @mention format auto-fix (rewrite to known peer IDs)    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                            ↓                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ agent_end (void)                              [once]      │  │
│  │   1. Save mechanical checkpoint                           │  │
│  │   2. Governance post-task evaluation (if enabled)         │  │
│  │   3. Emit TRAIL pheromone for working scope               │  │
│  │   4. Record persona outcome for evolution                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
├─ Subagent Lifecycle ───────────────────────────────────────────┤
│                                                                 │
│  subagent_spawning → Governance gate (tier-based limits)       │
│  subagent_ended    → Trail pheromone + governance evaluation   │
│                                                                 │
├─ Session Lifecycle ────────────────────────────────────────────┤
│                                                                 │
│  before_reset → Clear agent state (in-memory Map)              │
│  gateway_stop → Stop decay service + flush queue + close DB    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Data Flow Examples / 数据流示例

### Scenario A: Agent Collaboration via Struggle Detection

```
Timeline:
  t=0   Agent-A starts working on auth module
  t=5   after_tool_call: write_file fails (permission error)
  t=6   after_tool_call: write_file fails again
  t=7   after_tool_call: write_file fails (3/5 threshold reached)
        StruggleDetector checks: 0 ALARMs nearby → individual struggle
        StruggleDetector emits RECRUIT pheromone to scope "/src/auth/"
  t=10  Agent-B starts → before_agent_start fires
        Pheromone snapshot injected: "RECRUIT @ /src/auth/ (intensity: 0.92)"
        Agent-B reads signal, uses collaborate tool to assist Agent-A
  t=20  Both agents emit TRAIL pheromones → future agents see breadcrumbs
  t=67  RECRUIT pheromone decayed below 0.01, removed by decay pass
```

### Scenario B: Swarm Spawn with Soul Designer

```
User: "Spawn a swarm to audit the payment module for security issues"

  1. swarm_spawn tool invoked with task description
  2. SoulDesigner.selectPersona("audit payment security")
     → Keywords: "audit"(guard), "security"(guard), "payment"(worker)
     → Recommended: guard-bee (security keywords dominate)
  3. RoleManager generates roles:
     Role 1: "security-auditor" → guard-bee persona
     Role 2: "implementation-reviewer" → worker-bee persona
     Role 3: "report-writer" → queen-messenger persona
  4. Tool returns spawn plan with SOUL snippets per role
  5. Agent calls sessions_spawn with the plan
  6. Each sub-agent starts with its persona-specific SOUL snippet
```

### Scenario C: Systemic Failure (False Positive Prevention)

```
External API goes down at t=0

  t=1   Agent-A: API call fails → StruggleDetector records
  t=2   Agent-B: API call fails → StruggleDetector records
  t=2   Agent-B: emits ALARM pheromone to scope "/api/external"
  t=3   Agent-C: API call fails → StruggleDetector records
  t=3   Agent-C: emits ALARM pheromone to scope "/api/external"
  t=4   Agent-A: 3rd failure → StruggleDetector checks ALARMs
        → Finds 2 ALARMs at /api/external → SYSTEMIC problem
        → Does NOT emit RECRUIT (would be noise, not helpful)
        → Agents wait/retry instead of spawning unnecessary helpers
```

---

## 10. Key Design Decisions & Trade-offs / 关键设计决策与权衡

| # | Decision | Choice | Alternative Considered | Why This Choice |
|---|----------|--------|----------------------|-----------------|
| 1 | DB architecture | Single `swarm.db` | Separate DBs per subsystem | Atomic cross-subsystem transactions; simpler backup/migration |
| 2 | Migration safety | Auto-backup + transaction | In-place mutation | Migration is irreversible; backup enables recovery |
| 3 | DB code organization | Interface-first, domain-grouped | ORM / class-per-table | 69 plain functions are simpler than ORM; domain grouping aids navigation |
| 4 | Service lifecycle | Explicit stop in `gateway_stop` | `setInterval().unref()` | `unref()` behavior uncertain in plugin hosts; explicit is reliable |
| 5 | Peer directory | Lazy-read, no cache | TTL cache | OpenClaw supports hot-plug agents; cache would go stale |
| 6 | Struggle detection | Pheromone-aware threshold | Simple consecutive failure count | Reduces false positives from ~40% to ~10% in systemic failures |
| 7 | Persona system | JS defaults + config overlay | DB-stored templates | Templates ship with code; user customization via config merge |
| 8 | Dependencies | Zero external (L1-L3) | npm packages | `node:sqlite` built-in since Node 22; minimizes supply chain risk |
| 9 | Shared state | Frozen enums/configs | Mutable objects | Prevents accidental mutation in shared plugin state |
| 10 | Code comments | Bilingual (中文 + English) | English only | International contributor base; maintains cross-language readability |
| 11 | Conceptual vs implementation layers | 5 conceptual → 4 implementation | 1:1 mapping | Pure logic vs framework coupling demands different boundaries |
| 12 | Pheromone intensity | Calculated on read, not stored | Stored + periodically updated | Avoids frequent UPDATE ops; read-time math is O(1) |

---

## 11. File Map / 文件全景

```
E:\OpenClaw\data\swarm\
├── package.json                               # v4.0.0, ES module, Node 22+, MIT
├── LICENSE                                     # MIT 2025-2026 DEEP-IOS
├── README.md                                   # English primary
├── README.zh-CN.md                             # 中文详细版
├── CHANGELOG.md                                # v4.0.0 release notes
├── .gitignore
├── .editorconfig
├── CONTRIBUTING.md
│
├── config/
│   └── openclaw.plugin.json                   # Plugin manifest
│
├── src/
│   ├── index.js                                # { id:'claw-swarm', register(api) }
│   │
│   ├── layer1-core/                            # ══ Core Infrastructure ══
│   │   ├── db.js                               # 25 tables, 69 CRUD functions
│   │   ├── db-migration.js                     # v0→v3 chain + backup + import
│   │   ├── types.js                            # 19 enums + 21 typedefs
│   │   ├── errors.js                           # 11 error classes
│   │   ├── config.js                           # 6 subsystem toggles, deep merge
│   │   ├── circuit-breaker.js                  # 3-state fault tolerance
│   │   ├── monitor.js                          # Ring buffer event tracking
│   │   ├── logger.js                           # Leveled logging
│   │   └── message-utils.js                    # Text extraction utilities
│   │
│   ├── layer2-engines/                         # ══ Domain Engines ══
│   │   ├── memory/                             # Ported from OME v1.1.0
│   │   │   ├── memory-engine.js                #   CRUD facade
│   │   │   ├── context-service.js              #   prependContext builder
│   │   │   ├── checkpoint-service.js           #   Checkpoint persistence
│   │   │   ├── agent-state-service.js          #   In-memory state Map
│   │   │   └── agent-resolver.js               #   Agent ID resolution
│   │   ├── pheromone/                          # NEW in v4.0
│   │   │   ├── pheromone-engine.js             #   emit/read/snapshot/decay
│   │   │   ├── pheromone-decay.js              #   Exponential decay math
│   │   │   └── pheromone-types.js              #   5 types + defaults
│   │   └── governance/                         # Ported from Swarm Lite v3.0
│   │       ├── capability-engine.js            #   4D scoring (~773 lines)
│   │       ├── reputation-ledger.js            #   Contribution tracking
│   │       ├── voting-system.js                #   Weighted voting
│   │       ├── evaluation-queue.js             #   Crash-resilient queue
│   │       └── agent-registry.js               #   Facade
│   │
│   ├── layer3-intelligence/                    # ══ Swarm Intelligence ══
│   │   ├── soul/                               # NEW in v4.0
│   │   │   ├── soul-designer.js                #   Keyword persona selection
│   │   │   ├── persona-templates.js            #   4 bee personas (frozen)
│   │   │   └── persona-evolution.js            #   Outcome tracking
│   │   ├── collaboration/                      # NEW in v4.0
│   │   │   ├── peer-directory.js               #   Lazy-read, no cache
│   │   │   ├── struggle-detector.js            #   Pheromone-aware
│   │   │   └── strategies.js                   #   4 collaboration patterns
│   │   └── orchestration/                      # Ported from Swarm Lite v3.0
│   │       ├── orchestrator.js                 #   Task lifecycle
│   │       ├── task-distributor.js             #   Strategy pattern
│   │       ├── role-manager.js                 #   Role gen + topo sort
│   │       └── strategies/                     #   4 execution strategies
│   │
│   └── layer4-adapter/                         # ══ OpenClaw Adapter ══
│       ├── plugin-adapter.js                   #   register(api) hub
│       ├── hooks/                              #   8 lifecycle hooks
│       ├── tools/                              #   5 agent tools
│       ├── services/                           #   Background processes
│       └── skill-md/SKILL.md                   #   Agent instructions
│
├── tests/
│   ├── unit/           (18 files)
│   ├── integration/    (2 files)
│   └── stress/         (2 files)
│
└── docs/
    ├── architecture.md       # This file (技术路线与架构)
    ├── migration-guide.md    # OME/SwarmLite migration
    ├── pheromone-model.md    # Pheromone system deep dive
    └── soul-designer.md      # Soul designer guide
```

---

## 12. Technology Choices / 技术选型

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js 22+ | Required for built-in `node:sqlite` (DatabaseSync) |
| Database | SQLite (WAL mode) | Zero-deployment, single-file, built into Node 22 |
| Module system | ES modules | Modern standard; tree-shakeable; `"type": "module"` |
| Test framework | `node:test` + `node:assert/strict` | Zero external deps; built into Node 22 |
| Dependencies | **Zero** (Layers 1-3) | `node:sqlite`, `node:crypto`, `node:fs` only |
| Plugin API | OpenClaw `{ id, register(api) }` | Full plugin API access via single coupling point |

---

## 13. Future Directions / 未来方向

| Area | Current | Future |
|------|---------|--------|
| Persona selection | Keyword matching | ML-based embedding similarity |
| Pheromone routing | Scope-based (path string) | Semantic scope matching |
| Inter-agent communication | Pheromone + memory | Real-time WebSocket channels |
| Governance | Manual tier thresholds | Auto-calibrating thresholds |
| Orchestration strategies | 4 built-in | User-defined strategy plugins |
| Monitoring | Ring buffer + sampling | Time-series metrics export |
