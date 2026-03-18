# Installation & Configuration

> Claw-Swarm V9.0.0 — Bio-inspired swarm intelligence plugin for OpenClaw

[← Back to README](../../README.md) | [中文版](../zh-CN/installation.md)

---

## Prerequisites

| Requirement | Version    | Notes                                        |
|-------------|------------|----------------------------------------------|
| Node.js     | >= 22.0.0  | Required by `package.json` engines field     |
| npm         | >= 9       | Ships with Node.js 22+                       |
| git         | >= 2.30    | For cloning the repository                   |
| OpenClaw    | Latest     | Gateway must be installed globally            |

**Optional dependencies** (installed automatically if available):

| Package                  | Purpose                                       | Fallback                |
|--------------------------|-----------------------------------------------|-------------------------|
| `@xenova/transformers` ^2.0.0 | Local embedding model (Xenova/all-MiniLM-L6-v2, 384D) | API-based embedding |
| `usearch` ^2.0.0        | HNSW vector search                            | Linear scan fallback    |

---

## Installation

### Step 1 — Install OpenClaw globally

```bash
npm install -g openclaw
```

Verify installation:

```bash
openclaw --version
```

### Step 2 — Get Claw-Swarm

**Option A — npm (recommended)**:

```bash
npm install openclaw-swarm
cd node_modules/openclaw-swarm
```

**Option B — Git clone**:

```bash
git clone https://github.com/DEEP-IOS/claw-swarm.git
cd claw-swarm
```

### Step 3 — Run the installer

```bash
node install.js
```

This registers Claw-Swarm as an OpenClaw plugin, installs production dependencies, initializes the 7-domain architecture with all modules enabled (zero feature flags), and creates the default configuration entries in `~/.openclaw/openclaw.json`.

### Step 4 — Start the gateway

```bash
openclaw gateway restart
```

If this is the first launch, use `openclaw gateway start` instead.

### Step 5 — Verify

```bash
openclaw gateway status
```

Expected output should include:

```
claw-swarm  9.0.0  enabled
```

### Step 6 — Open the Console

Navigate to `http://127.0.0.1:19100/v9/console` in your browser. The console is served directly by the DashboardService inside the gateway process. No separate dev server is needed.

---

## Architecture Mode

V9.0 runs as a **single-process in-gateway** architecture. All 7 domains (~121 source files) run within the OpenClaw gateway process. No child process fork, no IPC bridge, no worker threads.

| Property              | Value                                                    |
|-----------------------|----------------------------------------------------------|
| Process model         | Single-process, in-gateway                               |
| Module count          | ~110 modules across 7 domains                            |
| Source files          | ~121 source files                                        |
| Signal architecture   | 12-dimensional signal field with ModuleBase produces/consumes coupling |

---

## Configuration

All configuration lives in `~/.openclaw/openclaw.json` under `plugins.entries.openclaw-swarm.config`. Every setting has a sensible default; the plugin works with zero configuration.

### Pheromone Engine

| Setting                    | Default | Description                          |
|----------------------------|---------|--------------------------------------|
| `pheromone.decayInterval`  | `60`    | Decay computation interval (seconds) |
| `pheromone.decayRate`      | `0.05`  | Default decay rate per interval      |

### Memory

| Setting            | Default | Description                            |
|--------------------|---------|----------------------------------------|
| `memory.inMemory`  | `false` | Use in-memory store (no DomainStore persistence) |
| `memory.maxFocus`  | `5`     | Working memory focus buffer capacity   |
| `memory.maxContext` | `15`   | Working memory context buffer capacity |
| `memory.maxScratch` | `30`  | Working memory scratch pad capacity    |

### Dashboard

| Setting              | Default     | Description                        |
|----------------------|-------------|------------------------------------|
| `dashboard.enabled`  | `true`      | Enable the DashboardService        |
| `dashboard.port`     | `19100`     | HTTP/SSE port                      |

### Embedding

| Setting              | Default                      | Description                              |
|----------------------|------------------------------|------------------------------------------|
| `embedding.enabled`  | `true`                       | Enable embedding subsystem               |
| `embedding.mode`     | `local`                      | `local` (ONNX, 384D) or `api` (1536D)   |
| `embedding.localModel` | `Xenova/all-MiniLM-L6-v2` | Model identifier for local mode          |
| `embedding.dimensions` | `384`                      | Embedding vector dimensions              |

### Vector Index

| Setting                  | Default  | Description                   |
|--------------------------|----------|-------------------------------|
| `vectorIndex.enabled`    | `true`   | Enable HNSW vector index      |
| `vectorIndex.maxElements`| `50000`  | Maximum vectors stored        |
| `vectorIndex.metric`     | `cosine` | Distance metric               |

### Other Subsystems

