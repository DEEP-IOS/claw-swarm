# Biomimicry & Design Philosophy

Claw-Swarm V7.0 draws from biological systems and cognitive science to solve LLM multi-agent coordination problems. Each algorithm maps to a specific source module. This document explains the biological inspiration and its code-level implementation.

## Ant Colony: Pheromone Communication

Real ants deposit chemical trails that evaporate over time, enabling indirect coordination without centralized control. Claw-Swarm implements this as digital pheromones.

**Source:** `src/L2-communication/pheromone-engine.js`

Seven pheromone types mirror biological functions:

| Type | Decay Rate | TTL (min) | Biological Analog |
|------|-----------|-----------|-------------------|
| `trail` | 0.05 | 120 | Path marking to food sources |
| `alarm` | 0.15 | 30 | Danger signaling (fast decay) |
| `recruit` | 0.10 | 60 | Task recruitment pheromones |
| `queen` | 0.02 | 480 | Colony-wide coordination (slow decay) |
| `dance` | 0.08 | 90 | Waggle dance information sharing |
| `food` | 0.04 | 180 | Food source quality marking |
| `danger` | 0.20 | 20 | Threat warning (fastest decay) |

**Algorithm:** MMAS (Min-Max Ant System) with bounds [tau_min, tau_max]. Path selection uses ACO roulette wheel: `P(path_i) = tau_i^alpha * eta_i^beta / sum(tau_j^alpha * eta_j^beta)` where tau is pheromone intensity and eta is heuristic quality (`pheromone-engine.js`, acoSelect method).

**Lazy decay:** Pheromone concentrations are computed on read, not on a timer. This avoids wasted computation on unread paths.

## Ant Colony: Response Threshold Model

Individual ants decide whether to respond to a task based on a personal threshold compared to the task stimulus. This creates decentralized work allocation without assignment.

**Source:** `src/L3-agent/response-threshold.js`

Each agent maintains a response threshold. When task stimulus exceeds the threshold, the agent activates. A PI controller adjusts thresholds to maintain a target activity rate across the swarm.

## Bee Colony: ABC Scheduling

The Artificial Bee Colony algorithm (Karaboga, 2005) divides the swarm into three specialized roles.

**Source:** `src/L4-orchestration/abc-scheduler.js`

| Role | Proportion | Behavior |
|------|-----------|----------|
| Employed bees | 50% | Exploit known task solutions (execute assigned work) |
| Onlooker bees | 45% | Roulette wheel selection: `P(i) = quality_i / sum(quality_j)` |
| Scout bees | 5% | Abandon low-quality solutions, explore randomly |

This three-phase cycle balances exploitation of productive strategies with exploration of new approaches.

## Immune System: Negative Selection

Biological immune systems distinguish "self" from "non-self" by training T-cells against self-antigens. Cells that react to self are eliminated; remaining cells detect foreign patterns.

**Source:** `src/L3-agent/negative-selection.js`

The negative selection detector maintains 5 built-in pattern categories (error_keyword, resource_exhaust, null_reference, network_failure, rate_limit) with a confidence threshold of 0.6. When agent outputs match these failure signatures, the anomaly is flagged.

## Immune System: Failure Vaccination

Biological vaccination injects weakened pathogens to build immunity. Claw-Swarm records failure patterns and creates repair strategies (vaccines) that prevent similar failures in future executions.

**Source:** `src/L3-agent/failure-vaccination.js`

Error categories: network, validation, timeout, logic. Vaccines are stored in SQLite (`repair_memory` table) and consulted before each tool call. When the dual-process router (`src/L4-orchestration/dual-process-router.js`) finds a vaccine match, it routes the task through System 1 (fast path) instead of requiring full deliberation.

## Evolutionary Algorithms: Species Evolution

Biological species emerge through variation, selection, and inheritance. Claw-Swarm evolves agent populations through data-driven specialization.

