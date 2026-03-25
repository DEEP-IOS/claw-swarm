# FAQ & Troubleshooting

> Claw-Swarm V9.2.0 — Frequently asked questions and common issue resolution

[← Back to README](../../README.md) | [中文版](../zh-CN/faq-troubleshooting.md)

---

## Frequently Asked Questions

### What is Claw-Swarm?

Claw-Swarm is an OpenClaw plugin that enables multi-agent collaboration through bio-inspired swarm intelligence. It coordinates LLM agents using biological algorithms — pheromone trails (ant colony optimization), bee colony scheduling (ABC), immune-system anomaly detection, and Lotka-Volterra population dynamics — rather than centralized control. The system operates as a single-process in-gateway architecture with 7 domains, 121 source files, and 1,697 tests. See [Biomimicry & Design Philosophy](biomimicry.md) for the design rationale.

### How does the signal field architecture differ from traditional event systems?

Traditional event systems use flat pub/sub: publishers emit events to named channels, and all subscribers on that channel receive the message regardless of context. The V9.2 12-dimensional signal field architecture introduces three key differences:

1. **Field-mediated coupling:** Modules interact exclusively through the SignalStore. Each `ModuleBase` subclass (~110 modules) declares `produces` and `consumes` signal dimensions, creating automatic coupling without explicit wiring.
2. **Typed receptors with thresholds:** Each module declares typed receptors that only fire when signal intensity exceeds a configurable threshold. This prevents noise from triggering expensive downstream computation.
3. **12-dimensional signal space:** Signals are characterized across 12 orthogonal dimensions, enabling fine-grained filtering and routing without hierarchical scope graphs.

### What models are supported?

Claw-Swarm ships with 35+ built-in model profiles, each characterized by an 8-dimensional capability vector. Supported models include frontier models (claude-opus-4-6, claude-sonnet-4-6, gpt-4o, gpt-4.1, gemini-2.5-pro), reasoning specialists (deepseek-r1), and general models (deepseek-chat, qwen3.5-max, kimi-k2.5, glm-5, minimax-m2.5, among others). Any OpenClaw-compatible model can be used; unknown models receive a fallback profile with a 10% assumed failure rate.

### How does MoE routing work?

Mixture-of-Experts routing uses 8-dimensional dot-product matching. Each task is characterized by an 8D demand vector (coding, architecture, testing, docs, security, performance, communication, domain). Each model has an 8D capability profile. The dual-process router computes the dot product between the task demand and each available model's capability vector, then selects the model with the highest match score. System 1 (fast path) handles routine tasks with cached routing decisions; System 2 (slow path) performs full capability matching for novel or complex tasks.

### Can I run Claw-Swarm without OpenClaw?

Five of the 7 domains (core, communication, intelligence, orchestration, quality) are designed as reusable modules with no direct OpenClaw dependency. The bridge domain contains the plugin hooks, tool definitions, and gateway integration that require OpenClaw. The observe domain can operate standalone for visualization. If you want to embed the swarm engine in a different host, you can import the five core domains directly and provide your own bridge layer.

### How does memory survive LLM context resets?

Claw-Swarm uses a 3-tier memory architecture:

1. **Working memory** (in-process) — Focus buffer (5 items), context buffer (15 items), and scratch pad (30 items). Lost on process restart.
2. **Episodic memory** (DomainStore) — Persisted event records with timestamps and agent associations as JSON snapshots. Survives restarts. Decay governed by configurable half-life.
3. **Semantic memory** (DomainStore + vector index) — Embedded knowledge fragments indexed by HNSW vector search. Survives restarts. Used for retrieval-augmented context injection.

When a new agent session starts, the `before_agent_start` hook injects relevant episodic and semantic memories into the system prompt, effectively restoring knowledge across context resets.

### What is the performance overhead?

Hook execution is tiered by latency budget:

| Tier   | Target Latency | Examples                                           |
|--------|---------------|----------------------------------------------------|
| Tier A | < 0.1 ms      | `before_model_resolve`, module coupling validation  |
| Tier B | 2-5 ms        | `before_agent_start` (prompt injection), `llm_output` (compliance scan) |
| Tier C | Async          | Pheromone decay, SNA recomputation, species evolution |

The single-process in-gateway architecture means all computation runs within the gateway process. CPU-intensive operations (embedding, vector search, Shapley credit) use async scheduling to avoid blocking request handling.

### How do emotional states affect routing?

The global modulator maintains a 6-dimensional emotional state vector (updated via exponential moving average) that influences agent behavior:

