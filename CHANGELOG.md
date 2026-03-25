# Changelog

All notable changes to Claw-Swarm are documented here.

本文件记录 Claw-Swarm 的所有重要变更。

## [9.0.0] - 2026-03-18

### Field-Mediated Coupling Architecture / 场中介耦合架构

**Core Theme / 核心主题**: Replace 7-layer linear hierarchy with 7-domain + dual-foundation field-mediated coupling. Zero feature flags. Zero idle modules. 12-dimensional continuous signal field replaces 5-type × 19-subtype signal taxonomy.

**核心主题**：用 7 域 + 双基座场中介耦合替代 7 层线性层级。零功能开关。零空转模块。12 维连续信号场替代 5 类型 × 19 子类型信号分类。

#### Architecture: 7 Layers → 7 Domains / 架构：7 层 → 7 域

| Domain / 域 | Files / 文件 | Lines / 行数 | Responsibility / 职责 |
|---|---|---|---|
| core | 12 | 1,953 | SignalField, DomainStore, EventBus, ModuleBase |
| communication | 8 | 1,281 | Pheromones (MMAS), task channels, stigmergic board |
| intelligence | 34 | 5,606 | Memory, identity, social, artifacts, understanding |
| orchestration | 24 | 6,889 | DAG planner, adaptation, scheduling |
| quality | 10 | 2,738 | Evidence gate, circuit breaker, vaccination |
| observe | 13 | 1,651 | Dashboard (57+ REST), metrics, health, SSE |
| bridge | 24 | 4,526 | 10 tools, 16 hooks, session, model fallback |
| **Total** | **121** | **25,447** | |

#### Dual Foundation / 双基座

- **SignalField**: 12-dimensional forward-decay signal field (`src/core/field/signal-store.js`, 382 lines)
- **DomainStore**: In-memory state with JSON snapshot persistence (`src/core/store/domain-store.js`, 287 lines)
- **EventBus**: Pub/sub with wildcard support, 27 standard topics (`src/core/bus/event-bus.js`, 175 lines)

#### 12-Dimensional Signal Field / 12 维信号场

| Dimension | Decay λ | Purpose |
|---|---|---|
| task_load | 0.02 | Task queue pressure |
| error_rate | 0.10 | Rolling error frequency |
| latency | 0.05 | Response time distribution |
| throughput | 0.03 | Messages/time |
| cost | 0.02 | Token + API cost |
| quality | 0.03 | Output quality |
| coherence | 0.04 | Goal alignment |
| trust | 0.01 | Peer trust |
| novelty | 0.06 | Pattern divergence |
| urgency | 0.08 | Time sensitivity |
| complexity | 0.04 | Task difficulty |
| resource_pressure | 0.03 | Resource saturation |

#### ModuleBase Contract / ModuleBase 契约

All modules extend `ModuleBase` and declare `static produces()`, `static consumes()`, `static publishes()`, `static subscribes()`. `SwarmCoreV9._verifyCoupling()` validates connectivity at startup.

#### Tool Expansion: 4+6 → 10 / 工具扩展

| Tool | Purpose |
|---|---|
| `swarm_run` | Plan + MoE model selection + spawn + execute |
| `swarm_query` | Read-only swarm state (10 scopes) |
| `swarm_dispatch` | Forward message to running agent |
| `swarm_checkpoint` | Pause for human approval |
| `swarm_spawn` | Direct agent spawn |
| `swarm_pheromone` | Stigmergic communication |
| `swarm_gate` | Evidence-based quality gating |
| `swarm_memory` | Semantic memory operations |
| `swarm_plan` | DAG plan management |
| `swarm_zone` | File/resource zone management |

#### Hook Adapter: 20 → 16 / 钩子适配器

Single-process model eliminates Tier-A/Tier-B split. 16 hooks registered directly on the app: session_start, session_end, message_created, before_agent_start, agent_start, agent_end, llm_output, before_tool_call, after_tool_call, prependSystemContext, before_shutdown, error, tool_result, agent_message, activate, deactivate.

#### Zero Feature Flags / 零功能开关

All `enabled: true/false` config properties removed. Every module is unconditionally active. `install.js` generates a 7-domain config structure with no feature toggles.

#### Breaking Changes / 破坏性变更

- **SQLite removed**: Replaced by DomainStore (in-memory + JSON snapshots). No `node:sqlite` dependency.
- **7-layer directory removed**: `src/L0-L6` replaced by `src/{core,communication,intelligence,orchestration,quality,observe,bridge}`
- **MeshNode removed**: Replaced by `ModuleBase` with `produces()`/`consumes()` contract
- **Feature flags removed**: All config `enabled` properties deleted
- **IPC protocol removed**: Single-process model, no `child_process.fork()`
- **Event topics reduced**: From 166 (V8) to 27 standard topics
- **Process model changed**: SwarmCore runs in-process within OpenClaw Gateway

---

## [8.2.0] - 2026-03-16

### Signal-Mesh Architecture & Model Registry / 信号-网格架构与模型注册表

**Core Theme**: Introduce a biological signal field as the foundational substrate (Layer 0) for all engine-to-engine communication, replacing point-to-point event wiring with typed signal propagation through a directed scope graph. Add 8D model capability profiling for 35+ LLM models with MoE routing, and 6D emotional intelligence tracking per agent.

核心主题：引入生物信号场作为所有引擎间通信的基础基板（第 0 层），用通过有向作用域图传播的类型化信号替代点对点事件连接。新增 35+ 模型的 8D 能力画像与 MoE 路由，以及每代理 6D 情绪智慧追踪。

#### New Layer: L0 Signal Field / 新增层级：L0 信号场

| Module | Lines | Description |
|--------|-------|-------------|
| `signal.js` | — | Signal primitives: 5 types (BIOCHEMICAL, STIGMERGIC, EPISODIC, NUTRITIONAL, EMOTIONAL) × 19 subtypes |
| `mesh-node.js` | 437 | Base class: receptor/effector pattern, bindField, activation tracking |
| `signal-field.js` | — | Shared medium: deposit → BFS propagate → _notifyMeshNodes |
| `scope-graph.js` | — | Directed graph: BFS reachability for signal scoping |
| `native-core.js` | — | High-performance signal storage with JS fallback |
| + 12 more files | — | Transducers, adapters, guards, migration, IPC schema |

#### 11 MeshNode Engine Subclasses / 11 个 MeshNode 引擎子类

All engines migrated from MessageBus subscriptions to MeshNode receptor/effector pattern:

| Engine | Layer | Receptor | Signal |
|--------|-------|----------|--------|
| QualityController | L4 | TRAIL | quality_evaluated |
| GlobalModulator | L4 | ALARM | modulation_applied |
| FailureModeAnalyzer | L3 | ALARM | VACCINE |
| PersonaEvolution | L3 | evolution_trigger | persona_updated |
| ABCScheduler | L4 | RECRUIT | role_assigned |
| CapabilityEngine | L3 | TRAIL | capability_updated |
| ReputationLedger | L3 | quality_evaluated | reputation_changed |
| SignalCalibrator | L4 | TRAIL, ALARM | weights_calibrated |
| ConflictResolver | L4 | conflict | resolution_applied |
| HybridRetrieval | L3 | memory | retrieval_complete |
| ModelCapabilityRegistry | L3 | model_update | model_scores_updated |

#### Model Capability Registry / 模型能力注册表

- 35+ built-in LLM model profiles with 8D capability vectors
- 8 dimensions: coding, architecture, testing, documentation, security, performance, communication, domain
- MoE routing: dot-product similarity between task requirements and model capabilities
- EMA recalibration (α=0.3) based on observed task outcomes
- LLM-powered task analysis (`llmAnalyzeTask`) with keyword fallback

#### Emotional Intelligence / 情绪智慧

- 6D emotion vector per agent: frustration, confidence, curiosity, resistance, openness, trust
- EMA smoothing (α=0.3), baseline 0.5, decay 0.05/turn
- Cultural friction model for cross-model collaboration cost
- Sensemaking engine for retrospective outcome analysis
- Bias detector for cognitive bias identification

#### New Source Files / 新增源文件

| Module | Layer | Description |
|--------|-------|-------------|
| `emotional-state-tracker.js` | L3 | 6D emotion vector with EMA |
| `emotional-intelligence.js` | L3 | Higher-level affect interpretation |
| `cultural-friction.js` | L3 | Cross-model collaboration cost |
| `sensemaking-engine.js` | L3 | Retrospective outcome analysis |
| `bias-detector.js` | L3 | Cognitive bias identification |
| `model-capability-registry.js` | L3 | 35+ models, 8D vectors, MoE |
| `conflict-resolver.js` | L4 | Multi-strategy conflict resolution |
| 17 L0-field files | L0 | Signal-mesh architecture |

#### Database Schema / 数据库模式

- SCHEMA_VERSION: 9 → 13
- New tables: signal_store, scope_edges, emotion_history, model_scores, cultural_friction_cache, conflict_log, sensemaking_episodes, bias_observations, + more
- Total tables: 52 → 64

#### Metrics / 指标

| Metric | V7.0 | V8.2 |
|--------|------|------|
| Source files | 173 | 208 |
| Layers | 6 (L1-L6) | 7 (L0-L6) |
| DB tables | 52 | 64 |
| Event topics | 122 | 166 |
| Hooks | 19 | 20 |
| REST endpoints | ~45 | 57+ |
| Tests | 1463 / 105 files | 2105 / 134 files |
| Console files | 98 | 99 |
| Built-in models | 0 | 35+ |
| MeshNode subclasses | 0 | 11 |
| Signal types | 0 | 5 × 19 |

#### Documentation / 文档

- Complete documentation rewrite for V8.2
- 4 new documents: Signal-Mesh, Model Registry, Cross-Research, Emotional Intelligence
- 11 bilingual document pairs (EN/ZH)
- Academic-grade biomimicry coverage (20 algorithms)
- 14-discipline cross-research program documentation

---

## [7.0.0] - 2026-03-12

### Architecture: Closed-Loop Actuation & Console SPA / 架构升级：闭环执行与控制台 SPA

**Core Theme**: Transform from thin-shell plugin to closed-loop swarm brain with DirectSpawnClient relay, real parent-child subagent lifecycle, React SPA monitoring console (6 views), negative selection anomaly detection, and human-in-the-loop checkpoint mechanism.

核心主题：从薄壳插件转变为闭环蜂群大脑——DirectSpawnClient 中继实现真实父子代理生命周期、React SPA 监控控制台（6 视图）、负选择异常检测与人机交互检查点机制。

