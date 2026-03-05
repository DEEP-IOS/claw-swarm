<p align="center">
  <img src="docs/assets/console-demo.gif" alt="Claw-Swarm Console" width="90%">
</p>

<h1 align="center">Claw-Swarm</h1>

<p align="center">
  Field-Mediated Swarm Intelligence for Multi-Agent LLM Coordination<br/>
  面向多代理 LLM 协作的场中介蜂群智能系统
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-9.0.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/tests-1365_passing-green" alt="Tests">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License">
  <img src="https://img.shields.io/badge/Node.js-≥22-green" alt="Node">
  <img src="https://img.shields.io/badge/domains-7-orange" alt="Domains">
  <img src="https://img.shields.io/badge/models-35+-purple" alt="Models">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#documentation">Docs</a> ·
  <a href="#llm-docs">LLM Docs</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

---

## Origin Story · 起源故事

The existing multi-agent frameworks share a fatal assumption: **coordination is a messaging problem**. Build a message bus, add some routing, and agents will collaborate. They don't. In production, they collide, forget, cascade-fail, and degrade into expensive echo chambers.

现有多代理框架共享一个致命假设：**协调是一个消息传递问题**。搭建消息总线、加上路由，代理就会协作。事实是：它们不会。在生产环境中，它们碰撞、遗忘、级联失败，最终退化为昂贵的回音室。

Claw-Swarm was born from a different observation: **nature solved coordination billions of years ago**. Ant colonies with 250-neuron brains outperform human logistics. Immune systems classify threats without central command. Neural circuits self-organize through reaction-diffusion dynamics.

Claw-Swarm 诞生于一个不同的观察：**大自然在数十亿年前就解决了协调问题**。拥有 250 个神经元的蚂蚁群落在物流效率上超越人类。免疫系统无需中央指挥就能分类威胁。神经回路通过反应-扩散动力学自组织。

This led to a 14-discipline cross-research program spanning entomology, immunology, cognitive science, graph theory, evolutionary biology, network sociology, information theory, control theory, game theory, morphogenesis, organizational psychology, cultural anthropology, affective computing, and computational ecology — each discipline contributing a concrete algorithm, not metaphors, to the codebase.

这催生了一个横跨 14 个学科的交叉研究计划——昆虫学、免疫学、认知科学、图论、进化生物学、网络社会学、信息论、控制论、博弈论、形态发生学、组织心理学、文化人类学、情感计算和计算生态学——每个学科贡献了一个具体的算法，而非隐喻。

The result: **V9.0 introduces a Field-Mediated Coupling Architecture** — seven autonomous domains connected not by point-to-point wiring, but by a shared 12-dimensional signal field. Agents leave traces in this field like ants depositing pheromones; decisions emerge from the superposition of all signals, not from any central controller. No idle modules. No feature flags. Every line of code runs in production.

成果：**V9.0 引入了场中介耦合架构**——七个自治域并非通过点对点连线相连，而是通过共享的 12 维信号场沟通。代理在场中留下痕迹，如同蚂蚁沉积信息素；决策从所有信号的叠加中涌现，而非来自某个中心控制器。没有空转模块。没有功能开关。每一行代码都在生产环境运行。

---

## The Problem · 真实痛点

Coordinating multiple LLM agents in production hits **six walls**:

在生产环境中协调多个 LLM 代理会撞上**六面墙**：

| Wall · 痛点 | What breaks · 崩溃现象 | How Claw-Swarm fixes it · 解法 |
|---|---|---|
| **Blind collaboration** · 协作盲区 | Agents duplicate work, no shared awareness · 代理重复劳动，彼此毫无感知 | 12-dim signal field + pheromone trails · 12 维信号场 + 信息素踪迹 |
| **Memory loss** · 记忆断裂 | Context resets erase all knowledge · 上下文重置后知识全部丢失 | 3-tier hybrid memory with Ebbinghaus decay · 三层混合记忆 + 遗忘曲线 |
| **Cascading failures** · 级联故障 | One tool timeout kills the pipeline · 单个工具超时拖垮整条流水线 | 6-layer resilience: retry → breaker → vaccine → model fallback → replan → pipeline break · 六层容错 |
| **Manual routing** · 手动路由 | Every task must be hand-assigned · 每项任务都要人工分配 | DAG decomposition + field-aware spawn advisor · DAG 分解 + 场感知孵化建议 |
| **Zero observability** · 零可观测性 | No runtime insight into agent behavior · 运行时完全看不到代理行为 | Dashboard (57+ REST) + SSE streaming + health checks · 仪表盘 + SSE 实时流 + 健康检查 |
| **Idle code** · 空转代码 | Feature-flagged modules never activate · 功能开关后的模块从不激活 | Zero flags: all modules unconditionally active, field-mediated coupling verification · 零开关：所有模块无条件激活，场耦合验证 |

---

