# Module Guide (L1-L6)

Claw-Swarm V7.0 contains 173 JavaScript source files organized into 6 layers. This guide lists every module with its purpose, key interfaces, and the problem it solves. Layer dependencies flow downward only: L6 may depend on L5, but L2 never depends on L3.

## L1: Infrastructure (25 files)

Foundation layer providing data persistence, configuration, logging, inter-process communication, and computation parallelization.

### Database

| Module | Purpose |
|--------|---------|
| `database/database-manager.js` | SQLite3 connection management with WAL mode, transaction support, and prepared statement caching |
| `database/migration-runner.js` | Progressive schema migration from v4.x to V7.0 (SCHEMA_VERSION=9) with rollback protection |
| `database/sqlite-binding.js` | Node:sqlite compatibility wrapper for Vite/Vitest ESM environments |

### Repositories (9)

| Module | Purpose |
|--------|---------|
| `database/repositories/agent-repo.js` | Agent data access: capabilities, skills, votes, contributions |
| `database/repositories/task-repo.js` | Task and role data: swarm_tasks, swarm_roles, swarm_checkpoints, swarm_artifacts |
| `database/repositories/pheromone-repo.js` | Pheromone CRUD operations and persistence |
| `database/repositories/episodic-repo.js` | Episodic memory with Ebbinghaus forgetting curve integration |
| `database/repositories/knowledge-repo.js` | Knowledge graph nodes + edges with BFS traversal and merge |
| `database/repositories/plan-repo.js` | Execution plan persistence |
| `database/repositories/pheromone-type-repo.js` | Custom pheromone type registration and configuration |
| `database/repositories/user-checkpoint-repo.js` | Human-in-the-loop checkpoint management (V7.1) |
| `database/repositories/zone-repo.js` | Zone governance: zones and zone_memberships |

### Schemas (3)

| Module | Purpose |
|--------|---------|
| `schemas/database-schemas.js` | 52 table DDL definitions, PRAGMA settings, schema bootstrap |
| `schemas/config-schemas.js` | Zod validation schemas for the full configuration tree |
| `schemas/message-schemas.js` | MessageBus message type validation with standard headers |

### Core Services (5)

| Module | Purpose |
|--------|---------|
| `ipc-bridge.js` | RPC-over-IPC bidirectional communication (request/response/notify protocol, 5 s timeout, 10k pending cap) |
| `logger.js` | Pino-based structured logging factory |
| `monotonic-clock.js` | `process.hrtime.bigint()` monotonic time, immune to NTP jumps |
| `worker-pool.js` | Worker thread pool (default 4 threads) with SharedArrayBuffer and crash recovery |
| `types.js` | Core enumerations and JSDoc type definitions |

### Workers (4)

| Module | Purpose |
|--------|---------|
| `workers/aco-worker.js` | ACO pheromone field computation (acoSelect, decayPass) |
| `workers/compute-worker.js` | k-means clustering, critical path, GEP tournament, mutual information |
| `workers/shapley-worker.js` | Monte Carlo Shapley value computation |
| `workers/vector-worker.js` | Vector embedding and similarity computations |

---

## L2: Communication (13 files)

Inter-agent messaging, stigmergic coordination, and external relay connections.

| Module | Purpose |
|--------|---------|
| `message-bus.js` | Topic-based pub/sub with wildcard support (`topic.*`), dead letter queue, pluggable transports |
| `pheromone-engine.js` | MMAS pheromone management with 7 types, ACO path selection, lazy decay |
| `pheromone-response-matrix.js` | Auto-escalating pressure gradients for pending task handling |
| `pheromone-type-registry.js` | Dynamic pheromone type registration with MMAS boundary config |
| `gossip-protocol.js` | SWIM failure detection + memory/pheromone snapshot sharing (fanout=3, heartbeat=5 s) |
| `stigmergic-board.js` | Persistent global bulletin board for agent announcements with TTL |
| `swarm-relay-client.js` | DirectSpawnClient: real subagent creation via Gateway WebSocket RPC |
| `protocol-semantics.js` | 9-type structured semantic messaging layer |
| `state-convergence.js` | SWIM failure detection + anti-entropy sync for eventual consistency |
| `transports/event-emitter-transport.js` | In-process transport using eventemitter3 (default) |
| `transports/broadcast-channel-transport.js` | Node.js 22+ BroadcastChannel for main-thread to worker communication |
| `transports/nats-transport.js` | Interface stub for NATS distributed messaging |