#### New Source Files / 新增源文件

| Module | Layer | Lines | Description |
|--------|-------|-------|-------------|
| `swarm-relay-client.js` | L2 | 940 | DirectSpawnClient: WebSocket relay to Gateway for real subagent spawning with two-phase async delivery / WS 中继实现真实子代理生成 |
| `negative-selection.js` | L3 | 239 | Immune-inspired anomaly detection for agent output patterns / 免疫负选择异常检测 |
| `swarm-checkpoint-tool.js` | L5 | 135 | Human-in-the-loop STOP gate: subagents pause at critical decisions, parent resolves + respawns / 人机交互检查点 |
| `user-checkpoint-repo.js` | L1 | — | Repository: create/getPending/resolve/expireOld for checkpoint persistence / 检查点持久化 |
| `console/src/**` (98 files) | L6 | — | React SPA: 6 views, CommandPalette, EventTimeline, Inspector, i18n (en/zh) / 控制台前端 |

#### Key Architectural Changes / 关键架构变更

| Change / 变更 | Detail / 细节 |
|-------|---------|
| DirectSpawnClient | Replaces HTTP POST /hooks/agent → WebSocket `callGateway({method:'agent', lane:'subagent'})` for real parent-child lifecycle (`src/L2-communication/swarm-relay-client.js`) |
| Two-phase async | `swarm_run` returns `{status:'dispatched'}` immediately; result injected via `chat.inject` within 30s IPC window (`src/L5-application/tools/swarm-run-tool.js`) |
| Closed-loop actuation | Shapley credit ranking + upstream discovery injected into agent prompts (`src/swarm-core.js` V7.0 §8, §2+§5) |
| Warm start | Import existing DB reputation on startup for returning agents (`src/swarm-core.js`) |
| v70FullLanding | Feature flag framework for gradual V7 feature activation (`src/swarm-core.js`) |

#### Console SPA (6 Views) / 控制台 SPA（6 视图）

| View | Component | Description |
|------|-----------|-------------|
| Hive | `HiveOverlay.jsx` | Hex grid visualization of agent swarm state / 蜂巢六角网格 |
| Pipeline | `PipelineOverlay.jsx` | DAG task pipeline with phase tracking / DAG 任务流水线 |
| Cognition | `CognitionOverlay.jsx` | Agent cognitive state & memory inspector / 认知状态检视 |
| Ecology | `EcologyOverlay.jsx` | Species population dynamics / 种群生态动力学 |
| Network | `NetworkOverlay.jsx` | Inter-agent communication topology / 代理间通信拓扑 |
| Control | `ControlOverlay.jsx` | Manual control panel & settings / 手动控制面板 |

#### Database Schema / 数据库模式

- SCHEMA_VERSION: 8 → 9
- New table: `swarm_user_checkpoints` (checkpoint persistence for human-in-the-loop)
- Total tables: 52

#### Event Topics / 事件主题

- V6.2 baseline: 98 → V7.0: 122 (+24 topics)
- Key additions: `negative_selection.triggered`, `budget.degradation.applied`, `session.patched`, `speculation.real.spawned`, `dream.consolidation.completed`, `evidence.gate.rejected`, `persona.evolution.promoted`

#### Hooks / 钩子

- V6.2 baseline: 14 registrations → V7.0: 19 registrations (+5)
- New: V7.0 two-phase async delivery hooks, subagent lifecycle hooks

#### Test Coverage / 测试覆盖

| Metric / 指标 | V6.2 | V7.0 |
|--------|------|------|
| Source files / 源文件 | 111 | 173 |
| Test files / 测试文件 | 93 | 105 |
| Test cases / 测试用例 | — | 1463 |
| EventTopics / 事件主题 | 98 | 122 |
| Console modules / 控制台模块 | — | 106 |

#### Tools / 工具

- Total tool files: 10 (4 public: `swarm_run`, `swarm_query`, `swarm_dispatch`, `swarm_checkpoint`)
- New: `swarm_checkpoint` — STOP instruction mechanism for human-in-the-loop review

---

## [6.2.0] - 2026-03-11

### Enhancement: Audit Optimization — Complete P1/P2/P3 Implementation / 增强：审计优化 — 完整实施 P1/P2/P3

**Core Theme**: Implement all remaining optimization items from the 17-batch cross-LLM audit roadmap: conflict resolution with consensus voting, agent lifecycle FSM, episodic-to-semantic memory consolidation, gossip memory sharing and pheromone sync, anomaly detection, Holling resilience metrics, evidence-dual process integration, parasite detection, and zone supervisor election.

核心主题：实施17批交叉 LLM 审计路线图的全部剩余优化项：冲突解决与共识投票、Agent 生命周期状态机、情景到语义记忆巩固、Gossip 记忆共享与信息素同步、异常检测、Holling 韧性指标、证据-双过程集成、寄生检测和 Zone 主管选举。

#### New Source Files (3) / 新增源文件

| Module | Layer | Description |
|--------|-------|-------------|
| `conflict-resolver.js` | L4 | 3-level conflict resolution: P2P negotiation → weighted voting (multi-round consensus) → reputation arbitration / 三级冲突解决 |
| `agent-lifecycle.js` | L3 | 8-state FSM: INIT→IDLE→ACTIVE→BUSY→PAUSED→STANDBY→MAINTENANCE→RETIRED / 8态生命周期状态机 |
| `anomaly-detector.js` | L3 | Negative selection anomaly detection with σ-threshold deviation and baseline tracking / 阴性选择异常检测 |

#### Key Modifications (10) / 关键修改

| File | Change / 变更 |
|------|---------------|
| `episodic-memory.js` | +`extractPatterns()` for episodic→semantic consolidation (P1-5); +`setSemanticMemory()` / 情景→语义巩固 |
| `gossip-protocol.js` | +Memory sharing (P2-1): top-3 high-importance memories per heartbeat; +Pheromone snapshot (P2-2): top-10 sync with max-merge / 记忆共享+信息素快照 |
| `governance-metrics.js` | +Holling resilience (P2-4): recoveryTime, resistance, ecologicalResilience; +CircuitBreaker subscription / 韧性三维指标 |
| `evidence-gate.js` | +DualProcessRouter integration (P2-5): System 2→strict(0.6), System 1→relaxed(0.2); +`getClaimScoreForQuality()` / 双过程证据集成 |
| `reputation-ledger.js` | +`detectParasites()` (P2-6): parasiteScore = (1-collab)*competence*activity; +`getContributionProfile()` / 寄生检测 |
| `zone-manager.js` | +Lifecycle-aware election (P3-2): filter by IDLE/ACTIVE; +`demoteLeader()`; +auto-demotion on MAINTENANCE/RETIRED / 生命周期感知选举 |
| `event-catalog.js` | +14 V6.2 event topics → 99 total / 14个新事件主题 |
| `swarm-core.js` | +ConflictResolver/AgentLifecycle/AnomalyDetector instantiation + lifecycle hooks + anomaly wiring + featureFlags / 新模块接入 |
| `plugin-adapter.js` | +GossipProtocol pheromone injection; +EpisodicMemory→SemanticMemory bridge; +GovernanceMetrics circuitBreaker / 跨模块桥接 |
| `startup-diagnostics.js` | +`auditOptimization` diagnostic section (10 V6.2 feature checks) / 审计优化诊断 |

#### Optimization Items Completed / 完成的优化项

| Item | Category | Impact |
|------|----------|--------|
| P1-2 | Conflict Resolver | Governance 28%→45% |
| P1-3 | Agent Lifecycle FSM | Governance +15% |
| P1-5 | Episodic→Semantic Consolidation | Memory shaping 60%→70% |
| P2-1 | Memory Sharing Protocol | Neuroscience 75%→80% |
| P2-2 | Gossip Pheromone Snapshot | Communication 60%→70% |
| P2-3 | Anomaly Detection | Bionics 56%→65% |
| P2-4 | Holling Resilience Metrics | Ecology 81%→87% |
| P2-5 | Evidence + DualProcess | Psychology 71%→76% |
| P2-6 | Parasite Agent Detection | Ecology +5% |
| P3-1 | Consensus Voting | Governance +10% |
| P3-2 | Zone Supervisor Election | Governance +5% |

#### Event Topics (13 new, total 98) / 事件主题

```
CONFLICT_DETECTED, CONFLICT_RESOLVED, CONFLICT_ESCALATED,
CONSENSUS_VOTE_STARTED, CONSENSUS_VOTE_COMPLETED,
AGENT_LIFECYCLE_TRANSITION, MEMORY_PATTERN_EXTRACTED,
ANOMALY_DETECTED, ANOMALY_BASELINE_UPDATED,
GOSSIP_SYNC_MERGED, PARASITE_DETECTED,
ZONE_LEADER_ELECTED, ZONE_LEADER_DEMOTED
```

#### Test Coverage / 测试覆盖

| Metric / 指标 | V6.1 | V6.2 |
|--------|------|------|
| Source files / 源文件 | 108 | 111 (+3) |
| Test files / 测试文件 | 83 | 93 (+10) |
| EventTopics / 事件主题 | 85 | 98 (+13) |

---

## [6.1.0] - 2026-03-10

### Enhancement: Cross-Audit Fixes + Dead Code Activation / 增强：交叉审计修复 + 死代码激活

**Core Theme**: Activate dormant pipelines identified by cross-LLM audit; fix memory subsystem formulas; wire Shapley/SNA/DualProcess into live event flows; add pheromone propagation and MessageBus request-reply.

核心主题：激活交叉 LLM 审计发现的休眠管道；修复记忆子系统公式；将 Shapley/SNA/双过程路由接入实时事件流；新增信息素传播和消息总线请求-回复模式。

#### P0 Critical Fixes / 关键修复

- **P0-1 Vector Pipeline Activation / 向量检索管线激活**: Wire EmbeddingEngine → VectorIndex → HybridRetrieval in `plugin-adapter.js`; connect to EpisodicMemory + SemanticMemory via `setHybridRetrieval()` / 在 plugin-adapter.js 中实例化完整向量管道并注入记忆系统
- **P0-2 Ebbinghaus Decay Fix / 记忆衰减公式修复**: `episodic-memory.js` timeDecay `1/(1+ageDays)` → `Math.exp(-ageDays/30)` (Ebbinghaus λ=30) / 修正为指数衰减曲线
- **P0-3 LTM Promotion / 长期记忆晋升**: `working-memory.js` eviction callback — high-importance items (>0.7) auto-consolidate to EpisodicMemory / 工作记忆驱逐时高重要性项自动晋升到 LTM