## Architecture Overview · 架构一览

V9.0 replaces the 7-layer linear hierarchy (L0–L6) with **7 autonomous domains** connected through a **dual foundation** (SignalField + DomainStore + EventBus). Modules interact through the signal field, not through direct imports.

V9.0 将 7 层线性层级（L0–L6）替换为**7 个自治域**，通过**双基座**（信号场 + 域存储 + 事件总线）连接。模块通过信号场交互，而非直接导入。

```
Domain · 域          Files · 文件   Lines · 行数   Responsibility · 职责
─────────────────   ────────────   ──────────    ────────────────────────────
 core                   12          1,953        SignalField, DomainStore, EventBus, ModuleBase
 核心                                             信号场、域存储、事件总线、模块基类
 communication           8          1,281        Pheromones (MMAS), task channels, stigmergic board
 通信                                             信息素引擎、任务通道、痕迹协作板
 intelligence           34          5,606        Memory, identity, social, artifacts, understanding
 智能                                             记忆、身份、社交、产物、理解
 orchestration          24          6,889        DAG planner, spawn advisor, adaptation, scheduling
 编排                                             DAG 规划、孵化建议、自适应、调度
 quality                10          2,738        Evidence gate, circuit breaker, failure vaccination
 质量                                             证据门控、熔断器、失败疫苗
 observe                13          1,651        Dashboard (57+ REST), metrics, health, SSE broadcast
 观测                                             仪表盘、指标、健康检查、SSE 广播
 bridge                 24          4,526        10 tools, 16 hooks, session, model fallback
 桥接                                             10 工具、16 钩子、会话、模型降级
─────────────────   ────────────   ──────────
 Total · 合计          121         25,447
```

**Process Model · 进程模型:**

```
  OpenClaw Gateway (Node.js)
  ┌────────────────────────────────────────────────────────────────────┐
  │  index.js (plugin adapter)                                         │
  │  ├── gateway_start hook → activateV9(app)                         │
  │  │   └── SwarmCoreV9.start()                                      │
  │  │       ├── SignalField (12-dim, forward-decay, GC scheduler)    │
  │  │       ├── DomainStore (in-memory + JSON snapshots)             │
  │  │       ├── EventBus (pub/sub, 27+ event topics)                 │
  │  │       └── 5 domain factories (comm/intel/orch/qual/observe)    │
  │  ├── HookAdapter: 16 hooks registered on app                      │
  │  └── ToolRegistry: 10 tools registered on app                     │
  │                                                                    │
  │  DashboardService :19100 (in-process HTTP server)                  │
  └────────────────────────────────────────────────────────────────────┘
```

V9 runs entirely in-process within the OpenClaw Gateway. No `child_process.fork()`. No IPC timeout. The `SwarmCoreV9` constructor assembles all domains through dynamic imports with graceful fallback.

V9 完全在 OpenClaw Gateway 进程内运行。不再有 `child_process.fork()`。没有 IPC 超时。`SwarmCoreV9` 构造器通过动态导入组装所有域，支持优雅降级。

**Source · 源码:** [`src/swarm-core-v9.js`](src/swarm-core-v9.js) (475 lines), [`src/index.js`](src/index.js) (205 lines)

> [Architecture (EN)](docs/en/architecture.md) · [架构设计 (中文)](docs/zh-CN/architecture.md)

---

## 12-Dimensional Signal Field · 12 维信号场

The signal field is the **shared medium** through which all domains communicate. Every coordination event is a signal carrying a scope, a dimension, and an intensity that decays over time via forward-decay encoding.

信号场是所有域通信的**共享介质**。每个协调事件都是一个信号，携带作用域、维度和强度，并通过前向衰减编码随时间衰减。

| # | Dimension · 维度 | Biological Analog · 生物学类比 | Decay Rate λ | Meaning · 含义 |
|---|---|---|---|---|
| 1 | `task_load` | Worker ant trail density · 工蚁踪迹密度 | 0.02 | Task queue pressure across the swarm · 蜂群任务队列压力 |
| 2 | `error_rate` | Alarm pheromone · 警报信息素 | 0.10 | Rolling error frequency · 滚动错误频率 |
| 3 | `latency` | Neural conduction delay · 神经传导延迟 | 0.05 | Response time distribution · 响应时间分布 |
| 4 | `throughput` | Colony metabolic rate · 群落代谢率 | 0.03 | Messages processed per unit time · 单位时间处理消息数 |
| 5 | `cost` | Foraging energy cost · 觅食能量成本 | 0.02 | Token and API cost accumulation · Token 与 API 成本累积 |
| 6 | `quality` | Nectar quality gradient · 花蜜质量梯度 | 0.03 | Output quality scores · 输出质量评分 |
| 7 | `coherence` | Queen pheromone · 蜂后信息素 | 0.04 | Inter-agent goal alignment · 代理间目标对齐度 |
| 8 | `trust` | Mutualistic grooming · 互惠梳理 | 0.01 | Peer trust and reputation · 同伴信任与声誉 |
| 9 | `novelty` | Waggle dance intensity · 摇摆舞强度 | 0.06 | Divergence from known patterns · 偏离已知模式程度 |
| 10 | `urgency` | Alarm response cascade · 警报响应级联 | 0.08 | Time-sensitivity pressure · 时间敏感压力 |
| 11 | `complexity` | Cognitive load indicator · 认知负载指示 | 0.04 | Estimated task difficulty · 估算任务难度 |
| 12 | `resource_pressure` | Nest capacity signal · 巢穴容量信号 | 0.03 | Memory, context, budget saturation · 内存、上下文、预算饱和度 |