**Key interface:** `messageBus.publish(topic, payload)` / `messageBus.subscribe(topic, handler)`.

---

## L3: Agent (21 files)

Individual agent intelligence: capabilities, memory, reputation, behavioral adaptation, and anomaly detection.

### Assessment & Evolution

| Module | Purpose |
|--------|---------|
| `agent-lifecycle.js` | 8-state finite state machine for agent lifecycle |
| `capability-engine.js` | 8D capability assessment (coding/architecture/testing/docs/security/performance/communication/domain) |
| `reputation-ledger.js` | 5D reputation scoring (competence, reliability, collaboration, innovation, trust) |
| `persona-evolution.js` | GEP-guided persona evolution: detect/mutate/A-B test/promote |
| `soul-designer.js` | SOUL snippet generation for LLM system prompt injection |
| `skill-symbiosis.js` | Skill complementarity tracking and symbiotic pair discovery |
| `sna-analyzer.js` | Social network analysis: degree centrality, betweenness, clustering coefficient |
| `response-threshold.js` | Fixed response threshold model with PI controller for activity rate |

### Anomaly & Resilience

| Module | Purpose |
|--------|---------|
| `anomaly-detector.js` | Per-agent behavior baseline with negative selection |
| `failure-mode-analyzer.js` | Root cause classification: INPUT_ERROR, TIMEOUT, LLM_REFUSAL, etc. |
| `failure-vaccination.js` | Failure pattern memory and repair strategy (vaccine) injection |
| `negative-selection.js` | Immune-inspired anomaly detection with 5 built-in pattern categories |
| `evidence-gate.js` | Three-tier evidence discipline (PRIMARY/CORROBORATION/INFERENCE) |

### Memory

| Module | Purpose |
|--------|---------|
| `memory/working-memory.js` | 3-layer attention: Focus (5) / Context (15) / Scratch (30) |
| `memory/episodic-memory.js` | Ebbinghaus forgetting curve with multi-dimensional retrieval |
| `memory/semantic-memory.js` | Knowledge graph with BFS traversal and concept merging |
| `memory/context-compressor.js` | Importance * confidence * recency ranking for LLM context |

### Retrieval & Embedding

| Module | Purpose |
|--------|---------|
| `embedding-engine.js` | Dual-mode text embedding: local Xenova (384D) or API (1536D) |
| `vector-index.js` | HNSW approximate nearest neighbor via usearch with linear fallback |
| `hybrid-retrieval.js` | 6D memory retrieval (semantic/temporal/importance/relevance/reward/recency) |
| `swarm-context-engine.js` | Swarm state injection into OpenClaw ContextEngine |

---

## L4: Orchestration (25 files)

Task coordination, scheduling, quality control, resource management, and collective decision-making.

### Core Orchestration

| Module | Purpose |
|--------|---------|
| `orchestrator.js` | DAG decomposition and topological execution |
| `task-dag-engine.js` | DAG construction, topological sort, state machine, dependency resolution |
| `execution-planner.js` | MoE Top-k planning with expert scoring and regex fallback |
| `hierarchical-coordinator.js` | Parent-child hierarchy with depth limit and concurrency control |
| `replan-engine.js` | ALARM pheromone-triggered replanning with exponential backoff |
| `pipeline-breaker.js` | 9-state FSM with DLQ, cascade abort, retry backoff |

### Scheduling & Allocation

| Module | Purpose |
|--------|---------|
| `contract-net.js` | FIPA Contract Net Protocol: CFP/Bid/Award negotiation cycle |
| `abc-scheduler.js` | Artificial Bee Colony: employed/onlooker/scout three-role scheduling |
| `dual-process-router.js` | System 1/2 decision routing (DIRECT vs PREPLAN) |
| `speculative-executor.js` | Parallel candidate execution for critical-path tasks |
| `critical-path.js` | CPM analysis (forward/backward pass for ES/EF/LS/LF) |

