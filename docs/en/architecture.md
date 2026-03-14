# Architecture

Claw-Swarm V7.0 runs as an OpenClaw plugin using a **fork-based two-tier process model**. This document describes the runtime architecture, inter-process communication, and key subsystems with source-code anchors.

## Process Model

```
  OpenClaw Gateway (Node.js)         Claw-Swarm Child Process (fork)
  ┌──────────────────────────┐       ┌──────────────────────────────┐
  │  index.js (plugin shell) │──IPC──│  swarm-core.js (SwarmCore)   │
  │  - Tier A hooks (hot)    │       │  - All L1-L6 engines         │
  │  - Circuit breaker cache │       │  - Tier B hooks (IPC proxy)  │
  │  - Model capability map  │       │  - Tool execution            │
  │  - Routing decisions     │       │  - DashboardService :19100   │
  │  - Subagent depth guard  │       │  - WorkerPool (4 threads)    │
  └──────────────────────────┘       └──────────────────────────────┘
```

The gateway spawns `swarm-core.js` via `child_process.fork()` with an IPC channel (`src/index.js:167-215`). This isolates engine state from the gateway main thread.

- **Tier A hooks** execute in the gateway process with cached data. Latency target: <0.1 ms. Examples: circuit breaker lookups, model capability checks, subagent concurrency guards (`src/index.js:356-445`).
- **Tier B hooks** proxy through IPC to the child process. Tolerate 2-5 ms latency. Examples: prompt building, agent lifecycle events, compliance checks (`src/index.js:448-559`).

The IPC bridge (`src/L1-infrastructure/ipc-bridge.js`) uses a request/response/notify protocol with 5 s default timeout and a 10,000 pending-request safety cap.

## 6-Layer Architecture

All source code under `src/` is organized into six layers. Each layer depends only on layers below it.

| Layer | Directory | Responsibility | File Count |
|-------|-----------|----------------|------------|
| L1 | `src/L1-infrastructure/` | Database, config, logging, IPC, worker threads | 25 |
| L2 | `src/L2-communication/` | Message bus, pheromones, gossip, relay client | 13 |
| L3 | `src/L3-agent/` | Capabilities, memory (working/episodic/semantic), reputation, evolution | 21 |
| L4 | `src/L4-orchestration/` | DAG engine, contract net, scheduling, quality gates, roles | 25 |
| L5 | `src/L5-application/` | Plugin adapter, tools (4 public + 6 internal), circuit breaker, resilience | 18 |
| L6 | `src/L6-monitoring/` | Dashboard REST API (45+ endpoints), SSE broadcaster, metrics, health checks | 7 + 98 console |

Total: 173 JavaScript source files (`find src -name "*.js" -not -path "*/node_modules/*" -not -path "*/dist/*" | wc -l`).

## Hook Registration

The plugin shell registers 19 hooks with the OpenClaw API (`src/index.js`). Hooks are split across two tiers:

**Tier A (gateway process, 5 hooks):**

| Hook | Priority | Purpose | Lines |
|------|----------|---------|-------|
| `before_model_resolve` | 20 | Model capability cache lookup | 360-376 |
| `before_tool_call` | 12 | SwarmGuard: blocks non-swarm tools before swarm_run | 443-445 |
| `before_tool_call` | 10 | Circuit breaker state check | 379-391 |
| `before_tool_call` | 8 | Routing decision gate | 394-410 |
| `subagent_spawning` | 10 | Depth/concurrency validation (max depth 5, max concurrent 10) | 413-438 |

**Tier B (IPC proxy to child, 14 hooks):**

`before_prompt_build` (x3), `before_agent_start`, `agent_end`, `after_tool_call`, `before_reset`, `message_sending`, `subagent_spawned`, `subagent_ended`, `llm_output`, and others. Fire-and-forget or 2 s timeout calls.

## Subagent Spawning: DirectSpawnClient

Subagent creation bypasses the plugin API and connects directly to the Gateway internal WebSocket RPC (`src/L2-communication/swarm-relay-client.js`).

**Flow:**

1. `swarm_run` tool generates an execution plan with phases.
2. Each phase spawns a child session via `callGateway({ method: 'agent', lane: 'subagent', spawnedBy: parentKey })`.
3. The spawn returns immediately (two-phase async). The parent session continues.
4. Background polling checks child session status every 5 s.
5. On completion, `chat.inject` pushes results back to the parent transcript at zero LLM cost.

