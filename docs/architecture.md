# Claw-Swarm V5.0 — Technical Architecture / 技术架构

> Complete rewrite from V4.0. This document describes the 6-layer implementation
> architecture, component responsibilities, data flows, and design rationale.
>
> V4.0 全面重写。本文档描述 6 层实现架构、组件职责、数据流与设计原理。

---

## 1. Architecture Overview / 架构总览

V5.0 replaces the V4.0 4-layer structure (`layer1-core` / `layer2-engines` /
`layer3-intelligence` / `layer4-adapter`) with a **6-layer architecture** that
separates concerns more cleanly: infrastructure is isolated from communication,
agent cognition is isolated from orchestration, and a dedicated monitoring layer
is added on top.

V5.0 将 V4.0 的 4 层结构替换为 **6 层架构**，更清晰地分离关注点：基础设施与通信
分离、智能体认知与编排分离、顶层新增监控层。

### 6-Layer Diagram / 6 层全景图

```
╔══════════════════════════════════════════════════════════════════════════╗
║  L6  MONITORING  (4 files)                                             ║
║  ┌────────────────┐ ┌──────────────────┐ ┌─────────────────────────┐   ║
║  │StateBroadcaster│ │ MetricsCollector │ │ DashboardService        │   ║
║  │  (SSE push)    │ │ (RED + swarm)    │ │ (Fastify HTTP + HTML)   │   ║
║  └────────────────┘ └──────────────────┘ └─────────────────────────┘   ║
╠══════════════════════════════════════════════════════════════════════════╣
║  L5  APPLICATION  (10 files)  ← ONLY layer that couples to OpenClaw    ║
║  ┌────────────────┐ ┌──────────────────┐ ┌─────────────────────────┐   ║
║  │ PluginAdapter  │ │ ContextService   │ │ CircuitBreaker          │   ║
║  │ (DI container) │ │ (LLM context)    │ │ (3-state fault gate)    │   ║
║  ├────────────────┴─┴──────────────────┴─┴─────────────────────────┤   ║
║  │ 7 Tool Factories: spawn / query / pheromone / gate / memory /   │   ║
║  │                    plan / zone                                   │   ║
║  └──────────────────────────────────────────────────────────────────┘   ║
╠══════════════════════════════════════════════════════════════════════════╣
║  L4  ORCHESTRATION  (12 files)                                         ║
║  ┌─────────────┐ ┌──────────────┐ ┌─────────────┐ ┌───────────────┐   ║
║  │ Orchestrator│ │CriticalPath  │ │QualityCtrl  │ │PipelineBreaker│   ║
║  │ (DAG tasks) │ │Analyzer(CPM) │ │(multi-rubric)│ │(state machine)│   ║
║  ├─────────────┤ ├──────────────┤ ├─────────────┤ ├───────────────┤   ║
║  │ResultSynth  │ │ExecutionPlan │ │ ContractNet │ │ ReplanEngine  │   ║
║  │(dedup+merge)│ │(GEP chromo)  │ │(FIPA CFP)   │ │(alarm-trigger)│   ║
║  ├─────────────┤ ├──────────────┤ ├─────────────┤ ├───────────────┤   ║
║  │ABCScheduler │ │RoleDiscovery │ │ RoleManager │ │ ZoneManager   │   ║
║  │(bee colony) │ │(k-means++)   │ │(MoE routing)│ │(spatial zones)│   ║
║  └─────────────┘ └──────────────┘ └─────────────┘ └───────────────┘   ║
╠══════════════════════════════════════════════════════════════════════════╣
║  L3  AGENT  (8 files)                                                  ║
║  ┌───────────────────────────────────────────────────────────────────┐  ║
║  │ Memory Subsystem                                                  │  ║
║  │  WorkingMemory (3-tier) │ EpisodicMemory (Ebbinghaus) │           │  ║
║  │  SemanticMemory (BFS graph) │ ContextCompressor (LLM window)     │  ║
║  ├───────────────────────────────────────────────────────────────────┤  ║
║  │ Agent Identity & Capability                                       │  ║
║  │  CapabilityEngine (4D+ACO) │ PersonaEvolution (PARL A/B)         │  ║
║  │  ReputationLedger (multi-factor) │ SoulDesigner (4 bee personas)  │  ║
║  └───────────────────────────────────────────────────────────────────┘  ║
╠══════════════════════════════════════════════════════════════════════════╣
║  L2  COMMUNICATION  (4 files)                                          ║
║  ┌────────────────┐ ┌──────────────────┐ ┌──────────────────────────┐  ║
║  │  MessageBus    │ │ PheromoneEngine  │ │ GossipProtocol           │  ║
║  │  (pub/sub+DLQ) │ │ (MMAS+decay)    │ │ (epidemic broadcast)     │  ║
║  ├────────────────┘ └──────────────────┘ └──────────────────────────┤  ║
║  │ PheromoneTypeRegistry (custom types beyond 5 built-in)            │  ║
║  └───────────────────────────────────────────────────────────────────┘  ║
╠══════════════════════════════════════════════════════════════════════════╣
║  L1  INFRASTRUCTURE  (17 files)                                        ║
║  ┌──────────────┐ ┌────────────────────────────────────────────────┐   ║
║  │DatabaseManager│ │ 8 Repositories: Pheromone│Task│Agent│Knowledge│   ║
║  │(SQLite WAL)   │ │   Episodic│Zone│Plan│PheromoneType             │   ║
║  ├──────────────┤ ├────────────────────────────────────────────────┤   ║
║  │ConfigManager │ │ MigrationRunner (versioned, idempotent)        │   ║
║  │(Zod + merge) │ │ sqlite-binding.js (createRequire wrapper)      │   ║
║  ├──────────────┤ ├────────────────────────────────────────────────┤   ║
║  │database-     │ │ config-schemas.js (Zod)  │ message-schemas.js  │   ║
║  │schemas.js(34)│ │ types.js (enums)         │ logger.js (pino)    │   ║
║  └──────────────┘ └────────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════════════════════════╝
```