### Quality & Governance

| Module | Purpose |
|--------|---------|
| `quality-controller.js` | 3-tier quality gate (self/peer/lead review) with multi-criteria scoring |
| `budget-tracker.js` | 5D budget tracking: token/time/agent/storage/reputation |
| `budget-forecaster.js` | Linear regression-based budget depletion forecasting |
| `governance-metrics.js` | Audit/policy/ROI triple metrics for decision traceability |
| `conflict-resolver.js` | 3-level conflict resolution: P2P/weighted voting/consensus |

### Agent Management

| Module | Purpose |
|--------|---------|
| `zone-manager.js` | Zone governance with Jaccard auto-assignment and leader election |
| `role-manager.js` | Role template CRUD with 8D capability matching |
| `role-discovery.js` | Data-driven role discovery via k-means++ clustering |
| `species-evolver.js` | Open-ended population evolution with specialization |

### Signal Processing

| Module | Purpose |
|--------|---------|
| `global-modulator.js` | Four modes: EXPLORE/EXPLOIT/RELIABLE/URGENT |
| `shapley-credit.js` | Monte Carlo Shapley credit attribution post-DAG |
| `signal-calibrator.js` | MI-based auto-calibration of SwarmAdvisor weights |
| `swarm-advisor.js` | Multi-signal aggregation from 5 engines |
| `result-synthesizer.js` | Jaccard-based result dedup with quality aggregation |

---

## L5: Application (18 files)

User-facing tools, resilience patterns, and OpenClaw API integration. This is the **only layer coupled to OpenClaw**.

### Core Services (8)

| Module | Purpose |
|--------|---------|
| `plugin-adapter.js` | OpenClaw plugin lifecycle: 19 hook registrations, 10 tool registrations, engine DI |
| `circuit-breaker.js` | 3-state (CLOSED/OPEN/HALF_OPEN) fault tolerance for external calls |
| `tool-resilience.js` | AJV pre-validation + circuit breaker + retry prompt injection |
| `token-budget-tracker.js` | Multi-hook prompt token budget coordination |
| `skill-governor.js` | Skill inventory with role-skill matching and recommendations |
| `context-service.js` | Rich LLM context building from working/episodic/semantic memory + pheromones |
| `progress-tracker.js` | Sub-agent step tracking with throttled progress push |
| `subagent-failure-message.js` | Failure reason extraction and classification (timeout/network/permission/not-found) |

### Tools (10)

4 public + 6 internal (deprecated). See [API Reference](api-reference.md) for detailed schemas.

---

## L6: Monitoring (7 + 98 console files)

Real-time monitoring, health checking, metrics, and the React SPA console.

### Services (7)

| Module | Purpose |
|--------|---------|
| `dashboard-service.js` | Fastify REST API (45+ endpoints) + SSE + static file serving on port 19100 |
| `metrics-collector.js` | RED metrics aggregation (Rate/Error/Duration) + swarm-specific metrics |
| `state-broadcaster.js` | SSE real-time event streaming to connected console clients (100 ms batch) |
| `health-checker.js` | Event-driven health scoring (0-100) with adaptive polling |
| `observability-core.js` | Unified decision/execution/repair/strategy observability |
| `startup-diagnostics.js` | DB connectivity, schema version, empty table detection |
| `trace-collector.js` | Trace span collection bridging MessageBus to trace_spans table |

### Console SPA (98 files)

React application in `src/L6-monitoring/console/src/`. 41 JSX files, 55 JS files, 2 CSS files. Zustand state management, SSE real-time updates, 6 visualization views. See [Architecture](architecture.md) for view details.

---

## Root Level (3 files)

| Module | Purpose |
|--------|---------|
| `swarm-core.js` | Child process entry (~2000 lines): all engine initialization, Tier B hook dispatch, agent state machine |
| `index.js` | Plugin shell (~650 lines): 19 OpenClaw hook registrations, Tier A caching, IPC bridge |
| `event-catalog.js` | 122 event topic definitions with wrapper and validation functions |

---
[← Back to README](../../README.md) | [中文版](../zh-CN/module-guide.md)