**Authentication:** WebSocket challenge-response with nonce. Role: `operator.admin` scopes (`swarm-relay-client.js:773-867`).

## Engine Initialization Order

All engines are assembled in `src/L5-application/plugin-adapter.js` via dependency injection:

```
L1 (Database, Config, Clock, WorkerPool)
  → L2 (MessageBus, PheromoneEngine, GossipProtocol, StigmergicBoard)
    → L3 (Memory systems, Reputation, Capability, Persona, SNA)
      → L4 (Orchestrator, DAG, ContractNet, ABC, Quality, Budget, Shapley)
        → L5 (PluginAdapter, ToolResilience, SkillGovernor)
```

Destruction runs in reverse order. The `engines` object is shared with `DashboardService` for live references.

## Event System

The `MessageBus` (`src/L2-communication/message-bus.js`) provides topic-based pub/sub with wildcard support (`topic.*`), dead letter queue, and pluggable transports. 122 event topics are defined in `src/event-catalog.js`.

The `StateBroadcaster` (`src/L6-monitoring/state-broadcaster.js`) subscribes to relevant topics and streams them as SSE events to connected console clients via the `/events` endpoint.

## Console Frontend

A React SPA served at `/v6/console` on port 19100 (`src/L6-monitoring/console/src/App.jsx`). 98 source files, 6 views:

| View | Component | Function |
|------|-----------|----------|
| Hive | `HiveOverlay` | Canvas-based swarm activity visualization |
| Pipeline | `PipelineOverlay` | DAG execution progress and contract lifecycle |
| Cognition | `CognitionOverlay` | Dual-process routing and signal weights |
| Ecology | `EcologyOverlay` | Shapley credit distribution and species evolution |
| Network | `NetworkOverlay` | SNA graph with centrality metrics |
| Control | `ControlOverlay` | RED metrics, budget, circuit breaker status |

State management: Zustand. Real-time updates: SSE via `sse-client.js`. UI features: `CommandPalette` (Ctrl+K), `EventTimeline` with replay, `Inspector` panel, toast notifications.

## 7-Layer Reliability Chain

| Layer | Mechanism | File |
|-------|-----------|------|
| 1 | System prompt injection via `prependSystemContext` (XML tags) | `swarm-core.js` |
| 2 | `before_tool_call` SwarmGuard at p12 blocks non-swarm tools until swarm_run | `index.js` |
| 3 | Session-scoped `_lastSuccessfulInjectResults` Map for IPC failure fallback | `index.js` + `swarm-core.js` |
| 4 | `_swarmCoreReady` flag: tools return `{status:'not_ready'}` before init | `index.js` |
| 5 | Spawn failure pushes error directly to parent session (no silent orphan) | `swarm-run-tool.js` |
| 6 | `_injectWithRetry`: max 3 retries with exponential backoff (500 ms / 1 s / 2 s) | `swarm-core.js` |
| 7 | LLM output compliance check with escalation counter and prompt upgrade | `swarm-core.js` |

## Feature Flags

Feature flag dependency tree (`src/index.js:110-118`):

```
dagEngine ← hierarchical
speculativeExecution ← dagEngine
workStealing ← dagEngine
evolution.clustering ← evolution.scoring
evolution.gep ← evolution.scoring
evolution.abc ← evolution.scoring
evolution.lotkaVolterra ← evolution.scoring
```

Validation runs at gateway startup. Missing dependencies block activation.

## Key Constants

| Constant | Value | Location |
|----------|-------|----------|
| Max subagent concurrency | 10 | `index.js:97` |
| Max subagent depth | 5 | `index.js:98` |
| IPC default timeout | 5,000 ms | `index.js:183` |
| Recent events buffer | 20 | `swarm-core.js:131` |
| Max pending IPC requests | 10,000 | `ipc-bridge.js:29` |
| Dashboard port | 19,100 | `dashboard-service.js:69` |
| Gateway port | 18,789 | OpenClaw config |
| Worker pool size | 4 | `worker-pool.js:34` |

---
[← Back to README](../../README.md) | [中文版](../zh-CN/architecture.md)
