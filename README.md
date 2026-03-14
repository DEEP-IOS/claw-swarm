<p align="center">
  <img src="docs/console-demo.gif" alt="Claw-Swarm Console" width="90%">
</p>

<h1 align="center">Claw-Swarm</h1>

<p align="center">
  Bio-inspired swarm intelligence for multi-agent LLM coordination<br/>
  面向多代理 LLM 协作的仿生群体智能系统
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-7.0.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/tests-1463_passing-green" alt="Tests">
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License">
  <img src="https://img.shields.io/badge/Node.js-≥22-green" alt="Node">
</p>

<p align="center">
  <a href="#quick-start">Quick Start · 快速开始</a> ·
  <a href="#documentation">Docs · 文档</a> ·
  <a href="#llm-docs">LLM Docs</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

---

## The Problem · 真实痛点

Coordinating multiple LLM agents in production hits **five walls**:

在生产环境中协调多个 LLM 代理会撞上**五面墙**：

| Wall · 痛点 | What breaks · 崩溃现象 | How Claw-Swarm fixes it · 解法 |
|---|---|---|
| **Blind collaboration** · 协作盲区 | Agents duplicate work, no shared awareness · 代理重复劳动，彼此毫无感知 | Pheromone trails + stigmergic board · 信息素踪迹 + 痕迹协作板 |
| **Memory loss** · 记忆断裂 | Context resets erase all knowledge · 上下文重置后知识全部丢失 | 3-tier memory with Ebbinghaus curves · 三层记忆 + 遗忘曲线 |
| **Cascading failures** · 级联故障 | One tool timeout kills the pipeline · 单个工具超时拖垮整条流水线 | Per-tool circuit breakers + failure vaccination · 工具级熔断 + 失败疫苗 |
| **Manual routing** · 手动路由 | Every task must be hand-assigned · 每项任务都要人工分配 | DAG decomposition + contract-net auction · DAG 分解 + 合同竞标 |
| **Zero observability** · 零可观测性 | No runtime insight into agent behavior · 运行时完全看不到代理行为 | 6-view React console + SSE streaming · 6 视图控制台 + SSE 实时流 |

---

## How It Works · 解决机制

Every mechanism anchors to source code. No magic, no black boxes.

每个机制都锚定源码。无黑盒，无魔法。

### Pheromone-based indirect communication · 信息素间接通信

Agents leave typed signal trails (7 types: trail, alarm, recruit, queen, dance, food, danger) that decay over time. MMAS bounds prevent premature convergence. ACO roulette selects paths probabilistically.

代理留下类型化信号踪迹（7 种：路径、警报、招募、蜂后、舞蹈、食物、危险），浓度随时间自然衰减。MMAS 上下限防止过早收敛，ACO 轮盘按概率选择路径。

**Source · 源码**: [`src/L2-communication/pheromone-engine.js`](src/L2-communication/pheromone-engine.js)

### 3-tier memory with forgetting curves · 三层记忆与遗忘曲线

Working memory (5 focus / 15 context / 30 scratch), episodic memory (Ebbinghaus decay: `R(t) = e^(-t/λ)`), and semantic memory (BFS knowledge graph) survive context window resets.

工作记忆（5 焦点 / 15 上下文 / 30 暂存）、情景记忆（Ebbinghaus 衰减）、语义记忆（BFS 知识图谱），能够跨上下文重置存活。

**Source · 源码**: [`src/L3-agent/memory/`](src/L3-agent/memory/)

### DAG decomposition + contract negotiation · DAG 分解 + 合同竞标

Goals split into dependency graphs with CPM critical-path analysis, then assigned via FIPA Contract-Net auction (CFP → Bid → Award → Execution). ABC scheduling balances exploitation and exploration (50% employed / 45% onlooker / 5% scout).

目标拆分为依赖图并做 CPM 关键路径分析，随后通过 FIPA 合同网拍卖分配（CFP → 投标 → 授标 → 执行）。ABC 调度平衡开发与探索。

**Source · 源码**: [`src/L4-orchestration/task-dag-engine.js`](src/L4-orchestration/task-dag-engine.js), [`contract-net.js`](src/L4-orchestration/contract-net.js), [`abc-scheduler.js`](src/L4-orchestration/abc-scheduler.js)

### Per-tool circuit breakers · 工具级熔断器

AJV pre-validates all tool parameters. 3-state breakers (CLOSED → OPEN → HALF_OPEN) isolate faults before cascade. Failure vaccination stores repair patterns in SQLite for instant reuse.

AJV 预校验全部工具参数。三状态熔断器在故障扩散前完成隔离。失败疫苗将修复模式存入 SQLite，下次直接复用。

**Source · 源码**: [`src/L5-application/tool-resilience.js`](src/L5-application/tool-resilience.js), [`circuit-breaker.js`](src/L5-application/circuit-breaker.js)

### 6-view monitoring console · 6 视图监控控制台

