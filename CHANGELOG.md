# Changelog

All notable changes to Claw-Swarm are documented here.

本文件记录 Claw-Swarm 的所有重要变更。

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
