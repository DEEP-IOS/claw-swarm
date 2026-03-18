# Biomimicry & Algorithm Design Reference

**Claw-Swarm V9.0.0** | 20 Bio-Inspired Algorithms

Claw-Swarm draws from biological systems, cognitive science, and social dynamics to solve
the fundamental challenges of LLM multi-agent coordination: task allocation without central
scheduling, adaptive behavior without retraining, resilient communication without guaranteed
delivery, and fair credit attribution without ground truth. This document catalogs each
algorithm with its biological source, formal specification, implementation anchor, and the
design rationale that motivated its adoption.

---

## Table of Contents

1. [MMAS (Min-Max Ant System)](#1-mmas-min-max-ant-system)
2. [ACO Roulette Wheel Selection](#2-aco-roulette-wheel-selection)
3. [Response Threshold with PI Controller](#3-response-threshold-with-pi-controller)
4. [Artificial Bee Colony (ABC)](#4-artificial-bee-colony-abc)
5. [Ebbinghaus Forgetting Curve](#5-ebbinghaus-forgetting-curve)
6. [Dual-Process Theory (Kahneman)](#6-dual-process-theory-kahneman)
7. [Working Memory Buffers](#7-working-memory-buffers)
8. [Semantic Knowledge Graph](#8-semantic-knowledge-graph)
9. [Negative Selection Algorithm](#9-negative-selection-algorithm)
10. [Failure Vaccination](#10-failure-vaccination)
11. [FIPA Contract-Net Protocol](#11-fipa-contract-net-protocol)
12. [Monte Carlo Shapley Value](#12-monte-carlo-shapley-value)
13. [Lotka-Volterra Competition](#13-lotka-volterra-competition)
14. [GEP Tournament Selection](#14-gep-tournament-selection)
15. [Gossip (SWIM) Protocol](#15-gossip-swim-protocol)
16. [Mutual Information Signal Calibration](#16-mutual-information-signal-calibration)
17. [Turing Reaction-Diffusion](#17-turing-reaction-diffusion)
18. [6D Emotion Vector (EMA)](#18-6d-emotion-vector-ema)
19. [Cultural Friction Model](#19-cultural-friction-model)
20. [SNA Centrality Metrics](#20-sna-centrality-metrics)

---

## 1. MMAS (Min-Max Ant System)

### Biological Source

Ant colonies coordinate foraging through volatile chemical trails (pheromones) deposited
on substrates. Longer or less-productive paths accumulate less pheromone due to evaporation,
creating a positive feedback loop that converges toward optimal routes. Stutzle and Hoos
(2000) formalized the Min-Max variant to address premature convergence observed in the
original Ant System (Dorigo, 1992) by bounding pheromone intensities within an explicit
interval.

### Mathematical Formulation

Pheromone update with MMAS bounds:

```
tau_ij(t+1) = clamp( (1 - rho) * tau_ij(t) + Delta_tau_ij, tau_min, tau_max )

where:
  rho        = evaporation rate (type-specific, range 0.02 to 0.20)
  Delta_tau  = deposit amount from iteration-best ant
  tau_min    = lower bound (prevents path starvation)
  tau_max    = upper bound (prevents dominance lock-in)
```

Seven pheromone types are defined, each with biologically-motivated decay rates:

| Type      | Decay  | TTL (min) | Analog                        |
|-----------|--------|-----------|-------------------------------|
| `trail`   | 0.05   | 120       | Path marking to food sources  |
| `alarm`   | 0.15   | 30        | Danger signaling (fast decay) |
| `recruit` | 0.10   | 60        | Task recruitment pheromones   |
| `queen`   | 0.02   | 480       | Colony-wide coordination      |
| `dance`   | 0.08   | 90        | Waggle dance information      |
| `food`    | 0.04   | 180       | Food source quality marking   |
| `danger`  | 0.20   | 20        | Threat warning (fastest)      |

Decay is computed lazily on read, avoiding timer-based overhead on unvisited paths.

### Source Code

`src/communication/pheromone/pheromone-engine.js` -- `deposit()`, `_applyDecay()`, MMAS constants.

### Design Decision

Unbounded pheromone systems suffer from stagnation: once a dominant path emerges, its
intensity drowns out alternatives. In LLM multi-agent systems, this manifests as repeated
routing to a single agent type. MMAS bounds guarantee that no path is ever fully abandoned
(tau_min) and no path monopolizes selection (tau_max), preserving exploration capacity
throughout the swarm's lifetime.

---

## 2. ACO Roulette Wheel Selection

### Biological Source

Foraging ants do not make deterministic choices; they exhibit stochastic selection weighted
by pheromone intensity and local heuristic quality (e.g., distance to food). The ACO
metaheuristic (Dorigo & Gambardella, 1997) formalizes this as a probability distribution
over candidate paths.

### Mathematical Formulation

```
P(path_i) = tau_i^alpha * eta_i^beta / sum_j( tau_j^alpha * eta_j^beta )

where:
  tau_i  = pheromone intensity on path i
  eta_i  = heuristic quality of path i (e.g., capability match score)
  alpha  = pheromone influence exponent (default: 1.0)
  beta   = heuristic influence exponent (default: 2.0)
```

The `alpha` parameter controls how strongly past experience (pheromone) influences the
decision; `beta` controls the weight of immediate quality assessment. With `beta > alpha`,
the system favors exploitation of known-good agents while still allowing pheromone-driven
exploration.

### Source Code

`src/communication/pheromone/pheromone-engine.js` -- `acoSelect(candidates, alpha, beta)` method.

### Design Decision

Roulette wheel selection provides a natural balance between exploitation and exploration
without requiring an explicit epsilon-greedy parameter. Unlike tournament selection, it
scales smoothly with population size and allows every candidate a non-zero probability of
selection, which is critical when the swarm must discover new agent capabilities.

---

## 3. Response Threshold with PI Controller

### Biological Source

Bonabeau et al. (1998) observed that individual ants maintain internal response thresholds
for specific task types. When the environmental stimulus for a task exceeds an ant's personal
threshold, the ant activates. This mechanism produces self-organized division of labor
without centralized assignment. Robinson (1992) demonstrated age-related threshold shifts
in honeybees (age polyethism).

### Mathematical Formulation

Activation probability for agent `a` and task stimulus `s`:

```
P_activate(a, s) = s^n / (s^n + theta_a^n)

where:
  s       = task stimulus intensity (pheromone concentration)
  theta_a = personal response threshold for agent a
  n       = steepness parameter (default: 2)
```

A PI (Proportional-Integral) controller adjusts thresholds to maintain a target activity
rate:

```
theta_a(t+1) = theta_a(t) + Kp * e(t) + Ki * integral(e, 0, t)

where:
  e(t)  = actual_activity_rate - target_activity_rate
  Kp    = proportional gain
  Ki    = integral gain
```

When activity exceeds the target, thresholds increase (fewer agents activate). When activity
is below target, thresholds decrease (more agents respond).

### Source Code

`src/orchestration/adaptation/response-threshold.js` -- `shouldActivate(agentId, stimulus)`, `_piUpdate()`.

### Design Decision

Central schedulers become bottlenecks in swarms of 10+ agents. The response threshold model
scales linearly with agent count because each agent makes an independent local decision.
The PI controller prevents oscillation (all agents activating then all idling) that pure
threshold models exhibit under bursty workloads.

---

## 4. Artificial Bee Colony (ABC)

### Biological Source

Karaboga (2005) modeled the foraging behavior of Apis mellifera, observing three
specialized roles: employed bees that exploit known food sources, onlooker bees that
evaluate reports and probabilistically select the best sources, and scout bees that abandon
depleted sources to discover new ones. This three-phase cycle maintains a balance between
exploitation and exploration.

### Mathematical Formulation

Role allocation:

```
Employed bees:  50% of colony  -- exploit assigned task solutions
Onlooker bees:  45% of colony  -- roulette selection based on quality
Scout bees:      5% of colony  -- random exploration of new solutions

Onlooker selection probability:
  P(i) = quality_i / sum_j( quality_j )

Abandonment criterion:
  If trial_count(i) > limit, food source i is abandoned and scout explores.
```

### Source Code

`src/orchestration/scheduling/contract-net.js` -- ABC scheduling logic merged into contract-net.
Extends ModuleBase with RECRUIT signal receptor.

### Design Decision

DAG-based orchestration handles structured workflows well but cannot adapt to unstructured
exploration tasks. ABC scheduling provides a complementary mode: when the swarm faces an
open-ended problem (e.g., debugging with unknown root cause), the employed/onlooker/scout
split ensures systematic coverage while concentrating resources on promising leads.

---

## 5. Ebbinghaus Forgetting Curve

### Biological Source

Hermann Ebbinghaus (1885) experimentally demonstrated that human memory retention decays
exponentially with time, modulated by the meaningfulness of the material. His original
formula, R = e^(-t/S) where S is memory stability, remains the foundation of spaced
repetition systems.

### Mathematical Formulation

```
R(t) = e^( -t / (lambda * importance) )

where:
  t          = time elapsed since encoding (milliseconds)
  lambda     = base retention half-life (default: 30 days = 2,592,000,000 ms)
  importance = subjective importance score [0, 1]
```

Retrieval scoring combines forgetting with multi-dimensional relevance:

```
score = importance * 0.4 + timeDecay * 0.2 + relevance * 0.2 + reward * 0.2

where:
  timeDecay = R(t) as defined above
```

### Source Code

`src/intelligence/memory/episodic-memory.js` -- `_calculateRetention(timestamp, importance)`,
`retrieve(query, topK)`.

### Design Decision

LLM context windows are finite. Not all past experiences deserve equal representation. The
Ebbinghaus curve provides a principled eviction policy: routine events fade naturally, while
high-importance events (failures, breakthroughs, user feedback) persist longer. This mirrors
how human experts retain critical lessons while forgetting routine details, producing more
relevant context for LLM prompts.

---

## 6. Dual-Process Theory (Kahneman)

### Biological Source

Daniel Kahneman (2011) described human cognition as operating in two modes: System 1
(fast, intuitive, automatic) and System 2 (slow, deliberate, analytical). System 1
handles familiar situations with minimal cognitive load; System 2 engages when novelty,
complexity, or risk demands careful reasoning.

### Mathematical Formulation

System 1 activation score (threshold: 0.55):

```
S1_score = w1 * vaccine_match + w2 * breaker_closed + w3 * affinity_high

Conditions for System 1 (DIRECT mode):
  - Vaccine match exists in repair_memory
  - Circuit breaker state == CLOSED (>90% recent success)
  - Task affinity score > high threshold
```

System 2 activation score (threshold: 0.50):

```
S2_score = w1 * is_new_type + w2 * breaker_half_open + w3 * alarm_density

Conditions for System 2 (PREPLAN mode):
  - Task type not seen before
  - Circuit breaker state == HALF_OPEN
  - Alarm pheromone density above threshold
  - Quality gate failure in recent history
```

### Source Code

`src/orchestration/adaptation/dual-process-router.js` -- `route(task)`, returns `{ mode: 'DIRECT' | 'PREPLAN' }`.

### Design Decision

Not every task warrants full DAG decomposition and planning overhead. Routine tasks with
known solutions should be dispatched immediately (System 1), while novel or risky tasks
deserve deliberate planning (System 2). This dual-mode approach reduces median latency by
40-60% for familiar task types while maintaining safety for unfamiliar ones.

---

## 7. Working Memory Buffers

### Biological Source

Baddeley and Hitch (1974) proposed a multi-component working memory model: a central
executive directing attention, a phonological loop for verbal information, a visuospatial
sketchpad for spatial data, and an episodic buffer for integrated episodes. Miller (1956)
established the capacity limit of 7 plus or minus 2 items.

### Mathematical Formulation

Three-buffer architecture with priority-based eviction:

```
Buffer      | Capacity | Priority Floor | Role
------------|----------|----------------|---------------------------
Focus       |    5     |      8 (p8)    | Active task, highest priority
Context     |   15     |      5 (p5)    | Recent context, medium priority
ScratchPad  |   30     |      0 (p0)    | Temporary computation space

Activation decay:
  activation(item) = baseScore * (1 / (1 + ageMs / 60000))

Eviction cascade: Focus overflow -> Context -> ScratchPad -> discard
```

When an item's activation drops below the priority floor of its current buffer, it cascades
to the next buffer. Items that fall below ScratchPad's floor (0) are discarded.

### Source Code

`src/intelligence/memory/working-memory.js` -- `push(item, priority)`, `_evict()`,
`getContext(maxTokens)`.

### Design Decision

LLM prompts have hard token limits. A flat list of recent items wastes tokens on low-value
information. The three-buffer model ensures that the most relevant items (Focus) always
appear in the prompt, contextual items fill remaining space, and scratch computations are
available but expendable. The activation decay function naturally ages out stale items
without requiring explicit cleanup.

---

## 8. Semantic Knowledge Graph

### Biological Source

Quillian (1967) proposed the semantic network model of human memory, where concepts are
nodes and relationships are directed edges. Collins and Loftus (1975) extended this with
spreading activation: accessing one concept primes related concepts, with activation
decaying over graph distance.

### Mathematical Formulation

```
Graph G = (V, E) where:
  V = set of concept nodes (each with embedding vector)
  E = set of directed edges (each with relationship type and weight)

Operations:
  BFS traversal:     reachable(source, maxDepth)
  Shortest path:     dijkstra(source, target) using edge weights
  Concept merging:   merge(a, b) when similarity(a, b) > merge_threshold
  Context generation: collect concepts within k hops, rank by relevance
```

### Source Code

`src/intelligence/memory/semantic-memory.js` -- `addConcept()`, `addRelation()`, `query(concept, depth)`,
`merge(conceptA, conceptB)`.

### Design Decision

Episodic memory captures specific events; semantic memory captures generalized knowledge.
When an agent encounters a new task, BFS traversal of the knowledge graph surfaces related
concepts that may not appear in recent episodic memory. This is analogous to how a human
expert draws on domain knowledge (semantic) rather than just past project experience
(episodic) when solving novel problems.

---

## 9. Negative Selection Algorithm

### Biological Source

Forrest et al. (1994) formalized the negative selection algorithm based on the biological
immune system's T-cell maturation process. In the thymus, T-cells that bind to self-antigens
are eliminated (negative selection), leaving only cells capable of detecting foreign
(non-self) patterns. This provides anomaly detection without requiring a model of what
anomalies look like.

### Mathematical Formulation

```
Pattern categories (detectors):
  1. error_keyword      -- regex patterns for error signatures
  2. resource_exhaust   -- memory/token/time threshold violations
  3. null_reference     -- null/undefined access patterns
  4. network_failure    -- connection/timeout/DNS patterns
  5. rate_limit         -- 429/retry-after/quota patterns

Detection:
  match(output, detector_set) -> { matched: bool, confidence: float }
  Anomaly flagged when confidence > 0.6
```

### Source Code

`src/quality/analysis/anomaly-detector.js` -- `detect(agentOutput)`, `_matchPatterns(text, category)`.

### Design Decision

Positive detection (defining what errors look like) requires constant maintenance as new
error types emerge. Negative selection inverts the problem: define normal patterns, flag
everything else. The five built-in categories cover the most common LLM agent failure modes
while the 0.6 confidence threshold balances sensitivity against false positives.

---

## 10. Failure Vaccination

### Biological Source

Jenner (1798) demonstrated that exposure to cowpox conferred immunity to smallpox, the
foundational principle of vaccination. The adaptive immune system stores memory B-cells
and T-cells that enable rapid secondary response upon re-exposure. This biological memory
converts a multi-day primary response into a hours-long secondary response.

### Mathematical Formulation

```
Error categories: { network, validation, timeout, logic }

Vaccine record:
  v = (pattern, category, repair_strategy, success_count, failure_count, created_at)

Vaccine efficacy:
  efficacy(v) = success_count / (success_count + failure_count)

Lookup: Before tool execution, query repair_memory WHERE pattern ~ current_error
  If vaccine found AND efficacy > threshold:
    Apply repair_strategy (System 1 fast path)
  Else:
    Proceed to System 2 (full deliberation)
```

### Source Code

`src/quality/resilience/failure-vaccination.js` -- `lookup(errorSignature)`, `record(pattern, strategy)`.
Storage: `repair_memory` collection in DomainStore (JSON snapshots).

### Design Decision

LLM agents encounter the same classes of errors repeatedly (API rate limits, malformed JSON,
timeout). Without vaccination, each occurrence triggers full System 2 deliberation. With
vaccination, known failure patterns are resolved in a single LLM turn using the stored repair
strategy, reducing both latency and token consumption by an order of magnitude for recurring
failures.

---

## 11. FIPA Contract-Net Protocol

### Biological Source

While not directly biological, the Contract-Net Protocol (Smith, 1980; standardized by FIPA,
2002) draws from market-based resource allocation. In biological terms, it parallels the
waggle dance of honeybees: a forager advertises a food source (CFP), other bees evaluate it
against their current state (Bid), and the colony collectively directs resources toward the
best opportunity (Award).

### Mathematical Formulation

```
Protocol phases:
  1. CFP (Call for Proposals):  Manager broadcasts task specification
  2. Bid:                       Contractors evaluate and submit proposals
  3. Award:                     Manager selects winning bid(s)
  4. Execution:                 Awarded contractor(s) execute task
  5. Report:                    Results returned to manager

Bid scoring:
  bid_score = w1 * capability_match + w2 * reputation + w3 * availability + w4 * cost

Award: argmax(bid_score) among valid bids within deadline.
```

### Source Code

`src/orchestration/scheduling/contract-net.js` -- `issueCFP(task)`, `submitBid(cfpId, proposal)`,
`awardContract(cfpId)`, `reportResult(contractId, result)`.

### Design Decision

Direct assignment (scheduler picks agent) creates a single point of failure and requires
global knowledge. Contract-Net distributes the allocation decision: agents self-select based
on their own capabilities, creating a market-like efficiency. This is essential when agent
capabilities change dynamically (new skills learned, circuit breakers tripped) because the
most current information resides with each agent.

---

## 12. Monte Carlo Shapley Value

### Biological Source

Shapley (1953) proved that the Shapley value is the unique credit attribution satisfying
efficiency, symmetry, dummy, and additivity axioms. While originating in cooperative game
theory, it has biological analogs in the fair distribution of reproductive success in
eusocial insect colonies, where individual fitness is a function of colony-level
contribution.

### Mathematical Formulation

```
Shapley value for agent i:
  phi_i(v) = (1/n!) * sum over all permutations pi of N:
    [ v(S_pi_i union {i}) - v(S_pi_i) ]

Monte Carlo approximation (m = 100 samples):
  phi_i ~= (1/m) * sum_{k=1}^{m}:
    [ v(S_k union {i}) - v(S_k) ]

  where S_k is a random coalition subset drawn uniformly.
```

The characteristic function `v(S)` measures coalition quality (e.g., task completion rate).
With 100 Monte Carlo samples per attribution cycle, computational cost is O(m * n) rather
than the O(2^n) exact computation.

### Source Code

`src/orchestration/adaptation/shapley-credit.js` -- `compute(dagResult)`, computation runs
in-process within the gateway.

### Design Decision

Simple credit schemes (equal split, proportional to effort) create perverse incentives.
Equal split discourages high performers; proportional rewards gaming (agents inflate
their effort metrics). The Shapley value is the only scheme that is provably fair under
the four axioms, and 100 Monte Carlo samples provide a sufficient approximation for
swarms up to 20 agents.

---

## 13. Lotka-Volterra Competition

### Biological Source

Lotka (1925) and Volterra (1926) independently derived the competition equations describing
two species competing for shared resources. When interspecific competition exceeds
intraspecific competition, one species drives the other to extinction (competitive
exclusion). This dynamic governs how agent species compete for task allocation slots.

### Mathematical Formulation

```
dx/dt = alpha * x * (1 - x/K) - beta * x * y

where:
  x, y   = population sizes of two competing species
  alpha  = intrinsic growth rate (birth rate - death rate)
  K      = carrying capacity (maximum sustainable population)
  beta   = interspecific competition coefficient
```

In Claw-Swarm, `x` represents the allocation frequency of a species, `K` is the active
species cap (10), and `beta` is derived from niche overlap (species with similar capability
profiles compete more intensely).

### Source Code

`src/orchestration/adaptation/species-evolver.js` -- `_lotkaVolterraStep(populations)`,
`_computeNicheOverlap(speciesA, speciesB)`.

### Design Decision

Without population dynamics, the swarm accumulates species without bound. Lotka-Volterra
provides a natural carrying capacity that automatically culls redundant species (those
whose niches overlap with more successful peers) while preserving species that fill unique
ecological roles. The active cap of 10 prevents combinatorial explosion in the contract-net
bidding phase.

---

## 14. GEP Tournament Selection

### Biological Source

Ferreira (2001) introduced Gene Expression Programming as a linear genetic representation
that maps to expression trees. Unlike GP (tree-based), GEP's fixed-length chromosomes
simplify crossover and mutation. Tournament selection (Goldberg & Deb, 1991) picks `k`
individuals randomly and selects the fittest, balancing selection pressure against
diversity.

### Mathematical Formulation

```
GEP chromosome: fixed-length string encoding species parameters
  (weights, thresholds, scheduling preferences)

Tournament selection:
  1. Draw k candidates uniformly from population
  2. Select winner = argmax(fitness(c)) for c in candidates
  3. Repeat for mating pool

Species lifecycle:
  Trial period:       30 days minimum
  Min success rate:   0.7 (70%) to graduate from trial
  Active cap:         10 species maximum
  Weight bounds:      [0.05, 1.0]
```

### Source Code

`src/orchestration/adaptation/species-evolver.js` -- `_gepTournament(population, tournamentSize)`,
`_evolveParameters(species)`.

### Design Decision

Manual tuning of agent species parameters does not scale beyond 3-4 species. GEP automates
parameter optimization with a biologically-principled search. The 30-day trial period and
70% success threshold prevent premature promotion of species that perform well by chance,
while the active cap of 10 bounds computational overhead.

---

## 15. Gossip (SWIM) Protocol

### Biological Source

Epidemic models (Kermack & McKendrick, 1927) describe how information spreads through
random contacts in a population. The SWIM protocol (Das et al., 2002) adapts this for
distributed failure detection: each node periodically pings a random subset of peers,
achieving O(log n) dissemination with bounded network overhead.

### Mathematical Formulation

```
Parameters:
  fanout         = 3 peers per heartbeat
  heartbeat      = 5 seconds
  max_state_age  = 60 seconds (stale state discarded)

Payload piggybacking:
  Memory summaries:     top 3 by importance score
  Pheromone snapshots:  top 10 by intensity

Failure detection (SWIM):
  1. Node A pings random node B
  2. If B does not respond within timeout:
     A asks k random nodes to ping B (indirect probe)
  3. If indirect probes also fail:
     B is declared suspected, then confirmed dead after grace period
```

### Source Code

`src/communication/stigmergy/gossip-protocol.js` -- `_heartbeat()`, `_onGossipReceived(payload)`,
`_swimProbe(targetId)`.

### Design Decision

Centralized heartbeat monitoring creates a single point of failure and does not scale.
Gossip achieves distributed liveness detection with constant per-node overhead (each node
sends exactly `fanout` messages per heartbeat). Piggybacking memory summaries and pheromone
snapshots on heartbeat messages eliminates the need for separate synchronization protocols,
reducing total network traffic.

---

## 16. Mutual Information Signal Calibration

### Biological Source

Shannon (1948) defined mutual information as the reduction in uncertainty of one random
variable given knowledge of another. In biological sensory systems, neurons calibrate
their sensitivity based on the statistical structure of their inputs (Barlow, 1961:
efficient coding hypothesis). The signal calibrator applies this principle to tune the
relative weights of multiple advisory signals.

### Mathematical Formulation

```
Mutual Information:
  I(X; Y) = sum_x sum_y p(x,y) * log( p(x,y) / (p(x) * p(y)) )

Weight update:
  w_i(t+1) = clamp( w_i(t) + eta * (I(signal_i; outcome) - I_baseline), 0.03, 0.40 )

where:
  w_i       = weight of advisor signal i
  eta       = learning rate
  I_baseline = running average MI across all signals
  bounds    = [0.03, 0.40] (floor prevents signal extinction, cap prevents dominance)
```

### Source Code

`src/orchestration/adaptation/signal-calibrator.js` -- `calibrate(signalHistory, outcomes)`,
extends ModuleBase. MI computation runs in-process within the gateway.

### Design Decision

Fixed advisor weights degrade as swarm composition and task distribution shift over time.
MI-based calibration automatically upweights signals that are predictive of task outcomes
and downweights noise. The [0.03, 0.40] bounds ensure that no single signal can dominate
the aggregation (preventing fragile single-signal dependency) and no signal is ever fully
silenced (preserving the ability to recover if a previously weak signal becomes informative).

---

## 17. Turing Reaction-Diffusion

### Biological Source

Alan Turing (1952) proposed that spatial patterns in biological systems (stripes on
zebrafish, spots on leopards) arise from the interaction of two chemicals: an activator that
promotes its own production and an inhibitor that suppresses the activator but diffuses
faster. The differential diffusion rates create stable spatial patterns from uniform initial
conditions.

### Mathematical Formulation

```
Signal propagation in the signal field:

Activator signals (TRAIL, RECRUIT):
  d[A]/dt = D_a * nabla^2(A) + f(A, I)
  -- slow diffusion, local amplification

Inhibitor signals (ALARM):
  d[I]/dt = D_i * nabla^2(I) + g(A, I)
  -- fast diffusion, suppresses activator

where:
  D_i > D_a  (inhibitor diffuses faster than activator)
  f(A, I) = activator reaction term (autocatalytic)
  g(A, I) = inhibitor reaction term (cross-catalytic)
```

In the discrete implementation, BFS propagation simulates diffusion, and signal intensity
at each node is updated based on local activator/inhibitor concentrations.

### Source Code

`src/core/field/signal-store.js` -- `deposit(signal)`, `_notifyModules()`,
BFS propagation with type-dependent diffusion rates.

### Design Decision

Simple broadcast flooding (all signals reach all nodes equally) creates information
overload. Reaction-diffusion creates spatial structure: recruitment signals cluster around
active work zones while alarm signals spread broadly to warn distant agents. This mirrors
how biological colonies concentrate workers near food sources while maintaining colony-wide
threat awareness.

---

## 18. 6D Emotion Vector (EMA)

### Biological Source

Plutchik (1980) proposed eight primary emotions arranged in opposing pairs. Russell (1980)
modeled affect as a continuous two-dimensional space (valence x arousal). Modern affective
computing (Picard, 1997) extends this to multi-dimensional emotional state tracking.
Claw-Swarm uses a 6-dimensional model capturing the emotional dynamics relevant to LLM
agent collaboration.

### Mathematical Formulation

```
Emotion vector E = (frustration, confidence, joy, urgency, curiosity, fatigue)

Baseline:     E_0 = (0.5, 0.5, 0.5, 0.5, 0.5, 0.5)

EMA update:
  E_i(t) = alpha * observed_i + (1 - alpha) * E_i(t-1)
  alpha  = 0.3 (smoothing factor)

Natural decay toward baseline:
  E_i(t) = E_i(t-1) + decay * (0.5 - E_i(t-1))
  decay  = 0.05
```

Each dimension is bounded in [0, 1]. The EMA (Exponential Moving Average) provides smooth
tracking that resists noise from individual interactions while remaining responsive to
sustained emotional shifts.

### Source Code

`src/intelligence/social/emotional-state.js` -- `update(agentId, observations)`,
`getState(agentId)`, `getEmotionalContext(agentId)`.

### Design Decision

LLM agents interacting with humans exhibit implicit emotional dynamics: repeated failures
increase frustration, successful collaboration builds confidence, novel tasks spark curiosity.
Tracking these dimensions allows the swarm to adapt its behavior -- e.g., routing a
frustrated agent's tasks to simpler subtasks, or increasing urgency weight when deadlines
approach. The 0.3 alpha balances responsiveness against stability.

---

## 19. Cultural Friction Model

### Biological Source

Hofstede (1980) identified cultural dimensions that predict friction in cross-cultural
collaboration: power distance, individualism, uncertainty avoidance, masculinity,
long-term orientation, and indulgence. In multi-model LLM swarms, different foundation
models exhibit distinct behavioral "cultures" (instruction following style, verbosity,
risk tolerance) that create collaboration friction analogous to cross-cultural
misunderstandings.

### Mathematical Formulation

```
Cultural friction between models A and B:
  F(A, B) = sum_d w_d * |C_d(A) - C_d(B)|

where:
  C_d(X) = cultural dimension d score for model X
  w_d    = dimension weight
  d      = { instruction_compliance, verbosity, risk_tolerance, format_consistency,
             reasoning_depth, tool_usage_pattern }

Collaboration cost adjustment:
  adjusted_cost(task, A, B) = base_cost(task) * (1 + gamma * F(A, B))
  gamma = friction amplification factor
```

### Source Code

`src/intelligence/social/cultural-friction.js` -- `estimateFriction(modelA, modelB)`,
`adjustCollaborationCost(task, team)`.

### Design Decision

Multi-model swarms (mixing different LLM providers) encounter subtle compatibility issues:
one model's output format may confuse another model's parser, or one model's risk-averse
behavior may conflict with another's exploratory tendency. The cultural friction model
quantifies these incompatibilities and feeds them into the contract-net bidding process,
naturally favoring teams of compatible models for tasks requiring tight collaboration.

---

## 20. SNA Centrality Metrics

### Biological Source

Social network analysis originates from Moreno's sociometry (1934) and was formalized
through graph-theoretic centrality measures. In biological colonies, certain individuals
serve as information brokers (betweenness centrality), highly connected hubs (degree
centrality), or prestigious influencers (eigenvector centrality). Freeman (1977) unified
these measures into the modern SNA framework.

### Mathematical Formulation

```
Degree centrality:
  C_D(v) = deg(v) / (n - 1)

Betweenness centrality:
  C_B(v) = sum_{s != v != t} ( sigma_st(v) / sigma_st )
  where sigma_st = total shortest paths from s to t
        sigma_st(v) = shortest paths through v

PageRank:
  PR(v) = (1 - d) / n + d * sum_{u in in(v)} PR(u) / out_degree(u)
  d = damping factor (default: 0.85)
```

### Source Code

`src/intelligence/social/sna-analyzer.js` -- `computeDegree()`, `computeBetweenness()`,
`computePageRank(dampingFactor, iterations)`.

### Design Decision

Flat collaboration patterns (all agents equally likely to collaborate) produce suboptimal
information flow. SNA metrics identify bottleneck agents (high betweenness) that could
become single points of failure, isolated agents (low degree) that are underutilized, and
influential agents (high PageRank) whose behavior disproportionately affects the swarm.
These metrics inform zone assignment, leader election, and gossip protocol target selection.

---

## Cross-Algorithm Interactions

The 20 algorithms do not operate in isolation. Key interaction pathways:

| Pathway | Description |
|---------|-------------|
| Pheromone (1,2) -> Response Threshold (3) | Pheromone intensity serves as the task stimulus for threshold comparison |
| Negative Selection (9) -> Vaccination (10) -> Dual-Process (6) | Detected anomalies become vaccine patterns that shift routing from System 2 to System 1 |
| ABC (4) -> Contract-Net (11) | Scout bees discover new task sources that enter the contract-net auction |
| Shapley (12) -> Reputation -> Threshold (3) | Fair credit updates reputation scores which modulate response thresholds |
| Lotka-Volterra (13) + GEP (14) | Population dynamics determine which species survive; GEP optimizes surviving species parameters |
| Gossip (15) -> SNA (20) | Gossip communication patterns form the social network graph analyzed by SNA |
| Reaction-Diffusion (17) -> Signal Calibration (16) | Signal field propagation produces the raw signal data that MI calibration tunes |
| Emotion (18) + Cultural Friction (19) | Emotional state influences cultural friction thresholds (frustrated agents have lower friction tolerance) |
| Working Memory (7) + Episodic (5) + Semantic (8) | Three memory systems provide layered context: immediate, experiential, and conceptual |

---

## References

- Bonabeau, E. et al. (1998). Fixed response thresholds and the regulation of division of labor in insect societies.
- Collins, A. M. & Loftus, E. F. (1975). A spreading-activation theory of semantic processing.
- Das, A. et al. (2002). SWIM: Scalable Weakly-consistent Infection-style Process Group Membership Protocol.
- Dorigo, M. & Gambardella, L. M. (1997). Ant Colony System: A cooperative learning approach to the TSP.
- Ebbinghaus, H. (1885). Memory: A Contribution to Experimental Psychology.
- Ferreira, C. (2001). Gene Expression Programming: A new adaptive algorithm for solving problems.
- Forrest, S. et al. (1994). Self-nonself discrimination in a computer.
- Freeman, L. C. (1977). A set of measures of centrality based on betweenness.
- Hofstede, G. (1980). Culture's Consequences: International Differences in Work-Related Values.
- Kahneman, D. (2011). Thinking, Fast and Slow.
- Karaboga, D. (2005). An Idea Based on Honey Bee Swarm for Numerical Optimization.
- Lotka, A. J. (1925). Elements of Physical Biology.
- Picard, R. W. (1997). Affective Computing.
- Plutchik, R. (1980). Emotion: A Psychoevolutionary Synthesis.
- Quillian, M. R. (1967). Word concepts: A theory and simulation of some basic semantic capabilities.
- Shannon, C. E. (1948). A mathematical theory of communication.
- Shapley, L. S. (1953). A value for n-person games.
- Smith, R. G. (1980). The Contract Net Protocol: High-level communication and control in a distributed problem solver.
- Stutzle, T. & Hoos, H. H. (2000). MAX-MIN Ant System.
- Turing, A. M. (1952). The chemical basis of morphogenesis.
- Volterra, V. (1926). Variazioni e fluttuazioni del numero d'individui in specie animali conviventi.

---

[← Back to README](../../README.md) | [中文版](../zh-CN/biomimicry.md)