**File count / 文件计数:** L1(17) + L2(4) + L3(8) + L4(12) + L5(10) + L6(4) = **55 source files**

### Dependency Rules / 依赖规则

```
Direction    L6    L5    L4    L3    L2    L1
─────────────────────────────────────────────
L6 →          .    yes   yes   yes   yes   yes     (downward: allowed / 向下：允许)
L5 →          x     .    yes   yes   yes   yes
L4 →          x     x     .    yes   yes   yes
L3 →          x     x     x     .    yes   yes
L2 →          x     x     x     x     .    yes
L1 →          x     x     x     x     x     .

Upward:    FORBIDDEN  (no L1→L2, no L3→L5, etc.)  / 向上：禁止
Lateral:   ALLOWED within same subdirectory only   / 同子目录内允许横向引用
OpenClaw:  ONLY L5 imports from OpenClaw API       / 仅 L5 耦合 OpenClaw API
```

**V4.0 vs V5.0 coupling change:** In V4.0, the adapter layer (L4) coupled to
OpenClaw. In V5.0, only L5 (Application) couples to OpenClaw, keeping L4
(Orchestration) framework-independent and reusable.

V4.0 中 adapter 层(L4)耦合 OpenClaw。V5.0 中仅 L5(应用层)耦合 OpenClaw，
L4(编排层)保持框架无关可复用。

---

## 2. Layer Details / 各层详解

### L1 Infrastructure / 基础设施层 (17 files)

The foundation layer. Provides database access, configuration, schemas, and
shared type definitions. No business logic resides here.

基础层。提供数据库访问、配置、模式定义和共享类型。此层不含业务逻辑。

#### DatabaseManager (`database-manager.js`)

- Uses `node:sqlite` `DatabaseSync` for synchronous access
- SQLite WAL (Write-Ahead Logging) mode for concurrent reads
- `sqlite-binding.js` provides `createRequire()` wrapper to resolve the
  native `node:sqlite` module in ESM context
- Connection pooling and prepared statement caching

#### 8 Repositories

| Repository | Table(s) | Primary Operations |
|---|---|---|
| `PheromoneRepo` | `pheromones` | emit, read by scope, decay batch, prune expired |
| `TaskRepo` | `tasks`, `task_deps` | CRUD, dependency graph queries, status transitions |
| `AgentRepo` | `agents`, `capabilities` | register, update scores, query by capability |
| `KnowledgeRepo` | `knowledge_nodes`, `knowledge_edges` | graph CRUD, BFS traversal support |
| `EpisodicRepo` | `episodes`, `episode_items` | store, query by recency, prune by retention |
| `ZoneRepo` | `zones`, `zone_members` | zone CRUD, membership, leader election state |
| `PlanRepo` | `plans`, `plan_steps` | plan CRUD, step ordering, validation state |
| `PheromoneTypeRepo` | `pheromone_types` | register custom types, list, delete |

Each repository follows the pattern:
```js
export class XxxRepo {
  constructor(db) { this.db = db; }  // receives DatabaseManager
  // ... domain-specific CRUD methods
}
```

#### ConfigManager (`config-manager.js`)

- Schema validation via **Zod** (from `config-schemas.js`)
- Deep merge with sensible defaults for all 6 layers
- Runtime `onChange(path, callback)` subscribers for hot-reload
- Validates on construction; throws `ConfigValidationError` on invalid input

#### MigrationRunner (`migration-runner.js`)

- Versioned schema migrations (v1, v2, v3 ...)
- Idempotent checks: reads `schema_version` from `swarm_meta` table
- Runs inside transaction; rollback on any failure
- Auto-backup before destructive migrations

#### Schemas

| File | Content |
|---|---|
| `database-schemas.js` | 34 `TABLE_SCHEMAS` constants (CREATE TABLE SQL strings) |
| `config-schemas.js` | Zod schemas for all configuration sections |
| `message-schemas.js` | Zod schemas for inter-component message validation |

#### Shared Modules

| File | Purpose |
|---|---|
| `types.js` | Shared enums (`TaskStatus`, `AgentTier`, `PheromoneType`, etc.) and type definitions |
| `logger.js` | `pino` wrapper with structured JSON logging, configurable level |

---

### L2 Communication / 通信层 (4 files)

Provides all inter-component messaging primitives. No agent logic, no
orchestration decisions -- pure message transport and signal mechanics.

提供所有组件间通信原语。无智能体逻辑、无编排决策 -- 纯消息传输与信号机制。

#### MessageBus (`message-bus.js`)

