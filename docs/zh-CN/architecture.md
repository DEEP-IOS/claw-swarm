# 架构设计

Claw-Swarm V7.0 作为 OpenClaw 插件运行，采用**基于 fork 的双层进程模型**。本文描述运行时架构、进程间通信和核心子系统，所有论述均锚定源码。

## 进程模型

```
  OpenClaw Gateway (Node.js)         Claw-Swarm 子进程 (fork)
  ┌──────────────────────────┐       ┌──────────────────────────────┐
  │  index.js (插件外壳)     │──IPC──│  swarm-core.js (SwarmCore)   │
  │  - Tier A hooks (热路径) │       │  - 全部 L1-L6 引擎           │
  │  - 熔断器缓存            │       │  - Tier B hooks (IPC 代理)   │
  │  - 模型能力映射           │       │  - 工具执行                  │
  │  - 路由决策               │       │  - DashboardService :19100   │
  │  - 子代理深度守卫         │       │  - WorkerPool (4线程)        │
  └──────────────────────────┘       └──────────────────────────────┘
```

Gateway 通过 `child_process.fork()` 启动 `swarm-core.js`，附带 IPC 通道（`src/index.js:167-215`）。此设计将引擎状态与 Gateway 主线程隔离。

- **Tier A hooks** 在 Gateway 进程中执行，使用缓存数据，延迟目标 <0.1 ms。示例：熔断器查询、模型能力检查、子代理并发守卫（`src/index.js:356-445`）。
- **Tier B hooks** 通过 IPC 代理到子进程，容忍 2-5 ms 延迟。示例：Prompt 构建、代理生命周期事件、合规检查（`src/index.js:448-559`）。

IPC 桥接（`src/L1-infrastructure/ipc-bridge.js`）使用请求/响应/通知协议，默认 5 秒超时，10,000 个待处理请求安全上限。

## 6 层架构

`src/` 下所有源代码按六层组织。每层仅依赖其下方的层。

| 层 | 目录 | 职责 | 文件数 |
|---|------|------|--------|
| L1 | `src/L1-infrastructure/` | 数据库、配置、日志、IPC、工作线程 | 25 |
| L2 | `src/L2-communication/` | 消息总线、信息素、Gossip、中继客户端 | 13 |
| L3 | `src/L3-agent/` | 能力、记忆（工作/情景/语义）、声誉、进化 | 21 |
| L4 | `src/L4-orchestration/` | DAG 引擎、合同网、调度、质量门、角色 | 25 |
| L5 | `src/L5-application/` | 插件适配器、工具（4 公开 + 6 内部）、熔断器、弹性 | 18 |
| L6 | `src/L6-monitoring/` | Dashboard REST API (45+ 端点)、SSE 广播、指标、健康检查 | 7 + 98 控制台 |

总计：173 个 JavaScript 源文件。

## Hook 注册

插件外壳注册 19 个 hooks（`src/index.js`），分为两层：

**Tier A（Gateway 进程，5 个 hooks）：**

| Hook | 优先级 | 用途 | 行号 |
|------|--------|------|------|
| `before_model_resolve` | 20 | 模型能力缓存查询 | 360-376 |
| `before_tool_call` | 12 | SwarmGuard：在 swarm_run 之前阻止非蜂群工具 | 443-445 |
| `before_tool_call` | 10 | 熔断器状态检查 | 379-391 |
| `before_tool_call` | 8 | 路由决策门控 | 394-410 |
| `subagent_spawning` | 10 | 深度/并发验证（最大深度 5，最大并发 10） | 413-438 |

**Tier B（IPC 代理到子进程，14 个 hooks）：**

`before_prompt_build` (x3)、`before_agent_start`、`agent_end`、`after_tool_call`、`before_reset`、`message_sending`、`subagent_spawned`、`subagent_ended`、`llm_output` 等。

## 子代理生成：DirectSpawnClient

子代理创建绕过插件 API，通过 Gateway 内部 WebSocket RPC 直连（`src/L2-communication/swarm-relay-client.js`）。

**流程：**

1. `swarm_run` 工具生成包含多个阶段的执行计划。
2. 每个阶段通过 `callGateway({ method: 'agent', lane: 'subagent', spawnedBy: parentKey })` 创建子会话。
3. 生成立即返回（两阶段异步），父会话继续执行。
4. 后台每 5 秒轮询子会话状态。
5. 完成后，`chat.inject` 将结果推送到父会话转录，零 LLM 成本。

