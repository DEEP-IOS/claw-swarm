# Claw-Swarm v4.0 -- Unified Swarm Intelligence / 蜂群 Claw-Swarm v4.0 -- 统一蜂群智能

Claw-Swarm is a bio-inspired multi-agent coordination plugin for OpenClaw. It unifies memory injection, pheromone-based indirect communication, governance, agent persona design (SOUL), and collaboration into a single system. Your memory, peer directory, and active pheromone signals are automatically injected into your context before each turn -- you do not need to fetch them manually.

---

## Available Tools / 可用工具

### `collaborate` -- Peer Communication / 对等通信

Send messages to peer agents or broadcast to the swarm.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | string | yes | Peer agent ID, or `"broadcast"` for all peers |
| `message` | string | yes | Message content |
| `channel` | string | no | `pheromone` (default, async signal), `memory` (shared scope), `direct` (@mention) |
| `urgency` | string | no | `low`, `medium` (default), `high`, `critical` |

### `pheromone` -- Emit or Read Signals / 发射或读取信息素

Interact with the pheromone layer directly. Use `emit` to leave signals for others; use `read` to query active signals in a scope.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | `emit` or `read` |
| `type` | string | emit only | `trail`, `alarm`, `recruit`, `queen`, `dance` |
| `scope` | string | no | Target scope (default: `/global`). Use `/agent/<id>` for directed signals |
| `message` | string | no | Payload message (for emit) |
| `intensity` | number | no | Signal strength 0--1 (default: 1.0) |

### `swarm_manage` -- Task Management / 任务管理

Monitor and control swarm tasks.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | `status`, `list`, `cancel`, `report` |
| `taskId` | string | for status/cancel/report | Target task ID |
| `filter` | string | no | Status filter for `list` action |

### `swarm_spawn` -- Spawn Sub-agents / 派生子代理

Describe a task and let Swarm analyze it, select appropriate roles, and spawn a coordinated team of sub-agents.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | yes | Task description |
| `strategy` | string | no | `parallel` (default), `pipeline`, `debate`, `stigmergy` |
| `maxAgents` | number | no | Maximum sub-agents to spawn (default: 4) |

### `swarm_design` -- Agent Design / 智能体设计

Query available SOUL persona templates and get recommendations.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | `list` (all templates), `recommend` (for task type), `detail` (one template) |
| `taskType` | string | no | Task type for recommendation (e.g. `exploration`, `coding`, `review`) |
| `personaId` | string | no | Persona ID for detail view |

---

## Pheromone Quick Reference / 信息素速查

| Type | When to Use / 使用场景 | Decays In |
|------|------------------------|-----------|
| `trail` | Mark explored paths or completed work for others to follow / 标记已探索的路径 | ~120 min |
| `alarm` | Warn about errors, blockers, or dangerous states / 警告错误或阻塞 | ~30 min |
| `recruit` | Request help from available peers / 请求协助 | ~60 min |
| `queen` | High-priority directives that must persist / 高优先级持久指令 | ~8 hours |
| `dance` | Share discovered resources or knowledge / 分享发现的资源或知识 | ~90 min |

Pheromones decay naturally over time. Intensity below 0.01 is treated as evaporated.

---

## Collaboration Tips / 协作提示

1. **Mention peers with `@agent-id`** -- Mentions are auto-routed to the correct peer regardless of the underlying platform (Discord, Slack, etc.).

2. **Use the `collaborate` tool for structured messages** -- It handles channel routing and urgency mapping automatically. Prefer it over raw @mentions when you need delivery guarantees or want to leave async signals.

3. **Check pheromone signals for environmental awareness** -- Before starting a task, read the pheromone layer to see what your peers have already explored (`trail`), where they need help (`recruit`), and whether there are active warnings (`alarm`).

4. **Choose the right channel:**
   - `pheromone` -- Best for async, ambient awareness. Signals decay naturally.
   - `memory` -- Best for persistent information that peers should see on their next turn.
   - `direct` -- Best for immediate, targeted conversation.

5. **Broadcast sparingly** -- Use `target: "broadcast"` only when all peers need the information. For targeted communication, specify the peer's agent ID.

---

## Important Notes / 重要说明

- **Claw-Swarm v4.0 replaces OME.** Do not run both simultaneously. If OME is installed, disable it before enabling Claw-Swarm.
- **Memory is auto-injected** via the `before_agent_start` hook. You do not need to call any tool to load your memory -- it is already in your context.
- **Peer directory is auto-injected.** You can see your active peers and their roles in your context. No need to query for them.
- **Pheromone snapshots are auto-injected.** Active signals relevant to your scope are included in your context each turn.
- **Six subsystems, independently toggleable:** memory, pheromone, governance, soul, collaboration, orchestration. Your operator controls which are active.