All signals decay via **forward-decay encoding**: `score = base × e^(λ × emitTime)`. Query-time evaluation ensures O(1) emission and O(n) query. Emergency GC triggers when signal count exceeds 100,000.

所有信号通过**前向衰减编码**衰减：`score = base × e^(λ × emitTime)`。查询时求值确保 O(1) 发射和 O(n) 查询。信号数超过 100,000 时触发紧急 GC。

**Source · 源码:** [`src/core/field/signal-store.js`](src/core/field/signal-store.js) (382 lines), [`src/core/field/forward-decay.js`](src/core/field/forward-decay.js) (108 lines)

> [Signal Field Deep Dive (EN)](docs/en/signal-mesh.md) · [信号场详解 (中文)](docs/zh-CN/signal-mesh.md)

---

## How It Works · 系统如何运作

A task flows through six emergent phases — not a hardcoded pipeline, but stages that **naturally arise from signal-field dynamics**.

一个任务流经六个涌现阶段——不是硬编码的流水线，而是从**信号场动力学中自然涌现**的阶段。

### Phase 1: Intent Recognition · 意图识别

The system classifies incoming messages into **fast-think (System 1)** or **slow-think (System 2)** paths. Simple questions get direct answers. Complex tasks ("refactor the login module") trigger the full swarm pipeline. The routing threshold adapts: if fast-think answers keep succeeding, the threshold rises; if they fail, it drops.

系统将传入消息分为**快思考（System 1）**或**慢思考（System 2）**路径。简单问题直接回答。复杂任务（"重构登录模块"）触发完整蜂群流水线。路由阈值自适应：快思考连续成功则阈值上升；频繁翻车则下降。

**Source · 源码:** [`src/orchestration/adaptation/dual-process-router.js`](src/orchestration/adaptation/dual-process-router.js)

### Phase 2: Field-Aware Spawn Decision · 场感知孵化决策

For slow-think tasks, the spawn advisor simultaneously **sniffs all 12 dimensions** of the signal field:

对于慢思考任务，孵化建议器同时**嗅探信号场的全部 12 个维度**：

- Knowledge dimension weak → "Not enough info yet, send a researcher first" · 知识维度弱 → "信息不足，先派侦察兵"
- Alarm dimension active → "Risk area, assign a stronger model" · 警报维度亮 → "风险区域，分配更强模型"
- Reputation dimension shows a role excelled at similar tasks → prioritize that role · 声誉维度显示某角色在类似任务中表现优秀 → 优先选用

The decision is not an if-else chain. It's a **weighted superposition** of 12 signals.

决策不是 if-else 链。它是 12 个信号的**加权叠加**。

**Source · 源码:** [`src/orchestration/scheduling/spawn-advisor.js`](src/orchestration/scheduling/spawn-advisor.js) (430 lines)

### Phase 3: Passive Communication · 被动通讯

Agents don't send messages to each other. They leave **pheromone traces** in the signal field as they work. A researcher reading `auth/login.js` deposits a path signal on that scope. A later implementer senses the strong trail and skips that file, focusing on unvisited areas instead.

代理之间不互发消息。它们在工作时于信号场中留下**信息素踪迹**。侦察兵阅读 `auth/login.js` 时在该作用域上沉积路径信号。后续的实现者感知到浓烈的踪迹，跳过该文件，专注于未访问的区域。

Six pheromone types: **trail** (path taken), **alarm** (danger area), **recruit** (need help), **queen** (strategy shift), **dance** (high-value discovery), **food** (quality output).

六种信息素类型：**踪迹**（走过的路径）、**警报**（危险区域）、**招募**（需要帮助）、**女王**（策略切换）、**舞蹈**（高价值发现）、**食物**（优质产出）。

**Source · 源码:** [`src/communication/pheromone/pheromone-engine.js`](src/communication/pheromone/pheromone-engine.js) (311 lines)

### Phase 4: Evidence-Gated Review · 证据门控审查

Every reviewer judgment requires **evidence**. Direct code quotes carry the highest weight; speculative opinions carry the lowest. Only judgments above the evidence threshold are adopted.

