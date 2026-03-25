[English](README.md) | **中文**

<p align="center">
  <img src="docs/assets/console-demo.gif" alt="Claw-Swarm 控制台" width="90%">
</p>

<h1 align="center">Claw-Swarm</h1>

<p align="center">
  面向多代理 LLM 协作的场中介蜂群智能系统
</p>

<p align="center">
  <img src="https://img.shields.io/badge/版本-9.2.0-blue" alt="版本">
  <img src="https://img.shields.io/badge/测试-1697_通过-green" alt="测试">
  <img src="https://img.shields.io/badge/许可证-AGPL--3.0-blue" alt="许可证">
  <img src="https://img.shields.io/badge/Node.js-≥22-green" alt="Node">
  <img src="https://img.shields.io/badge/域-7-orange" alt="域">
  <img src="https://img.shields.io/badge/模型-35+-purple" alt="模型">
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#文档导航">文档</a> ·
  <a href="#llm-文档">LLM 文档</a> ·
  <a href="CHANGELOG.md">更新日志</a>
</p>

---

## 起源故事

现有的多代理框架都基于同一个致命假设：**协调是消息传递问题**。搭建消息总线、加上路由规则，代理就会自动协作。然而事实恰恰相反——在生产环境中，它们碰撞、遗忘、级联失败，最终退化成昂贵的回音室。

Claw-Swarm 诞生于一个截然不同的观察：**大自然在数十亿年前就解决了协调问题**。拥有仅 250 个神经元的蚂蚁群落在物流效率上超越人类。免疫系统无需中央指挥就能分类威胁。神经回路通过反应-扩散动力学自组织。

这催生了一个横跨 14 个学科的交叉研究计划——昆虫学、免疫学、认知科学、图论、进化生物学、网络社会学、信息论、控制论、博弈论、形态发生学、组织心理学、文化人类学、情感计算和计算生态学。每个学科贡献了一个具体的算法实现，不是比喻，而是可执行的数学。

最终成果：**V9.2 场中介耦合架构**。七个自治域不靠点对点连线，而是通过共享的 12 维信号场沟通。代理在场中留下痕迹，如同蚂蚁沉积信息素；决策从所有信号的叠加中涌现，没有中心控制器，没有空转模块，没有功能开关。每一行代码都在生产环境运行。

---

## 真实痛点

在生产环境中协调多个 LLM 代理会撞上**六面墙**：

| 痛点 | 崩溃现象 | Claw-Swarm 解法 |
|---|---|---|
| **协作盲区** | 代理重复劳动，彼此毫无感知 | 12 维信号场 + 信息素踪迹 |
| **记忆断裂** | 上下文重置后知识全部丢失 | 三层混合记忆 + 遗忘曲线衰减 |
| **级联故障** | 单个工具超时拖垮整条流水线 | 六层容错：重试→熔断→疫苗→模型降级→重规划→流水线断路 |
| **手动路由** | 每项任务都要人工分配 | DAG 分解 + 场感知孵化建议 |
| **零可观测性** | 运行时完全看不到代理行为 | 仪表盘（58 REST 端点）+ ConsoleDataBridge WebSocket + legacy SSE + 健康检查 |
| **空转代码** | 功能开关后的模块从不激活 | 零开关：所有模块无条件激活，场耦合自动验证 |

---

## 架构一览

V9.2 用**七个自治域**取代了 V8 的七层线性层级（L0–L6），通过**双基座**（信号场 + 域存储 + 事件总线）实现域间通信。模块通过信号场交互，而非直接导入。

```
域                文件数    行数     职责
───────────────  ──────   ──────   ────────────────────────
 core（核心）       12     1,953    信号场、域存储、事件总线、模块基类
 communication     8      1,281    信息素引擎（MMAS）、任务通道、痕迹协作板
 intelligence      34     5,606    记忆、身份、社交、产物、理解
 orchestration     24     6,889    DAG 规划、孵化建议、自适应、调度
 quality           10     2,738    证据门控、熔断器、失败疫苗
 observe           13     1,651    仪表盘（58 REST）、指标、健康检查、WS bridge、SSE 兼容广播
 bridge            24     4,526    10 工具、16 钩子、会话管理、模型降级
───────────────  ──────   ──────
 合计              121    25,447
```