- **Workload adjustment:** High stress or fatigue signals reduce the maximum concurrent sub-agents allowed, preventing overcommitment.
- **Conflict sensitivity:** Elevated conflict signals increase the threshold for System 2 routing, forcing more deliberate decision-making during contentious tasks.
- **Exploration vs exploitation:** Curiosity and confidence signals adjust the ACO (Ant Colony Optimization) exploration-exploitation balance. High curiosity increases pheromone randomness; high confidence strengthens existing trails.

Emotional states are derived from swarm-level metrics (error rates, task duration, queue depth) rather than sentiment analysis of text content.

---

## Troubleshooting

### Plugin not loading

**Symptom:** `openclaw gateway status` does not list `claw-swarm`, or shows it as disabled.

**Fix:**

1. Verify that `~/.openclaw/openclaw.json` contains a `claw-swarm` entry under `plugins.entries`:
   ```bash
   cat ~/.openclaw/openclaw.json | grep claw-swarm
   ```
2. Ensure the plugin path points to a valid directory containing `openclaw.plugin.json`.
3. Restart the gateway:
   ```bash
   openclaw gateway stop
   openclaw gateway start
   ```
4. Check gateway startup logs for plugin loading errors or missing dependencies.

---

### Console not accessible on port 19100

**Symptom:** Browser shows "connection refused" when navigating to `http://127.0.0.1:19100/v9/console`.

**Possible causes and fixes:**

1. **Dashboard disabled:** Verify `dashboard.enabled` is `true` (or not explicitly set to `false`) in `openclaw.json`.

2. **Orphan process holding the port:** A previous gateway process may not have been terminated. Find and kill it:
   ```bash
   # Windows
   netstat -ano | findstr ":19100"
   taskkill /F /PID <PID>

   # Linux/macOS
   lsof -i :19100
   kill -9 <PID>
   ```

3. **Gateway not running:** Confirm with `openclaw gateway status`.

4. **Firewall:** Ensure port 19100 is not blocked by a local firewall.

---

### Port 19100 already bound after restart

**Symptom:** After `openclaw gateway stop` and `openclaw gateway start`, port 19100 is already bound.

**Cause:** The previous gateway process may not have fully released the port. This can happen if the process was killed abruptly.

**Fix:**

```bash
# Find the process holding the port
# Windows:
netstat -ano | findstr ":19100" | findstr "LISTENING"
# Note the PID, then:
taskkill /F /PID <PID>

# Linux/macOS:
lsof -i :19100
kill -9 <PID>

# Now restart cleanly
openclaw gateway stop
openclaw gateway start
```

Always verify that port 19100 is free before restarting the gateway.

---

### Data migration from V8

**Symptom:** Startup warnings about V8 SQLite data migration.

**Cause:** V9.2 uses DomainStore with JSON snapshots instead of SQLite. On first startup, the system attempts to migrate existing V8 data automatically.

**Fix:**

1. The migration runs automatically on startup. Check logs for specific migration errors.
2. If auto-migration fails, backup and start fresh:
   ```bash
   # Backup the existing data directory
   cp -r ~/.openclaw/claw-swarm/ ~/.openclaw/claw-swarm.backup/

   # Remove old data (will be recreated on next start)
   rm -rf ~/.openclaw/claw-swarm/

   # Restart
   openclaw gateway restart
   ```
3. Historical data will be lost. If you need to preserve data, inspect the migration error and apply manual fixes.

---

### Tests failing

**Symptom:** `npx vitest run` reports failures.

**Fix:**

