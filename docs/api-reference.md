# API Reference / API 参考

**Claw-Swarm V5.4** — Hooks, tools, and engine API documentation.

---

## 1. OpenClaw Hooks / OpenClaw 钩子

V5.4 registers **16 hooks** with the OpenClaw gateway (V5.0: 6 + V5.1: 8 + V5.3: 2 new).

V5.4 向 OpenClaw 网关注册 **16 个钩子**（V5.0: 6 + V5.1: 8 + V5.3: 2 新增）。

| # | OpenClaw Event | Internal Mapping | Returns | Priority |
|---|---|---|---|---|
| a | `gateway_start` | Engine initialization + config validation + SYSTEM_STARTUP event | void | default |
| b | `before_model_resolve` | Model capability auto-detection | void | default |
| c | `before_tool_call` | ToolResilience AJV validation + circuit breaker | void | default |
| d | `before_prompt_build` | Tool failure injection + swarm context | void | default |
| e | `before_agent_start` | `onAgentStart` + `onPrependContext` | `{ prependContext }` | 50 |
| f | `agent_end` | `onAgentEnd` | void | default |
| g | `after_tool_call` | `onToolCall` + `onToolResult` | void | default |
| h | `before_reset` | `onMemoryConsolidate` | void | default |
| i | `gateway_stop` | `adapter.close()` + cleanup | void | default |
| j | `message_sending` | `onSubAgentMessage` | void | default |
| k | `subagent_spawning` | Hierarchical coordinator validation | `{ customPrompt }` | default |
| l | `subagent_spawned` | Hierarchy tracking | void | default |
| m | `subagent_ended` | `onSubAgentComplete` / `onSubAgentAbort` | void | default |
| n | `llm_output` | SOUL.md dual-stage migration | void | default |

### a. `before_agent_start`

**Event:** `{ agentId, prompt?, taskDescription?, tier? }`
**Returns:** `{ prependContext: string }`

Internally: (1) `onAgentStart` registers the agent in Gossip (`status: 'active'`) and upserts into `AgentRepository`. (2) `onPrependContext` builds rich context via `ContextService` combining working memory, episodic memory, semantic memory (knowledge graph), pheromone snapshot, and Gossip peer states.

内部先在 Gossip 中注册 Agent 并更新 AgentRepository，再通过 ContextService 构建上下文（工作记忆 + 情景记忆 + 语义记忆 + 信息素 + Gossip 状态）。

### b. `agent_end`

**Event:** `{ agentId }`
**Returns:** void

Internally: Consolidates working memory (focus + context + scratchpad) to episodic memory, updates Gossip state to `'completed'`, invalidates context cache.

固化工作记忆到情景记忆，更新 Gossip 状态，清除上下文缓存。

### c. `after_tool_call`

**Event:** `{ agentId, toolName, params?, error? }`
**Returns:** void

Internally: (1) `onToolCall` records tool invocation to working memory (priority 3, importance 0.3). (2) `onToolResult` updates capability dimensions via `CapabilityEngine` (dimension inferred from tool name).

记录工具调用到工作记忆，并更新能力维度评分。

### d. `subagent_spawning`

**Event:** `{ subagentId, agentId, name?, tier?, persona?, behavior?, taskDescription?, role?, roleTemplate?, zoneId? }`
**Returns:** `{ customPrompt: string }`

Internally: Generates SOUL snippet via `SoulDesigner.design()` (or `designForRole()` if `roleTemplate` provided). Registers sub-agent in Gossip with `status: 'spawned'`.

通过 SoulDesigner 生成 SOUL 片段，在 Gossip 中注册子代理。

### e. `subagent_ended`

**Event:** `{ subagentId, outcome, taskId?, result?, reason?, taskScope? }`
**Returns:** void

**On success** (`outcome='ok'|'success'`): `QualityController.evaluate()` checks quality. Emits TRAIL pheromone (0.8 intensity) on pass, ALARM (0.6) on fail. Updates reputation via `ReputationLedger`.

**On failure**: `PipelineBreaker.transition()` marks task failed. Emits ALARM pheromone at full intensity (1.0). Updates Gossip to `'aborted'`.

成功时执行质量门控 + 信息素强化 + 声誉更新；失败时触发管道中断 + ALARM 信息素。

### f. `before_reset`

