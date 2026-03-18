# 14-Discipline Cross-Research Program

Claw-Swarm is not an analogy engine. Each of its 14 source disciplines contributes a concrete, testable, mathematically formalized algorithm to the codebase. This document traces each discipline from its academic foundations through the specific problem it solves to its implementation in source code.

## 1. Entomology — Decentralized Task Allocation

### Academic Foundation

Social insects achieve colony-level optimization through simple individual rules. Ant colonies use pheromone trails for shortest-path discovery (Dorigo et al., 1996). Honeybees use waggle dances for resource allocation (Karaboga, 2005). Individual response thresholds create decentralized division of labor (Bonabeau et al., 1996).

### Problem Solved

Multi-agent LLM systems need task allocation without a central scheduler. Agents must discover productive work patterns, recruit help, and abandon failing strategies — all without explicit coordination messages.

### Implementation

| Algorithm | Source | Mechanism |
|-----------|--------|-----------|
| MMAS (Min-Max Ant System) | `src/communication/pheromone/pheromone-engine.js` | Pheromone intensity bounded [τ_min, τ_max] prevents convergence |
| ACO Roulette | `src/communication/pheromone/pheromone-engine.js` | P(i) = τ_i^α · η_i^β / Σ for probabilistic selection |
| Response Threshold + PI | `src/orchestration/adaptation/response-threshold.js` | Agent activates when stimulus > personal threshold |
| ABC (Bee Colony) | `src/orchestration/scheduling/contract-net.js` | 50% employed / 45% onlooker / 5% scout roles |

## 2. Immunology — Failure Detection & Prevention

### Academic Foundation

The adaptive immune system distinguishes self from non-self through negative selection (Forrest et al., 1994). Vaccination builds memory of past threats for rapid future response. Together, they form a distributed anomaly detection system without central control.

### Problem Solved

LLM agents produce unpredictable outputs. Tool calls fail in novel ways. Traditional error handling requires enumerating failure modes in advance — impossible for emergent agent behavior.

### Implementation

| Algorithm | Source | Mechanism |
|-----------|--------|-----------|
| Negative Selection | `src/quality/analysis/anomaly-detector.js` | 5 pattern categories, confidence ≥ 0.6 |
| Failure Vaccination | `src/quality/resilience/failure-vaccination.js` | Repair patterns stored in DomainStore `repair_memory` collection |

## 3. Cognitive Science — Memory Persistence & Decision Routing

### Academic Foundation

Atkinson-Shiffrin memory model (1968) describes three stores: sensory, short-term, long-term. Ebbinghaus (1885) quantified forgetting as exponential decay. Kahneman (2011) described two thinking systems: fast intuition (System 1) and slow analysis (System 2).

### Problem Solved

LLM agents lose all knowledge on context window reset. They also lack the ability to distinguish routine decisions (use cached patterns) from novel situations (require full deliberation).

### Implementation

| Algorithm | Source | Mechanism |
|-----------|--------|-----------|
| Working Memory | `src/intelligence/memory/working-memory.js` | 3 buffers: Focus(5) / Context(15) / ScratchPad(30) |
| Episodic Memory | `src/intelligence/memory/episodic-memory.js` | Ebbinghaus decay: R(t) = e^(-t/λI), λ=30 days |
| Semantic Memory | `src/intelligence/memory/semantic-memory.js` | BFS knowledge graph with concept merging |
| Dual-Process Routing | `src/orchestration/adaptation/dual-process-router.js` | System 1 (threshold 0.55) / System 2 (threshold 0.50) |

## 4. Graph Theory — Signal Propagation & Scope Control

### Academic Foundation

BFS (breadth-first search) guarantees shortest-path discovery in unweighted graphs. Directed graphs model hierarchical relationships. Graph reachability defines information scope.

### Problem Solved

Signals must propagate to the right engines without flooding unrelated subsystems. Scope isolation prevents information leakage between independent agent groups.

### Implementation

| Algorithm | Source | Mechanism |
|-----------|--------|-----------|
| SignalStore query | `src/core/field/signal-store.js` | Signal routing via 12-dimensional signal field queries |
| Semantic Graph | `src/intelligence/memory/semantic-memory.js` | BFS traversal for shortest-path concept discovery |

