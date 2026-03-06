# Changelog

All notable changes to Claw-Swarm are documented here.

本文件记录 Claw-Swarm 的所有重要变更。

## [4.0.0] - 2026-03-06

### Major: Unified Plugin / 重大变更：统一插件

Claw-Swarm v4.0 merges **OME v1.1.0** (memory engine) and **Swarm Lite v3.0** (governance layer) into a single unified OpenClaw plugin, adding pheromone communication, agent design, and collaboration infrastructure.

Claw-Swarm v4.0 将 **OME v1.1.0**（记忆引擎）和 **Swarm Lite v3.0**（治理层）合并为统一插件，新增信息素通信、智能体设计和协作基础设施。

### Added / 新增

#### Architecture / 架构
- 4-layer architecture (Core → Engines → Intelligence → Adapter)
  4 层架构（核心 → 引擎 → 智能 → 适配）
- 6 independently toggleable subsystems (memory, pheromone, governance, soul, collaboration, orchestration)
  6 个独立开关子系统
- Unified SQLite database with 25 tables (WAL mode)
  统一 SQLite 数据库，25 张表（WAL 模式）
- Schema migration chain v0→v1→v2→v3 with auto-backup
  模式迁移链 v0→v3 含自动备份

#### Pheromone Engine / 信息素引擎 (NEW)
- 5 pheromone types: trail, alarm, recruit, queen, dance
  5 种信息素类型：足迹、警报、招募、女王、舞蹈
- Exponential decay model with configurable rates
  可配置速率的指数衰减模型
- Background decay service with explicit lifecycle management
  显式生命周期管理的后台衰减服务
- Indexed batch operations for large-table performance
  大表场景的索引批量操作

#### Soul Designer / 灵魂设计器 (NEW)
- 4 built-in bee persona templates (scout, worker, guard, queen-messenger)
  4 个内置蜜蜂人格模板
- Keyword-based persona selection
  基于关键词的人格选择
- Config-extensible persona system (user can add/override)
  配置可扩展人格系统
- Persona evolution with outcome tracking and win-rate
  人格进化：结果追踪 + 胜率

#### Collaboration / 协作 (NEW)
- Peer Directory with lazy-read pattern (supports hot-plug)
  惰性读取的同伴目录（支持热插拔）
- @mention fixer (auto-routes to known peers)
  @提及修复器（自动路由到已知同伴）
- Struggle detector with pheromone-aware false positive reduction
  信息素感知的困难检测器（降低误报）
- 4 collaboration strategies: parallel, pipeline, debate, stigmergy
  4 种协作策略：并行、流水线、辩论、信息素协调

#### Tools / 工具 (NEW)
- `collaborate` — Multi-channel peer communication
  多通道同伴通信
- `pheromone` — Emit/read pheromone signals
  发射/读取信息素信号
- `swarm_manage` — Task status, list, cancel, report
  任务状态、列表、取消、报告
- `swarm_spawn` — One-click swarm spawning
  一键蜂群生成
- `swarm_design` — SOUL template recommendations
  SOUL 模板推荐

#### Hooks / 钩子 (8 lifecycle hooks)
- `before_agent_start` — Unified injection (memory + peers + pheromone)
  统一注入（记忆 + 同伴 + 信息素）
- `after_tool_call` — Tracking + struggle detection
  追踪 + 困难检测
- `agent_end` — Checkpoint + governance evaluation + trail pheromone
  检查点 + 治理评估 + 足迹信息素
- `before_reset` — Session state cleanup
  会话状态清理
- `gateway_stop` — Explicit resource cleanup
  显式资源清理
- `subagent_spawning` — Governance gate
  治理门控
- `subagent_ended` — Post-subagent evaluation
  子智能体后评估
- `message_sending` — @mention routing
  @提及路由

### Ported from OME v1.1.0 / 从 OME v1.1.0 移植
- Memory CRUD operations (writeMemory, readMemories, etc.)
  记忆 CRUD 操作
- Checkpoint service (automatic and manual checkpoints)
  检查点服务
- Context service (prependContext builder)
  上下文服务
- Agent state tracking (in-memory Map)
  智能体状态追踪
- Agent ID resolution (multi-strategy)
  智能体 ID 解析

### Ported from Swarm Lite v3.0 / 从 Swarm Lite v3.0 移植
- 4D capability scoring engine (technical, delivery, collaboration, innovation)
  四维能力评分引擎
- Reputation ledger with contribution tracking
  贡献追踪的声誉账本
- Weighted voting system with rate limiting
  带限速的加权投票系统
- Crash-resilient evaluation queue
  崩溃恢复评估队列
- Agent registry facade
  智能体注册表门面
- Circuit breaker (extracted to standalone module)
  断路器（提取为独立模块）
- Task orchestrator with 4 execution strategies
  4 策略任务编排器
- Role manager with topological sort
  拓扑排序的角色管理器
- Ring buffer monitor with governance event sampling
  治理事件采样的环形缓冲监控器
- All 7 v3.1 bug fixes preserved
  保留全部 7 个 v3.1 修复

### Breaking Changes / 破坏性变更
- **Replaces OME**: Do not run both simultaneously
  替代 OME：请勿同时运行
- Import paths changed from flat to layered structure
  导入路径从扁平改为分层结构
- DB function names prefixed (e.g., `createTask` → `createSwarmTask`)
  DB 函数名增加前缀

---

## Previous Versions / 历史版本

### Swarm Lite v3.0 (2026-03-05)
- Added governance layer: capability scoring, voting, tier management
- 174 tests passing
- See `data/swarm-lite/` for historical code

### OME v1.1.0 (2026-03-05)
- Memory engine with checkpoint and context injection
- See `data/ome/` for historical code