#### Dead Code Activation / 死代码激活

- **ShapleyCredit**: Instantiated in `swarm-core.js`; wired `DAG_COMPLETED` → `compute()` → `ReputationLedger.recordShapleyCredit()` / Shapley 信用计算接入事件流
- **SNAAnalyzer**: Instantiated in `swarm-core.js`; wired `TASK_COMPLETED` → `recordCollaboration()` + `tick()` → `ReputationLedger.updateSNAScores()` / 社会网络分析接入事件流
- **DualProcessRouter**: Instantiated in `swarm-core.js`; integrated into `SwarmAdvisor._computeArbiterMode()` via `setDualProcessRouter()` / 双过程路由集成到仲裁决策

#### New Capabilities / 新增能力

- **Pheromone Propagation / 信息素传播**: `pheromone-engine.js` `propagate()` — BFS hop-by-hop with `spreadFactor^hop` intensity decay + scope hierarchy expansion / 信息素逐跳传播
- **MessageBus Request-Reply / 消息总线请求-回复**: `message-bus.js` `requestReply()` — correlationId-based one-shot reply pattern with timeout / 基于关联 ID 的请求-回复模式

#### Files Modified (9) / 修改文件

| File | Change |
|------|--------|
| `plugin-adapter.js` | +EmbeddingEngine/VectorIndex/HybridRetrieval instantiation, +WorkingMemory onEvict |
| `swarm-core.js` | +ShapleyCredit/SNAAnalyzer/DualProcessRouter instantiation + event wiring |
| `swarm-advisor.js` | +setDualProcessRouter() + DualProcess bias in _computeArbiterMode() |
| `episodic-memory.js` | timeDecay formula fix (Ebbinghaus exponential) |
| `working-memory.js` | +onEvict callback for LTM promotion |
| `pheromone-engine.js` | +propagate() method |
| `message-bus.js` | +requestReply() method |
| `index.js` | VERSION 6.0.0 → 6.1.0 |
| `openclaw.plugin.json` | version 6.0.0 → 6.1.0 |

---

## [6.0.0] - 2026-03-10

### Enhancement: Hybrid Architecture + Intelligent Perception / 增强：混合架构 + 智能感知

**Core Theme**: Escape single-process bottleneck via `fork()` child process isolation + worker thread parallelization; activate dormant modules; close data pipelines; wire adaptive closed-loop intelligence (signal auto-calibration, failure root-cause analysis, budget forecasting, quality audit); land swarm-base research (vector embeddings, HNSW, Shapley credit, SNA, dual-process routing).

核心主题：通过 `fork()` 子进程隔离 + Worker 线程并行化突破单进程瓶颈；激活休眠模块；闭合数据管道；接入自适应闭环智能（信号自校准、失败根因分析、预算预测、质量审计链）；落地 swarm-base 研究成果（向量嵌入、HNSW、Shapley 信用、SNA、双过程路由）。

#### Architecture Leap / 架构跃迁

- **Process Model / 进程模型**: Single-process → Hybrid (`index.js` thin shell + `swarm-core.js` fork() child + IPCBridge bidirectional RPC) / 单进程 → 混合进程（瘦壳 + 子进程 + IPC 桥）
- **Compute Parallelization / 计算并行化**: WorkerPool (4 threads) with specialized workers: ACO, compute, vector, Shapley / Worker 线程池 + 4 种专用 Worker
- **Communication / 通信层**: Pluggable transports (EventEmitter → BroadcastChannel → NATS reserved) / 可插拔传输层
- **Dashboard / 仪表板**: Monolithic HTML → ESM modular panels (`dashboard/index.html` + `core.js` + `panels/*.js`) / 单文件 → ESM 模块化面板

#### New Source Files (19) / 新增源文件

| Module | Layer | Description |
|--------|-------|-------------|
| `swarm-core.js` | — | Fork() child process entry; hosts all L1–L6 engines + IPC dispatcher / 子进程入口，承载全部引擎 |
| `ipc-bridge.js` | L1 | RPC-over-IPC bidirectional communication with timeout + pending guard / IPC 双端 RPC 通信 |
| `worker-pool.js` | L1 | Worker thread pool manager with SharedArrayBuffer + auto-restart / Worker 线程池 + 共享内存 |
| `workers/aco-worker.js` | L1 | ACO roulette selection in worker thread / ACO 轮盘选择 Worker |
| `workers/compute-worker.js` | L1 | Generic compute tasks (k-means, CPM, MI) / 通用计算 Worker |
| `workers/shapley-worker.js` | L1 | Monte Carlo Shapley credit assignment / 蒙特卡洛 Shapley Worker |
| `workers/vector-worker.js` | L1 | Vector operations (dot product, cosine, HNSW) / 向量运算 Worker |
| `transports/transport-interface.js` | L2 | Abstract transport base class / 传输层抽象接口 |
| `transports/event-emitter-transport.js` | L2 | Default EventEmitter transport (V5.x compatible) / 默认传输实现 |
| `transports/broadcast-channel-transport.js` | L2 | Cross-worker BroadcastChannel transport / 跨 Worker 传输 |
| `transports/nats-transport.js` | L2 | V7.0 reserved NATS stub / V7.0 预留 NATS 接口 |
| `embedding-engine.js` | L3 | Dual-mode text embeddings (local Xenova 384D / API 1536D) / 双模式文本嵌入 |
| `vector-index.js` | L3 | HNSW hierarchical navigable small-world index / HNSW 向量索引 |
| `hybrid-retrieval.js` | L3 | 6-dimensional retrieval fusion (semantic+temporal+importance+confidence+frequency+context) / 六维混合检索 |
| `sna-analyzer.js` | L3 | Social Network Analysis (betweenness, closeness, clustering coefficient) / 社交网络分析 |
| `failure-mode-analyzer.js` | L3 | 5-category root-cause classification (INPUT/TIMEOUT/LLM/NETWORK/RESOURCE) / 五类失败根因分类 |
| `signal-calibrator.js` | L4 | MI-based signal auto-calibration with 3-phase cold start / 互信息信号自校准 |
| `dual-process-router.js` | L4 | System 1/2 bounded rationality routing / 双过程路由决策 |
| `shapley-credit.js` | L4 | Monte Carlo Shapley value for fair multi-agent credit / 蒙特卡洛 Shapley 信用分配 |
| `budget-forecaster.js` | L4 | Linear regression token budget prediction / 线性回归预算预测 |

#### Dashboard V6.0 Panels / 仪表板面板

| File | Purpose / 用途 |
|------|----------------|
| `dashboard/index.html` | Modular workspace layout / 模块化主壳 |
| `dashboard/core.js` | SSE data bus + rendering utilities / SSE 数据总线 |
| `dashboard/styles.css` | Dark theme + CSS variables / 暗色主题 |
| `dashboard/panels/v6-overview.js` | V6.0 summary metrics / 概览指标面板 |
| `dashboard/panels/quality-timeline.js` | Quality audit trail / 质量审计时间线 |
| `dashboard/panels/sna-topology.js` | Social network graph / SNA 拓扑图 |
| `dashboard/panels/worker-pool.js` | Worker thread pool monitor / Worker 线程池监控 |

#### Key Modifications / 关键修改

| File | Change / 变更 |
|------|---------------|
| `index.js` | Major refactor: 1798→~400 lines; thin plugin shell + fork() child process lifecycle / 重构为瘦壳 + 子进程生命周期管理 |
| `database-schemas.js` | +6 tables (failure_mode_log, quality_audit, vector_index_meta, shapley_credits, sna_snapshots, ipc_call_stats); SCHEMA_VERSION 7→8 / 6 张新表 |
| `message-bus.js` | Pluggable transport abstraction (constructor accepts Transport) / 可插拔传输抽象 |
| `pheromone-engine.js` | Worker pool delegation for `acoSelect()` + `decayPass()` / 计算委托到 Worker |
| `reputation-ledger.js` | Exponential half-life decay (`e^(-t/halfLife)`, default 14 days) + 4D→6D dimensions (+centrality, +influence) / 半衰期衰减 + 6D 声誉 |
| `contract-net.js` | +6th award weight: affinityScore (0.06) from task_affinity / 第6权重：亲和度 |
| `execution-planner.js` | +5th MoE expert: `_affinityExpert()` / 第5专家：亲和度 |
| `quality-controller.js` | Quality audit trail writes to `quality_audit` table / 质量审计记录 |
| `governance-metrics.js` | Reads quality audit chain for policy compliance / 读取审计链 |
| `species-evolver.js` | Evolution clustering activation + Silhouette stability score / 聚类激活 + 轮廓系数 |
| `task-dag-engine.js` | DLQ retry orchestration with exponential backoff (maxRetries=3) / 死信重试编排 |
| `circuit-breaker.js` | State persistence: `restoreState()` / `persistState()` / 状态持久化 |
| `tool-resilience.js` | Failure mode integration: calls FailureModeAnalyzer on errors / 失败模式集成 |
| `critical-path.js` | Worker pool delegation for CPM analysis / CPM 委托 Worker |
| `role-discovery.js` | Worker pool delegation for k-means++ / k-means++ 委托 Worker |
| `plugin-adapter.js` | Bridge to SwarmCore child; `getToolManifests()` / 桥接子进程 |
| `dashboard-service.js` | +4 REST endpoints (sna-metrics, vector-search, signal-weights, alerts); modular dashboard serving / 4 新端点 + 模块化面板服务 |
| `trace-collector.js` | `analyzeLatency()` p50/p95/p99 + `detectBottlenecks()` / 延迟分析 + 瓶颈检测 |
| `metrics-collector.js` | Full V6.0 topic subscription + threshold alerting (error rate, latency, DLQ) / 全量订阅 + 阈值告警 |
| `event-catalog.js` | +19 V6.0 event topics → 85 total / 19 个新事件主题 |
| `episodic-memory.js` | Temporal decay weighting integration / 时间衰减加权 |
| `semantic-memory.js` | Hybrid retrieval scoring integration / 混合检索评分 |

#### Dormant Modules Activated / 激活的休眠模块

| Module | Previously / 之前 | Now / 现在 |
|--------|-------------------|------------|
| SkillGovernor | `enabled: false` by default | Default enabled with graceful degradation / 默认启用 + 优雅降级 |
| ContextEngine | Fallback-only via hook | Default enabled, integrated with SkillGovernor + GovernanceMetrics / 默认启用 |
| Evolution Clustering | `evolution.clustering: false` | Default enabled + Silhouette stability score / 默认启用 + 稳定性评估 |

#### Data Pipelines Closed / 闭合的数据管道

