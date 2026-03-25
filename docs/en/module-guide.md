# Module Guide (7 Domains)

**Claw-Swarm V9.2** | ~110 Modules | 7 Domains + Dual Foundation

Claw-Swarm V9 organizes all source code into **7 domains** built atop a **dual foundation** (SwarmField + DomainStore). Modules interact exclusively through **field-mediated coupling**: they emit signals into a 12-dimensional SwarmField and perceive signals from it. No cross-domain direct function calls exist.

Every module extends `ModuleBase` and declares `produces()` / `consumes()` contracts. At startup, the coupling verifier ensures every produced signal has at least one consumer -- zero idle modules by design.

**Notation:** File paths are relative to `src/`. Line counts are targets from the V9 master plan. Signal dimensions use `DIM_*` constants defined in `core/field/types.js`.

---

## Table of Contents

- [core (12 files, ~1,953 lines)](#core-12-files-1953-lines)
- [communication (8 files, ~1,281 lines)](#communication-8-files-1281-lines)
- [intelligence (34 files, ~5,606 lines)](#intelligence-34-files-5606-lines)
- [orchestration (24 files, ~6,889 lines)](#orchestration-24-files-6889-lines)
- [quality (10 files, ~2,738 lines)](#quality-10-files-2738-lines)
- [observe (13 files, ~1,651 lines)](#observe-13-files-1651-lines)
- [bridge (24 files, ~4,526 lines)](#bridge-24-files-4526-lines)
- [12-Dimensional Signal Field](#12-dimensional-signal-field)
- [Coupling Mechanisms](#coupling-mechanisms)
- [File Count Summary](#file-count-summary)

---

## 12-Dimensional Signal Field

All inter-module coordination passes through the SwarmField. Each dimension has a decay rate (lambda) governing signal lifetime.

| # | Dimension | Lambda | Semantics | Primary Producers | Primary Consumers |
|---|-----------|--------|-----------|-------------------|-------------------|
| 1 | DIM_TRAIL | 0.008 | Path / progress | Agent step completion, PheromoneEngine | SpawnAdvisor, PromptBuilder |
| 2 | DIM_ALARM | 0.15 | Anomaly / alert | AnomalyDetector, PheromoneEngine | SpawnAdvisor, ReplanEngine, EmotionalState |
| 3 | DIM_REPUTATION | 0.005 | Reputation | ReputationCRDT, QualityController, ShapleyCredit | SpawnAdvisor, ContractNet, ResultSynthesizer |
| 4 | DIM_TASK | 0.01 | Task / demand | User request, DAGEngine | SpawnAdvisor, ExecutionPlanner, IntentClassifier |
| 5 | DIM_KNOWLEDGE | 0.003 | Knowledge / discovery | Researcher agent, SemanticMemory, PheromoneEngine | PromptBuilder, HybridRetrieval, ScopeEstimator |
| 6 | DIM_COORDINATION | 0.02 | Coordination / sync | HierarchicalCoord, ChannelManager, PheromoneEngine | SpawnAdvisor, ResourceArbiter, DeadlineTracker |
| 7 | DIM_EMOTION | 0.1 | Emotion / frustration | EmotionalState | SpawnAdvisor, PromptBuilder, EILayer |
| 8 | DIM_TRUST | 0.006 | Trust | TrustDynamics | ResultSynthesizer, SpawnAdvisor, ContractNet |
| 9 | DIM_SNA | 0.004 | Collaboration network | SNAAnalyzer | ExecutionPlanner, SpawnAdvisor, HierarchicalCoord |
| 10 | DIM_LEARNING | 0.002 | Learning curve | EpisodeLearner | SpawnAdvisor, BudgetTracker, ScopeEstimator |
| 11 | DIM_CALIBRATION | 0.01 | Signal calibration | SignalCalibrator | FieldVector (weight adjustment) |
| 12 | DIM_SPECIES | 0.001 | Species evolution | SpeciesEvolver | RoleRegistry, SpawnAdvisor |

---

## Coupling Mechanisms

V9 modules interact through exactly four mechanisms:

1. **Field-Mediated Coupling** -- Modules emit signals into SwarmField and perceive via `superpose()`. Multi-dimensional, decayed over time.
2. **Event-Mediated Coupling** -- One-shot notifications via EventBus (`publish`/`subscribe`). 27+ event topics.
3. **Store-Mediated Coupling** -- Persistent data sharing via DomainStore (`put`/`query`).
4. **Dependency Injection** -- Startup-time wiring in `swarm-core.js`. Intra-domain references only.

**Rule:** Cross-domain interaction must use mechanisms 1-3. Mechanism 4 is restricted to intra-domain module references.

---

## core (12 files, ~1,953 lines)

The dual foundation providing the signal field, domain storage, event bus, and the `ModuleBase` abstract class. All other domains depend on core. Core has zero external dependencies.

### Module Overview

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `core/module-base.js` | 60 | Abstract base class for all V9 modules. Declares `produces()`/`consumes()`/`publishes()`/`subscribes()` contracts. Startup coupling verification. | -- | -- |

### field/ -- SwarmField Signal Engine

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `core/field/signal-store.js` | 382 | Signal CRUD, scope indexing, emit/query/superpose/gc entry point. The central signal repository with Forward Decay time scoring. | All 12 dimensions (stores) | All 12 dimensions (indexes) |
| `core/field/forward-decay.js` | 108 | Forward Decay encoding/decoding. `encode(strength, lambda, emittedAt)` produces time-decayed scores; `isExpired()` checks signal liveness. | -- | -- |
| `core/field/field-vector.js` | 178 | Field vector superposition and sensitivity filtering. `superpose(scope, dims)` aggregates signals into a 12-dimensional vector. `applyFilter(vector, sensitivity)` applies role-specific perception weights. Supports calibration weight integration from DIM_CALIBRATION. | -- | DIM_CALIBRATION |
| `core/field/gc-scheduler.js` | 156 | Time-chunked garbage collection scheduler. Periodic cleanup of expired signals to prevent unbounded memory growth. Configurable interval and max-age thresholds. | -- | -- |
| `core/field/backends/memory.js` | 215 | In-memory storage backend implementing the BackendInterface. Operations: `put`/`scan`/`remove`/`count`/`clear`. Default backend for single-process deployments. | -- | -- |
| `core/field/types.js` | 133 | 12 dimension constants (`DIM_TRAIL` through `DIM_SPECIES`), Signal/SignalFilter/FieldVector JSDoc type definitions, decay rate table, `ALL_DIMENSIONS` array. | -- | -- |

### store/ -- Domain State Persistence

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `core/store/domain-store.js` | 287 | Key-value domain storage with batch operations. `put`/`get`/`query`/`delete`/`putBatch`/`snapshot`/`restore`. Used by all domains for persistent state. | -- | -- |
| `core/store/snapshot-manager.js` | 141 | Periodic snapshot creation and compression. Enables point-in-time recovery of domain state. | -- | -- |

### bus/ -- Event Bus

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `core/bus/event-bus.js` | 175 | Topic-based publish/subscribe with wildcard support. `publish(topic, payload)`/`subscribe(topic, handler)`/`unsubscribe()`. In-process event delivery. | -- | -- |
| `core/bus/event-catalog.js` | 88 | 27+ event topic definitions with factory functions. Provides `EventTopics` enum and `createEvent(topic, payload)` factory for type-safe event creation. | -- | -- |

---

## communication (8 files, ~1,281 lines)

Inter-agent messaging, MMAS pheromone coordination, stigmergic boards, and gossip-based knowledge dissemination. This domain provides the communication fabric enabling indirect coordination without centralized message routing.

### Module Overview

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `communication/index.js` | ~134 | Domain factory. `createCommunicationSystem()` wires all communication sub-modules together. | -- | -- |

### channel/ -- Task Communication

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `communication/channel/task-channel.js` | 197 | Virtual Actor pattern for agent-to-agent bidirectional communication within a task scope. `join`/`leave`/`post`/`getMessages`/`getMembers`. | -- | -- |
| `communication/channel/channel-manager.js` | 153 | Channel lifecycle management. Creates/closes channels, tracks active channels per session. | DIM_COORDINATION | -- |

### pheromone/ -- MMAS Pheromone Engine

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `communication/pheromone/pheromone-engine.js` | 311 | Min-Max Ant System pheromone management. 6 pheromone types (trail/alarm/recruit/queen/dance/food). ACO roulette wheel selection (`acoSelect`), lazy decay computation. Bridges pheromone types to SwarmField dimensions. | DIM_TASK_LOAD, DIM_QUALITY, DIM_COHERENCE, DIM_ERROR_RATE | -- |
| `communication/pheromone/response-matrix.js` | 149 | Auto-escalating pressure gradients for pending tasks. Pheromone pressure increases exponentially for unhandled tasks to attract agent attention. | -- | DIM_TASK |
| `communication/pheromone/type-registry.js` | 77 | Dynamic pheromone type registration with per-type MMAS boundary configuration (tau_min/tau_max). | -- | -- |

### stigmergy/ -- Indirect Coordination

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `communication/stigmergy/stigmergic-board.js` | 169 | Persistent global bulletin board for environment-mediated coordination. Agents post announcements with TTL; expired posts auto-clean. | -- | -- |
| `communication/stigmergy/gossip-protocol.js` | 91 | Knowledge dissemination timing model with progressive visibility. Fanout-based information spreading across agents. | DIM_KNOWLEDGE | -- |

---

## intelligence (34 files, ~5,606 lines)

Individual agent intelligence: identity (roles, prompts, capabilities), multi-layer memory, social dynamics (reputation, emotion, trust), task understanding, and artifact management.

### identity/ -- Agent Identity and Roles (8 files)

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `intelligence/identity/soul-designer.js` | -- | Agent personality archetype generation. Compiles persona traits, behavioral guidelines, and role context into a structured prompt fragment. | -- | DIM_EMOTION, DIM_TRUST |
| `intelligence/identity/prompt-builder.js` | 363 | Metadata-driven dynamic prompt assembly. Reads multiple field dimensions to inject contextual awareness. Integrates HybridRetrieval results, skill recommendations, and emotional cues. | -- | DIM_TRAIL, DIM_KNOWLEDGE, DIM_EMOTION, DIM_CALIBRATION |
| `intelligence/identity/role-registry.js` | 260 | 10 role definitions with sensitivity vectors and evolution parameter reception. Roles define per-dimension perception coefficients. Receives dynamic updates from SpeciesEvolver via DIM_SPECIES. | -- | DIM_SPECIES |
| `intelligence/identity/lifecycle-manager.js` | 253 | Agent lifecycle FSM: CREATED, INITIALIZING, IDLE, ACTIVE, BUSY, TERMINATING, TERMINATED. State transitions emit lifecycle events via EventBus. | -- | -- |
| `intelligence/identity/cross-provider.js` | 239 | Cross-provider coordination with 4-phase onboarding and 5D behavioral profiling. Manages collaboration between agents backed by different LLM providers. | -- | DIM_TRUST |
| `intelligence/identity/capability-engine.js` | 230 | Skill inventory with mastery tracking. Records task outcomes to update multi-dimensional capability vectors. Receives self-reflection updates. | -- | DIM_LEARNING |
| `intelligence/identity/model-capability.js` | -- | LLM model capability mapping. 8D capability vectors (reasoning, coding, creativity, instruction-following, context-length, speed, cost, multilingual) for 35+ models. | -- | -- |
| `intelligence/identity/sensitivity-filter.js` | -- | Field vector sensitivity filtering. `applyFilter(rawVector, roleSensitivity)` produces a role-specific perception of the SwarmField. | -- | All dimensions (filtering) |

### memory/ -- Multi-Layer Memory (8 files)

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `intelligence/memory/episodic-memory.js` | 255 | Experience storage with Ebbinghaus forgetting curve. `R(t) = e^(-t/(lambda*importance))`, lambda=30 days. Multi-dimensional retrieval scoring. Persists via DomainStore. | -- | -- |
| `intelligence/memory/hybrid-retrieval.js` | 228 | 6-dimensional memory retrieval combining semantic similarity, temporal recency, importance, relevance, reward history, and recency. | -- | DIM_KNOWLEDGE |
| `intelligence/memory/embedding-engine.js` | 222 | Dual-mode text embedding: local ONNX/Transformers.js (384D) or external API (1536D). Automatic fallback from API to local on network failure. | -- | -- |
| `intelligence/memory/semantic-memory.js` | 215 | Knowledge graph with BFS traversal, Dijkstra shortest-path, concept merging, and diffusion activation. Generates context snippets for prompt injection. | DIM_KNOWLEDGE | -- |
| `intelligence/memory/vector-index.js` | 219 | HNSW approximate nearest neighbor search with linear scan fallback. Dynamic index updates as new embeddings arrive. | -- | -- |
| `intelligence/memory/context-engine.js` | -- | Context management with token budget trimming. Aggregates working memory, episodic memory, and semantic memory into a unified context payload. | -- | -- |
| `intelligence/memory/user-profile.js` | 180 | User skill profiling and preference learning. Tracks interaction patterns to adapt agent behavior to user needs. | -- | DIM_LEARNING |
| `intelligence/memory/working-memory.js` | -- | 3-buffer working memory: Focus (5 items), Context (15 items), ScratchPad (30 items). Activation decay with cascade overflow: Focus -> Context -> ScratchPad -> discard. | -- | -- |

### social/ -- Social Dynamics (8 files)

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `intelligence/social/episode-learner.js` | -- | Extracts reusable knowledge patterns from completed tasks. Emits learning curve signals to the field. | DIM_LEARNING | DIM_TRAIL |
| `intelligence/social/reputation-crdt.js` | -- | PN-Counter CRDT for conflict-free reputation accounting. Merges reputation updates across distributed agents. | DIM_REPUTATION | DIM_TRAIL, DIM_ALARM |
| `intelligence/social/cultural-friction.js` | -- | Cross-model cultural friction estimation. Quantifies behavioral incompatibilities between different LLM providers. Integrates into cross-provider collaboration decisions. | -- | DIM_TRUST |
| `intelligence/social/self-reflection.js` | -- | Post-task self-assessment. Feeds results into CapabilityEngine and ReputationCRDT for continuous calibration. | -- | DIM_TRAIL |
| `intelligence/social/sna-analyzer.js` | -- | Social network analysis: degree centrality, betweenness centrality, clustering coefficient, PageRank. Produces collaboration topology signals. | DIM_SNA | DIM_COORDINATION |
| `intelligence/social/emotional-state.js` | -- | 6D emotional state model (frustration, confidence, curiosity, resistance, openness, trust). EMA tracking with natural decay to baseline. | DIM_EMOTION | DIM_ALARM, DIM_TRAIL |
| `intelligence/social/trust-dynamics.js` | -- | Trust score computation based on interaction history, success rates, and behavioral consistency. | DIM_TRUST | DIM_REPUTATION, DIM_SNA |
| `intelligence/social/ei-layer.js` | -- | Emotional intelligence layer. Interprets emotional state vectors and recommends behavioral adjustments for PromptBuilder and TaskPresenter. | -- | DIM_EMOTION |

### artifacts/ -- Execution Artifacts (3 files)

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `intelligence/artifacts/execution-journal.js` | 219 | Execution log and decision recording. Captures every significant decision with context, alternatives considered, and outcome. | -- | DIM_TRAIL |
| `intelligence/artifacts/artifact-registry.js` | -- | Artifact registration, classification, and indexing. Tracks all outputs produced by agents (code, documents, analyses). | -- | -- |
| `intelligence/artifacts/workspace-organizer.js` | -- | Working directory structure suggestions and creation. Organizes agent outputs into a coherent file structure. | -- | DIM_TASK |

### understanding/ -- Task Understanding (3 files)

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `intelligence/understanding/intent-classifier.js` | -- | Intent classification with 8 PHASE_TEMPLATES (bug_fix, new_feature, refactor, optimize, explore, analyze, content, question). Templates include parallel fork+merge branches (e.g., new_feature forks to [backend, frontend] then merges at review). Routes tasks to appropriate planning strategies. | -- | DIM_TASK |
| `intelligence/understanding/requirement-clarifier.js` | -- | Requirement clarification dialogue. Detects ambiguity and generates targeted questions to resolve it. | -- | DIM_TASK |
| `intelligence/understanding/scope-estimator.js` | -- | Scope estimation: affected file count, complexity, risk level. Feeds into budget and scheduling decisions. | -- | DIM_TASK, DIM_KNOWLEDGE, DIM_LEARNING |

---

## orchestration (24 files, ~6,889 lines)

Task coordination, DAG planning, scheduling, resource management, population evolution, and adaptive mechanisms. Transforms individual agent capabilities into coordinated swarm behavior.

### planning/ -- DAG and Execution Planning (6 files)

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `orchestration/planning/dag-engine.js` | 669 | DAG construction, topological sort, state machine (NODE_STATE: PENDING → SPAWNING → ASSIGNED → EXECUTING → COMPLETED / DEAD_LETTER), dependency resolution, work-stealing, dead letter queue, auction integration. Exposes `spawnNode(dagId, nodeId)` for SPAWNING transition. The core execution engine. | DIM_TASK | DIM_TRAIL, DIM_ALARM |
| `orchestration/planning/execution-planner.js` | 427 | Mixture-of-Experts top-k planning. Expert scoring based on keywords, capabilities, and history. Decomposes complex tasks into phase sequences. | -- | DIM_TASK, DIM_SNA, DIM_KNOWLEDGE |
| `orchestration/planning/result-synthesizer.js` | 421 | Multi-role output synthesis with Jaccard deduplication, quality aggregation, and Trust-weighted merging. | -- | DIM_REPUTATION, DIM_TRUST |
| `orchestration/planning/critical-path.js` | 325 | Critical Path Method analysis: forward pass (ES/EF), backward pass (LS/LF), slack computation. Feeds deadline tracking. | -- | DIM_TASK |
| `orchestration/planning/replan-engine.js` | 317 | Dynamic replanning triggered by alarm density exceeding threshold. Exponential backoff to prevent thrashing. Driven by FailureAnalyzer output. | -- | DIM_ALARM, DIM_TRAIL |
| `orchestration/planning/zone-manager.js` | -- | Code zone management (test/config/core/ui). Groups related files for agent assignment scope control. | -- | DIM_TASK |

### scheduling/ -- Agent Scheduling (6 files)

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `orchestration/scheduling/spawn-advisor.js` | 430 | 12-dimensional field-vector-driven spawn decisions. Reads the full field vector via `superpose()` to determine role selection, model tier (fast/balanced/strong/reasoning), and concurrency. The most field-coupled module in V9. | -- | All 12 dimensions |
| `orchestration/scheduling/resource-arbiter.js` | 339 | File locking, API rate limiting, and conflict resolution for concurrent agent access to shared resources. | -- | DIM_COORDINATION |
| `orchestration/scheduling/hierarchical-coord.js` | 236 | Parent-child agent hierarchy with configurable depth limit and concurrency control. Recursive task decomposition. | DIM_COORDINATION | DIM_TASK, DIM_SNA |
| `orchestration/scheduling/contract-net.js` | -- | FIPA Contract-Net Protocol: CFP/Bid/Award negotiation. Bid scoring: `capability * trust * cost`. | -- | DIM_REPUTATION, DIM_TRUST |
| `orchestration/scheduling/role-manager.js` | -- | Role lifecycle management with dynamic registration. Runtime role creation from SpeciesEvolver discoveries. | -- | DIM_SPECIES |
| `orchestration/scheduling/deadline-tracker.js` | -- | Task-level SLA enforcement and phase time budgets. Monitors critical path progress and emits warnings on schedule slip. | -- | DIM_COORDINATION, DIM_TASK |

### adaptation/ -- Adaptive Mechanisms (11 files)

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `orchestration/adaptation/species-evolver.js` | 472 | Open-ended population evolution. Lotka-Volterra competition, GEP tournament selection, species lifecycle: proposal -> trial (30d, >70% success) -> promotion or culling. Active cap: 10 species. | DIM_SPECIES | DIM_REPUTATION, DIM_TRAIL |
| `orchestration/adaptation/role-discovery.js` | 341 | Data-driven role discovery via k-means++ clustering on agent capability vectors. Identifies emergent role patterns not explicitly defined. Registers new roles into RoleRegistry. | -- | DIM_SNA, DIM_TRAIL |
| `orchestration/adaptation/budget-tracker.js` | 332 | Multi-dimensional budget tracking: tokens, wall-clock time, agent count, storage, cost. Hard limits and configurable warning thresholds. | -- | DIM_LEARNING, DIM_TASK |
| `orchestration/adaptation/budget-forecaster.js` | 270 | Linear regression-based budget depletion forecasting. Predicts exhaustion time per budget dimension and triggers preemptive warnings. | -- | DIM_TASK |
| `orchestration/adaptation/signal-calibrator.js` | 248 | Mutual Information-based auto-calibration of field perception weights. Weight bounds [0.03, 0.40]. Meta-level optimization: calibrates the field itself. | DIM_CALIBRATION | All 12 dimensions |
| `orchestration/adaptation/shapley-credit.js` | 246 | Monte Carlo Shapley value computation (100 samples) for fair credit attribution across agent coalitions after DAG completion. | DIM_REPUTATION | DIM_TRAIL |
| `orchestration/adaptation/response-threshold.js` | -- | Fixed response threshold model with PI controller for target activity rate maintenance. Agents independently decide task activation based on personal thresholds vs environmental stimulus. | -- | DIM_TASK, DIM_ALARM |
| `orchestration/adaptation/skill-governor.js` | -- | Skill recommendation engine. Tracks skill usage, success rate, and decay. Produces recommendations injected by PromptBuilder. | -- | DIM_LEARNING, DIM_TRAIL |
| `orchestration/adaptation/global-modulator.js` | -- | Swarm-wide mode control: EXPLORE, EXPLOIT, RELIABLE, URGENT. Alarm density drives mode transitions. Mode affects field perception weights. | -- | DIM_ALARM, DIM_TRAIL |
| `orchestration/adaptation/dual-process-router.js` | -- | Kahneman System 1/2 decision routing. System 1 (DIRECT, threshold 0.55): vaccine match + breaker CLOSED + high affinity. System 2 (PREPLAN, threshold 0.50): new task type + HALF_OPEN + alarm density. | -- | DIM_ALARM, DIM_TRAIL |
| `orchestration/adaptation/index.js` | -- | Domain factory. Wires all adaptation sub-modules. | -- | -- |

---

## quality (10 files, ~2,738 lines)

Quality gates, failure analysis, anomaly detection, compliance monitoring, and resilience mechanisms. Ensures output quality and system robustness.

### gate/ -- Quality Gates (2 files)

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `quality/gate/quality-controller.js` | 331 | Multi-criteria quality assessment: self-review, peer review, lead review. Configurable thresholds per quality dimension. | DIM_REPUTATION | DIM_TRAIL, DIM_TRUST |
| `quality/gate/evidence-gate.js` | 314 | Three-tier evidence discipline: PRIMARY (direct observation), CORROBORATION (confirmed by second source), INFERENCE (derived reasoning). Hard/soft gates with appeal mechanism. | -- | DIM_TRAIL |

### analysis/ -- Failure Analysis (3 files)

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `quality/analysis/failure-analyzer.js` | 257 | 5-category failure classification: INPUT_ERROR, TIMEOUT, LLM_REFUSAL, PERMISSION_DENIED, RESOURCE_EXHAUSTED. Feeds ReplanEngine. | -- | DIM_ALARM |
| `quality/analysis/anomaly-detector.js` | 244 | Behavioral baseline tracking with negative selection principles. Detects deviations from established agent patterns. | DIM_ALARM | DIM_TRAIL |
| `quality/analysis/compliance-monitor.js` | 219 | Compliance detection and escalation. Monitors agent outputs for policy violations and injects corrective prompts. | -- | DIM_ALARM, DIM_REPUTATION |

### resilience/ -- Fault Tolerance (4 files)

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `quality/resilience/failure-vaccination.js` | 316 | Immune system pattern: failure pattern memory with repair strategy (vaccine) storage. Vaccines persist in DomainStore. Dual-process router checks vaccine match for System 1 fast-path. | -- | DIM_ALARM |
| `quality/resilience/tool-resilience.js` | 312 | Pre-execution resilience: AJV JSON Schema parameter pre-validation, circuit breaker check, retry prompt injection on failure. | -- | -- |
| `quality/resilience/circuit-breaker.js` | 259 | Per-tool 3-state circuit breaker (CLOSED, OPEN, HALF_OPEN). Tracks success/failure rates; opens on threshold breach; half-opens after cooldown. State persisted in DomainStore. | -- | -- |
| `quality/resilience/pipeline-breaker.js` | 262 | Per-DAG timeout breaker. Cascade abort when a phase exceeds its time budget. Dead letter queue integration. | -- | DIM_TASK |

---

## observe (13 files, ~1,651 lines)

Real-time monitoring, health checking, metrics aggregation, and the console SPA. Read-only observation principle: this domain never modifies swarm behavior.

### Backend Services

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `observe/dashboard/dashboard-service.js` | 662 | Fastify REST API server on port 19100. 58 REST endpoints covering agents, tasks, pheromones, reputation, species, DAGs, health, traces, topology, affinity, dead letters, governance, metrics, bridge, and console diagnostics. Serves the console SPA static files and exposes bridge status endpoints. | -- | -- |
| `observe/metrics/metrics-collector.js` | 249 | RED metrics aggregation: Rate (events/sec), Error (failure rate), Duration (latency percentiles). Subscribes to all domain events and computes rolling windows. | -- | All dimensions (read-only) |
| `observe/health/trace-collector.js` | 227 | Distributed trace span collection. Bridges EventBus trace events to persistent storage. Parent-child span relationships for end-to-end task tracing. | -- | -- |
| `observe/health/health-checker.js` | 185 | Multi-dimensional health scoring (0-100) with event-driven updates and adaptive polling fallback. Dimensions: field connectivity, agent responsiveness, bus throughput, memory usage, error rate. | -- | DIM_ALARM |
| `observe/broadcast/state-broadcaster.js` | 192 | Legacy SSE event streaming retained for diagnostics and backward compatibility. Batches events at 100ms intervals and subscribes to all domain event topics while the primary console path uses the WebSocket bridge. Supports `setVerbosity(level)` to control event filtering (0=critical, 1=default, 2=verbose). | -- | -- |

### Console SPA (Frontend Assets)

React 18 application served from `observe/dashboard/console/`. Zustand state management, WebSocket bridge updates via `ConsoleDataBridge` on port 19101, and 10 visualization views. Built with Vite.

| View | Purpose |
|------|---------|
| **Hive** | Hexagonal agent map with real-time status, capability radar, and health indicators |
| **Pipeline** | DAG visualization with task dependency graph, execution progress, and critical path highlighting |
| **Cognition** | Memory and cognitive state: working memory, episodic timeline, emotion vector radar |
| **Ecology** | Population dynamics: Lotka-Volterra curves, species competition, pheromone particle animation |
| **Network** | Social network graph: agent communication topology, centrality heatmaps |
| **Control** | Operations panel: global modulator control, breaker status, budget gauges, manual intervention |
| **Field** | 12-dimensional signal field overview and raw field pressure |
| **System** | Runtime architecture, workflow evidence, and health telemetry |
| **Adaptation** | Explore/exploit balance, calibration, and species evolution |
| **Communication** | Active channels, pheromone flow, and coordination traffic |

Additional components: CommandPalette (Ctrl+K), SettingsDrawer, EventTimeline, Inspector, Toast notifications.

---

## bridge (24 files, ~4,526 lines)

The sole integration point with the OpenClaw plugin system. All other domains are framework-agnostic. The bridge translates OpenClaw hooks, tools, and sessions into domain-level operations.

### tools/ -- OpenClaw Tools (10 files)

4 public tools exposed through the OpenClaw tool API, plus 6 internal tools for inter-agent coordination.

**Public Tools:**

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `bridge/tools/run-tool.js` | 248 | Primary swarm execution tool (`swarm_run`). Task decomposition, subagent spawning via SpawnClient, progress monitoring, cancel/resume. | DIM_TASK | -- |
| `bridge/tools/query-tool.js` | 320 | State query tool (`swarm_query`). 10 sub-commands: agent, task, pheromone, metric, species, plan, zone, reputation, memory, health. Read-only. | -- | -- |
| `bridge/tools/plan-tool.js` | 320 | Execution plan tool (`swarm_plan`). View/modify current DAG, reorder phases, add dependencies. | -- | DIM_TASK |
| `bridge/tools/gate-tool.js` | 261 | Quality gate tool (`swarm_gate`). Triggers multi-level quality review on agent outputs. | -- | DIM_REPUTATION |

**Internal Tools:**

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `bridge/tools/zone-tool.js` | 255 | Zone management tool (`swarm_zone`). Zone CRUD, member assignment, leader tracking. | -- | -- |
| `bridge/tools/pheromone-tool.js` | 242 | Pheromone operations (`swarm_pheromone`). Deposit/query pheromones. | DIM_TRAIL | -- |
| `bridge/tools/memory-tool.js` | 238 | Memory operations (`swarm_memory`). Read/write agent 3-layer memory. | -- | -- |
| `bridge/tools/checkpoint-tool.js` | 232 | Human-in-the-loop checkpoint (`swarm_checkpoint`). STOP instruction mechanism for high-risk action approval. | -- | -- |
| `bridge/tools/spawn-tool.js` | 186 | Internal spawn tool (`swarm_spawn`). Direct subagent creation. | -- | -- |
| `bridge/tools/dispatch-tool.js` | -- | Direct dispatch (`swarm_dispatch`). Bypasses DAG, targets specific agent/role. | -- | -- |

### hooks/ -- Hook Adapter

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `bridge/hooks/hook-adapter.js` | -- | 16 OpenClaw hooks -> domain module event forwarding. Translates hook lifecycle events into EventBus publications and field signal emissions. | -- | -- |

### session/ -- Session Management

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `bridge/session/session-bridge.js` | -- | Session lifecycle to field scope mapping. Maps OpenClaw sessions to SwarmField scopes. | -- | -- |
| `bridge/session/spawn-client.js` | 165 | DirectSpawnClient. Bypasses plugin API to create real subagents via Gateway WebSocket RPC. Two-phase async: `swarm_run` returns `{ status: 'dispatched' }` immediately, background `onEnded` triggers result injection. | -- | -- |
| `bridge/session/model-fallback.js` | -- | Model switching logic on 429/503 errors. Automatic tier downgrade with retry. | -- | -- |

### reliability/ -- Reliability Layer (5 files)

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `bridge/reliability/inject-retry.js` | -- | `injectWithRetry()` with 3-attempt exponential backoff for chat injection failures. | -- | -- |
| `bridge/reliability/readiness-guard.js` | -- | Pre-flight readiness check. Blocks operations until all domain modules report ready. | -- | -- |
| `bridge/reliability/tool-guard.js` | -- | Tool call interception and validation layer. | -- | -- |
| `bridge/reliability/compliance-hook.js` | -- | Compliance escalation hook. Detects non-compliant agent behavior and injects corrective system prompts. | -- | DIM_ALARM |
| `bridge/reliability/ipc-fallback.js` | -- | Degradation cache for IPC failures. Serves cached responses when the core process is unreachable. | -- | -- |

### interaction/ -- User Interaction (3 files)

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `bridge/interaction/task-presenter.js` | 295 | Result formatting and modification summary generation. Produces user-facing task completion reports. | -- | DIM_TRAIL |
| `bridge/interaction/progress-tracker.js` | 160 | Subagent step tracking with throttled progress push. Real-time progress reporting via SSE. | -- | DIM_TRAIL |
| `bridge/interaction/user-notifier.js` | 149 | Proactive user notifications for significant events (failures, completions, checkpoints). | -- | DIM_ALARM |

### connectors/ -- External Integration

| File | Lines | Responsibility | Produces | Consumes |
|------|-------|----------------|----------|----------|
| `bridge/connectors/mcp-registry.js` | -- | MCP tool discovery and registration. Discovers external MCP servers and registers their tools. | -- | -- |

---

## Coupling Topology

```
                    ┌─────────────────────────────────────┐
                    │           SwarmField (12D)           │
                    │                                     │
                    │  TRAIL   ALARM    REPUTATION  TASK  │
                    │  KNOWLEDGE  COORDINATION  EMOTION   │
                    │  TRUST   SNA   LEARNING  CALIBRATION│
                    │  SPECIES                            │
                    └──────────────┬──────────────────────┘
                                   │
                    All modules immersed in the field
                    emit signals ↑↓ perceive signals
```

**Dependency DAG (Domain Level):**

```
core (dual foundation)
├──> communication
│    ├──> intelligence/memory + identity (R2)
│    │    ├──> intelligence/social + understanding + artifacts (R3)
│    │    │    └──> orchestration/adaptation (R5)
│    │    └──> orchestration/planning + scheduling (R4)
│    │         ├──> orchestration/adaptation (R5)
│    │         └──> quality (R6)
│    └──> orchestration/planning (partial: dag-engine needs only core+comm)
├──> quality (partial: tool-resilience needs only core)
└──> observe (partial: metrics needs only core/bus)
                    │
              R5 + R6 + R7 all complete
                    │
                   bridge (needs all domains)
```

---

## File Count Summary

| Domain | Files | Lines | Key Characteristics |
|--------|-------|-------|---------------------|
| core | 12 | ~1,953 | Signal field (12D), DomainStore, EventBus (27 topics), ModuleBase |
| communication | 8 | ~1,281 | MMAS pheromone (6 types, ACO), task channels, gossip, stigmergy |
| intelligence | 34 | ~5,606 | 3-layer memory, 10 roles, 6D emotion, CRDT reputation, SNA, trust |
| orchestration | 24 | ~6,889 | DAG engine, contract-net, spawn advisor (12D), Lotka-Volterra, GEP, Shapley |
| quality | 10 | ~2,738 | Quality gates, circuit breaker, failure vaccination, anomaly detection |
| observe | 13 | ~1,651 | 58 REST endpoints, WS bridge + legacy SSE, React 18 SPA (10 views), health checker |
| bridge | 24 | ~4,526 | 10 tools (4 public + 6 internal), 16 hooks, session bridge, 7-layer reliability |
| **Total** | **~125** | **~24,644** | Zero idle modules, zero feature flags, 12D field-mediated coupling |

---

[Back to README](../../README.md) | [Chinese](../zh-CN/module-guide.md)
