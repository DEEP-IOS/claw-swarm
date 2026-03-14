# FAQ & Troubleshooting

## Frequently Asked Questions

### What is Claw-Swarm?

Claw-Swarm is an OpenClaw plugin that enables multi-agent collaboration through swarm intelligence. It coordinates LLM agents using biological algorithms (pheromone trails, bee colony scheduling, immune-system anomaly detection) rather than centralized control. See [Biomimicry & Design Philosophy](biomimicry.md).

### How many tools does Claw-Swarm expose?

4 public tools: `swarm_run`, `swarm_query`, `swarm_dispatch`, `swarm_checkpoint`. 6 internal tools exist for automated hook use but are deprecated from direct invocation. See [API Reference](api-reference.md).

### What LLM models are supported?

Any model that supports tool calling. Tested models with known failure rates: Kimi K2.5 (12%), Qwen 3.5 Plus (5%), Qwen 3.5 Max (3%), GLM-5 (8%), MiniMax M2.5 (6%), DeepSeek Chat (4%), DeepSeek Reasoner (10%). Unknown models default to 10% failure rate. See `src/index.js` MODEL_CAPABILITIES.

### What is the minimum Node.js version?

Node.js 22.0.0 or later. Required by the `engines` field in `package.json`.

### Where is the database stored?

Default: `~/.openclaw/claw-swarm/claw-swarm.db`. SQLite with WAL mode. Schema version 9, containing 52 tables. See `src/L1-infrastructure/schemas/database-schemas.js`.

---

## Troubleshooting

### Port 19100 already in use after gateway restart

**Symptom:** `Error: listen EADDRINUSE: address already in use :::19100` when starting the gateway.

**Cause:** An orphaned `swarm-core.js` child process was not terminated when the gateway stopped. The old process still holds port 19100.

**Fix:**

```bash
# Find the process holding port 19100
# Windows:
netstat -ano | findstr ":19100"
# Linux/macOS:
lsof -i :19100

# Kill the orphaned process (replace PID)
# Windows:
taskkill /F /PID <PID>
# Linux/macOS:
kill -9 <PID>

# Restart the gateway
openclaw gateway stop
openclaw gateway start
```

Source: `src/L6-monitoring/dashboard-service.js:69` (port binding).

### Tools return "status: not_ready"

**Symptom:** `swarm_run` or other tools return `{status: 'not_ready', message: 'SwarmCore initializing...'}`.

**Cause:** The `_swarmCoreReady` flag in `src/index.js` has not been set. SwarmCore child process is still initializing (database migration, engine startup).

**Fix:** Wait 3-5 seconds and retry. If persistent:
1. Check gateway logs for initialization errors.
2. Verify the database file is accessible: `~/.openclaw/claw-swarm/claw-swarm.db`.
3. Check if schema migration failed: look for `MigrationRunner` errors in logs.

### Dashboard shows all zeros

**Symptom:** Console at `http://127.0.0.1:19100/v6/console` loads but all metrics are zero.

**Cause:** `stateBroadcaster.start()` was not called during initialization, or no swarm events have been published yet.

**Fix:**
1. Verify the gateway is running: `openclaw gateway status`.
2. Trigger a swarm action (e.g., use `swarm_run` in a chat session) to generate events.
3. Check SSE connectivity: `curl -N http://127.0.0.1:19100/events` should stream data.

### IPC timeout errors

**Symptom:** Tool calls hang for 30 seconds then return timeout errors.

**Cause:** The IPC bridge between the gateway process and SwarmCore child has stalled. Default timeout is 5 s for general calls, 30 s for tool proxy calls.

**Fix:**
1. Check if the child process is alive: look for a `swarm-core.js` process in task manager.
2. Restart the gateway: `openclaw gateway stop && openclaw gateway start`.
3. If the child process is CPU-bound (heavy computation), increase IPC timeout in config.

Source: `src/L1-infrastructure/ipc-bridge.js` (5 s default), `src/index.js:183`.

### Cannot connect to gateway WebSocket

**Symptom:** Relay client connection failures, subagent spawning fails.

**Cause:** The gateway uses `127.0.0.1:18789`, not `localhost:18789`. Some systems resolve `localhost` differently.

