# Claw-Swarm — LLM Agent Reference

> This document is optimized for LLM context windows. It contains the minimum information needed to understand and use Claw-Swarm tools.

## What is Claw-Swarm

An OpenClaw plugin (V7.0.0) that coordinates multiple LLM agents using bio-inspired algorithms. Runs as a child process via `child_process.fork()`.

## Available Tools

You have 4 tools:

### swarm_run
One-click swarm execution. Decomposes a goal into sub-tasks and spawns sub-agents.

Parameters:
- `goal` (string, required): What to accomplish
- `mode` (enum, optional): `auto` (default), `plan_only`, `execute`, `cancel`, `resume`
- `planId` (string, optional): Required for `execute` mode
- `maxRoles` (number, optional): Max sub-agents (default 5)

Example: `swarm_run({ goal: "Refactor the auth module", mode: "auto" })`

### swarm_query
Read-only queries about swarm state.

Parameters:
- `scope` (enum, required): `status`, `agent`, `task`, `agents`, `pheromones`, `memory`, `quality`, `zones`, `plans`, `board`
- `agentId` (string, optional): For `agent` scope
- `taskId` (string, optional): For `task`/`quality` scope
- `keyword` (string, optional): For `memory`/`pheromones` scope

Example: `swarm_query({ scope: "status" })`

### swarm_dispatch
Send a task directly to a specific sub-agent.

Parameters:
- `agentId` (enum, required): `mpu-d1` (scout), `mpu-d2` (guard), `mpu-d3` (worker)
- `task` (string, required): Task description

### swarm_checkpoint
Pause execution and ask the user for approval before proceeding with an irreversible action.

Parameters:
- `question` (string, required): What to ask the user
- `taskId` (string, optional): Current task ID

## Agent Roles

| Agent ID | Role | Specialization |
|----------|------|---------------|
| mpu-d1 | Scout · 侦察蜂 | Research, exploration |
| mpu-d2 | Guard · 守卫蜂 | Review, audit, verification |
| mpu-d3 | Worker · 工蜂 | Coding, implementation, testing |
| mpu-d4 | Designer · 设计蜂 | UI, visual, UX design |

## Key Behaviors

- After `swarm_run`, results arrive asynchronously via `chat.inject`
- Sub-agents operate in isolated sessions with their own context
- Use `swarm_query({ scope: "status" })` to check progress
- Pheromone signals coordinate agents without direct messages
- Circuit breakers protect against cascading tool failures

## Architecture Summary

173 source files across 6 layers (L1 Infrastructure → L6 Monitoring). 52 database tables. 122 event topics. 19 hooks.

Console: `http://127.0.0.1:19100/v6/console`