**Event:** `{ agentId }`
**Returns:** void

Consolidates entire working memory to episodic memory before session reset. Runs Ebbinghaus-curve pruning afterwards.

会话重置前固化工作记忆，之后执行遗忘曲线修剪。

### g. `gateway_stop`

**Event:** none
**Returns:** void

Full shutdown in reverse creation order: stop decay timer, destroy Orchestrator (L4), stop Gossip (L2), destroy MessageBus (L2), close Database (L1).

按创建逆序关闭：定时器 -> L4 -> L2 Gossip -> L2 MessageBus -> L1 数据库。

### h. `message_sending`

**Event:** `{ agentId, receiverId, content, messageType?, broadcast? }`
**Returns:** void

Publishes to `'agent.message'` topic on MessageBus. If `broadcast: true`, additionally broadcasts via `GossipProtocol`. Only routes when `receiverId` is specified.

通过 MessageBus 发布消息，如 `broadcast: true` 则同时通过 Gossip 广播。

---

## 2. Agent Tools / Agent 工具

V5.4 registers **8 tools** via factory functions in `L5-application/tools/`.

V5.4 通过 `L5-application/tools/` 中的工厂函数注册 **8 个工具**。

### a. `swarm_spawn`

Spawn sub-agents with MoE role selection and SOUL injection. / 使用 MoE 角色选择生成子代理。

| Parameter | Type | Required | Description / 说明 |
|---|---|---|---|
| `taskDescription` | `string` | Yes | Task to perform. / 任务描述。 |
| `roles` | `string[]` | No | Explicit roles (auto-discovered if omitted). / 角色（省略则自动发现）。 |
| `strategy` | `string` | No | `'parallel'`, `'sequential'`, or `'pipeline'`. / 执行策略。 |

Uses `RoleDiscovery` + `RoleManager` for role assignment, `SoulDesigner` for persona matching, creates spawn plan with per-role SOUL snippets.

### b. `swarm_query`

Query swarm state. / 查询蜂群状态。

| Parameter | Type | Required | Description / 说明 |
|---|---|---|---|
| `queryType` | `string` | Yes | `'status'`, `'agents'`, `'tasks'`, or `'pheromones'`. / 查询类型。 |

Returns overall health, agent list with Gossip state, active tasks, or pheromone signals depending on query type.

### c. `swarm_pheromone`

Emit, read, or decay pheromone signals. / 发射、读取或衰减信息素。

| Parameter | Type | Required | Description / 说明 |
|---|---|---|---|
| `action` | `string` | Yes | `'emit'`, `'read'`, or `'decay'`. / 操作类型。 |
| `type` | `string` | For emit | `'trail'`, `'alarm'`, `'recruit'`, `'queen'`, `'dance'`. / 信息素类型。 |
| `scope` | `string` | For emit/read | Target scope path (e.g., `'/src/auth/'`). / 范围路径。 |
| `intensity` | `number` | No | 0.0-1.0 (default: 1.0). / 强度。 |

### d. `swarm_gate`

Quality gate evaluation. / 质量门控评估。

| Parameter | Type | Required | Description / 说明 |
|---|---|---|---|
| `taskId` | `string` | Yes | Task to evaluate. / 要评估的任务。 |
| `output` | `any` | Yes | Task output. / 任务输出。 |
| `criteria` | `object` | No | Custom quality criteria. / 自定义质量标准。 |

Returns `{ verdict, score, feedback, details }`. Verdict: `'pass'`, `'conditional'`, or `'fail'`.

### e. `swarm_memory`

Memory operations across working, episodic, and semantic systems. / 跨记忆系统操作。

| Parameter | Type | Required | Description / 说明 |
|---|---|---|---|
| `action` | `string` | Yes | `'record'`, `'recall'`, `'knowledge'`, or `'working'`. / 操作类型。 |
| `content` | `string` | For record | Content to store. / 要存储的内容。 |
| `query` | `string` | For recall | Retrieval query. / 检索查询。 |
| `agentId` | `string` | No | Agent scope. / Agent 范围。 |

- `'record'` -- Store to episodic via `EpisodicMemory.consolidate()`.
- `'recall'` -- Retrieve matching episodic memories.
- `'knowledge'` -- Knowledge graph ops via `SemanticMemory`.
- `'working'` -- Read/write working memory buffer.