## 5. Evolutionary Biology — Agent Specialization Over Time

### Academic Foundation

Natural selection operates through variation, inheritance, and selection (Darwin, 1859). Gene Expression Programming (Ferreira, 2001) evolves mathematical expressions through tournament selection. Species emerge through competitive exclusion.

### Problem Solved

Agent populations must adapt to changing workloads. Underperforming strategies must be culled. New specializations must emerge from successful patterns without manual design.

### Implementation

| Algorithm | Source | Mechanism |
|-----------|--------|-----------|
| Species Evolution | `src/orchestration/adaptation/species-evolver.js` | Proposal → Trial (30d) → Culling (bottom 20%) |
| GEP Tournament | `src/orchestration/adaptation/species-evolver.js` | Parameter optimization via gene expression programming |
| Persona Evolution | `src/intelligence/identity/persona-evolution.js` | Detect underperformers, evolve agent configurations |

## 6. Network Sociology — Collaboration Pattern Analysis

### Academic Foundation

Social Network Analysis (SNA) quantifies interaction patterns through centrality metrics: degree centrality (connectedness), betweenness centrality (brokerage), and PageRank (influence). Granovetter (1973) showed that weak ties matter more than strong ties for information flow.

### Problem Solved

In a multi-agent swarm, some agents become bottlenecks while others are isolated. Without visibility into collaboration topology, optimization is blind.

### Implementation

| Algorithm | Source | Mechanism |
|-----------|--------|-----------|
| SNA Centrality | `src/intelligence/social/sna-analyzer.js` | Degree, betweenness, PageRank computed every 50 turns |
| Gossip Protocol | `src/communication/stigmergy/gossip-protocol.js` | SWIM protocol, fanout=3, heartbeat 5s |

## 7. Information Theory — Signal Weight Optimization

### Academic Foundation

Mutual Information (Shannon, 1948) measures the statistical dependence between two variables. High MI between a signal and task outcomes means the signal is informative; low MI means it's noise.

### Problem Solved

The swarm generates many advisory signals (pheromone intensity, quality scores, reputation). Some are predictive of good outcomes; others are noise. Manual weight tuning doesn't scale.

### Implementation

| Algorithm | Source | Mechanism |
|-----------|--------|-----------|
| MI Calibration | `src/orchestration/adaptation/signal-calibrator.js` | Auto-tune weights [0.03, 0.40] based on mutual information |

## 8. Control Theory — Homeostatic Activation Regulation

### Academic Foundation

PID controllers maintain setpoints through proportional, integral, and derivative feedback. Biological homeostasis uses similar feedback loops to maintain stable internal conditions despite external perturbation.

### Problem Solved

Agent activation rates must be stable. Too many agents activated on one signal creates thrashing; too few creates starvation. The system needs self-regulation.

### Implementation

| Algorithm | Source | Mechanism |
|-----------|--------|-----------|
| PI Controller | `src/orchestration/adaptation/response-threshold.js` | Adjusts agent thresholds to maintain target swarm activity rate |

## 9. Game Theory — Fair Resource Allocation

### Academic Foundation

Shapley value (Shapley, 1953) provides the unique fair allocation of coalition value among players. FIPA Contract-Net Protocol (Smith, 1980) models task allocation as auction: manager announces, bidders respond, best bid wins.

### Problem Solved

When multiple agents contribute to a goal, credit must be assigned fairly to reinforce productive behavior. Task assignment must be decentralized and competitive.

### Implementation

| Algorithm | Source | Mechanism |
|-----------|--------|-----------|
| Monte Carlo Shapley | `src/orchestration/adaptation/shapley-credit.js` | 100 samples per credit calculation |
| FIPA Contract-Net | `src/orchestration/scheduling/contract-net.js` | CFP → Bid → Award → Execution |

## 10. Morphogenesis — Emergent Spatial Coordination

### Academic Foundation

