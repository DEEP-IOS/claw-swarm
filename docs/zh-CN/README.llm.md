# Claw-Swarm — LLM 代理专用参考

> 本文档为 LLM 上下文窗口优化。包含理解和使用 Claw-Swarm 工具所需的最少信息。

## Claw-Swarm 是什么

OpenClaw 插件（V9.2.0），使用仿生算法协调多个 LLM 代理。在 OpenClaw Gateway 进程内运行。场中介耦合架构：7 个自治域通过 12 维连续信号场通信。

## 可用工具

你有 10 个工具：

### swarm_run
一键蜂群执行。自动分类意图（快思考/慢思考），将目标分解为 DAG，通过 8D MoE 路由选择模型，孵化子代理执行。

参数：
- `goal`（字符串，必填）：要完成的目标
- `mode`（枚举，可选）：`auto`（默认）、`plan_only`、`execute`、`cancel`、`resume`
- `planId`（字符串，可选）：`execute` 模式必填
- `maxRoles`（数字，可选）：最大子代理数（默认 5）

### swarm_query
蜂群状态只读查询。

参数：
- `scope`（枚举，必填）：`agents`、`tasks`、`field`、`health`、`budget`、`species`、`reputation`、`pheromones`、`channels`、`stigmergy`

### swarm_dispatch
向运行中的子代理转发消息。

参数：
- `agentId`（字符串，必填）：目标代理 ID
- `message`（字符串，必填）：消息内容

### swarm_checkpoint
在不可逆操作前暂停执行，请求用户批准。

参数：
- `question`（字符串，必填）：向用户提出的确认问题
- `taskId`（字符串，可选）：当前任务 ID

### swarm_spawn
直接孵化新代理（绕过孵化建议器）。

参数：
- `species`（字符串，必填）：角色类型（researcher、implementer、reviewer 等）
- `goal`（字符串，必填）：新代理的任务

### swarm_pheromone
信息素通信：沉积、读取或查询信息素信号。

参数：
- `action`（枚举，必填）：`deposit`、`read`、`types`、`stats`

### swarm_gate
证据门控质量审查。

参数：
- `action`（枚举，必填）：`evaluate`、`appeal`、`history`

### swarm_memory
语义记忆操作。

参数：
- `action`（枚举，必填）：`search`、`record`、`forget`、`stats`、`export`

### swarm_plan
DAG 计划管理。

参数：
- `action`（枚举，必填）：`view`、`modify`、`validate`、`cancel`

### swarm_zone
文件/资源区域管理。

参数：
- `action`（枚举，必填）：`detect`、`lock`、`unlock`、`list`

## 关键行为

- `swarm_run` 执行后，通过子代理孵化和 yield 回收结果
- 子代理在隔离会话中运行，拥有独立上下文
- 用 `swarm_query({ scope: "health" })` 检查系统健康
- 12 维信号场实现代理间无需直接通信的协调
- 六层容错：重试→熔断→疫苗→模型降级→重规划→流水线断路
- MoE 路由通过 8D 能力向量将任务需求匹配到最优模型

## 架构概要

121 个源文件，7 域架构。12 维信号场。27 个事件主题。16 个钩子。10 个工具。35+ 内置模型画像。58 个 REST 端点（端口 19100）以及 ConsoleDataBridge WebSocket（端口 19101）。

仪表盘：`http://127.0.0.1:19100/api/v9/health`