### 进程模型

V9 完全在 OpenClaw Gateway 进程内运行，不再使用 `child_process.fork()`。`SwarmCoreV9` 通过动态导入组装所有域，支持优雅降级。DashboardService 在进程内启动独立 HTTP 服务器（端口 19100）。

**源码：** [`src/swarm-core-v9.js`](src/swarm-core-v9.js)（475 行），[`src/index.js`](src/index.js)（205 行）

### V9.2 核心能力

- **T0 架构** — 蜂群作为 OS 级程序通过 `Symbol` 钩子注入 OpenClaw 运行循环，而非普通插件。它在最底层拦截宿主生命周期。
- **并行 DAG 分支** — 支持 fork+merge 模式实现并发执行（如 `new_feature: research → plan → [backend, frontend] → review`）。
- **8 种意图类型** — `bug_fix`、`new_feature`、`refactor`、`optimize`、`explore`、`analyze`、`content`、`question`，每种意图类型对应定制的 DAG 模板和模型路由策略。
- **广播详度控制** — `setVerbosity('verbose' | 'normal' | 'quiet')` 按会话过滤广播粒度。

> [架构设计](docs/zh-CN/architecture.md) · [Architecture (EN)](docs/en/architecture.md)

---

## 12 维信号场

信号场是所有域通信的共享介质。每个协调事件都是一个信号，携带作用域、维度和强度，通过前向衰减编码随时间自然衰减。

| # | 维度 | 生物学类比 | 衰减率 λ | 含义 |
|---|---|---|---|---|
| 1 | `trail` | 路径足迹 | 0.008 | 最近执行痕迹与路径跟随线索 |
| 2 | `alarm` | 警报羽流 | 0.15 | 风险、异常与熔断压力 |
| 3 | `reputation` | 群体记忆 | 0.005 | 历史可靠性与贡献质量 |
| 4 | `task` | 任务压力 | 0.01 | 待处理工作压力与任务推进动量 |
| 5 | `knowledge` | 共享知识气味图 | 0.003 | 当前作用域中的知识密度与记忆可得性 |
| 6 | `coordination` | 协调振动 | 0.02 | 多代理同步与委派压力 |
| 7 | `emotion` | 情绪热量 | 0.10 | 挫败、紧迫感和情绪残留 |
| 8 | `trust` | 互信梳理 | 0.006 | 成对协作信心 |
| 9 | `sna` | 社交拓扑 | 0.004 | 协作中心性与网络结构 |
| 10 | `learning` | 学习轨迹 | 0.002 | 近期结果带来的改进信号 |
| 11 | `calibration` | 校准反馈 | 0.01 | 阈值与信号权重调校压力 |
| 12 | `species` | 物种漂移 | 0.001 | 角色/物种演化与分化压力 |

衰减公式：`score = base × e^(λ × emitTime)`。查询时求值，O(1) 发射，O(n) 查询。信号数超 100,000 时触发紧急 GC。

**源码：** [`src/core/field/signal-store.js`](src/core/field/signal-store.js)（382 行）

> [信号场详解](docs/zh-CN/signal-mesh.md) · [Signal Field (EN)](docs/en/signal-mesh.md)

---

## 系统如何运作

一个任务流经六个涌现阶段——不是硬编码的流水线，而是从信号场动力学中自然涌现的阶段。

### 阶段一：意图识别

系统将消息分为**快思考（System 1）**或**慢思考（System 2）**路径。简单问题直接回答。复杂任务（"重构登录模块"）触发完整蜂群流程。路由阈值自适应——快思考连续成功则阈值上升，频繁翻车则下降。

**源码：** [`src/orchestration/adaptation/dual-process-router.js`](src/orchestration/adaptation/dual-process-router.js)

### 阶段二：场感知孵化决策

对于慢思考任务，孵化建议器同时嗅探信号场全部 12 个维度：知识维度弱则先派侦察兵，警报维度亮则分配更强模型，声誉维度显示某角色擅长此类任务则优先选用。决策不是 if-else 链，而是 12 个信号的**加权叠加**。

**源码：** [`src/orchestration/scheduling/spawn-advisor.js`](src/orchestration/scheduling/spawn-advisor.js)（430 行）

