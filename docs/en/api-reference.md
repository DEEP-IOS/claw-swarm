# API Reference

This document covers the public tool interface, event catalog, and REST API endpoints of Claw-Swarm V7.0. All counts and schemas are derived from source code.

## Public Tools (4)

Claw-Swarm exposes 4 public tools to LLM agents. 6 additional internal tools exist for automated hook use (deprecated from direct invocation; functionality absorbed into hooks). Tool files live in `src/L5-application/tools/`.

### swarm_run

**File:** `src/L5-application/tools/swarm-run-tool.js`

One-click swarm collaboration. Decomposes a goal into subtasks, selects roles, and dispatches sub-agents for parallel execution.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `goal` | string | yes | Target description |
| `mode` | enum | no | `auto` (default), `plan_only`, `execute`, `cancel`, `resume` |
| `planId` | string | no | Plan ID (required for `execute` mode) |
| `dagId` | string | no | DAG ID (for `cancel` mode) |
| `taskId` | string | no | Task ID (for `cancel` mode) |
| `maxRoles` | number | no | Max roles per plan (default 5) |

**Modes:**

- **auto**: Design execution plan + immediately dispatch all phases via DirectSpawnClient.
- **plan_only**: Design plan only; returns phase array without spawning agents.
- **execute**: Execute dispatch for a previously designed plan (by `planId`).
- **cancel**: Cancel a running task or DAG.
- **resume**: Resume a suspended plan (e.g., after checkpoint approval).

**Role Mapping** (lines 74-112):

| Agent ID | Role | Keywords |
|----------|------|----------|
| mpu-d3 | Worker bee | coding, implementation, engineering, testing |
| mpu-d2 | Guard bee | review, audit, verification, analysis, architecture |
| mpu-d1 | Scout bee | research, search, exploration |
| mpu-d4 | Designer bee | design, UI, visual, UX |

### swarm_query

**File:** `src/L5-application/tools/swarm-query-tool.js`

Read-only query for the full swarm state. 10 scopes covering agents, tasks, pheromones, memory, quality, zones, plans, and the stigmergic board.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `scope` | enum | yes | `status`, `agent`, `task`, `agents`, `pheromones`, `memory`, `quality`, `zones`, `plans`, `board` |
| `agentId` | string | no | Agent ID (for `agent` scope) |
| `taskId` | string | no | Task ID (for `task`/`quality` scope) |
| `planId` | string | no | Plan ID (for `plans` scope detail) |
| `filter` | object | no | `{tier, status}` for filtering |
| `keyword` | string | no | Search keyword (`memory`/`pheromones` scope) |
| `crossAgent` | boolean | no | Cross-agent global recall (`memory` scope) |
| `limit` | number | no | Max results |
| `targetScope` | string | no | Target path (`board`/`pheromones`) |

### swarm_dispatch

**File:** `src/L5-application/tools/swarm-dispatch-tool.js`

Dispatch tasks to specific sub-agents. Constructs @mention messages and sends via the collaboration channel.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `agentId` | enum | yes | `mpu-d1` (scout), `mpu-d2` (guard), `mpu-d3` (worker) |
| `task` | string | yes | Task description for the sub-agent |

### swarm_checkpoint

**File:** `src/L5-application/tools/swarm-checkpoint-tool.js` (V7.1)

Human-in-the-loop checkpoint. Sub-agents call this before irreversible operations requiring user approval.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `question` | string | yes | Confirmation question describing the operation and impact |
| `taskId` | string | no | Current task ID |
| `phaseRole` | string | no | Current role (e.g., CODER, REVIEWER) |
| `phaseDesc` | string | no | Phase description for context on resume |
| `originalGoal` | string | no | Original user goal for re-spawning after approval |

**Workflow:**

1. Sub-agent calls `swarm_checkpoint({question, ...})`.
2. Checkpoint record written to `swarm_user_checkpoints` table.
3. Sub-agent outputs a STOP instruction and terminates.
4. `subagent_ended` hook pushes the question to the parent session.
5. User replies in chat.
6. Next `swarm_run` call detects the pending checkpoint, resolves it, and re-spawns with context.

## Internal Tools (6, deprecated)

These tools are retained for backward compatibility but no longer invoked directly. Their functionality was absorbed into automated hooks.

| Tool | File | Absorbed Into |
|------|------|---------------|
| `swarm_gate` | `swarm-gate-tool.js` | Auto quality hooks |
| `swarm_memory` | `swarm-memory-tool.js` | `swarm_query` memory scope |
| `swarm_pheromone` | `swarm-pheromone-tool.js` | Auto pheromone hooks |
| `swarm_plan` | `swarm-plan-tool.js` | `swarm_run` auto mode |
| `swarm_spawn` | `swarm-spawn-tool.js` | `swarm_run` dispatch |
| `swarm_zone` | `swarm-zone-tool.js` | Auto zone hooks |

## Event Catalog

Source: `src/event-catalog.js` — 122 event topics organized by subsystem.

