# Agent Roles — Historical Reference (V6.x) · 代理角色 — 历史版本说明

> **This file documents the V6.x agent architecture for historical context.**
> For the current V7.0 architecture, see:
> - [Architecture (EN)](docs/en/architecture.md)
> - [架构设计 (中文)](docs/zh-CN/architecture.md)
> - [API Reference (EN)](docs/en/api-reference.md)
> - [API 参考 (中文)](docs/zh-CN/api-reference.md)

> **本文件记录 V6.x 代理架构，仅作历史参考。**
> V7.0 当前架构请查阅上方链接。

---

## V6.x Agent Isolation Matrix · V6.x 代理隔离矩阵

| Agent | Role · 角色 | tools.deny | SOUL |
|-------|-------------|-----------|------|
| main | Queen Bee / 蜂后协调者 | exec, browser, sessions_spawn, sessions_send | souls/main.md |
| architect | Architect / 架构师 | swarm_dispatch, sessions_spawn, sessions_send | souls/architect.md |
| coder | Worker Bee / 工蜂 | swarm_run, swarm_query, swarm_dispatch, sessions_spawn, sessions_send | souls/coder.md |
| reviewer | Quality Guard / 质量守卫 | swarm_run, swarm_query, swarm_dispatch, exec, sessions_spawn, sessions_send | souls/reviewer.md |
| swarm-relay | Deterministic Forwarder / 确定性转发器 | swarm_run, swarm_query, swarm_dispatch, exec, browser | souls/swarm-relay.md |

## V6.x Key Constraints · V6.x 关键约束

- No agent holds both `swarm_run` and `sessions_spawn` · 没有任何代理同时拥有这两个工具
- main spawns sub-agents only via `swarm_run` → relay → `sessions_spawn` chain · main 仅通过中继链路生成子代理
- coder/reviewer cannot trigger swarm operations · coder/reviewer 不能触发蜂群操作
- swarm-relay performs JSON parsing + tool forwarding only · swarm-relay 仅做 JSON 解析与工具转发

## V7.0 Changes · V7.0 变更

V7.0 replaced the relay-based spawn chain with **DirectSpawnClient** (`swarm-relay-client.js`), which connects directly to the Gateway via WebSocket RPC. The relay agent role is no longer needed. Tool count grew from 3 to 4 public tools (`swarm_run`, `swarm_query`, `swarm_dispatch`, `swarm_checkpoint`).

V7.0 用 **DirectSpawnClient** 取代了中继链路，通过 WebSocket RPC 直连 Gateway。中继代理角色已不再需要。公开工具从 3 个增至 4 个。