**Fix:** Ensure all internal URLs use `127.0.0.1` instead of `localhost`.

### Pheromone emission fails

**Symptom:** `pheromoneEngine.emitPheromone` throws an error about missing parameters.

**Cause:** The `targetScope` parameter is required but was not provided.

**Fix:** Always include `targetScope` when emitting pheromones:
```javascript
pheromoneEngine.emitPheromone({
  type: 'trail',
  intensity: 0.8,
  targetScope: '/task/123'  // Required
});
```

Source: `src/L2-communication/pheromone-engine.js`.

### Stigmergic board returns undefined

**Symptom:** `engines.stigmergicBoard` is undefined or operations fail.

**Cause:** StigmergicBoard requires `dbManager.getDb()`, not `engines.db`.

**Fix:** This is an internal initialization issue. If you see this after a code update, verify that `StigmergicBoard` receives the correct database reference in `plugin-adapter.js`.

### Gateway label exceeds 64 characters

**Symptom:** Task labels are silently truncated or ignored.

**Cause:** OpenClaw Gateway enforces a 64-character limit on session labels.

**Fix:** Task IDs in labels are truncated to 12 characters: `swarm:taskId.slice(-12):agentId`. The label format is `swarm:taskId:agentId[:dagId[:phaseNodeId]]` (`src/L5-application/tools/swarm-run-tool.js:44-58`).

### CJK goal text triggers direct reply instead of swarm execution

**Symptom:** Short Chinese goals (e.g., 5 characters) bypass swarm_run planning and get a direct reply.

**Cause:** The `goal.length < 10` check counts UTF-16 code units, which underestimates CJK text complexity.

**Fix:** This is a known limitation. Use longer goal descriptions (>10 characters) or provide explicit mode: `swarm_run({goal: "...", mode: "auto"})`.

### Schema version mismatch

**Symptom:** Database errors mentioning unexpected schema version.

**Cause:** The database was created by a different version of Claw-Swarm.

**Fix:**
1. The `MigrationRunner` (`src/L1-infrastructure/database/migration-runner.js`) auto-upgrades on startup.
2. If auto-migration fails, backup and recreate:
```bash
# Backup
cp ~/.openclaw/claw-swarm/claw-swarm.db ~/.openclaw/claw-swarm/claw-swarm.db.backup
# Remove (will be recreated on next start)
rm ~/.openclaw/claw-swarm/claw-swarm.db
# Restart
openclaw gateway stop && openclaw gateway start
```

### Checkpoint not resolving

**Symptom:** A sub-agent called `swarm_checkpoint` but the checkpoint is stuck in pending state.

**Cause:** The user has not replied in the parent chat session, or the next `swarm_run` call has not been made to detect pending checkpoints.

**Fix:**
1. Check pending checkpoints: query the `swarm_user_checkpoints` table for `status='pending'`.
2. Reply to the checkpoint question in the parent chat session.
3. Call `swarm_run` again — it will auto-detect pending checkpoints, resolve them, and re-spawn with context.

Source: `src/L5-application/tools/swarm-checkpoint-tool.js`, `swarm-run-tool.js` (pre-execution check).

---

## Diagnostic Endpoints

Use these REST API endpoints for debugging (port 19100):

| Endpoint | Purpose |
|----------|---------|
| `GET /api/metrics` | RED metrics + hook statistics |
| `GET /api/v1/diagnostics` | Startup diagnostics report |
| `GET /api/v1/breaker-status` | Circuit breaker states for all tools |
| `GET /api/v1/last-inject` | Last prompt injection snapshot |
| `GET /api/v1/subagent-stats` | Subagent spawn/success/failure counters |
| `GET /api/v1/governance` | Compliance stats (compliant vs non-compliant turns) |
| `GET /api/v1/ipc-stats` | IPC latency percentiles |
| `GET /api/v1/convergence` | State convergence (suspects, dead agents) |

Example: `curl http://127.0.0.1:19100/api/v1/diagnostics | jq .`

---
[← Back to README](../../README.md) | [中文版](../zh-CN/faq-troubleshooting.md)
