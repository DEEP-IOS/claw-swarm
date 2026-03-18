# Emotional Intelligence

Claw-Swarm V9.0 introduces a 6-dimensional emotional awareness layer that tracks agent affective state in real time. This enables adaptive workload management, conflict-sensitive routing, and early detection of systemic problems through emotional signal patterns.

## Design Rationale

LLM agents don't have feelings. But they do have observable behavioral patterns that mirror emotional states: repeated failures create a state functionally equivalent to frustration; consistent success creates confidence; novel territory triggers exploration patterns similar to curiosity.

By modeling these patterns as continuous emotional dimensions, Claw-Swarm can:
- Reduce task complexity for "frustrated" agents before they cascade-fail
- Enable fast-path routing for "confident" agents with proven track records
- Leverage positive momentum when "joy" is elevated
- Prioritize time-sensitive tasks when "urgency" rises
- Encourage exploration when "curiosity" is high
- Reduce workload when "fatigue" accumulates

## 6D Emotion Vector

Each agent maintains a 6-dimensional emotion vector tracked via Exponential Moving Average (EMA):

| Dimension | Range | Signal Subtype | Baseline | Trigger |
|-----------|-------|---------------|----------|---------|
| **Frustration** | [0, 1] | FRUSTRATION | 0.5 | Repeated failures, timeout errors, quality gate rejections |
| **Confidence** | [0, 1] | CONFIDENCE | 0.5 | Successful task completions, high quality scores |
| **Joy** | [0, 1] | JOY | 0.5 | Positive task outcomes, user satisfaction signals |
| **Urgency** | [0, 1] | URGENCY | 0.5 | Approaching deadlines, queue depth, priority escalation |
| **Curiosity** | [0, 1] | CURIOSITY | 0.5 | Novel task types, unexplored domains |
| **Fatigue** | [0, 1] | FATIGUE | 0.5 | Sustained high workload, long execution chains |

**Source:** `src/intelligence/social/emotional-state.js`

## EMA Smoothing

Emotion values update via Exponential Moving Average to prevent volatility:

```
newValue = α × observedValue + (1 - α) × currentValue
```

Where:
- **α = 0.3** (default) — Recent observations carry 30% weight
- **Baseline = 0.5** (neutral) — All dimensions start at midpoint
- **Decay rate = 0.05/turn** — Unused dimensions drift toward baseline
- **Max history = 200** events per agent

This means a single event shifts the emotion by at most 30% of the gap between current and observed values. Sustained patterns compound; isolated spikes are dampened.

## Impact on Routing

The emotional state vector feeds into multiple decision points:

### Frustration → Task Complexity Reduction

When frustration > 0.7:
- `dual-process-router.js` shifts toward System 2 (careful deliberation)
- Task DAG engine may decompose the next task into smaller subtasks
- Quality gate thresholds are lowered to prevent rejection spirals

### Confidence → Fast-Path Routing

When confidence > 0.8:
- `dual-process-router.js` enables System 1 (fast path) for familiar tasks
- Verification steps may be reduced for proven agent-task combinations
- Agent becomes eligible for higher-complexity assignments

### Joy → Positive Momentum

When joy > 0.7:
- Agent receives higher-complexity tasks to leverage positive momentum
- Collaboration assignments increase (high-joy agents improve team morale)
- Success streak bonuses amplify Shapley credit attribution

### Urgency → Priority Escalation

When urgency > 0.7:
- Task queue reordering prioritizes time-sensitive items
- System 1 fast-path routing is preferred to minimize latency
- Parallel execution paths may be activated for critical tasks

### Curiosity → Exploration Allowance

When curiosity > 0.6:
- ABC scheduler may assign the agent as a scout (5% exploration role)
- Novel task types are offered before falling back to routine assignments
- Learning rate (EMA α) may be temporarily increased

### Fatigue → Workload Reduction

When fatigue > 0.7:
- Maximum concurrent sub-agents is reduced for the agent
- Task complexity ceiling is lowered
- Recovery periods are scheduled between task assignments

## Signal Integration

Emotional states are communicated through the Signal-Mesh as EMOTIONAL signal type:

```javascript
field.deposit(createSignal({
  type: SignalType.EMOTIONAL,
  subtype: SignalSubtype.FRUSTRATION,
  source: { kind: SourceKind.WORKER, id: agentId },
  origin: `/agent/${agentId}`,
  intensity: 0.8,
  payload: { agentId, dimension: 'frustration', value: 0.82, trigger: 'quality_gate_rejection' }
}))
```

Any ModuleBase with an EMOTIONAL receptor can react to emotional signals — enabling swarm-wide empathy where engines adjust behavior based on the collective emotional state.

## Cultural Friction

**Source:** `src/intelligence/social/cultural-friction.js`

When agents using different LLM models collaborate, "cultural" differences create friction:
- Output format mismatches (structured vs. narrative)
- Reasoning style differences (step-by-step vs. holistic)
- Communication verbosity (concise vs. detailed)
- Error handling approaches (explicit vs. implicit)

The cultural friction model quantifies this cost and informs the task assignment process. When high friction is detected between two model types, the system prefers assigning agents from the same "culture" to tightly coupled tasks, or inserting translation layers for cross-cultural collaboration.

## Sensemaking Engine

**Source:** `src/intelligence/social/self-reflection.js`

When complex multi-agent tasks produce unexpected outcomes, the sensemaking engine constructs coherent narratives:

1. **Retrospective analysis** — Reviews the sequence of signals, decisions, and outcomes
2. **Pattern extraction** — Identifies recurring emotional patterns across agents
3. **Narrative construction** — Builds an explanation of what happened and why
4. **Learning integration** — Feeds insights into episodic memory for future reference

## Bias Detection

**Source:** `src/quality/analysis/anomaly-detector.js`

Cognitive biases affect agent behavior just as they affect human decisions:
- **Anchoring bias** — Over-relying on initial information
- **Confirmation bias** — Seeking evidence that confirms existing approach
- **Availability bias** — Over-weighting recent or salient examples
- **Sunk cost fallacy** — Persisting with failing strategies due to prior investment

The bias detector monitors agent decision patterns and flags potential biases, enabling the orchestration layer to intervene before biased decisions cascade.

## Configuration

Emotional intelligence requires no configuration. All parameters have biological-inspired defaults:

```json
{
  "emotionalIntelligence": {
    "emaAlpha": 0.3,
    "baseline": 0.5,
    "decayRate": 0.05,
    "maxHistory": 200
  }
}
```

---
[← Back to README](../../README.md) | [中文版](../zh-CN/emotional-intelligence.md)
