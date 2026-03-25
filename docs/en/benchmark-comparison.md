# Multi-Agent Framework Benchmark Comparison

## Claw-Swarm V9.2 vs Community Frameworks

### Our Benchmark Results (2026-03-25)

| Task | Time | Agents | DAG Nodes | Signal Field | Output Quality |
|------|------|--------|-----------|-------------|----------------|
| Content production (AI analysis article, ~3000 words) | 5 min 4s | 2 | 1→3 (fixed) | 44 signals alive | Real data, proper formatting, bilingual |
| Coding task (bug_fix pipeline) | TBD | TBD | 3 (diagnose→fix→test) | TBD | TBD |

### Framework Comparison

| Framework | Architecture | SWE-bench Lite | Content Task | Token Cost | Agent Count |
|-----------|-------------|----------------|--------------|------------|-------------|
| **Claw-Swarm V9.2** | 12D signal field + DAG + biomimicry | N/A (not evaluated) | ~5 min | ~10K tokens | 2-5 adaptive |
| **CrewAI** | Role-based sequential/hierarchical | N/A | 30-120s (simple) | 10K-50K | 2-6 fixed |
| **AutoGen** | Conversational group chat | N/A | Variable | 50K-200K | 2-6 |
| **MetaGPT** | Software company SOP simulation | ~26% | N/A | $2-5/project | 4-6 fixed |
| **Frontier single-agent** | Direct LLM | ~49% | 30-60s | 3K-10K | 1 |
| **OpenHands** | Code agent with tool use | ~25-29% | N/A | Variable | 1 |

### Key Differentiators

#### What Claw-Swarm Does Differently

1. **Signal Field Intelligence**: 12-dimensional forward-decay signal field enables agents to perceive environmental state without direct communication. No other framework has this.

2. **Adaptive Routing**: DualProcessRouter (System 1/2) automatically routes simple tasks to fast path and complex tasks to full DAG pipeline. CrewAI/AutoGen always use the same pipeline regardless of complexity.

3. **Biomimicry Algorithms**: 20 algorithms from entomology (pheromone trails), immunology (failure vaccination), game theory (contract-net), ecology (species evolution). Unique to Claw-Swarm.

4. **Zero Hardcoded Limits**: Unlike OpenClaw defaults (5 turns, 2 layers, 5 agents), Claw-Swarm removes all artificial caps. Limits are field-driven and adaptive.

5. **Parallel DAG Branches**: Templates support fork+merge patterns (e.g., new_feature: research → plan → [backend, frontend] → review). CrewAI only supports sequential or simple hierarchical.

6. **Real-time Transparency**: Console with 3D visualization, event feed, pheromone heatmap, DAG progress. Most frameworks are CLI-only.

### Where Others Excel

1. **CrewAI**: Simpler setup, lower learning curve, good for straightforward workflows
2. **AutoGen**: Better for interactive human-in-the-loop scenarios with flexible chat topologies
3. **MetaGPT**: More structured SOP for software development with role-specific document outputs
4. **Frontier single-agent**: Higher SWE-bench scores — multi-agent overhead sometimes hurts more than helps on well-defined coding tasks

### Industry Observation

> **No standardized multi-agent benchmark exists.** SWE-bench is the closest for coding, but tests single-agent resolution. GAIA tests tool-use. Neither measures multi-agent collaboration quality, coordination efficiency, or adaptive behavior — areas where Claw-Swarm's signal field approach provides unique value.

### Recommended Evaluation Dimensions

For fair comparison, multi-agent systems should be evaluated on:

1. **Task completion time** (wall clock)
2. **Token efficiency** (tokens per quality-unit of output)
3. **Adaptation** (performance improvement across repeated similar tasks)
4. **Fault tolerance** (graceful degradation when agents fail)
5. **Transparency** (operator visibility into agent reasoning)
6. **Scalability** (performance vs. agent count curve)

Claw-Swarm V9.2 is designed to excel on dimensions 3-6 where traditional frameworks have no comparable features.