React 18 SPA (Zustand state, ~112 KB gzip) on port 19100: Hive (canvas hex-grid), Pipeline (DAG execution), Cognition (dual-process routing), Ecology (Shapley credit), Network (SNA graph), Control (RED metrics). Command palette (Ctrl+K), event timeline with replay, agent inspector.

React 18 SPA（Zustand 状态管理，~112 KB gzip），端口 19100：蜂巢（Canvas 六角网格）、管线（DAG 执行）、认知（双过程路由）、生态（Shapley 信用）、网络（SNA 图谱）、控制（RED 指标）。含命令面板（Ctrl+K）、可回放事件时间线、代理检查器。

**Source · 源码**: [`src/L6-monitoring/console/src/`](src/L6-monitoring/console/src/) (98 files) · **Access · 访问**: `http://127.0.0.1:19100/v6/console`

### Human-in-the-loop checkpoints · 人在回路检查点

Sub-agents call `swarm_checkpoint` before irreversible operations. Execution pauses until the user approves in the parent session. Approved checkpoints auto-resume via `swarm_run`.

子代理在不可逆操作前调用 `swarm_checkpoint`，执行暂停直到用户在父会话中批准。批准后 `swarm_run` 自动恢复执行。

**Source · 源码**: [`src/L5-application/tools/swarm-checkpoint-tool.js`](src/L5-application/tools/swarm-checkpoint-tool.js)

---

## Verified Results · 验证结果

| Metric · 指标 | Value · 值 | How to verify · 验证方式 |
|---|---|---|
| Automated tests · 自动测试 | 1463 passing | `npx vitest run` |
| Source files · 源文件 | 173 JS (6 layers) | `find src -name "*.js" \| wc -l` |
| Database tables · 数据库表 | 52 (schema V9) | `grep -c "CREATE TABLE" database-schemas.js` |
| Event topics · 事件主题 | 122 | `src/event-catalog.js` |
| Hooks · 钩子 | 19 (5 Tier-A + 14 Tier-B) | `grep -c "api.on(" src/index.js` |
| Console frontend · 控制台前端 | 98 files, ~112 KB gzip | `src/L6-monitoring/console/src/` |
| Tools · 工具 | 10 files (4 public + 6 internal) | `src/L5-application/tools/` |

All metrics from source code. Verification commands in [`docs/metadata.yml`](docs/metadata.yml).

所有指标源自代码。验证命令见 [`docs/metadata.yml`](docs/metadata.yml)。

---

## Bio-Inspired Algorithms · 仿生算法

| Algorithm · 算法 | Source · 源码 | Purpose · 用途 |
|---|---|---|
| MMAS | `pheromone-engine.js` | Intensity bounding · 浓度边界控制 |
| ACO Roulette | `pheromone-engine.js` | Probabilistic path selection · 概率路径选择 |
| Ebbinghaus Curve | `episodic-memory.js` | Temporal memory decay · 记忆时间衰减 |
| FRTM + PI Controller | `response-threshold.js` | Adaptive activation threshold · 自适应激活阈值 |
| Failure Vaccination | `failure-vaccination.js` | Pattern-based immunization · 模式免疫记忆 |
| FIPA Contract-Net | `contract-net.js` | Auction-based assignment · 拍卖式任务分配 |
| ABC (Bee Colony) | `abc-scheduler.js` | 3-stage scheduling · 三阶段调度 |
| Lotka-Volterra | `species-evolver.js` | Population competition · 种群竞争动力学 |
| Monte Carlo Shapley | `shapley-credit.js` | Fair credit attribution · 公平信用归因 |
| Mutual Information | `signal-calibrator.js` | Auto-weight calibration · 信号权重自校准 |

→ [Full biomimicry guide (EN)](docs/en/biomimicry.md) · [仿生学指南 (中文)](docs/zh-CN/biomimicry.md)

---

## Design Philosophy · 设计哲学

Claw-Swarm treats **coordination as an emergent property**, not a centralized command.

Claw-Swarm 将**协调视为涌现属性**，而非中心化指令。

1. **Indirect communication over direct messaging · 间接通信优于点对点消息** — Agents modify shared state (pheromones, stigmergic board), not send point-to-point messages. Scales without routing overhead. · 代理修改共享状态，而非互发消息。无路由开销即可扩展。

2. **Biological decay over manual cleanup · 生物衰减优于手动清理** — All signals carry TTL. Stale information self-destructs. No garbage collection. · 所有信号自带存活时限。过期信息自行消亡，无需垃圾回收。

3. **Layered isolation over monolithic coupling · 分层隔离优于巨石耦合** — 6 layers, strict downward dependency. Only L5 knows OpenClaw. L1-L4 reusable in any Node.js 22+ env. · 6 层严格向下依赖。仅 L5 耦合 OpenClaw。L1-L4 可独立复用。

---

## Architecture · 架构一览

