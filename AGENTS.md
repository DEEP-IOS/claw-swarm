# Agent Roles — Version History · 代理角色 — 版本演进

> **Current architecture (V9.0):** See [Architecture (EN)](docs/en/architecture.md) · [架构设计 (中文)](docs/zh-CN/architecture.md)

---

## V9.0 Architecture · V9.0 架构

V9.0 replaces the 7-layer linear hierarchy with **7 autonomous domains** connected through a 12-dimensional signal field. Modules extend `ModuleBase` (not `MeshNode`) and declare `produces()`/`consumes()` for static coupling verification. All 10 tools are registered as plugin tools; the relay agent role is permanently retired.

V9.0 用 7 个自治域取代了 7 层线性层级，通过 12 维信号场连接。模块继承 `ModuleBase` 并声明 `produces()`/`consumes()` 实现静态耦合验证。10 个工具全部注册为插件工具；中继代理角色永久退役。

| Change · 变更 | V8.2 | V9.0 |
|---|---|---|
| Architecture | 7 layers (L0–L6) | 7 domains + dual foundation |
| Module base class | `MeshNode` (receptor/effector) | `ModuleBase` (produces/consumes) |
| Process model | `child_process.fork()` + IPC | Single-process, in-gateway |
| Signal system | 5 types × 19 subtypes | 12-dimensional continuous field |
| Tools | 4 public + 6 internal | 10 (all registered) |
| Hooks | 20 (Tier-A + Tier-B) | 16 |
| Feature flags | Multiple | Zero |
| Source files | 208 JS | 121 JS |
| Tests | 2,105 | 1,365 |

### V9 Role Registry · V9 角色注册表

Roles are defined in [`src/intelligence/identity/role-registry.js`](src/intelligence/identity/role-registry.js) (260 lines) with per-dimension sensitivity coefficients:

| Role · 角色 | Sensitivity Profile · 灵敏度特征 |
|---|---|
| researcher | High: knowledge, novelty · 低: path, cost |
| implementer | High: path, task_load · 低: novelty |
| reviewer | High: error_rate, trust · 低: task_load |
| planner | High: complexity, coherence · 低: urgency |
| debugger | High: error_rate, latency · 低: quality |
| generalist | Balanced across all 12 dimensions |

---

## V8.2 Architecture · V8.2 架构 (Historical)

V8.2 introduced the **Signal-Mesh Architecture** (L0 Signal Field) where all 11 engine subsystems extend `MeshNode` and communicate through typed biological signals. Added 35+ model capability profiles with 8D MoE routing, 6D emotional intelligence tracking per agent, and cultural friction modeling. Total: 208 source files across 7 layers (L0-L6), 2,105 tests, 64 DB tables.

---

## V7.0 Architecture · V7.0 架构 (Historical)

V7.0 replaced the relay-based spawn chain with **DirectSpawnClient** via WebSocket RPC. The relay agent role was deprecated. Tool count grew from 3 to 4 public tools.

---

## V6.x Agent Isolation Matrix · V6.x 代理隔离矩阵 (Historical)

| Agent | Role · 角色 | tools.deny | SOUL |
|-------|-------------|-----------|------|
| main | Queen Bee / 蜂后协调者 | exec, browser, sessions_spawn, sessions_send | souls/main.md |
| architect | Architect / 架构师 | swarm_dispatch, sessions_spawn, sessions_send | souls/architect.md |
| coder | Worker Bee / 工蜂 | swarm_run, swarm_query, swarm_dispatch, sessions_spawn, sessions_send | souls/coder.md |
| reviewer | Quality Guard / 质量守卫 | swarm_run, swarm_query, swarm_dispatch, exec, sessions_spawn, sessions_send | souls/reviewer.md |
| swarm-relay | Deterministic Forwarder / 确定性转发器 | swarm_run, swarm_query, swarm_dispatch, exec, browser | souls/swarm-relay.md |

### V6.x Key Constraints · V6.x 关键约束

- No agent holds both `swarm_run` and `sessions_spawn`
- main spawns sub-agents only via `swarm_run` → relay → `sessions_spawn` chain
- coder/reviewer cannot trigger swarm operations
- swarm-relay performs JSON parsing + tool forwarding only
