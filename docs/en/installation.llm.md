# Claw-Swarm Installation — LLM Agent Reference

> Compact installation guide optimized for LLM context windows.

## Requirements

- Node.js >= 22.0.0
- OpenClaw CLI installed (`npm install -g openclaw`)

## Install

```bash
git clone https://github.com/DEEP-IOS/claw-swarm.git
cd claw-swarm && node install.js
openclaw gateway restart
```

## Verify

```bash
openclaw gateway status
# Should show: claw-swarm 7.0.0 enabled
```

## Configuration

Config path: `~/.openclaw/openclaw.json` → `plugins.entries.claw-swarm.config`

Zero configuration required. All settings have defaults.

Key settings:
- `dashboard.port`: 19100 (default)
- `pheromone.decayInterval`: 60 seconds (default)
- `memory.focus`: 5 slots (default)
- `embedding.mode`: `local` (Xenova 384D) or `api` (1536D)

## Network Ports

| Component | Port | URL |
|-----------|------|-----|
| Gateway | 18789 | `http://127.0.0.1:18789` |
| Dashboard | 19100 | `http://127.0.0.1:19100` |
| Console | 19100 | `http://127.0.0.1:19100/v6/console` |

Important: Use `127.0.0.1`, not `localhost`.

## Feature Flags

Enabled by default: `toolResilience`, `healthChecker`, `hierarchical`, `dagEngine`, `workStealing`, `evolution.scoring`

Disabled by default: `speculativeExecution`, `contextEngine`, `skillGovernor`, `evolution.clustering/gep/abc/lotkaVolterra`

## Troubleshooting

- Port 19100 in use → Kill orphaned `swarm-core.js` process, restart gateway
- Tools return "not_ready" → Wait 3-5 seconds for SwarmCore initialization
- Dashboard shows zeros → Trigger a swarm action to generate events
- IPC timeout → Restart gateway: `openclaw gateway stop && openclaw gateway start`

## Database

Path: `~/.openclaw/claw-swarm/claw-swarm.db`
Engine: SQLite (WAL mode), 52 tables, schema version 9
Auto-migration on startup via MigrationRunner