每个审查判断都需要**证据**。直接引用代码的权重最高；推测性意见权重最低。只有超过证据阈值的判断才会被采纳。

**Source · 源码:** [`src/quality/gate/evidence-gate.js`](src/quality/gate/evidence-gate.js) (314 lines)

### Phase 5: Six-Layer Resilience · 六层容错

| Layer · 层级 | Mechanism · 机制 | Trigger · 触发条件 | Source · 源码 |
|---|---|---|---|
| 1 | Exponential backoff retry · 指数退避重试 | Single tool failure · 单次工具失败 | `tool-resilience.js` |
| 2 | Per-tool circuit breaker · 工具级熔断器 | 3 consecutive failures · 连续 3 次失败 | `circuit-breaker.js` |
| 3 | Failure vaccination · 失败疫苗 | Pattern detected · 检测到失败模式 | `failure-vaccination.js` |
| 4 | Model fallback chain · 模型降级链 | Current model fails · 当前模型失败 | `model-fallback.js` |
| 5 | Task replanning · 任务重规划 | Persistent failure · 持续失败 | `replan-engine.js` |
| 6 | Pipeline break · 流水线熔断 | Budget exhausted (80%/100%) · 预算耗尽 | `pipeline-breaker.js` |

### Phase 6: Result Synthesis · 结果合成

All agent outputs are merged into a structured report, weighted by the trust and reputation signals of each contributor.

所有代理输出被合并为结构化报告，按每个贡献者的信任和声誉信号加权。

**Source · 源码:** [`src/orchestration/planning/result-synthesizer.js`](src/orchestration/planning/result-synthesizer.js) (421 lines)

---

## Sensitivity Filter · 灵敏度过滤

Different roles perceive the **same signal field differently**. A Researcher is highly sensitive to the knowledge dimension but ignores path signals. An Implementer tracks paths and tasks closely. A Reviewer watches for alarms and reputation.

不同角色对**同一信号场有不同的感知**。侦察兵对知识维度高度敏感但忽略路径信号。实现者紧密追踪路径和任务。审查者关注警报和声誉。

This means three roles working in the same environment naturally focus on different things — not because someone told them to, but because their **built-in sensitivity coefficients** amplify different dimensions.

这意味着三个角色在同一环境中自然聚焦于不同事物——不是因为有人指示它们，而是因为它们**内建的灵敏度系数**放大了不同维度。

**Source · 源码:** [`src/intelligence/identity/sensitivity-filter.js`](src/intelligence/identity/sensitivity-filter.js), [`src/intelligence/identity/role-registry.js`](src/intelligence/identity/role-registry.js) (260 lines)

---

## Self-Evolution · 自我进化

The swarm **gets smarter over time** through three mechanisms:

蜂群通过三种机制**随时间变得更聪明**：

| Mechanism · 机制 | What Evolves · 进化对象 | Source · 源码 |
|---|---|---|
| **Signal Calibration** · 信号校准 | Dimension weights (which signals matter most) · 维度权重 | `signal-calibrator.js` (248 lines) |
| **Species Evolution** · 物种进化 | Role definitions (agent configurations) · 角色定义 | `species-evolver.js` (472 lines) |
| **Learning Curves** · 学习曲线 | Per-role, per-task-type success rates · 每角色每任务类型的成功率 | `skill-governor.js` |

