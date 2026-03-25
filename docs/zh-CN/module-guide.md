# 模块指南（7 域架构）

**Claw-Swarm V9.2** | ~110 模块 | 7 域 + 双基座

Claw-Swarm V9 将所有源码组织为 **7 个域**，构建于**双基座**（SwarmField + DomainStore）之上。模块间交互完全通过**场中介耦合**实现：向 12 维 SwarmField 释放信号、从中感知信号。不存在跨域直接函数调用。

每个模块继承 `ModuleBase`，声明 `produces()` / `consumes()` 契约。启动时耦合验证器确保每个被释放的信号至少有一个消费者——设计上杜绝空转模块。

**约定：** 文件路径相对于 `src/`。行数为 V9 总计划的目标值。信号维度使用 `core/field/types.js` 中定义的 `DIM_*` 常量。

---

## 目录

- [core（12 文件，~1,953 行）](#core12-文件1953-行)
- [communication（8 文件，~1,281 行）](#communication8-文件1281-行)
- [intelligence（34 文件，~5,606 行）](#intelligence34-文件5606-行)
- [orchestration（24 文件，~6,889 行）](#orchestration24-文件6889-行)
- [quality（10 文件，~2,738 行）](#quality10-文件2738-行)
- [observe（13 文件，~1,651 行）](#observe13-文件1651-行)
- [bridge（24 文件，~4,526 行）](#bridge24-文件4526-行)
- [12 维信号场](#12-维信号场)
- [耦合机制](#耦合机制)
- [文件统计总览](#文件统计总览)

---

## 12 维信号场

所有模块间协调均通过 SwarmField 传递。每个维度有衰减率（lambda）控制信号生命周期。

| # | 维度 | Lambda | 语义 | 主要生产者 | 主要消费者 |
|---|------|--------|------|-----------|-----------|
| 1 | DIM_TRAIL | 0.008 | 路径/进展 | Agent完成步骤, PheromoneEngine | SpawnAdvisor, PromptBuilder |
| 2 | DIM_ALARM | 0.15 | 异常/警报 | AnomalyDetector, PheromoneEngine | SpawnAdvisor, ReplanEngine, EmotionalState |
| 3 | DIM_REPUTATION | 0.005 | 声誉 | ReputationCRDT, QualityController, ShapleyCredit | SpawnAdvisor, ContractNet, ResultSynthesizer |
| 4 | DIM_TASK | 0.01 | 任务/需求 | 用户请求, DAGEngine | SpawnAdvisor, ExecutionPlanner, IntentClassifier |
| 5 | DIM_KNOWLEDGE | 0.003 | 知识/发现 | Researcher, SemanticMemory, PheromoneEngine | PromptBuilder, HybridRetrieval, ScopeEstimator |
| 6 | DIM_COORDINATION | 0.02 | 协调/同步 | HierarchicalCoord, ChannelManager, PheromoneEngine | SpawnAdvisor, ResourceArbiter, DeadlineTracker |
| 7 | DIM_EMOTION | 0.1 | 情绪/挫折 | EmotionalState | SpawnAdvisor, PromptBuilder, EILayer |
| 8 | DIM_TRUST | 0.006 | 信任 | TrustDynamics | ResultSynthesizer, SpawnAdvisor, ContractNet |
| 9 | DIM_SNA | 0.004 | 协作网络 | SNAAnalyzer | ExecutionPlanner, SpawnAdvisor, HierarchicalCoord |
| 10 | DIM_LEARNING | 0.002 | 学习曲线 | EpisodeLearner | SpawnAdvisor, BudgetTracker, ScopeEstimator |
| 11 | DIM_CALIBRATION | 0.01 | 信号校准 | SignalCalibrator | FieldVector（权重调整） |
| 12 | DIM_SPECIES | 0.001 | 物种进化 | SpeciesEvolver | RoleRegistry, SpawnAdvisor |

---

## 耦合机制

V9 模块间仅通过以下四种方式交互：

1. **场中介耦合（Field-Mediated）** -- 模块向 SwarmField 释放信号，通过 `superpose()` 感知。多维、时间衰减。
2. **事件中介耦合（Event-Mediated）** -- 一次性通知，通过 EventBus（`publish`/`subscribe`）。27+ 事件主题。
3. **存储中介耦合（Store-Mediated）** -- 持久数据共享，通过 DomainStore（`put`/`query`）。
4. **依赖注入（Startup-time Wiring）** -- 启动时在 `swarm-core.js` 中组装。仅限域内模块互引。

**规则：** 跨域交互必须走机制 1-3。机制 4 仅限域内模块互引。

---

## core（12 文件，~1,953 行）

双基座：信号场、域存储、事件总线以及 `ModuleBase` 抽象类。所有其他域依赖 core。core 零外部依赖。

### 模块总览

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `core/module-base.js` | 60 | 所有 V9 模块的抽象基类。声明 `produces()`/`consumes()`/`publishes()`/`subscribes()` 契约。启动时耦合验证。 | -- | -- |

### field/ -- SwarmField 信号引擎

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `core/field/signal-store.js` | 382 | 信号 CRUD、作用域索引、emit/query/superpose/gc 入口。Forward Decay 时间评分的核心信号仓库。 | 全部 12 维（存储） | 全部 12 维（索引） |
| `core/field/forward-decay.js` | 108 | Forward Decay 编码/解码。`encode(strength, lambda, emittedAt)` 生成时间衰减分数；`isExpired()` 检查信号存活性。 | -- | -- |
| `core/field/field-vector.js` | 178 | 场向量叠加与灵敏度过滤。`superpose(scope, dims)` 将信号聚合为 12 维向量。`applyFilter(vector, sensitivity)` 应用角色特定感知权重。支持来自 DIM_CALIBRATION 的校准权重集成。 | -- | DIM_CALIBRATION |
| `core/field/gc-scheduler.js` | 156 | 时间分块 GC 调度器。定期清理过期信号，防止内存无限增长。可配置间隔和最大年龄阈值。 | -- | -- |
| `core/field/backends/memory.js` | 215 | 内存存储后端，实现 BackendInterface。操作：`put`/`scan`/`remove`/`count`/`clear`。单进程部署的默认后端。 | -- | -- |
| `core/field/types.js` | 133 | 12 个维度常量（`DIM_TRAIL` 到 `DIM_SPECIES`）、Signal/SignalFilter/FieldVector JSDoc 类型定义、衰减率表、`ALL_DIMENSIONS` 数组。 | -- | -- |

### store/ -- 域状态持久化

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `core/store/domain-store.js` | 287 | 键值域存储，支持批量操作。`put`/`get`/`query`/`delete`/`putBatch`/`snapshot`/`restore`。所有域用于持久化状态。 | -- | -- |
| `core/store/snapshot-manager.js` | 141 | 定期快照创建与压缩。支持域状态的时间点恢复。 | -- | -- |

### bus/ -- 事件总线

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `core/bus/event-bus.js` | 175 | 基于主题的发布/订阅，支持通配符。`publish(topic, payload)`/`subscribe(topic, handler)`/`unsubscribe()`。进程内事件投递。 | -- | -- |
| `core/bus/event-catalog.js` | 88 | 27+ 事件主题定义及工厂函数。提供 `EventTopics` 枚举和 `createEvent(topic, payload)` 工厂，类型安全的事件创建。 | -- | -- |

---

## communication（8 文件，~1,281 行）

代理间消息传递、MMAS 信息素协调、痕迹协作板和基于 Gossip 的知识扩散。提供去中心化间接协调的通信基础设施。

### 模块总览

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `communication/index.js` | ~134 | 域工厂。`createCommunicationSystem()` 组装所有通信子模块。 | -- | -- |

### channel/ -- 任务通信

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `communication/channel/task-channel.js` | 197 | Virtual Actor 模式的代理间双向通信。在任务作用域内实现 `join`/`leave`/`post`/`getMessages`/`getMembers`。 | -- | -- |
| `communication/channel/channel-manager.js` | 153 | 通道生命周期管理。创建/关闭通道，追踪每个 session 的活跃通道。 | DIM_COORDINATION | -- |

### pheromone/ -- MMAS 信息素引擎

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `communication/pheromone/pheromone-engine.js` | 311 | Min-Max Ant System 信息素管理。6 种信息素类型（trail/alarm/recruit/queen/dance/food）。ACO 轮盘选择（`acoSelect`），惰性衰减计算。桥接信息素类型到 SwarmField 维度。 | DIM_TASK_LOAD, DIM_QUALITY, DIM_COHERENCE, DIM_ERROR_RATE | -- |
| `communication/pheromone/response-matrix.js` | 149 | 待处理任务的自动升级压力梯度。未处理任务的信息素压力指数增长以吸引代理注意。 | -- | DIM_TASK |
| `communication/pheromone/type-registry.js` | 77 | 动态信息素类型注册，含每类型 MMAS 边界配置（tau_min/tau_max）。 | -- | -- |

### stigmergy/ -- 间接协调

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `communication/stigmergy/stigmergic-board.js` | 169 | 持久化全局公告板。代理通过修改共享环境间接协调，发布带 TTL 的公告，过期自动清理。 | -- | -- |
| `communication/stigmergy/gossip-protocol.js` | 91 | 知识扩散时间模型，渐进可见性。基于 fanout 的信息在代理间扩散。 | DIM_KNOWLEDGE | -- |

---

## intelligence（34 文件，~5,606 行）

个体代理智能：身份（角色、提示词、能力）、多层记忆、社交动力学（声誉、情绪、信任）、任务理解和产物管理。

### identity/ -- 代理身份与角色（8 文件）

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `intelligence/identity/soul-designer.js` | -- | 代理人格原型生成。将人格特质、行为准则和角色上下文编译为结构化 Prompt 片段。 | -- | DIM_EMOTION, DIM_TRUST |
| `intelligence/identity/prompt-builder.js` | 363 | 元数据驱动的动态 Prompt 组装。读取多个场维度注入上下文感知。集成 HybridRetrieval 结果、技能推荐和情绪线索。 | -- | DIM_TRAIL, DIM_KNOWLEDGE, DIM_EMOTION, DIM_CALIBRATION |
| `intelligence/identity/role-registry.js` | 260 | 10 个角色定义，含灵敏度向量和进化参数接收。角色定义每维度的感知系数。通过 DIM_SPECIES 接收 SpeciesEvolver 的动态更新。 | -- | DIM_SPECIES |
| `intelligence/identity/lifecycle-manager.js` | 253 | 代理生命周期 FSM：CREATED, INITIALIZING, IDLE, ACTIVE, BUSY, TERMINATING, TERMINATED。状态转换通过 EventBus 发布事件。 | -- | -- |
| `intelligence/identity/cross-provider.js` | 239 | 跨供应商协调，4 阶段入职和 5D 行为画像。管理由不同 LLM 供应商支撑的代理间协作。 | -- | DIM_TRUST |
| `intelligence/identity/capability-engine.js` | 230 | 技能清单与掌握度追踪。记录任务结果更新多维能力向量。接收自我反思更新。 | -- | DIM_LEARNING |
| `intelligence/identity/model-capability.js` | -- | LLM 模型能力映射。35+ 模型的 8D 能力向量（推理、编码、创造力、指令遵循、上下文长度、速度、成本、多语言）。 | -- | -- |
| `intelligence/identity/sensitivity-filter.js` | -- | 场向量灵敏度过滤。`applyFilter(rawVector, roleSensitivity)` 生成角色特定的 SwarmField 感知。 | -- | 全部维度（过滤） |

### memory/ -- 多层记忆（8 文件）

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `intelligence/memory/episodic-memory.js` | 255 | Ebbinghaus 遗忘曲线的经验存储。`R(t) = e^(-t/(lambda*importance))`，lambda=30天。多维检索评分。通过 DomainStore 持久化。 | -- | -- |
| `intelligence/memory/hybrid-retrieval.js` | 228 | 6 维记忆检索：语义相似度、时间新近性、重要性、相关性、奖励历史、新近度。 | -- | DIM_KNOWLEDGE |
| `intelligence/memory/embedding-engine.js` | 222 | 双模式文本嵌入：本地 ONNX/Transformers.js (384D) 或外部 API (1536D)。网络故障时自动降级到本地。 | -- | -- |
| `intelligence/memory/semantic-memory.js` | 215 | 语义知识图谱：BFS 遍历、Dijkstra 最短路径、概念合并、扩散激活。为 Prompt 注入生成上下文片段。 | DIM_KNOWLEDGE | -- |
| `intelligence/memory/vector-index.js` | 219 | HNSW 近似最近邻搜索，含线性扫描回退。新嵌入到达时动态更新索引。 | -- | -- |
| `intelligence/memory/context-engine.js` | -- | 上下文管理与 Token 预算裁剪。聚合工作记忆、情景记忆和语义记忆为统一上下文载荷。 | -- | -- |
| `intelligence/memory/user-profile.js` | 180 | 用户技能画像与偏好学习。追踪交互模式以适应代理行为。 | -- | DIM_LEARNING |
| `intelligence/memory/working-memory.js` | -- | 三缓冲区工作记忆：Focus (5 项)、Context (15 项)、ScratchPad (30 项)。激活衰减与级联溢出：Focus -> Context -> ScratchPad -> 丢弃。 | -- | -- |

### social/ -- 社交动力学（8 文件）

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `intelligence/social/episode-learner.js` | -- | 从完成的任务中提取可复用知识模式。向场中释放学习曲线信号。 | DIM_LEARNING | DIM_TRAIL |
| `intelligence/social/reputation-crdt.js` | -- | PN-Counter CRDT 无冲突声誉计数。跨分布式代理合并声誉更新。 | DIM_REPUTATION | DIM_TRAIL, DIM_ALARM |
| `intelligence/social/cultural-friction.js` | -- | 跨模型文化摩擦估计。量化不同 LLM 供应商间的行为不兼容性。融入跨供应商协作决策。 | -- | DIM_TRUST |
| `intelligence/social/self-reflection.js` | -- | 任务后自我评估。结果输入 CapabilityEngine 和 ReputationCRDT 进行持续校准。 | -- | DIM_TRAIL |
| `intelligence/social/sna-analyzer.js` | -- | 社会网络分析：度中心性、介数中心性、聚类系数、PageRank。生成协作拓扑信号。 | DIM_SNA | DIM_COORDINATION |
| `intelligence/social/emotional-state.js` | -- | 6D 情绪状态模型（挫折、信心、好奇、抵触、开放、信任）。EMA 追踪，自然衰减至基线。 | DIM_EMOTION | DIM_ALARM, DIM_TRAIL |
| `intelligence/social/trust-dynamics.js` | -- | 基于交互历史、成功率和行为一致性的信任分计算。 | DIM_TRUST | DIM_REPUTATION, DIM_SNA |
| `intelligence/social/ei-layer.js` | -- | 情商层。解读情绪状态向量，为 PromptBuilder 和 TaskPresenter 推荐行为调整。 | -- | DIM_EMOTION |

### artifacts/ -- 执行产物（3 文件）

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `intelligence/artifacts/execution-journal.js` | 219 | 执行日志与决策记录。捕获每个重要决策的上下文、备选方案和结果。 | -- | DIM_TRAIL |
| `intelligence/artifacts/artifact-registry.js` | -- | 产物注册、分类与索引。追踪代理产出的所有输出（代码、文档、分析）。 | -- | -- |
| `intelligence/artifacts/workspace-organizer.js` | -- | 工作目录结构建议与创建。将代理输出组织为连贯的文件结构。 | -- | DIM_TASK |

### understanding/ -- 任务理解（3 文件）

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `intelligence/understanding/intent-classifier.js` | -- | 意图分类，包含 8 个 PHASE_TEMPLATES（bug_fix、new_feature、refactor、optimize、explore、analyze、content、question）。模板支持并行 fork+merge 分支（如 new_feature fork 到 [backend, frontend] 后在 review 合并）。将任务路由到合适的规划策略。 | -- | DIM_TASK |
| `intelligence/understanding/requirement-clarifier.js` | -- | 需求澄清对话。检测歧义并生成针对性问题以消除歧义。 | -- | DIM_TASK |
| `intelligence/understanding/scope-estimator.js` | -- | 范围评估：影响文件数、复杂度、风险等级。输入到预算和调度决策中。 | -- | DIM_TASK, DIM_KNOWLEDGE, DIM_LEARNING |

---

## orchestration（24 文件，~6,889 行）

任务协调、DAG 规划、调度、资源管理、种群进化和自适应机制。将个体代理能力转化为协调的蜂群行为。

### planning/ -- DAG 与执行规划（6 文件）

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `orchestration/planning/dag-engine.js` | 669 | DAG 构建、拓扑排序、状态机（NODE_STATE: PENDING → SPAWNING → ASSIGNED → EXECUTING → COMPLETED / DEAD_LETTER）、依赖解析、work-stealing、死信队列、拍卖集成。暴露 `spawnNode(dagId, nodeId)` 用于 SPAWNING 状态转换。核心执行引擎。 | DIM_TASK | DIM_TRAIL, DIM_ALARM |
| `orchestration/planning/execution-planner.js` | 427 | MoE Top-k 规划。基于关键词、能力和历史的专家评分。将复杂任务分解为阶段序列。 | -- | DIM_TASK, DIM_SNA, DIM_KNOWLEDGE |
| `orchestration/planning/result-synthesizer.js` | 421 | 多角色输出合成：Jaccard 去重、质量聚合、Trust 加权合并。 | -- | DIM_REPUTATION, DIM_TRUST |
| `orchestration/planning/critical-path.js` | 325 | 关键路径分析：前向传递（ES/EF）、后向传递（LS/LF）、松弛量计算。输出到 DeadlineTracker。 | -- | DIM_TASK |
| `orchestration/planning/replan-engine.js` | 317 | 当告警密度超阈值时触发动态重规划。指数退避防止抖动。由 FailureAnalyzer 输出驱动。 | -- | DIM_ALARM, DIM_TRAIL |
| `orchestration/planning/zone-manager.js` | -- | 代码区域管理（test/config/core/ui）。将相关文件分组以控制代理分配范围。 | -- | DIM_TASK |

### scheduling/ -- 代理调度（6 文件）

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `orchestration/scheduling/spawn-advisor.js` | 430 | 12 维场向量驱动的孵化决策。通过 `superpose()` 读取完整场向量，决定角色选择、模型层级（fast/balanced/strong/reasoning）和并发度。V9 中场耦合度最高的模块。 | -- | 全部 12 维 |
| `orchestration/scheduling/resource-arbiter.js` | 339 | 文件锁定、API 限流和并发代理共享资源访问的冲突解决。 | -- | DIM_COORDINATION |
| `orchestration/scheduling/hierarchical-coord.js` | 236 | 父子代理层级协调，可配置深度限制和并发控制。递归任务分解。 | DIM_COORDINATION | DIM_TASK, DIM_SNA |
| `orchestration/scheduling/contract-net.js` | -- | FIPA 合同网协议：CFP/Bid/Award 谈判。出价评分：`capability * trust * cost`。 | -- | DIM_REPUTATION, DIM_TRUST |
| `orchestration/scheduling/role-manager.js` | -- | 角色生命周期管理与动态注册。来自 SpeciesEvolver 发现的运行时角色创建。 | -- | DIM_SPECIES |
| `orchestration/scheduling/deadline-tracker.js` | -- | 任务级 SLA 执行和阶段时间预算。监控关键路径进展，进度滑坡时发出预警。 | -- | DIM_COORDINATION, DIM_TASK |

### adaptation/ -- 自适应机制（11 文件）

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `orchestration/adaptation/species-evolver.js` | 472 | 开放式种群进化。Lotka-Volterra 竞争、GEP 锦标赛选择、物种生命周期：提议 -> 试用（30天，>70%成功率）-> 晋升或淘汰。活跃上限：10 物种。 | DIM_SPECIES | DIM_REPUTATION, DIM_TRAIL |
| `orchestration/adaptation/role-discovery.js` | 341 | 基于 k-means++ 的数据驱动角色发现，聚类代理能力向量。识别未显式定义的涌现角色模式。注册新角色到 RoleRegistry。 | -- | DIM_SNA, DIM_TRAIL |
| `orchestration/adaptation/budget-tracker.js` | 332 | 多维预算追踪：token、时间、代理数、存储、成本。硬限制和可配置预警阈值。 | -- | DIM_LEARNING, DIM_TASK |
| `orchestration/adaptation/budget-forecaster.js` | 270 | 基于线性回归的预算消耗预测。预测每个预算维度的耗尽时间并触发预防性预警。 | -- | DIM_TASK |
| `orchestration/adaptation/signal-calibrator.js` | 248 | 基于互信息的场感知权重自动校准。权重边界 [0.03, 0.40]。元级优化：校准场本身。 | DIM_CALIBRATION | 全部 12 维 |
| `orchestration/adaptation/shapley-credit.js` | 246 | 蒙特卡洛 Shapley 值计算（100 次采样），DAG 完成后的公平贡献归因。 | DIM_REPUTATION | DIM_TRAIL |
| `orchestration/adaptation/response-threshold.js` | -- | 固定响应阈值模型 + PI 控制器，维持目标活动率。代理基于个人阈值与环境刺激独立决策任务激活。 | -- | DIM_TASK, DIM_ALARM |
| `orchestration/adaptation/skill-governor.js` | -- | 技能推荐引擎。追踪技能使用频率、成功率和衰减。生成由 PromptBuilder 注入的推荐。 | -- | DIM_LEARNING, DIM_TRAIL |
| `orchestration/adaptation/global-modulator.js` | -- | 蜂群全局模式控制：EXPLORE、EXPLOIT、RELIABLE、URGENT。告警密度驱动模式切换。模式影响场感知权重。 | -- | DIM_ALARM, DIM_TRAIL |
| `orchestration/adaptation/dual-process-router.js` | -- | Kahneman 系统 1/2 决策路由。系统 1（DIRECT，阈值 0.55）：疫苗匹配 + 熔断器 CLOSED + 高亲和。系统 2（PREPLAN，阈值 0.50）：新任务类型 + HALF_OPEN + 告警密度。 | -- | DIM_ALARM, DIM_TRAIL |
| `orchestration/adaptation/index.js` | -- | 域工厂。组装所有自适应子模块。 | -- | -- |

---

## quality（10 文件，~2,738 行）

质量门、失败分析、异常检测、合规监控和韧性机制。确保输出质量和系统健壮性。

### gate/ -- 质量门（2 文件）

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `quality/gate/quality-controller.js` | 331 | 多标准质量评估：自审、同行审核、主审。每个质量维度可配置阈值。 | DIM_REPUTATION | DIM_TRAIL, DIM_TRUST |
| `quality/gate/evidence-gate.js` | 314 | 三层证据纪律：PRIMARY（直接观察）、CORROBORATION（二次确认）、INFERENCE（推导推理）。硬/软门 + 申诉机制。 | -- | DIM_TRAIL |

### analysis/ -- 失败分析（3 文件）

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `quality/analysis/failure-analyzer.js` | 257 | 5 类失败分类：INPUT_ERROR、TIMEOUT、LLM_REFUSAL、PERMISSION_DENIED、RESOURCE_EXHAUSTED。输出驱动 ReplanEngine。 | -- | DIM_ALARM |
| `quality/analysis/anomaly-detector.js` | 244 | 基于负选择原则的行为基线追踪。检测代理行为偏离已建立模式。 | DIM_ALARM | DIM_TRAIL |
| `quality/analysis/compliance-monitor.js` | 219 | 合规检测与升级。监控代理输出的策略违规并注入纠正性提示。 | -- | DIM_ALARM, DIM_REPUTATION |

### resilience/ -- 容错（4 文件）

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `quality/resilience/failure-vaccination.js` | 316 | 免疫系统模式：失败模式记忆与修复策略（疫苗）存储。疫苗通过 DomainStore 持久化。双进程路由器检查疫苗匹配用于系统 1 快速路径。 | -- | DIM_ALARM |
| `quality/resilience/tool-resilience.js` | 312 | 执行前韧性：AJV JSON Schema 参数预验证、熔断器检查、失败时重试 Prompt 注入。 | -- | -- |
| `quality/resilience/circuit-breaker.js` | 259 | 每工具 3 状态熔断器（CLOSED, OPEN, HALF_OPEN）。追踪成功/失败率；超阈值时断开；冷却后半开。状态通过 DomainStore 持久化。 | -- | -- |
| `quality/resilience/pipeline-breaker.js` | 262 | 每 DAG 超时熔断。阶段超时触发级联中止。死信队列集成。 | -- | DIM_TASK |

---

## observe（13 文件，~1,651 行）

实时监控、健康检查、指标聚合和控制台 SPA。只读观测原则：此域绝不修改蜂群行为。

### 后端服务

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `observe/dashboard/dashboard-service.js` | 662 | Fastify REST API 服务器（端口 19100）。58 个 REST 端点覆盖代理、任务、信息素、声誉、物种、DAG、健康、追踪、拓扑、亲和、死信、治理、指标、bridge 与控制台诊断。提供控制台 SPA 静态文件和 bridge status 端点。 | -- | -- |
| `observe/metrics/metrics-collector.js` | 249 | RED 指标聚合：Rate（事件/秒）、Error（失败率）、Duration（延迟百分位）。订阅所有域事件，计算滚动窗口。 | -- | 全部维度（只读） |
| `observe/health/trace-collector.js` | 227 | 分布式追踪 span 收集。桥接 EventBus 追踪事件到持久存储。父子 span 关系支持端到端任务追踪。 | -- | -- |
| `observe/health/health-checker.js` | 185 | 多维健康评分（0-100），事件驱动更新与自适应轮询回退。维度：场连通性、代理响应性、总线吞吐量、内存使用、错误率。 | -- | DIM_ALARM |
| `observe/broadcast/state-broadcaster.js` | 192 | Legacy SSE 事件流，仅用于诊断和向后兼容。100ms 批量发送。订阅所有域事件主题；主控制台路径已切换到 WebSocket bridge。支持 `setVerbosity(level)` 控制事件过滤（0=仅关键、1=默认、2=详细）。 | -- | -- |

### 控制台 SPA（前端资产）

React 18 应用，从 `observe/dashboard/console/` 提供服务。Zustand 状态管理，通过 `ConsoleDataBridge` 在 19101 端口进行 WebSocket 实时更新，10 个可视化视图。Vite 构建。

| 视图 | 功能 |
|------|------|
| **Hive**（蜂巢） | 六角形代理地图：实时状态、能力雷达图、健康指示器 |
| **Pipeline**（管线） | DAG 可视化：任务依赖图、执行进度、关键路径高亮 |
| **Cognition**（认知） | 记忆/认知状态：工作记忆、情景记忆时间线、情绪向量雷达 |
| **Ecology**（生态） | 种群动力学：Lotka-Volterra 曲线、物种竞争、信息素粒子动画 |
| **Network**（网络） | 社会网络图：代理通信拓扑、中心性热力图 |
| **Control**（控制） | 运维面板：全局调制器控制、熔断器状态、预算仪表、手动干预 |
| **Field** | 12 维信号场概览与原始场压力 |
| **System** | 运行时架构、工作流证据与健康遥测 |
| **Adaptation** | Explore/Exploit 平衡、校准与物种演化 |
| **Communication** | 活跃通道、信息素流动与协调流量 |

附加组件：CommandPalette (Ctrl+K)、SettingsDrawer、EventTimeline、Inspector、Toast 通知。

---

## bridge（24 文件，~4,526 行）

与 OpenClaw 插件系统的唯一集成点。所有其他域与框架无关。bridge 将 OpenClaw 的 Hook、Tool 和 Session 转换为域级别操作。

### tools/ -- OpenClaw 工具（10 文件）

4 个公开工具通过 OpenClaw Tool API 暴露，加 6 个内部工具用于代理间协调。

**公开工具：**

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `bridge/tools/run-tool.js` | 248 | 蜂群任务入口（`swarm_run`）。任务分解、通过 SpawnClient 生成子代理、进度监控、cancel/resume。 | DIM_TASK | -- |
| `bridge/tools/query-tool.js` | 320 | 状态查询工具（`swarm_query`）。10 个子命令：agent、task、pheromone、metric、species、plan、zone、reputation、memory、health。只读。 | -- | -- |
| `bridge/tools/plan-tool.js` | 320 | 执行计划工具（`swarm_plan`）。查看/修改当前 DAG，重排阶段，添加依赖。 | -- | DIM_TASK |
| `bridge/tools/gate-tool.js` | 261 | 质量门工具（`swarm_gate`）。触发多级质量审查。 | -- | DIM_REPUTATION |

**内部工具：**

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `bridge/tools/zone-tool.js` | 255 | 区域管理工具（`swarm_zone`）。Zone CRUD、成员分配、领导者追踪。 | -- | -- |
| `bridge/tools/pheromone-tool.js` | 242 | 信息素操作（`swarm_pheromone`）。信息素 deposit/query。 | DIM_TRAIL | -- |
| `bridge/tools/memory-tool.js` | 238 | 记忆操作（`swarm_memory`）。读写代理三层记忆。 | -- | -- |
| `bridge/tools/checkpoint-tool.js` | 232 | 检查点（`swarm_checkpoint`）。Human-in-the-loop STOP 指令机制，高风险操作审批。 | -- | -- |
| `bridge/tools/spawn-tool.js` | 186 | 内部 spawn 工具（`swarm_spawn`）。直接子代理创建。 | -- | -- |
| `bridge/tools/dispatch-tool.js` | -- | 直接派遣（`swarm_dispatch`）。绕过 DAG，指定代理/角色执行。 | -- | -- |

### hooks/ -- Hook 适配器

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `bridge/hooks/hook-adapter.js` | -- | 16 个 OpenClaw Hook -> 域模块事件转发。将 Hook 生命周期事件转换为 EventBus 发布和场信号释放。 | -- | -- |

### session/ -- 会话管理

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `bridge/session/session-bridge.js` | -- | 会话生命周期到场作用域映射。将 OpenClaw Session 映射到 SwarmField scope。 | -- | -- |
| `bridge/session/spawn-client.js` | 165 | DirectSpawnClient。绕过插件 API，通过 Gateway WebSocket RPC 创建真实子代理。两阶段异步：`swarm_run` 立即返回 `{ status: 'dispatched' }`，后台 `onEnded` 触发结果注入。 | -- | -- |
| `bridge/session/model-fallback.js` | -- | 429/503 错误时的模型切换逻辑。自动层级降级与重试。 | -- | -- |

### reliability/ -- 可靠性层（5 文件）

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `bridge/reliability/inject-retry.js` | -- | `injectWithRetry()` 3 次指数退避重试，用于 chat 注入失败场景。 | -- | -- |
| `bridge/reliability/readiness-guard.js` | -- | 就绪前置检查。所有域模块报告就绪前阻塞操作。 | -- | -- |
| `bridge/reliability/tool-guard.js` | -- | 工具调用拦截与验证层。 | -- | -- |
| `bridge/reliability/compliance-hook.js` | -- | 合规升级钩子。检测不合规代理行为并注入纠正性系统提示。 | -- | DIM_ALARM |
| `bridge/reliability/ipc-fallback.js` | -- | IPC 故障的降级缓存。核心进程不可达时提供缓存响应。 | -- | -- |

### interaction/ -- 用户交互（3 文件）

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `bridge/interaction/task-presenter.js` | 295 | 结果格式化与修改摘要生成。产出面向用户的任务完成报告。 | -- | DIM_TRAIL |
| `bridge/interaction/progress-tracker.js` | 160 | 子代理步骤追踪与节流进度推送。通过 bridge/事件流提供实时进度证据。 | -- | DIM_TRAIL |
| `bridge/interaction/user-notifier.js` | 149 | 重要事件主动通知（失败、完成、检查点）。 | -- | DIM_ALARM |

### connectors/ -- 外部集成

| 文件 | 行数 | 职责 | produces | consumes |
|------|------|------|----------|----------|
| `bridge/connectors/mcp-registry.js` | -- | MCP 工具发现与注册。发现外部 MCP 服务器并注册其工具。 | -- | -- |

---

## 耦合拓扑

```
                    ┌─────────────────────────────────────┐
                    │           SwarmField (12D)           │
                    │                                     │
                    │  TRAIL   ALARM    REPUTATION  TASK  │
                    │  KNOWLEDGE  COORDINATION  EMOTION   │
                    │  TRUST   SNA   LEARNING  CALIBRATION│
                    │  SPECIES                            │
                    └──────────────┬──────────────────────┘
                                   │
                    所有模块浸泡在场中
                    释放信号 ↑↓ 感知信号
```

**域级别依赖 DAG：**

```
core（双基座）
├──> communication
│    ├──> intelligence/memory + identity (R2)
│    │    ├──> intelligence/social + understanding + artifacts (R3)
│    │    │    └──> orchestration/adaptation (R5)
│    │    └──> orchestration/planning + scheduling (R4)
│    │         ├──> orchestration/adaptation (R5)
│    │         └──> quality (R6)
│    └──> orchestration/planning（部分并行：dag-engine 仅需 core+comm）
├──> quality（部分并行：tool-resilience 仅需 core）
└──> observe（部分并行：metrics 仅需 core/bus）
                    │
              R5 + R6 + R7 全部完成
                    │
                   bridge（需要所有域）
```

---

## 文件统计总览

| 域 | 文件数 | 行数 | 关键特征 |
|----|--------|------|---------|
| core | 12 | ~1,953 | 信号场 (12D)、DomainStore、EventBus (27 主题)、ModuleBase |
| communication | 8 | ~1,281 | MMAS 信息素 (6 类型, ACO)、任务通道、Gossip、痕迹协作板 |
| intelligence | 34 | ~5,606 | 三层记忆、10 角色、6D 情绪、CRDT 声誉、SNA、信任 |
| orchestration | 24 | ~6,889 | DAG 引擎、合同网、SpawnAdvisor (12D)、Lotka-Volterra、GEP、Shapley |
| quality | 10 | ~2,738 | 质量门、熔断器、失败疫苗、异常检测 |
| observe | 13 | ~1,651 | 58 REST 端点、WS bridge + legacy SSE、React 18 SPA (10 视图)、健康检查 |
| bridge | 24 | ~4,526 | 10 工具 (4 公开 + 6 内部)、16 Hook、Session 桥接、7 层可靠性 |
| **总计** | **~125** | **~24,644** | 零空转模块、零 Feature Flag、12 维场中介耦合 |

---

[返回 README](../../README.zh-CN.md) | [English](../en/module-guide.md)
