# Changelog

All notable changes to Claw-Swarm are documented here.

本文件记录 Claw-Swarm 的所有重要变更。

## [5.2.0] - 2026-03-09

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