```
Architecture:
  EventEmitter3-based pub/sub

  Topic wildcards:
    "task.*"       matches  task.created, task.completed, task.failed, ...
    "agent.*"      matches  agent.registered, agent.scored, ...
    Matching rule: prefix before first "." + wildcard "*"

  Dead Letter Queue (DLQ):
    - Failed handler invocations are captured with { topic, message, error, timestamp }
    - DLQ has configurable max size (default 100)
    - Queryable for monitoring and debugging

  Message History:
    - Ring buffer (configurable size, default 500)
    - Stores last N messages for replay/debugging
    - Oldest entries evicted when buffer full
```

#### PheromoneEngine (`pheromone-engine.js`)

```
MMAS (Max-Min Ant System) bounds:
  - intensity clamped to [MIN_INTENSITY, MAX_INTENSITY]
  - prevents starvation (floor) and dominance (ceiling)

Exponential decay model:
  intensity(t) = I0 * e^(-lambda * t_minutes)

  Where:
    I0     = initial intensity at emission time
    lambda = type-specific decay rate constant
    t      = elapsed minutes since emission

Operations:
  emit(type, scope, data, intensity)  → PheromoneRepo.insert
  read(scope, options)                → PheromoneRepo.query + decay calc
  decay()                             → batch update all active pheromones
  prune()                             → remove intensity < MIN_INTENSITY
```

#### GossipProtocol (`gossip-protocol.js`)

- **Epidemic-style** state broadcast for swarm-wide consistency
- Configurable **fanout** (default 3): each gossip round sends to N peers
- Heartbeat timer triggers periodic gossip rounds
- State merging uses **version vectors** to resolve conflicts
- Suitable for propagating agent availability, load, and health

#### PheromoneTypeRegistry (`pheromone-type-registry.js`)

- Registers custom pheromone types beyond the **5 built-in**:
  `trail`, `alarm`, `recruit`, `queen`, `dance`
- Custom types specify: `name`, `defaultDecayRate`, `defaultTTL`, `description`
- Backed by `PheromoneTypeRepo` for persistence across restarts
- Validates uniqueness of type names

---

### L3 Agent / 智能体层 (8 files)

Individual agent cognition: memory, capabilities, identity, and persona. This
layer models what a single agent *knows* and *is*. It does NOT coordinate
multiple agents (that is L4).

单个智能体的认知：记忆、能力、身份与人格。此层建模单个智能体的知识与特性。
不负责多智能体协调（那是 L4 的职责）。

#### Memory Subsystem / 记忆子系统

**WorkingMemory** (`working-memory.js`)
```
3-tier buffer architecture:
  ┌─────────────────────────────────────────┐
  │ FOCUS    (max 5)   highest priority     │  ← active task context
  ├─────────────────────────────────────────┤
  │ CONTEXT  (max 15)  medium priority      │  ← recent relevant info
  ├─────────────────────────────────────────┤
  │ SCRATCHPAD (max 30) lowest priority     │  ← temporary notes
  └─────────────────────────────────────────┘

  Eviction policy: when a tier is full, lowest-priority item is
  demoted to the tier below. Scratchpad overflow → discard.

  Methods: add(item, tier), promote(id), demote(id), clear(tier)
```

**EpisodicMemory** (`episodic-memory.js`)
```
Ebbinghaus forgetting curve:
  retention(t) = e^(-t / S)

  Where:
    t = time since encoding (hours)
    S = stability factor (increases with rehearsal)

  consolidate(): batches working memory items into episodic store
  prune():       removes items where retention < threshold (default 0.1)
  recall(query): returns items sorted by relevance * retention
```

**SemanticMemory** (`semantic-memory.js`)
```
BFS-based knowledge graph:
  Nodes: { id, type, content, metadata }
  Edges: { source, target, relation, weight }

  Methods:
    addNode(node)                    → insert node
    addEdge(source, target, rel)     → insert edge
    getRelated(nodeId, maxHops=2)    → BFS traversal up to maxHops
    findPath(from, to)              → shortest path via BFS
    merge(otherGraph)               → union merge with conflict resolution
    buildContextSnippet(nodeId)     → serializes subgraph for LLM prompt
```

**ContextCompressor** (`context-compressor.js`)
- Truncates and/or summarizes context to fit within LLM token window
- Strategies: truncation (hard cut), extractive summary, priority-based selection
- Token counting via heuristic (chars / 4) or configurable tokenizer

#### Agent Identity & Capability / 智能体身份与能力

**CapabilityEngine** (`capability-engine.js`)
```
4D scoring dimensions:
  1. technical    — code quality, correctness, complexity handling
  2. delivery     — speed, reliability, deadline adherence
  3. collaboration — peer interaction quality, helpfulness
  4. innovation   — creative solutions, novel approaches

ACO (Ant Colony Optimization) roulette for task selection:
  - Probability of agent i selecting task j:
    P(i,j) = (capability_score(i,j)^alpha * pheromone(j)^beta) / sum
  - Balances exploitation (high-scoring agents) with exploration

Uses AgentRepo for persistence.
```

**PersonaEvolution** (`persona-evolution.js`)
```
PARL (Persona A/B Reinforcement Learning):
  - Mutation: small random perturbations to persona parameters
  - A/B testing: run variant personas on similar tasks
  - Win-rate tracking per persona x taskType
  - Capsule promotion: high-performing persona variants become defaults
  - Configurable mutation rate (default 0.05)
```