**Source:** `src/L4-orchestration/species-evolver.js`

**Lifecycle:**

1. **Proposal** — Schema-validated new species configurations with safety guardrails.
2. **Trial** — 30-day observation period requiring >70% success rate (`TRIAL_MIN_SUCCESS_RATE=0.7`).
3. **Culling** — Bottom 20% of inactive species are retired.
4. **GEP Tournament** — Gene Expression Programming for parameter optimization.
5. **Lotka-Volterra dynamics** — Population competition modeling between species.

Active species cap: 10 simultaneous. Weight bounds: [0.05, 1.0].

## Epidemic Spread: Gossip Protocol

Disease spreads through random contacts. Gossip protocols use the same principle for information dissemination in distributed systems.

**Source:** `src/L2-communication/gossip-protocol.js`

- **Fanout:** 3 random peers per heartbeat (every 5 s).
- **P2-1 Memory sharing:** Top 3 high-importance memory summaries piggyback on heartbeats.
- **P2-2 Pheromone snapshots:** Top 10 highest-intensity pheromones shared during sync.
- **Failure detection:** SWIM protocol for agent liveness monitoring (max state age: 60 s).

## Cognitive Science: Dual-Process Routing

Kahneman's dual-process theory describes two modes of human thought: fast intuition (System 1) and slow analysis (System 2).

**Source:** `src/L4-orchestration/dual-process-router.js`

**System 1 (fast, threshold 0.55):** Activates when a vaccine match exists, the circuit breaker is CLOSED with >90% success rate, and task affinity is high. Routes to `DIRECT` mode (skip planning).

**System 2 (slow, threshold 0.50):** Activates for new task types, HALF_OPEN breaker states, high alarm pheromone density, or quality gate failures. Routes to `PREPLAN` mode (full deliberation).

## Human Memory: Three-Layer Model

Claw-Swarm's memory system mirrors the human cognitive architecture: working memory for immediate context, episodic memory for experiences, and semantic memory for knowledge.

### Working Memory

**Source:** `src/L3-agent/memory/working-memory.js`

Three buffers with cascading eviction:

| Buffer | Capacity | Priority Floor | Function |
|--------|----------|---------------|----------|
| Focus | 5 items | 8 | Highest activation, current task |
| Context | 15 items | 5 | Medium activation, recent context |
| Scratch Pad | 30 items | 0 | Temporary computation space |

Activation formula: `activation = baseScore * (1 / (1 + ageMs / 60000))`. Items decay as they age; overflow cascades from focus to context to scratch pad to discard.

### Episodic Memory

**Source:** `src/L3-agent/memory/episodic-memory.js`

Scoring: `score = importance*0.4 + timeDecay*0.2 + relevance*0.2 + reward*0.2`.

Time decay follows the Ebbinghaus forgetting curve: `retention(t) = e^(-t / (lambda * importance))` with lambda = 30 days. High-importance events decay slower.

### Semantic Memory

**Source:** `src/L3-agent/memory/semantic-memory.js`

A knowledge graph with BFS traversal, shortest-path discovery, and concept merging. Generates context snippets for LLM prompt injection.

## Stigmergy: Indirect Coordination

Termites build complex structures by depositing material that attracts further building, without direct communication. This is stigmergy.

**Source:** `src/L2-communication/stigmergic-board.js`

A persistent global bulletin board where agents post announcements. Posts have TTL and are auto-expired. Combined with pheromone signals, this enables fully decentralized coordination where agents modify shared state rather than messaging each other directly.

## Signal Calibration

Biological organisms calibrate sensory signals based on environmental feedback. The signal calibrator auto-tunes advisor weights using mutual information.

**Source:** `src/L4-orchestration/signal-calibrator.js`

Weight bounds: floor = 0.03, cap = 0.40. Phase transitions occur based on accumulated evidence quality.

---
[← Back to README](../../README.md) | [中文版](../zh-CN/biomimicry.md)
