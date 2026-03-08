# Claw-Swarm V5.0 --- 详细中文文档

**6 层仿生蜂群智能插件 | OpenClaw 多智能体协作基础设施**

> Node.js >= 22.0.0 | 55+ 源文件 | 475 测试 | 12 仿生算法 | 7 工具 | 6 钩子

[English](README.md) | **中文**


[1 概述](#1-项目概述) | [2 特性](#2-核心特性) | [3 架构](#3-六层架构详解) | [4 算法](#4-十二个仿生算法) | [5 安装](#5-安装与配置) | [6 信息素](#6-信息素系统) | [7 记忆](#7-记忆系统)
[8 灵魂](#8-灵魂设计器) | [9 工具](#9-工具参考) | [10 钩子](#10-钩子映射) | [11 仪表盘](#11-仪表盘) | [12 开发](#12-开发指南) | [13 升级](#13-从-v40-升级) | [14 许可证](#14-许可证)


## 1. 项目概述

### 解决什么问题？

| 挑战 | 表现 | V5.0 方案 |
|------|------|-----------|
| **协作盲区** | 智能体彼此不知道对方的工作进度 | 信息素间接通信 + Gossip 协议 |
| **记忆碎片** | 上下文窗口重置后知识丢失 | 三层记忆架构（工作/情景/语义） |
| **调度低效** | 手动分配任务，缺乏自适应能力 | DAG 分解 + 合同网 + ABC 调度 |

### 为什么 6 层？

v4.0 的 4 层架构在引入 DAG 编排、合同网协议、知识图谱等模块后变得臃肿。V5.0 重新划分职责：

- **L1 基础设施**: 数据持久化、配置校验、迁移 --- 不含业务逻辑
- **L2 通信**: 消息总线、信息素、Gossip --- 纯通信原语
- **L3 智能体**: 记忆、能力、人格 --- 单个智能体的认知能力
- **L4 编排**: DAG、调度、质控 --- 跨智能体的任务协调
- **L5 应用**: 插件适配、工具工厂 --- OpenClaw 耦合层
- **L6 监控**: 仪表盘、指标、SSE 推送 --- 可观测性

依赖严格向下流动（L6 -> L5 -> ... -> L1），仅 L5 耦合 OpenClaw，L1-L4 可在任何 Node.js 22+ 环境独立复用。

---

## 2. 核心特性

| 分类 | 特性 | 算法/技术 | 层级 |
|------|------|-----------|------|
| 通信 | 发布/订阅消息总线 | 通配符匹配 + DLQ | L2 |
| 通信 | 信息素引擎 | MMAS + 指数衰减 | L2 |
| 通信 | 流言协议 | 流行病广播 | L2 |
| 记忆 | 工作记忆 | 3 层: 焦点/上下文/草稿 | L3 |
| 记忆 | 情景记忆 | Ebbinghaus 遗忘曲线 | L3 |
| 记忆 | 语义记忆 | BFS 知识图谱 | L3 |
| 智能体 | 能力评估 | 4D 评分 (编码/测试/文档/安全) | L3 |
| 智能体 | 人格进化 | PARL A/B 测试 | L3 |
| 智能体 | 声誉账本 | 加权移动平均 | L3 |
| 编排 | 任务分解 / 关键路径 | DAG 拓扑 + CPM | L4 |
| 编排 | 质量门控 / 级联熔断 | 多维阈值 | L4 |
| 编排 | 结果综合 / 执行规划 | Jaccard + GEP | L4 |
| 编排 | 任务招标 / 资源调度 | FIPA CNP + ABC | L4 |
| 编排 | 角色发现 / 角色路由 | k-means++ + MoE | L4 |
| 编排 | 区域管理 | 虚拟拓扑分区 | L4 |
| 应用 | 熔断器 | 半开探测 + 指数退避 | L5 |
| 监控 | 实时指标 + 状态推送 | RED + SSE | L6 |

---

## 3. 六层架构详解

```
┌─────────────────────────────────────────────────────────────────┐
│ L6 监控层 (4)   StateBroadcaster(SSE) MetricsCollector(RED)     │
├─────────────────────────────────────────────────────────────────┤
│ L5 应用层 (10)  PluginAdapter  ContextService  CircuitBreaker   │
│                 swarm_spawn/query/pheromone/gate/memory/plan/zone│
├─────────────────────────────────────────────────────────────────┤
│ L4 编排层 (12)  Orchestrator  CriticalPath  QualityCtrl         │
│   PipelineBreaker  ResultSynth  ExecPlanner  ContractNet        │
│   ReplanEngine  ABCScheduler  RoleDiscovery  RoleManager  Zone  │
├─────────────────────────────────────────────────────────────────┤
│ L3 智能体层 (8) WorkingMemory  EpisodicMemory  SemanticMemory   │
│   ContextCompressor  CapabilityEngine  PersonaEvolution         │
│   ReputationLedger  SoulDesigner                                │
├─────────────────────────────────────────────────────────────────┤
│ L2 通信层 (4)   MessageBus  PheromoneEngine  GossipProtocol     │
│                 PheromoneTypeRegistry                            │
├─────────────────────────────────────────────────────────────────┤
│ L1 基础设施 (17) DatabaseManager(SQLite/34表/WAL) 8 Repos       │
│                  ConfigManager(Zod) MigrationRunner schemas/    │
└─────────────────────────────────────────────────────────────────┘
```

### 各层模块一览

| 层 | 模块 | 职责 |
|----|------|------|
| L1 | DatabaseManager | SQLite WAL, 34 表, `node:sqlite` DatabaseSync |
| L1 | MigrationRunner | 版本化迁移，事务回滚，自动备份 |
| L1 | ConfigManager | Zod 校验，默认值 -> 文件 -> 运行时三层合并 |
| L1 | 3 Schemas + Types + Logger + 8 Repos | config/message/database 模式; 枚举; pino 日志; 8 个数据仓库 |
| L2 | MessageBus | 发布/订阅，通配符主题（`task.*`），死信队列 (DLQ) |
| L2 | PheromoneEngine | MMAS 信息素管理，指数衰减，上下限钳位 |
| L2 | GossipProtocol | 流行病广播，Agent 状态最终一致 |
| L2 | PheromoneTypeRegistry | 自定义信息素类型注册，可扩展衰减函数 |
| L3 | WorkingMemory | 3 层: 焦点 (5 槽) / 上下文 (15 槽) / 草稿 (2000 字符) |
| L3 | EpisodicMemory | Ebbinghaus 遗忘曲线，按重要性衰减，复习强化 |
| L3 | SemanticMemory | BFS 知识图谱，实体-关系-实体三元组 |
| L3 | ContextCompressor | 超长上下文压缩，优先保留高重要性记忆 |
| L3 | CapabilityEngine | 4D 评分 (coding/testing/documentation/security) |
| L3 | PersonaEvolution | PARL A/B 测试，自动优化人格分配 |
| L3 | ReputationLedger / SoulDesigner | 声誉加权平均; 4 蜜蜂人格 + 6 段 SOUL 生成 |
| L4 | Orchestrator + CriticalPath | DAG 分解 + CPM 关键路径 (ES/EF/LS/LF) |
| L4 | QualityController + PipelineBreaker | 多维质量门控 + 级联失败熔断 |
| L4 | ResultSynthesizer + ExecutionPlanner | Jaccard 合并 + GEP 基因规划 |
| L4 | ContractNet + ReplanEngine | FIPA CNP 招标 + 运行时重规划 |
| L4 | ABCScheduler | 雇佣蜂 (50%) / 旁观蜂 (45%) / 侦察蜂 (5%) |
| L4 | RoleDiscovery + RoleManager + ZoneManager | k-means++ 聚类 + MoE 路由 + 虚拟区域 |
| L5 | PluginAdapter + ContextService + CircuitBreaker | 引擎组装 + 上下文构建 + 熔断器 |
| L5 | 7 Tool Factories | swarm_spawn/query/pheromone/gate/memory/plan/zone |
| L6 | StateBroadcaster + MetricsCollector | SSE 推送 + RED 指标 |
| L6 | DashboardService + dashboard.html | Fastify 服务 (端口 19100) + 单页 UI |

---

## 4. 十二个仿生算法

| # | 算法 | 全称 | 在 V5.0 中的应用 | 层 |
|---|------|------|------------------|-----|
| 1 | **MMAS** | Max-Min Ant System | 信息素浓度上下限钳位，防止过早收敛 | L2 |
| 2 | **ACO 轮盘** | ACO Roulette Selection | 按信息素浓度加权随机选路，平衡探索/利用 | L2 |
| 3 | **Ebbinghaus** | Ebbinghaus Forgetting Curve | 情景记忆衰减 `R(t) = e^(-t/S)`，重要记忆衰减慢 | L3 |
| 4 | **BFS** | Breadth-First Search | 语义记忆知识图谱遍历，发现关联实体 | L3 |
| 5 | **PARL** | Persona A/B Reinforcement Learning | 人格 x 任务结果记录，优化匹配 | L3 |
| 6 | **GEP** | Gene Expression Programming | 执行计划生成，基因编码任务依赖和约束 | L4 |
| 7 | **CPM** | Critical Path Method | 关键路径分析，计算 ES/EF/LS/LF 和松弛时间 | L4 |
| 8 | **Jaccard** | Jaccard Similarity Index | 结果综合时检测重叠，合并相似子任务输出 | L4 |
| 9 | **MoE** | Mixture of Experts | 角色路由，Top-K 专家选择 + 置信度阈值 | L4 |
| 10 | **FIPA CNP** | FIPA Contract Net Protocol | 任务招标: CFP -> Bid -> Award -> Report | L4 |
| 11 | **ABC** | Artificial Bee Colony | 三类蜂调度：雇佣蜂开发、旁观蜂跟随、侦察蜂探索 | L4 |
| 12 | **k-means++** | k-means++ Clustering | 从历史能力数据自动聚类发现角色原型 | L4 |

---

## 5. 安装与配置

### 前置条件

- **Node.js >= 22.0.0** (必须，依赖 `node:sqlite` 的 `DatabaseSync`)
- OpenClaw CLI 已安装

### 安装步骤

```bash
git clone https://github.com/DEEP-IOS/claw-swarm.git
cd claw-swarm
node install.js          # 一键安装（自动注册路径 + 启用插件 + 安装依赖）
openclaw gateway restart # 加载插件
```

安装脚本自动完成以下操作：
1. 检查 Node.js >= 22 和 OpenClaw 环境
2. 安装 npm 依赖
3. 在 `~/.openclaw/openclaw.json` 中注册 `plugins.load.paths`（兼容 Windows）
4. 启用插件并写入默认配置

手动安装和高级选项请参见 [docs/installation.md](docs/installation.md)。

### 依赖项

| 类别 | 包名 | 用途 |
|------|------|------|
| 运行时 | `eventemitter3` | L2 MessageBus 事件发射 |
| 运行时 | `fastify` | L6 Dashboard HTTP 服务 |
| 运行时 | `nanoid` | 唯一 ID 生成 |
| 运行时 | `pino` | 结构化日志 |
| 运行时 | `zod` | L1 配置校验 |
| 开发时 | `vitest` | 测试框架 |

### 完整配置示例

插件配置必须嵌套在 `~/.openclaw/openclaw.json` 的 `config` 键内。`api.pluginConfig` 直接接收此对象，全部字段均可选（有 Zod 默认值）：

```json
{
  "plugins": {
    "entries": {
      "claw-swarm": {
        "enabled": true,
        "config": {
          "dbPath": null,
          "memory": {
            "enabled": true,
            "maxPrependChars": 4000,
            "workingMemory": { "focusSlots": 5, "contextSlots": 15, "scratchpadMaxChars": 2000 },
            "episodicMemory": { "maxEvents": 1000, "importanceThreshold": 0.3, "decayLambdaDays": 30 },
            "knowledgeGraph": { "maxTraversalDepth": 3, "minImportance": 0.3 }
          },
          "pheromone": { "enabled": true, "decayIntervalMs": 60000 },
          "governance": { "enabled": true },
          "soul": { "enabled": true },
          "orchestration": {
            "enabled": true, "maxWorkers": 16, "defaultStrategy": "simulated",
            "executionMode": "dependency", "maxRoles": 8,
            "moeRouting": { "enabled": true, "topK": 3, "minConfidence": 0.3, "fallbackRegex": true },
            "abcScheduler": { "enabled": false, "employedRatio": 0.5, "onlookerRatio": 0.45, "scoutRatio": 0.05 },
            "contractNet": { "enabled": false, "bidTimeoutMs": 5000 },
            "replanCooldownMs": 30000
          },
          "dashboard": { "enabled": false, "port": 19100 }
        }
      }
    }
  }
}
```

---

## 6. 信息素系统

### 信息素类型

V5.0 通过 `PheromoneTypeRegistry` 支持自定义类型，保留 5 种内置类型：

| 类型 | 语义 | 默认衰减 | 典型场景 |
|------|------|----------|----------|
| `trail` | "我在 X 工作过" | 120 分钟 | 避免重复工作，发现热点区域 |
| `alarm` | "X 有问题" | 30 分钟 | 警告危险区域，系统性故障检测 |
| `recruit` | "X 需要帮助" | 60 分钟 | 请求支援，触发合同网 CFP |
| `queen` | 优先指令 | 480 分钟 | 战略级指令，全局优先级调整 |
| `dance` | "在 X 发现资源" | 90 分钟 | 分享发现（类比蜜蜂摇摆舞） |

### 衰减模型与 MMAS 边界

指数衰减公式：`intensity(t) = initial * e^(-decayRate * t)`（t 为分钟数）

| MMAS 参数 | 说明 |
|-----------|------|
| `tau_max` | 信息素浓度上限，防止单一路径垄断 |
| `tau_min` | 信息素浓度下限，保证探索概率不为零 |
| `rho` | 全局蒸发率 |

衰减定时器按 `decayIntervalMs`（默认 60 秒）周期运行，清理低于 `tau_min` 的信息素。

### 信息素感知困难检测

```
智能体连续失败 3 次
  -> 查询附近 ALARM 信息素数量
  -> >= 2 个 ALARM -> 系统性故障，不发 RECRUIT（避免误报）
  -> < 2 个 ALARM  -> 个体困难，发射 RECRUIT 信息素请求支援
```

---

## 7. 记忆系统

V5.0 引入 **三层记忆架构**，对应人类认知科学中的短期记忆、情景记忆和语义记忆。

### 工作记忆 (WorkingMemory)

模拟人类短期记忆的容量限制：

| 区域 | 默认容量 | 优先级 | 内容 |
|------|----------|--------|------|
| **焦点 (Focus)** | 5 槽位 | 最高 | 当前任务直接相关的信息 |
| **上下文 (Context)** | 15 槽位 | 中等 | 背景知识、相关历史 |
| **草稿 (Scratchpad)** | 2000 字符 | 最低 | 临时计算、中间结果 |

上下文注入时，焦点区内容优先写入 `prependContext`，超出 `maxPrependChars` 则由 ContextCompressor 压缩。

### 情景记忆 (EpisodicMemory)

基于 **Ebbinghaus 遗忘曲线** 的长期事件记忆：`R(t) = e^(-t / S)`

- `t` = 距离事件发生的时间（天），`S` = 记忆强度
- 高重要性事件衰减更慢；复习操作重置衰减并提升强度

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `maxEvents` | 1000 | 保留的最大事件数 |
| `importanceThreshold` | 0.3 | 低于此阈值的事件不持久化 |
| `decayLambdaDays` | 30 | 指数衰减 lambda（天） |

### 语义记忆 (SemanticMemory)

基于 **BFS 知识图谱** 的结构化知识存储：

- 三元组存储：`(实体A) --[关系]--> (实体B)`
- BFS 遍历发现关联知识，默认最大深度 3，节点按重要性排序
- 上下文注入集成：任务描述 -> 提取关键词 -> BFS 查询 -> 注入上下文

---

## 8. 灵魂设计器

### 4 种蜜蜂人格

| 人格 | 中文名 | 性格特征 | 适用场景 |
|------|--------|----------|----------|
| `scout-bee` | 侦察蜂 | 好奇、冒险、探索性 | 研究、原型、技术探索 |
| `worker-bee` | 工蜂 | 可靠、系统、细致 | 实现、测试、构建 |
| `guard-bee` | 守卫蜂 | 谨慎、彻底、警觉 | 安全审计、代码审查、验证 |
| `queen-messenger` | 信使蜂 | 战略、协调、权威 | 规划、架构决策、协调 |

### SOUL 片段结构 (6 段)

SoulDesigner 为每个智能体生成 SOUL 片段，注入 LLM 系统提示：

1. **Identity** --- 身份与角色
2. **Capability** --- 能力自知（基于 4D 评分）
3. **Behavior** --- 行为指南（cooperative / independent / aggressive / cautious / adaptive）
4. **Constraints** --- 约束与限制（基于 tier: trainee / junior / mid / senior / lead）
5. **Protocol** --- 通信协议（基于 persona 风格）
6. **Zone** --- Zone 归属与范围

### PARL 人格进化

Persona A/B Reinforcement Learning --- 基于任务结果的自适应人格分配：

1. 记录每次 `(人格, 任务类型, 结果)` 三元组
2. 计算每种人格在各类任务上的胜率
3. 新任务到来时，按胜率加权推荐最优人格
4. 随机分配探索组进行 A/B 测试，持续优化

---

## 9. 工具参考

V5.0 提供 7 个 OpenClaw 工具，智能体可在对话中直接调用：

| 工具 | 用途 | 关键参数 |
|------|------|----------|
| `swarm_spawn` | 生成子智能体 | persona, tier, taskDescription, zoneId |
| `swarm_query` | 查询蜂群状态 | 查询类型 (agents / tasks / roles / zones) |
| `swarm_pheromone` | 信息素操作 | 操作 (emit / query / scan), type, scope |
| `swarm_gate` | 治理门控 | agentId, action (evaluate / vote / promote) |
| `swarm_memory` | 记忆操作 | 操作 (store / recall / forget), layer (working / episodic / semantic) |
| `swarm_plan` | 执行规划 | taskDescription, strategy (dag / sequential / parallel) |
| `swarm_zone` | 区域管理 | 操作 (create / join / leave / list) |

### 调用示例

```
swarm_pheromone  操作=emit   type=trail  scope=/task/auth-refactor  intensity=0.8
swarm_pheromone  操作=scan   scope=/task/*
swarm_memory     操作=store  layer=semantic  entity="AuthService"  relation="depends_on"  target="UserRepo"
swarm_plan       taskDescription="重构认证模块"  strategy=dag
```

---

## 10. 钩子映射

V5.0 通过 OpenClaw Plugin SDK 的 `{ id, register(api) }` 模式注册。

### OpenClaw 事件 -> V5.0 映射

通过 Plugin SDK 注册 6 个钩子：

| OpenClaw 事件 | V5.0 内部处理器 | 执行动作 |
|---------------|-----------------|----------|
| `before_agent_start` | `onAgentStart` + `onSubAgentSpawn` + `onPrependContext` | 注册 + SOUL 注入 + 上下文注入（记忆/知识图谱/信息素） |
| `agent_end` | `onSubAgentComplete`/`onSubAgentAbort` + `onAgentEnd` | 质量门控 + 信息素强化 + 记忆固化 + Gossip 更新 |
| `after_tool_call` | `onToolCall` + `onToolResult` | 工作记忆记录 + 能力维度更新 |
| `before_reset` | `onMemoryConsolidate` | 工作记忆 -> 情景记忆固化 |
| `gateway_stop` | `close()` | 定时器停止 + 引擎销毁 + 数据库关闭 |
| `message_sending` | `onSubAgentMessage` | 消息路由（点对点/广播） |

子 Agent 生命周期由 `swarm_spawn` 工具驱动：SOUL 片段通过工具结果返回，Agent 结束时自动触发质量门控和信息素更新。

### V5.0 内部钩子 (通过 L2 MessageBus 触发)

| 内部钩子 | 触发条件 |
|----------|----------|
| `onTaskDecompose` | DAG 任务分解完成 |
| `onReplanTrigger` | 重规划条件满足 |
| `onZoneEvent` | Zone 内拓扑变更 |
| `onPheromoneThreshold` | 信息素浓度超过阈值 |

---

## 11. 仪表盘

在配置中开启 `"dashboard": { "enabled": true, "port": 19100 }`，浏览器访问 `http://localhost:19100`。

| 组件 | 技术 | 展示内容 |
|------|------|----------|
| StateBroadcaster | SSE | 实时推送 Agent 状态、任务进度、信息素变化 |
| MetricsCollector | RED | Rate (吞吐量)、Error (错误率)、Duration (延迟) |
| DashboardService | Fastify | HTTP API + 静态页面托管 |
| dashboard.html | 原生 HTML/JS | 可视化图表、事件流、Agent 拓扑 |

SSE 端点 `/events` 提供实时数据流，前端无需轮询。

---

## 12. 开发指南

### 测试

```bash
npm test                    # 全部 (471 tests, 30 files)
npm run test:L1~L6          # 按层级运行 (test:L1, test:L2, ..., test:L6)
npm run test:unit           # 单元测试
npm run test:integration    # 集成测试
npm run test:stress         # 压力测试
npm run test:watch          # 监视模式
npm run test:coverage       # 覆盖率
```

### 项目结构

```
src/
├── index.js                        # 插件入口 { id, register(api) }
├── L1-infrastructure/ (17)         # database-manager, migration-runner, sqlite-binding,
│                                   # repositories/(8), config-manager, schemas/(3), types, logger
├── L2-communication/ (4)           # message-bus, pheromone-engine, gossip-protocol, type-registry
├── L3-agent/ (8)                   # memory/(working,episodic,semantic,compressor),
│                                   # capability-engine, persona-evolution, reputation-ledger, soul-designer
├── L4-orchestration/ (12)          # orchestrator, critical-path, quality-controller, pipeline-breaker,
│                                   # result-synthesizer, execution-planner, contract-net, replan-engine,
│                                   # abc-scheduler, role-discovery, role-manager, zone-manager
├── L5-application/ (10)            # plugin-adapter, context-service, circuit-breaker,
│                                   # tools/(spawn,query,pheromone,gate,memory,plan,zone)
└── L6-monitoring/ (4)              # state-broadcaster, metrics-collector, dashboard-service, dashboard.html

tests/unit/L1~L6/ + integration/ + stress/    # 471 tests across 30 files
```

---

## 13. 从 v4.0 升级

### 架构变更对比

| 维度 | v4.0 | V5.0 |
|------|------|------|
| 层数 | 4 层 | 6 层 |
| 源文件 | ~35 | 55+ |
| 测试 | ~200 | 471 (30 文件) |
| 数据库表 | 25 | 34 |
| 工具数 | 5 | 7 (新增 swarm_plan, swarm_zone) |
| 依赖 | 零依赖 | eventemitter3, fastify, nanoid, pino, zod |
| 记忆 | 单层 | 三层 (工作/情景/语义) |
| 信息素 | 基础引擎 | MMAS + TypeRegistry + ACO |
| 编排 | 基础分发 | DAG + CPM + CNP + ABC + MoE |
| 配置 | 手动校验 | Zod Schema |
| 监控 | 无 | L6 仪表盘 (SSE + RED) |

### 迁移步骤

1. **备份数据库**: 迁移前手动备份 `swarm.db`（MigrationRunner 也会自动备份）
2. **更新依赖**: `npm install` 安装新增运行时依赖
3. **更新配置**: v4.0 配置仍兼容，V5.0 新增 `workingMemory`、`episodicMemory`、`knowledgeGraph`、`moeRouting`、`abcScheduler`、`contractNet`、`dashboard` 等配置块
4. **数据库迁移**: 首次启动时自动从 25 表迁移到 34 表
5. **目录映射**: `layer1-core/` -> `L1-infrastructure/`; `layer2-engines/` -> `L2-communication/` + `L3-agent/`; `layer3-intelligence/` -> `L3-agent/` + `L4-orchestration/`; `layer4-adapter/` -> `L5-application/`

### 破坏性变更

- 插件入口仍为 `src/index.js`，导出格式不变 (`{ id, register(api) }`)
- v4.0 旧目录 (`layer1-core/`、`layer2-engines/`、`layer3-intelligence/`、`layer4-adapter/`) 已移除，代码完全迁移至新的 L1-L6 层级
- 工具名统一为 `swarm_` 前缀（v4.0 的 `collaborate-tool`、`swarm-manage-tool`、`swarm-design-tool` 已重命名）

---

## 14. 许可证

MIT License. Copyright 2025-2026 DEEP-IOS.

详见 [LICENSE](LICENSE)。
