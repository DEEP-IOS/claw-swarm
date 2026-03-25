# Claw-Swarm Installation — LLM Agent Reference

> Compact installation guide optimized for LLM context windows.

## Requirements

- Node.js >= 22.0.0
- OpenClaw CLI installed (`npm install -g openclaw`)

## Install

```bash
# Option A: npm (recommended)
npm install openclaw-swarm && cd node_modules/openclaw-swarm && node install.js

# Option B: git clone
git clone https://github.com/DEEP-IOS/claw-swarm.git
cd claw-swarm && node install.js

openclaw gateway restart
```

## Verify

```bash
openclaw gateway status
# Should show: claw-swarm 9.2.0 enabled
```

## Configuration

Config path: `~/.openclaw/openclaw.json` → `plugins.entries.openclaw-swarm.config`

Zero configuration required. All settings have defaults. Zero feature flags — all modules always active.

Key settings (7-domain config):
- `field.maxSignals`: 100000 (default)
- `observe.dashboard.port`: 19100 (default)
- `communication.pheromone.decayInterval`: 60000 ms (default)
- `intelligence.embedding.mode`: `local` (Xenova 384D) or `api` (1536D)
- `orchestration.budget.maxTokens`: 1000000 (default)

## Network Ports

| Component | Port | URL |
|-----------|------|-----|
| Gateway | 18789 | `http://127.0.0.1:18789` |
| Dashboard API | 19100 | `http://127.0.0.1:19100/api/v9/health` |

Important: Use `127.0.0.1`, not `localhost`.

## Data Storage

Path: `~/.openclaw/claw-swarm/snapshots/`
Engine: In-memory DomainStore + JSON snapshot persistence
No SQLite dependency.

## Troubleshooting

- Port 19100 in use → Kill orphaned process, restart gateway
- Tools return "not_ready" → Wait 3-5 seconds for SwarmCoreV9 initialization
- Dashboard shows zeros → Trigger a swarm action to generate events