**ReputationLedger** (`reputation-ledger.js`)
- Multi-factor contribution scoring (code contributions, reviews, assists)
- Time-weighted: recent contributions count more
- Uses AgentRepo for persistence

**SoulDesigner** (`soul-designer.js`)
```
4 built-in bee personas:
  ┌──────────────────┬────────────────────────────────────────────┐
  │ Persona          │ Best For                                   │
  ├──────────────────┼────────────────────────────────────────────┤
  │ scout-bee        │ investigate, explore, research, discover   │
  │ worker-bee       │ implement, build, fix, refactor, test      │
  │ guard-bee        │ audit, security, review, validate, protect │
  │ queen-messenger  │ plan, architecture, design, coordinate     │
  └──────────────────┴────────────────────────────────────────────┘

Selection: keyword-based matching against task description
  design(profile) → generates SOUL snippet string for LLM injection
  No match → defaults to worker-bee
```

---

### L4 Orchestration / 编排层 (12 files)

Multi-agent coordination, task decomposition, scheduling, quality control, and
zone management. This layer decides *who does what, when, and how well*.

多智能体协调、任务分解、调度、质量控制与区域管理。此层决定谁做什么、何时做、
做得如何。

**Note (V5.0 change):** In V4.0 this layer was the adapter that coupled to
OpenClaw. In V5.0, L4 is **framework-independent** orchestration logic. OpenClaw
coupling moved to L5.

注意（V5.0 变更）：V4.0 中此层是耦合 OpenClaw 的适配层。V5.0 中 L4 是框架无关的
编排逻辑，OpenClaw 耦合移至 L5。

| Component | File | Algorithm / Pattern | Key Methods |
|---|---|---|---|
| **Orchestrator** | `orchestrator.js` | DAG-based task decomposition | `decompose(task)` creates subtask tree. Uses TaskRepo + AgentRepo + MessageBus |
| **CriticalPathAnalyzer** | `critical-path.js` | CPM (Critical Path Method) | `findCriticalPath()` returns longest dependency chain with slack times |
| **QualityController** | `quality-controller.js` | Multi-rubric evaluation | `_checkStructural()` + `_checkCompletion()` + `_semanticReview()`. Weighted scoring |
| **PipelineBreaker** | `pipeline-breaker.js` | State machine | States: `running` -> `paused` -> `failed` -> `completed`. Transition guards |
| **ResultSynthesizer** | `result-synthesizer.js` | Jaccard similarity | Duplicate detection, file path conflict resolution, quality-weighted merge |
| **ExecutionPlanner** | `execution-planner.js` | GEP (Gene Expression Programming) | Chromosome encoding of task sequences. Fitness-based evolution |
| **ContractNet** | `contract-net.js` | FIPA Contract Net Protocol | `callForProposals()` -> evaluate bids -> `awardContract()` |
| **ReplanEngine** | `replan-engine.js` | Pheromone-triggered replanning | Monitors ALARM density. Auto-triggers replan when threshold exceeded |
| **ABCScheduler** | `abc-scheduler.js` | Artificial Bee Colony | 3 phases: employed bees, onlooker bees, scout bees. Resource scheduling |
| **RoleDiscovery** | `role-discovery.js` | k-means++ clustering | Discovers implicit roles from agent capability vectors |
| **RoleManager** | `role-manager.js` | MoE (Mixture of Experts) | Gating network routes tasks to best-fit roles |
| **ZoneManager** | `zone-manager.js` | Spatial management | Jaccard auto-assign for zone membership. Leader election. Health check |

---

### L5 Application / 应用层 (10 files)

**The sole coupling point to OpenClaw.** This layer adapts the swarm engine
(L1-L4) to the OpenClaw plugin API. If you replaced OpenClaw with another
host, only L5 would change.

**唯一的 OpenClaw 耦合点。** 此层将蜂群引擎(L1-L4)适配到 OpenClaw 插件 API。
若更换宿主框架，仅需修改 L5。

#### PluginAdapter (`plugin-adapter.js`)

The central dependency injection container and lifecycle manager.

```
Responsibilities:
  1. Creates ALL engines (L1 through L6) via dependency injection
  2. Wires lifecycle hooks to OpenClaw events
  3. Registers tools with OpenClaw API

  getHooks()  → returns 14 internal handler functions
                (before_agent_start, after_tool_call, agent_end,
                 subagent_spawning, subagent_ended, before_reset,
                 gateway_stop, message_sending, ...)

  getTools()  → returns 7 tool definitions
                (swarm-spawn, swarm-query, swarm-pheromone,
                 swarm-gate, swarm-memory, swarm-plan, swarm-zone)

  close()     → reverse-order shutdown (L6 → L5 → ... → L1)
                ensures no dangling connections or timers
```

#### ContextService (`context-service.js`)

Builds rich `prependContext` for LLM injection from multiple sources:

```
Context assembly pipeline:
  ┌─────────────────┐
  │ Working Memory   │──┐
  ├─────────────────┤  │
  │ Episodic Memory  │──┤
  ├─────────────────┤  ├──→ merge + prioritize ──→ prependContext string
  │ Semantic Memory  │──┤
  ├─────────────────┤  │
  │ Pheromone State  │──┤
  ├─────────────────┤  │
  │ Gossip State     │──┘
  └─────────────────┘

  TTL-based caching: 30-second cache to avoid rebuilding on rapid calls
  Cache key: agentId + scope hash
```

