# Signal Field Architecture

Claw-Swarm V9 replaces the V8 Signal-Mesh (5-type x 19-subtype discrete events + BFS ScopeGraph propagation) with a **12-dimensional continuous Signal Field**. Every module is immersed in a shared field; modules emit signals into specific dimensions and perceive the superposed field vector to make decisions. No module calls another directly -- all inter-module coordination is field-mediated.

This document covers the mathematical model, implementation internals, and performance characteristics of the Signal Field subsystem.

[English](../en/signal-mesh.md) | [中文版](../zh-CN/signal-mesh.md)

---

## Table of Contents

1. [V8 vs V9 Comparison](#v8-vs-v9-comparison)
2. [12 Dimensions](#12-dimensions)
3. [Forward Decay Encoding](#forward-decay-encoding)
4. [Core Components](#core-components)
5. [Signal Lifecycle](#signal-lifecycle)
6. [Field Vector Superposition](#field-vector-superposition)
7. [Sensitivity Filter](#sensitivity-filter)
8. [Garbage Collection](#garbage-collection)
9. [ModuleBase Contract](#modulebase-contract)
10. [Zero-Idle Startup Verification](#zero-idle-startup-verification)
11. [Performance Characteristics](#performance-characteristics)
12. [Testing](#testing)

---

## V8 vs V9 Comparison

| Aspect | V8 Signal-Mesh | V9 Signal Field |
|--------|---------------|-----------------|
| Signal model | 5 types x 19 subtypes (discrete) | 12 continuous dimensions |
| Propagation | ScopeGraph BFS, hop-by-hop | Scope-keyed storage, direct superposition |
| Decay | MMAS clamping [0.001, 1.0] | Forward Decay: `s * exp(-lambda * age)` |
| Base class | `MeshNode` (receptor/effector) | `ModuleBase` (produces/consumes) |
| Coupling | Address-based BFS reachability | Field-mediated: emit into dimension, perceive via superpose |
| Idle modules | 6 modules with zero subscribers | Zero idle -- startup verification enforces producer/consumer pairing |
| Storage | NativeCore (graph + store) | MemoryBackend (triple-indexed Map) |
| GC | None (signal evaporation via decay) | GCScheduler: periodic + emergency at 100K signals |

---

## 12 Dimensions

**Source:** `src/core/field/types.js` (133 lines)

Each signal belongs to exactly one of 12 dimensions. The dimension determines its semantic meaning and default decay rate.

| # | Constant | Key | Semantic | Default lambda | TTL at lambda (ms) |
|---|----------|-----|----------|------|-----|
| 1 | `DIM_TRAIL` | `trail` | Agent movement and task paths | 0.008 | ~863,000 |
| 2 | `DIM_ALARM` | `alarm` | Anomalies, errors, urgent events | 0.15 | ~46,000 |
| 3 | `DIM_REPUTATION` | `reputation` | Agent trustworthiness and performance | 0.005 | ~1,381,000 |
| 4 | `DIM_TASK` | `task` | Task publishing, progress, completion | 0.01 | ~691,000 |
| 5 | `DIM_KNOWLEDGE` | `knowledge` | Knowledge discovery, sharing, distillation | 0.003 | ~2,302,000 |
| 6 | `DIM_COORDINATION` | `coordination` | Multi-agent collaboration, sync | 0.02 | ~345,000 |
| 7 | `DIM_EMOTION` | `emotion` | Agent emotional state, stress indicators | 0.1 | ~69,000 |
| 8 | `DIM_TRUST` | `trust` | Inter-agent trust relationships | 0.006 | ~1,151,000 |
| 9 | `DIM_SNA` | `sna` | Social network analysis, centrality | 0.004 | ~1,727,000 |
| 10 | `DIM_LEARNING` | `learning` | Experience acquisition, skill growth | 0.002 | ~3,453,000 |
| 11 | `DIM_CALIBRATION` | `calibration` | System parameter calibration | 0.01 | ~691,000 |
| 12 | `DIM_SPECIES` | `species` | Species evolution, mutation, selection | 0.001 | ~6,908,000 |

**TTL formula:** `TTL = ln(1 / threshold) / lambda`, where `threshold = 0.001`

**Design rationale:** Fast-decaying dimensions (alarm: 0.15, emotion: 0.1) represent transient states that lose relevance quickly. Slow-decaying dimensions (species: 0.001, learning: 0.002) represent accumulated knowledge that persists across sessions.

---

## Forward Decay Encoding

**Source:** `src/core/field/forward-decay.js` (108 lines)

Forward Decay eliminates the need for periodic decay sweeps. Strength is encoded at emission time and decoded at query time -- no background timer required.

### Mathematical Formulas

```
Encode (on write):
  encodedScore = strength * exp(lambda * emitTime)

Decode (on read):
  decodedStrength = encodedScore * exp(-lambda * readTime)

Direct calculation (avoids intermediate overflow):
  actualStrength = strength * exp(-lambda * max(0, readTime - emitTime))

Expiry check:
  isExpired = actualStrength(s, lambda, tEmit, tRead) < threshold

TTL:
  TTL = ln(1 / threshold) / lambda
```

### Why Forward Decay?

| Approach | Write cost | Read cost | Background cost | Overflow risk |
|----------|-----------|-----------|-----------------|---------------|
| Periodic sweep | O(1) | O(1) | O(N) per interval | None |
| Lazy decay | O(1) | O(1) + exp | None | Moderate |
| **Forward Decay** | **O(1) + exp** | **O(1) + exp** | **None** | **Mitigated by direct calc** |

The `actualStrength()` function (`forward-decay.js:67`) bypasses the encode/decode pair entirely, computing `s * exp(-lambda * age)` directly. This avoids the astronomical intermediate values that `exp(lambda * emitTime)` would produce for large timestamps.

### Edge Cases (forward-decay.js:33-76)

| Case | Behavior |
|------|----------|
| `strength <= 0` | Returns 0 (no signal) |
| `lambda <= 0` | Returns clamped strength (never decays) |
| `readTime < emitTime` | Age treated as 0 (clock skew protection) |
| Result out of [0, 1] | Clamped to [0, 1] |

---

## Core Components

### SignalStore (src/core/field/signal-store.js, 382 lines)

The apex module that composes all field subsystems. Extends `ModuleBase` with `produces() = ALL_DIMENSIONS` and `consumes() = []`.

**Narrow-Waist API:**

| Method | Description | Complexity |
|--------|-------------|------------|
| `emit(partial)` | Write a new signal with Forward Decay encoding | O(1) |
| `query(filter)` | Query signals with actual strength calculation | O(N) where N = matching signals |
| `superpose(scope, dims?)` | Compute 12-dim field vector for a scope | O(N) where N = signals in scope |
| `gc()` | Manually trigger garbage collection | O(N) total signals |
| `start()` | Begin periodic GC | O(1) |
| `stop()` | Halt periodic GC | O(1) |
| `stats()` | Combined backend + GC + operation statistics | O(1) |

**Signal structure returned by `emit()`:**

```javascript
{
  id:           'abc123def456',     // nanoid(12)
  dimension:    'alarm',            // one of ALL_DIMENSIONS
  scope:        'agent-researcher-1', // scope key
  strength:     0.8,                // original strength [0, 1]
  lambda:       0.15,               // decay rate
  emitTime:     1710720000000,      // Date.now() at emission
  encodedScore: 2.34e+46,           // strength * exp(lambda * emitTime)
  emitterId:    'AnomalyDetector',  // emitter identifier
  metadata:     { errorType: 'timeout' }  // optional
}
```

**Event topics published:**

| Topic | Trigger |
|-------|---------|
| `field.signal.emitted` | After every `emit()` call |
| `field.gc.completed` | After manual `gc()` |
| `field.emergency_gc` | When signal count exceeds `maxSignals` (default: 100,000) |

### MemoryBackend (src/core/field/backends/memory.js, 215 lines)

Triple-indexed in-memory storage providing fast lookups across three access patterns:

```
Index 1: _allSignals   Map<id, Signal>              -- O(1) ID lookup
Index 2: _scopeIndex   Map<scope, Map<id, Signal>>  -- O(1) scope filter
Index 3: _dimIndex     Map<dimension, Set<id>>       -- O(1) dimension filter
```

**Query strategy (scan method, memory.js:65-131):**

| Filter combination | Strategy | Complexity |
|-------------------|----------|------------|
| `scope + dimension` | Intersect scope map with dimension set | O(min(S, D)) |
| `scope` only | Direct scope map values | O(S) |
| `dimension` only | Dimension set to signal lookup | O(D) |
| No filter | Full scan of `_allSignals` | O(N) |

Secondary filters (emitterId, maxAge) and sorting (strength, emitTime) are applied after index-accelerated selection.

### FieldVector (src/core/field/field-vector.js, 178 lines)

12-dimensional vector operations for signal superposition and perception.

**Core functions:**

| Function | Signature | Description |
|----------|-----------|-------------|
| `superpose` | `(signals, dims?, readTime?) -> FieldVector` | Sum actual strengths per dimension, clamp [0, 1] |
| `applyFilter` | `(rawVector, sensitivity) -> FieldVector` | Multiply per-dimension by sensitivity coefficient |
| `applyCalibration` | `(rawVector, weights) -> FieldVector` | Multiply per-dimension by calibration weight |
| `magnitude` | `(vector) -> number` | L2 norm of the 12-dim vector |
| `dominant` | `(vector) -> { dimension, strength }` | Find the strongest dimension |
| `diff` | `(v1, v2) -> FieldVector` | Per-dimension subtraction |
| `normalize` | `(vector) -> FieldVector` | Unit vector (L2 norm = 1) |

### GCScheduler (src/core/field/gc-scheduler.js, 156 lines)

Time-based garbage collection that avoids stop-the-world pauses.

| Mode | Interval | Trigger | Behavior |
|------|----------|---------|----------|
| Periodic | 60s (configurable) | Timer | Scan all signals, remove those below expiry threshold |
| Emergency | On emit | Signal count > `maxSignals` | Regular GC + remove oldest 10% if still over limit |

**Emergency GC flow (gc-scheduler.js:109-138):**

```
emit() detects count > 100,000
  -> runEmergencyGC(now)
    -> Step 1: runGC(now) -- remove expired signals
    -> Step 2: if still > maxSignals
       -> scan all signals sorted by emitTime ascending
       -> remove oldest 10%
    -> publish FIELD_EMERGENCY_GC event
```

---

## Signal Lifecycle

```
                    ┌─────────────────────────────────────────────────┐
                    │               Signal Lifecycle                   │
                    │                                                  │
   Module A         │  ┌──────┐    ┌───────────┐    ┌─────────────┐  │  Module B
   (producer)       │  │ emit │───>│ Backend   │───>│ superpose() │  │  (consumer)
        │           │  │      │    │ put()     │    │ per scope   │  │       │
        │           │  │ O(1) │    │ 3-index   │    │ O(N)        │  │       │
        ▼           │  └──┬───┘    │ storage   │    └──────┬──────┘  │       ▼
   field.emit({     │     │        └─────┬─────┘           │         │  perceived =
     dimension,     │     │              │                  │         │  applyFilter(
     scope,         │     │         ┌────▼────┐      ┌─────▼──────┐  │    raw, sens)
     strength,      │     │         │   GC    │      │ FieldVector│  │
     ...            │     │         │ Sweep   │      │ 12-dim     │  │
   })               │     │         │ (periodic│      │ clamped    │  │
                    │     │         │  + emerg)│      │ [0, 1]     │  │
                    │     │         └─────────┘      └────────────┘  │
                    │     │                                          │
                    │     ▼                                          │
                    │  EventBus                                      │
                    │  field.signal.emitted                          │
                    └─────────────────────────────────────────────────┘

  Time axis:
  ───────────────────────────────────────────────────────────────────>
  t=emit         strength = s             (fresh signal)
  t=emit+dt      strength = s * e^(-lambda*dt)  (decaying)
  t=TTL          strength < 0.001         (expired, GC removes)
```

---

## Field Vector Superposition

When a module needs to perceive the state of the field, it calls `superpose(scope)` which returns a 12-dimensional vector:

```javascript
// SignalStore.superpose() (signal-store.js:287-290)
superpose(scope, dimensions = ALL_DIMENSIONS) {
  const signals = this._backend.scan({ scope })
  return computeSuperpose(signals, dimensions, Date.now())
}
```

The superposition sums the actual (decayed) strengths of all signals in the given scope per dimension, clamped to [0, 1]:

```
For each dimension d in dimensions:
  vector[d] = clamp( SUM( actualStrength(s_i) for s_i where s_i.dimension == d ), 0, 1 )
```

**Example:** An agent scope with 3 active signals:

| Signal | Dimension | Original Strength | Age (ms) | lambda | Actual Strength |
|--------|-----------|-------------------|----------|--------|-----------------|
| sig-1 | trail | 0.8 | 10000 | 0.008 | 0.738 |
| sig-2 | alarm | 0.7 | 5000 | 0.15 | 0.331 |
| sig-3 | trail | 0.5 | 20000 | 0.008 | 0.426 |

Superposed vector (partial): `{ trail: 1.0 (clamped from 1.164), alarm: 0.331, ... }`

---

## Sensitivity Filter

**Source:** `src/intelligence/identity/sensitivity-filter.js` (118 lines)

Different roles perceive the same field differently. A `researcher` role is highly sensitive to `knowledge` signals but less sensitive to `alarm` signals. An `implementer` is the opposite.

```
perceived[dim] = raw[dim] * sensitivity[dim]
```

**SensitivityFilter API:**

| Method | Description |
|--------|-------------|
| `applyFilter(rawVector, roleId)` | Apply role sensitivity to a raw 12-dim vector |
| `perceive(scope, roleId)` | Superpose + filter in one call |
| `comparePerceptions(scope, roleIds)` | Compare how different roles perceive the same scope |

**Example sensitivity profiles:**

| Dimension | researcher | implementer | debugger |
|-----------|-----------|-------------|----------|
| trail | 0.3 | 0.8 | 0.5 |
| alarm | 0.2 | 0.6 | 0.95 |
| knowledge | 0.95 | 0.4 | 0.3 |
| task | 0.5 | 0.9 | 0.7 |
| emotion | 0.4 | 0.3 | 0.8 |

When SpeciesEvolver writes evolved sensitivity profiles to `DIM_SPECIES`, RoleRegistry picks them up -- making sensitivity a living, evolved property rather than static configuration.

---

## Garbage Collection

### Two-Tier Strategy

**Tier 1 -- Periodic GC (gc-scheduler.js:73-100):**

```
Every 60 seconds (configurable via gcIntervalMs):
  1. Scan all signals from backend
  2. For each signal, compute actualStrength(now)
  3. If actualStrength < threshold (0.001) -> mark as expired
  4. Batch remove all expired signal IDs from backend
  5. Return { removed, remaining, durationMs }
```

**Tier 2 -- Emergency GC (gc-scheduler.js:109-138):**

```
Triggered when backend.count() > maxSignals (100,000):
  1. Run Tier 1 (periodic GC)
  2. If remaining > maxSignals:
     a. Scan all signals sorted by emitTime ascending
     b. Select oldest 10% (ceil)
     c. Batch remove
  3. Return { removed, remaining, durationMs, emergency: true }
```

### GC Statistics (gc-scheduler.js:147-155)

| Metric | Description |
|--------|-------------|
| `lastGCTime` | Timestamp of last GC run |
| `lastRemoved` | Signals removed in last run |
| `totalRemoved` | Cumulative signals removed |
| `runs` | Total GC cycles executed |
| `emergencyRuns` | Emergency GC cycles executed |

---

## ModuleBase Contract

**Source:** `src/core/module-base.js` (59 lines)

Every V9 module extends `ModuleBase` and declares its signal field interface:

```javascript
class ModuleBase {
  static produces()   { return [] }  // DIM_* dimensions emitted
  static consumes()   { return [] }  // DIM_* dimensions read
  static publishes()  { return [] }  // EventBus topics published
  static subscribes() { return [] }  // EventBus topics subscribed
  async start() {}
  async stop() {}
}
```

**Examples from actual modules:**

| Module | produces() | consumes() |
|--------|-----------|------------|
| SignalStore | ALL_DIMENSIONS (12) | [] |
| SensitivityFilter | [] | ALL_DIMENSIONS (12) |
| EmotionalState | [DIM_EMOTION] | [DIM_ALARM, DIM_REPUTATION] |
| SpawnAdvisor | [DIM_TASK, DIM_COORDINATION] | [DIM_TRAIL, DIM_ALARM, ..., DIM_SPECIES] (11 dims) |
| SNAAnalyzer | [DIM_SNA] | [DIM_TRAIL, DIM_COORDINATION] |
| SpeciesEvolver | [DIM_SPECIES] | [DIM_REPUTATION, DIM_LEARNING] |
| SignalCalibrator | [DIM_CALIBRATION] | [DIM_TRAIL, DIM_ALARM, ...] |

---

## Zero-Idle Startup Verification

At startup, `swarm-core.js` collects all `produces()` and `consumes()` declarations across every module and verifies two invariants:

```
Invariant 1: For every dimension D with a producer, D must have at least one consumer.
  Violation -> Error: "Idle detection: D produced by [X] but has no consumer"

Invariant 2: For every dimension D with a consumer, D must have at least one producer.
  Violation -> Error: "Broken wire: D consumed by [Y] but has no producer"
```

If either invariant fails, the system refuses to start. This is the architectural guarantee that V9 has zero idle modules -- enforced at runtime, not by documentation.

---

## Performance Characteristics

| Operation | Complexity | Source |
|-----------|-----------|--------|
| `emit()` | O(1) amortized | signal-store.js:139-220 |
| `query()` (indexed) | O(S) or O(D) | signal-store.js:236-273 via memory.js:65-131 |
| `query()` (full scan) | O(N) | memory.js:97-98 |
| `superpose()` | O(N) where N = signals in scope | signal-store.js:287-290, field-vector.js:48-63 |
| `gc()` periodic | O(N) total signals | gc-scheduler.js:73-100 |
| `gc()` emergency | O(N) + O(N log N) sort | gc-scheduler.js:109-138 |
| Backend `put()` | O(1) | memory.js:35-56 |
| Backend `remove()` | O(K) where K = IDs to remove | memory.js:140-172 |
| Backend `count()` | O(1) | memory.js:179-181 |

### Memory Estimates

| Metric | Estimate |
|--------|----------|
| Per signal | ~300 bytes (object + 3 index references) |
| 10,000 signals | ~3 MB |
| 100,000 signals (max before emergency GC) | ~30 MB |
| Scope index overhead | ~64 bytes per unique scope |
| Dimension index overhead | ~64 bytes per dimension (fixed at 12) |

### Comparison with V8

| Metric | V8 | V9 |
|--------|-----|-----|
| Signal deposit | O(V + E) BFS | O(1) emit |
| Receptor matching | O(R) per MeshNode per signal | N/A (query-time superposition) |
| Storage lookup | NativeCore index O(1) | Triple-index O(1) |
| Idle module rate | ~87% (6/11 MeshNodes had zero consumers) | 0% (enforced at startup) |

---

## Testing

### Test Files

| Test File | Coverage Target |
|-----------|----------------|
| `test/core/field/forward-decay.test.js` | Mathematical correctness, edge cases, TTL calculation |
| `test/core/field/field-vector.test.js` | Superpose, applyFilter, applyCalibration, magnitude, dominant, diff, normalize |
| `test/core/field/gc-scheduler.test.js` | Expiry cleanup, emergency threshold, stats accumulation, start/stop |
| `test/core/field/backends/memory.test.js` | Triple-index put/scan/remove, index strategy selection |
| `test/core/field/signal-store.test.js` | Full emit/query/superpose flow, invalid dimension rejection, scope isolation, emergency GC |
| `test/intelligence/identity/sensitivity-filter.test.js` | Per-role filtering, perceive(), comparePerceptions() |

### Key Test Scenarios

| Scenario | Validates |
|----------|-----------|
| 12-dimension superpose completeness | All 12 dimensions correctly summed and clamped |
| Forward Decay with lambda=0 | Signal never decays (returns original strength) |
| Clock skew (readTime < emitTime) | Age treated as 0, no negative decay |
| Emergency GC at 100K+ | Oldest 10% removed after regular GC |
| Scope isolation | Signals in scope A invisible to superpose(scope B) |
| Sensitivity filter with all-zero sensitivity | Perceived vector is all zeros |
| Concurrent emit during GC | No data corruption or lost signals |

---

[<- Back to README](../../README.md) | [中文版](../zh-CN/signal-mesh.md)