| Table / 表 | Before / 之前 | After / 之后 |
|------------|---------------|-------------|
| `dead_letter_tasks` | Write-only | +DLQ retry with exponential backoff / 重试编排 |
| `task_affinity` | Write-only | +ContractNet 6th weight + ExecutionPlanner 5th expert / 亲和度调度 |
| `breaker_state` | No persistence | +Restore on startup + persist on change / 启动恢复 + 变更持久化 |
| `trace_spans` | Batch write only | +`analyzeLatency()` + `detectBottlenecks()` / 延迟分析 + 瓶颈检测 |
| `repair_memory` | Coarse matching | +`error_category` dimension matching / 细粒度策略匹配 |

#### Algorithm Additions (6 new, total 25) / 新增算法

| # | Algorithm / 算法 | Layer | Purpose / 用途 |
|---|---|---|---|
| 20 | **HNSW** (Hierarchical Navigable Small-World) | L3 | Approximate nearest neighbor in vector space / 向量近邻搜索 |
| 21 | **Mutual Information** | L4 | Signal-success correlation for auto-calibration / 信号自校准 |
| 22 | **Monte Carlo Shapley** | L4 | Fair credit assignment in multi-agent coalitions / 联盟公平信用 |
| 23 | **Bounded Rationality** (System 1/2) | L4 | Fast/slow dual-process task routing / 快慢双过程路由 |
| 24 | **Regex Pattern Classification** | L3 | Failure root-cause categorization / 失败根因分类 |
| 25 | **Linear Regression Forecasting** | L4 | Token budget exhaustion prediction / 预算耗尽预测 |

#### New Feature Flags (20+) / 新增特性标志

`architecture.mode`, `architecture.workerPoolSize`, `embedding.enabled`, `embedding.mode`, `vectorIndex.enabled`, `signalCalibrator.enabled`, `shapley.enabled`, `sna.enabled`, `dualProcess.enabled`, `hybridRetrieval.enabled`, `failureModeAnalyzer.enabled`, `budgetForecaster.enabled`, `qualityAudit.enabled`, `reputationDecay.halfLifeDays`, `metricsAlerting.errorRateThreshold`, `metricsAlerting.latencyP95Threshold`, `metricsAlerting.dlqThreshold`, + more

#### Test Coverage / 测试覆盖

| Metric / 指标 | V5.7 | V6.0 |
|--------|------|------|
| Source files / 源文件 | ~75 | 108 (+33) |
| Test files / 测试文件 | 65 | 83 (+18) |
| Total tests / 测试数 | 1097 | 1257 (+160) |
| EventTopics / 事件主题 | 66 | 85 (+19) |
| DB tables / 数据库表 | 44 | 50 (+6) |
| Schema version | 7 | 8 |
| Algorithms / 算法 | 19 | 25 (+6) |
| Feature flags / 特性标志 | ~15 | ~35 (+20) |

---

## [5.7.0] - 2026-03-10

### Enhancement: Skill Symbiosis + Multi-Type Pheromones / 增强：共生调度 + 多类型信息素

**Core Theme**: Wire SkillSymbiosisTracker into scheduling pipeline; activate typed pheromone decay.

核心主题：共生技能追踪器接入调度管线；激活类型化信息素衰减。

#### Key Modifications / 关键修改

| File | Change |
|------|--------|
| `pheromone-engine.js` | food/danger types in BUILTIN_DEFAULTS; `_computeDecayedIntensity` routes through `computeTypedDecay`; `_getDecayModel()` |
| `pheromone-type-registry.js` | food/danger in BUILTIN_TYPES set |
| `pheromone-response-matrix.js` | food attraction on task.completed; danger avoidance on task.failed; `getDangerDensity()` |
| `pheromone-type-repo.js` | `getTypeConfig()` / `listTypeConfigs()` for pheromone_type_config table |
| `skill-symbiosis.js` | `mapDimensions8Dto4D()`, `getTeamComplementarity()`, MessageBus event publishing |
| `contract-net.js` | 5th award weight (symbiosisScore) in `_computeAwardScore()` |
| `execution-planner.js` | 4th MoE expert `_symbiosisExpert()`; dynamic weight normalization |
| `swarm-advisor.js` | 6th signal (symbiosisSignal); SIGNAL_WEIGHTS redistribution |
| `event-catalog.js` | +4 topics (SYMBIOSIS×2, PHEROMONE_TYPE_REGISTERED, PHEROMONE_FOOD_ATTRACTION) → 66 total |
| `plugin-adapter.js` | `pheromoneTypeRegistry.load()` on init; VERSION bump |
| `index.js` | skillSymbiosis → SwarmAdvisor/ContractNet/ExecutionPlanner injection; featureFlags |

#### Dead Code Paths Activated / 激活的死代码路径

| Method | File | Previously | Now |
|--------|------|-----------|-----|
| `computeTypedDecay()` | pheromone-engine.js | Defined but never called | Called by `_computeDecayedIntensity` |
| `pheromone_type_config.decay_model` | DB | Column exists but unused | Read by `_getDecayModel()` via TypeRegistry |
| `PheromoneTypeRegistry.load()` | plugin-adapter.js | Never called | Called during init |
| `SkillSymbiosisTracker` API | skill-symbiosis.js | Not integrated into scheduling | Integrated into ContractNet/ExecutionPlanner/SwarmAdvisor |

#### Test Coverage / 测试覆盖

| Metric | V5.6 | V5.7 |
|--------|------|------|
| Test files | 62 | 65 (+3) |
| EventTopics | 62 | 66 (+4) |

---

## [5.6.0] - 2026-03-10

### Enhancement: Structured Orchestration / 增强：结构化编排

**Core Theme**: Bridge DAG engine to actual execution flow, activate dead code paths.

核心主题：将 DAG 引擎桥接到实际执行流，激活死代码路径。

#### New Module / 新模块

| Module | Layer | Lines | Description |
|--------|-------|-------|-------------|
| `speculative-executor.js` | L4 | ~300 | Speculative execution engine — parallel candidate paths for critical-path tasks |

#### Key Modifications / 关键修改

| File | Change |
|------|--------|
| `swarm-run-tool.js` | DAG Bridge: shadow plan as DAG, CPM analysis, speculative execution on critical nodes |
| `swarm-plan-tool.js` | CPM critical path analysis + bottleneck split suggestions in plan output |
| `plugin-adapter.js` | SpeculativeExecutor initialization (requires dagEngine) + destroy lifecycle |
| `index.js` | GlobalModulator injection into SpeculativeExecutor + DAGEngine; Work-Stealing in subagent_ended |
| `task-dag-engine.js` | Modulator-aware cooldown (`_getEffectiveCooldown`), `checkAndPublishPartial()`, WORK_STEAL_COMPLETED event |
| `event-catalog.js` | +6 topics (SPECULATIVE×3, WORK_STEAL, PIPELINE_PARTIAL, DAG_BRIDGE) → 62 total |
| `observability-core.js` | +5 subscriptions for structured orchestration events |
| `dashboard-service.js` | +2 REST endpoints: `/api/v1/dag-status`, `/api/v1/speculation` |
| `startup-diagnostics.js` | `structuredOrchestration` section in diagnostic report |
| `state-broadcaster.js` | Extended topic subscriptions (V5.5 + V5.6 additions) |
| `metrics-collector.js` | Extended topic subscriptions (V5.5 + V5.6 additions) |

#### Dead Code Paths Activated / 激活的死代码路径

| Method | File | Previously | Now |
|--------|------|-----------|-----|
| `tryStealTask()` | task-dag-engine.js | Never called | Called on subagent_ended (success path) |
| `_completionSet` | task-dag-engine.js | Never populated | Populated by SpeculativeExecutor |
| `suggestBottleneckSplits()` | critical-path.js | Never called | Called by swarm_run + swarm_plan |
| `publishPartialResult()` | task-dag-engine.js | Never called | Activated via checkAndPublishPartial() |
| `propagateUpstreamFailure()` | task-dag-engine.js | Never called | Triggered by failed state transitions |

#### Test Coverage / 测试覆盖

| Metric | V5.5 | V5.6 |
|--------|------|------|
| Test files | 59 | 62 (+3) |
| Total tests | 1021 | 1053 (+32) |
| EventTopics | 56 | 62 (+6) |

---

## [5.5.0] - 2026-03-10

### Enhancement: Host-Internal/External Minimum Closed Loop / 增强：宿主内外最小闭环

Claw-Swarm V5.5 implements "host-internal/external minimum closed loop" — upgrading from "kernel runnable" to "boundary-clear and reflowable". Adds state-convergence layer (SWIM failure detection + anti-entropy), runtime global-modulator (EXPLORE/EXPLOIT/RELIABLE/URGENT work points), three feedback loops (strategy/repair/environment), governance triple metrics (audit/policy/ROI), data pipeline activation (4 dormant tables now live), and startup diagnostics. 5 new source modules, 10 new event topics (total 56), 10 new test files (119 tests). 1021 tests across 59 test files.

Claw-Swarm V5.5 实现"宿主内外最小闭环"——从"内核可运行"升级为"边界清晰且可回流"。新增状态收敛层（SWIM 故障探测 + 反熵同步）、运行时全局调节器（EXPLORE/EXPLOIT/RELIABLE/URGENT 四工作点）、三条回流链（策略/修复/环境）、治理三联指标（audit/policy/ROI）、数据管道激活（4 张休眠表激活）和启动诊断。5 个新源模块、10 个新事件主题（共 56 个）、10 个新测试文件（119 个测试）。59 测试文件共 1021 个测试。

### New Source Files (5) / 新增源文件

#### L2 Communication / L2 通信层
- **StateConvergence** (`state-convergence.js`): SWIM-style failure detection (alive → suspect → confirmed dead) with anti-entropy synchronization. Periodic drift detection using DB as source of truth, convergence time tracking, and automatic state repair
  SWIM 式故障探测（存活→疑似→确认死亡）+ 反熵同步，以 DB 为真相源的状态漂移检测

#### L4 Orchestration / L4 编排层
- **GlobalModulator** (`global-modulator.js`): Runtime work-point controller with 4 modes (EXPLORE/EXPLOIT/RELIABLE/URGENT). Hysteresis-based mode switching with minimum dwell time (3 turns), modulates SwarmAdvisor thresholds, BudgetTracker cost tolerance, and EvidenceGate strictness
  运行时工作点控制器，4 种模式 + 滞后切换 + 最小停留 3 turns，调节阈值/成本容忍度/证据严格度
