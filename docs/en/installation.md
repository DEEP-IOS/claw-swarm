# Installation & Configuration

## Prerequisites

| Requirement | Version | Notes |
|------------|---------|-------|
| Node.js | >= 22.0.0 | Required by `package.json` engines field |
| OpenClaw | Latest | Gateway must be installed and running |
| npm | >= 9 | Ships with Node.js 22+ |

**Optional dependencies** (installed automatically if available):

| Package | Purpose | Fallback |
|---------|---------|----------|
| `@xenova/transformers` ^2.0.0 | Local embedding model (Xenova/all-MiniLM-L6-v2, 384D) | API-based embedding |
| `usearch` ^2.0.0 | HNSW vector search | Linear scan fallback |

## Installation

```bash
openclaw plugin install claw-swarm
```

This installs the `openclaw-swarm` package (V7.0.0) as an OpenClaw plugin. The plugin entry point is `src/index.js`.

**Verify installation:**

```bash
openclaw plugin list
# Should show: claw-swarm  7.0.0  enabled
```

## Production Dependencies

Source: `package.json`

| Package | Version | Purpose |
|---------|---------|---------|
| `ajv` | ^8.18.0 | JSON Schema validation for tool parameters |
| `eventemitter3` | ^5.0.1 | High-performance event emitter for MessageBus |
| `fastify` | ^5.8.2 | HTTP/SSE server for DashboardService |
| `nanoid` | ^5.1.2 | Compact unique ID generation |
| `pino` | ^9.6.0 | Structured JSON logging |
| `tiktoken` | ^1.0.22 | Token counting for budget tracking |
| `zod` | ^3.24.2 | Configuration schema validation |

## Architecture Modes

Source: `openclaw.plugin.json`

| Mode | Description |
|------|-------------|
| `hybrid` (default) | Fork process + worker threads. Gateway spawns `swarm-core.js` as child process; SwarmCore uses a 4-thread worker pool for computation. |
| `legacy` | Single-process mode. All engines run in the gateway process. Not recommended for production. |

## Configuration

Configuration lives in `~/.openclaw/openclaw.json` under `plugins.entries.claw-swarm.config`. All settings have defaults; the plugin works with zero configuration.

### Database

| Setting | Default | Description |
|---------|---------|-------------|
| `database.path` | `<dataDir>/claw-swarm.db` | SQLite database file location |

Schema version: 9. Contains 52 tables. WAL mode enabled with 8 MB page cache and 256 MB memory-mapped I/O.

### Dashboard

| Setting | Default | Description |
|---------|---------|-------------|
| `dashboard.port` | `19100` | DashboardService HTTP/SSE port |
| `dashboard.host` | `localhost` | Bind address |

Access the console at `http://127.0.0.1:19100/v6/console` after starting the gateway.

### Pheromone Engine

| Setting | Default | Description |
|---------|---------|-------------|
| `pheromone.decayInterval` | `60` (seconds) | Decay computation interval |
| `pheromone.decayRate` | `0.05` | Default decay rate per interval |

### Memory

| Setting | Default | Description |
|---------|---------|-------------|
| `memory.focus` | `5` | Working memory focus buffer capacity |
| `memory.context` | `15` | Working memory context buffer capacity |
| `memory.scratch` | `30` | Working memory scratch pad capacity |

### Gossip Protocol

| Setting | Default | Description |
|---------|---------|-------------|
| `gossip.fanout` | `3` | Peers per heartbeat round |
| `gossip.heartbeatMs` | `5000` | Heartbeat interval |

### Embedding

| Setting | Default | Description |
|---------|---------|-------------|
| `embedding.mode` | `local` | `local` (Xenova ONNX, 384D) or `api` (configurable endpoint, 1536D) |
| `embedding.model` | `Xenova/all-MiniLM-L6-v2` | Model identifier for local mode |

### Vector Index

