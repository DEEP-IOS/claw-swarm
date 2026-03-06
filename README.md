# 蜂群 Claw-Swarm v4.0

**Unified swarm intelligence plugin for OpenClaw: memory, pheromones, governance, and agent design.**

统一蜂群智能插件：记忆引擎、信息素通信、治理系统、智能体设计，一个插件全部搞定。

> One plugin. Memory + swarm intelligence + governance + agent design.

---

## Overview / 概述

Claw-Swarm v4.0 merges two previously separate OpenClaw plugins — **OME** (memory engine) and **Swarm Lite** (governance layer) — into a single, cohesive plugin. It adds bio-inspired **pheromone communication**, **agent persona design**, and **collaboration infrastructure** to create a complete swarm intelligence toolkit.

Claw-Swarm v4.0 将两个独立插件 — **OME**（记忆引擎）和 **Swarm Lite**（治理层）— 合并为统一插件，新增仿生**信息素通信**、**智能体人格设计**和**协作基础设施**，构建完整的蜂群智能工具箱。

### Key Features / 核心特性

| Feature | Description | 描述 |
|---------|-------------|------|
| **Memory** | Persistent agent memory with context injection | 持久化记忆 + 上下文注入 |
| **Pheromone** | 5-type bio-inspired indirect communication | 5 类仿生间接通信信号 |
| **Governance** | 4D capability scoring, voting, tier management | 四维能力评分、投票、分层管理 |
| **Soul Designer** | Persona templates with evolutionary learning | 人格模板 + 进化学习 |
| **Collaboration** | Peer directory, @mention routing, struggle detection | 同伴目录、@提及路由、困难检测 |
| **Orchestration** | Task distribution with multiple strategies | 多策略任务分发 |

### Architecture / 架构

```
Layer 4 — OpenClaw Plugin Adapter (sole coupling point / 唯一耦合点)
  hooks/, tools/, services/, plugin-adapter.js

Layer 3 — Swarm Intelligence (zero-dep, reusable / 零依赖，可复用)
  soul/, collaboration/, orchestration/

Layer 2 — Engines (zero-dep, reusable / 零依赖，可复用)
  memory/, pheromone/, governance/

Layer 1 — Core Infrastructure (zero-dep / 零依赖)
  db.js, types.js, errors.js, config.js, monitor.js, logger.js
```

Only Layer 4 depends on OpenClaw. Layers 1-3 are reusable in any Node.js 22+ environment.

仅 Layer 4 依赖 OpenClaw。Layer 1-3 可在任何 Node.js 22+ 环境中复用。

---

## Quick Start / 快速开始

### Installation / 安装

Place the `swarm` directory inside your OpenClaw `data/` folder:

将 `swarm` 目录放入 OpenClaw 的 `data/` 目录：

```
your-project/
├── .openclaw/
│   └── config.json      ← enable plugin here / 在此启用插件
└── data/
    └── swarm/            ← this plugin / 本插件
```

### Configuration / 配置

All 6 subsystems are independently toggleable. Minimal config (memory only):

6 个子系统独立开关。最小配置（仅记忆）：

```json
{
  "memory": { "enabled": true },
  "pheromone": { "enabled": false },
  "governance": { "enabled": false },
  "soul": { "enabled": false },
  "collaboration": { "enabled": false },
  "orchestration": { "enabled": false }
}
```

Full stack config:

```json
{
  "memory": { "enabled": true, "maxPrependChars": 4000 },
  "pheromone": { "enabled": true, "decayIntervalMs": 60000 },
  "governance": { "enabled": true },
  "soul": { "enabled": true },
  "collaboration": { "enabled": true, "mentionFixer": true },
  "orchestration": { "enabled": true, "maxWorkers": 16 }
}
```

---

## Pheromone System / 信息素系统

Bio-inspired indirect communication between agents. Pheromones are time-decaying signals that provide environmental awareness without requiring agents to know each other.

仿生间接通信系统。信息素是随时间衰减的信号，提供环境感知而无需智能体彼此认识。

| Type | Purpose | Decay | 用途 |
|------|---------|-------|------|
| `trail` | "I worked on X" | 120 min | 工作痕迹 |
| `alarm` | "Problem at X" | 30 min | 问题警报 |
| `recruit` | "Help needed at X" | 60 min | 求助信号 |
| `queen` | Priority directive | 480 min | 优先指令 |
| `dance` | "Found resource at X" | 90 min | 资源发现 |

**Decay model / 衰减模型:** `intensity(t) = initial × e^(-decayRate × minutes)`

---

## Migration from OME / 从 OME 迁移

Claw-Swarm v4.0 **replaces** OME. Do not run both simultaneously.

Claw-Swarm v4.0 **替代** OME。请勿同时运行两者。

Your existing OME data is automatically imported on first run:

现有 OME 数据在首次运行时自动导入：

1. The plugin detects your existing `ome.db`
2. Data is copied (non-destructive — original OME DB is untouched)
3. A backup of the swarm DB is created before migration
4. An `ome_imported` flag prevents duplicate imports

See [Migration Guide](docs/migration-guide.md) for details.

---

## Development / 开发

### Prerequisites / 前置条件

- Node.js >= 22.0.0 (required for `node:sqlite`)
- No external dependencies (zero-dep design)

### Testing / 测试

```bash
# All tests / 全部测试
npm test

# By category / 按类别
npm run test:unit
npm run test:integration
npm run test:stress

# Migration test (critical path) / 迁移测试（关键路径）
npm run test:migration
```

### Project Structure / 项目结构

```
src/
├── index.js                          # Plugin entry / 插件入口
├── layer1-core/                      # Core infrastructure / 核心基础设施
│   ├── db.js                         # Unified DB (25 tables, 69 functions)
│   ├── db-migration.js               # Schema migration with backup
│   ├── types.js                      # 19 enums + 21 typedefs
│   ├── errors.js                     # 11 error classes
│   ├── config.js                     # 6 subsystem toggles
│   ├── circuit-breaker.js            # Fault tolerance
│   ├── monitor.js                    # Ring buffer event tracking
│   └── logger.js                     # Leveled logging
├── layer2-engines/                   # Domain engines / 领域引擎
│   ├── memory/                       # Memory CRUD + context (5 files)
│   ├── pheromone/                    # Pheromone engine (3 files)
│   └── governance/                   # Capability + voting (5 files)
├── layer3-intelligence/              # Swarm intelligence / 蜂群智能
│   ├── soul/                         # Persona design (3 files)
│   ├── collaboration/                # Peer comm (3 files)
│   └── orchestration/                # Task mgmt (7 files)
└── layer4-adapter/                   # OpenClaw adapter / 适配层
    ├── plugin-adapter.js             # register(api) wiring
    ├── hooks/                        # 8 lifecycle hooks
    ├── tools/                        # 5 agent tools
    ├── services/                     # Background services
    └── skill-md/                     # SKILL.md injection
```

---

## License / 许可证

MIT License. Copyright 2025-2026 DEEP-IOS.

See [LICENSE](LICENSE) for full text.