### 阶段三：被动通讯

代理之间不互发消息，而是在工作时于信号场中留下信息素踪迹。侦察兵阅读 `auth/login.js` 时沉积路径信号，后续实现者感知到浓烈踪迹便跳过该文件，专注于未访问区域。

六种信息素类型：**踪迹**（走过的路径）、**警报**（危险区域）、**招募**（需要帮助）、**女王**（策略切换）、**舞蹈**（高价值发现）、**食物**（优质产出）。

**源码：** [`src/communication/pheromone/pheromone-engine.js`](src/communication/pheromone/pheromone-engine.js)（311 行）

### 阶段四：证据门控审查

每个审查判断都需要证据支撑。直接引用代码的权重最高，推测性意见权重最低。只有超过证据阈值的判断才会被采纳。

**源码：** [`src/quality/gate/evidence-gate.js`](src/quality/gate/evidence-gate.js)（314 行）

### 阶段五：六层容错

| 层级 | 机制 | 触发条件 | 源码 |
|---|---|---|---|
| 1 | 指数退避重试 | 单次工具调用失败 | `tool-resilience.js` |
| 2 | 工具级熔断器 | 连续 3 次失败 | `circuit-breaker.js` |
| 3 | 失败疫苗 | 检测到失败模式 | `failure-vaccination.js` |
| 4 | 模型降级链 | 当前模型失败 | `model-fallback.js` |
| 5 | 任务重规划 | 持续失败 | `replan-engine.js` |
| 6 | 流水线断路 | 预算耗尽（80%/100%） | `pipeline-breaker.js` |

### 阶段六：结果合成

所有代理输出合并为结构化报告，按每个贡献者的信任和声誉信号加权。

**源码：** [`src/orchestration/planning/result-synthesizer.js`](src/orchestration/planning/result-synthesizer.js)（421 行）

---

## 灵敏度过滤

不同角色对同一信号场有不同的感知。侦察兵对知识维度高度敏感但忽略路径信号，实现者紧密追踪路径和任务，审查者关注警报和声誉。三个角色在同一环境中自然聚焦于不同事物——不是因为有人指示，而是因为内建的灵敏度系数放大了不同维度。

**源码：** [`src/intelligence/identity/sensitivity-filter.js`](src/intelligence/identity/sensitivity-filter.js), [`src/intelligence/identity/role-registry.js`](src/intelligence/identity/role-registry.js)（260 行）

---

## 自我进化

蜂群通过三种机制随时间变得更聪明：

| 机制 | 进化对象 | 源码 |
|---|---|---|
| **信号校准** | 维度权重（哪些信号最重要） | `signal-calibrator.js`（248 行） |
| **物种进化** | 角色定义（代理配置） | `species-evolver.js`（472 行） |
| **学习曲线** | 每角色每任务类型的成功率 | `skill-governor.js` |

---

## 模型能力注册表

维护 35+ 个 LLM 模型的**八维能力画像**，实现将任务需求匹配到模型优势的专家混合路由。

| 维度 | 基准测试 | 权重公式 |
|---|---|---|
| **编码** | HumanEval, SWE-bench, LiveCodeBench, MATH-500 | 0.25H + 0.35S + 0.25L + 0.15M |
| **架构** | GPQA-Diamond, MATH-500, MMLU-Pro, MMLU | 0.35G + 0.30M + 0.20P + 0.15U |
| **测试** | SWE-bench, LiveCodeBench, HumanEval, IFEval | 0.45S + 0.25L + 0.15H + 0.15I |
| **文档** | IFEval, Arena-Hard, MMLU, MMLU-Pro | 0.40I + 0.25A + 0.20U + 0.15P |
| **安全** | IFEval, MMLU-Pro, hallucination⁻¹, consistency | 0.30I + 0.25P + 0.25H⁻¹ + 0.20C |
| **性能** | cost⁻¹, speed, context efficiency | 归一化综合 |
| **交流** | Arena-Hard, IFEval, MMLU, ELO | 0.40A + 0.30I + 0.15U + 0.15E |
| **领域** | MMLU, MMLU-Pro, C-Eval, GPQA | 0.30U + 0.25P + 0.20C + 0.15G + 0.10S |

