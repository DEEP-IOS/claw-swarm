# 蜂群 Claw-Swarm v4.0 — 详细中文文档

**统一蜂群智能插件：记忆引擎、信息素通信、治理系统、智能体设计，一个插件全部搞定。**

---

## 项目背景

### 为什么合并？

在 OpenClaw 的多智能体生态中，我们曾经维护两个独立插件：

1. **OME v1.1.0**（记忆引擎）— 负责智能体的持久化记忆和上下文注入
2. **Swarm Lite v3.0**（治理层）— 负责能力评分、投票、分层管理

经过战略分析，我们发现：

- **治理层单独使用价值有限**，但在异构智能体生态中有真正价值（不同 SOUL.md、技能、模型的智能体需要能力评分）
- **OME 已经追踪智能体执行数据** — 天然的能力评分数据源
- **子智能体之间缺乏兄弟通信** — 信息素系统填补这个空白
- **教智能体协作很痛苦** — 同伴目录 + 协作工具解决这个问题

因此，我们决定将两者合并为 **蜂群 Claw-Swarm v4.0**，同时新增信息素通信、智能体设计和协作基础设施。

### 产品叙事

> "一个插件。记忆 + 蜂群智能 + 治理 + 智能体设计。"

---

## 架构总览

### 4 层架构

```
┌──────────────────────────────────────────────────┐
│ Layer 4 — OpenClaw 插件适配层（唯一耦合点）       │
│   hooks/ (8) │ tools/ (5) │ services/ (1)        │
├──────────────────────────────────────────────────┤
│ Layer 3 — 蜂群智能（零依赖，可复用）              │
│   soul/ (3) │ collaboration/ (3) │ orch/ (7)     │
├──────────────────────────────────────────────────┤
│ Layer 2 — 领域引擎（零依赖，可复用）              │
│   memory/ (5) │ pheromone/ (3) │ governance/ (5)  │
├──────────────────────────────────────────────────┤
│ Layer 1 — 核心基础设施（零依赖）                  │
│   db │ types │ errors │ config │ monitor │ logger │
└──────────────────────────────────────────────────┘
```

**设计原则：**
- 依赖严格向下流动（4 → 3 → 2 → 1）
- 仅 Layer 4 耦合 OpenClaw
- Layer 1-3 可在任何 Node.js 22+ 环境复用
- 每个子系统独立开关

### 6 个子系统

| 子系统 | 默认 | 职责 |
|--------|------|------|
| **memory** | 开 | 持久化记忆、上下文注入、检查点 |
| **pheromone** | 开 | 仿生间接通信（5 种信息素类型） |
| **governance** | 关 | 四维能力评分、投票、分层管理 |
| **soul** | 开 | 智能体人格模板、进化学习 |
| **collaboration** | 开 | 同伴目录、@提及路由、困难检测 |
| **orchestration** | 开 | 多策略任务分发、角色管理 |

用户可运行任意组合 — 从仅 memory（作为 OME 替代）到全栈。

---

## 核心特性详解

### 信息素系统

**为什么不能用 memory 或 collaborate-tool 替代？**

| 特性 | 记忆 | 信息素 |
|------|------|--------|
| 持久性 | 永久 | 随时间衰减 |
| 通信模式 | 点对点 | 广播（一对多） |
| 累积 | 覆盖 | 叠加（多个信号强度累加） |
| 感知成本 | 主动查询 | 被动注入（零成本） |

**5 种信息素类型：**

| 类型 | 含义 | 衰减 | 场景 |
|------|------|------|------|
| trail | "我在 X 工作过" | 120 分钟 | 避免重复工作 |
| alarm | "X 有问题" | 30 分钟 | 警告危险区域 |
| recruit | "X 需要帮助" | 60 分钟 | 请求支援 |
| queen | 优先指令 | 480 分钟 | 战略级指令 |
| dance | "在 X 发现资源" | 90 分钟 | 分享发现 |

**衰减公式：** `intensity(t) = initial × e^(-decayRate × minutes)`

### 灵魂设计器

4 个内置蜜蜂人格（可通过配置扩展）：

| 人格 | 性格特征 | 适用场景 |
|------|----------|----------|
| scout-bee 侦察蜂 | 好奇、冒险 | 研究、原型、探索 |
| worker-bee 工蜂 | 可靠、细致 | 实现、测试、构建 |
| guard-bee 守卫蜂 | 谨慎、彻底 | 安全、审查、验证 |
| queen-messenger 信使蜂 | 战略、协调 | 规划、架构、协调 |

**进化学习：** 系统记录每次任务的人格 × 结果，计算胜率，随时间优化推荐。

### 困难检测（信息素感知）

传统做法：连续失败 N 次 → 求助。问题：误判"系统性故障"为"个体困难"。

**Claw-Swarm v4.0 方案：**
```
智能体连续失败 3 次
  → 检查附近 ALARM 信息素数量
  → 若 >= 2 个 ALARM → 系统性问题（如 API 挂了），不发 RECRUIT
  → 若 < 2 个 ALARM → 个体困难，发射 RECRUIT 信息素
```

此机制将系统故障场景的误报率从约 40% 降至约 10%。

### 同伴目录（惰性读取）

**为什么不缓存？** OpenClaw 支持热插拔智能体。缓存会过期。

**方案：** 每次访问 `getDirectory()` 时实时读取 `api.config.agents`。性能开销可接受（读配置对象，非 DB 操作）。

---

## 快速开始

### 前置条件

- Node.js >= 22.0.0（需要 `node:sqlite`）
- 零外部依赖

### 安装

将 `swarm` 目录放入 OpenClaw 的 `data/` 目录即可。

### 最小配置（仅记忆）

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

### 全栈配置

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

## 统一数据库

### 25 张表

单个 `swarm.db` 文件，WAL 模式，支持并发读取。

| 来源 | 表数 | 表名 |
|------|------|------|
| OME | 6 | memories, daily_summaries, checkpoints, events, tasks, event_cursors |
| 编排 | 5 | swarm_tasks, swarm_roles, swarm_checkpoints, swarm_artifacts, swarm_locks |
| 治理 | 11 | agents, capabilities, capability_details, skills, contributions, votes, vote_results, behavior_tags, collaboration_history, event_log, evaluation_queue |
| v4.0 新增 | 2 | pheromones, persona_outcomes |
| 元数据 | 1 | swarm_meta |

### 迁移安全

```
migrateWithBackup(dbPath)
  1. 自动备份原 DB 文件
  2. 在事务中运行迁移（失败可回滚）
  3. 若事务失败，备份文件可用于手动恢复
```

### 数据导入

- `importOmeDatabase()` — 从 OME 一次性导入，`ome_imported` 标记防重复
- `importSwarmLiteDatabase()` — 从 Swarm Lite 一次性导入，`swarmv3_imported` 标记防重复
- 两者均**无损**（只读源 DB），**自动备份**

---

## 测试

```bash
# 全部测试
npm test

# 按类别
npm run test:unit
npm run test:integration
npm run test:stress

# 迁移测试（关键路径）
npm run test:migration
```

---

## 从 OME 迁移

Claw-Swarm v4.0 **替代** OME。请勿同时运行两者。

详见 [迁移指南](docs/migration-guide.md)。

---

## 许可证

MIT License. Copyright 2025-2026 DEEP-IOS.
