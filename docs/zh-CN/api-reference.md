# API 参考

本文档涵盖 Claw-Swarm V7.0 的公开工具接口、事件目录和 REST API 端点。所有计数和模式均来源于源代码。

## 公开工具（4 个）

Claw-Swarm 向 LLM 代理暴露 4 个公开工具。另有 6 个内部工具用于自动化 hook（已废弃直接调用，功能并入钩子）。工具文件位于 `src/L5-application/tools/`。

### swarm_run

**文件：** `src/L5-application/tools/swarm-run-tool.js`

一键蜂群协作。将目标分解为子任务，选择角色，调度子代理并行执行。

**参数：**

| 名称 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `goal` | string | 是 | 目标描述 |
| `mode` | enum | 否 | `auto`（默认）、`plan_only`、`execute`、`cancel`、`resume` |
| `planId` | string | 否 | 计划 ID（`execute` 模式必填） |
| `dagId` | string | 否 | DAG ID（`cancel` 模式可用） |
| `taskId` | string | 否 | 任务 ID（`cancel` 模式可用） |
| `maxRoles` | number | 否 | 最大角色数（默认 5） |

**模式说明：**

- **auto**：设计执行计划 + 立即通过 DirectSpawnClient 调度所有阶段。
- **plan_only**：仅设计计划，不生成代理。
- **execute**：对已有计划（通过 `planId`）执行调度。
- **cancel**：取消运行中的任务或 DAG。
- **resume**：恢复已暂停的计划（如检查点批准后）。

**角色映射**（行 74-112）：

| 代理 ID | 角色 | 关键词 |
|---------|------|--------|
| mpu-d3 | 工蜂 | coding, implementation, engineering, testing |
| mpu-d2 | 守卫蜂 | review, audit, verification, analysis, architecture |
| mpu-d1 | 侦察蜂 | research, search, exploration |
| mpu-d4 | 设计蜂 | design, UI, visual, UX |

### swarm_query

**文件：** `src/L5-application/tools/swarm-query-tool.js`

蜂群状态只读查询。10 个范围覆盖代理、任务、信息素、记忆、质量、区域、计划和痕迹协作板。

**参数：**

| 名称 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `scope` | enum | 是 | `status`、`agent`、`task`、`agents`、`pheromones`、`memory`、`quality`、`zones`、`plans`、`board` |
| `agentId` | string | 否 | 代理 ID（`agent` 范围） |
| `taskId` | string | 否 | 任务 ID（`task`/`quality` 范围） |
| `keyword` | string | 否 | 搜索关键词（`memory`/`pheromones` 范围） |
| `crossAgent` | boolean | 否 | 跨代理全局召回（`memory` 范围） |
| `limit` | number | 否 | 最大结果数 |

### swarm_dispatch

**文件：** `src/L5-application/tools/swarm-dispatch-tool.js`

向指定子代理分派任务。

| 名称 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `agentId` | enum | 是 | `mpu-d1`（侦察）、`mpu-d2`（守卫）、`mpu-d3`（工蜂） |
| `task` | string | 是 | 子代理的任务描述 |

### swarm_checkpoint

**文件：** `src/L5-application/tools/swarm-checkpoint-tool.js`（V7.1）

人在回路检查点。子代理在不可逆操作前调用此工具请求用户批准。

| 名称 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `question` | string | 是 | 确认问题，描述操作及影响 |
| `taskId` | string | 否 | 当前任务 ID |
| `phaseRole` | string | 否 | 当前角色 |
| `phaseDesc` | string | 否 | 阶段描述 |
| `originalGoal` | string | 否 | 原始用户目标 |

**工作流：** 子代理调用 → 检查点写入数据库 → 子代理 STOP → 父会话收到问题 → 用户回复 → 下次 swarm_run 自动检测并恢复。

## 内部工具（6 个，已废弃）

| 工具 | 文件 | 功能已吸收至 |
|------|------|-------------|
| `swarm_gate` | `swarm-gate-tool.js` | 自动质量 hooks |
| `swarm_memory` | `swarm-memory-tool.js` | `swarm_query` memory 范围 |
| `swarm_pheromone` | `swarm-pheromone-tool.js` | 自动信息素 hooks |
| `swarm_plan` | `swarm-plan-tool.js` | `swarm_run` auto 模式 |
| `swarm_spawn` | `swarm-spawn-tool.js` | `swarm_run` 调度 |
| `swarm_zone` | `swarm-zone-tool.js` | 自动区域 hooks |

## 事件目录

来源：`src/event-catalog.js` — 122 个事件主题。

| 类别 | 数量 | 示例 |
|------|------|------|
| 代理生命周期 | 5 | `agent.registered`、`agent.online`、`agent.end` |
| 任务生命周期 | 8 | `task.created`、`task.completed`、`task.failed` |
| 信息素 | 7 | `pheromone.deposited`、`pheromone.decayed` |
| 熔断器 | 2 | `circuit_breaker.transition` |
| 合同网 | 5 | `model.bid.awarded`、`live.cfp.completed` |
| 自适应闭环 | 10 | `signal.weights.calibrated` |
| V7.0 闭环 | 11 | `session.patched`、`pi.controller.actuated` |
| 其他 | 74 | 系统、追踪、冲突、进化等 |

## REST API 端点

来源：`src/L6-monitoring/dashboard-service.js` — 端口 19100。

### 核心（3 个）

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/metrics` | RED 指标 + hook 统计 |
| GET | `/api/stats` | 系统统计 |
| GET | `/events` | SSE 事件流 |

### 扩展端点（36+）

包括追踪、拓扑、亲和、死信、熔断器、DAG 状态、治理、子代理统计、SNA、Shapley、双过程、失败模式、预算预测、质量审计、代理状态、会话管理、信号权重、PI 控制器、ABC 角色、种群配置、冷启动、竞标历史等端点。

详见英文版 [API Reference](../en/api-reference.md) 获取完整端点列表。

### Dashboard 路由（4 个）

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/` | V1 静态 Dashboard |
| GET | `/v2` | V2 蜂巢可视化 |
| GET | `/v6/console` | V7 React SPA 控制台 |
| GET | `/v6/console/*` | 控制台静态资源 |

---
[← 返回 README](../../README.md) | [English](../en/api-reference.md)