1. Ensure Node.js >= 22:
   ```bash
   node --version
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the full test suite:
   ```bash
   npx vitest run
   ```
   V9.2 expects 1,697 tests to pass.
4. If specific tests fail, check whether they depend on optional dependencies (`@xenova/transformers`, `usearch`) that may not be installed.

---

### Signal field not propagating

**Symptom:** Signals emitted by one ModuleBase are not received by other modules that should consume them.

**Possible causes:**

1. **Produces/consumes mismatch:** Verify that the emitting module declares the signal dimension in its `produces` list and the receiving module declares it in its `consumes` list.
2. **Module not initialized:** Each ModuleBase must be properly initialized during gateway startup. Check that the module appears in the domain registry.
3. **Signal dimension mismatch:** The 12-dimensional signal field requires exact dimension matching. Verify the signal type being deposited matches what the consuming module expects.

Use the diagnostic endpoint `GET /api/v1/diagnostics` to inspect the current module coupling topology.

---

### ModuleBase receptor not firing

**Symptom:** A ModuleBase module has declared `consumes` for a signal type, but its receptor callback does not execute.

**Possible causes:**

1. **Threshold not met:** Each receptor has a minimum intensity threshold. If the arriving signal's intensity is below this threshold, the receptor will not fire. Lower the threshold or strengthen the signal at the source.
2. **Signal subtype mismatch:** Receptors are typed. A receptor registered for `signal:pheromone.trail` will not fire for `signal:pheromone.alarm`. Verify that the emitted signal subtype matches the receptor registration.
3. **Module registration order:** In the single-process architecture, module initialization order matters. Ensure the consuming module is registered before signals begin flowing.

---

### High memory usage

**Symptom:** The gateway process consumes excessive memory.

**Possible causes and fixes:**

1. **Embedding model:** The local ONNX embedding model (`@xenova/transformers`) loads model weights into memory (~100 MB). Switch to `embedding.mode: "api"` to offload embeddings to an external API.
2. **Pheromone accumulation:** If pheromone decay is too slow or disabled, pheromone records accumulate in memory. Increase `pheromone.decayRate` or decrease `pheromone.decayInterval`.
3. **Vector index size:** If `vectorIndex.maxElements` is set very high, the HNSW index consumes proportional memory. Reduce the limit if you do not need large-scale vector search.
4. **JSON snapshot size:** Large DomainStore snapshots can consume memory during serialization. Monitor snapshot sizes in `~/.openclaw/claw-swarm/`.

---

### SubAgent spawn failures

**Symptom:** `swarm_run` dispatches a task but the sub-agent fails to spawn, or returns immediately with an error.

**Possible causes:**

1. **Max depth exceeded:** Hierarchical spawning has a maximum depth of 5 levels. If a sub-agent tries to spawn beyond this depth, it will be rejected.
2. **Max concurrent limit:** The default maximum concurrent sub-agents is 10. If this limit is reached, new spawn requests are queued or rejected.
3. **Gateway connection failure:** The spawn mechanism connects to the gateway at `http://127.0.0.1:18789`. If the gateway is unreachable, spawning will fail.
4. **Gateway label length:** Session labels are limited to 64 characters. Task IDs are truncated to the last 12 characters to fit within this limit.

Check sub-agent statistics via `GET /api/v1/subagent-stats` for spawn attempt, success, and failure counters.

---

## Diagnostic Endpoints

Use these REST API endpoints for debugging. All endpoints are served on port 19100.

| Endpoint                      | Purpose                                              |
|-------------------------------|------------------------------------------------------|
| `GET /api/metrics`            | RED metrics (rate, error rate, duration) + hook stats |
| `GET /api/v1/diagnostics`     | Full startup diagnostics report                      |
| `GET /api/v1/breaker-status`  | Circuit breaker states for all tools                 |
| `GET /api/v1/last-inject`     | Last prompt injection snapshot                       |
| `GET /api/v1/subagent-stats`  | Sub-agent spawn/success/failure counters             |
| `GET /api/v1/governance`      | Compliance stats (compliant vs non-compliant turns)  |
| `GET /api/v1/ipc-stats`       | IPC latency percentiles                              |
| `GET /api/v1/convergence`     | State convergence (suspects, dead agents)            |
| `GET /api/v1/dead-letters`    | Dead letter queue entries                            |
| `GET /api/v1/topology`        | Agent collaboration topology                         |
| `GET /api/v1/traces`          | Recent execution traces                              |
| `GET /api/v1/affinity`        | Task-agent affinity scores                           |

**Example:**

```bash
curl http://127.0.0.1:19100/api/v1/diagnostics | jq .
```

---

## Getting Help

1. **Check the logs:** Gateway logs and SwarmCore child process logs contain detailed error messages with source file references.
2. **Run diagnostics:** `curl http://127.0.0.1:19100/api/v1/diagnostics` provides a comprehensive health report.
3. **Run tests:** `npx vitest run` validates that all 1,697 tests pass in your environment.
4. **Inspect bridge status:** `curl http://127.0.0.1:19100/api/v9/bridge/status` confirms the live console bridge is up.
5. **Inspect events:** `curl -N http://127.0.0.1:19100/events` streams legacy SSE events for live debugging.
6. **Console browser devtools:** Open the browser developer console on the Console SPA page. WebSocket bridge connection status and event dispatch are logged.

---

[← Back to README](../../README.md) | [中文版](../zh-CN/faq-troubleshooting.md)
