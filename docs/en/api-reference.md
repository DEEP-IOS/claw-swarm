# API Reference

[<- Back to README](../../README.md) | [中文版](../zh-CN/api-reference.md)

This document covers the complete public interface of Claw-Swarm V9: 10 tools, 16 hooks, 27 events, 58 REST endpoints, the WebSocket console bridge, and the legacy SSE event stream. All counts, schemas, and return values are derived directly from source code.

---

## Table of Contents

1. [Tools (10)](#tools)
   - [swarm_run](#swarm_run) | [swarm_query](#swarm_query) | [swarm_dispatch](#swarm_dispatch) | [swarm_checkpoint](#swarm_checkpoint) | [swarm_spawn](#swarm_spawn)
   - [swarm_pheromone](#swarm_pheromone) | [swarm_gate](#swarm_gate) | [swarm_memory](#swarm_memory) | [swarm_plan](#swarm_plan) | [swarm_zone](#swarm_zone)
2. [Hooks (16)](#hooks)
3. [Event Catalog (27)](#event-catalog)
4. [REST Endpoints (58)](#rest-endpoints)
5. [SSE Event Stream](#sse-event-stream)

---

## Tools

All 10 tools live in `src/bridge/tools/`. Each tool follows the OpenClaw plugin API: `execute(toolCallId, params)` returning `{ content: [{ type: 'text', text: JSON.stringify(result) }] }`.

---

### swarm_run

**File:** `src/bridge/tools/run-tool.js`

Full-pipeline task execution. The tool classifies intent, estimates scope, asks the orchestration facade whether the task can stay on the fast path, and only returns a `direct_reply` when a real answer exists. If System 1 is selected but no usable answer is available, `swarm_run` falls back to the deliberate dispatch pipeline instead of fabricating a full response.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `task` | string | **yes** | -- | Task description to execute |
| `role` | string | no | auto-selected | Specify agent role (bypasses SpawnAdvisor) |
| `model` | string | no | `balanced` | Specify LLM model |
| `background` | boolean | no | `false` | Run task in background without blocking |
| `cancel` | string | no | -- | Cancel a running agent by its ID |
| `resume` | string | no | -- | Resume a paused agent by its ID |

**Execution Flow:**

```
1. IntentClassifier.classifyIntent(task) -> { primary, confidence, keywords }
   Recognized intent types (8):
   | Intent | Nodes | Template |
   |--------|-------|----------|
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
   - if System 1 and a router answer exists -> direct reply
   - if System 1 and deterministic fast-reply helper matches -> direct reply
   - otherwise continue to deliberate dispatch
4. PlanEngine.createPlan(intent, scope) -> { dagId, suggestedRole, timeBudgetMs }
5. SpawnAdvisor.adviseSpawn(scope, role) -> { role, reason, parallelism }
6. ImmunitySystem.checkImmunity(task) -> { immune, preventionPrompts, riskScore }
7. PromptArchitect.buildPrompt(role, context) -> prompt string
8. orchestration.selectTools(role, intent) -> tools[]
9. SpawnClient.spawn({ role, model, prompt, tools, label, dagId, scope })
10. PipelineTracker.startPipelineTracking(dagId, timeBudgetMs)
11. Field + bus emit task creation telemetry
```

**Return value (S2 dispatched):**

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

**Return value (S1 direct reply):**

```json
{
  "status": "direct_reply",
  "answer": "6*7 = 42",
  "confidence": 0.92,
  "system": 1
}
```

**Return value (cancel):**

```json
{
  "status": "cancelled",
  "agentId": "run-impl-abc123",
  "detail": "Agent cancellation requested"
}
```

---

### swarm_query

**File:** `src/bridge/tools/query-tool.js` (320 lines)

Unified read-only query interface with 16 scopes: `status`, `plan`, `agents`, `tasks`, `health`, `budget`, `species`, `pheromones`, `channels`, `stigmergy`, `reputation`, `memory`, `progress`, `cost`, `artifacts`, `field`.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `scope` | enum | **yes** | -- | Query scope (see table below) |
| `dagId` | string | no | -- | DAG ID (for `plan`, `progress`, `cost`, `artifacts` scopes) |
| `query` | string | no | -- | Search query (for `memory` scope) |

**16 Query Scopes:**

| Scope | Description | Required Params | Key Return Fields |
|-------|-------------|-----------------|-------------------|
| `status` | Swarm overview | -- | `activeAgents`, `agents[]`, `activePipelines`, `budget`, `field` |
| `plan` | DAG plan detail | `dagId` | `nodes[]`, `edges[]`, `state`, `summary` |
| `agents` | All active agents | -- | `count`, `agents[].{id, role, model, state, dagId, tokensUsed}` |
| `tasks` | Active DAG/task summaries | -- | `count`, `tasks[].{id, dagId, state, summary, nodeCount, edgeCount}` |
| `health` | Observe-domain health | -- | `status`, `score`, `dimensions`, `ts` |
| `budget` | Budget tracker state | -- | `dagCount`, `dags[]`, `global.{totalSession, spent, remaining, utilization}` |
| `species` | Species/adaptation state | -- | species-evolver snapshot |
| `pheromones` | Pheromone trails | -- | `activeTypes[]`, `totalDeposits`, `trails[]` |
| `channels` | Active communication channels | -- | `count`, `channels[]` |
| `stigmergy` | Stigmergic board entries | -- | `boardScope`, `count`, `entries[]` |
| `reputation` | Agent reputation | -- | `globalScore`, `agents[].{id, score, tasksCompleted, failureRate}` |
| `memory` | Semantic search | `query` | `entries[].{id, type, content, relevance, createdAt, source}` |
| `progress` | Pipeline progress | `dagId` | `completedNodes`, `totalNodes`, `percentage`, `state`, `elapsed`, `remainingBudget`, `blockers[]` |
| `cost` | Budget usage | -- | `totalSpent`, `totalSession`, `remaining`, `utilization`, `dagCount`, `dags[]` |
| `artifacts` | DAG artifacts | `dagId` | `artifacts[].{id, type, name, path, size, producedBy}` |
| `field` | 12D signal field | -- | `dimensions{}` (12 dims), `dimensionsCount`, `supportedDimensions[]`, `totalSignals` |

**12 Field Dimensions:**

| Dimension | Description |
|-----------|-------------|
| `trail` | Recent path/progress signal left by active work |
| `alarm` | Risk, anomaly, and breaker pressure |
| `reputation` | Historical reliability / contribution quality |
| `task` | Pending work pressure and budget stress |
| `knowledge` | Knowledge density available in the current scope |
| `coordination` | Multi-agent coordination / routing pressure |
| `emotion` | Frustration, urgency, and other affective residue |
| `trust` | Pairwise collaboration confidence |
| `sna` | Social-network topology and collaboration centrality |
| `learning` | Learning/improvement trace across recent outcomes |
| `calibration` | Signal-weight / threshold calibration pressure |
| `species` | Role/species evolution pressure |

**Return value (status scope):**

```json
{
  "scope": "status",
  "activeAgents": 3,
  "agents": [
    { "id": "agent-a1", "role": "implementer", "state": "running", "elapsed": 45000 }
  ],
  "activePipelines": 1,
  "budget": {
    "dagCount": 1,
    "global": { "totalSession": 500000, "spent": 15000, "remaining": 485000, "utilization": 0.03 }
  },
  "field": { "dimensions": 12 },
  "timestamp": 1710590400000
}
```

---

### swarm_dispatch

**File:** `src/bridge/tools/dispatch-tool.js` (148 lines)

Forward messages to running agents via MessageBus with priority levels. Falls back to direct IPC if the bus is unavailable. Deposits a pheromone trail for each dispatch event.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `agentId` | string | **yes** | -- | Target agent ID to receive the message |
| `message` | string | **yes** | -- | Message content to dispatch |
| `priority` | enum | no | `normal` | Priority: `low` (1), `normal` (5), `high` (8), `critical` (10) |

**Delivery Channels:**

| Channel | Priority | Description |
|---------|----------|-------------|
| `message_bus` | Primary | Via `core.communication.send()` |
| `ipc_direct` | Fallback | Via `spawnClient.sendMessage()` when bus fails |

**Return value:**

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

**File:** `src/bridge/tools/checkpoint-tool.js` (232 lines)

Human-in-the-loop checkpoint management. Three actions: `create` (pause agent), `resolve` (resume with user decision), `list` (view pending checkpoints).

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `action` | enum | **yes** | -- | `create`, `resolve`, or `list` |
| `checkpointId` | string | resolve | -- | Checkpoint ID (required for `resolve`) |
| `resolution` | string | resolve | -- | User resolution text (required for `resolve`) |
| `agentId` | string | no | `unknown` | Agent that created the checkpoint |
| `reason` | string | no | `Checkpoint requested` | Reason for the checkpoint |
| `options` | string[] | no | `[]` | Suggested choices for the user |

**Workflow:**

```
create:
  1. Generate checkpoint ID (cp-{timestamp}-{random})
  2. Persist to DomainStore
  3. Emit field signal "checkpoint.created"
  4. Return STOP instruction -> agent must pause

resolve:
  1. Retrieve checkpoint from store
  2. Update state to "resolved"
  3. Emit field signal "checkpoint.resolved"
  4. Resume agent via spawnClient.resume()
  5. Notify via communication bus

list:
  1. Query all pending (unresolved) checkpoints
  2. Sort by creation time (newest first)
```

**Return value (create):**

```json
{
  "status": "checkpoint_created",
  "checkpointId": "cp-1710590400000-a3b7x2",
  "agentId": "agent-a1",
  "reason": "Destructive file deletion requires approval",
  "options": ["approve", "reject", "modify"],
  "instruction": "STOP - Agent must pause and await user resolution"
}
```

**Return value (resolve):**

```json
{
  "status": "resolved",
  "checkpointId": "cp-1710590400000-a3b7x2",
  "agentId": "agent-a1",
  "resolution": "Approved with modifications",
  "agentResumed": true,
  "resolvedAt": 1710590500000
}
```

---

### swarm_spawn

**File:** `src/bridge/tools/spawn-tool.js` (186 lines)

Direct agent spawn that bypasses SpawnAdvisor, DualProcessRouter, intent classification, DAG planning, and ImmunitySystem checks. Use when you need explicit control over role, model, and tools.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `role` | string | **yes** | -- | Agent role (see built-in roles below) |
| `model` | string | **yes** | -- | LLM model (`fast`, `balanced`, `strong`) |
| `task` | string | **yes** | -- | Task description |
| `tools` | string[] | no | role defaults | Explicit tool list (overrides role defaults) |
| `prompt` | string | no | auto-generated | Custom prompt (overrides PromptArchitect) |
| `context` | object | no | -- | Additional context merged into prompt |
| `background` | boolean | no | `false` | Run in background without blocking |

**Built-in Roles and Default Tools:**

| Role | Default Tools | Description |
|------|--------------|-------------|
| `implementer` | `file_read`, `file_write`, `bash` | Code implementation |
| `reviewer` | `file_read`, `bash` | Code review and analysis |
| `researcher` | `file_read`, `web_search` | Information gathering |
| `planner` | `file_read` | Task planning and decomposition |
| `tester` | `file_read`, `bash` | Testing and validation |
| `debugger` | `file_read`, `file_write`, `bash` | Bug diagnosis and fixing |
| `documenter` | `file_read`, `file_write` | Documentation writing |
| `architect` | `file_read` | Architecture design and decisions |

**Return value:**

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

**File:** `src/bridge/tools/pheromone-tool.js` (242 lines)

Stigmergic communication via pheromone trails. Four actions: `deposit`, `read`, `types`, `stats`.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `action` | enum | **yes** | -- | `deposit`, `read`, `types`, or `stats` |
| `type` | string | deposit | -- | Pheromone type (required for `deposit`) |
| `scope` | string | no | session scope | Scope/location for the trail |
| `intensity` | number | no | `0.5` | Signal intensity [0.0, 1.0] |
| `metadata` | object | no | `{}` | Additional metadata to attach |
| `message` | string | no | `""` | Human-readable message |

**6 canonical pheromone types + supported legacy aliases:**

| Canonical Type | Decay Rate | Description | Accepted legacy aliases |
|------|-----------|-------------|--------------------------|
| `trail` | 0.008 | Path / progress trails | `progress`, `dependency` |
| `alarm` | 0.15 | Alarm / anomaly signals | `warning`, `failure`, `conflict` |
| `recruit` | 0.03 | Recruitment / assistance requests | `collaboration`, `dispatch` |
| `queen` | 0.005 | Global directive signals | `checkpoint` |
| `dance` | 0.02 | Knowledge discovery signals | `discovery` |
| `food` | 0.006 | High-quality outcome markers | `success` |

Legacy aliases are still accepted on input for backward compatibility, but the runtime registry is canonicalized to the six types above.

**Return value (deposit):**

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

**Return value (read):**

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

**Return value (stats):**

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

**File:** `src/bridge/tools/gate-tool.js` (261 lines)

Evidence-based quality gating. Three actions: `evaluate` (submit claim with evidence), `appeal` (resubmit with additional evidence), `history` (view past evaluations).

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `action` | enum | **yes** | -- | `evaluate`, `appeal`, or `history` |
| `claim` | object | evaluate | -- | Claim to evaluate (see schema below) |
| `evidences` | array | evaluate/appeal | -- | Evidence items (see schema below) |
| `evaluationId` | string | appeal | -- | Previous evaluation ID to appeal |
| `limit` | number | no | `20` | Max history entries to return |

**Claim Schema:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Claim type (`task_complete`, `quality_met`, `test_passed`) |
| `description` | string | What is being claimed |
| `agentId` | string | Agent making the claim |
| `dagId` | string | Associated DAG ID |

**Evidence Item Schema:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Evidence type (`test_result`, `code_review`, `metric`, `user_feedback`) |
| `content` | string | Evidence content or reference |
| `weight` | number | Evidence weight [0.0, 1.0] (default 0.5) |

**Evaluation Thresholds:**

| Action | Threshold | Description |
|--------|-----------|-------------|
| `evaluate` | 0.6 | Weighted average of evidence weights must meet this |
| `appeal` | 0.5 | Lower threshold for appeals (second chance) |

**Return value (evaluate):**

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

**File:** `src/bridge/tools/memory-tool.js` (238 lines)

Semantic memory CRUD operations. Five actions: `search`, `record`, `forget`, `stats`, `export`.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `action` | enum | **yes** | -- | `search`, `record`, `forget`, `stats`, or `export` |
| `query` | string | search | -- | Search query (required for `search`) |
| `content` | string | record | -- | Content to store (required for `record`) |
| `type` | string | no | `general` | Memory entry type (`fact`, `decision`, `lesson`, `pattern`) |
| `memoryId` | string | forget | -- | Memory entry ID (required for `forget`) |
| `tags` | string[] | no | `[]` | Tags for categorization |
| `limit` | number | no | 20/100 | Max results (20 for search, 100 for export) |

**Return value (search):**

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

**Return value (record):**

```json
{
  "status": "recorded",
  "memoryId": "mem-1710590400000-x3k7p2",
  "type": "lesson",
  "tags": ["auth", "security"],
  "contentLength": 52
}
```

**Return value (stats):**

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

**File:** `src/bridge/tools/plan-tool.js` (320 lines)

DAG plan management. Four actions: `view`, `modify`, `validate`, `cancel`.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `action` | enum | **yes** | -- | `view`, `modify`, `validate`, or `cancel` |
| `dagId` | string | **yes** | -- | DAG/Plan ID (required for all actions) |
| `modifications` | object | modify | -- | Modifications to apply (see schema below) |

**Modifications Schema:**

| Field | Type | Description |
|-------|------|-------------|
| `addNodes` | array | Nodes to add: `{ id, task, role, dependsOn[] }` |
| `removeNodes` | string[] | Node IDs to remove |
| `updateTimeBudget` | number | New time budget in milliseconds |
| `updatePriority` | number | New priority level (1-10) |

**Validate Action -- checks performed:**

1. **Missing dependencies** -- nodes referencing non-existent dependency IDs
2. **Duplicate IDs** -- multiple nodes with the same ID
3. **Cycle detection** -- topological sort failure indicates a cycle

**Return value (view):**

```json
{
  "status": "ok",
  "action": "view",
  "dagId": "dag-1710590400000",
  "state": "running",
  "summary": "Implement authentication module",
  "nodes": [
    { "id": "n1", "task": "Write tests", "role": "tester", "state": "completed", "agentId": "a1", "dependsOn": [] },
    { "id": "n2", "task": "Implement code", "role": "implementer", "state": "running", "agentId": "a2", "dependsOn": ["n1"] }
  ],
  "edges": [],
  "timeBudgetMs": 300000,
  "completedNodes": 1,
  "totalNodes": 2,
  "percentage": 50
}
```

**Return value (validate):**

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

**Return value (cancel):**

```json
{
  "status": "cancelled",
  "dagId": "dag-1710590400000",
  "cancelledAgents": ["agent-a1", "agent-a2"],
  "cancelledAgentCount": 2
}
```

**DAG Engine Node State Machine:**

```
PENDING → SPAWNING → ASSIGNED → EXECUTING → COMPLETED
                                          └→ DEAD_LETTER
```

The `SPAWNING` state indicates a node whose agent spawn has been requested but not yet confirmed by the gateway. This prevents duplicate spawns during high-concurrency DAG execution.

**DAGEngine API Methods:**

| Method | Description |
|--------|-------------|
| `planTask(intent, scope)` | Create a DAG from intent classification and scope estimate |
| `addNode(dagId, node)` | Add a node to an existing DAG |
| `spawnNode(dagId, nodeId)` | Transition a PENDING node to SPAWNING and request agent spawn |
| `completeNode(dagId, nodeId, result)` | Mark a node as COMPLETED and trigger downstream dependencies |
| `failNode(dagId, nodeId, error)` | Move a node to DEAD_LETTER with error context |

---

### swarm_zone

**File:** `src/bridge/tools/zone-tool.js` (255 lines)

File/resource zone management with distributed locking. Four actions: `detect`, `lock`, `unlock`, `list`.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `action` | enum | **yes** | -- | `detect`, `lock`, `unlock`, or `list` |
| `path` | string | detect/lock/unlock | -- | File or directory path |
| `agentId` | string | no | `bridge` | Agent requesting the lock |
| `reason` | string | no | `Exclusive access requested` | Reason for acquiring the lock |
| `force` | boolean | no | `false` | Force unlock even if held by another agent |

**Return value (lock -- granted):**

```json
{
  "status": "locked",
  "lockId": "lock-1710590400000-m7k2x9",
  "path": "src/auth/login.js",
  "agentId": "agent-a1",
  "reason": "Implementing authentication flow",
  "warning": null
}
```

**Return value (lock -- denied):**

```json
{
  "status": "denied",
  "path": "src/auth/login.js",
  "heldBy": "agent-a2",
  "heldSince": 1710590300000,
  "reason": "Zone is already locked by another agent"
}
```

**Return value (list):**

```json
{
  "status": "ok",
  "action": "list",
  "scope": "default",
  "count": 2,
  "locks": [
    { "lockId": "lock-...", "path": "src/auth/", "agentId": "agent-a1", "reason": "Auth module", "lockedAt": 1710590400000, "age": 15000 }
  ]
}
```

---

## Hooks

Source: `src/bridge/hooks/hook-adapter.js` (433 lines). The `HookAdapter` class maps all 16 OpenClaw hooks to V9 domain operations. Each handler is wrapped in try/catch so a single domain failure never tears down the hook pipeline.

### Hook Registration

```javascript
const adapter = new HookAdapter({ core, quality, observe, sessionBridge, modelFallback, spawnClient });
adapter.registerHooks(app); // registers all 16 hooks
```

### 16 Hooks Reference

| # | Hook | Method | Direction | Description |
|---|------|--------|-----------|-------------|
| 1 | `activate` | `onActivate()` | -- | Start all domains in dependency order (communication -> intelligence -> orchestration -> quality -> observe) |
| 2 | `deactivate` | `onDeactivate()` | -- | Stop all domains in reverse order |
| 3 | `session_start` | `onSessionStart(session)` | in | Initialize session scope via SessionBridge |
| 4 | `session_end` | `onSessionEnd(session)` | in | Clean up session state |
| 5 | `message_created` | `onMessageCreated(session, message)` | in -> out | Classify intent and estimate scope. Returns `{ intent, scope }` |
| 6 | `before_agent_start` | `onBeforeAgentStart(session, agent)` | in -> mutate | **Most complex hook.** 7-step pipeline (see below). Returns `{ advised, role }` |
| 7 | `agent_start` | `onAgentStart(session, agent)` | in | Begin trace span, track agent in session |
| 8 | `agent_end` | `onAgentEnd(session, agent, result)` | in | End trace span, clean up, quality audit, credit assignment, classify failures |
| 9 | `llm_output` | `onLlmOutput(session, output)` | in | Run compliance monitor against generated content |
| 10 | `before_tool_call` | `onBeforeToolCall(session, toolCall)` | in -> out | Circuit breaker check + schema validation. Returns `{ blocked, reason, repairPrompt }` |
| 11 | `after_tool_call` | `onAfterToolCall(session, toolCall, result)` | in | Record tool success/failure for circuit breaker |
| 12 | `prependSystemContext` | `onPrependSystemContext(session)` | -- -> out | Superpose field vector for current scope. Returns `<swarm-context>` XML string |
| 13 | `before_shutdown` | `onBeforeShutdown()` | -- | Snapshot all domain stores for persistence |
| 14 | `error` | `onError(session, error)` | in -> out | Route to ModelFallback for retry/fallback decisions |
| 15 | `tool_result` | `onToolResult(session, result)` | in | Feed result to anomaly detector for event tracking |
| 16 | `agent_message` | `onAgentMessage(session, message)` | in | Post to task channel and append to working memory |

### before_agent_start -- 7-Step Pipeline

This is the most complex hook. It mutates the `agent` object before spawn:

| Step | Operation | Source |
|------|-----------|--------|
| 1 | **SpawnAdvisor** -- recommend role, model, tool permissions | `core.orchestration.advisor.advise()` |
| 2 | **ImmunitySystem** -- get prevention prompts from failure vaccination | `quality.checkImmunity()` |
| 3 | **Compliance** -- escalation prompt for the session | `quality.getCompliancePrompt()` |
| 4 | **PromptArchitect** -- build dynamic prompt with all context | `core.intelligence.buildPrompt()` |
| 5 | **Inject prompt** -- set `agent.systemPrompt` | direct mutation |
| 6 | **Tool permissions** -- restrict `agent.allowedTools` from advisor | direct mutation |
| 7 | **Model override** -- set `agent.model` and `agent.role` from advisor | direct mutation |

### Hook Statistics

```javascript
adapter.getStats();
// Returns:
// {
//   hooksFired: 1247,
//   hookErrors: 3,
//   blockedToolCalls: 12,
//   agentsAdvised: 45
// }
```

---

## Event Catalog

Source: `src/core/bus/event-catalog.js`. **27 event topics** organized by domain.

### Events by Domain

#### Field (3 events)

| Constant | Topic | Payload |
|----------|-------|---------|
| `FIELD_SIGNAL_EMITTED` | `field.signal.emitted` | `Signal` object |
| `FIELD_GC_COMPLETED` | `field.gc.completed` | `{ collected: number, remaining: number }` |
| `FIELD_EMERGENCY_GC` | `field.emergency_gc` | `{ reason: string, freed: number }` |

#### Store (2 events)

| Constant | Topic | Payload |
|----------|-------|---------|
| `STORE_SNAPSHOT_COMPLETED` | `store.snapshot.completed` | `{ snapshotId: string, size: number }` |
| `STORE_RESTORE_COMPLETED` | `store.restore.completed` | `{ snapshotId: string, restoredKeys: number }` |

#### Communication (5 events)

| Constant | Topic | Payload |
|----------|-------|---------|
| `CHANNEL_CREATED` | `channel.created` | `{ channelId: string, type: string }` |
| `CHANNEL_CLOSED` | `channel.closed` | `{ channelId: string, reason: string }` |
| `CHANNEL_MESSAGE` | `channel.message` | `{ channelId: string, from: string, message: any }` |
| `PHEROMONE_DEPOSITED` | `pheromone.deposited` | `{ trailId: string, type: string, intensity: number }` |
| `PHEROMONE_EVAPORATED` | `pheromone.evaporated` | `{ trailId: string, remaining: number }` |

#### Intelligence (7 events)

| Constant | Topic | Payload |
|----------|-------|---------|
| `AGENT_SPAWNED` | `agent.lifecycle.spawned` | `{ agentId: string, species: string }` |
| `AGENT_READY` | `agent.lifecycle.ready` | `{ agentId: string }` |
| `AGENT_COMPLETED` | `agent.lifecycle.completed` | `{ agentId: string, result: any }` |
| `AGENT_FAILED` | `agent.lifecycle.failed` | `{ agentId: string, error: string }` |
| `AGENT_ENDED` | `agent.lifecycle.ended` | `{ agentId: string, reason: string }` |
| `MEMORY_RECORDED` | `memory.episode.recorded` | `{ agentId: string, episodeId: string }` |
| `MEMORY_CONSOLIDATED` | `memory.consolidated` | `{ agentId: string, consolidated: number }` |

#### Orchestration (5 events)

| Constant | Topic | Payload |
|----------|-------|---------|
| `TASK_CREATED` | `task.created` | `{ taskId: string, type: string }` |
| `TASK_COMPLETED` | `task.completed` | `{ taskId: string, result: any }` |
| `DAG_STATE_CHANGED` | `dag.state.changed` | `{ dagId: string, state: string }` |
| `SPAWN_ADVISED` | `spawn.advised` | `{ species: string, reason: string }` |
| `REPUTATION_UPDATED` | `reputation.updated` | `{ agentId: string, score: number, delta: number }` |

#### Quality (5 events)

| Constant | Topic | Payload |
|----------|-------|---------|
| `GATE_PASSED` | `quality.gate.passed` | `{ gateId: string, score: number }` |
| `GATE_FAILED` | `quality.gate.failed` | `{ gateId: string, score: number, threshold: number }` |
| `BREAKER_TRIPPED` | `quality.breaker.tripped` | `{ breakerId: string, failures: number }` |
| `ANOMALY_DETECTED` | `quality.anomaly.detected` | `{ type: string, severity: string, details: any }` |
| `COMPLIANCE_VIOLATION` | `quality.compliance.violation` | `{ rule: string, agentId: string, details: string }` |

#### Observe (1 event)

| Constant | Topic | Payload |
|----------|-------|---------|
| `METRICS_COLLECTED` | `observe.metrics.collected` | `{ timestamp: number, metrics: object }` |

---

## REST Endpoints

Source: `src/observe/dashboard/dashboard-service.js` (662 lines). All endpoints served on port **19100** via Node.js `http.createServer()`. HTTP method is **GET** for all endpoints. Response format: raw JSON from handler (no wrapper envelope).

### Field (4 endpoints)

| Path | Description | Return Type |
|------|-------------|-------------|
| `GET /api/v9/field/stats` | Signal field statistics | `{ totalSignals, activeCount, ... }` |
| `GET /api/v9/field/superpose/:scope` | Superpose all signals at a scope into a vector | `{ dimensions: {...}, coherence }` |
| `GET /api/v9/field/signals` | Query signals with filters (`?type=...&scope=...`) | `Signal[]` |
| `GET /api/v9/field/dimensions` | 12-dimension field descriptor array | `[{ id, label, description }]` |

### Agents (4 endpoints)

| Path | Description | Return Type |
|------|-------------|-------------|
| `GET /api/v9/agents/active` | Active agent list | `Agent[]` |
| `GET /api/v9/agents/states` | All agent state machines | `{ agentId: state }` |
| `GET /api/v9/agents/capabilities` | Agent capability vectors | `{ agentId: capabilities }` |
| `GET /api/v9/agents/:id` | Single agent detail | `Agent` |

### Orchestration / Tasks (4 endpoints)

| Path | Description | Return Type |
|------|-------------|-------------|
| `GET /api/v9/tasks` | All tasks | `Task[]` |
| `GET /api/v9/tasks/dead-letters` | Dead letter queue | `Task[]` |
| `GET /api/v9/tasks/critical-path` | Critical path analysis | `{ path[], bottleneck }` |
| `GET /api/v9/tasks/:dagId` | DAG detail by ID | `DAG` |

### Social (5 endpoints)

| Path | Description | Return Type |
|------|-------------|-------------|
| `GET /api/v9/reputation` | Agent reputation scores | `{ agents: [...], globalScore }` |
| `GET /api/v9/sna` | Social network analysis metrics | `{ nodes, edges, metrics }` |
| `GET /api/v9/emotional-states` | Agent emotional state vectors | `{ agentId: emotionalVector }` |
| `GET /api/v9/trust` | Trust matrix | `{ pairs: [...] }` |
| `GET /api/v9/cultural-friction` | Cultural friction between providers | `{ matrix: {...} }` |

### Adaptation (9 endpoints)

| Path | Description | Return Type |
|------|-------------|-------------|
| `GET /api/v9/modulator` | Global modulator mode and factors | `{ currentMode, factors }` |
| `GET /api/v9/shapley` | Shapley credit attribution | `{ dagId, credits: {} }` |
| `GET /api/v9/species` | Species evolver state | `{ active: [], retired: [] }` |
| `GET /api/v9/calibration` | Signal calibration state | `{ phase, weights }` |
| `GET /api/v9/budget` | Budget tracker aggregate state | `{ dagCount, dags: CostReport[], global }` |
| `GET /api/v9/budget-forecast` | Budget forecaster history and accuracy | `{ historyCount, lastRecordedAt, accuracy, byTaskType }` |
| `GET /api/v9/dual-process` | Dual-process routing stats | `{ s1Count, s2Count, avgLatency }` |
| `GET /api/v9/signal-weights` | Signal calibration weights (one per dimension) | `{ dimension: weight }` |
| `GET /api/v9/role-discovery` | Emergent role discovery patterns | `{ discovered: [...] }` |

### Quality (5 endpoints)

| Path | Description | Return Type |
|------|-------------|-------------|
| `GET /api/v9/quality-audit` | Quality audit history | `Evaluation[]` |
| `GET /api/v9/failure-modes` | Failure mode distribution | `{ mode: count }` |
| `GET /api/v9/compliance` | Compliance statistics | `{ compliant, violations }` |
| `GET /api/v9/circuit-breakers` | All circuit breaker states | `{ tool: breakerState }` |
| `GET /api/v9/vaccinations` | Failure vaccination antigens | `Antigen[]` |

### Communication (3 endpoints)

| Path | Description | Return Type |
|------|-------------|-------------|
| `GET /api/v9/pheromones` | Pheromone grid state | `{ trails, activeTypes, totalDeposits }` |
| `GET /api/v9/channels` | Active communication channels | `Channel[]` |
| `GET /api/v9/stigmergy` | Stigmergic board state | `{ posts: [...] }` |

### Governance (2 endpoints)

| Path | Description | Return Type |
|------|-------------|-------------|
| `GET /api/v9/governance` | Governance statistics | `{ governanceScore, complianceRate }` |
| `GET /api/v9/emergence` | Emergence pattern detection | `{ patterns: [...] }` |

### Traces (2 endpoints)

| Path | Description | Return Type |
|------|-------------|-------------|
| `GET /api/v9/traces` | Query trace spans (`?traceId=...&limit=...`) | `Trace[]` |
| `GET /api/v9/traces/:id` | Single trace detail | `Trace` |

### System (5 endpoints)

| Path | Description | Return Type |
|------|-------------|-------------|
| `GET /api/v9/metrics` | Metrics collector snapshot | `{ agents, tasks, signals, pheromones, quality, budget, channels, memory, errors, performance, hooks }` |
| `GET /api/v9/health` | System health check | `{ status, score, dimensions, ts }` |
| `GET /api/v9/config` | Dashboard configuration | `{ port, consolePath, fieldDimensions, registeredRoutes }` |
| `GET /api/v9/bus/stats` | EventBus statistics | `{ published, subscribers, queued }` |
| `GET /api/v9/store/stats` | Persistent store statistics | `{ domains, totalKeys, snapshotCount }` |

### User-Facing (3 endpoints)

| Path | Description | Return Type |
|------|-------------|-------------|
| `GET /api/v9/progress/:dagId` | DAG progress report | `{ dagId, completedNodes, totalNodes, percentage, state, elapsed, remainingBudget, blockers }` |
| `GET /api/v9/cost-report/:dagId` | Cost report by DAG | `{ dagId, totalBudget, spent, remaining, utilization, phases, overrun, timestamp }` |
| `GET /api/v9/artifacts/:dagId` | Artifacts produced by a DAG | `Artifact[]` |

### Memory / Identity (3 endpoints)

| Path | Description | Return Type |
|------|-------------|-------------|
| `GET /api/v9/memory/stats` | Memory store statistics | `{ totalEntries, byType }` |
| `GET /api/v9/identity` | Agent identity map | `{ agentId: identity }` |
| `GET /api/v9/context-window` | Context window usage stats | `{ maxTokens, reservedTokens, workingMemoryBuffers, workingMemoryEntries }` |

### Bridge (2 endpoints)

| Path | Description | Return Type |
|------|-------------|-------------|
| `GET /api/v9/bridge/status` | Bridge readiness and registered capabilities | `{ ready, hooks, tools, sessionBridge, spawnClient, modelFallback }` |
| `GET /api/v9/bridge/queue` | Bridge message queue | `Message[]` |

### Topology (4 endpoints)

| Path | Description | Return Type |
|------|-------------|-------------|
| `GET /api/v9/topology` | Module topology overview | `{ moduleCount, dagCount, zones, domains }` |
| `GET /api/v9/topology/graph` | Produces/consumes graph | `{ nodes: [], edges: [] }` |
| `GET /api/v9/modules` | Module manifest | `ModuleManifest[]` |
| `GET /api/v9/modules/:moduleId` | Single module detail | `ModuleManifest` |

### Legacy Aliases (14 endpoints)

These V1 paths redirect to their V9 counterparts:

| Legacy Path | V9 Target |
|-------------|-----------|
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

### Dashboard Routes (2 + SSE)

| Path | Description |
|------|-------------|
| `GET /v9/console` | V9 React SPA console (Swarm Console) |
| `GET /v9/console/*` | Console static assets + SPA fallback |
| `GET /api/v9/events` | SSE event stream (see below) |

The live console state feed itself uses the WebSocket bridge on port `19101`; SSE remains available as a legacy diagnostics/event stream.

---

## SSE Event Stream

**Endpoint:** `GET /api/v9/events` on port 19100

The `StateBroadcaster` subscribes to EventBus topics and streams them as Server-Sent Events to connected console clients.

**API:** `StateBroadcaster.setVerbosity(level)` -- Controls event filtering granularity. Levels: `0` (critical only), `1` (default -- domain events), `2` (verbose -- includes field ticks and internal diagnostics).

### Wire Format

```
:\n\n
data: {"topic":"agent.lifecycle.spawned","data":{"agentId":"a1","species":"implementer"},"timestamp":1710590400000}

data: {"topic":"quality.gate.passed","data":{"gateId":"g1","score":0.85},"timestamp":1710590401000}
```

The initial `:\n\n` comment is a keepalive probe sent on connection. Events use unnamed SSE format (data-only, no `event:` field). The `topic` field in the JSON payload maps to the 27 events in the Event Catalog.

### Client Connection

```javascript
const es = new EventSource('http://127.0.0.1:19100/api/v9/events');
es.onmessage = (e) => {
  const { topic, data, timestamp } = JSON.parse(e.data);
  // Route to appropriate handler based on topic
};
```

### Connection Lifecycle

1. Client opens `EventSource` connection
2. Server sends `:\n\n` keepalive comment
3. Server streams events as `data: {...}\n\n` lines
4. On client disconnect, server removes the client from the broadcast set
5. `StateBroadcaster.addClient(res)` manages the client if available; otherwise DashboardService tracks locally

---

[<- Back to README](../../README.md) | [中文版](../zh-CN/api-reference.md)