| Setting | Default | Description |
|---------|---------|-------------|
| `vectorIndex.maxElements` | `50000` | Maximum vectors stored |
| `vectorIndex.metric` | `cosine` | Distance metric |

### Other Subsystems

| Setting | Default | Description |
|---------|---------|-------------|
| `shapley.samples` | `100` | Monte Carlo samples for Shapley computation |
| `sna.computeInterval` | `50` | Turns between SNA metric recomputation |
| `reputation.halfLifeDays` | `14` | Reputation exponential decay half-life |
| `signal.floor` | `0.03` | Signal calibrator minimum weight |
| `signal.cap` | `0.40` | Signal calibrator maximum weight |

## Model Compatibility

Source: `src/index.js` (MODEL_CAPABILITIES, lines 66-130)

The `before_model_resolve` hook caches model capabilities at Tier A (gateway process). Detection uses case-insensitive substring matching.

| Model Pattern | Tool Call | Failure Rate | Display Name |
|---------------|-----------|--------------|--------------|
| `kimi-coding`, `k2p5`, `kimi-k2.5` | Yes | 12% | Kimi K2.5 |
| `qwen3.5-plus` | Yes | 5% | Qwen 3.5 Plus |
| `qwen3.5-max` | Yes | 3% | Qwen 3.5 Max |
| `glm-5` | Yes | 8% | GLM-5 |
| `minimax-m2.5` | Yes | 6% | MiniMax M2.5 |
| `deepseek-chat` | Yes | 4% | DeepSeek Chat |
| `deepseek-reasoner` | Yes | 10% | DeepSeek Reasoner |
| Unknown models | Yes | 10% | (fallback) |

Failure rate affects circuit breaker sensitivity and dual-process routing thresholds.

## Feature Flags

Feature flags are configured in `plugins.entries.claw-swarm.config` within `openclaw.json`. Dependencies are validated at startup (`src/index.js:110-118`).

| Flag | Default | Requires |
|------|---------|----------|
| `toolResilience` | enabled | — |
| `healthChecker` | enabled | — |
| `hierarchical` | enabled | — |
| `dagEngine` | enabled | `hierarchical` |
| `workStealing` | enabled | `dagEngine` |
| `evolution.scoring` | enabled | — |
| `evolution.clustering` | disabled | `evolution.scoring` |
| `evolution.gep` | disabled | `evolution.scoring` |
| `evolution.abc` | disabled | `evolution.scoring` |
| `evolution.lotkaVolterra` | disabled | `evolution.scoring` |
| `speculativeExecution` | disabled | `dagEngine` |
| `contextEngine` | disabled | — |
| `skillGovernor` | disabled | — |

## Network Ports

| Component | Default Port | Host | URL |
|-----------|-------------|------|-----|
| OpenClaw Gateway | 18789 | 127.0.0.1 | `http://127.0.0.1:18789` |
| Claw-Swarm Dashboard | 19100 | localhost | `http://127.0.0.1:19100` |
| Console SPA | 19100 | localhost | `http://127.0.0.1:19100/v6/console` |

**Note:** The gateway uses `127.0.0.1`, not `localhost`. All internal WebSocket connections must use `127.0.0.1`.

## Verifying the Installation

After `openclaw gateway start`:

1. **Check plugin status:** `openclaw plugin list` — should show `claw-swarm 7.0.0 enabled`.
2. **Check dashboard:** Open `http://127.0.0.1:19100/v6/console` in a browser.
3. **Check API:** `curl http://127.0.0.1:19100/api/metrics` — should return JSON with RED metrics.
4. **Check SSE:** `curl -N http://127.0.0.1:19100/events` — should stream real-time events.
5. **Check tools:** In an OpenClaw chat session, the agent should have access to `swarm_run`, `swarm_query`, `swarm_dispatch`, and `swarm_checkpoint`.

---
[← Back to README](../../README.md) | [中文版](../zh-CN/installation.md)