```
Layer · 层    Name · 名称       Files · 文件数
-----------  ---------------  ------
 L1          Infrastructure     25    SQLite (52 tables), IPC, WorkerPool (4 threads)
             基础设施                  数据库、IPC 桥接、4 线程工作池
 L2          Communication      13    MessageBus, pheromones, gossip, relay
             通信                      消息总线、信息素引擎、Gossip、中继
 L3          Agent              21    3-tier memory, reputation, SNA, HNSW embeddings
             代理                      三层记忆、声誉、SNA、HNSW 向量嵌入
 L4          Orchestration      25    DAG engine, contract-net, ABC, Shapley, modulator
             编排                      DAG 引擎、合同网、ABC、Shapley、调节器
 L5          Application        18    Plugin adapter, 10 tools (4 public), circuit breaker
             应用                      插件适配器、10 工具（4 公开）、熔断器
 L6          Monitoring       7+98   Dashboard (45+ REST), console SPA (98 files)
             监控                      Dashboard（45+ 端点）、控制台 SPA
```

Process model · 进程模型: `child_process.fork()` isolates SwarmCore from the Gateway. A 4-thread `WorkerPool` offloads ACO, k-means, HNSW, Shapley Monte Carlo from the main event loop.

`child_process.fork()` 将 SwarmCore 与 Gateway 隔离。4 线程工作池将 ACO、k-means、HNSW、Shapley 计算移出主事件循环。

→ [Architecture (EN)](docs/en/architecture.md) · [架构设计 (中文)](docs/zh-CN/architecture.md)

---

## Tools & Hooks · 工具与钩子

### Public Tools (4) · 公开工具

| Tool · 工具 | Purpose · 用途 |
|---|---|
| `swarm_run` | One-click plan + spawn + execute · 一键规划+生成+执行 |
| `swarm_query` | Read-only swarm state (10 scopes) · 蜂群状态只读查询（10 种范围） |
| `swarm_dispatch` | Dispatch task to sub-agent · 向指定子代理分派任务 |
| `swarm_checkpoint` | Pause for human approval · 暂停等待人工批准 |

6 internal tools (spawn, pheromone, gate, memory, plan, zone) serve orchestration hooks, not exposed to end users.

6 个内部工具服务于编排钩子，不暴露给终端用户。

**19 hooks** in `src/index.js`: 5 Tier-A (gateway, <0.1 ms) + 14 Tier-B (IPC to child process).

**19 个钩子**：5 个 Tier-A（Gateway 进程，<0.1 ms）+ 14 个 Tier-B（IPC 代理到子进程）。

→ [API Reference (EN)](docs/en/api-reference.md) · [API 参考 (中文)](docs/zh-CN/api-reference.md)

---

<a id="quick-start"></a>

## Quick Start · 快速开始

```bash
# 1. Install · 安装
npm install -g openclaw
git clone https://github.com/DEEP-IOS/claw-swarm.git
cd claw-swarm && node install.js

# 2. Start · 启动
openclaw gateway restart

# 3. Verify · 验证
openclaw gateway status
# → claw-swarm 7.0.0 enabled

# 4. Console · 控制台
# http://127.0.0.1:19100/v6/console
```

→ [Installation (EN)](docs/en/installation.md) · [安装配置 (中文)](docs/zh-CN/installation.md)

---

<a id="documentation"></a>

## Documentation · 文档导航

### English

| Guide | Description |
|---|---|
| [Architecture](docs/en/architecture.md) | 6-layer design, process model, dependency flow |
| [API Reference](docs/en/api-reference.md) | Tools, hooks, REST endpoints, SSE events |
| [Biomimicry](docs/en/biomimicry.md) | Algorithm catalog with source references |
| [Module Guide](docs/en/module-guide.md) | Per-module responsibility and interfaces |
| [Installation](docs/en/installation.md) | Setup, config, model compatibility |
| [FAQ](docs/en/faq-troubleshooting.md) | Common issues and solutions |
| [Console Guide](docs/en/console-guide.md) | Dashboard views, shortcuts, SSE |

### 中文文档

| 指南 | 描述 |
|---|---|
| [架构设计](docs/zh-CN/architecture.md) | 6 层设计、进程模型、依赖流向 |
| [API 参考](docs/zh-CN/api-reference.md) | 工具、钩子、REST 端点、SSE 事件 |
| [仿生学](docs/zh-CN/biomimicry.md) | 算法目录与源码锚点 |
| [模块指南](docs/zh-CN/module-guide.md) | 各模块职责与接口说明 |
| [安装配置](docs/zh-CN/installation.md) | 安装步骤、配置选项、模型兼容性 |
| [常见问题](docs/zh-CN/faq-troubleshooting.md) | 常见问题与故障排查 |
| [控制台指南](docs/zh-CN/console-guide.md) | 仪表盘视图、快捷键、SSE 连接 |

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

MIT License. Copyright 2025-2026 DEEP-IOS. See [LICENSE](LICENSE).