If a role consistently succeeds at certain tasks, the system gives it cheaper models (it's already good enough). If a signal dimension keeps "crying wolf," its weight drops automatically.

如果某角色在特定任务上持续成功，系统会分配更便宜的模型（已经足够好了）。如果某信号维度总是"狼来了"，其权重自动下降。

---

## Model Capability Registry · 模型能力注册表

Claw-Swarm maintains an **8-dimensional capability profile** for 35+ LLM models, enabling Mixture-of-Experts (MoE) routing that matches task requirements to model strengths.

Claw-Swarm 维护着 35+ 个 LLM 模型的**八维能力画像**，实现将任务需求匹配到模型优势的专家混合（MoE）路由。

| Dimension · 维度 | Benchmarks · 基准测试 | Weight Formula · 权重公式 |
|---|---|---|
| **coding** · 编码 | HumanEval, SWE-bench, LiveCodeBench, MATH-500 | 0.25H + 0.35S + 0.25L + 0.15M |
| **architecture** · 架构 | GPQA-Diamond, MATH-500, MMLU-Pro, MMLU | 0.35G + 0.30M + 0.20P + 0.15U |
| **testing** · 测试 | SWE-bench, LiveCodeBench, HumanEval, IFEval | 0.45S + 0.25L + 0.15H + 0.15I |
| **documentation** · 文档 | IFEval, Arena-Hard, MMLU, MMLU-Pro | 0.40I + 0.25A + 0.20U + 0.15P |
| **security** · 安全 | IFEval, MMLU-Pro, hallucination⁻¹, consistency | 0.30I + 0.25P + 0.25H⁻¹ + 0.20C |
| **performance** · 性能 | cost⁻¹, speed, context efficiency | Normalized composite |
| **communication** · 交流 | Arena-Hard, IFEval, MMLU, ELO | 0.40A + 0.30I + 0.15U + 0.15E |
| **domain** · 领域 | MMLU, MMLU-Pro, C-Eval, GPQA | 0.30U + 0.25P + 0.20C + 0.15G + 0.10S |

**Source · 源码:** [`src/intelligence/identity/model-capability.js`](src/intelligence/identity/model-capability.js)

> [Model Registry (EN)](docs/en/model-registry.md) · [模型注册表 (中文)](docs/zh-CN/model-registry.md)

---

## Bio-Inspired Algorithms · 仿生算法

Every algorithm maps to a concrete source module. No metaphors — only executable math.

每个算法都映射到具体的源码模块。没有隐喻——只有可执行的数学。

| # | Algorithm · 算法 | Source · 源码 | Discipline · 学科 | Purpose · 用途 |
|---|---|---|---|---|
| 1 | MMAS (Min-Max Ant System) | `pheromone-engine.js` | Entomology | Intensity bounding [τ_min, τ_max] · 浓度边界控制 |
| 2 | ACO Roulette Wheel | `pheromone-engine.js` | Entomology | P(i) = τ_i^α · η_i^β / Σ · 概率路径选择 |
| 3 | Response Threshold + PI | `response-threshold.js` | Entomology | Adaptive activation threshold · 自适应激活阈值 |
| 4 | Dual-Process Theory | `dual-process-router.js` | Cognitive Sci | System 1 (fast) / System 2 (slow) · 快/慢思维路由 |
| 5 | Ebbinghaus Forgetting Curve | `episodic-memory.js` | Cognitive Sci | R(t) = e^(-t/λ·I) · 记忆时间衰减 |
| 6 | Working Memory Buffers | `working-memory.js` | Cognitive Sci | 3-tier cascade · 三级级联缓存 |
| 7 | Semantic Knowledge Graph | `semantic-memory.js` | Cognitive Sci | BFS traversal + concept merging · BFS 遍历 + 概念合并 |
| 8 | Negative Selection | `anomaly-detector.js` | Immunology | Self/non-self anomaly detection · 自我/非我异常检测 |
| 9 | Failure Vaccination | `failure-vaccination.js` | Immunology | Pattern immunization · 模式免疫 |
| 10 | FIPA Contract-Net | `contract-net.js` | Game Theory | CFP → Bid → Award auction · 合同竞标拍卖 |
| 11 | Monte Carlo Shapley | `shapley-credit.js` | Game Theory | Fair credit attribution · 公平信用归因 |
| 12 | Lotka-Volterra Dynamics | `species-evolver.js` | Ecology | Population competition dx/dt · 种群竞争动力学 |
| 13 | GEP Tournament | `species-evolver.js` | Evolutionary Bio | Gene Expression Programming · 基因表达式编程 |
| 14 | Gossip (SWIM) Protocol | `gossip-protocol.js` | Epidemiology | Epidemic information spread · 流行病信息扩散 |
| 15 | Mutual Information | `signal-calibrator.js` | Information Theory | MI-based weight calibration · MI 权重校准 |
| 16 | Forward-Decay Field | `signal-store.js` | Morphogenesis | Temporal signal decay encoding · 时序信号衰减编码 |
| 17 | 6D Emotion Vector (EMA) | `emotional-state.js` | Affective Computing | Agent emotional tracking · 代理情绪追踪 |
| 18 | Cultural Friction Model | `cultural-friction.js` | Cultural Anthropology | Cross-model collaboration cost · 跨模型协作成本 |
| 19 | SNA Centrality Metrics | `sna-analyzer.js` | Network Sociology | Degree, betweenness, PageRank · 度、介数、PageRank |
| 20 | Explore/Exploit Modulation | `global-modulator.js` | RL / Ecology | Adaptive exploration rate · 自适应探索率 |

> [Biomimicry Deep Dive (EN)](docs/en/biomimicry.md) · [仿生学详解 (中文)](docs/zh-CN/biomimicry.md)

---

## 14-Discipline Cross-Research · 14 学科交叉研究

| # | Discipline · 学科 | Problem Solved · 解决的问题 | Core Module · 核心模块 |
|---|---|---|---|
| 1 | Entomology · 昆虫学 | Decentralized task allocation | `pheromone-engine.js`, `response-threshold.js` |
| 2 | Immunology · 免疫学 | Failure detection & prevention | `anomaly-detector.js`, `failure-vaccination.js` |
| 3 | Cognitive Science · 认知科学 | Memory persistence & decision routing | `working-memory.js`, `dual-process-router.js` |
| 4 | Graph Theory · 图论 | Task decomposition & critical path | `dag-engine.js`, `critical-path.js` |
| 5 | Evolutionary Biology · 进化生物学 | Agent specialization over time | `species-evolver.js` |
| 6 | Network Sociology · 网络社会学 | Collaboration pattern analysis | `sna-analyzer.js`, `gossip-protocol.js` |
| 7 | Information Theory · 信息论 | Signal weight optimization | `signal-calibrator.js` |
| 8 | Control Theory · 控制论 | Homeostatic activation regulation | `response-threshold.js` (PI controller) |
| 9 | Game Theory · 博弈论 | Fair resource allocation | `contract-net.js`, `shapley-credit.js` |
| 10 | Morphogenesis · 形态发生学 | Emergent temporal coordination | `signal-store.js` (forward-decay) |
| 11 | Organizational Psychology · 组织心理学 | Meaning construction & sensemaking | `self-reflection.js` |
| 12 | Cultural Anthropology · 文化人类学 | Cross-model collaboration friction | `cultural-friction.js` |
| 13 | Affective Computing · 情感计算 | Agent emotional intelligence | `emotional-state.js`, `ei-layer.js` |
| 14 | Computational Ecology · 计算生态学 | Species population dynamics | `species-evolver.js` (Lotka-Volterra) |

> [Cross-Research (EN)](docs/en/cross-research.md) · [交叉研究 (中文)](docs/zh-CN/cross-research.md)

---

## Design Philosophy · 设计哲学

Claw-Swarm treats **coordination as an emergent property**, not a centralized command.

Claw-Swarm 将**协调视为涌现属性**，而非中心化指令。

1. **Indirect communication over direct messaging · 间接通信优于点对点消息** — Agents modify the shared signal field, not send point-to-point messages. · 代理修改共享信号场，而非互发消息。

2. **Biological decay over manual cleanup · 生物衰减优于手动清理** — All signals carry time-decay. Stale information self-destructs. · 所有信号自带时间衰减。过期信息自行消亡。

3. **Domain isolation over layered hierarchy · 域隔离优于分层层级** — 7 autonomous domains connected through field/bus/store, not strict upward/downward dependency. · 7 个自治域通过场/总线/存储连接，而非严格的上下依赖。

4. **Measured outcomes over assumed behavior · 实测结果优于假设行为** — Every claim backed by `npx vitest run`. 1,365 tests across 107 files. · 每个主张都有测试支撑。

5. **Source-anchored documentation over handwave · 源码锚定文档优于笼统描述** — Every algorithm, constant, formula maps to a file and line number. · 每个算法、常量、公式都映射到文件和行号。

6. **Field-mediated coupling over event spaghetti · 场中介耦合优于事件意面** — Modules declare produces/consumes; the field handles propagation. New modules plug in without rewiring. · 模块声明 produces/consumes；场处理传播。新模块接入无需重连。

7. **Emotional awareness over blind execution · 情绪感知优于盲目执行** — 6D emotion vectors tracked per agent. Enables adaptive workload and conflict-sensitive routing. · 每代理追踪 6D 情绪向量。实现自适应负载与冲突敏感路由。

8. **Zero idle, zero flags · 零空转，零开关** — No feature flags. Every module is always active. If code exists, it runs. · 没有功能开关。每个模块始终活跃。代码存在即运行。

---

## Verified Results · 验证结果

| Metric · 指标 | Value · 值 | How to verify · 验证方式 |
|---|---|---|
| Automated tests · 自动测试 | **1,365** passing (107 files) | `npx vitest run` |
| Source files · 源文件 | **121** JS (7 domains) | `find src -name "*.js" -not -path "*/console/*" \| wc -l` |
| Source lines · 源码行数 | **25,447** | `find src -name "*.js" -not -path "*/console/*" -exec cat {} + \| wc -l` |
| Signal dimensions · 信号维度 | **12** (continuous field) | `src/core/bus/event-catalog.js` |
| Event topics · 事件主题 | **27** | `src/core/bus/event-catalog.js` |
| Hooks · 钩子 | **16** | `src/bridge/hooks/hook-adapter.js` |
| REST endpoints · REST 端点 | **57+** (+ 14 legacy aliases) | `src/observe/dashboard/dashboard-service.js` |
| Built-in models · 内置模型 | **35+** (8D profiles) | `src/intelligence/identity/model-capability.js` |
| Tools · 工具 | **10** (all registered) | `src/bridge/tools/` |
| Feature flags · 功能开关 | **0** | Zero. All modules always active. |

All metrics from source code. No marketing.

所有指标源自代码。没有营销。

---

## Tools & Hooks · 工具与钩子

### Tools (10) · 工具

| Tool · 工具 | Purpose · 用途 | Source · 源码 |
|---|---|---|
| `swarm_run` | Plan + MoE model selection + spawn + execute · 一键规划 + 模型选择 + 生成 + 执行 | `run-tool.js` (248) |
| `swarm_query` | Read-only swarm state (10 scopes) · 蜂群状态只读查询 | `query-tool.js` (320) |
| `swarm_dispatch` | Forward message to running agent · 向运行中代理分派消息 | `dispatch-tool.js` |
| `swarm_checkpoint` | Pause for human approval · 暂停等待人工批准 | `checkpoint-tool.js` (232) |
| `swarm_spawn` | Direct agent spawn (bypass advisor) · 直接孵化代理 | `spawn-tool.js` (186) |
| `swarm_pheromone` | Stigmergic communication: deposit/read/stats · 信息素通信 | `pheromone-tool.js` (242) |
| `swarm_gate` | Evidence-based quality gating · 证据门控 | `gate-tool.js` (261) |
| `swarm_memory` | Semantic memory: search/record/forget · 语义记忆操作 | `memory-tool.js` (238) |
| `swarm_plan` | DAG plan: view/modify/validate/cancel · DAG 计划管理 | `plan-tool.js` (320) |
| `swarm_zone` | File/resource zone: lock/unlock/detect · 文件区域管理 | `zone-tool.js` (255) |

### Hooks (16) · 钩子

| Hook · 钩子 | Trigger · 触发时机 |
|---|---|
| `session_start` / `session_end` | Session lifecycle · 会话生命周期 |
| `message_created` | User message received · 用户消息接收 |
| `before_agent_start` / `agent_start` / `agent_end` | Agent lifecycle · 代理生命周期 |
| `llm_output` | LLM response received · LLM 响应接收 |
| `before_tool_call` / `after_tool_call` / `tool_result` | Tool lifecycle · 工具生命周期 |
| `prependSystemContext` | System prompt injection · 系统提示注入 |
| `agent_message` | Agent-to-agent message · 代理间消息 |
| `error` | Runtime error · 运行时错误 |
| `before_shutdown` | Graceful shutdown · 优雅关闭 |
| `activate` / `deactivate` | Plugin lifecycle · 插件生命周期 |

**Source · 源码:** [`src/bridge/hooks/hook-adapter.js`](src/bridge/hooks/hook-adapter.js)

> [API Reference (EN)](docs/en/api-reference.md) · [API 参考 (中文)](docs/zh-CN/api-reference.md)

---

## Emotional Intelligence · 情绪智慧

V9 tracks a **6-dimensional emotional state** per agent:

V9 为每个代理追踪**六维情绪状态**：

| Dimension · 维度 | Range · 范围 | Impact · 影响 |
|---|---|---|
| Frustration · 挫败感 | [0, 1] | High → inject encouragement, consider model upgrade · 高值 → 注入鼓励，考虑升级模型 |
| Confidence · 自信度 | [0, 1] | High → enable fast-path routing · 高值 → 启用快速路由 |
| Joy · 喜悦感 | [0, 1] | Streak detection, morale boost · 连胜检测，士气提升 |
| Urgency · 紧迫感 | [0, 1] | High → prioritize completion · 高值 → 优先完成 |
| Curiosity · 好奇心 | [0, 1] | High → allow exploration · 高值 → 允许探索 |
| Fatigue · 疲劳度 | [0, 1] | High → reduce complexity, consider model switch · 高值 → 降低复杂度 |

**Source · 源码:** [`src/intelligence/social/emotional-state.js`](src/intelligence/social/emotional-state.js), [`src/intelligence/social/ei-layer.js`](src/intelligence/social/ei-layer.js)

> [Emotional Intelligence (EN)](docs/en/emotional-intelligence.md) · [情绪智慧 (中文)](docs/zh-CN/emotional-intelligence.md)

---

## Human-in-the-Loop · 人在回路

Sub-agents call `swarm_checkpoint` before irreversible operations. Execution pauses until the user approves in the parent session. Approved checkpoints auto-resume via `swarm_run`.

子代理在不可逆操作前调用 `swarm_checkpoint`，执行暂停直到用户在父会话中批准。批准后 `swarm_run` 自动恢复执行。

**Source · 源码:** [`src/bridge/tools/checkpoint-tool.js`](src/bridge/tools/checkpoint-tool.js) (232 lines)

---

## Budget Management · 预算管理

Every task tracks **token budget** and **time budget**. At 80% consumption: auto-switch to cheaper models, reduce review steps. At 100%: pipeline break with partial results. **Shapley credit attribution** ensures fair accounting per agent.

每个任务追踪**Token 预算**和**时间预算**。消耗到 80%：自动切换廉价模型，缩减审查步骤。到 100%：流水线断路，返回部分结果。**Shapley 信用归因**确保每个代理的公平核算。

**Source · 源码:** [`src/orchestration/adaptation/budget-tracker.js`](src/orchestration/adaptation/budget-tracker.js) (332 lines), [`src/orchestration/adaptation/shapley-credit.js`](src/orchestration/adaptation/shapley-credit.js) (246 lines)

---

## Compliance Monitoring · 合规监控

A background compliance layer enforces **four red lines**: unsafe operations, unauthorized file access, sensitive data leakage, scope deviation. Three escalation levels: prompt reminder → forced output modification → agent termination. Violations affect reputation scores.

后台合规层执行**四条红线**：不安全操作、越权文件访问、敏感数据泄露、范围偏离。三级升级：提示提醒 → 强制修改输出 → 终止代理。违规影响声誉评分。

**Source · 源码:** [`src/quality/analysis/compliance-monitor.js`](src/quality/analysis/compliance-monitor.js) (219 lines)

---

<a id="quick-start"></a>

## Quick Start · 快速开始

```bash
# 1. Install · 安装
npm install -g openclaw
npm install openclaw-swarm   # or: git clone + node install.js
cd node_modules/openclaw-swarm && node install.js

# 2. Start · 启动
openclaw gateway restart

# 3. Verify · 验证
openclaw gateway status
# → claw-swarm 9.0.0 enabled

# 4. Dashboard · 仪表盘
# http://127.0.0.1:19100/api/v9/health

# 5. Run tests · 运行测试
npx vitest run
# → 1,365 tests passing
```

> [Installation (EN)](docs/en/installation.md) · [安装配置 (中文)](docs/zh-CN/installation.md)

---

<a id="documentation"></a>

## Documentation · 文档导航

### English

| Guide | Description |
|---|---|
| [Architecture](docs/en/architecture.md) | 7-domain design, dual foundation, signal field, process model |
| [Signal Field](docs/en/signal-mesh.md) | 12-dimensional field, forward-decay, GC, sensitivity filter |
| [Model Registry](docs/en/model-registry.md) | 35+ models, 8D capability profiles, MoE routing |
| [API Reference](docs/en/api-reference.md) | 10 tools, 16 hooks, 57+ REST endpoints, 27 events |
| [Biomimicry](docs/en/biomimicry.md) | 20 algorithms with formal math and source anchors |
| [Cross-Research](docs/en/cross-research.md) | 14 disciplines with academic foundations |
| [Emotional Intelligence](docs/en/emotional-intelligence.md) | 6D emotion vectors, cultural friction |
| [Module Guide](docs/en/module-guide.md) | Per-module responsibility across 7 domains |
| [Installation](docs/en/installation.md) | Setup, config, model compatibility |
| [Console Guide](docs/en/console-guide.md) | Dashboard views, REST endpoints, SSE connection |
| [FAQ](docs/en/faq-troubleshooting.md) | Common issues and solutions |

### 中文文档

| 指南 | 描述 |
|---|---|
| [架构设计](docs/zh-CN/architecture.md) | 7 域设计、双基座、信号场、进程模型 |
| [信号场](docs/zh-CN/signal-mesh.md) | 12 维信号场、前向衰减、GC、灵敏度过滤 |
| [模型注册表](docs/zh-CN/model-registry.md) | 35+ 模型、8D 能力画像、MoE 路由 |
| [API 参考](docs/zh-CN/api-reference.md) | 10 工具、16 钩子、57+ REST 端点、27 事件 |
| [仿生学](docs/zh-CN/biomimicry.md) | 20 种算法的形式化数学与源码锚点 |
| [交叉研究](docs/zh-CN/cross-research.md) | 14 个学科的学术基础 |
| [情绪智慧](docs/zh-CN/emotional-intelligence.md) | 6D 情绪向量、文化摩擦 |
| [模块指南](docs/zh-CN/module-guide.md) | 7 域各模块职责说明 |
| [安装配置](docs/zh-CN/installation.md) | 安装步骤、配置选项、模型兼容性 |
| [控制台指南](docs/zh-CN/console-guide.md) | 仪表盘视图、REST 端点、SSE 连接 |
| [常见问题](docs/zh-CN/faq-troubleshooting.md) | 常见问题与故障排查 |

---

<a id="llm-docs"></a>

## For LLM Agents · 面向 LLM 代理

Machine-readable documentation optimized for LLM context windows:

为 LLM 上下文窗口优化的机器可读文档：

| Document | 文档 |
|---|---|
| [README for LLMs (EN)](docs/en/README.llm.md) | [LLM 专用概览 (中文)](docs/zh-CN/README.llm.md) |
| [Installation for LLMs (EN)](docs/en/installation.llm.md) | [LLM 安装指南 (中文)](docs/zh-CN/installation.llm.md) |

---

## Contributing · 贡献

See [CONTRIBUTING.md](CONTRIBUTING.md) · 详见 [CONTRIBUTING.md](CONTRIBUTING.md)

## License · 许可证

AGPL-3.0-or-later. Copyright 2025-2026 DEEP-IOS. See [LICENSE](LICENSE).