#### CircuitBreaker (`circuit-breaker.js`)

```
3-state pattern:
  CLOSED ──(failure threshold reached)──→ OPEN
  OPEN   ──(timeout expires)────────────→ HALF_OPEN
  HALF_OPEN ──(success threshold met)──→ CLOSED
  HALF_OPEN ──(any failure)────────────→ OPEN

  execute(fn, fallback):
    if OPEN   → return fallback()
    if CLOSED → try fn(), track failures
    if HALF   → try fn(), promote or demote

  Configurable: failureThreshold (5), successThreshold (3), timeout (60s)
```

#### 7 Tool Factories / 7 个工具工厂

Each factory creates a tool object: `{ name, description, inputSchema, handler }`.

| Factory File | Tool Name | Capability |
|---|---|---|
| `swarm-spawn-tool.js` | `swarm-spawn` | MoE role selection + agent creation. Spawns sub-agents with persona-specific SOUL snippets |
| `swarm-query-tool.js` | `swarm-query` | Status queries: agent list, task progress, pheromone state, zone info |
| `swarm-pheromone-tool.js` | `swarm-pheromone` | Emit / read / decay pheromones. Agents communicate indirectly |
| `swarm-gate-tool.js` | `swarm-gate` | Quality evaluation gate. Runs QualityController rubrics on agent output |
| `swarm-memory-tool.js` | `swarm-memory` | Record / recall / knowledge graph operations. Working + episodic + semantic |
| `swarm-plan-tool.js` | `swarm-plan` | Plan design and validation. ExecutionPlanner + CriticalPathAnalyzer |
| `swarm-zone-tool.js` | `swarm-zone` | Zone CRUD + Jaccard auto-assign. Spatial management for agent groups |

---

### L6 Monitoring / 监控层 (4 files)

Real-time observability into the swarm. Consumes events from the MessageBus
(L2) and exposes metrics via HTTP/SSE.

蜂群实时可观测性。从 MessageBus(L2)消费事件，通过 HTTP/SSE 暴露指标。

#### StateBroadcaster (`state-broadcaster.js`)

```
Subscribes to MessageBus with 7 topic wildcards:
  task.*        — task creation, completion, failure
  agent.*       — agent registration, scoring, removal
  pheromone.*   — emission, decay, pruning events
  quality.*     — quality gate evaluations
  memory.*      — memory consolidation, pruning events
  zone.*        — zone creation, membership changes
  system.*      — startup, shutdown, errors

SSE push: forwards matched events to all connected SSE clients
```

#### MetricsCollector (`metrics-collector.js`)

```
RED metrics (standard):
  Rate     — requests per second (tool calls, hook invocations)
  Error    — error count and error rate percentage
  Duration — p50, p95, p99 latency per operation

Swarm-specific counters:
  active_agents      — currently registered agents
  task_throughput     — tasks completed per minute
  pheromone_density   — active pheromones per scope
  memory_utilization  — working memory fill percentage
  zone_count          — active zones

Rolling time-series window: configurable retention (default 1 hour)
```

#### DashboardService (`dashboard-service.js`)

```
Fastify HTTP server (lazy import — not loaded until monitoring enabled):

  Routes:
    GET /                → serves dashboard.html (dark theme UI)
    GET /api/metrics     → JSON snapshot of MetricsCollector
    GET /api/stats       → aggregated swarm statistics
    GET /events          → SSE stream from StateBroadcaster
```

#### Dashboard UI (`dashboard.html`)

- Dark theme with CSS Grid layout
- SSE auto-connect to `/events` for real-time updates
- 5-second polling interval for `/api/metrics`
- Sections: Agent Overview, Task Pipeline, Pheromone Heatmap, Zone Map

---

## 3. OpenClaw Integration / OpenClaw 集成

### Entry Point / 入口

`src/index.js` exports the standard OpenClaw plugin interface:

```js
export default {
  id: 'claw-swarm',
  register(api) {
    const adapter = new PluginAdapter(api);
    // hooks, tools, and lifecycle wired inside
  }
};
```

### Hook Event Mapping / 钩子事件映射

| OpenClaw Event | V5.0 Internal Hook(s) | Layer | Modifying? |
|---|---|---|---|
| `before_agent_start` | ContextService.build, PheromoneEngine.snapshot, GossipProtocol.getState | L5 | Yes (returns prependContext) |
| `after_tool_call` | WorkingMemory.add, CapabilityEngine.record, ReplanEngine.check | L3+L4 | No |
| `message_sending` | GossipProtocol.broadcast | L2 | No |
| `agent_end` | EpisodicMemory.consolidate, PheromoneEngine.emit(trail), PersonaEvolution.record | L3 | No |
| `subagent_spawning` | ContractNet.evaluate, ZoneManager.assign | L4 | Yes (can reject) |
| `subagent_ended` | ResultSynthesizer.merge, ReputationLedger.record, PheromoneEngine.emit(trail) | L3+L4 | No |
| `before_reset` | WorkingMemory.clear, GossipProtocol.reset | L2+L3 | No |
| `gateway_stop` | PluginAdapter.close (reverse-order shutdown L6->L1) | L5 | No |