| Category | Count | Examples |
|----------|-------|---------|
| Agent Lifecycle | 5 | `agent.registered`, `agent.online`, `agent.offline`, `agent.end`, `agent.lifecycle.transition` |
| Task Lifecycle | 8 | `task.created`, `task.assigned`, `task.completed`, `task.failed`, `task.dead_letter` |
| Pheromone | 7 | `pheromone.deposited`, `pheromone.decayed`, `pheromone.escalated` |
| Circuit Breaker | 2 | `circuit_breaker.transition`, `circuit_breaker.restored` |
| Orchestration (DAG) | 2 | `dag.created`, `dag.completed` |
| Contract Net | 5 | `model.bid.awarded`, `live.cfp.completed`, `dag.phase.cascade` |
| Conflict Resolution | 5 | `conflict.detected`, `conflict.resolved`, `consensus.vote.completed` |
| Budget Tracking | 2 | `budget.turn.completed`, `budget.exhaustion.warning` |
| Global Modulator | 1 | `modulator.mode.switched` |
| State Convergence | 3 | `convergence.drift`, `agent.suspect`, `agent.confirmed.dead` |
| Stigmergic Board | 2 | `stigmergic.post.created`, `stigmergic.post.expired` |
| Failure Vaccination | 2 | `failure.vaccine.created`, `failure.vaccine.applied` |
| Adaptive Closed-loop | 10 | `signal.weights.calibrated`, `failure.mode.classified`, `metrics.alert.triggered` |
| Vector/SNA | 6 | `shapley.credit.computed`, `sna.metrics.updated`, `dual_process.routed` |
| Relay/Spawn | 8 | `relay.spawn.requested`, `relay.spawn.completed`, `auto.quality.gate` |
| V7.0 Closed-loop | 11 | `session.patched`, `pi.controller.actuated`, `negative_selection.triggered` |
| Others | 43 | System health, skills, tracing, gossip, evidence, protocol, etc. |

**Event Wrapper:** `wrapEvent(topic, payload, source, options)` standardizes every published event with `eventId`, `timestamp`, and `traceId` fields.

## REST API Endpoints

Source: `src/L6-monitoring/dashboard-service.js` — served on port 19100 (default).

### Core (3 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/metrics` | RED metrics snapshot + hook statistics |
| GET | `/api/stats` | System statistics (broadcaster + collector) |
| GET | `/events` | SSE event stream (topic embedded in JSON payload) |

### Infrastructure Endpoints (10)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/traces/:traceId` | Trace span tree |
| GET | `/api/v1/topology` | Force-directed topology graph |
| GET | `/api/v1/affinity` | Task affinity matrix |
| GET | `/api/v1/dead-letters` | Dead letter queue entries |
| GET | `/api/v1/context-debug` | Context injection debug (sanitized) |
| GET | `/api/v1/breaker-status` | Circuit breaker states |
| GET | `/api/v1/trace-spans` | Trace spans query |
| GET | `/api/v1/startup-summary` | Startup summary cache |
| GET | `/api/v1/dag-status` | DAG execution snapshot |
| GET | `/api/v1/speculation` | Speculative execution stats |

### Analytics Endpoints (11)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/governance` | Governance triple metrics + compliance stats |
| GET | `/api/v1/last-inject` | Last prompt injection snapshot |
| GET | `/api/v1/subagent-stats` | Subagent spawn/success/failure counters |
| GET | `/api/v1/convergence` | State convergence stats |
| GET | `/api/v1/modulator` | Global modulator mode |
| GET | `/api/v1/diagnostics` | Startup diagnostics report |
| GET | `/api/v1/workers` | Worker thread pool status |
| GET | `/api/v1/vectors` | Vector index stats |
| GET | `/api/v1/sna` | SNA network metrics (5 s cache) |
| GET | `/api/v1/shapley` | Shapley credit by DAG |
| GET | `/api/v1/dual-process` | Dual-process routing stats |

### V7.0 Endpoints (15)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/failure-modes` | Failure mode categories + trends |
| GET | `/api/v1/budget-forecast` | Budget forecasting |
| GET | `/api/v1/quality-audit` | Quality audit trail |
| GET | `/api/v1/agent-states` | Agent states enriched with ABC role, reputation |
| GET | `/api/v1/ipc-stats` | IPC latency statistics |
| GET | `/api/v1/trace-analysis` | Trace latency percentiles (p50/p95/p99) |
| GET | `/api/v1/active-sessions` | Active relay sessions |
| GET | `/api/v1/session/:key/status` | Single session status |
| GET | `/api/v1/negative-selection` | Negative selection stats |
| GET | `/api/v1/signal-weights` | Signal calibrator weights |
| GET | `/api/v1/pi-controller` | PI controller stats |
| GET | `/api/v1/abc-roles` | ABC role distribution |
| GET | `/api/v1/species-config` | Species configuration |
| GET | `/api/v1/cold-start` | Cold start progress |
| GET | `/api/v1/bid-history` | Bid/contract statistics |

### Dashboard Routes (4)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | V1 static HTML dashboard |
| GET | `/v2` | V2 hive visualization |
| GET | `/v6/console` | V7 React SPA console |
| GET | `/v6/console/*` | Console static assets + SPA fallback |

---
[← Back to README](../../README.md) | [中文版](../zh-CN/api-reference.md)