| Setting                        | Default | Description                                 |
|--------------------------------|---------|---------------------------------------------|
| `signal.floor`                 | `0.03`  | Signal calibrator minimum weight            |
| `signal.cap`                   | `0.40`  | Signal calibrator maximum weight            |
| `shapley.samples`              | `100`   | Monte Carlo samples for Shapley computation |
| `sna.computeInterval`         | `50`    | Turns between SNA metric recomputation      |
| `dualProcess.threshold`        | `0.6`   | System 1/2 routing threshold                |
| `hybridRetrieval.enabled`      | `true`  | Enable hybrid retrieval engine              |
| `failureModeAnalyzer.enabled`  | `true`  | Enable failure mode analysis                |
| `budgetForecaster.enabled`     | `true`  | Enable token budget forecasting             |
| `reputation.halfLifeDays`      | `14`    | Reputation exponential decay half-life      |
| `metricsAlerting.enabled`      | `true`  | Enable metrics alerting subsystem           |

---

## 12-Dimensional Signal Field

The signal field is the foundational substrate of the V9.0 architecture. It provides the reactive communication layer upon which all 7 domains depend.

The signal field operates through `SignalStore` (12-dimensional signal storage and query), `ModuleBase` subclasses (~110 module types that declare `produces` and `consumes` signal dimensions), and field-mediated coupling (modules interact exclusively through signal deposit and subscription).

No explicit configuration is required. The signal field initializes automatically as part of gateway startup.

---

## Data Storage

Claw-Swarm V9.0 uses DomainStore with JSON snapshots for persistence, replacing the SQLite database from V8.

| Property         | Value                                              |
|------------------|----------------------------------------------------|
| Default path     | `~/.openclaw/claw-swarm/`                          |
| Format           | JSON snapshots per domain                          |
| Migration        | Automatic on startup from V8 SQLite if present     |

Data is organized by domain (core, communication, intelligence, orchestration, quality, observe, bridge). Each domain manages its own snapshot lifecycle.

---

## Model Compatibility

Claw-Swarm ships with 35+ built-in model profiles, each with an 8-dimensional capability vector used for MoE (Mixture-of-Experts) routing. Any OpenClaw-compatible model can be used; unknown models receive a fallback profile.

Representative profiles (all support tool calling):

| Model              | Failure Rate | Model              | Failure Rate |
|--------------------|--------------|--------------------|--------------|
| `claude-opus-4-6`  | 2%           | `deepseek-r1`      | 8%           |
| `claude-sonnet-4-6`| 3%           | `deepseek-chat`    | 4%           |
| `gpt-4o`           | 3%           | `qwen3.5-max`      | 3%           |
| `gpt-4.1`          | 2%           | `kimi-k2.5`        | 12%          |
| `gemini-2.5-pro`   | 4%           | `glm-5` / `minimax-m2.5` | 8% / 6% |

Unknown models default to 10% failure rate. Failure rate affects circuit breaker sensitivity and dual-process routing.

---

## Module Activation

V9.0 uses a **zero feature flag** architecture. All ~110 modules across 7 domains are always active. Module activation is controlled exclusively through the `ModuleBase` produces/consumes coupling mechanism: a module that declares `consumes: ['signal_type']` automatically activates when signals of that type are deposited in the field. No manual flag configuration is needed.

---

## Network Ports

| Component              | Default Port | URL                                    |
|------------------------|-------------|----------------------------------------|
| OpenClaw Gateway       | 18789       | `http://127.0.0.1:18789`              |
| Claw-Swarm Dashboard   | 19100       | `http://127.0.0.1:19100`              |
| Console SPA            | 19100       | `http://127.0.0.1:19100/v9/console`   |

**Important:** The gateway uses `127.0.0.1`, not `localhost`. All internal WebSocket and HTTP connections must use `127.0.0.1` to avoid DNS resolution inconsistencies.

---

## Verifying the Installation

After `openclaw gateway start`, verify each layer:

```bash
openclaw gateway status                        # should show: claw-swarm 9.0.0 enabled
curl http://127.0.0.1:19100/api/metrics        # should return RED metrics JSON
curl -N http://127.0.0.1:19100/events          # should stream real-time SSE events
```

Then open `http://127.0.0.1:19100/v9/console` in a browser (should load 6 views), and confirm the agent in an OpenClaw chat session has access to 10 tools.

---

## Troubleshooting Common Installation Issues

| Problem | Solution |
|---------|----------|
| Plugin not detected | Verify `openclaw.json` has the `claw-swarm` entry, then `openclaw gateway restart` |
| Port 19100 in use | Orphan gateway process; find PID via `netstat` and kill it. See [FAQ](faq-troubleshooting.md) |
| Data directory permission errors | Ensure write access to `~/.openclaw/claw-swarm/` |
| Node.js too old | Requires Node.js 22+. Check with `node --version` |
| Gateway fails to start | Run `openclaw gateway stop` first, check port 18789 availability |

---

[← Back to README](../../README.md) | [中文版](../zh-CN/installation.md)