### f. `swarm_plan`

Execution planning for multi-agent tasks. / 多代理任务执行规划。

| Parameter | Type | Required | Description / 说明 |
|---|---|---|---|
| `action` | `string` | Yes | `'design'` or `'validate'`. / 操作类型。 |
| `taskDescription` | `string` | For design | Task to plan. / 任务描述。 |
| `roles` | `string[]` | No | Roles for the plan. / 计划角色。 |

`'design'` uses `ExecutionPlanner` + `CriticalPathAnalyzer`. `'validate'` checks completeness, cycles, and resources.

### g. `swarm_zone`

Zone management for agent grouping and governance. / 区域管理。

| Parameter | Type | Required | Description / 说明 |
|---|---|---|---|
| `action` | `string` | Yes | `'create'`, `'list'`, `'assign'`, or `'health'`. / 操作类型。 |
| `zoneId` | `string` | For assign/health | Zone identifier. / 区域 ID。 |
| `zoneName` | `string` | For create | Zone display name. / 区域名称。 |
| `agentId` | `string` | For assign | Agent to assign. / 要分配的 Agent。 |

---

## 3. Internal Hooks / 内部钩子

These hooks are triggered via MessageBus internally and do not map to OpenClaw events.

以下钩子通过 MessageBus 内部触发，不映射到 OpenClaw 事件。

| Hook | Description / 说明 |
|---|---|
| `onTaskDecompose` | Delegates to `Orchestrator.decompose()` to split tasks into sub-tasks with roles and dependencies. / 委托 Orchestrator 分解任务。 |
| `onReplanTrigger` | Fires on agent failure or pheromone threshold breach. Calls `ReplanEngine.checkAndReplan()`. / 失败或信息素超限时触发重规划。 |
| `onZoneEvent` | Handles zone lifecycle: member join/leave, leader election, health check via `ZoneManager`. / 处理区域生命周期事件。 |
| `onPheromoneThreshold` | Fires when pheromone density exceeds threshold. For `alarm` type, may trigger replanning. / 信息素密度超限时触发。 |
| `onPheromoneEscalation` | V5.2: Fires when PheromoneResponseMatrix detects pressure gradient exceeding escalation threshold. / 压力梯度超阈值时触发。 |
| `onIdleDetected` | V5.2: Fires when HealthChecker detects idle agents exceeding threshold. Auto-emits recruit pheromone. / 空闲检测超阈值时触发。 |

---

## 4. PluginAdapter API / 插件适配器 API

Central hub in `L5-application/plugin-adapter.js` wiring all L1-L5 engines.

`L5-application/plugin-adapter.js` 中的核心枢纽，组装 L1-L5 引擎。

### Constructor / 构造函数

```javascript
new PluginAdapter({ config, logger })
```

- `config` -- Merged user configuration from `openclaw.plugin.json`. / 合并后的用户配置。
- `logger` -- Pino logger instance from OpenClaw. / Pino 日志器。

### Methods / 方法

| Method | Description / 说明 |
|---|---|
| `init()` | Creates all L1-L5 engines in layer order. Opens DB, starts Gossip heartbeat, starts decay timer. Idempotent. / 按层级创建引擎，只能调用一次。 |
| `getHooks()` | Returns object with 14 hook handlers (8 OpenClaw + 4 internal + 2 sub-handlers). / 返回 14 个钩子处理器。 |
| `getTools()` | Returns array of 7 tool definitions (`{ name, description, inputSchema, handler }`). / 返回 7 个工具定义。 |
| `close()` | Reverse-order shutdown: timers -> L4 -> L2 -> L1. Resets all state. / 逆序关闭所有引擎。 |

### `_engines` Internal Property / 内部属性

Contains all engine instances. Key engines by layer:

| Layer | Key | Class | Purpose / 用途 |
|---|---|---|---|
| L1 | `dbManager` | `DatabaseManager` | SQLite connection. / 数据库连接。 |
| L1 | `repos.*` | Various | 8 data repositories. / 8 个数据仓库。 |
| L2 | `messageBus` | `MessageBus` | Pub/sub with DLQ. / 发布/订阅。 |
| L2 | `pheromoneEngine` | `PheromoneEngine` | Emit/read/decay. / 信息素操作。 |
| L2 | `gossipProtocol` | `GossipProtocol` | State dissemination. / 状态传播。 |
| L3 | `workingMemory` | `WorkingMemory` | Focus/context/scratchpad. / 短期记忆。 |
| L3 | `episodicMemory` | `EpisodicMemory` | Long-term with Ebbinghaus decay. / 长期记忆。 |
| L3 | `semanticMemory` | `SemanticMemory` | Knowledge graph. / 知识图谱。 |
| L3 | `capabilityEngine` | `CapabilityEngine` | Multi-dim scoring. / 多维评分。 |
| L3 | `soulDesigner` | `SoulDesigner` | SOUL snippet gen. / SOUL 生成。 |
| L3 | `reputationLedger` | `ReputationLedger` | Agent reputation. / 声誉跟踪。 |
| L4 | `orchestrator` | `Orchestrator` | Task decomposition. / 任务分解。 |
| L4 | `qualityController` | `QualityController` | Quality gate. / 质量门控。 |
| L4 | `executionPlanner` | `ExecutionPlanner` | Plan design. / 计划设计。 |
| L4 | `replanEngine` | `ReplanEngine` | Dynamic replan. / 动态重规划。 |
| L4 | `zoneManager` | `ZoneManager` | Zone governance. / 区域治理。 |
| L5 | `contextService` | `ContextService` | Prepend context builder. / 上下文构建。 |
| L5 | `circuitBreaker` | `CircuitBreaker` | 3-state fault tolerance. / 三态容错。 |

---

## 5. Key Engine APIs / 核心引擎 API

### MessageBus (`L2-communication/message-bus.js`)

| Method | Signature | Description / 说明 |
|---|---|---|
| `publish()` | `(topic, data, meta?) -> void` | Publish event to topic. / 向主题发布事件。 |
| `subscribe()` | `(topic, handler) -> subscriptionId` | Subscribe to topic. / 订阅主题。 |
| `unsubscribe()` | `(subscriptionId) -> boolean` | Remove subscription. / 移除订阅。 |

### PheromoneEngine (`L2-communication/pheromone-engine.js`)

| Method | Signature | Description / 说明 |
|---|---|---|
| `emitPheromone()` | `({ type, sourceId, targetScope, intensity, payload }) -> object` | Create pheromone signal. / 创建信息素。 |
| `readPheromones()` | `(scope?, type?) -> object[]` | Read active pheromones. / 读取信息素。 |
| `decayPass()` | `() -> { removed, remaining }` | Run decay, remove below 0.01. / 执行衰减。 |

### WorkingMemory (`L3-agent/memory/working-memory.js`)

| Method | Signature | Description / 说明 |
|---|---|---|
| `put()` | `(key, value, { priority, importance }) -> void` | Store item (auto-triaged). / 存储（自动分类）。 |
| `get()` | `(key) -> any` | Retrieve by key. / 按键检索。 |
| `snapshot()` | `() -> { focus, context, scratchpad, totalItems }` | Buffer snapshot. / 缓冲区快照。 |
| `prioritize()` | `() -> void` | Re-sort across buffers. / 重新排序。 |

### SemanticMemory (`L3-agent/memory/semantic-memory.js`)

| Method | Signature | Description / 说明 |
|---|---|---|
| `addNode()` | `(id, type, data) -> void` | Add knowledge graph node. / 添加节点。 |
| `addEdge()` | `(fromId, toId, relation, weight?) -> void` | Add weighted edge. / 添加加权边。 |
| `getRelated()` | `(nodeId, { maxDepth, relation }?) -> object[]` | Find related nodes. / 查找相关节点。 |
| `findPath()` | `(fromId, toId) -> object[]` | Shortest path. / 最短路径。 |

### Orchestrator (`L4-orchestration/orchestrator.js`)

| Method | Signature | Description / 说明 |
|---|---|---|
| `decompose()` | `({ id, description, roles }) -> object` | Split task into sub-tasks. / 分解任务。 |
| `assign()` | `(taskId, agentId) -> void` | Assign agent to task. / 分配代理。 |

### QualityController (`L4-orchestration/quality-controller.js`)

| Method | Signature | Description / 说明 |
|---|---|---|
| `evaluate()` | `({ taskId, agentId, result, criteria? }) -> { verdict, score, feedback }` | Evaluate output quality. Verdict: `pass`/`conditional`/`fail`. / 评估质量。 |