### Tool Registration / 工具注册

```js
// Inside PluginAdapter.register():
for (const toolDef of this.getTools()) {
  api.registerTool(toolDef);
  // toolDef = { name, description, inputSchema, handler }
}
```

### Configuration / 配置

```js
// Plugin config accessed via OpenClaw API:
const config = api.pluginConfig;  // user-provided config object
const merged = ConfigManager.merge(defaults, config);  // Zod-validated
```

---

## 4. Data Flow / 数据流

### Agent Lifecycle Flow / 智能体生命周期流

```
┌──────────────────────────────────────────────────────────────────────┐
│                         AGENT LIFECYCLE                              │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ before_agent_start (modifying)                               │    │
│  │                                                               │    │
│  │  ContextService.build()                                       │    │
│  │    ├─ WorkingMemory.getFocus()          → focus items         │    │
│  │    ├─ EpisodicMemory.recall(scope)      → recent episodes     │    │
│  │    ├─ SemanticMemory.buildSnippet()     → knowledge graph     │    │
│  │    ├─ PheromoneEngine.snapshot(scope)   → active signals      │    │
│  │    └─ GossipProtocol.getState()        → peer states          │    │
│  │                                                               │    │
│  │  → Returns { prependContext: mergedText }                     │    │
│  └─────────────────────┬───────────────────────────────────────┘    │
│                         ↓                                            │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ Tool Calls (repeated per tool invocation)                    │    │
│  │                                                               │    │
│  │  after_tool_call:                                             │    │
│  │    ├─ WorkingMemory.add(result, CONTEXT)                      │    │
│  │    ├─ CapabilityEngine.recordOutcome(agentId, tool, success)  │    │
│  │    └─ ReplanEngine.checkAlarmDensity(scope)                   │    │
│  │         └─ if threshold exceeded → Orchestrator.replan()      │    │
│  └─────────────────────┬───────────────────────────────────────┘    │
│                         ↓                                            │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ agent_end (once per agent)                                   │    │
│  │                                                               │    │
│  │  1. EpisodicMemory.consolidate(workingMemory)                │    │
│  │  2. PheromoneEngine.emit(TRAIL, scope, summary)              │    │
│  │  3. PersonaEvolution.recordOutcome(persona, taskType, result)│    │
│  │  4. ReputationLedger.addContribution(agentId, metrics)       │    │
│  │  5. MessageBus.publish('agent.ended', { agentId, result })   │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

### Subagent Lifecycle / 子代理生命周期

```
┌──────────────────────────────────────────────────────────────────────┐
│                       SUBAGENT LIFECYCLE                             │
│                                                                      │
│  Parent calls swarm-spawn tool                                       │
│    │                                                                 │
│    ↓                                                                 │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ subagent_spawning                                            │    │
│  │                                                               │    │
│  │  1. RoleManager.matchRole(taskDescription)  → bestRole        │    │
│  │  2. SoulDesigner.design(bestRole.profile)   → SOUL snippet    │    │
│  │  3. ContractNet.callForProposals(task)       → bid evaluation  │    │
│  │  4. ZoneManager.autoAssign(agentId, scope)  → zone membership │    │
│  │  5. CapabilityEngine.checkEligibility()     → gate check      │    │
│  │                                                               │    │
│  │  → Can REJECT spawn if gate check fails                       │    │
│  └──────────────────────┬───────────────────────────────────────┘    │
│                         ↓                                            │
│  [ Subagent executes with SOUL-injected personality ]                │
│                         ↓                                            │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ subagent_ended                                               │    │
│  │                                                               │    │
│  │  1. ResultSynthesizer.merge(parentResults, subagentResult)    │    │
│  │     ├─ Jaccard similarity check (duplicate detection)         │    │
│  │     └─ File path conflict resolution                          │    │
│  │  2. ReputationLedger.addContribution(subagentId, metrics)     │    │
│  │  3. PheromoneEngine.emit(TRAIL, scope, summary)               │    │
│  │  4. PersonaEvolution.recordOutcome(persona, taskType, result) │    │
│  │  5. MessageBus.publish('agent.subagent_ended', { ... })       │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

### Pheromone Signal Flow / 信息素信号流

```
Agent-A emits RECRUIT at scope "/src/auth/"
  │
  ├─→ PheromoneEngine.emit()
  │     ├─→ PheromoneRepo.insert(type, scope, data, intensity)
  │     └─→ MessageBus.publish('pheromone.emitted', {...})
  │           └─→ StateBroadcaster → SSE to dashboard
  │
  ↓ (time passes, intensity decays: I(t) = I0 * e^(-lambda*t))
  │
  Agent-B starts → before_agent_start fires
  │
  ├─→ PheromoneEngine.snapshot("/src/auth/")
  │     └─→ returns: [{ type: RECRUIT, intensity: 0.82, data: "..." }]
  │
  └─→ ContextService injects into prependContext:
        "ACTIVE SIGNALS: RECRUIT @ /src/auth/ (intensity: 0.82) ..."
```

---

## 5. Design Decisions / 设计决策

