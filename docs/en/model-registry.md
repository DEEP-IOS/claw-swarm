# Model Capability Registry

Claw-Swarm V9.0 maintains an 8-dimensional capability profile for 35+ LLM models, enabling Mixture-of-Experts (MoE) routing that matches task requirements to model strengths in real time.

**Source:** `src/intelligence/identity/model-capability.js`

## Design Rationale

Not all LLM models are equal. A model that excels at code generation may underperform at architectural reasoning. A fast, cheap model may be perfect for documentation but inadequate for security analysis. Traditional multi-agent systems either hard-code a single model or leave selection to the user — neither scales.

The Model Capability Registry solves this by profiling every model across 8 orthogonal dimensions, computing composite scores from published benchmarks, and continuously recalibrating scores based on observed task outcomes via EMA (Exponential Moving Average).

## 8D Capability Dimensions

Each model is scored on 8 dimensions, each derived from a weighted combination of established benchmarks:

### 1. Coding

Measures code generation, completion, and bug-fixing ability.

```
coding = 0.25 × HumanEval + 0.35 × SWE-bench + 0.25 × LiveCodeBench + 0.15 × MATH-500
```

### 2. Architecture

Measures system design, reasoning about complex structures, and abstract problem-solving.

```
architecture = 0.35 × GPQA-Diamond + 0.30 × MATH-500 + 0.20 × MMLU-Pro + 0.15 × MMLU
```

### 3. Testing

Measures test generation, bug reproduction, and quality assurance capabilities.

```
testing = 0.45 × SWE-bench + 0.25 × LiveCodeBench + 0.15 × HumanEval + 0.15 × IFEval
```

### 4. Documentation

Measures instruction following, clear communication, and knowledge breadth.

```
documentation = 0.40 × IFEval + 0.25 × Arena-Hard + 0.20 × MMLU + 0.15 × MMLU-Pro
```

### 5. Security

Measures safety awareness, hallucination resistance, and consistent behavior.

```
security = 0.30 × IFEval + 0.25 × MMLU-Pro + 0.25 × hallucination⁻¹ + 0.20 × consistency
```

### 6. Performance

Measures cost efficiency, speed, and context utilization.

```
performance = normalize(cost⁻¹) + normalize(speed) + normalize(contextEfficiency)
```

### 7. Communication

Measures conversational quality, persuasion, and human preference alignment.

```
communication = 0.40 × Arena-Hard + 0.30 × IFEval + 0.15 × MMLU + 0.15 × ELO
```

### 8. Domain

Measures specialized knowledge across academic and professional domains.

```
domain = 0.30 × MMLU + 0.25 × MMLU-Pro + 0.20 × C-Eval/CMMLU + 0.15 × GPQA + 0.10 × specialized
```

## Built-in Model Profiles

The registry ships with 35+ pre-computed profiles. Selected examples:

| Model | Coding | Architecture | Testing | Documentation | Security | Performance | Communication | Domain |
|-------|--------|-------------|---------|--------------|----------|-------------|---------------|--------|
| claude-opus-4-6 | 0.92 | 0.95 | 0.90 | 0.93 | 0.94 | 0.60 | 0.95 | 0.93 |
| claude-sonnet-4-6 | 0.88 | 0.88 | 0.86 | 0.90 | 0.90 | 0.75 | 0.90 | 0.88 |
| gpt-4.1 | 0.87 | 0.85 | 0.85 | 0.88 | 0.86 | 0.70 | 0.88 | 0.86 |
| gpt-4o | 0.84 | 0.83 | 0.82 | 0.86 | 0.84 | 0.78 | 0.87 | 0.84 |
| gemini-2.5-pro | 0.86 | 0.84 | 0.83 | 0.85 | 0.83 | 0.72 | 0.84 | 0.85 |
| deepseek-r1 | 0.82 | 0.80 | 0.78 | 0.75 | 0.76 | 0.85 | 0.72 | 0.80 |
| claude-haiku-4-5 | 0.75 | 0.72 | 0.73 | 0.78 | 0.80 | 0.92 | 0.78 | 0.74 |

*Scores are normalized to [0, 1]. Full list in source file.*

## MoE Routing

When `swarm_run` plans task execution, the MoE router:

1. **Infer task requirements** — `llmAnalyzeTask()` calls a cheap LLM to analyze the goal and produce an 8D requirement vector. Fallback: keyword-based `inferRequirements()`.

2. **Compute similarity** — Dot-product between the task's 8D requirement vector and each model's 8D capability vector.

3. **Select model** — Highest dot-product score wins. Ties broken by performance dimension (prefer cheaper/faster).

4. **Assign to sub-agent** — Each phase in the execution plan can use a different model optimized for that phase's requirements.

```
taskVector = [coding: 0.9, architecture: 0.3, testing: 0.8, ...]
modelScore = Σ(taskVector[d] × modelCapability[d]) for d in dimensions
selectedModel = argmax(modelScore)
```

## EMA Recalibration

Model scores are not static. After each task completion, the system observes:
- Did the task succeed?
- What was the quality score?
- How long did it take?

These observations update the model's capability scores via Exponential Moving Average:

```
newScore[d] = α × observedScore[d] + (1 - α) × oldScore[d]
```

Where α = 0.3 (default). This means recent observations carry 30% weight, while historical scores carry 70%. Models that consistently underperform in a dimension will see their score decay; models that exceed expectations will see scores rise.

## ModuleBase Integration

`ModelCapabilityRegistry` extends `ModuleBase` with:
- **Address:** `/engine/model-registry`
- **Receptor:** `model_update` — triggers recalculation when benchmark data or EMA observations arrive
- **Effector:** `model_scores_updated` — notifies downstream systems when capability profiles change

## Configuration

The registry requires no configuration. All 35+ model profiles are built-in. Custom models are auto-profiled based on the closest matching built-in model family.

Optional overrides in `openclaw.json`:
```json
{
  "modelRegistry": {
    "emaAlpha": 0.3,
    "minSamples": 5
  }
}
```

---
[← Back to README](../../README.md) | [中文版](../zh-CN/model-registry.md)