---

## 6. V5.2 New Engine APIs / V5.2 新增引擎 API

### PheromoneResponseMatrix (`L2-communication/pheromone-response-matrix.js`)

| Method | Signature | Description / 说明 |
|---|---|---|
| `autoEscalate()` | `() -> void` | Scan all pheromones and auto-escalate those exceeding pressure threshold. / 扫描并自动升级超阈值信息素。 |
| `destroy()` | `() -> void` | Stop scanning timer and cleanup. / 停止扫描定时器。 |

### StigmergicBoard (`L2-communication/stigmergic-board.js`)

| Method | Signature | Description / 说明 |
|---|---|---|
| `post()` | `({ authorId, scope, title, content, category, priority, ttlMinutes }) -> string` | Create a bulletin post. Returns post ID. / 创建公告，返回 ID。 |
| `read()` | `(scope, { category?, limit? }) -> object[]` | Read posts by scope and optional category. / 按范围和分类读取公告。 |
| `expireOld()` | `() -> number` | Remove expired posts. Returns count removed. / 移除过期公告。 |

### ResponseThreshold (`L3-agent/response-threshold.js`)

| Method | Signature | Description / 说明 |
|---|---|---|
| `getThreshold()` | `(agentId, taskType) -> number` | Get current threshold for agent/task-type pair. / 获取阈值。 |
| `shouldRespond()` | `(agentId, taskType, stimulus) -> boolean` | Check if agent should respond to stimulus. / 判断是否响应。 |
| `adjust()` | `(agentId, taskType, actualActivityRate) -> void` | PI controller adjustment. / PI 控制器调节阈值。 |

### FailureVaccination (`L3-agent/failure-vaccination.js`)

| Method | Signature | Description / 说明 |
|---|---|---|
| `registerVaccine()` | `({ failurePattern, toolName, errorCategory, vaccineStrategy, effectiveness }) -> object` | Register immunization pattern. / 注册免疫模式。 |
| `findVaccines()` | `(failurePattern, { minEffectiveness?, limit? }) -> object[]` | Find matching vaccines. / 查找匹配免疫。 |
| `recordOutcome()` | `(failurePattern, vaccineStrategy, success) -> void` | Track effectiveness. / 记录效果。 |

### SkillSymbiosisTracker (`L3-agent/skill-symbiosis.js`)

| Method | Signature | Description / 说明 |
|---|---|---|
| `updateSkillVector()` | `(agentId, skillVector) -> void` | Update agent skill profile. / 更新技能向量。 |
| `findComplement()` | `(agentId, { limit? }) -> object[]` | Find complementary agents by cosine distance. / 查找互补 Agent。 |
| `recordCollaboration()` | `(agentId1, agentId2, outcome) -> void` | Record pairing outcome. / 记录配对结果。 |

### SpeciesEvolver V5.2 Methods (`L4-orchestration/species-evolver.js`)

| Method | Signature | Description / 说明 |
|---|---|---|
| `performLVDynamics()` | `() -> void` | Run Lotka-Volterra population dynamics. `dN/dt = rN(1-N/K) - αNP`. Culls species with fitness < 0.05. / 运行 LV 种群动力学。 |
| `performABCEvolution()` | `(personaEvolution, agentIds) -> void` | ABC three-stage evolution: employed → onlooker → scout bees. / ABC 三阶段进化。 |

### ToolResilience V5.2 Methods (`L5-application/tool-resilience.js`)

| Method | Signature | Description / 说明 |
|---|---|---|
| `findRepairStrategy()` | `(toolName, errorPattern) -> object?` | Query repair memory for matching strategy with confidence > 0.3. / 查询修复记忆。 |
| `recordRepairOutcome()` | `(toolName, errorPattern, strategy, success) -> void` | Upsert repair memory with success/attempt counts. / 记录修复结果。 |

### HealthChecker V5.2 Methods (`L6-monitoring/health-checker.js`)

| Method | Signature | Description / 说明 |
|---|---|---|
| `recordActivity()` | `(agentId) -> void` | Record agent activity timestamp. / 记录活动时间戳。 |
| `getIdleAgents()` | `() -> string[]` | Get list of idle agents exceeding threshold. / 获取空闲 Agent 列表。 |
