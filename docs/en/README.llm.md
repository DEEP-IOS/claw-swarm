# Claw-Swarm — LLM Agent Reference

> This document is optimized for LLM context windows. It contains the minimum information needed to understand and use Claw-Swarm tools.

## What is Claw-Swarm

An OpenClaw plugin (V9.2.0) that coordinates multiple LLM agents using bio-inspired algorithms. Runs in-process within the OpenClaw Gateway. Features a Field-Mediated Coupling Architecture where 7 autonomous domains communicate through a 12-dimensional continuous signal field.

## Available Tools

You have 10 tools:

### swarm_run
One-click swarm execution. Classifies intent (fast/slow think), decomposes into DAG, selects models via 8D MoE routing, and spawns sub-agents.

Parameters:
- `goal` (string, required): What to accomplish
- `mode` (enum, optional): `auto` (default), `plan_only`, `execute`, `cancel`, `resume`
- `planId` (string, optional): Required for `execute` mode
- `maxRoles` (number, optional): Max sub-agents (default 5)

### swarm_query
Read-only queries about swarm state.

Parameters:
- `scope` (enum, required): `agents`, `tasks`, `field`, `health`, `budget`, `species`, `reputation`, `pheromones`, `channels`, `stigmergy`

### swarm_dispatch
Forward a message to a running sub-agent.

Parameters:
- `agentId` (string, required): Target agent ID
- `message` (string, required): Message content

### swarm_checkpoint
Pause execution and ask the user for approval.

Parameters:
- `question` (string, required): What to ask the user
- `taskId` (string, optional): Current task ID

### swarm_spawn
Directly spawn a new agent (bypasses the spawn advisor).

Parameters:
- `species` (string, required): Role type (researcher, implementer, reviewer, etc.)
- `goal` (string, required): Task for the new agent

### swarm_pheromone
Stigmergic communication: deposit, read, or query pheromone signals.

Parameters:
- `action` (enum, required): `deposit`, `read`, `types`, `stats`

### swarm_gate
Evidence-based quality gating.

Parameters:
- `action` (enum, required): `evaluate`, `appeal`, `history`

### swarm_memory
Semantic memory operations.

Parameters:
- `action` (enum, required): `search`, `record`, `forget`, `stats`, `export`

### swarm_plan
DAG plan management.

Parameters:
- `action` (enum, required): `view`, `modify`, `validate`, `cancel`

### swarm_zone
File/resource zone management.

Parameters:
- `action` (enum, required): `detect`, `lock`, `unlock`, `list`

## Key Behaviors

- After `swarm_run`, results arrive via sub-agent spawning and yield
- Sub-agents operate in isolated sessions with their own context
- Use `swarm_query({ scope: "health" })` to check system health
- 12-dimensional signal field coordinates agents without direct messages
- Six-layer resilience: retry → circuit breaker → vaccination → model fallback → replan → pipeline break
- MoE routing matches task requirements to model strengths via 8D capability vectors

## Architecture Summary

121 source files across 7 domains. 12-dimensional signal field. 27 event topics. 16 hooks. 10 tools. 35+ model profiles. 58 REST endpoints on port 19100 plus the ConsoleDataBridge WebSocket on port 19101.

Dashboard: `http://127.0.0.1:19100/api/v9/health`
