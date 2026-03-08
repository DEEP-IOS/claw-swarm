# Claw-Swarm V5.0

**Bio-inspired swarm intelligence plugin for OpenClaw with 6-layer architecture, 12 algorithms, and real-time monitoring.**

仿生蜂群智能插件：6 层架构、12 种仿生算法、实时监控仪表盘，为 OpenClaw 多智能体系统提供完整的协调基础设施。

![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)
![Version](https://img.shields.io/badge/version-5.0.0-blue)
![Tests](https://img.shields.io/badge/tests-471%20across%2030%20files-green)
![License](https://img.shields.io/badge/license-MIT-yellow)

---

## Overview / 概述

Claw-Swarm V5.0 is a ground-up rewrite that replaces the legacy 4-layer architecture with a clean **6-layer design** spanning 55+ source files. It powers OpenClaw's multi-agent coordination with bio-inspired communication (pheromones, gossip), structured memory (working/episodic/semantic), DAG-based orchestration, and a real-time SSE monitoring dashboard.

Claw-Swarm V5.0 是一次完整重写，以全新 **6 层架构**（55+ 源文件）取代旧版 4 层设计。通过仿生通信（信息素、流言协议）、结构化记忆（工作/情景/语义）、DAG 任务编排和实时 SSE 监控仪表盘，驱动 OpenClaw 的多智能体协调。

---

## Key Features / 核心特性

| Feature / 特性 | Description | 描述 |
|---|---|---|
| **6-Layer Architecture** | Clean separation: infra, comm, agent, orchestration, app, monitoring | 六层解耦：基础设施、通信、智能体、编排、应用、监控 |
| **12 Bio-Inspired Algorithms** | MMAS, ACO, Ebbinghaus, BFS, PARL, GEP, CPM, Jaccard, MoE, FIPA CNP, ABC, k-means++ | 12 种仿生/经典算法融合 |
| **3-Tier Memory** | Working (focus/context/scratchpad), Episodic (forgetting curve), Semantic (knowledge graph) | 三级记忆：工作记忆、情景记忆、语义知识图谱 |
| **Pheromone Communication** | MMAS-bounded signals with exponential decay and custom type registry | MMAS 边界信息素 + 指数衰减 + 自定义类型注册 |
| **DAG Orchestration** | Task decomposition, critical path analysis, contract-net negotiation | DAG 任务分解、关键路径分析、合同网协商 |
| **Real-Time Dashboard** | Fastify + SSE on port 19100, dark theme, RED metrics | 实时仪表盘（Fastify + SSE，端口 19100，暗色主题） |
| **Plugin SDK Integration** | 8 OpenClaw hooks, 7 agent tools, `{ id, register(api) }` pattern | 8 个钩子、7 个工具，标准 Plugin SDK 模式 |

---

## Architecture / 架构

```
┌─────────────────────────────────────────────────────────────┐
│  L6  Monitoring        监控层                                │
│      StateBroadcaster · MetricsCollector · DashboardService │
│      dashboard.html (SSE, port 19100)                       │
├─────────────────────────────────────────────────────────────┤
│  L5  Application       应用层                                │
│      PluginAdapter · ContextService · CircuitBreaker        │
│      7 Tool Factories (spawn/query/pheromone/gate/          │
│                        memory/plan/zone)                    │
├─────────────────────────────────────────────────────────────┤
│  L4  Orchestration     编排层                                │
│      Orchestrator · CriticalPathAnalyzer · QualityController│
│      PipelineBreaker · ResultSynthesizer · ExecutionPlanner │
│      ContractNet · ReplanEngine · ABCScheduler              │
│      RoleDiscovery · RoleManager · ZoneManager              │
├─────────────────────────────────────────────────────────────┤
│  L3  Agent             智能体层                              │
│      WorkingMemory · EpisodicMemory · SemanticMemory        │
│      ContextCompressor · CapabilityEngine · PersonaEvolution│
│      ReputationLedger · SoulDesigner                        │
├─────────────────────────────────────────────────────────────┤
│  L2  Communication     通信层                                │
│      MessageBus · PheromoneEngine · GossipProtocol          │
│      PheromoneTypeRegistry                                  │
├─────────────────────────────────────────────────────────────┤
│  L1  Infrastructure    基础设施层                             │
│      DatabaseManager (SQLite, 34 tables) · ConfigManager    │
│      MigrationRunner · 8 Repositories · 3 Schema modules    │
│      Logger · Types                                         │
└─────────────────────────────────────────────────────────────┘
```

Only L5 couples to OpenClaw via Plugin SDK. Layers L1--L4 and L6 are reusable in any Node.js 22+ environment.

仅 L5 通过 Plugin SDK 与 OpenClaw 耦合。L1--L4 及 L6 可在任何 Node.js 22+ 环境中独立复用。

---

## Quick Start / 快速开始

### Prerequisites / 前置条件

- **Node.js >= 22.0.0** (required for `node:sqlite` DatabaseSync)
- **OpenClaw** with Plugin SDK support

### Installation / 安装

```bash
# Clone the repo / 克隆仓库
git clone https://github.com/DEEP-IOS/claw-swarm.git
cd claw-swarm && npm install

# Link into OpenClaw extensions / 链接到 OpenClaw 扩展目录
# Linux/macOS:
ln -s "$(pwd)" ~/.openclaw/extensions/claw-swarm
# Windows (Admin CMD):
mklink /J "%USERPROFILE%\.openclaw\extensions\claw-swarm" "%cd%"

# Enable in ~/.openclaw/openclaw.json / 在配置中启用:
# "plugins": { "entries": { "claw-swarm": { "enabled": true } } }

# Restart gateway / 重启网关
openclaw gateway restart
```

### Configuration / 配置

Plugin-specific settings must be nested under the `config` key in `~/.openclaw/openclaw.json`. The `api.pluginConfig` receives this object directly.

插件配置必须嵌套在 `~/.openclaw/openclaw.json` 的 `config` 键内。`api.pluginConfig` 直接接收此对象。

```json
{
  "plugins": {
    "entries": {
      "claw-swarm": {
        "enabled": true,
        "config": {
          "memory": { "enabled": true, "maxPrependChars": 4000 },
          "pheromone": { "enabled": true, "decayIntervalMs": 60000 },
          "orchestration": { "enabled": true, "maxWorkers": 16 },
          "dashboard": { "enabled": false, "port": 19100 }
        }
      }
    }
  }
}
```

See [docs/installation.md](docs/installation.md) for full option reference. / 完整配置参考见安装文档。

---

## Bio-Inspired Algorithms / 仿生算法

| # | Algorithm / 算法 | Layer | Module | Purpose / 用途 |
|---|---|---|---|---|
| 1 | **MMAS** (Max-Min Ant System) | L2 | PheromoneEngine | Pheromone intensity bounding / 信息素强度上下界 |
| 2 | **ACO Roulette** (Ant Colony Optimization) | L2 | PheromoneEngine | Probabilistic path selection / 概率路径选择 |
| 3 | **Ebbinghaus Forgetting** | L3 | EpisodicMemory | Memory decay curve / 记忆遗忘曲线 |
| 4 | **BFS Knowledge Graph** | L3 | SemanticMemory | Relation traversal / 知识图谱关系遍历 |
| 5 | **PARL** (Persona A/B) | L3 | PersonaEvolution | Persona evolution via A/B testing / 人格 A/B 进化 |
| 6 | **GEP** (Gene Expression) | L4 | ExecutionPlanner | Execution plan generation / 执行计划生成 |
| 7 | **CPM** (Critical Path Method) | L4 | CriticalPathAnalyzer | Task dependency scheduling / 关键路径调度 |
| 8 | **Jaccard Dedup** | L4 | ResultSynthesizer | Result deduplication / 结果去重 |
| 9 | **MoE** (Mixture of Experts) | L4 | RoleManager | Expert role routing / 专家角色路由 |
| 10 | **FIPA CNP** (Contract-Net Protocol) | L4 | ContractNet | Task negotiation / 合同网任务协商 |
| 11 | **ABC** (Artificial Bee Colony) | L4 | ABCScheduler | Task scheduling optimization / 蜂群任务调度 |
| 12 | **k-means++** | L4 | RoleDiscovery | Automatic role clustering / 角色自动发现 |

---

## OpenClaw Hooks / OpenClaw 钩子

| Hook | Trigger | Internal Mapping / 内部映射 |
|---|---|---|
| `before_agent_start` | Agent begins | Context injection, memory prepend / 上下文注入 |
| `agent_end` | Agent finishes | Memory consolidation, Gossip update / 记忆固化 |
| `after_tool_call` | Tool completes | Tool monitoring, pheromone deposit / 工具监控 |
| `subagent_spawning` | Sub-agent created | SOUL injection, governance gating / 人格注入、治理门控 |
| `subagent_ended` | Sub-agent finishes | Quality gate, pheromone update / 质量门控 |
| `before_reset` | Conversation reset | Memory consolidation / 记忆固化 |
| `gateway_stop` | Gateway shutting down | Engine cleanup / 引擎关闭 |
| `message_sending` | Message routed | Sub-agent message routing / 消息路由 |

---

## Tools / 工具

7 agent tools registered via Plugin SDK / 通过 Plugin SDK 注册的 7 个智能体工具：

| Tool | Purpose | 用途 |
|---|---|---|
| `swarm_spawn` | Create and dispatch sub-agents | 创建并调度子智能体 |
| `swarm_query` | Query swarm state and agent status | 查询蜂群状态 |
| `swarm_pheromone` | Deposit and read pheromone signals | 发布和读取信息素信号 |
| `swarm_gate` | Governance gating and capability checks | 治理门控与能力检查 |
| `swarm_memory` | Read/write agent memory (working/episodic/semantic) | 读写智能体记忆 |
| `swarm_plan` | Create and manage execution plans | 创建和管理执行计划 |
| `swarm_zone` | Manage work zones and auto-assignment | 管理工作区与自动分配 |

---

## Development / 开发

### Prerequisites / 前置条件

| Requirement | Version |
|---|---|
| Node.js | >= 22.0.0 |
| Runtime deps | eventemitter3, fastify, nanoid, pino, zod |
| Dev deps | vitest |

### Testing / 测试

```bash
# All tests (471 tests, 30 files) / 全部测试
npm test

# By category / 按类别
npm run test:unit
npm run test:integration
npm run test:stress

# By layer / 按层级
npm run test:L1
npm run test:L2
npm run test:L3
npm run test:L4
npm run test:L5
npm run test:L6

# Watch mode / 监听模式
npm run test:watch

# Coverage report / 覆盖率
npm run test:coverage
```

---

## Project Structure / 项目结构

```
src/
├── index.js                                  # Plugin entry { id, register(api) }
│                                             # 插件入口
├── L1-infrastructure/                        # 基础设施层 (17 files)
│   ├── types.js                              # Type definitions / 类型定义
│   ├── logger.js                             # Pino-based logging / 日志
│   ├── config/
│   │   └── config-manager.js                 # Zod-validated config / 配置管理
│   ├── database/
│   │   ├── database-manager.js               # SQLite DatabaseSync (34 tables)
│   │   ├── migration-runner.js               # Schema migrations / 迁移
│   │   ├── sqlite-binding.js                 # node:sqlite binding
│   │   └── repositories/                     # 8 data repositories
│   │       ├── agent-repo.js
│   │       ├── episodic-repo.js
│   │       ├── knowledge-repo.js
│   │       ├── pheromone-repo.js
│   │       ├── pheromone-type-repo.js
│   │       ├── plan-repo.js
│   │       ├── task-repo.js
│   │       └── zone-repo.js
│   └── schemas/
│       ├── config-schemas.js                 # Config Zod schemas
│       ├── database-schemas.js               # DB table schemas
│       └── message-schemas.js                # Message format schemas
│
├── L2-communication/                         # 通信层 (4 files)
│   ├── message-bus.js                        # Pub/sub + wildcards + DLQ
│   ├── pheromone-engine.js                   # MMAS bounds, exponential decay
│   ├── gossip-protocol.js                    # Epidemic broadcast + heartbeat
│   └── pheromone-type-registry.js            # Custom pheromone types
│
├── L3-agent/                                 # 智能体层 (8 files)
│   ├── memory/
│   │   ├── working-memory.js                 # 3-tier: focus/context/scratchpad
│   │   ├── episodic-memory.js                # Ebbinghaus forgetting curve
│   │   ├── semantic-memory.js                # BFS knowledge graph
│   │   └── context-compressor.js             # LLM context compression
│   ├── capability-engine.js                  # 4D capability scoring
│   ├── persona-evolution.js                  # PARL A/B testing
│   ├── reputation-ledger.js                  # Agent reputation tracking
│   └── soul-designer.js                      # 4 bee persona templates
│
├── L4-orchestration/                         # 编排层 (12 files)
│   ├── orchestrator.js                       # DAG task decomposition
│   ├── critical-path.js                      # CPM scheduling
│   ├── quality-controller.js                 # Multi-rubric quality gate
│   ├── pipeline-breaker.js                   # State machine breaker
│   ├── result-synthesizer.js                 # Jaccard deduplication
│   ├── execution-planner.js                  # GEP plan generation
│   ├── contract-net.js                       # FIPA CNP negotiation
│   ├── replan-engine.js                      # Pheromone-triggered replan
│   ├── abc-scheduler.js                      # Artificial Bee Colony
│   ├── role-discovery.js                     # k-means++ clustering
│   ├── role-manager.js                       # MoE expert routing
│   └── zone-manager.js                       # Jaccard auto-assign
│
├── L5-application/                           # 应用层 (10 files)
│   ├── plugin-adapter.js                     # Engine lifecycle manager
│   ├── context-service.js                    # Rich LLM context builder
│   ├── circuit-breaker.js                    # 3-state circuit breaker
│   └── tools/
│       ├── swarm-spawn-tool.js
│       ├── swarm-query-tool.js
│       ├── swarm-pheromone-tool.js
│       ├── swarm-gate-tool.js
│       ├── swarm-memory-tool.js
│       ├── swarm-plan-tool.js
│       └── swarm-zone-tool.js
│
└── L6-monitoring/                            # 监控层 (4 files)
    ├── state-broadcaster.js                  # SSE push to clients
    ├── metrics-collector.js                  # RED metrics (Rate/Errors/Duration)
    ├── dashboard-service.js                  # Fastify HTTP server
    └── dashboard.html                        # Dark theme web dashboard

tests/
├── unit/
│   ├── L1/   (4 files)                       # Infrastructure tests
│   ├── L2/   (3 files)                       # Communication tests
│   ├── L3/   (5 files)                       # Agent tests
│   ├── L4/  (11 files)                       # Orchestration tests
│   ├── L5/   (3 files)                       # Application tests
│   └── L6/   (3 files)                       # Monitoring tests
├── integration/  (1 file)                    # Full pipeline tests
└── stress/       (legacy)                    # Stress/edge-case tests
```

---

## License / 许可证

MIT License. Copyright 2025-2026 DEEP-IOS.

See [LICENSE](LICENSE) for full text.