| # | Decision / 决策 | Choice / 选择 | Alternative / 备选 | Rationale / 原理 |
|---|---|---|---|---|
| 1 | Layer count | 6 layers (from V4.0's 4) | Keep 4-layer structure | Agent cognition (L3) and orchestration (L4) have fundamentally different concerns; monitoring (L6) deserves isolation for optional deployment / 智能体认知与编排关注点根本不同；监控层支持可选部署 |
| 2 | OpenClaw coupling | Only L5 (was L4 in V4.0) | L4 couples to OpenClaw | L4 orchestration algorithms (CPM, ABC, Contract Net) are framework-independent and reusable / L4 编排算法框架无关可复用 |
| 3 | Database access | Repository pattern (8 repos) | Single monolithic db.js (V4.0: 69 functions) | Repos provide bounded contexts; testable in isolation; V4.0's 1000+ line db.js was unmaintainable / 仓库模式提供有界上下文，独立可测 |
| 4 | SQLite binding | `createRequire()` wrapper | Direct `node:sqlite` import | ESM cannot directly require native modules; wrapper provides consistent import path / ESM 无法直接 require 原生模块 |
| 5 | Config validation | Zod schemas | Manual validation | Zod provides type inference, composable schemas, and clear error messages / Zod 提供类型推断与清晰错误信息 |
| 6 | Inter-agent messaging | MessageBus (pub/sub) + Gossip | Direct function calls | Decouples producers from consumers; gossip ensures eventual consistency across agents / 发布订阅解耦生产者消费者 |
| 7 | Task scheduling | ABC (Artificial Bee Colony) | Round-robin, random | ABC balances exploitation and exploration; scout phase prevents local optima / ABC 平衡开发与探索 |
| 8 | Role assignment | MoE (Mixture of Experts) gating | Static mapping | MoE adapts routing weights based on task-role fit scores; handles novel task types / MoE 基于匹配度动态路由 |
| 9 | Replanning trigger | Pheromone ALARM density | Timer-based or manual | Organic: problem density naturally triggers replanning; no arbitrary thresholds / 问题密度自然触发，无需人为阈值 |
| 10 | Memory architecture | 3-tier working + episodic + semantic | Single flat memory store | Mirrors human cognitive architecture; each tier has distinct retention and access patterns / 模仿人类认知架构 |
| 11 | Monitoring transport | SSE (Server-Sent Events) | WebSocket | SSE is simpler (HTTP-based, no upgrade), unidirectional (server->client) which matches monitoring use case / SSE 更简单，单向推送匹配监控场景 |
| 12 | Dashboard server | Fastify (lazy import) | Express, no server | Fastify is faster than Express; lazy import means zero overhead when monitoring disabled / Fastify 更快；懒加载无性能开销 |

---

## 6. Technology Choices / 技术选型

| Component / 组件 | Choice / 选择 | Version / 版本 | Rationale / 原理 |
|---|---|---|---|
| Runtime | Node.js | 22+ | Required for built-in `node:sqlite` (DatabaseSync). LTS stability / 内置 SQLite，LTS 稳定 |
| Database | SQLite | WAL mode | Zero-deployment, single-file, concurrent reads. No external server / 零部署，单文件，并发读 |
| DB Binding | `node:sqlite` DatabaseSync | Built-in | No native addon compilation; synchronous API simplifies transaction logic / 无需编译原生插件 |
| Schema Validation | Zod | 3.x | Runtime type checking, composable schemas, TypeScript-compatible / 运行时类型检查，可组合 |
| Logging | pino | 9.x | Structured JSON logging, low overhead, configurable transports / 结构化日志，低开销 |
| Pub/Sub | EventEmitter3 | 5.x | Faster than Node built-in EventEmitter, wildcard support / 比内置 EventEmitter 更快 |
| HTTP Server | Fastify | 5.x | High performance, schema-based validation, plugin ecosystem. Lazy-loaded / 高性能，按需加载 |
| Test Framework | vitest | latest | Fast HMR-based test runner, ESM native, compatible with Jest API / 快速 HMR 测试，ESM 原生 |
| Module System | ES Modules (ESM) | — | `"type": "module"` in package.json. Tree-shakeable, standard / 现代标准，可 tree-shake |
| Package Manager | npm | — | Standard Node.js package manager. No extra tooling / 标准包管理器 |

---

## Appendix A: File Map / 附录 A：文件全景

```
E:\OpenClaw\data\swarm\
├── package.json
├── src/
│   ├── index.js                              # { id:'claw-swarm', register(api) }
│   │
│   ├── L1-infrastructure/                    # ══ 17 files ══
│   │   ├── database/
│   │   │   ├── database-manager.js           #   SQLite WAL, DatabaseSync
│   │   │   ├── sqlite-binding.js             #   createRequire() wrapper
│   │   │   ├── migration-runner.js           #   versioned schema migrations
│   │   │   └── repositories/
│   │   │       ├── pheromone-repo.js          #   pheromone CRUD
│   │   │       ├── task-repo.js              #   task + dependency CRUD
│   │   │       ├── agent-repo.js             #   agent + capability CRUD
│   │   │       ├── knowledge-repo.js         #   knowledge graph CRUD
│   │   │       ├── episodic-repo.js          #   episodic memory CRUD
│   │   │       ├── zone-repo.js              #   zone + membership CRUD
│   │   │       ├── plan-repo.js              #   plan + step CRUD
│   │   │       └── pheromone-type-repo.js    #   custom pheromone type CRUD
│   │   ├── config/
│   │   │   └── config-manager.js             #   Zod validation, deep merge, onChange
│   │   ├── schemas/
│   │   │   ├── database-schemas.js           #   34 TABLE_SCHEMAS
│   │   │   ├── config-schemas.js             #   Zod config schemas
│   │   │   └── message-schemas.js            #   Zod message schemas
│   │   ├── types.js                          #   shared enums & type defs
│   │   └── logger.js                         #   pino wrapper
│   │
│   ├── L2-communication/                     # ══ 4 files ══
│   │   ├── message-bus.js                    #   pub/sub, wildcards, DLQ
│   │   ├── pheromone-engine.js               #   MMAS bounds, exponential decay
│   │   ├── gossip-protocol.js                #   epidemic broadcast, version vectors
│   │   └── pheromone-type-registry.js        #   custom pheromone type registration
│   │
│   ├── L3-agent/                             # ══ 8 files ══
│   │   ├── memory/
│   │   │   ├── working-memory.js             #   3-tier: focus/context/scratchpad
│   │   │   ├── episodic-memory.js            #   Ebbinghaus forgetting curve
│   │   │   ├── semantic-memory.js            #   BFS knowledge graph
│   │   │   └── context-compressor.js         #   LLM window fitting
│   │   ├── capability-engine.js              #   4D scoring, ACO roulette
│   │   ├── persona-evolution.js              #   PARL A/B testing
│   │   ├── reputation-ledger.js              #   multi-factor scoring
│   │   └── soul-designer.js                  #   4 bee personas, keyword selection
│   │
│   ├── L4-orchestration/                     # ══ 12 files ══
│   │   ├── orchestrator.js                   #   DAG task decomposition
│   │   ├── critical-path.js                  #   CPM analysis
│   │   ├── quality-controller.js             #   multi-rubric evaluation
│   │   ├── pipeline-breaker.js               #   state machine lifecycle
│   │   ├── result-synthesizer.js             #   Jaccard dedup + merge
│   │   ├── execution-planner.js              #   GEP chromosome encoding
│   │   ├── contract-net.js                   #   FIPA Contract Net Protocol
│   │   ├── replan-engine.js                  #   alarm-triggered replanning
│   │   ├── abc-scheduler.js                  #   Artificial Bee Colony
│   │   ├── role-discovery.js                 #   k-means++ clustering
│   │   ├── role-manager.js                   #   MoE routing
│   │   └── zone-manager.js                   #   spatial zones, Jaccard assign
│   │
│   ├── L5-application/                       # ══ 10 files ══
│   │   ├── plugin-adapter.js                 #   DI container, lifecycle, OpenClaw bridge
│   │   ├── context-service.js                #   LLM context builder, TTL cache
│   │   ├── circuit-breaker.js                #   CLOSED/OPEN/HALF_OPEN
│   │   └── tools/
│   │       ├── swarm-spawn-tool.js           #   MoE role + agent creation
│   │       ├── swarm-query-tool.js           #   status queries
│   │       ├── swarm-pheromone-tool.js        #   emit/read/decay
│   │       ├── swarm-gate-tool.js            #   quality evaluation
│   │       ├── swarm-memory-tool.js          #   record/recall/knowledge
│   │       ├── swarm-plan-tool.js            #   plan design/validate
│   │       └── swarm-zone-tool.js            #   zone CRUD + auto-assign
│   │
│   └── L6-monitoring/                        # ══ 4 files ══
│       ├── state-broadcaster.js              #   MessageBus → SSE push
│       ├── metrics-collector.js              #   RED metrics + swarm counters
│       ├── dashboard-service.js              #   Fastify HTTP server
│       └── dashboard.html                    #   dark theme CSS Grid UI
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── stress/
│
└── docs/
    ├── architecture.md                       # THIS FILE / 本文件
    ├── migration-guide.md
    ├── pheromone-model.md
    └── soul-designer.md
```

---

## Appendix B: V4.0 to V5.0 Migration Summary / 附录 B：V4.0 → V5.0 迁移摘要

| Aspect | V4.0 | V5.0 | Migration Impact |
|---|---|---|---|
| Layer count | 4 (`layer1-core` ... `layer4-adapter`) | 6 (`L1-infrastructure` ... `L6-monitoring`) | All import paths change |
| OpenClaw coupling | L4 (adapter layer) | L5 (application layer) | Plugin adapter moved up one layer |
| Database access | Monolithic `db.js` (69 functions) | 8 Repository classes | All DB callers refactored to use repos |
| Config validation | Manual checks in `config.js` | Zod schemas in `config-schemas.js` | Config format unchanged; validation stricter |
| Test framework | `node:test` + `node:assert/strict` | `vitest` | Test files migrated to vitest syntax |
| Messaging | None (direct function calls) | MessageBus (pub/sub) + GossipProtocol | Components decoupled via events |
| Memory model | Flat OME memory engine | 3-tier working + episodic + semantic | Memory API completely redesigned |
| Monitoring | `monitor.js` ring buffer | L6: StateBroadcaster + MetricsCollector + Dashboard | New capability; no V4.0 equivalent |
| Schemas | Inline in `db.js` | `database-schemas.js` (34 TABLE_SCHEMAS) | Extracted; schema count grew from 25 to 34 |
| Pheromone types | Hardcoded 5 types | 5 built-in + PheromoneTypeRegistry for custom | Extensible; backward compatible |
