# API 参考

[<- 返回 README](../../README.zh-CN.md) | [English](../en/api-reference.md)

本文档涵盖 Claw-Swarm V9 的完整公开接口：10 个工具、16 个 Hook、27 个事件、58 个 REST 端点、控制台使用的 WebSocket bridge，以及仍然保留的 SSE 事件流。所有计数、schema 和返回值均直接来源于源代码。

---

## 目录

1. [工具 (10 个)](#工具)
   - [swarm_run](#swarm_run) | [swarm_query](#swarm_query) | [swarm_dispatch](#swarm_dispatch) | [swarm_checkpoint](#swarm_checkpoint) | [swarm_spawn](#swarm_spawn)
   - [swarm_pheromone](#swarm_pheromone) | [swarm_gate](#swarm_gate) | [swarm_memory](#swarm_memory) | [swarm_plan](#swarm_plan) | [swarm_zone](#swarm_zone)
2. [Hooks (16 个)](#hooks)
3. [事件目录 (27 个)](#事件目录)
4. [REST 端点 (58)](#rest-端点)
5. [SSE 事件流](#sse-事件流)

---

## 工具

全部 10 个工具位于 `src/bridge/tools/`。每个工具遵循 OpenClaw 插件 API：`execute(toolCallId, params)` 返回 `{ content: [{ type: 'text', text: JSON.stringify(result) }] }`。

---

### swarm_run

**文件：** `src/bridge/tools/run-tool.js`

全流水线任务执行。该工具会先分类意图、估计 scope，再向编排层询问当前任务是否可以走快路径。只有在确实存在可用答案时才返回 `direct_reply`。如果 System 1 被选中但没有可用答案，`swarm_run` 会回退到审慎调度流水线，而不是凭空伪造完整回复。

**参数：**

| 名称 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `task` | string | **是** | -- | 要执行的任务描述 |
| `role` | string | 否 | 自动选择 | 指定代理角色（绕过 SpawnAdvisor） |
| `model` | string | 否 | `balanced` | 指定 LLM 模型 |
| `background` | boolean | 否 | `false` | 在后台运行，不阻塞 |
| `cancel` | string | 否 | -- | 通过代理 ID 取消运行中的代理 |
| `resume` | string | 否 | -- | 通过代理 ID 恢复暂停的代理 |

**执行流程：**

```
1. IntentClassifier.classifyIntent(task) -> { primary, confidence, keywords }
   已识别的意图类型（8 种）：
   | 意图 | 节点数 | 模板 |
   |------|--------|------|
   | bug_fix | 3 | diagnose → fix → test |
   | new_feature | 5 | research → plan → [backend, frontend] → review |
   | refactor | 5 | analyze → plan → [core, tests] → verify |
   | optimize | 3 | profile → implement → benchmark |
   | explore | 3 | gather → synthesize → report |
   | analyze | 4 | collect → [quant, qual] → conclude |
   | content | 4 | [facts, style] → draft → review |
   | question | 1 | answer |
2. ScopeEstimator.estimateScope(intent, { scope }) -> scope estimate
3. orchestration.routeTask(intent, scopeEstimate)
   - 如果是 System 1 且 router 已提供答案 -> 直接回复
   - 如果是 System 1 且命中确定性快回复助手 -> 直接回复
   - 否则继续进入审慎调度
4. PlanEngine.createPlan(intent, scope) -> { dagId, suggestedRole, timeBudgetMs }
5. SpawnAdvisor.adviseSpawn(scope, role) -> { role, reason, parallelism }
6. ImmunitySystem.checkImmunity(task) -> { immune, preventionPrompts, riskScore }
7. PromptArchitect.buildPrompt(role, context) -> prompt 字符串
8. orchestration.selectTools(role, intent) -> tools[]
9. SpawnClient.spawn({ role, model, prompt, tools, label, dagId, scope })
10. PipelineTracker.startPipelineTracking(dagId, timeBudgetMs)
11. 向 field 和 bus 写入 task 创建遥测
```

**返回值 (S2 已调度)：**

```json
{
  "status": "dispatched",
  "agentId": "run-impl-abc123",
  "role": "implementer",
  "reason": "default assignment",
  "dagId": "dag-1710590400000",
  "intent": "coding",
  "confidence": 0.85,
  "system": 2,
  "background": false,
  "immuneWarnings": 0,
  "routeFallback": "system1_unanswered"
}
```

**返回值 (S1 直接回复)：**

```json
{
  "status": "direct_reply",
  "answer": "6*7 = 42",
  "confidence": 0.92,
  "system": 1
}
```

**返回值 (取消)：**

```json
{
  "status": "cancelled",
  "agentId": "run-impl-abc123",
  "detail": "Agent cancellation requested"
}
```

---

### swarm_query

**文件：** `src/bridge/tools/query-tool.js` (320 行)

统一只读查询接口，16 个查询范围：`status`、`plan`、`agents`、`tasks`、`health`、`budget`、`species`、`pheromones`、`channels`、`stigmergy`、`reputation`、`memory`、`progress`、`cost`、`artifacts`、`field`。

**参数：**

| 名称 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `scope` | enum | **是** | -- | 查询范围（见下表） |
| `dagId` | string | 否 | -- | DAG ID（用于 `plan`、`progress`、`cost`、`artifacts` 范围） |
| `query` | string | 否 | -- | 搜索查询（用于 `memory` 范围） |

**16 个查询范围：**

| 范围 | 描述 | 必需参数 | 主要返回字段 |
|------|------|---------|-------------|
| `status` | 蜂群总览 | -- | `activeAgents`、`agents[]`、`activePipelines`、`budget`、`field` |
| `plan` | DAG 计划详情 | `dagId` | `nodes[]`、`edges[]`、`state`、`summary` |
| `agents` | 所有活跃代理 | -- | `count`、`agents[].{id, role, model, state, dagId, tokensUsed}` |
| `tasks` | 活跃 DAG/任务摘要 | -- | `count`、`tasks[].{id, dagId, state, summary, nodeCount, edgeCount}` |
| `health` | Observe 域健康状态 | -- | `status`、`score`、`dimensions`、`ts` |
| `budget` | 预算跟踪器状态 | -- | `dagCount`、`dags[]`、`global.{totalSession, spent, remaining, utilization}` |
| `species` | 物种/自适应状态 | -- | species-evolver 快照 |
| `pheromones` | 信息素轨迹 | -- | `activeTypes[]`、`totalDeposits`、`trails[]` |
| `channels` | 活跃通信通道 | -- | `count`、`channels[]` |
| `stigmergy` | 痕迹协作板条目 | -- | `boardScope`、`count`、`entries[]` |
| `reputation` | 代理声誉 | -- | `globalScore`、`agents[].{id, score, tasksCompleted, failureRate}` |
| `memory` | 语义搜索 | `query` | `entries[].{id, type, content, relevance, createdAt, source}` |
| `progress` | 流水线进度 | `dagId` | `completedNodes`、`totalNodes`、`percentage`、`state`、`elapsed`、`remainingBudget`、`blockers[]` |
| `cost` | 预算使用 | -- | `totalSpent`、`totalSession`、`remaining`、`utilization`、`dagCount`、`dags[]` |
| `artifacts` | DAG 产出物 | `dagId` | `artifacts[].{id, type, name, path, size, producedBy}` |
| `field` | 12 维信号场 | -- | `dimensions{}`（12 维）、`dimensionsCount`、`supportedDimensions[]`、`totalSignals` |

**12 个场维度：**

| 维度 | 描述 |
|------|------|
| `trail` | 执行轨迹、路径跟随与历史路线线索 |
| `alarm` | 异常、故障与紧急告警信号 |
| `reputation` | 代理长期表现形成的信誉强度 |
| `task` | 任务创建、推进与完成压力 |
| `knowledge` | 发现事实、检索记忆与共享知识密度 |
| `coordination` | 多代理同步、委派和协作强度 |
| `emotion` | 代理情绪、压力与主观负荷信号 |
| `trust` | 对输出与协作者的信任程度 |
| `sna` | 协作网络结构与中介中心性线索 |
| `learning` | 从结果中获得的能力提升与学习信号 |
| `calibration` | 参数校准、置信度调整与系统调优信号 |
| `species` | 角色进化、群体分化与种群动态信号 |

**返回值 (status 范围)：**

```json
{
  "scope": "status",
  "activeAgents": 3,
  "agents": [
    { "id": "agent-a1", "role": "implementer", "state": "running", "elapsed": 45000 }
  ],
  "activePipelines": 1,
  "budget": { "used": 15000, "limit": 100000 },
  "field": { "dimensions": 12 },
  "timestamp": 1710590400000
}
```

---

### swarm_dispatch

**文件：** `src/bridge/tools/dispatch-tool.js` (148 行)

通过 MessageBus 向运行中的代理转发带优先级的消息。当总线不可用时回退到直接 IPC。每次分派都会沉积一条信息素轨迹。

**参数：**

| 名称 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `agentId` | string | **是** | -- | 目标代理 ID |
| `message` | string | **是** | -- | 要分派的消息内容 |
| `priority` | enum | 否 | `normal` | 优先级：`low` (1)、`normal` (5)、`high` (8)、`critical` (10) |

**传递通道：**

| 通道 | 优先级 | 描述 |
|------|--------|------|
| `message_bus` | 首选 | 通过 `core.communication.send()` |
| `ipc_direct` | 回退 | 总线失败时通过 `spawnClient.sendMessage()` |

**返回值：**

```json
{
  "status": "dispatched",
  "messageId": "msg-1710590400000-x7k2m9",
  "agentId": "agent-a1",
  "priority": "high",
  "channel": "message_bus",
  "timestamp": 1710590400000
}
```

---

### swarm_checkpoint

**文件：** `src/bridge/tools/checkpoint-tool.js` (232 行)

人在回路 (Human-in-the-Loop) 检查点管理。三个动作：`create`（暂停代理）、`resolve`（携带用户决定恢复）、`list`（查看待处理检查点）。

**参数：**

| 名称 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `action` | enum | **是** | -- | `create`、`resolve` 或 `list` |
| `checkpointId` | string | resolve | -- | 检查点 ID（`resolve` 时必填） |
| `resolution` | string | resolve | -- | 用户决定文本（`resolve` 时必填） |
| `agentId` | string | 否 | `unknown` | 创建检查点的代理 |
| `reason` | string | 否 | `Checkpoint requested` | 创建检查点的原因 |
| `options` | string[] | 否 | `[]` | 供用户选择的建议选项 |

**工作流：**

```
create:
  1. 生成检查点 ID (cp-{timestamp}-{random})
  2. 持久化到 DomainStore
  3. 发射场信号 "checkpoint.created"
  4. 返回 STOP 指令 -> 代理必须暂停

resolve:
  1. 从 store 检索检查点
  2. 更新状态为 "resolved"
  3. 发射场信号 "checkpoint.resolved"
  4. 通过 spawnClient.resume() 恢复代理
  5. 通过通信总线通知

list:
  1. 查询所有待处理（未解决）检查点
  2. 按创建时间排序（最新在前）
```

**返回值 (create)：**

```json
{
  "status": "checkpoint_created",
  "checkpointId": "cp-1710590400000-a3b7x2",
  "agentId": "agent-a1",
  "reason": "破坏性文件删除需要审批",
  "options": ["approve", "reject", "modify"],
  "instruction": "STOP - Agent must pause and await user resolution"
}
```

**返回值 (resolve)：**

```json
{
  "status": "resolved",
  "checkpointId": "cp-1710590400000-a3b7x2",
  "agentId": "agent-a1",
  "resolution": "已批准并附带修改",
  "agentResumed": true,
  "resolvedAt": 1710590500000
}
```

---

### swarm_spawn

**文件：** `src/bridge/tools/spawn-tool.js` (186 行)

直接生成代理，绕过 SpawnAdvisor、DualProcessRouter、意图分类、DAG 规划和 ImmunitySystem 检查。当需要对角色、模型和工具进行精确控制时使用。

**参数：**

| 名称 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `role` | string | **是** | -- | 代理角色（见内置角色表） |
| `model` | string | **是** | -- | LLM 模型（`fast`、`balanced`、`strong`） |
| `task` | string | **是** | -- | 任务描述 |
| `tools` | string[] | 否 | 角色默认 | 显式工具列表（覆盖角色默认值） |
| `prompt` | string | 否 | 自动生成 | 自定义提示词（覆盖 PromptArchitect） |
| `context` | object | 否 | -- | 合并到提示词的额外上下文 |
| `background` | boolean | 否 | `false` | 在后台运行，不阻塞 |

**内置角色及默认工具：**

| 角色 | 默认工具 | 描述 |
|------|---------|------|
| `implementer` | `file_read`、`file_write`、`bash` | 代码实现 |
| `reviewer` | `file_read`、`bash` | 代码审查和分析 |
| `researcher` | `file_read`、`web_search` | 信息收集 |
| `planner` | `file_read` | 任务规划和分解 |
| `tester` | `file_read`、`bash` | 测试和验证 |
| `debugger` | `file_read`、`file_write`、`bash` | Bug 诊断和修复 |
| `documenter` | `file_read`、`file_write` | 文档撰写 |
| `architect` | `file_read` | 架构设计和决策 |

**返回值：**

```json
{
  "status": "spawned",
  "agentId": "spawn-impl-abc123",
  "role": "implementer",
  "model": "balanced",
  "tools": ["file_read", "file_write", "bash"],
  "background": false,
  "direct": true,
  "label": "Fix authentication bug"
}
```

---

### swarm_pheromone

**文件：** `src/bridge/tools/pheromone-tool.js` (242 行)

信息素痕迹通信。四个动作：`deposit`（沉积）、`read`（读取）、`types`（类型列表）、`stats`（统计）。

**参数：**

| 名称 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `action` | enum | **是** | -- | `deposit`、`read`、`types` 或 `stats` |
| `type` | string | deposit | -- | 信息素类型（`deposit` 时必填） |
| `scope` | string | 否 | 会话范围 | 轨迹的范围/位置 |
| `intensity` | number | 否 | `0.5` | 信号强度 [0.0, 1.0] |
| `metadata` | object | 否 | `{}` | 附加的元数据 |
| `message` | string | 否 | `""` | 人类可读消息 |

**6 种 canonical 信息素类型 + 兼容旧别名：**

| Canonical 类型 | 衰减速率 | 描述 | 接受的旧别名 |
|------|---------|------|---------------|
| `trail` | 0.008 | 路径 / 进度轨迹 | `progress`、`dependency` |
| `alarm` | 0.15 | 警报 / 异常信号 | `warning`、`failure`、`conflict` |
| `recruit` | 0.03 | 招募 / 协助请求 | `collaboration`、`dispatch` |
| `queen` | 0.005 | 全局指令信号 | `checkpoint` |
| `dance` | 0.02 | 知识发现信号 | `discovery` |
| `food` | 0.006 | 高质量结果标记 | `success` |

为兼容旧接口，工具输入仍接受历史别名；但运行时 registry 已统一收口为上表 6 种 canonical type。

**返回值 (deposit)：**

```json
{
  "status": "deposited",
  "trailId": "ph-1710590400000-k9m3x7",
  "type": "success",
  "canonicalType": "food",
  "scope": "default",
  "intensity": 0.8,
  "decay": 0.006
}
```

**返回值 (read)：**

```json
{
  "status": "ok",
  "action": "read",
  "scope": "default",
  "typeFilter": "all",
  "count": 5,
  "trails": [
    {
      "id": "ph-...",
      "type": "progress",
      "canonicalType": "trail",
      "scope": "default",
      "intensity": 0.7,
      "message": "Phase 1 complete",
      "depositor": "bridge",
      "depositedAt": 1710590400000,
      "age": 30000
    }
  ]
}
```

**返回值 (stats)：**

```json
{
  "status": "ok",
  "action": "stats",
  "scope": "default",
  "totalActive": 12,
  "byType": { "trail": 5, "food": 3, "alarm": 4 },
  "averageIntensity": 0.62,
  "oldestTrail": 1710580000000
}
```

---

### swarm_gate

**文件：** `src/bridge/tools/gate-tool.js` (261 行)

基于证据的质量门控。三个动作：`evaluate`（提交声明和证据评估）、`appeal`（补充证据申诉）、`history`（查看历史评估）。

**参数：**

| 名称 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `action` | enum | **是** | -- | `evaluate`、`appeal` 或 `history` |
| `claim` | object | evaluate | -- | 待评估的声明（见 schema） |
| `evidences` | array | evaluate/appeal | -- | 证据条目（见 schema） |
| `evaluationId` | string | appeal | -- | 要申诉的先前评估 ID |
| `limit` | number | 否 | `20` | 历史条目最大返回数 |

**声明 (claim) Schema：**

| 字段 | 类型 | 描述 |
|------|------|------|
| `type` | string | 声明类型（`task_complete`、`quality_met`、`test_passed`） |
| `description` | string | 声明的具体内容 |
| `agentId` | string | 提出声明的代理 |
| `dagId` | string | 关联的 DAG ID |

**证据 (evidence) Schema：**

| 字段 | 类型 | 描述 |
|------|------|------|
| `type` | string | 证据类型（`test_result`、`code_review`、`metric`、`user_feedback`） |
| `content` | string | 证据内容或引用 |
| `weight` | number | 证据权重 [0.0, 1.0]（默认 0.5） |

**评估阈值：**

| 动作 | 阈值 | 描述 |
|------|------|------|
| `evaluate` | 0.6 | 证据权重加权平均必须达到此值 |
| `appeal` | 0.5 | 申诉使用更低阈值（二次机会） |

**返回值 (evaluate)：**

```json
{
  "status": "evaluated",
  "evaluationId": "eval-1710590400000-p2k8m3",
  "passed": true,
  "score": 0.78,
  "threshold": 0.6,
  "reasoning": "Evidence score 0.78 meets threshold",
  "gaps": [],
  "evidenceCount": 3
}
```

---

### swarm_memory

**文件：** `src/bridge/tools/memory-tool.js` (238 行)

语义记忆 CRUD 操作。五个动作：`search`（搜索）、`record`（记录）、`forget`（遗忘）、`stats`（统计）、`export`（导出）。

**参数：**

| 名称 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `action` | enum | **是** | -- | `search`、`record`、`forget`、`stats` 或 `export` |
| `query` | string | search | -- | 搜索查询（`search` 时必填） |
| `content` | string | record | -- | 要存储的内容（`record` 时必填） |
| `type` | string | 否 | `general` | 记忆条目类型（`fact`、`decision`、`lesson`、`pattern`） |
| `memoryId` | string | forget | -- | 记忆条目 ID（`forget` 时必填） |
| `tags` | string[] | 否 | `[]` | 分类标签 |
| `limit` | number | 否 | 20/100 | 最大结果数（search 为 20，export 为 100） |

**返回值 (search)：**

```json
{
  "status": "ok",
  "action": "search",
  "query": "authentication flow",
  "count": 3,
  "entries": [
    {
      "id": "mem-1710590400000-x3k7p2",
      "type": "lesson",
      "content": "OAuth2 flow requires PKCE for public clients",
      "relevance": 0.89,
      "tags": ["auth", "security"],
      "source": "bridge",
      "createdAt": 1710580000000
    }
  ]
}
```

**返回值 (record)：**

```json
{
  "status": "recorded",
  "memoryId": "mem-1710590400000-x3k7p2",
  "type": "lesson",
  "tags": ["auth", "security"],
  "contentLength": 52
}
```

**返回值 (stats)：**

```json
{
  "status": "ok",
  "action": "stats",
  "scope": "default",
  "totalEntries": 142,
  "byType": { "fact": 45, "decision": 32, "lesson": 28, "pattern": 37 },
  "oldestEntry": 1710500000000,
  "newestEntry": 1710590400000,
  "storageUsed": 52480
}
```

---

### swarm_plan

**文件：** `src/bridge/tools/plan-tool.js` (320 行)

DAG 计划管理。四个动作：`view`（查看）、`modify`（修改）、`validate`（验证）、`cancel`（取消）。

**参数：**

| 名称 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `action` | enum | **是** | -- | `view`、`modify`、`validate` 或 `cancel` |
| `dagId` | string | **是** | -- | DAG/计划 ID（所有动作均必填） |
| `modifications` | object | modify | -- | 要应用的修改（见 schema） |

**修改 (modifications) Schema：**

| 字段 | 类型 | 描述 |
|------|------|------|
| `addNodes` | array | 要添加的节点：`{ id, task, role, dependsOn[] }` |
| `removeNodes` | string[] | 要移除的节点 ID |
| `updateTimeBudget` | number | 新的时间预算（毫秒） |
| `updatePriority` | number | 新的优先级 (1-10) |

**validate 动作 -- 执行的检查：**

1. **缺失依赖** -- 节点引用了不存在的依赖 ID
2. **重复 ID** -- 多个节点使用相同 ID
3. **环路检测** -- 拓扑排序失败表示存在环路

**返回值 (view)：**

```json
{
  "status": "ok",
  "action": "view",
  "dagId": "dag-1710590400000",
  "state": "running",
  "summary": "实现认证模块",
  "nodes": [
    { "id": "n1", "task": "编写测试", "role": "tester", "state": "completed", "agentId": "a1", "dependsOn": [] },
    { "id": "n2", "task": "实现代码", "role": "implementer", "state": "running", "agentId": "a2", "dependsOn": ["n1"] }
  ],
  "edges": [],
  "timeBudgetMs": 300000,
  "completedNodes": 1,
  "totalNodes": 2,
  "percentage": 50
}
```

**返回值 (validate)：**

```json
{
  "status": "ok",
  "action": "validate",
  "dagId": "dag-1710590400000",
  "valid": true,
  "issues": [],
  "nodeCount": 5,
  "edgeCount": 4
}
```

**返回值 (cancel)：**

```json
{
  "status": "cancelled",
  "dagId": "dag-1710590400000",
  "cancelledAgents": ["agent-a1", "agent-a2"],
  "cancelledAgentCount": 2
}
```

**DAG Engine 节点状态机：**

```
PENDING → SPAWNING → ASSIGNED → EXECUTING → COMPLETED
                                          └→ DEAD_LETTER
```

`SPAWNING` 状态表示节点的代理孵化请求已发出但尚未被 Gateway 确认。此状态可防止高并发 DAG 执行时的重复孵化。

**DAGEngine API 方法：**

| 方法 | 描述 |
|------|------|
| `planTask(intent, scope)` | 根据意图分类和范围估计创建 DAG |
| `addNode(dagId, node)` | 向已有 DAG 添加节点 |
| `spawnNode(dagId, nodeId)` | 将 PENDING 节点转换为 SPAWNING 并请求代理孵化 |
| `completeNode(dagId, nodeId, result)` | 标记节点为 COMPLETED 并触发下游依赖 |
| `failNode(dagId, nodeId, error)` | 将节点移至 DEAD_LETTER 并附加错误上下文 |

---

### swarm_zone

**文件：** `src/bridge/tools/zone-tool.js` (255 行)

文件/资源区域管理，提供分布式锁。四个动作：`detect`（检测）、`lock`（加锁）、`unlock`（解锁）、`list`（列表）。

**参数：**

| 名称 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `action` | enum | **是** | -- | `detect`、`lock`、`unlock` 或 `list` |
| `path` | string | detect/lock/unlock | -- | 文件或目录路径 |
| `agentId` | string | 否 | `bridge` | 请求锁的代理 |
| `reason` | string | 否 | `Exclusive access requested` | 加锁原因 |
| `force` | boolean | 否 | `false` | 即使被其他代理持有也强制解锁 |

**返回值 (lock -- 已授权)：**

```json
{
  "status": "locked",
  "lockId": "lock-1710590400000-m7k2x9",
  "path": "src/auth/login.js",
  "agentId": "agent-a1",
  "reason": "实现认证流程",
  "warning": null
}
```

**返回值 (lock -- 拒绝)：**

```json
{
  "status": "denied",
  "path": "src/auth/login.js",
  "heldBy": "agent-a2",
  "heldSince": 1710590300000,
  "reason": "Zone is already locked by another agent"
}
```

**返回值 (list)：**

```json
{
  "status": "ok",
  "action": "list",
  "scope": "default",
  "count": 2,
  "locks": [
    { "lockId": "lock-...", "path": "src/auth/", "agentId": "agent-a1", "reason": "Auth 模块", "lockedAt": 1710590400000, "age": 15000 }
  ]
}
```

---

## Hooks

来源：`src/bridge/hooks/hook-adapter.js` (433 行)。`HookAdapter` 类将全部 16 个 OpenClaw Hook 映射到 V9 域操作。每个处理器都包裹在 try/catch 中，确保单个域失败不会拖垮整个 hook 流水线。

### Hook 注册

```javascript
const adapter = new HookAdapter({ core, quality, observe, sessionBridge, modelFallback, spawnClient });
adapter.registerHooks(app); // 注册全部 16 个 hook
```

### 16 个 Hook 参考

| # | Hook | 方法 | 方向 | 描述 |
|---|------|------|------|------|
| 1 | `activate` | `onActivate()` | -- | 按依赖顺序启动所有域 (communication -> intelligence -> orchestration -> quality -> observe) |
| 2 | `deactivate` | `onDeactivate()` | -- | 按反序停止所有域 |
| 3 | `session_start` | `onSessionStart(session)` | 入 | 通过 SessionBridge 初始化会话范围 |
| 4 | `session_end` | `onSessionEnd(session)` | 入 | 清理会话状态 |
| 5 | `message_created` | `onMessageCreated(session, message)` | 入 -> 出 | 分类意图并估计范围。返回 `{ intent, scope }` |
| 6 | `before_agent_start` | `onBeforeAgentStart(session, agent)` | 入 -> 变异 | **最复杂的 hook。** 7 步流水线（见下文）。返回 `{ advised, role }` |
| 7 | `agent_start` | `onAgentStart(session, agent)` | 入 | 开始追踪 span，在会话中跟踪代理 |
| 8 | `agent_end` | `onAgentEnd(session, agent, result)` | 入 | 结束追踪 span、清理、质量审计、信用归因、失败分类 |
| 9 | `llm_output` | `onLlmOutput(session, output)` | 入 | 对生成内容执行合规监控 |
| 10 | `before_tool_call` | `onBeforeToolCall(session, toolCall)` | 入 -> 出 | 熔断器检查 + schema 验证。返回 `{ blocked, reason, repairPrompt }` |
| 11 | `after_tool_call` | `onAfterToolCall(session, toolCall, result)` | 入 | 记录工具成功/失败用于熔断器 |
| 12 | `prependSystemContext` | `onPrependSystemContext(session)` | -- -> 出 | 为当前范围叠加场向量。返回 `<swarm-context>` XML 字符串 |
| 13 | `before_shutdown` | `onBeforeShutdown()` | -- | 快照所有域存储用于持久化 |
| 14 | `error` | `onError(session, error)` | 入 -> 出 | 路由到 ModelFallback 进行重试/回退决策 |
| 15 | `tool_result` | `onToolResult(session, result)` | 入 | 将结果送入异常检测器进行事件跟踪 |
| 16 | `agent_message` | `onAgentMessage(session, message)` | 入 | 发布到任务通道并追加到工作记忆 |

### before_agent_start -- 7 步流水线

这是最复杂的 hook。它在生成前变异 `agent` 对象：

| 步骤 | 操作 | 来源 |
|------|------|------|
| 1 | **SpawnAdvisor** -- 推荐角色、模型、工具权限 | `core.orchestration.advisor.advise()` |
| 2 | **ImmunitySystem** -- 从失败疫苗获取预防提示 | `quality.checkImmunity()` |
| 3 | **Compliance** -- 会话的合规升级提示 | `quality.getCompliancePrompt()` |
| 4 | **PromptArchitect** -- 构建包含所有上下文的动态提示词 | `core.intelligence.buildPrompt()` |
| 5 | **注入提示词** -- 设置 `agent.systemPrompt` | 直接变异 |
| 6 | **工具权限** -- 从顾问限制 `agent.allowedTools` | 直接变异 |
| 7 | **模型覆盖** -- 从顾问设置 `agent.model` 和 `agent.role` | 直接变异 |

### Hook 统计

```javascript
adapter.getStats();
// 返回：
// {
//   hooksFired: 1247,
//   hookErrors: 3,
//   blockedToolCalls: 12,
//   agentsAdvised: 45
// }
```

---

## 事件目录

来源：`src/core/bus/event-catalog.js`。**27 个事件主题**，按域组织。

### 按域分类

#### 场核心 (3 个事件)

| 常量 | 主题 | 负载 |
|------|------|------|
| `FIELD_SIGNAL_EMITTED` | `field.signal.emitted` | `Signal` 对象 |
| `FIELD_GC_COMPLETED` | `field.gc.completed` | `{ collected: number, remaining: number }` |
| `FIELD_EMERGENCY_GC` | `field.emergency_gc` | `{ reason: string, freed: number }` |

#### 状态存储 (2 个事件)

| 常量 | 主题 | 负载 |
|------|------|------|
| `STORE_SNAPSHOT_COMPLETED` | `store.snapshot.completed` | `{ snapshotId: string, size: number }` |
| `STORE_RESTORE_COMPLETED` | `store.restore.completed` | `{ snapshotId: string, restoredKeys: number }` |

#### 通信层 (5 个事件)

| 常量 | 主题 | 负载 |
|------|------|------|
| `CHANNEL_CREATED` | `channel.created` | `{ channelId: string, type: string }` |
| `CHANNEL_CLOSED` | `channel.closed` | `{ channelId: string, reason: string }` |
| `CHANNEL_MESSAGE` | `channel.message` | `{ channelId: string, from: string, message: any }` |
| `PHEROMONE_DEPOSITED` | `pheromone.deposited` | `{ trailId: string, type: string, intensity: number }` |
| `PHEROMONE_EVAPORATED` | `pheromone.evaporated` | `{ trailId: string, remaining: number }` |

#### 智能层 (7 个事件)

| 常量 | 主题 | 负载 |
|------|------|------|
| `AGENT_SPAWNED` | `agent.lifecycle.spawned` | `{ agentId: string, species: string }` |
| `AGENT_READY` | `agent.lifecycle.ready` | `{ agentId: string }` |
| `AGENT_COMPLETED` | `agent.lifecycle.completed` | `{ agentId: string, result: any }` |
| `AGENT_FAILED` | `agent.lifecycle.failed` | `{ agentId: string, error: string }` |
| `AGENT_ENDED` | `agent.lifecycle.ended` | `{ agentId: string, reason: string }` |
| `MEMORY_RECORDED` | `memory.episode.recorded` | `{ agentId: string, episodeId: string }` |
| `MEMORY_CONSOLIDATED` | `memory.consolidated` | `{ agentId: string, consolidated: number }` |

#### 编排层 (5 个事件)

| 常量 | 主题 | 负载 |
|------|------|------|
| `TASK_CREATED` | `task.created` | `{ taskId: string, type: string }` |
| `TASK_COMPLETED` | `task.completed` | `{ taskId: string, result: any }` |
| `DAG_STATE_CHANGED` | `dag.state.changed` | `{ dagId: string, state: string }` |
| `SPAWN_ADVISED` | `spawn.advised` | `{ species: string, reason: string }` |
| `REPUTATION_UPDATED` | `reputation.updated` | `{ agentId: string, score: number, delta: number }` |

#### 质量层 (5 个事件)

| 常量 | 主题 | 负载 |
|------|------|------|
| `GATE_PASSED` | `quality.gate.passed` | `{ gateId: string, score: number }` |
| `GATE_FAILED` | `quality.gate.failed` | `{ gateId: string, score: number, threshold: number }` |
| `BREAKER_TRIPPED` | `quality.breaker.tripped` | `{ breakerId: string, failures: number }` |
| `ANOMALY_DETECTED` | `quality.anomaly.detected` | `{ type: string, severity: string, details: any }` |
| `COMPLIANCE_VIOLATION` | `quality.compliance.violation` | `{ rule: string, agentId: string, details: string }` |

#### 可观测层 (1 个事件)

| 常量 | 主题 | 负载 |
|------|------|------|
| `METRICS_COLLECTED` | `observe.metrics.collected` | `{ timestamp: number, metrics: object }` |

---

## REST 端点

来源：`src/observe/dashboard/dashboard-service.js` (662 行)。全部端点在端口 **19100** 上通过 Node.js `http.createServer()` 提供服务。所有端点的 HTTP 方法均为 **GET**。响应格式：处理器直接返回的 JSON（无包装信封）。

### 场域 (4 个端点)

| 路径 | 描述 | 返回类型 |
|------|------|---------|
| `GET /api/v9/field/stats` | 信号场统计 | `{ totalSignals, activeCount, ... }` |
| `GET /api/v9/field/superpose/:scope` | 在指定范围叠加所有信号为向量 | `{ dimensions: {...}, coherence }` |
| `GET /api/v9/field/signals` | 带过滤条件查询信号 (`?type=...&scope=...`) | `Signal[]` |
| `GET /api/v9/field/dimensions` | 12 维场描述符数组 | `[{ id, label, description }]` |

### 代理域 (4 个端点)

| 路径 | 描述 | 返回类型 |
|------|------|---------|
| `GET /api/v9/agents/active` | 活跃代理列表 | `Agent[]` |
| `GET /api/v9/agents/states` | 所有代理状态机 | `{ agentId: state }` |
| `GET /api/v9/agents/capabilities` | 代理能力向量 | `{ agentId: capabilities }` |
| `GET /api/v9/agents/:id` | 单个代理详情 | `Agent` |

### 编排/任务域 (4 个端点)

| 路径 | 描述 | 返回类型 |
|------|------|---------|
| `GET /api/v9/tasks` | 所有任务 | `Task[]` |
| `GET /api/v9/tasks/dead-letters` | 死信队列 | `Task[]` |
| `GET /api/v9/tasks/critical-path` | 关键路径分析 | `{ path[], bottleneck }` |
| `GET /api/v9/tasks/:dagId` | 按 ID 查询 DAG 详情 | `DAG` |

### 社交域 (5 个端点)

| 路径 | 描述 | 返回类型 |
|------|------|---------|
| `GET /api/v9/reputation` | 代理声誉分数 | `{ agents: [...], globalScore }` |
| `GET /api/v9/sna` | 社交网络分析指标 | `{ nodes, edges, metrics }` |
| `GET /api/v9/emotional-states` | 代理情绪状态向量 | `{ agentId: emotionalVector }` |
| `GET /api/v9/trust` | 信任矩阵 | `{ pairs: [...] }` |
| `GET /api/v9/cultural-friction` | 供应商间文化摩擦 | `{ matrix: {...} }` |

### 自适应域 (9 个端点)

| 路径 | 描述 | 返回类型 |
|------|------|---------|
| `GET /api/v9/modulator` | 全局调制器模式和因子 | `{ currentMode, factors }` |
| `GET /api/v9/shapley` | Shapley 信用归因 | `{ dagId, credits: {} }` |
| `GET /api/v9/species` | 种群进化器状态 | `{ active: [], retired: [] }` |
| `GET /api/v9/calibration` | 信号校准状态 | `{ phase, weights }` |
| `GET /api/v9/budget` | 预算跟踪聚合状态 | `{ dagCount, dags: CostReport[], global }` |
| `GET /api/v9/budget-forecast` | 预算预测器历史与精度 | `{ historyCount, lastRecordedAt, accuracy, byTaskType }` |
| `GET /api/v9/dual-process` | 双过程路由统计 | `{ s1Count, s2Count, avgLatency }` |
| `GET /api/v9/signal-weights` | 信号校准权重（每维一个） | `{ dimension: weight }` |
| `GET /api/v9/role-discovery` | 涌现角色发现模式 | `{ discovered: [...] }` |

### 质量域 (5 个端点)

| 路径 | 描述 | 返回类型 |
|------|------|---------|
| `GET /api/v9/quality-audit` | 质量审计历史 | `Evaluation[]` |
| `GET /api/v9/failure-modes` | 失败模式分布 | `{ mode: count }` |
| `GET /api/v9/compliance` | 合规统计 | `{ compliant, violations }` |
| `GET /api/v9/circuit-breakers` | 所有熔断器状态 | `{ tool: breakerState }` |
| `GET /api/v9/vaccinations` | 失败疫苗抗原 | `Antigen[]` |

### 通信域 (3 个端点)

| 路径 | 描述 | 返回类型 |
|------|------|---------|
| `GET /api/v9/pheromones` | 信息素网格状态 | `{ trails, activeTypes, totalDeposits }` |
| `GET /api/v9/channels` | 活跃通信通道 | `Channel[]` |
| `GET /api/v9/stigmergy` | 痕迹协作板状态 | `{ posts: [...] }` |

### 治理域 (2 个端点)

| 路径 | 描述 | 返回类型 |
|------|------|---------|
| `GET /api/v9/governance` | 治理统计 | `{ governanceScore, complianceRate }` |
| `GET /api/v9/emergence` | 涌现模式检测 | `{ patterns: [...] }` |

### 追踪域 (2 个端点)

| 路径 | 描述 | 返回类型 |
|------|------|---------|
| `GET /api/v9/traces` | 查询追踪 span (`?traceId=...&limit=...`) | `Trace[]` |
| `GET /api/v9/traces/:id` | 单条追踪详情 | `Trace` |

### 系统域 (5 个端点)

| 路径 | 描述 | 返回类型 |
|------|------|---------|
| `GET /api/v9/metrics` | 指标收集器快照 | `{ agents, tasks, signals, pheromones, quality, budget, channels, memory, errors, performance, hooks }` |
| `GET /api/v9/health` | 系统健康检查 | `{ status, score, dimensions, ts }` |
| `GET /api/v9/config` | Dashboard 配置 | `{ port, consolePath, fieldDimensions, registeredRoutes }` |
| `GET /api/v9/bus/stats` | EventBus 统计 | `{ published, subscribers, queued }` |
| `GET /api/v9/store/stats` | 持久化存储统计 | `{ domains, totalKeys, snapshotCount }` |

### 用户面向域 (3 个端点)

| 路径 | 描述 | 返回类型 |
|------|------|---------|
| `GET /api/v9/progress/:dagId` | DAG 进度报告 | `{ dagId, completedNodes, totalNodes, percentage, state, elapsed, remainingBudget, blockers }` |
| `GET /api/v9/cost-report/:dagId` | 按 DAG 分组的成本报告 | `{ dagId, totalBudget, spent, remaining, utilization, phases, overrun, timestamp }` |
| `GET /api/v9/artifacts/:dagId` | DAG 产出的工件 | `Artifact[]` |

### 记忆/身份域 (3 个端点)

| 路径 | 描述 | 返回类型 |
|------|------|---------|
| `GET /api/v9/memory/stats` | 记忆存储统计 | `{ totalEntries, byType }` |
| `GET /api/v9/identity` | 代理身份映射 | `{ agentId: identity }` |
| `GET /api/v9/context-window` | 上下文窗口使用统计 | `{ used, limit, efficiency }` |

### 桥接域 (2 个端点)

| 路径 | 描述 | 返回类型 |
|------|------|---------|
| `GET /api/v9/bridge/status` | 桥接就绪状态与已注册能力 | `{ ready, hooks, tools, sessionBridge, spawnClient, modelFallback }` |
| `GET /api/v9/bridge/queue` | 桥接消息队列 | `Message[]` |

### 拓扑域 (4 个端点)

| 路径 | 描述 | 返回类型 |
|------|------|---------|
| `GET /api/v9/topology` | 模块拓扑总览 | `{ moduleCount, dagCount, zones, domains }` |
| `GET /api/v9/topology/graph` | produces/consumes 关系图 | `{ nodes: [], edges: [] }` |
| `GET /api/v9/modules` | 模块清单 | `ModuleManifest[]` |
| `GET /api/v9/modules/:moduleId` | 单个模块详情 | `ModuleManifest` |

### 遗留别名 (14 个端点)

这些 V1 路径重定向到对应的 V9 处理器：

| 遗留路径 | V9 目标 |
|---------|---------|
| `/api/v1/last-inject` | `/api/v9/metrics` |
| `/api/v1/subagent-stats` | `/api/v9/metrics` |
| `/api/v1/governance` | `/api/v9/governance` |
| `/api/v1/modulator` | `/api/v9/modulator` |
| `/api/v1/sna` | `/api/v9/sna` |
| `/api/v1/shapley` | `/api/v9/shapley` |
| `/api/v1/dual-process` | `/api/v9/dual-process` |
| `/api/v1/failure-modes` | `/api/v9/failure-modes` |
| `/api/v1/budget-forecast` | `/api/v9/budget-forecast` |
| `/api/v1/quality-audit` | `/api/v9/quality-audit` |
| `/api/v1/agent-states` | `/api/v9/agents/states` |
| `/api/v1/metrics` | `/api/v9/metrics` |
| `/api/v1/health` | `/api/v9/health` |
| `/api/v1/compliance` | `/api/v9/compliance` |

### Dashboard 路由 (2 + SSE)

| 路径 | 描述 |
|------|------|
| `GET /v9/console` | V9 React SPA 控制台 (Swarm Console) |
| `GET /v9/console/*` | 控制台静态资源 + SPA 回退 |
| `GET /api/v9/events` | SSE 事件流（见下文） |

控制台实时状态主通道使用 `19101` 端口上的 WebSocket bridge；SSE 仍然保留，主要用于兼容和诊断事件流。

---

## SSE 事件流

**端点：** `GET /api/v9/events`（端口 19100）

`StateBroadcaster` 订阅 EventBus 主题并通过 Server-Sent Events 推送到已连接的控制台客户端。

**API：** `StateBroadcaster.setVerbosity(level)` -- 控制事件过滤粒度。级别：`0`（仅关键事件）、`1`（默认 -- 域事件）、`2`（详细 -- 包含场心跳和内部诊断）。

### 消息格式

```
:\n\n
data: {"topic":"agent.lifecycle.spawned","data":{"agentId":"a1","species":"implementer"},"timestamp":1710590400000}

data: {"topic":"quality.gate.passed","data":{"gateId":"g1","score":0.85},"timestamp":1710590401000}
```

初始的 `:\n\n` 注释是连接时发送的保活探测。事件使用无名 SSE 格式（仅 data，无 `event:` 字段）。JSON 负载中的 `topic` 字段映射到事件目录中的 27 个事件。

### 客户端连接

```javascript
const es = new EventSource('http://127.0.0.1:19100/api/v9/events');
es.onmessage = (e) => {
  const { topic, data, timestamp } = JSON.parse(e.data);
  // 根据 topic 路由到相应处理器
};
```

### 连接生命周期

1. 客户端打开 `EventSource` 连接
2. 服务器发送 `:\n\n` 保活注释
3. 服务器以 `data: {...}\n\n` 格式流式推送事件
4. 客户端断开后，服务器从广播集中移除该客户端
5. 如果 `StateBroadcaster.addClient(res)` 可用则由其管理客户端；否则 DashboardService 本地跟踪

---

[<- 返回 README](../../README.zh-CN.md) | [English](../en/api-reference.md)