Turing (1952) showed that two chemicals with different diffusion rates can create stable spatial patterns from uniform initial conditions. Activators amplify locally; inhibitors suppress at longer range. The interplay creates stripes, spots, and other biological patterns.

### Problem Solved

Agent work should self-organize into productive clusters without central planning. Successful strategies should attract more agents (amplification), while failed strategies should repel them (inhibition).

### Implementation

| Algorithm | Source | Mechanism |
|-----------|--------|-----------|
| Reaction-Diffusion | `src/core/field/signal-store.js` | TRAIL/RECRUIT activate; ALARM/DANGER inhibit with faster spread |

## 11. Organizational Psychology — Meaning Construction

### Academic Foundation

Weick's sensemaking theory (1995) describes how organizations construct meaning from ambiguous events through retrospective interpretation, social interaction, and enactive processes.

### Problem Solved

When complex multi-agent tasks produce unexpected outcomes, the system needs to construct coherent narratives about what happened and why — enabling learning from ambiguity.

### Implementation

| Algorithm | Source | Mechanism |
|-----------|--------|-----------|
| Sensemaking | `src/intelligence/social/self-reflection.js` | Retrospective analysis of swarm execution outcomes |

## 12. Cultural Anthropology — Cross-Model Collaboration Friction

### Academic Foundation

Hall's cultural dimensions (1976) and Hofstede's cultural model (1980) describe how different cultural contexts create friction in communication and collaboration.

### Problem Solved

Different LLM models have different "cultures" — communication styles, reasoning approaches, and output formats. When agents using different models collaborate, these differences create friction that must be quantified and managed.

### Implementation

| Algorithm | Source | Mechanism |
|-----------|--------|-----------|
| Cultural Friction | `src/intelligence/social/cultural-friction.js` | Cross-model collaboration cost estimation |

## 13. Affective Computing — Agent Emotional Intelligence

### Academic Foundation

Russell's circumplex model (1980) and Picard's affective computing framework (1997) describe how emotional states can be modeled as continuous vectors in a multi-dimensional space.

### Problem Solved

Agents experience "frustration" (repeated failures), "confidence" (success streaks), and "resistance" (approach mismatches). Without tracking these states, the system cannot adapt workload or detect brewing conflicts.

### Implementation

| Algorithm | Source | Mechanism |
|-----------|--------|-----------|
| 6D Emotion Vector | `src/intelligence/social/emotional-state.js` | EMA smoothing (α=0.3), baseline 0.5, decay 0.05/turn |
| EI Layer | `src/intelligence/social/ei-layer.js` | Higher-level affect interpretation and response |
| Bias Detection | `src/quality/analysis/anomaly-detector.js` | Cognitive bias identification in agent reasoning |

## 14. Computational Ecology — Species Population Dynamics

### Academic Foundation

Lotka-Volterra equations (1910, 1926) model predator-prey and competitive dynamics in ecosystems. The logistic growth model includes carrying capacity constraints.

### Problem Solved

Multiple agent "species" (configurations/specializations) compete for task execution slots. The system must naturally select productive species and cull unproductive ones, respecting resource constraints.

### Implementation

| Algorithm | Source | Mechanism |
|-----------|--------|-----------|
| Lotka-Volterra | `src/orchestration/adaptation/species-evolver.js` | dx/dt = αx(1 - x/K) - βxy, active species cap = 10 |

## Cross-Discipline Synergies

The disciplines don't operate in isolation. Key synergies:

- **Entomology × Graph Theory** — Pheromone signals propagate through the 12-dimensional signal field, combining biological communication with mathematical routing
- **Immunology × Cognitive Science** — Failure vaccines feed into the dual-process router: vaccine match → System 1 (fast path)
- **Game Theory × Evolutionary Biology** — Shapley credit informs species fitness, driving evolutionary selection
- **Affective Computing × Control Theory** — Emotional states feed into the PI controller's activation threshold adjustment
- **Morphogenesis × Entomology** — Turing reaction-diffusion dynamics emerge from the interplay of pheromone trail (activator) and alarm (inhibitor) signals

---
[← Back to README](../../README.md) | [中文版](../zh-CN/cross-research.md)
