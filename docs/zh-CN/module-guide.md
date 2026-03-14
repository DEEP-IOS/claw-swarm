# 模块指南 (L1-L6)

Claw-Swarm V7.0 包含 173 个 JavaScript 源文件，按 6 层组织。本指南列出每个模块的用途及其解决的问题。层依赖仅向下：L6 可依赖 L5，但 L2 不依赖 L3。

> **注：** 本中文版对各层模块采用精简分组格式。如需查看每层的详细 ### 子分类（如 L1 的 Database/Repositories/Schemas/Core Services/Workers 等），请参阅 [English version](../en/module-guide.md)。

## L1：基础设施（25 个文件）

数据持久化、配置、日志、IPC、并行计算。

**数据库：** `database-manager.js`（SQLite3 WAL）、`migration-runner.js`（渐进式迁移到 V9）、`sqlite-binding.js`。
**仓库（9个）：** agent-repo、task-repo、pheromone-repo、episodic-repo、knowledge-repo、plan-repo、pheromone-type-repo、user-checkpoint-repo（V7.1）、zone-repo。
**模式（3个）：** database-schemas（52表DDL）、config-schemas（Zod验证）、message-schemas。
**核心服务：** ipc-bridge（RPC-over-IPC）、logger（Pino）、monotonic-clock、worker-pool（4线程）、types。
**工作线程（4个）：** aco-worker、compute-worker、shapley-worker、vector-worker。

## L2：通信（13 个文件）

代理间消息传递和痕迹协作。

| 模块 | 用途 |
|------|------|
| `message-bus.js` | 主题发布/订阅，通配符，死信队列 |
| `pheromone-engine.js` | MMAS 信息素管理，7 种类型，ACO 路径选择 |
| `gossip-protocol.js` | SWIM 故障检测 + 记忆/信息素快照共享 |
| `stigmergic-board.js` | 持久化全局公告板 |
| `swarm-relay-client.js` | DirectSpawnClient：WebSocket RPC 子代理创建 |
| `state-convergence.js` | 反熵同步，最终一致性 |
| 其他 | pheromone-response-matrix、pheromone-type-registry、protocol-semantics、3 个传输层 |

## L3：代理（21 个文件）

个体代理智能、记忆、声誉、行为适应。

**评估与进化：** agent-lifecycle（8 状态FSM）、capability-engine（8D评估）、reputation-ledger（5D评分）、persona-evolution（GEP进化）、soul-designer、skill-symbiosis、sna-analyzer、response-threshold（PI控制器）。
**异常与韧性：** anomaly-detector、failure-mode-analyzer、failure-vaccination、negative-selection、evidence-gate。
**记忆：** working-memory（3层）、episodic-memory（Ebbinghaus）、semantic-memory（知识图谱）、context-compressor。
**检索与嵌入：** embedding-engine（双模式384D/1536D）、vector-index（HNSW）、hybrid-retrieval（6D）、swarm-context-engine。

## L4：编排（25 个文件）

任务协调、调度、质量控制、资源管理。

**核心编排：** orchestrator、task-dag-engine、execution-planner（MoE Top-k）、hierarchical-coordinator、replan-engine、pipeline-breaker。
**调度与分配：** contract-net（FIPA CNP）、abc-scheduler（三角色）、dual-process-router（S1/S2）、speculative-executor、critical-path（CPM）。
**质量与治理：** quality-controller（3级门）、budget-tracker（5D）、budget-forecaster、governance-metrics、conflict-resolver（3级）。
**代理管理：** zone-manager、role-manager、role-discovery（k-means++）、species-evolver。
**信号处理：** global-modulator（4模式）、shapley-credit（MC）、signal-calibrator（MI）、swarm-advisor、result-synthesizer。

## L5：应用（18 个文件）

用户面向工具和 OpenClaw API 集成。**唯一与 OpenClaw 耦合的层。**

**核心服务（8个）：** plugin-adapter（19 hook + 10工具注册）、circuit-breaker（3状态）、tool-resilience、token-budget-tracker、skill-governor、context-service、progress-tracker、subagent-failure-message。
**工具（10个）：** 4 公开（swarm_run/query/dispatch/checkpoint）+ 6 内部（已废弃）。详见 [API 参考](api-reference.md)。

## L6：监控（7 + 98 个控制台文件）

实时监控和 React SPA 控制台。

**服务（7个）：** dashboard-service（Fastify 45+ 端点）、metrics-collector（RED）、state-broadcaster（SSE 100ms批次）、health-checker（0-100评分）、observability-core、startup-diagnostics、trace-collector。
**控制台 SPA（98个文件）：** React 18 + Zustand，6 视图，Canvas + DOM 渲染，~112KB gzip。

## 根级别（3 个文件）

| 模块 | 用途 |
|------|------|
| `swarm-core.js` | 子进程入口（~2000 行），全部引擎初始化 |
| `index.js` | 插件外壳（~650 行），19 个 hook，Tier A 缓存 |
| `event-catalog.js` | 122 个事件主题定义 |

---
[← 返回 README](../../README.md) | [English](../en/module-guide.md)