**源码：** [`src/intelligence/identity/model-capability.js`](src/intelligence/identity/model-capability.js)

---

## 仿生算法

每个算法映射到具体的源码模块。不是隐喻——是可执行的数学。

| # | 算法 | 源码 | 学科 | 用途 |
|---|---|---|---|---|
| 1 | MMAS（最大-最小蚁群） | `pheromone-engine.js` | 昆虫学 | 浓度边界控制 |
| 2 | ACO 轮盘选择 | `pheromone-engine.js` | 昆虫学 | 概率路径选择 |
| 3 | 响应阈值 + PI 控制 | `response-threshold.js` | 昆虫学 | 自适应激活阈值 |
| 4 | 双过程理论 | `dual-process-router.js` | 认知科学 | 快/慢思维路由 |
| 5 | 遗忘曲线 | `episodic-memory.js` | 认知科学 | R(t) = e^(-t/λ·I) |
| 6 | 工作记忆缓冲 | `working-memory.js` | 认知科学 | 三级级联缓存 |
| 7 | 语义知识图 | `semantic-memory.js` | 认知科学 | BFS 遍历 + 概念合并 |
| 8 | 阴性选择 | `anomaly-detector.js` | 免疫学 | 自我/非我异常检测 |
| 9 | 失败疫苗 | `failure-vaccination.js` | 免疫学 | 模式免疫 |
| 10 | FIPA 合同网 | `contract-net.js` | 博弈论 | 合同竞标拍卖 |
| 11 | 蒙特卡洛 Shapley | `shapley-credit.js` | 博弈论 | 公平信用归因 |
| 12 | Lotka-Volterra | `species-evolver.js` | 生态学 | 种群竞争动力学 |
| 13 | GEP 锦标赛 | `species-evolver.js` | 进化生物学 | 基因表达式编程 |
| 14 | Gossip（SWIM）协议 | `gossip-protocol.js` | 流行病学 | 信息扩散 |
| 15 | 互信息 | `signal-calibrator.js` | 信息论 | MI 权重校准 |
| 16 | 前向衰减场 | `signal-store.js` | 形态发生学 | 时序信号衰减编码 |
| 17 | 6D 情绪向量（EMA） | `emotional-state.js` | 情感计算 | 代理情绪追踪 |
| 18 | 文化摩擦模型 | `cultural-friction.js` | 文化人类学 | 跨模型协作成本 |
| 19 | SNA 中心性指标 | `sna-analyzer.js` | 网络社会学 | 度、介数、PageRank |
| 20 | 探索/利用调制 | `global-modulator.js` | 强化学习/生态学 | 自适应探索率 |

> [仿生学详解](docs/zh-CN/biomimicry.md) · [Biomimicry (EN)](docs/en/biomimicry.md)

---

## 验证结果

| 指标 | 值 | 验证方式 |
|---|---|---|
| 自动测试 | **1,697** 通过（107 文件） | `npx vitest run` |
| 源文件 | **121** JS（7 域） | `find src -name "*.js" -not -path "*/console/*" \| wc -l` |
| 源码行数 | **25,447** | `find src -name "*.js" -not -path "*/console/*" -exec cat {} + \| wc -l` |
| 信号维度 | **12**（连续场） | `src/core/bus/event-catalog.js` |
| 事件主题 | **27** | `src/core/bus/event-catalog.js` |
| 钩子 | **16** | `src/bridge/hooks/hook-adapter.js` |
| REST 端点 | **58**（+ 14 旧版别名） | `src/observe/dashboard/dashboard-service.js` |
| 内置模型 | **35+**（8D 画像） | `src/intelligence/identity/model-capability.js` |
| 工具 | **10**（全部注册） | `src/bridge/tools/` |
| 功能开关 | **0** | 所有模块始终活跃 |

所有指标源自代码。没有营销。

---

## 工具（10 个）