- **GovernanceMetrics** (`governance-metrics.js`): Audit + Policy + ROI triple metrics for swarm governance. Decision traceability scoring, policy compliance tracking, collaboration ROI computation with periodic report publishing
  审计 + 策略 + ROI 三联治理指标，决策可追溯性评分、策略合规追踪、协作 ROI 计算

#### L6 Monitoring / L6 监控层
- **TraceCollector** (`trace-collector.js`): Lightweight distributed trace span collector. Subscribes to MessageBus events, manages pending span pairing (start/end), batch writes to `trace_spans` table (every 5 spans)
  轻量分布式追踪 span 收集器，事件订阅、pending span 配对、批量写入
- **StartupDiagnostics** (`startup-diagnostics.js`): Modularized startup health check. DB connectivity, empty table detection, data pipeline health (strategy-feedback/repair-sedimentation/environment-signal/instant-observation), module readiness, overall health score
  模块化启动诊断：DB 连通性、空表检测、数据管道健康、模块就绪度、整体健康评分

### Key Modifications / 重要修改

- **swarm-advisor.js**: Added GlobalModulator integration (`setGlobalModulator()`), degradation evaluation (`_evaluateDegradation()`), urgency indicators in stimulus computation, evidence/budget signal sources (S10/S11). ARBITER_MODE_DEGRADED event support
  新增全局调节器集成、降级评估、紧急度指示器、证据/预算信号源
- **tool-resilience.js**: Activated repair memory data pipeline — `findRepairStrategy()` now called on failures, `recordRepairOutcome()` records successful repairs. REPAIR_STRATEGY_FOUND/OUTCOME events
  激活修复记忆数据管道——失败时查找修复策略，成功时记录修复结果
- **budget-tracker.js**: Baseline self-adjustment support via config, collaboration tax feedback loop integration with GovernanceMetrics
  基准自调整配置支持，协作税反馈闭环与治理指标集成
- **evidence-gate.js**: Custom tier weight configuration, evidence quality tracking integration with GovernanceMetrics
  自定义层级权重配置，证据质量追踪与治理指标集成
- **task-dag-engine.js**: Dead letter tasks now persist to `dead_letter_tasks` SQLite table (previously in-memory only)
  死信任务持久化到 SQLite（此前仅内存）
- **index.js**: Task affinity UPSERT on `subagent_ended`, StateConvergence/GlobalModulator/GovernanceMetrics initialization, startup diagnostics integration. VERSION 5.5.0
  task_affinity 写入、状态收敛/全局调节器/治理指标初始化、启动诊断集成
- **event-catalog.js**: 10 new V5.5 event topics. Total 56 topics
  10 个新事件主题，共 56 个
- **observability-core.js**: Subscribed to all 10 V5.5 events across 4 observation categories
  订阅全部 10 个 V5.5 事件
- **dashboard-service.js**: 4 new REST endpoints (`/api/v1/governance`, `/api/v1/convergence`, `/api/v1/modulator`, `/api/v1/diagnostics`). Enhanced context-debug with SwarmAdvisor/GlobalModulator info
  4 个新 REST 端点 + 增强的上下文调试
- **dashboard-v2.html**: GlobalModulator mode badge, Governance triple metric bars, Circuit Breaker status dots, Trace Timeline gantt chart, Task Affinity color-coded grid
  全局调节器模式标签、治理三联指标柱、断路器状态点、追踪时间线甘特图、任务亲和颜色网格

### Data Pipeline Activation / 数据管道激活

4 previously dormant DB tables now have active write paths:

4 张此前休眠的 DB 表已激活写入管道：

| Table / 表 | Pipeline / 管道 | Description / 说明 |
|---|---|---|
| `repair_memory` | Strategy feedback / 策略回流 | Tool failure → find strategy → record outcome |
| `trace_spans` | Instant observation / 即时观测 | MessageBus events → TraceCollector → batch INSERT |
| `dead_letter_tasks` | Repair sedimentation / 修复沉淀 | Failed tasks → DLQ persist → future retry |
| `task_affinity` | Environment signal / 环境信号 | Subagent completion → affinity UPSERT |

### Three Feedback Loops / 三条回流链

| Loop / 回流链 | Flow / 流程 |
|---|---|
| **Strategy** / 策略 | repair_memory → findRepairStrategy() → route influence → recordOutcome() |
| **Repair** / 修复 | ToolResilience failure → repair → FailureVaccination vaccine → future immunity |
| **Environment** / 环境 | Pheromone/breaker/board signals → routing → execution → signal update |

### Event Topics (10 new, total 56) / 事件主题

```
REPAIR_STRATEGY_FOUND, REPAIR_STRATEGY_OUTCOME,
TASK_AFFINITY_UPDATED, ARBITER_MODE_DEGRADED, BASELINE_ADJUSTED,
CONVERGENCE_DRIFT, AGENT_SUSPECT, AGENT_CONFIRMED_DEAD,
MODE_SWITCHED, GOVERNANCE_REPORT
```

### Test Coverage / 测试覆盖
- 1021 tests across 59 files (up from 902 in V5.4)
  1021 个测试（V5.4 为 902 个）
- 10 new test files (119 tests): state-convergence (13), global-modulator (13), governance-metrics (11), trace-collector (10), startup-diagnostics (15), version-consistency (6), repair-memory-v55 (7), swarm-advisor-v55 (14), budget-tracker-v55 (14), evidence-gate-v55 (16)
  10 个新测试文件（119 个测试）

---

## [5.4.0] - 2026-03-10

### Enhancement: Main Path Convergence / 增强：主路径收敛

Claw-Swarm V5.4 implements "main path convergence" — making existing capabilities form a real collaboration main path. Adds 4-state adaptive arbitration, evidence discipline, protocol semantics, collaboration tax tracking, and unified observability. 4 new source modules, 5 new event topics (total 46), 6 new test files (154 tests). 902 tests across 49 test files.

Claw-Swarm V5.4 实现"主路径收敛"——让已有能力形成真正的协作主路径。新增四态自适应仲裁、证据纪律层、协议语义、协作税追踪和统一观测核心。4 个新源模块、5 个新事件主题（共 46 个）、6 个新测试文件（154 个测试）。49 测试文件共 902 个测试。

### Adaptive Arbiter (4-State Routing) / 四态自适应仲裁