**认证：** WebSocket 质询-响应，含 nonce。角色：`operator.admin`（`swarm-relay-client.js:773-867`）。

## 引擎初始化顺序

所有引擎在 `src/L5-application/plugin-adapter.js` 中通过依赖注入组装：

```
L1 (Database, Config, Clock, WorkerPool)
  → L2 (MessageBus, PheromoneEngine, GossipProtocol, StigmergicBoard)
    → L3 (记忆系统, Reputation, Capability, Persona, SNA)
      → L4 (Orchestrator, DAG, ContractNet, ABC, Quality, Budget, Shapley)
        → L5 (PluginAdapter, ToolResilience, SkillGovernor)
```

销毁按相反顺序执行。`engines` 对象与 `DashboardService` 共享以提供实时引用。

## 事件系统

`MessageBus`（`src/L2-communication/message-bus.js`）提供基于主题的发布/订阅，支持通配符（`topic.*`）、死信队列和可插拔传输层。122 个事件主题定义在 `src/event-catalog.js` 中。

`StateBroadcaster`（`src/L6-monitoring/state-broadcaster.js`）订阅相关主题并通过 `/events` 端点以 SSE 事件流推送到已连接的控制台客户端。

## 控制台前端

React SPA，在端口 19100 的 `/v6/console` 路径提供服务（`src/L6-monitoring/console/src/App.jsx`）。98 个源文件，6 个视图：

| 视图 | 组件 | 功能 |
|------|------|------|
| Hive | `HiveOverlay` | 基于 Canvas 的蜂群活动可视化 |
| Pipeline | `PipelineOverlay` | DAG 执行进度和合同生命周期 |
| Cognition | `CognitionOverlay` | 双过程路由和信号权重 |
| Ecology | `EcologyOverlay` | Shapley 信用分配和种群进化 |
| Network | `NetworkOverlay` | SNA 图谱与中心性指标 |
| Control | `ControlOverlay` | RED 指标、预算、熔断器状态 |

状态管理：Zustand。实时更新：SSE 通过 `sse-client.js`。UI 功能：命令面板（Ctrl+K）、事件时间线（带回放）、Inspector 面板、Toast 通知。

## 7 层可靠性链

| 层 | 机制 | 文件 |
|---|------|------|
| 1 | 系统提示注入 via `prependSystemContext`（XML 标签） | `swarm-core.js` |
| 2 | `before_tool_call` SwarmGuard (p12) 在 swarm_run 之前阻止非蜂群工具 | `index.js` |
| 3 | 会话级 `_lastSuccessfulInjectResults` Map 用于 IPC 故障回退 | `index.js` + `swarm-core.js` |
| 4 | `_swarmCoreReady` 标志：初始化前工具返回 `{status:'not_ready'}` | `index.js` |
| 5 | 生成失败直接推送错误到父会话（不静默孤立） | `swarm-run-tool.js` |
| 6 | `_injectWithRetry`：最多 3 次重试，指数退避（500ms / 1s / 2s） | `swarm-core.js` |
| 7 | LLM 输出合规检查 + 升级计数器 + 下轮 Prompt 升级 | `swarm-core.js` |

## 特性标志

特性标志依赖树（`src/index.js:110-118`）：

```
dagEngine ← hierarchical
speculativeExecution ← dagEngine
workStealing ← dagEngine
evolution.clustering ← evolution.scoring
evolution.gep ← evolution.scoring
evolution.abc ← evolution.scoring
evolution.lotkaVolterra ← evolution.scoring
```

Gateway 启动时验证。缺少依赖将阻止激活。

## 关键常量

| 常量 | 值 | 位置 |
|------|---|------|
| 最大子代理并发数 | 10 | `index.js:97` |
| 最大子代理深度 | 5 | `index.js:98` |
| IPC 默认超时 | 5,000 ms | `index.js:183` |
| 最近事件缓冲区 | 20 | `swarm-core.js:131` |
| 最大 IPC 待处理请求 | 10,000 | `ipc-bridge.js:29` |
| Dashboard 端口 | 19,100 | `dashboard-service.js:69` |
| Gateway 端口 | 18,789 | OpenClaw 配置 |
| 工作线程池大小 | 4 | `worker-pool.js:34` |

---
[← 返回 README](../../README.md) | [English](../en/architecture.md)