| 工具 | 用途 | 源码 |
|---|---|---|
| `swarm_run` | 一键规划 + 模型选择 + 孵化 + 执行 | `run-tool.js` |
| `swarm_query` | 蜂群状态只读查询（16 种范围） | `query-tool.js` |
| `swarm_dispatch` | 向运行中代理分派消息 | `dispatch-tool.js` |
| `swarm_checkpoint` | 暂停等待人工批准 | `checkpoint-tool.js` |
| `swarm_spawn` | 直接孵化代理（绕过建议器） | `spawn-tool.js` |
| `swarm_pheromone` | 信息素通信：沉积/读取/统计 | `pheromone-tool.js` |
| `swarm_gate` | 证据门控质量审查 | `gate-tool.js` |
| `swarm_memory` | 语义记忆：搜索/记录/遗忘 | `memory-tool.js` |
| `swarm_plan` | DAG 计划：查看/修改/验证/取消 | `plan-tool.js` |
| `swarm_zone` | 文件区域：锁定/解锁/检测 | `zone-tool.js` |

> [API 参考](docs/zh-CN/api-reference.md) · [API Reference (EN)](docs/en/api-reference.md)

---

## 设计哲学

1. **间接通信优于点对点消息** — 代理修改共享信号场，不互发消息
2. **生物衰减优于手动清理** — 所有信号自带时间衰减
3. **域隔离优于分层层级** — 7 个自治域通过场/总线/存储连接
4. **实测结果优于假设行为** — 每个主张都有测试支撑
5. **源码锚定文档优于笼统描述** — 每个算法映射到具体文件
6. **场中介耦合优于事件意面** — 模块声明 produces/consumes，新模块接入无需重连
7. **情绪感知优于盲目执行** — 每代理追踪 6D 情绪向量
8. **零空转，零开关** — 模块存在即运行

---

<a id="快速开始"></a>

## 快速开始

```bash
# 1. 安装
npm install -g openclaw
npm install openclaw-swarm
cd node_modules/openclaw-swarm && node install.js

# 2. 启动
openclaw gateway restart

# 3. 验证
openclaw gateway status
# → claw-swarm 9.2.0 enabled

# 4. 仪表盘
# http://127.0.0.1:19100/api/v9/health

# 5. 运行测试
npx vitest run
# → 1,697 tests passing
```

> [安装配置](docs/zh-CN/installation.md) · [Installation (EN)](docs/en/installation.md)

---

<a id="文档导航"></a>

## 文档导航

| 指南 | 描述 |
|---|---|
| [架构设计](docs/zh-CN/architecture.md) | 7 域设计、双基座、信号场、进程模型 |
| [信号场](docs/zh-CN/signal-mesh.md) | 12 维信号场、前向衰减、GC、灵敏度过滤 |
| [模型注册表](docs/zh-CN/model-registry.md) | 35+ 模型、8D 能力画像、MoE 路由 |
| [API 参考](docs/zh-CN/api-reference.md) | 10 工具、16 钩子、58 REST 端点、27 事件 |
| [仿生学](docs/zh-CN/biomimicry.md) | 20 种算法的形式化数学与源码锚点 |
| [交叉研究](docs/zh-CN/cross-research.md) | 14 个学科的学术基础 |
| [情绪智慧](docs/zh-CN/emotional-intelligence.md) | 6D 情绪向量、文化摩擦 |
| [模块指南](docs/zh-CN/module-guide.md) | 7 域各模块职责说明 |
| [安装配置](docs/zh-CN/installation.md) | 安装步骤、配置选项、模型兼容性 |
| [控制台指南](docs/zh-CN/console-guide.md) | 仪表盘视图、REST 端点、WS bridge、SSE 兼容 |
| [常见问题](docs/zh-CN/faq-troubleshooting.md) | 常见问题与故障排查 |

---

<a id="llm-文档"></a>

## LLM 代理文档

为 LLM 上下文窗口优化的机器可读文档：

| 文档 | 英文版 |
|---|---|
| [LLM 专用概览](docs/zh-CN/README.llm.md) | [README for LLMs](docs/en/README.llm.md) |
| [LLM 安装指南](docs/zh-CN/installation.llm.md) | [Installation for LLMs](docs/en/installation.llm.md) |

---

## 贡献

详见 [CONTRIBUTING.md](CONTRIBUTING.md)

## 许可证

AGPL-3.0-or-later. Copyright 2025-2026 DEEP-IOS. 详见 [LICENSE](LICENSE).