Upgraded SwarmAdvisor from binary (force/don't force) to 4-state arbitration:

将 SwarmAdvisor 从二元（强制/不强制）升级为四态仲裁：

| Mode / 模式 | Condition / 条件 | Tool Routing / 工具路由 | Advisory / 建议 |
|---|---|---|---|
| **DIRECT** | stimulus ≤ threshold×0.7 | No constraints / 无约束 | Brief standby note / 简短待命 |
| **BIAS_SWARM** | stimulus ≤ threshold | T2 tools blocked / 仅阻断 T2 | Mild suggestion with opt-out / 温和建议可跳过 |
| **PREPLAN** | stimulus > threshold | T2 + EXTERNAL blocked / 阻断 T2+外部 | Strong recommendation / 强烈推荐 |
| **BRAKE** | stimulus > threshold + ≥2 env alerts | T2 + EXTERNAL blocked / 阻断 T2+外部 | Environment alerts + urgent guidance / 环境警报 |

### New Source Files (4) / 新增源文件

#### L2 Communication / L2 通信层
- **ProtocolSemantics** (`protocol-semantics.js`): 9 semantic message types (REQUEST/COMMIT/ACK/DELEGATE/ESCALATE/REJECT/REVISE/REPAIR/REPORT) with conversation tracking, reply chains, and protocol validation
  9 种语义消息类型，会话追踪、回复链和协议验证

#### L3 Agent / L3 智能体层
- **EvidenceGate** (`evidence-gate.js`): 3-tier evidence discipline (PRIMARY/CORROBORATION/INFERENCE) with weighted scoring, multi-source corroboration bonus, and claim lifecycle management
  三层证据纪律，加权评分、多源印证奖励、声明生命周期管理

#### L4 Orchestration / L4 编排层
- **BudgetTracker** (`budget-tracker.js`): 5-dimension budget tracking (latency/token/coordination/observability/repair) with collaboration tax computation `tax = (actual - baseline) / baseline`, per-mode averaging and ROI tracking
  五维预算追踪 + 协作税计算，按仲裁模式统计和 ROI 追踪

#### L6 Monitoring / L6 监控层
- **ObservabilityCore** (`observability-core.js`): 4-category observation collection (decision/execution/repair/strategy) with ring buffer (500 events), MessageBus auto-subscription, timeline queries, and structured summaries
  四类观测数据收集，环形缓冲区、事件总线自动订阅、时间线查询

### Key Modifications / 重要修改

- **swarm-advisor.js**: Upgraded to 4-state adaptive arbiter (DIRECT/BIAS_SWARM/PREPLAN/BRAKE). New `_computeArbiterMode()`, `_buildBrakeAlert()`. Mode-differentiated `checkToolRouting()` and `buildAdvisoryContext()`. Added `ARBITER_MODES` export and `arbiterModes` stats tracking
  升级为四态自适应仲裁器，新增模式计算、环境警报构建、按模式区分的工具路由和赋能上下文
- **event-catalog.js**: 5 new event topics (EVIDENCE_CLAIM_REGISTERED, EVIDENCE_CLAIM_EVALUATED, PROTOCOL_MESSAGE_SENT, BUDGET_TURN_COMPLETED, plus V5.3 SWARM_ADVISORY_INJECTED). Total 46 topics
  5 个新事件主题，共 46 个

### Test Coverage / 测试覆盖
- 902 tests across 49 files (up from 748 in V5.3)
  902 个测试（V5.3 为 748 个）
- 6 new test files (154 tests): swarm-advisor V5.4 additions (+27), evidence-gate (45), protocol-semantics (34), budget-tracker (23), observability-core (25)
  6 个新测试文件（154 个测试）

---

## [5.3.0] - 2026-03-10

### Enhancement: Swarm Decision Empowerment / 增强：蜂群决策赋能

Claw-Swarm V5.3 solves the core adoption problem: LLMs skip swarm tools 70-90% of the time because they lack context about when collaboration helps. V5.3 adds SwarmAdvisor — an "empowerment-first" architecture that provides structured intelligence (capability profiles, task analysis, action suggestions) so LLMs make informed decisions about swarm collaboration. Also adds `swarm_run` tool and 9-signal composite aggregation. 1 new source module, 1 new tool, 2 new hooks, 1 new event topic (total 41). 748 tests across 43 test files.

Claw-Swarm V5.3 解决核心采用问题：LLM 70-90% 时间跳过蜂群工具，因为缺少协作价值的上下文信息。V5.3 新增 SwarmAdvisor——"赋能优先"架构，提供结构化情报（能力画像、任务分析、行动建议），让 LLM 做出知情的协作决策。同时新增 `swarm_run` 工具和 9 信号源聚合。1 个新源模块、1 个新工具、2 个新钩子、1 个新事件主题（共 41 个）。43 测试文件共 748 个测试。

### New Source Files (1) / 新增源文件

#### L4 Orchestration / L4 编排层
- **SwarmAdvisor** (`swarm-advisor.js`): Empowerment-first swarm activation with 9-signal composite aggregation (S1-S9: text features, breaker signals, pheromone pressure, threshold proximity, failure patterns, board posts, symbiosis pairs, reputation variance, DAG complexity), PI-controller-adaptive suggestion strength, turn-isolated state management, structured advisory context injection
  赋能优先蜂群激活，9 信号源聚合（文本特征、断路器信号、信息素压力、阈值接近度、失败模式、公告板、共生配对、声誉方差、DAG 复杂度），PI 控制器自适应建议强度，Turn 隔离状态管理，结构化赋能上下文注入

### New Tool / 新增工具
- **swarm_run** (`swarm-run-tool.js`): One-click task execution — combines swarm_plan + swarm_spawn into a single tool call with automatic agent selection and role assignment. Total tools: 8
  一键执行工具——合并 swarm_plan + swarm_spawn，自动选择 agent 和分配角色。工具总数：8

### Key Modifications / 重要修改

- **index.js**: 2 new hooks (`before_prompt_build` priority 1 + 3 for Layer 0/Layer 1 advisory injection), `after_tool_call` swarm tool tracking. Total hooks: 16
  2 个新钩子 + 工具调用追踪，钩子总数：16
- **event-catalog.js**: 1 new event topic (SWARM_ADVISORY_INJECTED). Total 41 topics
  1 个新事件主题，共 41 个
- **swarm-context-engine.js**: Added `advisory` parameter to `buildSwarmContextFallback()` for merging empowerment text with existing swarm state
  增加 advisory 参数，合并赋能文本和蜂群状态
- **openclaw.plugin.json**: Added `swarmAdvisor` config schema
  新增 swarmAdvisor 配置 schema

### 9-Signal Composite Aggregation / 9 信号源聚合

| Signal / 信号 | Source / 来源 | Weight / 权重 |
|---|---|---|
| S1 textSignal | Text feature analysis | 0.30 |
| S2 breakerSignal | CircuitBreaker state | 0.10 |
| S3 pressureSignal | PheromoneResponseMatrix | 0.10 |
| S4 proximitySignal | ResponseThreshold | 0.05 |
| S5 failureSignal | FailureVaccination | 0.10 |
| S6 boardSignal | StigmergicBoard | 0.10 |
| S7 symbiosisSignal | SkillSymbiosisTracker | 0.05 |
| S8 reputationSignal | ReputationLedger | 0.05 |
| S9 dagSignal | TaskDAGEngine | 0.15 |

Weight redistribution: When source engines are absent, weights are proportionally redistributed to connected sources.

权重再分配：当信号源引擎缺失时，权重按比例重分配到已连接的信号源。

### Test Coverage / 测试覆盖
- 748 tests across 43 files (up from 659 in V5.2)
  748 个测试（V5.2 为 659 个）
- New test files: swarm-advisor (70 tests), swarm-run-tool (19 tests), context-service additions
  新测试文件：swarm-advisor、swarm-run-tool

---



### Enhancement: Bio-Inspired Ecology, Stigmergic Coordination & Observability / 增强：仿生生态、间接协调与可观测性

Claw-Swarm V5.2 adds 5 new source modules, 6 new database tables (total 44), 10 new event topics (total 37), and 8 new test files (86 tests). 659 tests across 43 test files. SCHEMA_VERSION upgraded to 7.

Claw-Swarm V5.2 新增 5 个源模块、6 张新数据库表（共 44 张）、10 个新事件主题（共 37 个）、8 个新测试文件（86 个测试）。43 测试文件共 659 个测试。SCHEMA_VERSION 升至 7。

### New Source Files (5) / 新增源文件

#### L2 Communication / L2 通信层
- **PheromoneResponseMatrix** (`pheromone-response-matrix.js`): Pheromone pressure gradient with auto-escalation scanning. Formula: `intensity = base * (1 + k * log(1 + age_minutes))`
  信息素压力梯度矩阵，自动升级扫描
- **StigmergicBoard** (`stigmergic-board.js`): Persistent bulletin board for indirect coordination. Posts with TTL, categories, priorities, and scope-based querying
  持久公告板，支持 TTL、分类、优先级、范围查询

#### L3 Agent / L3 智能体层
- **ResponseThreshold** (`response-threshold.js`): FRTM (Fixed Response Threshold Model) with per-agent/task-type thresholds and PI controller: `threshold_new = threshold_old - Kp * error - Ki * integral(error)`
  固定响应阈值模型 + PI 控制器自适应调节
- **FailureVaccination** (`failure-vaccination.js`): Pattern-based failure immunization with effectiveness feedback loop. Register → find → apply → track outcomes
  基于模式的失败免疫，效果反馈循环
- **SkillSymbiosisTracker** (`skill-symbiosis.js`): Cosine-similarity-based agent complementarity tracking for optimal agent pairing
  余弦相似度互补性追踪，最优 Agent 配对

### Key Modifications / 重要修改

- **event-catalog.js**: 10 new V5.2 event topics (PHEROMONE_ESCALATED, PHEROMONE_RESPONSE_TRIGGERED, SYSTEM_STARTUP, CIRCUIT_BREAKER_TRANSITION, STIGMERGIC_POST_CREATED/EXPIRED, FAILURE_VACCINE_CREATED/APPLIED, THRESHOLD_ADJUSTED/TRIGGERED). Total 37 topics
  10 个新事件主题，共 37 个
- **database-schemas.js**: 6 new tables (agent_thresholds, pheromone_type_config, stigmergic_posts, failure_vaccines, trace_spans, skill_symbiosis). SCHEMA_VERSION 6 → 7. Total 44 tables
  6 张新表，SCHEMA_VERSION 升至 7，共 44 张
- **pheromone-engine.js**: Added `autoEscalate()` and `computeTypedDecay()` methods for multi-type pheromone support (trail=linear, alarm=step, recruit=exponential)
  新增自动升级和类型化衰减方法
- **species-evolver.js**: Activated Lotka-Volterra population dynamics (`performLVDynamics()`) and ABC three-stage evolution (`performABCEvolution()`)
  激活 Lotka-Volterra 种群动力学和 ABC 三阶段进化
- **tool-resilience.js**: Added adaptive repair memory (`findRepairStrategy()`, `recordRepairOutcome()`) backed by `repair_memory` DB table
  新增自适应修复记忆
- **health-checker.js**: Added idle detection with 5-minute threshold, automatic recruit pheromone emission for idle agents
  新增空闲检测，5 分钟阈值，自动发射招募信息素
- **dashboard-service.js**: 4 new REST endpoints (`/api/v1/context-debug`, `/api/v1/breaker-status`, `/api/v1/trace-spans`, `/api/v1/startup-summary`)
  4 个新 REST 端点
- **state-broadcaster.js**: Extended with V5.2 topic subscriptions (circuit_breaker.*, stigmergic.*, failure.*, threshold.*)
  扩展 V5.2 主题订阅
- **index.js**: V5.2 module initialization (5 new modules with try/catch guards), SYSTEM_STARTUP event emission with full feature flags summary
  V5.2 模块初始化 + SYSTEM_STARTUP 启动诊断事件

### Feature Flags (new in V5.2) / 新增特性标志

| Flag | Default | Description / 说明 |
|------|---------|---|
| `pheromoneEscalation` | ✅ enabled | Pressure gradient auto-escalation / 信息素压力梯度自动升级 |
| `responseThreshold` | ✅ enabled | FRTM per-agent thresholds / 固定响应阈值 |
| `multiTypePheromone` | ✅ enabled | Typed decay (trail/alarm/recruit) / 多类型信息素衰减 |
| `evolution.lotkaVolterra` | ✅ enabled | Lotka-Volterra population dynamics / 种群竞争动力学 |
| `evolution.abc` | ✅ enabled | ABC three-stage evolution / ABC 三阶段进化 |

### Database / 数据库
- 6 new tables: `agent_thresholds`, `pheromone_type_config`, `stigmergic_posts`, `failure_vaccines`, `trace_spans`, `skill_symbiosis`
  6 张新表
- Total: 44 tables (up from 38 in V5.1)
  共 44 张表（V5.1 为 38 张）
- SCHEMA_VERSION: 7 (up from 6)

### Test Coverage / 测试覆盖
- 659 tests across 43 files (up from 573 in V5.1)
  659 个测试（V5.1 为 573 个）
- 8 new test files (86 tests): pheromone-response-matrix, stigmergic-board, response-threshold, failure-vaccination, skill-symbiosis, species-evolver-v52, tool-resilience-v52, health-checker-v52
  8 个新测试文件

---

## [5.1.0] - 2026-03-09

### Enhancement: Resilience, Hierarchy & Monitoring / 增强：韧性、层级蜂群与监控

Claw-Swarm V5.1 adds 11 new source files, 4 new database tables, 8 new OpenClaw hooks (total 14), and comprehensive production hardening. 573 tests across 30+ test files.

Claw-Swarm V5.1 新增 11 个源文件、4 张数据库表、8 个新 OpenClaw 钩子（共 14 个），全面生产加固。30+ 测试文件共 573 个测试。

### New Source Files (11) / 新增源文件

#### L1 Infrastructure / L1 基础设施层
- **MonotonicClock** (`monotonic-clock.js`): `process.hrtime.bigint()` monotonic timing utility for accurate duration measurement
  基于 `process.hrtime.bigint()` 的单调时钟，用于精确耗时测量

#### L3 Agent / L3 智能体层
- **SwarmContextEngine** (`swarm-context-engine.js`): Rich context builder with legacy delegation, TTL-based caching, and automatic context assembly (Working Memory + Recent Events + Knowledge + Pheromone Signals + Peer Agents)
  丰富上下文引擎，支持遗留委托、TTL 缓存、自动上下文组装

#### L4 Orchestration / L4 编排层
- **HierarchicalCoordinator** (`hierarchical-coordinator.js`): Hierarchical swarm with configurable depth limit and concurrency control. Enables agents to spawn sub-agents within governance bounds
  层级蜂群协调器，可配置深度和并发限制，允许 Agent 在治理边界内派生子 Agent
- **TaskDAGEngine** (`task-dag-engine.js`): Advanced DAG orchestration with auction-based task allocation, work-stealing, and dead letter queue (DLQ)
  高级 DAG 编排引擎，支持拍卖式任务分配、工作窃取和死信队列
- **SpeciesEvolver** (`species-evolver.js`): Species proposal, trial, and culling with GEP tournament. Enables organic evolution of agent role types
  物种进化器，支持提议→试用→淘汰 + GEP 锦标赛

#### L5 Application / L5 应用层
- **ToolResilience** (`tool-resilience.js`): AJV pre-validation + per-tool circuit breaker + retry prompt injection for automatic tool call recovery
  AJV 预校验 + 工具级断路器 + 重试提示注入
- **SkillGovernor** (`skill-governor.js`): Skill inventory, usage tracking, and recommendation engine
  技能治理器：清单管理 + 使用追踪 + 推荐引擎
- **TokenBudgetTracker** (`token-budget-tracker.js`): 800-token budget coordinator for prompt injection context management
  800 token 预算协调器，用于提示注入上下文管理

#### L6 Monitoring / L6 监控层
- **HealthChecker** (`health-checker.js`): Multi-dimensional health check with event-driven detection and adaptive polling
  多维健康检查，事件驱动 + 自适应轮询
- **dashboard-v2.html**: Enhanced dashboard with hex hive visualization, DAG task graph, pheromone particle animation, and radar capability charts
  增强版仪表盘：六边形蜂巢视图 + DAG 任务图 + 信息素粒子动画 + 雷达能力图

#### Root / 根目录
- **EventCatalog** (`event-catalog.js`): 27 EventTopics with unified event schema, serving as the single source of truth for all swarm events
  27 个事件主题 + 统一事件 schema，蜂群事件的唯一真相源

### Key Modifications / 重要修改

- **index.js**: 14 OpenClaw hooks (V5.0: 6 → V5.1: +8 new hooks including `gateway_start`, `before_model_resolve`, `before_tool_call`, `before_prompt_build`, `llm_output`, `subagent_spawning`, `subagent_spawned`, `subagent_ended`). Feature flag dependency validation added
  14 个 OpenClaw 钩子（V5.0 的 6 个 + 8 个新钩子），新增特性标志依赖校验
- **plugin-adapter.js**: MessageBus event publishing integration, SkillGovernor and TokenBudgetTracker initialization
  消息总线事件发布集成，技能治理器和预算追踪器初始化
- **database-schemas.js**: 4 new tables (`breaker_state`, `repair_memory`, `dead_letter_tasks`, `task_affinity`), SCHEMA_VERSION upgraded to 6. Total 38 tables
  4 张新表，SCHEMA_VERSION 升至 6，共 38 张表
- **pheromone-engine.js**: `acoSelect()` now supports beta parameter for full ACO formula `[τ^α · η^β]`
  `acoSelect()` 支持 β 参数，实现完整 ACO 公式
- **capability-engine.js**: Added `recordObservation()`, fixed `emit` → `publish` for MessageBus compatibility
- **persona-evolution.js**: Fixed `emit` → `publish`, added `_abTests` memory cleanup
- **reputation-ledger.js**: Fixed `emit` → `publish`
- **dashboard-service.js**: Added `/v2` route + 4 REST API endpoints (`traces`, `topology`, `affinity`, `dead-letters`)
- **state-broadcaster.js**: Extended topic subscriptions for V5.1 event types
- **metrics-collector.js**: Extended topic subscriptions + new V5.1 metrics

### Feature Flags / 特性标志

V5.1 introduces a feature flag system for gradual rollout:

V5.1 引入特性标志系统，支持渐进式启用：

| Flag | Default | Description / 说明 |
|------|---------|---|
| `toolResilience` | ✅ enabled | AJV validation + circuit breaker / AJV 校验 + 断路器 |
| `healthChecker` | ✅ enabled | Multi-dimensional health / 多维健康检查 |
| `hierarchical` | ✅ enabled | Hierarchical swarm / 层级蜂群 |
| `dagEngine` | ✅ enabled | DAG orchestration / DAG 编排 |
| `workStealing` | ✅ enabled | Work-stealing scheduler / 工作窃取调度 |
| `taskAffinity` | ✅ enabled | Task affinity tracking / 任务亲和追踪 |
| `evolution.scoring` | ✅ enabled | Evolution scoring / 进化评分 |
| `contextEngine` | ❌ disabled | V5.1 context engine / 上下文引擎 |
| `skillGovernor` | ❌ disabled | Skill governance / 技能治理 |
| `speculativeExecution` | ❌ disabled | Speculative execution / 推测执行 |

### Agent Personas / 智能体人格

- **designer-bee** persona added as the 5th built-in bee persona, optimized for visualization, UI/UX design, and aesthetic review
  新增 designer-bee（设计蜂）作为第 5 个内置蜜蜂人格，专注可视化、UI/UX 设计和审美评审

### Database / 数据库
- 4 new tables: `breaker_state`, `repair_memory`, `dead_letter_tasks`, `task_affinity`
  4 张新表
- Total: 38 tables (up from 34 in V5.0)
  共 38 张表（V5.0 为 34 张）
- SCHEMA_VERSION: 6 (up from 5)

### Test Coverage / 测试覆盖
- 573 tests across 30+ files (up from 471 in V5.0)
  573 个测试（V5.0 为 471 个）

---

## [5.0.0] - 2026-03-08

### Major: Complete Ground-Up Rewrite / 重大变更：完全重写

Claw-Swarm V5.0 is a complete ground-up rewrite with a new 6-layer architecture, replacing the old 4-layer structure. 471 tests across 30 test files.

Claw-Swarm V5.0 是一次从零开始的完全重写，采用全新6层架构替代旧的4层结构。30个测试文件共471个测试。

### Architecture / 架构
- Complete rewrite from 4-layer (layer1-core → layer4-adapter) to 6-layer architecture (L1-infrastructure → L2-communication → L3-agent → L4-orchestration → L5-application → L6-monitoring)
  从4层架构（layer1-core → layer4-adapter）完全重写为6层架构（L1-基础设施 → L2-通信 → L3-代理 → L4-编排 → L5-应用 → L6-监控）
- 55+ V5.0 source files, 34 database tables (up from 25)
  55+ 源文件，34张数据库表（原25张）
- Dependency injection throughout all layers
  全层依赖注入
- Repository pattern for all database access (8 repositories)
  仓库模式统一数据库访问（8个仓库）

### New in V5.0 / V5.0 新增

#### L1 Infrastructure / L1 基础设施层
- **DatabaseManager** with SQLite WAL mode via `node:sqlite` DatabaseSync
  基于 `node:sqlite` DatabaseSync 的 SQLite WAL 模式数据库管理器
- **MigrationRunner** with versioned schema migrations
  版本化模式迁移运行器
- **ConfigManager** with Zod validation + runtime hot-reload
  Zod 验证 + 运行时热重载的配置管理器
- 8 typed repositories (Agent, Task, Pheromone, Knowledge, Episodic, Zone, Plan, PheromoneType)
  8个类型化仓库（Agent、Task、Pheromone、Knowledge、Episodic、Zone、Plan、PheromoneType）
- Comprehensive schema definitions (database, config, message)
  全面的模式定义（数据库、配置、消息）

#### L2 Communication / L2 通信层
- **MessageBus**: pub/sub with topic wildcards (`topic.*`), Dead Letter Queue, message history
  发布/订阅，支持主题通配符（`topic.*`）、死信队列、消息历史
- **PheromoneEngine**: MMAS (Max-Min Ant System) bounds, exponential decay, batch operations
  MMAS（最大-最小蚁群系统）边界、指数衰减、批量操作
- **GossipProtocol**: epidemic broadcast with configurable fanout + heartbeat
  流行病广播，可配置扇出 + 心跳
- **PheromoneTypeRegistry**: extensible custom pheromone type support
  可扩展的自定义信息素类型支持

#### L3 Agent / L3 代理层
- **WorkingMemory**: 3-tier buffer (focus/context/scratchpad) with priority eviction
  三层缓冲区（焦点/上下文/草稿板），优先级淘汰
- **EpisodicMemory**: Ebbinghaus forgetting curve for automatic memory pruning
  艾宾浩斯遗忘曲线自动记忆修剪
- **SemanticMemory**: BFS knowledge graph with N-hop traversal, path finding, node merging
  BFS 知识图谱，N跳遍历、路径查找、节点合并
- **ContextCompressor**: LLM context window optimization
  LLM 上下文窗口优化
- **CapabilityEngine**: 4D capability scoring (technical/delivery/collaboration/innovation)
  四维能力评分（技术/交付/协作/创新）
- **PersonaEvolution**: PARL A/B testing for persona optimization
  PARL A/B 测试人格优化
- **ReputationLedger**: contribution tracking with multi-factor scoring
  贡献追踪，多因子评分
- **SoulDesigner**: 4 bee personas (scout/worker/guard/queen-messenger) with keyword selection
  4个蜜蜂人格（侦察蜂/工蜂/守卫蜂/女王信使），关键词选择

#### L4 Orchestration / L4 编排层
- **Orchestrator**: DAG-based task decomposition with dependency tracking
  基于DAG的任务分解，依赖追踪
- **CriticalPathAnalyzer**: CPM (Critical Path Method) for schedule optimization
  CPM（关键路径法）进度优化
- **QualityController**: multi-rubric evaluation (structural + completion + semantic)
  多维评估（结构 + 完成度 + 语义）
- **PipelineBreaker**: state machine (running/paused/failed/completed)
  状态机（运行中/暂停/失败/完成）
- **ResultSynthesizer**: Jaccard similarity deduplication + conflict detection
  Jaccard 相似度去重 + 冲突检测
- **ExecutionPlanner**: GEP (Gene Expression Programming) inspired plan generation
  GEP（基因表达式编程）启发式计划生成
- **ContractNet**: FIPA Contract Net Protocol for task allocation
  FIPA 合同网协议任务分配
- **ReplanEngine**: pheromone-triggered automatic replanning
  信息素触发自动重规划
- **ABCScheduler**: Artificial Bee Colony algorithm for resource scheduling
  ABC（人工蜂群）算法资源调度
- **RoleDiscovery**: k-means++ clustering for automatic role identification
  k-means++ 聚类自动角色发现
- **RoleManager**: MoE (Mixture of Experts) routing for role-task matching
  MoE（混合专家）路由角色-任务匹配
- **ZoneManager**: Jaccard auto-assign for zone membership
  Jaccard 自动分配区域成员

#### L5 Application / L5 应用层
- **PluginAdapter**: unified engine lifecycle manager (init → getHooks → getTools → close)
  统一引擎生命周期管理器（init → getHooks → getTools → close）
- **ContextService**: rich LLM context builder (memory + knowledge + pheromone + gossip)
  丰富的 LLM 上下文构建器（记忆 + 知识 + 信息素 + 八卦协议）
- **CircuitBreaker**: 3-state fault tolerance (CLOSED → OPEN → HALF_OPEN)
  三态容错（关闭 → 打开 → 半开）
- 7 tool factories: `swarm_spawn`, `swarm_query`, `swarm_pheromone`, `swarm_gate`, `swarm_memory`, `swarm_plan`, `swarm_zone`
  7个工具工厂：`swarm_spawn`、`swarm_query`、`swarm_pheromone`、`swarm_gate`、`swarm_memory`、`swarm_plan`、`swarm_zone`

#### L6 Monitoring / L6 监控层 (NEW / 新增)
- **StateBroadcaster**: SSE push for real-time state changes
  SSE 推送实时状态变更
- **MetricsCollector**: RED metrics (Rate, Error, Duration) + swarm-specific counters
  RED 指标（速率、错误、持续时间）+ 蜂群专用计数器
- **DashboardService**: Fastify HTTP server with API endpoints
  Fastify HTTP 服务器，提供 API 端点
- **dashboard.html**: dark theme real-time monitoring UI
  暗色主题实时监控界面

### OpenClaw Integration / OpenClaw 集成
- Rewrote `src/index.js` to use real OpenClaw `register(api)` pattern
  重写入口文件使用真实 OpenClaw `register(api)` 模式
- Created `openclaw.plugin.json` manifest
  创建 OpenClaw 插件清单
- 8 hook mappings / 8个钩子映射:
  - `before_agent_start` → `onAgentStart` + `onPrependContext`
  - `agent_end` → `onAgentEnd`
  - `after_tool_call` → `onToolCall` + `onToolResult`
  - `subagent_spawning` → `onSubAgentSpawn`
  - `subagent_ended` → `onSubAgentComplete` / `onSubAgentAbort`
  - `before_reset` → `onMemoryConsolidate`
  - `gateway_stop` → `close()`
  - `message_sending` → `onSubAgentMessage`
- 7 tools registered via `api.registerTool()`
  7个工具通过 `api.registerTool()` 注册
- Uses `api.pluginConfig`, `api.logger`, `api.dataDir`
  使用 `api.pluginConfig`、`api.logger`、`api.dataDir`

### 12 Bio-Inspired Algorithms / 12个仿生算法
1. **MMAS** (Max-Min Ant System) — pheromone intensity bounds / 信息素强度边界
2. **ACO Roulette Selection** — probabilistic task assignment / 概率任务分配
3. **Ebbinghaus Forgetting Curve** — memory pruning / 记忆修剪
4. **BFS Graph Traversal** — knowledge graph queries / 知识图谱查询
5. **PARL** (Persona A/B Reinforcement Learning) — persona evolution / 人格进化
6. **GEP** (Gene Expression Programming) — execution planning / 执行计划
7. **CPM** (Critical Path Method) — schedule optimization / 进度优化
8. **Jaccard Similarity** — dedup + zone auto-assign / 去重 + 区域自动分配
9. **MoE** (Mixture of Experts) — role routing / 角色路由
10. **FIPA CNP** (Contract Net Protocol) — task allocation / 任务分配
11. **ABC** (Artificial Bee Colony) — resource scheduling / 资源调度
12. **k-means++** — role discovery clustering / 角色发现聚类

### Breaking Changes / 破坏性变更
- Complete architecture rewrite (layer1-4 → L1-L6)
  架构完全重写（layer1-4 → L1-L6）
- Old layer1-core/layer2-engines/layer3-intelligence/layer4-adapter code is legacy (still present but unused by V5.0)
  旧 layer1-core/layer2-engines/layer3-intelligence/layer4-adapter 代码为遗留代码（仍存在但 V5.0 不再使用）
- Entry point changed from `createPlugin()` function to `{ id, register(api) }` object
  入口点从 `createPlugin()` 函数改为 `{ id, register(api) }` 对象
- Database schema now has 34 tables (was 25)
  数据库模式现有34张表（原25张）
- Test framework changed from `node:test` to `vitest`
  测试框架从 `node:test` 改为 `vitest`

### Test Coverage / 测试覆盖
- 471 tests across 30 files / 30个文件共471个测试
- **L1**: 93 tests (4 files) / 93个测试（4个文件）
- **L2**: 52 tests (3 files) / 52个测试（3个文件）
- **L3**: 76 tests (5 files) / 76个测试（5个文件）
- **L4**: 137 tests (11 files) / 137个测试（11个文件）
- **L5**: 70 tests (3 files) / 70个测试（3个文件）
- **L6**: 32 tests (3 files) / 32个测试（3个文件）
- **Integration**: 11 tests (1 file) / 11个测试（1个文件）

---

## [4.0.0] - 2026-03-06

### Major: Unified Plugin / 重大变更：统一插件

Claw-Swarm v4.0 merges **OME v1.1.0** (memory engine) and **Swarm Lite v3.0** (governance layer) into a single unified OpenClaw plugin, adding pheromone communication, agent design, and collaboration infrastructure.

Claw-Swarm v4.0 将 **OME v1.1.0**（记忆引擎）和 **Swarm Lite v3.0**（治理层）合并为统一插件，新增信息素通信、智能体设计和协作基础设施。

### Added / 新增

#### Architecture / 架构
- 4-layer architecture (Core → Engines → Intelligence → Adapter)
  4 层架构（核心 → 引擎 → 智能 → 适配）
- 6 independently toggleable subsystems (memory, pheromone, governance, soul, collaboration, orchestration)
  6 个独立开关子系统
- Unified SQLite database with 25 tables (WAL mode)
  统一 SQLite 数据库，25 张表（WAL 模式）
- Schema migration chain v0→v1→v2→v3 with auto-backup
  模式迁移链 v0→v3 含自动备份

#### Pheromone Engine / 信息素引擎 (NEW)
- 5 pheromone types: trail, alarm, recruit, queen, dance
  5 种信息素类型：足迹、警报、招募、女王、舞蹈
- Exponential decay model with configurable rates
  可配置速率的指数衰减模型
- Background decay service with explicit lifecycle management
  显式生命周期管理的后台衰减服务
- Indexed batch operations for large-table performance
  大表场景的索引批量操作

#### Soul Designer / 灵魂设计器 (NEW)
- 4 built-in bee persona templates (scout, worker, guard, queen-messenger)
  4 个内置蜜蜂人格模板
- Keyword-based persona selection
  基于关键词的人格选择
- Config-extensible persona system (user can add/override)
  配置可扩展人格系统
- Persona evolution with outcome tracking and win-rate
  人格进化：结果追踪 + 胜率

#### Collaboration / 协作 (NEW)
- Peer Directory with lazy-read pattern (supports hot-plug)
  惰性读取的同伴目录（支持热插拔）
- @mention fixer (auto-routes to known peers)
  @提及修复器（自动路由到已知同伴）
- Struggle detector with pheromone-aware false positive reduction
  信息素感知的困难检测器（降低误报）
- 4 collaboration strategies: parallel, pipeline, debate, stigmergy
  4 种协作策略：并行、流水线、辩论、信息素协调

#### Tools / 工具 (NEW)
- `collaborate` — Multi-channel peer communication
  多通道同伴通信
- `pheromone` — Emit/read pheromone signals
  发射/读取信息素信号
- `swarm_manage` — Task status, list, cancel, report
  任务状态、列表、取消、报告
- `swarm_spawn` — One-click swarm spawning
  一键蜂群生成
- `swarm_design` — SOUL template recommendations
  SOUL 模板推荐

#### Hooks / 钩子 (8 lifecycle hooks)
- `before_agent_start` — Unified injection (memory + peers + pheromone)
  统一注入（记忆 + 同伴 + 信息素）
- `after_tool_call` — Tracking + struggle detection
  追踪 + 困难检测
- `agent_end` — Checkpoint + governance evaluation + trail pheromone
  检查点 + 治理评估 + 足迹信息素
- `before_reset` — Session state cleanup
  会话状态清理
- `gateway_stop` — Explicit resource cleanup
  显式资源清理
- `subagent_spawning` — Governance gate
  治理门控
- `subagent_ended` — Post-subagent evaluation
  子智能体后评估
- `message_sending` — @mention routing
  @提及路由

### Ported from OME v1.1.0 / 从 OME v1.1.0 移植
- Memory CRUD operations (writeMemory, readMemories, etc.)
  记忆 CRUD 操作
- Checkpoint service (automatic and manual checkpoints)
  检查点服务
- Context service (prependContext builder)
  上下文服务
- Agent state tracking (in-memory Map)
  智能体状态追踪
- Agent ID resolution (multi-strategy)
  智能体 ID 解析

### Ported from Swarm Lite v3.0 / 从 Swarm Lite v3.0 移植
- 4D capability scoring engine (technical, delivery, collaboration, innovation)
  四维能力评分引擎
- Reputation ledger with contribution tracking
  贡献追踪的声誉账本
- Weighted voting system with rate limiting
  带限速的加权投票系统
- Crash-resilient evaluation queue
  崩溃恢复评估队列
- Agent registry facade
  智能体注册表门面
- Circuit breaker (extracted to standalone module)
  断路器（提取为独立模块）
- Task orchestrator with 4 execution strategies
  4 策略任务编排器
- Role manager with topological sort
  拓扑排序的角色管理器
- Ring buffer monitor with governance event sampling
  治理事件采样的环形缓冲监控器
- All 7 v3.1 bug fixes preserved
  保留全部 7 个 v3.1 修复

### Breaking Changes / 破坏性变更
- **Replaces OME**: Do not run both simultaneously
  替代 OME：请勿同时运行
- Import paths changed from flat to layered structure
  导入路径从扁平改为分层结构
- DB function names prefixed (e.g., `createTask` → `createSwarmTask`)
  DB 函数名增加前缀

---

## Previous Versions / 历史版本

### Swarm Lite v3.0 (2026-03-05)
- Added governance layer: capability scoring, voting, tier management
- 174 tests passing
- See `data/swarm-lite/` for historical code

### OME v1.1.0 (2026-03-05)
- Memory engine with checkpoint and context injection
- See `data/ome/` for historical code
