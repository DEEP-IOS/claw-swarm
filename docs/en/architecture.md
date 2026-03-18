# Architecture

[<- Back to README](../../README.md) | [中文版](../zh-CN/architecture.md)

Claw-Swarm V9.0 runs as an OpenClaw plugin using a **single-process, domain-oriented** architecture with a **12-dimensional signal field** at its foundation. This document describes the design motivations, the dual foundation layer, the 7-domain source structure, the signal field, four coupling mechanisms, the ModuleBase contract, process model, hook system, tool architecture, engine initialization, zero-idle guarantees, and key constants -- all with source-code anchors.

---

## Table of Contents

1.  [Design Origins](#design-origins)
2.  [Dual Foundation](#dual-foundation)
3.  [Seven Domains](#seven-domains)
4.  [12-Dimensional Signal Field](#12-dimensional-signal-field)
5.  [Four Coupling Mechanisms](#four-coupling-mechanisms)
6.  [ModuleBase Contract](#modulebase-contract)
7.  [Process Model](#process-model)
8.  [Hook System (16 Hooks)](#hook-system-16-hooks)
9.  [Tool Architecture (10 Tools)](#tool-architecture-10-tools)
10. [Engine Initialization](#engine-initialization)
11. [Zero Feature Flags / Zero Idle](#zero-feature-flags--zero-idle)
12. [Key Constants](#key-constants)

---

## Design Origins

### Three Problems in V8

V8 used a 7-layer linear architecture (L0--L6) with a fork-based two-tier process model. Three structural problems motivated the redesign:

| Problem | V8 Symptom | Root Cause |
|---------|-----------|------------|
| **Idle modules** | EmotionalState, TrustDynamics, SNAAnalyzer, EpisodeLearner published events with zero subscribers | Modules had outputs but no downstream consumers wired to read them |
| **Linear coupling** | Layers depended strictly downward (L6->L5->...->L0); adding a cross-cutting concern required touching every layer | Pipeline topology forced serial data flow; no mechanism for many-to-many interaction |
| **Redundant abstractions** | Feature flags gated 8+ subsystems; 15,000 lines of code with ~13% active utilization | Conditional paths and dead code accumulated because unused modules were never removed or reconnected |

### V9 Design Principles

1. **No module elimination.** Every module designed in V8 had a reason to exist. The fix is reconnecting wires, not deleting modules.
2. **Field/graph topology replaces pipelines.** Modules interact through a shared signal field -- many-to-many, not serial.
3. **Zero feature flags.** All code paths are unconditionally active. Idle detection runs at startup.
4. **Static coupling declarations.** Every module declares `produces()`/`consumes()`/`publishes()`/`subscribes()`. The system verifies completeness before accepting traffic.

---

## Dual Foundation

Three components form the infrastructure substrate beneath all domains:

| Component | File | Lines | Responsibility |
|-----------|------|-------|---------------|
| **SignalStore** | `src/core/field/signal-store.js` | 382 | 12-dimensional signal field: `emit()` writes Forward-Decay encoded signals, `query()` reads with live strength calculation, `superpose()` computes field vectors, `gc()` reclaims expired signals |
| **DomainStore** | `src/core/store/domain-store.js` | 287 | In-memory Map-based key-value store with JSON snapshot persistence. Atomic writes (`.tmp` then `rename`). Auto-snapshot timer with configurable interval (default 30 s) |
| **EventBus** | `src/core/bus/event-bus.js` | 175 | Topic-based publish/subscribe with wildcard support (`topic.*`). Safe handler invocation (errors on one handler do not block others). Max 100 listeners per topic with overflow warning |

### Supporting Core Modules

| Module | File | Lines | Purpose |
|--------|------|-------|---------|
| ModuleBase | `src/core/module-base.js` | 59 | Abstract base class; defines `produces()`/`consumes()`/`publishes()`/`subscribes()`/`start()`/`stop()` |
| Forward-Decay | `src/core/field/forward-decay.js` | 108 | `encode(strength, lambda, emitTime)` and `actualStrength()` functions for time-decay math |
| FieldVector | `src/core/field/field-vector.js` | 178 | `superpose(signals, dimensions, now)` -- aggregates signals into a 12-dimensional vector |
| GCScheduler | `src/core/field/gc-scheduler.js` | 156 | Periodic and emergency garbage collection for expired signals |
| MemoryBackend | `src/core/field/backends/memory.js` | 215 | Default in-memory signal storage with dimension and scope indexes |
| types.js | `src/core/field/types.js` | 134 | 12 dimension constants, `DEFAULT_LAMBDA` decay rates, `ALL_DIMENSIONS` frozen array |
| EventCatalog | `src/core/bus/event-catalog.js` | 89 | 27 event topic constants organized by domain, with payload type documentation |
| SnapshotManager | `src/core/store/snapshot-manager.js` | 141 | Snapshot lifecycle helpers for DomainStore |
| store/types.js | `src/core/store/types.js` | 31 | Store type definitions |

**Core total: 12 files, 1,953 lines.**

---

## Seven Domains

All 121 JavaScript source files are organized into 7 domains plus 3 top-level entry files. Each domain contains sub-domains that group related modules.

### Domain Summary

| # | Domain | Sub-domains | Files | Lines | Primary Responsibility |
|---|--------|------------|-------|-------|----------------------|
| 1 | **core** | field (6), bus (2), store (3), module-base (1) | 12 | 1,953 | Signal field, event bus, persistence, module contract |
| 2 | **communication** | channel (2), pheromone (3), stigmergy (2), index (1) | 8 | 1,281 | Task channels, pheromone ACO engine, stigmergic board, gossip protocol |
| 3 | **intelligence** | memory (8), identity (8), social (9), understanding (4), artifacts (4), index (1) | 34 | 5,606 | Working/episodic/semantic memory, agent identity, reputation, trust, intent classification, artifact management |
| 4 | **orchestration** | planning (6), scheduling (6), adaptation (11), index (1) | 24 | 6,889 | DAG engine, execution planner, contract-net, spawn advisor, species evolution, budget tracking, signal calibration |
| 5 | **quality** | resilience (4), analysis (3), gate (2), index (1) | 10 | 2,738 | Circuit breaker, tool resilience, failure analysis, anomaly detection, evidence gate, compliance monitor |
| 6 | **observe** | dashboard (1), broadcast (1), health (2), metrics (1), index (1) + console (7 build assets) | 13 | 1,651 | Dashboard service, SSE state broadcaster, health checker, trace collector, metrics collector |
| 7 | **bridge** | hooks (1), tools (10), session (3), reliability (5), interaction (4), connectors (1) | 24 | 4,526 | OpenClaw API adaptation, 10 tools, session bridge, readiness guard, compliance hook, progress tracking |
| -- | **Top-level** | index.js, index-v9.js, swarm-core-v9.js | 3 | 852 | Plugin entry, V9 adapter, lifecycle orchestrator |
| | **Total** | | **121** | **25,447** | |

### Sub-domain Detail

| Domain | Sub-domain | Files | Lines | Key Modules |
|--------|-----------|-------|-------|------------|
| core | field | 6 | 957 | SignalStore, ForwardDecay, FieldVector, GCScheduler, MemoryBackend, types |
| core | bus | 2 | 263 | EventBus, EventCatalog |
| core | store | 3 | 459 | DomainStore, SnapshotManager, types |
| core | (root) | 1 | 59 | ModuleBase |
| communication | channel | 2 | 350 | ChannelManager, TaskChannel |
| communication | pheromone | 3 | 537 | PheromoneEngine, ResponseMatrix, TypeRegistry |
| communication | stigmergy | 2 | 260 | GossipProtocol, StigmergicBoard |
| intelligence | memory | 8 | 1,628 | WorkingMemory, EpisodicMemory, SemanticMemory, HybridRetrieval, VectorIndex, EmbeddingEngine, ContextEngine, UserProfile |
| intelligence | identity | 8 | 1,819 | CapabilityEngine, ModelCapability, PromptBuilder, RoleRegistry, SoulDesigner, SensitivityFilter, CrossProvider, LifecycleManager |
| intelligence | social | 9 | 939 | ReputationCRDT, TrustDynamics, SNAAnalyzer, EmotionalState, EILayer, CulturalFriction, SelfReflection, EpisodeLearner, index |
| intelligence | understanding | 4 | 396 | IntentClassifier, RequirementClarifier, ScopeEstimator, index |
| intelligence | artifacts | 4 | 565 | ArtifactRegistry, ExecutionJournal, WorkspaceOrganizer, index |
| orchestration | planning | 6 | 2,333 | DAGEngine, ExecutionPlanner, ReplanEngine, ResultSynthesizer, CriticalPath, ZoneManager |
| orchestration | scheduling | 6 | 1,644 | SpawnAdvisor, ContractNet, HierarchicalCoord, RoleManager, ResourceArbiter, DeadlineTracker |
| orchestration | adaptation | 11 | 2,762 | DualProcessRouter, GlobalModulator, SkillGovernor, ShapleyCredit, BudgetTracker, BudgetForecaster, SignalCalibrator, SpeciesEvolver, ResponseThreshold, RoleDiscovery, index |
| quality | resilience | 4 | 1,149 | ToolResilience, CircuitBreaker, FailureVaccination, PipelineBreaker |
| quality | analysis | 3 | 720 | FailureAnalyzer, AnomalyDetector, ComplianceMonitor |
| quality | gate | 2 | 645 | EvidenceGate, QualityController |
| observe | dashboard | 1 | 662 | DashboardService (Fastify, REST endpoints, static console serving) |
| observe | broadcast | 1 | 192 | StateBroadcaster (SSE) |
| observe | health | 2 | 412 | HealthChecker, TraceCollector |
| observe | metrics | 1 | 249 | MetricsCollector |
| bridge | hooks | 1 | 433 | HookAdapter (registers all 16 hooks) |
| bridge | tools | 10 | 2,450 | 10 tool factories (run, query, dispatch, checkpoint, spawn, pheromone, gate, memory, plan, zone) |
| bridge | session | 3 | 401 | SessionBridge, ModelFallback, SpawnClient |
| bridge | reliability | 5 | 378 | ReadinessGuard, ToolGuard, InjectRetry, IPCFallback, ComplianceHook |
| bridge | interaction | 4 | 744 | ProgressTracker, TaskPresenter, UserNotifier, SubagentFailureMessage |
| bridge | connectors | 1 | 120 | MCPRegistry |

---

## 12-Dimensional Signal Field

The signal field is a continuous-valued, scope-aware substrate. Every signal carries a dimension label, a strength value clamped to `[0.0, 1.0]`, and a decay rate (lambda). Strength decays exponentially over time via Forward-Decay encoding.

### Dimension Table

| # | Dimension | Constant | Lambda (decay/s) | Half-life | Primary Producers | Primary Consumers |
|---|-----------|----------|-----------------|-----------|-------------------|-------------------|
| 1 | Trail | `DIM_TRAIL` | 0.008 | ~87 s | Task-completing agents | SpawnAdvisor, PromptBuilder, ProgressTracker |
| 2 | Alarm | `DIM_ALARM` | 0.15 | ~4.6 s | AnomalyDetector, FailureAnalyzer | SpawnAdvisor, ReplanEngine, EmotionalState |
| 3 | Reputation | `DIM_REPUTATION` | 0.005 | ~139 s | ReputationCRDT, QualityController, ShapleyCredit | SpawnAdvisor, ContractNet, ResultSynthesizer |
| 4 | Task | `DIM_TASK` | 0.01 | ~69 s | User requests, DAGEngine | SpawnAdvisor, ExecutionPlanner, IntentClassifier |
| 5 | Knowledge | `DIM_KNOWLEDGE` | 0.003 | ~231 s | Researcher agents, SemanticMemory | PromptBuilder, HybridRetrieval, ScopeEstimator |
| 6 | Coordination | `DIM_COORDINATION` | 0.02 | ~35 s | HierarchicalCoord, TaskChannel | SpawnAdvisor, ResourceArbiter, DeadlineTracker |
| 7 | Emotion | `DIM_EMOTION` | 0.1 | ~6.9 s | EmotionalState | SpawnAdvisor, PromptBuilder, EILayer |
| 8 | Trust | `DIM_TRUST` | 0.006 | ~116 s | TrustDynamics | ResultSynthesizer, SpawnAdvisor, ContractNet |
| 9 | SNA | `DIM_SNA` | 0.004 | ~173 s | SNAAnalyzer | ExecutionPlanner, SpawnAdvisor, HierarchicalCoord |
| 10 | Learning | `DIM_LEARNING` | 0.002 | ~347 s | EpisodeLearner | SpawnAdvisor, BudgetTracker, ScopeEstimator |
| 11 | Calibration | `DIM_CALIBRATION` | 0.01 | ~69 s | SignalCalibrator | FieldVector (weight adjustment), all consumers indirectly |
| 12 | Species | `DIM_SPECIES` | 0.001 | ~693 s | SpeciesEvolver | RoleRegistry, SpawnAdvisor |

**Source:** `src/core/field/types.js:49-73`

### Signal Lifecycle

```
1. Module calls field.emit({ dimension, scope, strength, emitterId, lambda?, metadata? })
2. SignalStore validates dimension (must be in ALL_DIMENSIONS) and clamps strength to [0.0, 1.0]
3. Forward-Decay encodes: encodedScore = encode(strength, lambda, emitTime)
4. Signal written to MemoryBackend (dimension-indexed + scope-indexed)
5. If signal count > maxSignals (100,000) -> emergency GC triggered
6. EventBus publishes 'field.signal.emitted' with signal metadata
7. Any module calls field.superpose(scope) to read the 12-dim vector at that scope
8. actualStrength = strength * exp(-lambda * (now - emitTime)) computed on read
```

**Source:** `src/core/field/signal-store.js:139-220`

---

## Four Coupling Mechanisms

V9 modules interact exclusively through four mechanisms. Direct cross-domain function calls are prohibited.

| # | Mechanism | Medium | Characteristics | Use Case |
|---|-----------|--------|----------------|----------|
| 1 | **Field-mediated** | SignalStore | Continuous-valued, time-decaying, scope-aware, many-to-many | Behavioral signals: emotion, trust, reputation, learning curves |
| 2 | **Event bus** | EventBus | Discrete, one-shot, topic-based pub/sub with wildcards | Lifecycle notifications: agent.spawned, task.completed, gate.passed |
| 3 | **Store-mediated** | DomainStore | Persistent key-value, async read/write, snapshot-backed | Stateful data: role configs, capability profiles, discovered roles |
| 4 | **Dependency injection** | Constructor args | Startup-time wiring via `swarm-core-v9.js` | Intra-domain module references only |

### Field-Mediated Coupling in Practice

```
Traditional:  A -> B -> C -> D    (linear; adding G requires modifying the chain)

Field-based:  A --emit--> [Field] <--sense-- D
              B --emit-->         <--sense-- E
              C --emit-->         <--sense-- F

Adding module G:  G --emit--> [Field]    (zero changes; existing consumers auto-benefit)
Adding consumer H:        [Field] <--sense-- H  (zero changes; existing producers auto-sensed)
```

**Rule:** Cross-domain interaction must use mechanisms 1-3. Mechanism 4 is restricted to intra-domain module references.

---

## ModuleBase Contract

Every V9 module extends `ModuleBase` (`src/core/module-base.js:15-57`) and must implement four static declaration methods:

| Method | Returns | Purpose |
|--------|---------|---------|
| `static produces()` | `string[]` | Signal dimensions this module emits into the field |
| `static consumes()` | `string[]` | Signal dimensions this module reads from the field |
| `static publishes()` | `string[]` | EventBus topics this module publishes |
| `static subscribes()` | `string[]` | EventBus topics this module subscribes to |

Additionally, two lifecycle methods:

| Method | When Called |
|--------|-----------|
| `async start()` | Domain startup; initialize resources, register subscriptions |
| `async stop()` | Domain shutdown; release resources, unsubscribe |

### Example: SignalStore Declaration

```javascript
// src/core/field/signal-store.js:50-79
class SignalStore extends ModuleBase {
  static produces() { return [...ALL_DIMENSIONS] }  // produces all 12 dimensions
  static consumes() { return [] }                    // it IS the field
  static publishes() { return [FIELD_SIGNAL_EMITTED, FIELD_GC_COMPLETED, FIELD_EMERGENCY_GC] }
  static subscribes() { return [] }
}
```

### Coupling Verification

At startup, `SwarmCoreV9._verifyCoupling()` (`src/swarm-core-v9.js:207-281`) collects all modules across all domains, inspects their static declarations, and validates:

1. **Every produced dimension has at least one consumer.** Violation = idle dimension (warning).
2. **Every consumed dimension has at least one producer.** Violation = broken coupling (hard error, startup fails).

The same check applies to `publishes()`/`subscribes()` for EventBus topics.

```
Startup flow:
  _collectAllModules()           -- traverse all 5 domain .allModules()
  -> for each module: read produces(), consumes(), publishes(), subscribes()
  -> build producer/consumer maps per dimension
  -> build publisher/subscriber maps per event topic
  -> if any consumed dimension has no producer -> throw Error (startup blocked)
  -> if any produced dimension has no consumer -> emit warning (startup continues)
  -> publish 'swarm.coupling.verified' event
```

**Source:** `src/swarm-core-v9.js:207-281`

---

## Process Model

V9 uses a **single-process** model. The previous V8 fork-based two-tier process model (gateway process + child process with IPC bridge) has been eliminated.

```
  OpenClaw Gateway (Node.js, single process)
  ┌────────────────────────────────────────────────────────────────┐
  │  index.js (205 lines) — Plugin entry, V8 API adapter           │
  │    └─> index-v9.js (172 lines) — activate()/deactivate()      │
  │          └─> swarm-core-v9.js (475 lines) — SwarmCoreV9        │
  │                                                                │
  │  ┌─ Dual Foundation ─────────────────────────────────────────┐ │
  │  │  SignalStore (382 lines)  — 12-dim signal field           │ │
  │  │  DomainStore (287 lines)  — key-value persistence         │ │
  │  │  EventBus    (175 lines)  — pub/sub with wildcards        │ │
  │  └──────────────────────────────────────────────────────────-┘ │
  │                                                                │
  │  ┌─ 5 Domain Subsystems ─────────────────────────────────────┐ │
  │  │  communication  — channels, pheromones, stigmergy         │ │
  │  │  intelligence   — memory, identity, social, understanding │ │
  │  │  orchestration  — planning, scheduling, adaptation        │ │
  │  │  quality        — resilience, analysis, gates             │ │
  │  │  observe        — dashboard :19100, metrics, health       │ │
  │  └──────────────────────────────────────────────────────────-┘ │
  │                                                                │
  │  ┌─ Bridge Layer ────────────────────────────────────────────┐ │
  │  │  HookAdapter (16 hooks) — OpenClaw hook wiring            │ │
  │  │  10 Tool factories      — swarm_run, swarm_query, ...     │ │
  │  │  SessionBridge, SpawnClient, ReadinessGuard               │ │
  │  └──────────────────────────────────────────────────────────-┘ │
  │                                                                │
  │  DashboardService :19100 (in-process Fastify)                  │
  └────────────────────────────────────────────────────────────────┘
```

### V8 vs V9 Process Model Comparison

| Aspect | V8 | V9 |
|--------|----|----|
| Process count | 2 (gateway + forked child) | 1 (gateway only) |
| IPC | `child_process.fork()` with 5 s timeout, 10,000 pending cap | None (in-process calls) |
| Hook tiers | Tier A (gateway, <0.1 ms) + Tier B (IPC proxy, 2-5 ms) | Single tier (all in-process) |
| Dashboard | Child process, port 19100 | In-process Fastify, port 19100 |
| Engine isolation | Separate V8 heap | Shared heap, domain-scoped modules |

### Gateway Integration

`index.js` (`src/index.js:74-205`) provides the `register(api)` function that:
1. Creates a V8-to-V9 API adapter (`createAppAdapter`)
2. Registers `gateway_start` hook (priority 10) to call `activateV9(app)`
3. Registers `gateway_stop` hook to call `deactivateV9(app)`
4. Optionally registers Gateway HTTP proxy routes (`/swarm/api/v1/*`, `/swarm/api/v9/*`, `/swarm/v6/*`) pointing to the in-process Dashboard on port 19100
5. Optionally registers the `/swarm` command for direct task invocation

---

## Hook System (16 Hooks)

The `HookAdapter` (`src/bridge/hooks/hook-adapter.js:32-433`) registers 16 hooks with the OpenClaw API. Every handler is wrapped in `safe()` (try/catch) so a single domain failure never tears down the hook pipeline.

### Hook Registration Table

| # | Hook Name | Method | Primary Action | Domains Involved |
|---|-----------|--------|---------------|-----------------|
| 1 | `session_start` | `onSessionStart` | Initialize session scope in SessionBridge | bridge/session |
| 2 | `session_end` | `onSessionEnd` | Clean up session state | bridge/session |
| 3 | `message_created` | `onMessageCreated` | Classify intent, estimate scope | intelligence |
| 4 | `before_agent_start` | `onBeforeAgentStart` | SpawnAdvisor decision, immunity check, compliance escalation, prompt building, tool permissions, model override | orchestration, quality, intelligence |
| 5 | `agent_start` | `onAgentStart` | Begin trace span, track agent in session | observe, bridge/session |
| 6 | `agent_end` | `onAgentEnd` | End trace span, quality audit, credit assignment, failure classification | observe, quality, bridge |
| 7 | `llm_output` | `onLlmOutput` | Compliance monitor against generated content | quality |
| 8 | `before_tool_call` | `onBeforeToolCall` | Circuit breaker check, tool resilience validation (schema + auto-repair) | quality |
| 9 | `after_tool_call` | `onAfterToolCall` | Record success/failure for circuit breaker | quality |
| 10 | `prependSystemContext` | `onPrependSystemContext` | Inject field vector as `<swarm-context>` XML tag | core/field, bridge/session |
| 11 | `before_shutdown` | `onBeforeShutdown` | Snapshot all domain stores | core/store |
| 12 | `error` | `onError` | Route to ModelFallback for retry/fallback decisions | bridge/session |
| 13 | `tool_result` | `onToolResult` | Feed to anomaly detector for event tracking | quality |
| 14 | `agent_message` | `onAgentMessage` | Post to communication channel, append to working memory | communication, intelligence |
| 15 | `activate` | `onActivate` | Start all domains in dependency order | all domains |
| 16 | `deactivate` | `onDeactivate` | Stop all domains in reverse order | all domains |

### Most Complex Hook: `before_agent_start`

`onBeforeAgentStart` (`src/bridge/hooks/hook-adapter.js:163-217`) executes 7 steps:

| Step | Operation | Source |
|------|-----------|--------|
| 1 | SpawnAdvisor decision (role, model, tool permissions) | orchestration |
| 2 | Immunity check from failure vaccination | quality |
| 3 | Compliance escalation prompt | quality |
| 4 | Build dynamic prompt with all context | intelligence |
| 5 | Inject prompt into agent | bridge |
| 6 | Tool permission filtering from advisor | orchestration |
| 7 | Model override from advisor | orchestration |

---

## Tool Architecture (10 Tools)

All tools are registered via factory functions imported in `index-v9.js:90-101`. Each factory receives `{ core, quality, sessionBridge, spawnClient }` and returns a tool object conforming to the OpenClaw Plugin Tool API.

### Tool Table

| # | Tool Name | File | Lines | Description |
|---|-----------|------|-------|-------------|
| 1 | `swarm_run` | `src/bridge/tools/run-tool.js` | 248 | Main task execution with DualProcessRouter, SpawnAdvisor, and ImmunitySystem integration |
| 2 | `swarm_query` | `src/bridge/tools/query-tool.js` | 320 | Unified query interface with 10 sub-commands via `scope` parameter |
| 3 | `swarm_dispatch` | `src/bridge/tools/dispatch-tool.js` | 148 | Forward messages to running agents via communication bus/channel |
| 4 | `swarm_checkpoint` | `src/bridge/tools/checkpoint-tool.js` | 232 | Create, resolve, and list human-in-the-loop checkpoints |
| 5 | `swarm_spawn` | `src/bridge/tools/spawn-tool.js` | 186 | Direct agent spawn bypassing SpawnAdvisor for explicit control |
| 6 | `swarm_pheromone` | `src/bridge/tools/pheromone-tool.js` | 242 | Stigmergic communication: deposit, read, types, stats |
| 7 | `swarm_gate` | `src/bridge/tools/gate-tool.js` | 261 | Evidence-based gating with evaluate, appeal, and history actions |
| 8 | `swarm_memory` | `src/bridge/tools/memory-tool.js` | 238 | Semantic memory operations: search, record, forget, stats, export |
| 9 | `swarm_plan` | `src/bridge/tools/plan-tool.js` | 320 | DAG plan management: view, modify, validate, cancel |
| 10 | `swarm_zone` | `src/bridge/tools/zone-tool.js` | 255 | File/resource zone management: detect, lock, unlock, list |

### Tool API Contract

All tools follow the OpenClaw Plugin Tool API:

```javascript
{
  name: 'swarm_xxx',
  description: '...',
  parameters: { type: 'object', properties: { ... }, required: [...] },
  execute(toolCallId, params) {
    // ... domain logic ...
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
}
```

**Constraints:** All nested `type: 'object'` schemas must have `properties` or `additionalProperties`. The field name is `parameters` (not `inputSchema`). The method is `execute(toolCallId, params)` (not `handler(input)`).

---

## Engine Initialization

### Startup Sequence

`SwarmCoreV9.start()` (`src/swarm-core-v9.js:332-389`) executes the following ordered steps:

| Step | Operation | Source |
|------|-----------|--------|
| 1 | `initialize()` -- dynamic-import all 5 domain factory modules in parallel | `swarm-core-v9.js:90-193` |
| 2 | Create domains in dependency order: communication, intelligence, orchestration (depends on intelligence), quality (depends on intelligence.reputationCRDT), observe (depends on all) | `swarm-core-v9.js:104-186` |
| 3 | `store.restore()` -- restore persisted state from JSON snapshot | `swarm-core-v9.js:337` |
| 4 | `field.start()` -- start GC scheduler | `swarm-core-v9.js:341` |
| 5 | `_verifyCoupling()` -- validate produces/consumes completeness | `swarm-core-v9.js:348` |
| 6 | Start domains in order: communication -> intelligence -> orchestration -> quality -> observe | `swarm-core-v9.js:356-372` |
| 7 | Set `_ready = true`, publish `swarm.core.started` event | `swarm-core-v9.js:374-381` |

### Domain Dependency Graph

```
communication ──────┐
                     │
intelligence ───────┤──> orchestration ──> quality ──> observe
   (provides:       │      (receives:       (receives:   (receives:
    capabilityEngine │       capabilityEngine  reputation   all 4 domain
    hybridRetrieval  │       hybridRetrieval   CRDT)        references)
    roleRegistry     │       roleRegistry
    modelCapability  │       modelCapability
    artifactRegistry)│       artifactRegistry)
                     │
                     └─────────────────────────────────────────────┘
```

### Full Plugin Activation Flow

The complete activation path from OpenClaw gateway to running system:

| Phase | File | Function | Action |
|-------|------|----------|--------|
| 1 | `src/index.js:74` | `register(api)` | Create V8-to-V9 adapter, register `gateway_start` hook |
| 2 | `src/index.js:111` | `gateway_start` handler | Call `startup()` which calls `activateV9(app)` |
| 3 | `src/index-v9.js:60` | `activate(app)` | Create SwarmCoreV9, bridge modules, HookAdapter |
| 4 | `src/index-v9.js:87` | `hookAdapter.registerHooks(app)` | Register all 16 hooks |
| 5 | `src/index-v9.js:90-101` | Tool factory imports | Dynamic-import 10 tool factory modules |
| 6 | `src/index-v9.js:107-118` | Tool registration | Create and register all tools with app |
| 7 | `src/index-v9.js:122` | `core.start()` | Full startup sequence (see above) |
| 8 | `src/index-v9.js:127-128` | Post-start patching | Patch quality/observe refs into HookAdapter |
| 9 | `src/index-v9.js:130` | `readinessGuard.setReady(true)` | System accepts traffic |

### Shutdown Sequence

`SwarmCoreV9.stop()` (`src/swarm-core-v9.js:394-426`) runs in reverse:

1. Publish `swarm.core.stopping` event
2. Stop domains in reverse order: observe -> quality -> orchestration -> intelligence -> communication
3. Stop signal field (GC scheduler cleanup)
4. Snapshot persisted state to disk
5. Publish `swarm.core.stopped` event

---

## Zero Feature Flags / Zero Idle

### Zero Feature Flags

V8 maintained a feature flag dependency tree gating 8+ subsystems (`hierarchical`, `dagEngine`, `speculativeExecution`, `evolution.scoring`, etc.). V9 eliminates all feature flags. Evidence:

| Verification | Method | Result |
|-------------|--------|--------|
| `index.js` entry point | Unconditional call to `activateV9(app)` at `src/index.js:86` | No conditional branches |
| `swarm-core-v9.js` | All 5 domains imported via `Promise.all` at `src/swarm-core-v9.js:94-100` | No feature flag checks |
| `index-v9.js` | All 10 tools imported unconditionally at `src/index-v9.js:90-101` | No gating logic |
| Configuration | `config.field`, `config.communication`, etc. are structural config, not feature toggles | Configuration governs parameters, not activation |

```bash
# Verify: no feature flag references in V9 source
grep -r "featureFlag\|feature_flag\|isEnabled\|isDisabled" src/ --include="*.js"
# Expected: 0 matches
```

### Zero Idle Modules

The `_verifyCoupling()` method (`src/swarm-core-v9.js:207-281`) enforces at startup that:

1. Every signal dimension with a producer has at least one consumer (no idle outputs).
2. Every signal dimension with a consumer has at least one producer (no broken inputs).

| Check | Failure Mode | Consequence |
|-------|-------------|-------------|
| Producer with no consumer | Idle dimension (module writes but nobody reads) | Warning logged, startup continues |
| Consumer with no producer | Broken coupling (module reads but nothing writes) | Hard error, startup blocked |

The coupling result is published as `swarm.coupling.verified` on the EventBus and stored in `_couplingResult` for diagnostic access.

```bash
# Verify coupling at runtime via Dashboard API
curl http://127.0.0.1:19100/api/v9/stats
# Response includes: { coupling: { dimensions: 12, consumers: N, modules: M, warnings: [] } }
```

---

## Key Constants

| Constant | Value | Location |
|----------|-------|----------|
| Version | `9.0.0` | `src/swarm-core-v9.js:41` |
| Domain count (non-core) | 5 | `src/swarm-core-v9.js:39` |
| Signal dimensions | 12 | `src/core/field/types.js:49-53` |
| Signal strength range | [0.0, 1.0] | `src/core/field/types.js:76-78` |
| Signal expiry threshold | 0.001 | `src/core/field/types.js:80` |
| Max signals (before emergency GC) | 100,000 | `src/core/field/signal-store.js:93` |
| GC interval (default) | 60,000 ms | `src/core/field/signal-store.js:92` |
| DomainStore snapshot interval | 30,000 ms | `src/core/store/domain-store.js:17` |
| EventBus max listeners per topic | 100 | `src/core/bus/event-bus.js:18` |
| EventCatalog topics | 27 | `src/core/bus/event-catalog.js` |
| Registered hooks | 16 | `src/bridge/hooks/hook-adapter.js:12` |
| Registered tools | 10 | `src/index-v9.js:90-101` |
| Dashboard port | 19,100 | `src/index.js:18` |
| Gateway port | 18,789 | OpenClaw config |
| Feature flags | 0 | By design |
| Total source files | 121 | `src/**/*.js` (excluding console build assets) |
| Total source lines | 25,447 | All 121 files |

### Per-Dimension Decay Constants

| Dimension | Lambda | Half-life (s) | Semantic Speed |
|-----------|--------|--------------|---------------|
| species | 0.001 | ~693 | Slowest (evolutionary) |
| learning | 0.002 | ~347 | Very slow (skill acquisition) |
| knowledge | 0.003 | ~231 | Slow (accumulated wisdom) |
| sna | 0.004 | ~173 | Slow (network topology) |
| reputation | 0.005 | ~139 | Moderate-slow (trust building) |
| trust | 0.006 | ~116 | Moderate (relationship dynamics) |
| trail | 0.008 | ~87 | Moderate (path recency) |
| task | 0.01 | ~69 | Moderate-fast (task relevance) |
| calibration | 0.01 | ~69 | Moderate-fast (tuning freshness) |
| coordination | 0.02 | ~35 | Fast (synchronization urgency) |
| emotion | 0.1 | ~6.9 | Very fast (emotional volatility) |
| alarm | 0.15 | ~4.6 | Fastest (emergency response) |

**Source:** `src/core/field/types.js:60-73`

---

[<- Back to README](../../README.md) | [中文版](../zh-CN/architecture.md)
