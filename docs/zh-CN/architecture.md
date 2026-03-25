# 架构设计

[<- 返回 README](../../README.zh-CN.md) | [English](../en/architecture.md)

Claw-Swarm V9.2 作为 OpenClaw 插件运行，采用**七域架构**与**双基座 + 场中介耦合**作为设计基础。本文描述运行时架构、七个功能域、12 维信号场、四种耦合机制、ModuleBase 契约、进程模型以及全部核心子系统，全部论述均锚定源代码。

---

## 目录

1. [设计起源](#设计起源)
2. [双基座](#双基座)
3. [七域架构](#七域架构)
4. [12 维信号场](#12-维信号场)
5. [四种耦合机制](#四种耦合机制)
6. [ModuleBase 契约](#modulebase-契约)
7. [进程模型](#进程模型)
8. [Hook 体系](#hook-体系)
9. [工具架构](#工具架构)
10. [引擎初始化顺序](#引擎初始化顺序)
11. [零 Feature Flag / 零空转](#零-feature-flag--零空转)
12. [关键常量表](#关键常量表)

---

## 设计起源

### 为什么从 V8 的 7 层改为 7 域？

V8 采用 L0--L6 七层垂直架构，层间依赖严格自上而下。这一设计存在三个结构性问题：

1. **横切耦合**：L3 代理层的情绪追踪器需要 L4 编排层的质量评估结果，但 L3 不允许依赖 L4——只能通过 L0 信号场间接传播，增加了偶然复杂度。
2. **Feature Flag 膨胀**：V8 共 15 个 Feature Flag 形成依赖树（`hierarchical <- dagEngine <- speculativeExecution`），启动时验证逻辑占用 110+ 行代码，导致运行时行为难以预测。
3. **fork 进程模型开销**：V8 通过 `child_process.fork()` 隔离引擎状态，IPC 桥接引入 5 秒超时预算和 10,000 待处理请求上限，增加了延迟和故障面。

V9 的解法是将七个垂直层重组为七个**功能域**——core、communication、intelligence、orchestration、quality、observe、bridge——域间通过信号场和事件总线松耦合，而非层级锁定。全部 Feature Flag 被消除，全部模块无条件激活，进程模型从 fork 回归单进程。

**V8 到 V9 的结构对照：**

| 维度 | V8.2 (七层) | V9.2 (七域) |
|------|------------|------------|
| 组织方式 | L0--L6 垂直分层 | 7 个功能域 |
| 依赖规则 | 只能依赖下方层 | 域间通过场/总线耦合 |
| Feature Flag | 15 个，依赖树 | 0 个 |
| 空转模块 | 8 个默认禁用 | 0 个 |
| 进程模型 | Gateway + fork 子进程 + IPC | 单进程，插件内加载 |
| 耦合验证 | 无 | `_verifyCoupling()` 启动时校验 |
| 信号场 | L0 SignalField + ScopeGraph + MeshNode (17 文件) | SignalStore + MemoryBackend (7 文件) |
| 持久化 | SQLite 64 表，schema v13 | 内存 Map + JSON 快照 |
| Hook 数量 | 20 个 (5 Tier A + 15 Tier B) | 16 个 (统一层) |
| 工具数量 | 4 公开 + 6 内部 | 10 个（全部对外） |
| 源文件 | 208 (.js) | 128 (.js) |
| 总行数 | ~30,000+ | 25,447 |

**版本演进轨迹：**

```
V5.x:  L1 基础设施 → L2 通信 → L3 代理 → L4 编排 → L5 应用 → L6 监控     (6 层)
V8.0+: L0 信号场 → L1 基础设施 → L2 通信 → L3 代理 → L4 编排 → L5 应用 → L6 监控  (7 层)
V9.2:  core ──┬── communication ──┬── bridge                                (7 域)
              ├── intelligence ───┤
              ├── orchestration ──┤
              ├── quality ────────┤
              └── observe ────────┘
```

### 为什么需要双基座？

V8 的 L0 层包含 SignalField、ScopeGraph、MeshNode 三大组件，17 个文件，但缺少统一的持久化抽象——各引擎自行管理 SQLite 表。V9 将基底精简为两个正交基座：

- **SignalStore**（信号场）：负责信号发射、衰减、查询、叠加，是模块间**连续值通信**的唯一入口。
- **DomainStore**（领域存储）：负责键值持久化和 JSON 快照，是模块间**离散状态共享**的唯一入口。

两个基座由 **EventBus** 粘合——SignalStore 发射信号时发布事件，DomainStore 写入时可触发事件，模块通过订阅事件实现异步联动。

---

## 双基座

V9 全部模块通过三个共享实例进行交互：SignalStore、DomainStore、EventBus。它们在 `SwarmCoreV9` 构造函数中创建，传递给每个域工厂。

### SignalStore（信号场）

| 属性 | 值 |
|------|---|
| 源文件 | `src/core/field/signal-store.js` |
| 行数 | 382 |
| 基类 | `ModuleBase` |
| API | `emit(partial)`, `query(filter)`, `superpose(scope)`, `gc()` |
| 后端 | `MemoryBackend`（内存 Map，215 行） |
| 衰减算法 | Forward-Decay：`actual(s, lambda, t_emit, t_read) = s * exp(-lambda * age)` |
| 最大信号数 | 100,000（超限触发紧急 GC） |
| 定时 GC | 60 秒间隔（`GCScheduler`，156 行） |
| 强度范围 | [0.0, 1.0] |
| 过期阈值 | 0.001 |

**核心流程：** `emit()` 验证维度和强度 -> Forward-Decay 编码 -> 写入后端 -> 超限检测 -> 发布 `field.signal.emitted` 事件。

### DomainStore（领域存储）

| 属性 | 值 |
|------|---|
| 源文件 | `src/core/store/domain-store.js` |
| 行数 | 287 |
| 数据结构 | `Map<string, Map<string, *>>` 二级集合 |
| API | `put(col, key, val)`, `get(col, key)`, `query(col, fn)`, `delete(col, key)`, `putBatch(col, entries)` |
| 持久化 | JSON 快照（原子写入：`.tmp` -> `rename`） |
| 自动快照 | 30 秒间隔 |
| 脏标记 | `_dirty` 标志，无变更则跳过快照 |

### EventBus（事件总线）

| 属性 | 值 |
|------|---|
| 源文件 | `src/core/bus/event-bus.js` |
| 行数 | 175 |
| 模式 | 发布/订阅，通配符支持（`agent.*`） |
| 实现 | `Map<string, Set<Function>>` + 正则通配符数组 |
| 错误隔离 | `_safeCall()` 保证单个处理器异常不阻塞其他处理器 |
| 最大监听器 | 每个主题 100 个，超限打印警告 |
| 事件目录 | 27 个标准主题（`src/core/bus/event-catalog.js`，88 行） |

---

## 七域架构

V9 源码位于 `src/` 目录下，按七个功能域 + 三个顶层入口文件组织。每个域接收 `{ field, bus, store }` 三个基座引用，通过工厂函数创建模块并返回统一的 facade。

| 域 | 目录 | 文件数 | 行数 | 职责 |
|----|------|--------|------|------|
| **core** | `src/core/` | 12 | 1,953 | 双基座 + 事件总线 + ModuleBase：SignalStore、DomainStore、EventBus、Forward-Decay、GCScheduler、MemoryBackend、FieldVector、EventCatalog、SnapshotManager |
| **communication** | `src/communication/` | 8 | 1,281 | 通信基础设施：ChannelManager、TaskChannel、PheromoneEngine、ResponseMatrix、TypeRegistry、StigmergicBoard、GossipProtocol |
| **intelligence** | `src/intelligence/` | 34 | 5,606 | 代理认知 + 记忆 + 社交 + 产物 + 理解：CapabilityEngine、ModelCapability、PromptBuilder、RoleRegistry、SoulDesigner、WorkingMemory、EpisodicMemory、SemanticMemory、HybridRetrieval、VectorIndex、EmotionalState、ReputationCRDT、SNAAnalyzer、TrustDynamics、ArtifactRegistry、ExecutionJournal、IntentClassifier、ScopeEstimator 等 |
| **orchestration** | `src/orchestration/` | 24 | 6,889 | 规划 + 调度 + 自适应：DAGEngine、ExecutionPlanner、ReplanEngine、CriticalPath、ResultSynthesizer、ZoneManager、SpawnAdvisor、HierarchicalCoord、ContractNet、RoleManager、DeadlineTracker、ResourceArbiter + 10 个自适应模块（DualProcessRouter、GlobalModulator、SignalCalibrator、ShapleyCredit、SpeciesEvolver 等） |
| **quality** | `src/quality/` | 10 | 2,738 | 质量门 + 弹性 + 分析：EvidenceGate、QualityController、ToolResilience、CircuitBreaker、FailureVaccination、PipelineBreaker、FailureAnalyzer、AnomalyDetector、ComplianceMonitor |
| **observe** | `src/observe/` | 13 | 1,651 | 可观测性：MetricsCollector、DashboardService、HealthChecker、TraceCollector、StateBroadcaster |
| **bridge** | `src/bridge/` | 24 | 4,526 | OpenClaw 适配：HookAdapter（16 hooks）、10 个工具工厂、SessionBridge、SpawnClient、ModelFallback、ReadinessGuard、ComplianceHook、InjectRetry、IpcFallback、ToolGuard、MCPRegistry、ProgressTracker、TaskPresenter、UserNotifier |

**顶层入口（3 个文件，852 行）：**

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/index.js` | 205 | OpenClaw 插件声明（`register()`），V8 API 适配器，生命周期 hooks，Dashboard Gateway 代理，`/swarm` 命令 |
| `src/index-v9.js` | 172 | V9 激活/停用：创建 SwarmCoreV9，创建桥接模块，注册 16 hooks + 10 tools，启动核心 |
| `src/swarm-core-v9.js` | 475 | 顶层编排器：创建双基座，动态导入 5 个域，耦合验证，生命周期管理 |

**汇总统计：** 128 个 JavaScript 源文件（含顶层入口），25,447 行。

### 各域模块详解

#### core 域（12 文件 / 1,953 行）

core 域提供全部其他域共享的基础设施，不依赖任何外部域。

| 子目录 | 文件 | 行数 | 职责 |
|--------|------|------|------|
| `field/` | `signal-store.js` | 382 | 信号场顶层模块：emit / query / superpose / gc |
| `field/` | `types.js` | 133 | 12 维度常量、衰减率表、信号类型定义 |
| `field/` | `forward-decay.js` | 108 | Forward-Decay 纯数学函数：encode / decode / actualStrength / isExpired / computeTTL |
| `field/` | `field-vector.js` | 178 | 12 维场向量叠加算法 |
| `field/` | `gc-scheduler.js` | 156 | 定时 + 紧急垃圾回收调度器 |
| `field/backends/` | `memory.js` | 215 | 内存后端：Map 存储 + scan/put/count/stats |
| `bus/` | `event-bus.js` | 175 | 发布/订阅总线，通配符 + 安全调用 |
| `bus/` | `event-catalog.js` | 88 | 27 个标准事件主题常量与描述 |
| `store/` | `domain-store.js` | 287 | 内存键值存储 + JSON 快照持久化 |
| `store/` | `snapshot-manager.js` | 141 | 快照管理器（压缩、清理） |
| `store/` | `types.js` | 31 | 存储类型定义 |
| `.` | `module-base.js` | 59 | ModuleBase 抽象基类 |

#### communication 域（8 文件 / 1,281 行）

通信域提供代理间消息传递、信息素协调和痕迹协作能力，由 3 个子目录组织。

| 子目录 | 文件 | 行数 | 职责 |
|--------|------|------|------|
| `channel/` | `channel-manager.js` | 153 | 通信通道管理：创建/关闭/路由消息 |
| `channel/` | `task-channel.js` | 197 | 任务专用通道：任务发布/认领/状态广播 |
| `pheromone/` | `pheromone-engine.js` | 311 | 信息素引擎：沉积/蒸发/响应，ACO 公式 |
| `pheromone/` | `response-matrix.js` | 149 | 信息素响应矩阵：类型 x 强度 -> 行为映射 |
| `pheromone/` | `type-registry.js` | 77 | 信息素类型注册表 |
| `stigmergy/` | `stigmergic-board.js` | 169 | 痕迹协作板：持久化公告板，基于 DomainStore |
| `stigmergy/` | `gossip-protocol.js` | 91 | Gossip 协议：状态收敛、最终一致性 |
| `.` | `index.js` | 134 | 域工厂：创建 7 个模块，返回 facade |

#### intelligence 域（34 文件 / 5,606 行）

智能域是文件数和行数最多的域，涵盖代理的完整认知、记忆、社交和产物能力。内部按 5 个子域组织。

| 子域 | 文件数 | 代表模块 | 职责 |
|------|--------|---------|------|
| `identity/`（身份） | 8 | CapabilityEngine(230), ModelCapability(177), PromptBuilder(363), RoleRegistry(260), SoulDesigner(179), CrossProvider(239), LifecycleManager(253), SensitivityFilter(118) | 代理身份管理：能力向量、角色注册、灵魂设计、Prompt 构建、模型能力画像、跨供应商适配、生命周期、敏感度过滤 |
| `memory/`（记忆） | 8 | WorkingMemory(145), EpisodicMemory(255), SemanticMemory(215), HybridRetrieval(228), VectorIndex(219), ContextEngine(164), EmbeddingEngine(222), UserProfile(180) | 记忆子系统：工作记忆、情景记忆、语义记忆、混合检索、向量索引、上下文引擎、嵌入引擎、用户画像 |
| `social/`（社交） | 8 | ReputationCRDT(130), EmotionalState(105), TrustDynamics(108), SNAAnalyzer(110), EpisodeLearner(131), SelfReflection(126), CulturalFriction(91), EILayer(81) | 社交认知：声誉 CRDT、情绪状态、信任动态、社会网络分析、情景学习、自省、文化摩擦、情商层 |
| `artifacts/`（产物） | 4 | ArtifactRegistry(159), ExecutionJournal(219), WorkspaceOrganizer(142), index(45) | 产物管理：产物注册表、执行日志、工作空间组织 |
| `understanding/`（理解） | 4 | IntentClassifier(113), ScopeEstimator(114), RequirementClarifier(126), index(43) | 用户意图：意图分类、范围估算、需求澄清 |
| `.` | 2 | index.js(259) | 域工厂：组装 5 个子域，返回 facade |

#### orchestration 域（24 文件 / 6,889 行）

编排域协调多代理协作，内部分为规划、调度和自适应三个子系统。

| 子系统 | 文件数 | 模块（行数） | 职责 |
|--------|--------|------------|------|
| `planning/`（规划） | 6 | DAGEngine(669), ExecutionPlanner(427), ReplanEngine(317), CriticalPath(325), ResultSynthesizer(421), ZoneManager(174) | DAG 引擎 + 执行规划 + 重规划 + 关键路径分析 + 结果综合 + 区域管理 |
| `scheduling/`（调度） | 6 | SpawnAdvisor(430), HierarchicalCoord(236), ContractNet(236), RoleManager(192), DeadlineTracker(211), ResourceArbiter(339) | 生成建议 + 层级协调 + 合同网协议 + 角色管理 + 截止跟踪 + 资源仲裁 |
| `adaptation/`（自适应） | 11 | DualProcessRouter(156), GlobalModulator(183), ResponseThreshold(197), SignalCalibrator(248), ShapleyCredit(246), SpeciesEvolver(472), RoleDiscovery(341), SkillGovernor(219), BudgetTracker(332), BudgetForecaster(270), index(98) | 双过程路由 + 全局调制 + 响应阈值 + 信号校准 + Shapley 信用归因 + 种群进化 + 角色发现 + 技能治理 + 预算跟踪/预测 |
| `.` | 1 | index.js(151) | 域工厂 |

#### quality 域（10 文件 / 2,738 行）

质量域提供质量门控、工具弹性和故障分析三大能力。

| 子目录 | 文件 | 行数 | 职责 |
|--------|------|------|------|
| `gate/` | `evidence-gate.js` | 314 | 证据门：高风险任务硬门控，证据评审 + 上诉 |
| `gate/` | `quality-controller.js` | 331 | 质量控制器：输出审计，声誉反馈 |
| `resilience/` | `tool-resilience.js` | 312 | 工具弹性：AJV schema 预验证 + 自动修复 + 重试提示 |
| `resilience/` | `circuit-breaker.js` | 259 | 熔断器：closed/open/half-open 三态，工具故障隔离 |
| `resilience/` | `failure-vaccination.js` | 316 | 故障疫苗：从失败中学习预防提示，免疫机制 |
| `resilience/` | `pipeline-breaker.js` | 262 | 流水线断路器：DAG 级别的预算/超时断路 |
| `analysis/` | `failure-analyzer.js` | 257 | 故障分类器：错误模式识别 + 修复策略推荐 |
| `analysis/` | `anomaly-detector.js` | 244 | 异常检测器：基于事件序列的代理行为异常检测 |
| `analysis/` | `compliance-monitor.js` | 219 | 合规监控器：代理输出合规检查 + 升级计数器 |
| `.` | `index.js` | 224 | 域工厂：创建 9 个模块，注册跨模块总线订阅 |

#### observe 域（13 文件 / 1,651 行）

可观测域提供指标收集、健康检查、分布式追踪、SSE 广播和 Dashboard 服务。

| 子目录 | 文件 | 行数 | 职责 |
|--------|------|------|------|
| `metrics/` | `metrics-collector.js` | 249 | 指标收集器：RED 指标，hook 统计，定时采样 |
| `dashboard/` | `dashboard-service.js` | 662 | Dashboard 服务：Fastify HTTP 服务，REST API 端点，端口 19100 |
| `health/` | `health-checker.js` | 185 | 健康检查器：多维度健康评估，历史记录 |
| `health/` | `trace-collector.js` | 227 | 追踪收集器：分布式追踪 span 采集，链路分析 |
| `broadcast/` | `state-broadcaster.js` | 192 | SSE 广播器：实时状态推送到前端控制台 |
| `.` | `index.js` | 80 | 域工厂 |

注：observe 域的 `dashboard-service.js`（662 行）是 V9 中行数最多的单个 bridge 域外文件，它引用全部 4 个兄弟域的 facade 来提供汇聚查询。

### 域间依赖关系

```
core (无外部依赖)
  <- communication (依赖 core)
  <- intelligence  (依赖 core)
     <- orchestration (依赖 core + intelligence 的 capabilityEngine/roleRegistry/modelCapability)
     <- quality       (依赖 core + intelligence 的 reputationCRDT)
        <- observe    (依赖 core + 引用全部 4 个兄弟域的 facade)
           <- bridge  (依赖 core + quality + observe + orchestration)
```

依赖注入在 `swarm-core-v9.js:90-193` 中完成，按 communication -> intelligence -> orchestration -> quality -> observe 的顺序创建，确保后创建的域可以引用先创建域的导出。

---

## 12 维信号场

信号场是 V9 模块间连续值通信的唯一通道。每个信号携带一个**维度标签**和**强度值**，在统一的 12 维空间中叠加、衰减和查询。

### 12 维度定义

| 维度 | 常量 | 默认衰减率 (lambda) | 近似半衰期 | 语义 |
|------|------|-------------------:|----------:|------|
| trail | `DIM_TRAIL` | 0.008 | ~87 秒 | 路径信息素——代理移动和任务路径 |
| alarm | `DIM_ALARM` | 0.15 | ~4.6 秒 | 警报信号——异常、错误、紧急事件 |
| reputation | `DIM_REPUTATION` | 0.005 | ~139 秒 | 声誉信号——代理可信度和表现评分 |
| task | `DIM_TASK` | 0.01 | ~69 秒 | 任务信号——任务发布、进度、完成 |
| knowledge | `DIM_KNOWLEDGE` | 0.003 | ~231 秒 | 知识信号——知识发现、共享、蒸馏 |
| coordination | `DIM_COORDINATION` | 0.02 | ~35 秒 | 协调信号——多代理协作、同步 |
| emotion | `DIM_EMOTION` | 0.1 | ~6.9 秒 | 情绪信号——代理情绪状态、压力指示 |
| trust | `DIM_TRUST` | 0.006 | ~116 秒 | 信任信号——代理间信任关系 |
| sna | `DIM_SNA` | 0.004 | ~173 秒 | 社交网络分析信号——网络拓扑、中心度 |
| learning | `DIM_LEARNING` | 0.002 | ~347 秒 | 学习信号——经验习得、技能提升 |
| calibration | `DIM_CALIBRATION` | 0.01 | ~69 秒 | 校准信号——系统参数校准、调优 |
| species | `DIM_SPECIES` | 0.001 | ~693 秒 | 种群信号——种群进化、变异、淘汰 |

**来源：** `src/core/field/types.js:60-73`。半衰期计算公式：`t_half = ln(2) / lambda`（单位毫秒，表中换算为秒）。

### Forward-Decay 衰减机制

V9 信号场采用 Forward-Decay 算法（`src/core/field/forward-decay.js`，108 行）实现时间衰减。该算法的核心思想是在写入时将强度"前推"到未来，在读取时将分数"拉回"到当前时刻，从而避免对存储信号进行定期更新。

| 函数 | 公式 | 用途 |
|------|------|------|
| `encode(s, lambda, t_emit)` | `s * exp(lambda * t_emit)` | 写入时编码（将强度前推到发射时刻） |
| `decode(e, lambda, t_read)` | `e * exp(-lambda * t_read)` | 读取时解码（将编码分数拉回到读取时刻） |
| `actualStrength(s, lambda, t_emit, t_read)` | `s * exp(-lambda * max(0, t_read - t_emit))` | 直接计算实际强度（推荐，避免中间值溢出） |
| `isExpired(s, lambda, t_emit, t_read, threshold)` | `actualStrength < threshold` | 判断信号是否过期 |
| `computeTTL(lambda, threshold)` | `ln(1/threshold) / lambda` | 计算信号存活时间 |

**设计选择：** V9 的 `query()` 使用 `actualStrength()` 而非 `encode()+decode()` 组合，原因是后者在 `lambda * emitTime` 较大时（emitTime 为毫秒级时间戳，值可达 10^12）会产生 `exp()` 溢出。直接计算 `exp(-lambda * age)` 中的 age 仅为秒级差值，不会溢出。

### 信号生命周期

```
1. 模块调用 field.emit({ dimension, scope, strength, emitterId, metadata })
2. SignalStore 验证维度 ∈ ALL_DIMENSIONS，强度 clamp 到 [0, 1]
3. Forward-Decay 编码：encodedScore = strength * exp(lambda * emitTime)
4. 写入 MemoryBackend（内存 Map，按 scope+dimension 索引）
5. 若 backend.count() > 100,000 → 触发紧急 GC
6. 发布事件 field.signal.emitted 到 EventBus
```

```
查询：field.query({ scope?, dimension?, emitterId?, minStrength?, sortBy?, limit? })
  -> backend.scan(filter)
  -> 逐信号计算 actualStrength = strength * exp(-lambda * age)
  -> 按 minStrength 过滤
  -> 按 strength/emitTime 排序
  -> limit 截断
```

```
叠加：field.superpose(scope, dimensions?)
  -> 扫描该作用域全部信号
  -> 对每个维度计算加权叠加
  -> 返回 12 维场向量 { trail: 0.23, alarm: 0.01, ... }
```

### 场向量

场向量是某个作用域在 12 个维度上的叠加结果（`src/core/field/field-vector.js`，178 行）。它是 Hook 系统向 LLM 注入上下文的核心数据——`onPrependSystemContext()` 将当前会话的场向量序列化为 `<swarm-context>` XML 标签，注入到系统提示中。

### 事件目录（27 个标准主题）

| 域 | 主题 | 描述 |
|----|------|------|
| core/field | `field.signal.emitted` | 信号已释放到场中 |
| core/field | `field.gc.completed` | 场垃圾回收完成 |
| core/field | `field.emergency_gc` | 场紧急垃圾回收 |
| core/store | `store.snapshot.completed` | 状态快照完成 |
| core/store | `store.restore.completed` | 状态恢复完成 |
| communication | `channel.created` / `channel.closed` / `channel.message` | 通道生命周期 + 消息 |
| communication | `pheromone.deposited` / `pheromone.evaporated` | 信息素沉积/蒸发 |
| intelligence | `agent.lifecycle.spawned` / `.ready` / `.completed` / `.failed` / `.ended` | 代理生命周期 5 阶段 |
| intelligence | `memory.episode.recorded` / `memory.consolidated` | 记忆记录/整合 |
| orchestration | `task.created` / `task.completed` | 任务创建/完成 |
| orchestration | `dag.state.changed` / `spawn.advised` | DAG 变更 / 生成建议 |
| orchestration | `reputation.updated` | 声誉更新 |
| quality | `quality.gate.passed` / `.gate.failed` | 质量门通过/未通过 |
| quality | `quality.breaker.tripped` / `quality.anomaly.detected` | 熔断器触发 / 异常检测 |
| quality | `quality.compliance.violation` | 合规违规 |
| observe | `observe.metrics.collected` | 指标已收集 |

**来源：** `src/core/bus/event-catalog.js`（88 行）。全部主题通过 `EVENT_CATALOG` 冻结对象导出，包含描述和负载类型定义。

---

## 四种耦合机制

V9 模块之间不直接 import 彼此，而是通过四种机制松耦合：

| 机制 | 载体 | 方向 | 延迟 | 适用场景 |
|------|------|------|------|---------|
| **信号场耦合** | `field.emit()` / `field.query()` | 生产者 -> 场 -> 消费者 | 同步写入，按需查询 | 连续值传播：声誉、情绪、路径、校准 |
| **事件总线耦合** | `bus.publish()` / `bus.subscribe()` | 发布者 -> 总线 -> 订阅者 | 同步回调 | 离散事件：代理生命周期、任务状态、质量门 |
| **依赖注入耦合** | 工厂函数参数 | 创建时一次性传入 | 无运行时开销 | 跨域引用：orchestration 引用 intelligence 的 capabilityEngine |
| **DomainStore 耦合** | `store.put()` / `store.get()` | 写入者 -> 存储 -> 读取者 | 内存 Map O(1) | 持久状态共享：代理记录、任务记录、检查点 |

### 耦合验证

`SwarmCoreV9._verifyCoupling()`（`src/swarm-core-v9.js:207-281`）在启动时遍历全部域的 `allModules()`，收集每个模块的 `static produces()` 和 `static consumes()` 声明，验证：

- 每个被消费的维度至少有一个生产者（否则为**断裂耦合**，抛出错误）
- 每个被生产的维度至少有一个消费者（否则为**空转维度**，记录警告）

该检查确保信号场的 12 个维度形成完整的生产-消费图，不存在断裂或空转。

**验证算法流程：**

```
1. _collectAllModules() 遍历 5 个域的 allModules()，收集全部模块实例
2. 对每个模块，调用 constructor.produces() 和 constructor.consumes()
3. 构建 producers Map (dimension -> [moduleName]) 和 consumers Map
4. 同时收集 publishes() / subscribes() 构建事件图（当前仅记录，不做硬验证）
5. 检查: 对 consumers 中每个 dimension，producers 中必须存在 → 否则抛 Error
6. 检查: 对 producers 中每个 dimension，consumers 中不存在 → 记录 warning
7. 验证通过后发布 swarm.coupling.verified 事件
```

**验证失败时的行为：** 断裂耦合（有消费者无生产者）会抛出 Error，但 `start()` 方法在 `try/catch` 中捕获该错误，将其记录到 `_initErrors` 并发布 `swarm.coupling.warning` 事件，**不会阻止系统启动**。这是一个设计权衡：允许部分域缺失时系统仍可降级运行。

---

## ModuleBase 契约

`ModuleBase`（`src/core/module-base.js`，59 行）是全部 V9 模块的抽象基类。每个模块必须声明四个静态方法：

```javascript
class MyModule extends ModuleBase {
  static produces()   { return ['trail', 'reputation'] }  // 向信号场发射的维度
  static consumes()   { return ['task', 'alarm'] }        // 从信号场读取的维度
  static publishes()  { return ['my.event.done'] }        // 在 EventBus 上发布的事件
  static subscribes() { return ['task.completed'] }       // 在 EventBus 上订阅的事件

  async start() { /* 初始化资源 */ }
  async stop()  { /* 释放资源 */ }
}
```

| 方法 | 返回类型 | 作用 |
|------|---------|------|
| `static produces()` | `string[]` | 声明该模块向信号场发射的维度（DIM_* 常量） |
| `static consumes()` | `string[]` | 声明该模块从信号场读取的维度 |
| `static publishes()` | `string[]` | 声明该模块在 EventBus 上发布的事件主题 |
| `static subscribes()` | `string[]` | 声明该模块在 EventBus 上订阅的事件主题 |
| `async start()` | `Promise<void>` | 生命周期启动（初始化资源、注册订阅） |
| `async stop()` | `Promise<void>` | 生命周期停止（释放资源、取消订阅） |

**契约意义：** `_verifyCoupling()` 依赖这四个静态方法进行编译期（启动时）验证。任何不声明 `produces()`/`consumes()` 的模块将被视为不产生也不消费信号——如果它实际上在运行时调用了 `field.emit()`，耦合验证不会捕获，但信号仍会正常传播。

---

## 进程模型

V9 从 V8 的双进程模型（Gateway + fork 子进程）回归为**单进程模型**。全部域在 OpenClaw Gateway 的 Node.js 事件循环内运行。

```
  OpenClaw Gateway (Node.js, 单进程)
  ┌───────────────────────────────────────────────────────────────┐
  │  index.js (插件声明, 205 行)                                   │
  │    └─ index-v9.js (V9 激活器, 172 行)                          │
  │        └─ SwarmCoreV9 (顶层编排器, 475 行)                     │
  │            ├─ SignalStore (信号场, 382 行)                      │
  │            ├─ DomainStore (领域存储, 287 行)                    │
  │            ├─ EventBus (事件总线, 175 行)                      │
  │            │                                                   │
  │            ├─ communication (7 模块, 1,281 行)                 │
  │            ├─ intelligence  (33 模块, 5,606 行)                │
  │            ├─ orchestration (22+10 模块, 6,889 行)             │
  │            ├─ quality       (9 模块, 2,738 行)                 │
  │            └─ observe       (5 模块, 1,651 行)                 │
  │                 └─ DashboardService :19100                     │
  │                                                               │
  │  bridge (16 hooks + 10 tools, 4,526 行)                       │
  │    ├─ HookAdapter → 16 OpenClaw hooks                          │
  │    ├─ 10 个工具工厂 → swarm_run/query/dispatch/...            │
  │    ├─ SessionBridge, SpawnClient, ModelFallback                │
  │    └─ ReadinessGuard, ToolGuard, ComplianceHook, InjectRetry  │
  └───────────────────────────────────────────────────────────────┘
```

**V8 到 V9 进程模型对比：**

| 特性 | V8.2 | V9.2 |
|------|------|------|
| 进程数 | 2（Gateway + fork 子进程） | 1（Gateway 内加载） |
| 引擎隔离 | 子进程内存隔离 | 同一 V8 堆 |
| Hook 分层 | Tier A (Gateway, <0.1ms) + Tier B (IPC, 2-5ms) | 统一（全部在 Gateway 进程） |
| IPC 开销 | 5s 超时，10,000 待处理上限 | 无 |
| 故障隔离 | 子进程崩溃不影响 Gateway | 模块异常由 `safe()` 包装隔离 |
| 重启方式 | kill + re-fork | deactivate + activate |

### V8 API 适配器

`src/index.js` 中的 `createAppAdapter(api)` 函数（行 31-53）将 OpenClaw 的 V8 插件 API 适配为 V9 的 app 接口：

| V8 API | V9 App 接口 | 适配方式 |
|--------|------------|---------|
| `api.pluginConfig` | `app.getConfig()` | 直接返回 |
| `api.on(name, handler)` | `app.addHook(name, handler)` | 方法名映射 |
| `api.registerTool(tool)` | `app.registerTool(tool)` | 透传 |
| (无) | `app.getMessageBus()` | 返回 null（V9 内部创建 EventBus） |

此适配层确保 V9 代码不直接依赖 V8 的 API 签名，未来 OpenClaw 升级 API 时只需修改适配器。

### Gateway Dashboard 代理

`src/index.js:139-165` 注册了 3 条 HTTP 代理路由，将 Gateway（端口 18789）的请求转发到 DashboardService（端口 19100）：

| Gateway 路径 | 转发目标 |
|-------------|---------|
| `/swarm/api/v1/*` | `http://127.0.0.1:19100/api/v1/*` |
| `/swarm/api/v9/*` | `http://127.0.0.1:19100/api/v9/*` |
| `/swarm/v6/*` | `http://127.0.0.1:19100/v6/*` |

---

## Hook 体系

HookAdapter（`src/bridge/hooks/hook-adapter.js`，433 行）向 OpenClaw API 注册 **16 个钩子**。每个处理器委托给对应的域模块，由 `safe()` 包装确保单个域失败不影响 hook 流水线。

| # | Hook 名称 | 委托目标 | 语义 |
|---|----------|---------|------|
| 1 | `session_start` | SessionBridge | 初始化会话作用域 |
| 2 | `session_end` | SessionBridge | 清理会话状态 |
| 3 | `message_created` | intelligence (IntentClassifier, ScopeEstimator) | 意图分类 + 范围估算 |
| 4 | `before_agent_start` | orchestration.advisor + quality (immunity, compliance) + intelligence (prompt) | 最复杂 hook：SpawnAdvisor 决策、免疫检查、合规升级、动态 prompt 构建、工具权限、模型覆盖 |
| 5 | `agent_start` | observe (TraceCollector) + SessionBridge | 开始追踪 span，记录代理到会话 |
| 6 | `agent_end` | observe + SessionBridge + SpawnClient + quality | 结束 span，清理代理，质量审计/故障分类 |
| 7 | `llm_output` | quality (ComplianceMonitor) | 合规检查：检测代理是否遵守指令 |
| 8 | `before_tool_call` | quality (CircuitBreaker + ToolResilience) | 熔断器 + schema 验证，返回 `{blocked: true}` 阻止执行 |
| 9 | `after_tool_call` | quality (CircuitBreaker) | 记录工具成功/失败，更新熔断器状态 |
| 10 | `prependSystemContext` | SignalStore.superpose() | 将场向量注入系统提示（`<swarm-context>` XML） |
| 11 | `before_shutdown` | DomainStore.snapshot() | 持久化快照 |
| 12 | `error` | ModelFallback | 模型错误时的回退/重试决策 |
| 13 | `tool_result` | quality (AnomalyDetector) | 工具结果送入异常检测器 |
| 14 | `agent_message` | communication + intelligence (WorkingMemory) | 消息发到通信通道 + 写入工作记忆 |
| 15 | `activate` | 全部域 start() | 启动全部域（按依赖顺序） |
| 16 | `deactivate` | 全部域 stop() | 停止全部域（逆序） |

**来源：** `src/bridge/hooks/hook-adapter.js:66-85`

### bridge/reliability 子系统

除 HookAdapter 外，bridge 域还包含 5 个可靠性模块（`src/bridge/reliability/`，共 378 行）：

| 模块 | 行数 | 职责 |
|------|------|------|
| `readiness-guard.js` | 75 | 就绪守卫：核心未启动时阻止工具执行 |
| `tool-guard.js` | 83 | 工具守卫：SwarmGuard 逻辑（阻止非蜂群工具） |
| `compliance-hook.js` | 76 | 合规钩子：升级警告注入 |
| `inject-retry.js` | 68 | 注入重试：最多 3 次，指数退避 |
| `ipc-fallback.js` | 76 | IPC 回退：缓存最后成功结果（V8 兼容） |

---

## 工具架构

V9 注册 **10 个工具**到 OpenClaw API，工具工厂位于 `src/bridge/tools/`。每个工厂函数接收 `{ core, quality, sessionBridge, spawnClient }` 依赖，返回符合 OpenClaw Tool API 的工具对象。

| # | 工具名 | 源文件 | 行数 | 职责 |
|---|--------|--------|------|------|
| 1 | `swarm_run` | `run-tool.js` | 248 | 核心入口：接收目标，分解为阶段，派遣子代理执行 |
| 2 | `swarm_query` | `query-tool.js` | 320 | 查询蜂群状态：代理、任务、DAG、信号场 |
| 3 | `swarm_dispatch` | `dispatch-tool.js` | 148 | 手动派遣单个子代理到指定角色 |
| 4 | `swarm_checkpoint` | `checkpoint-tool.js` | 232 | 检查点：持久化当前执行状态 |
| 5 | `swarm_spawn` | `spawn-tool.js` | 186 | 直接生成子代理（低级接口） |
| 6 | `swarm_pheromone` | `pheromone-tool.js` | 242 | 信息素操作：沉积/查询/蒸发 |
| 7 | `swarm_gate` | `gate-tool.js` | 261 | 质量门：提交证据，请求评审 |
| 8 | `swarm_memory` | `memory-tool.js` | 238 | 记忆操作：写入/检索情景记忆和语义记忆 |
| 9 | `swarm_plan` | `plan-tool.js` | 320 | 规划操作：创建/修改 DAG 执行计划 |
| 10 | `swarm_zone` | `zone-tool.js` | 255 | 区域管理：创建/查询/管理执行区域 |

**工具注册流程：** `index-v9.js:90-119`——通过 `tryToolImport()` 安全导入 10 个工具工厂模块，对每个工厂调用 `factory(deps)` 创建工具实例，再通过 `app.registerTool(tool)` 注册。任何工厂导入或创建失败均为非致命错误，不影响其余工具。

### swarm_run 执行流程

```
1. 用户消息触发 swarm_run 工具，传入 { goal, mode }
2. ExecutionPlanner.plan(goal) 将目标分解为阶段 + 角色
3. DAGEngine.createDAG(phases) 创建有向无环图
4. 对每个 DAG 叶节点:
   a. SpawnAdvisor.advise(scope, role) → 推荐模型、工具权限
   b. ContractNet.cfp(task) → 发布 CFP，收集投标
   c. SpawnClient.spawn(agent) → 生成子代理
5. DeadlineTracker 启动超时监视
6. 子代理执行完成 → QualityController 审计结果
7. ShapleyCredit 计算贡献归因
8. ResultSynthesizer 综合全部阶段结果
9. 返回综合结果给父会话
```

### bridge/session 子系统

bridge 域还包含 3 个会话管理模块（`src/bridge/session/`，共 401 行）：

| 模块 | 行数 | 职责 |
|------|------|------|
| `session-bridge.js` | 132 | 会话桥接：维护会话作用域，跟踪活跃代理 |
| `spawn-client.js` | 165 | 生成客户端：子代理创建 + 结束通知 |
| `model-fallback.js` | 104 | 模型回退：错误时的模型降级/重试策略 |

### bridge/interaction 子系统

5 个用户交互模块（`src/bridge/interaction/` + `src/bridge/connectors/`，共 864 行）：

| 模块 | 行数 | 职责 |
|------|------|------|
| `task-presenter.js` | 295 | 任务呈现器：格式化任务进度、DAG 状态为用户可读文本 |
| `progress-tracker.js` | 160 | 进度跟踪器：实时进度百分比计算 |
| `user-notifier.js` | 149 | 用户通知器：关键事件（完成/失败/超时）推送 |
| `subagent-failure-message.js` | 140 | 子代理失败消息：生成诊断友好的失败报告 |
| `mcp-registry.js` | 120 | MCP 连接器注册表：外部工具集成 |

---

## 引擎初始化顺序

全部域在 `SwarmCoreV9.start()`（`src/swarm-core-v9.js:332-389`）中按以下顺序初始化：

```
步骤 1:  构造 SignalStore(field) — 信号场基座
步骤 2:  构造 DomainStore(store) — 领域存储基座
步骤 3:  构造 EventBus(bus) — 事件总线
步骤 4:  store.restore() — 从 JSON 快照恢复持久化状态
步骤 5:  field.start() — 启动 GC 定时调度器
步骤 6:  创建 communication 域（7 模块，无跨域依赖）
步骤 7:  创建 intelligence 域（33 模块，无跨域依赖）
步骤 8:  创建 orchestration 域（22+10 模块，引用 intelligence 的 capabilityEngine/roleRegistry/modelCapability/artifactRegistry）
步骤 9:  创建 quality 域（9 模块，引用 intelligence 的 reputationCRDT）
步骤 10: 创建 observe 域（5 模块，引用全部 4 个兄弟域 facade）
步骤 11: _verifyCoupling() — 遍历全部模块，验证 produces/consumes 图完整性
步骤 12: 按序启动各域 start(): communication -> intelligence -> orchestration -> quality -> observe
步骤 13: 设置 _ready = true，发布 swarm.core.started 事件
```

**销毁按相反顺序执行**（`src/swarm-core-v9.js:394-426`）：observe -> quality -> orchestration -> intelligence -> communication -> field.stop() -> store.snapshot()。

### 初始化时序（具体行号）

| 步骤 | 代码位置 | 操作 |
|------|---------|------|
| 构造 | `swarm-core-v9.js:57-70` | 创建 SignalStore + DomainStore |
| 域导入 | `swarm-core-v9.js:94-100` | `Promise.all()` 并行导入 5 个域工厂 |
| 域创建 | `swarm-core-v9.js:104-186` | 按依赖顺序逐域创建（communication -> intelligence -> orchestration -> quality -> observe） |
| 状态恢复 | `swarm-core-v9.js:336-338` | `store.restore()` |
| 场启动 | `swarm-core-v9.js:341-343` | `field.start()` |
| 耦合验证 | `swarm-core-v9.js:347-353` | `_verifyCoupling()` |
| 域启动 | `swarm-core-v9.js:356-372` | 逐域调用 `start()` |
| 就绪 | `swarm-core-v9.js:374-381` | `_ready = true`，发布事件 |

---

## 零 Feature Flag / 零空转

### 零 Feature Flag

V8 有 15 个 Feature Flag，形成两棵依赖树：

```
hierarchical <- dagEngine <- speculativeExecution / workStealing
evolution.scoring <- evolution.clustering / evolution.gep / evolution.abc / evolution.lotkaVolterra
```

V9 彻底消除了 Feature Flag。全部模块在 `index.js:87` 的 `activateV9(app)` 中无条件激活。不存在 `if (config.featureX)` 分支，不存在 `enabled: false` 默认值。

**验证命令：**

```bash
cd src && grep -rn "featureFlag\|feature_flag\|FEATURE_FLAG\|enabled.*false" --include="*.js" | wc -l
# 预期输出: 0
```

### 零空转

V8 有 8 个默认禁用的模块（`speculativeExecution`, `evolution.clustering`, `evolution.gep`, `evolution.abc`, `evolution.lotkaVolterra`, `contextEngine`, `skillGovernor`, `knowledgeDistillation`）。V9 中不存在"注册但不激活"的模块：

- 每个域工厂无条件创建其全部模块
- 每个域的 `start()` 无条件调用全部模块的 `start()`
- `_verifyCoupling()` 遍历全部模块——如果某模块声明了 `consumes()` 但从未被创建，验证会报错

**验证命令：**

```bash
cd src && node -e "
  import('./swarm-core-v9.js').then(m => {
    const c = new m.SwarmCoreV9({});
    c.initialize().then(r => console.log('domains:', JSON.stringify(r.domains)));
  });
"
# 预期: 5 个域全部初始化（除非某域源文件缺失）
```

---

## 关键常量表

| 常量 | 值 | 位置 |
|------|---|------|
| 信号最大数量 | 100,000 | `signal-store.js:93` |
| 信号强度范围 | [0.0, 1.0] | `types.js:76-78` |
| 信号过期阈值 | 0.001 | `types.js:80` |
| GC 定时间隔 | 60,000 ms | `signal-store.js:92` |
| 自动快照间隔 | 30,000 ms | `domain-store.js:17` |
| 事件总线最大监听器/主题 | 100 | `event-bus.js:18` |
| 标准事件主题数 | 27 | `event-catalog.js` |
| 12 维度常量 | 见上表 | `types.js:49-53` |
| 域工厂数 | 5 | `swarm-core-v9.js:39` |
| Hook 数量 | 16 | `hook-adapter.js:12` |
| 工具数量 | 10 | `index-v9.js:90-101` |
| Dashboard 端口 | 19,100 | `index.js:18` |
| Gateway 端口 | 18,789 | OpenClaw 配置 |
| 版本号 | 9.0.0 | `swarm-core-v9.js:40` |
| core 域文件/行数 | 12 / 1,953 | `src/core/` |
| communication 域文件/行数 | 8 / 1,281 | `src/communication/` |
| intelligence 域文件/行数 | 34 / 5,606 | `src/intelligence/` |
| orchestration 域文件/行数 | 24 / 6,889 | `src/orchestration/` |
| quality 域文件/行数 | 10 / 2,738 | `src/quality/` |
| observe 域文件/行数 | 13 / 1,651 | `src/observe/` |
| bridge 文件/行数 | 24 / 4,526 | `src/bridge/` |
| 顶层入口文件/行数 | 3 / 852 | `src/index.js`, `src/index-v9.js`, `src/swarm-core-v9.js` |
| JS 源文件总数 | 128 | `src/` 全部 `.js` |
| 总行数 | 25,447 | 全部 `.js` 文件 |

**验证命令：**

```bash
# 统计全部源文件数和行数
find src -name "*.js" | wc -l           # 预期: 128
find src -name "*.js" -exec cat {} \; | wc -l  # 预期: ~25,447

# 按域统计
find src/core -name "*.js" -exec cat {} \; | wc -l          # 预期: 1,953
find src/communication -name "*.js" -exec cat {} \; | wc -l  # 预期: 1,281
find src/intelligence -name "*.js" -exec cat {} \; | wc -l   # 预期: 5,606
find src/orchestration -name "*.js" -exec cat {} \; | wc -l  # 预期: 6,889
find src/quality -name "*.js" -exec cat {} \; | wc -l        # 预期: 2,738
find src/observe -name "*.js" -exec cat {} \; | wc -l        # 预期: 1,651
find src/bridge -name "*.js" -exec cat {} \; | wc -l         # 预期: 4,526
```

---

[<- 返回 README](../../README.zh-CN.md) | [English](../en/architecture.md)
