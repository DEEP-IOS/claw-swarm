# Claw-Swarm — LLM 代理专用参考

> 本文档为 LLM 上下文窗口优化。包含理解和使用 Claw-Swarm 工具所需的最少信息。

## Claw-Swarm 是什么

OpenClaw 插件（V7.0.0），使用仿生算法协调多个 LLM 代理。通过 `child_process.fork()` 以子进程方式运行。

## 可用工具

你有 4 个工具：

### swarm_run
一键蜂群执行。将目标分解为子任务，生成子代理并行处理。

参数：
- `goal`（字符串，必填）：要完成的目标
- `mode`（枚举，可选）：`auto`（默认）、`plan_only`、`execute`、`cancel`、`resume`
- `planId`（字符串，可选）：`execute` 模式必填
- `maxRoles`（数字，可选）：最大子代理数（默认 5）

示例：`swarm_run({ goal: "重构认证模块", mode: "auto" })`

### swarm_query
蜂群状态只读查询。

参数：
- `scope`（枚举，必填）：`status`、`agent`、`task`、`agents`、`pheromones`、`memory`、`quality`、`zones`、`plans`、`board`
- `agentId`（字符串，可选）：用于 `agent` 范围
- `taskId`（字符串，可选）：用于 `task`/`quality` 范围
- `keyword`（字符串，可选）：用于 `memory`/`pheromones` 范围

示例：`swarm_query({ scope: "status" })`

### swarm_dispatch
向指定子代理直接分派任务。

参数：
- `agentId`（枚举，必填）：`mpu-d1`（侦察蜂）、`mpu-d2`（守卫蜂）、`mpu-d3`（工蜂）
- `task`（字符串，必填）：任务描述

### swarm_checkpoint
在不可逆操作前暂停执行，请求用户批准。

参数：
- `question`（字符串，必填）：向用户提出的确认问题
- `taskId`（字符串，可选）：当前任务 ID

## 代理角色

| 代理 ID | 角色 | 专长 |
|---------|------|------|
| mpu-d1 | 侦察蜂 | 调研、探索、信息收集 |
| mpu-d2 | 守卫蜂 | 审查、审计、质量验证 |
| mpu-d3 | 工蜂 | 编码、实现、测试 |
| mpu-d4 | 设计蜂 | UI、视觉、UX 设计 |

## 关键行为

- `swarm_run` 执行后，结果通过 `chat.inject` 异步回传
- 子代理在隔离会话中运行，拥有独立上下文
- 用 `swarm_query({ scope: "status" })` 检查执行进度
- 信息素信号实现代理间无需直接通信的协调
- 熔断器防止工具故障级联扩散

## 架构概要

173 个源文件，6 层架构（L1 基础设施 → L6 监控）。52 张数据库表。122 个事件主题。19 个钩子。

控制台：`http://127.0.0.1:19100/v6/console`
