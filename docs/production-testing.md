# Claw-Swarm V5.0 — Production Testing Guide / 生产测试指南

设计原则：从简到复，逐层递进，每个测试覆盖特定模块，最后用端到端场景验证整体协作。

---

## 测试前准备

```bash
# 确认插件已加载
openclaw plugins list
# 应显示 claw-swarm: loaded

# 确认网关运行正常
openclaw gateway restart
```

确保 Agent 的 SOUL.md 中已包含蜂群协调段落（参见 AGENTS.md）。

---

## 监控体系（4 层监控）

测试时建议同时启用以下监控手段，从不同维度收集运行数据：

```
┌──────────────────────────────────────────────────────┐
│  Layer 4: DB Inspector — 测试后数据分析               │
│  node tools/db-inspect.js                            │
├──────────────────────────────────────────────────────┤
│  Layer 3: Test Monitor — 实时事件 + 指标收集          │
│  node tools/test-monitor.js                          │
├──────────────────────────────────────────────────────┤
│  Layer 2: Dashboard — 浏览器实时可视化                │
│  http://localhost:19100                               │
├──────────────────────────────────────────────────────┤
│  Layer 1: OpenClaw Gateway Logs — 底层日志            │
│  openclaw gateway restart (观察终端输出)               │
└──────────────────────────────────────────────────────┘
```

### Layer 1: Gateway 日志（底层）

OpenClaw 网关启动后在终端直接输出插件初始化、Hook 注册、工具调用日志。

```bash
# 启动网关并观察日志
openclaw gateway restart

# 关注以下关键日志：
# [claw-swarm] Initialized with 34 tables
# [claw-swarm] Registered 6 hooks
# [claw-swarm] Registered 7 tools
# [claw-swarm] Dashboard started on port 19100
```

**收集的数据**: 插件加载状态、Hook 触发、工具调用追踪、错误堆栈。

### Layer 2: 实时仪表盘（可视化）

浏览器访问 `http://localhost:19100`，实时查看：

- **Agent 列表**: 在线/忙碌/离线状态
- **RED 指标**: 请求速率、错误率、平均耗时
- **信息素热图**: TRAIL/ALARM/RECRUIT 各类型计数
- **质量门控**: 评估通过/失败记录
- **活动日志**: SSE 实时事件流（自动滚动）

**操作步骤**:
1. 确认 `openclaw.json` 中 `dashboard.enabled: true`
2. 重启网关: `openclaw gateway restart`
3. 浏览器打开 `http://localhost:19100`
4. 开始测试，观察仪表盘实时变化

### Layer 3: Test Monitor（数据收集）

自动化监控脚本，连接 Dashboard SSE 端点，实时记录所有事件和指标到文件。

```bash
# 基本用法 — 开始监控，Ctrl+C 停止并生成报告
node tools/test-monitor.js

# 指定运行时长（秒）
node tools/test-monitor.js --duration 1800

# 自定义输出目录
node tools/test-monitor.js --output test-reports/session-01

# 自定义端口
node tools/test-monitor.js --port 19100
```

**输出文件**:
| 文件 | 格式 | 内容 |
|------|------|------|
| `events.jsonl` | JSON Lines | 全部 SSE 事件（每行一条） |
| `metrics.jsonl` | JSON Lines | 每 3 秒的指标快照 |
| `report.json` | JSON | 机器可读汇总报告 |
| `report.md` | Markdown | 人类可读测试报告 |
| `session.json` | JSON | 会话元数据 |

**实时终端输出**:
- 每条 SSE 事件以颜色区分类型（蓝=task、绿=agent、紫=pheromone、黄=quality、青=memory）
- 每 30 秒自动打印 RED 指标摘要
- 停止时打印最终汇总 + 生成完整报告

### Layer 4: DB Inspector（测试后分析）

测试完成后，直接查询 SQLite 数据库，检查所有 34 张表的数据。

```bash
# 完整检查 — 所有表的行数 + 关键数据高亮
node tools/db-inspect.js

# 仅统计行数
node tools/db-inspect.js --summary

# 查看特定表
node tools/db-inspect.js --table agents
node tools/db-inspect.js --table pheromones
node tools/db-inspect.js --table episodic_events
node tools/db-inspect.js --table knowledge_nodes
node tools/db-inspect.js --table quality_evaluations
node tools/db-inspect.js --table execution_plans
node tools/db-inspect.js --table zones

# 保存报告到文件
node tools/db-inspect.js --output test-reports/db-report.json
```

**高亮显示**:
- Agent 列表（ID、角色、层级、状态）
- 任务列表（状态、描述）
- 信息素信号（类型、范围、强度）
- 质量评估（分数、判定）
- 情景记忆（SPO 三元组）
- 知识图谱（节点数、边数、重要节点）
- Zone 列表（技术栈、Leader）
- 执行计划（状态、成熟度）

### REST API 手动查询

除了工具脚本，也可以直接用 curl/浏览器查询 Dashboard API：

```bash
# 当前指标快照
curl http://localhost:19100/api/metrics

# 系统统计（广播器、事件计数）
curl http://localhost:19100/api/stats

# SSE 事件流（持续输出）
curl -N http://localhost:19100/events
```

---

## 推荐测试流程

```
┌─────────────────────────────────────────────────────────────┐
│  Step 1: 准备                                                │
│  ├─ openclaw gateway restart                                 │
│  ├─ 浏览器打开 http://localhost:19100                         │
│  └─ 新终端运行 node tools/test-monitor.js                    │
│                                                              │
│  Step 2: 执行测试                                            │
│  ├─ 在 OpenClaw 会话中逐个执行 Level 1-9 的 Prompt           │
│  ├─ 观察仪表盘实时变化                                       │
│  └─ test-monitor 自动记录所有事件                             │
│                                                              │
│  Step 3: 停止 & 分析                                         │
│  ├─ test-monitor 终端按 Ctrl+C → 生成 report.md              │
│  ├─ 运行 node tools/db-inspect.js → 检查数据库               │
│  └─ 对照 Checklist 确认每项测试的结果                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Level 1: 基础健康检查（验证插件加载 + 工具注册）

### 测试 1.1: 蜂群状态查询

**测试目标**: `swarm_query` 工具是否正确注册，数据库是否初始化。

**Prompt**:
```
用 swarm_query 查看当前蜂群状态
```

**预期行为**:
- Agent 调用 `swarm_query` with `{ "action": "status" }`
- 返回包含 agents、tasks、pheromones、orchestrator 字段的状态对象
- agents.total 应为 0（新数据库）或包含之前的 agent 记录
- 无报错

**验证要点**:
- [x] 工具被正确调用（非文本输出 JSON）
- [x] 返回的数据结构完整
- [x] 数据库连接正常（无 `Cannot find module 'node:sqlite'` 错误）

---

### 测试 1.2: Agent 列表查询

**测试目标**: `swarm_query` 的 agents 过滤功能。

**Prompt**:
```
查看所有活跃的 agent 列表，如果没有活跃的就告诉我当前数据库里有多少 agent 记录
```

**预期行为**:
- Agent 调用 `swarm_query` with `{ "action": "agents" }` 或带 `filter: { status: "active" }`
- 返回 agent 数组（可能为空）

---

## Level 2: 记忆系统（三层记忆 + 知识图谱）

### 测试 2.1: 工作记忆读写

**测试目标**: `swarm_memory` 的 working 子操作（set/get/snapshot）。

**Prompt**:
```
帮我测试蜂群的工作记忆系统：
1. 在 focus 层写入一条记忆，key 是 "current_goal"，value 是 "测试蜂群工具链"，优先级 9
2. 在 context 层写入一条记忆，key 是 "test_phase"，value 是 "Level 2 记忆测试"，优先级 6
3. 然后做一次工作记忆快照，看看三层各有多少条目
```

**预期行为**:
- 调用 3 次 `swarm_memory`:
  1. `{ "action": "working", "key": "current_goal", "value": "测试蜂群工具链", "layer": "focus", "priority": 9 }`
  2. `{ "action": "working", "key": "test_phase", "value": "Level 2 记忆测试", "layer": "context", "priority": 6 }`
  3. `{ "action": "working" }` (snapshot)
- 快照应显示 focus: 1, context: 1, scratchpad: 0

**验证要点**:
- [x] 三层缓冲区正常工作
- [x] 优先级正确设置
- [x] 快照正确反映当前状态

---

### 测试 2.2: 情景记忆记录与检索

**测试目标**: `swarm_memory` 的 record/recall 功能（SPO 三元组 + Ebbinghaus）。

**Prompt**:
```
请执行以下记忆操作：
1. 记录一条情景记忆：类型 "decision"，主体 "swarm-orchestrator"，谓词 "选择了"，对象 "worker-bee 角色"，重要性 0.8
2. 记录一条情景记忆：类型 "observation"，主体 "pheromone-engine"，谓词 "检测到"，对象 "3个TRAIL信号"，重要性 0.6
3. 记录一条情景记忆：类型 "error"，主体 "quality-gate"，谓词 "拒绝了"，对象 "代码质量不达标的输出"，重要性 0.9
4. 然后用关键词 "quality" 回忆相关记忆
```

**预期行为**:
- 3 次 `swarm_memory` record 调用，返回 eventId
- 1 次 `swarm_memory` recall 调用，返回包含 "quality-gate" 相关事件

**验证要点**:
- [x] SPO 三元组正确存储
- [x] 关键词检索能匹配到相关记忆
- [x] 返回的事件包含 importance 和 score 排序

---

### 测试 2.3: 知识图谱构建与遍历

**测试目标**: `swarm_memory` 的 knowledge 子操作（add/connect/query）。

**Prompt**:
```
帮我在蜂群知识图谱中构建一个小型技术栈关系网：
1. 添加节点："React"（类型 concept，重要性 0.8）
2. 添加节点："TypeScript"（类型 concept，重要性 0.7）
3. 添加节点："前端开发"（类型 skill，重要性 0.9）
4. 连接 "React" → "前端开发"，关系类型 "part_of"，权重 0.9
5. 连接 "TypeScript" → "React"，关系类型 "uses"，权重 0.7
6. 然后从 "React" 出发，做 2 跳 BFS 查询，看看能发现什么
```

**预期行为**:
- 3 次 knowledge add（返回 nodeId）
- 2 次 knowledge connect（返回 edgeId）
- 1 次 knowledge query（从 React 的 nodeId 出发，BFS 2 跳）
- BFS 结果应包含 TypeScript（1跳）和前端开发（1跳）

**验证要点**:
- [x] 节点/边正确创建
- [x] BFS 遍历返回关联节点
- [x] 遍历深度限制生效

---

## Level 3: 信息素系统（MMAS + 衰减 + 告警）

### 测试 3.1: 信息素发射与读取

**测试目标**: `swarm_pheromone` 的 emit/read 功能。

**Prompt**:
```
请测试信息素系统：
1. 在 "/task/test-001" 范围发射一个 TRAIL 信息素，消息 "代码审查路径已验证"，强度 0.8
2. 在 "/task/test-001" 范围发射一个 ALARM 信息素，消息 "单元测试覆盖率不足"，强度 0.6
3. 在 "/zone/frontend" 范围发射一个 recruit 信息素，消息 "需要前端工程师协助"，强度 0.9
4. 读取 "/task/test-001" 范围的所有信息素
5. 读取所有范围的所有信息素
```

**预期行为**:
- 3 次 emit 调用，各返回 pheromoneId
- 2 次 read 调用：
  - 第一次：返回 2 条信息素（TRAIL + ALARM）
  - 第二次：返回至少 3 条信息素

**验证要点**:
- [x] 不同类型信息素正确创建
- [x] 范围过滤有效
- [x] 强度值正确存储（0-1 范围）

---

### 测试 3.2: 信息素衰减与告警密度

**测试目标**: `swarm_pheromone` 的 decay/alarms 功能。

**Prompt**:
```
继续信息素测试：
1. 触发一次信息素衰减扫描
2. 检查 "/task/test-001" 的 ALARM 密度
3. 在 "/task/test-001" 再发射 2 个 ALARM 信息素（强度 0.7 和 0.9），然后再查告警密度
```

**预期行为**:
- decay 返回 updated/evaporated 计数
- 第一次 alarms：alarmCount=1, triggered 可能为 false
- 追加 2 个 ALARM 后：alarmCount=3, triggered 可能为 true（取决于阈值）

**验证要点**:
- [x] 衰减机制正常工作
- [x] ALARM 密度正确统计
- [x] 告警阈值触发机制

---

## Level 4: 执行计划（MoE 选角 + 计划验证）

### 测试 4.1: 任务计划设计

**测试目标**: `swarm_plan` 的 design/validate 功能（MoE Top-k 选角）。

**Prompt**:
```
请为以下任务设计一个蜂群执行计划：

任务描述："开发一个用户注册功能，包含：前端表单验证、后端 API 接口、数据库存储、单元测试编写。需要考虑安全性（SQL注入防护、密码加密）。"

最多分配 4 个角色。然后验证这个计划的质量。
```

**预期行为**:
- 调用 `swarm_plan` with `{ "action": "design", "taskDescription": "...", "maxRoles": 4 }`
- 返回包含 phases 的计划（每个 phase 有 roleName, description, order）
- MoE 返回 roleScores（各角色得分）
- 调用 `swarm_plan` with `{ "action": "validate", "planId": "..." }`
- 验证结果返回 valid/issues

**验证要点**:
- [x] MoE 能推荐合适角色（应包含 coder/tester 相关角色）
- [x] 计划包含合理的阶段划分
- [x] 验证功能正常返回（valid=true 或 issues 列表）

---

### 测试 4.2: 查看计划列表与详情

**Prompt**:
```
列出目前所有的执行计划，然后查看刚才创建的那个计划的完整详情
```

**预期行为**:
- `swarm_plan` list → 返回计划数组（至少 1 条）
- `swarm_plan` detail → 返回完整计划数据

---

## Level 5: Zone 治理（分区 + 自动分配 + 健康检查）

### 测试 5.1: Zone 创建与管理

**测试目标**: `swarm_zone` 的 create/list/health 功能。

**Prompt**:
```
创建两个工作区域：
1. 名称 "frontend"，描述 "前端开发区"，技术栈 ["react", "typescript", "css"]
2. 名称 "backend"，描述 "后端服务区"，技术栈 ["nodejs", "python", "sql"]

然后列出所有区域，并对 frontend 区域做一次健康检查。
```

**预期行为**:
- 2 次 zone create → 各返回 zone 对象
- 1 次 zone list → 包含 2 个 zone
- 1 次 zone health → 返回 healthy + issues（可能报 "no members" 之类的问题）

**验证要点**:
- [x] Zone 创建成功
- [x] 技术栈正确存储
- [x] 健康检查能识别问题（如无成员）

---

## Level 6: 质量门控（评估 + 申诉 + 统计）

### 测试 6.1: 质量评估流程

**测试目标**: `swarm_gate` 的 evaluate/appeal/stats 功能。

**Prompt**:
```
测试质量门控系统：
1. 对任务 "test-task-001" 提交一份质量评估，agent ID 为 "test-agent-001"，输出结果为 { "code": "function hello() { return 'world'; }", "tests": 3, "coverage": 85 }
2. 查看质量统计数据
3. 如果评估未通过，提交一次申诉
```

**预期行为**:
- evaluate 返回 evaluationId, score, verdict, passed, dimensions
- stats 返回全局统计 + agent 特定报告
- 如果 passed=false，appeal 返回 'appeal_submitted'

**验证要点**:
- [x] 多维度评分正常计算
- [x] 通过/不通过判定正确
- [x] 申诉流程可用

---

## Level 7: 子 Agent 生命周期（核心端到端）

### 测试 7.1: 单个子 Agent 派出

**测试目标**: `swarm_spawn` 的 spawn 功能（MoE 选角 + SOUL 生成 + recruit 信息素）。

**Prompt**:
```
请派出一个子 agent 来完成以下任务：

"搜索并总结 Python 3.12 的主要新特性，包括性能改进和语法变化。输出一份结构化的中文摘要。"

让系统自动选择最合适的角色。
```

**预期行为**:
- 调用 `swarm_spawn` with `{ "action": "spawn", "taskDescription": "..." }`
- MoE 推荐角色（可能是 scout-bee 或 researcher）
- 返回 agentId, taskId, role, roleScores, soulSnippet
- 自动发射 recruit 信息素

**验证要点**:
- [x] MoE 角色推荐合理
- [x] SOUL snippet 生成成功
- [x] recruit 信息素已发射
- [x] Agent 记录已创建

---

### 测试 7.2: 查看子 Agent 状态

**Prompt**:
```
查看刚才派出的子 agent 的详细状态，包括它的能力维度评分
```

**预期行为**:
- `swarm_query` with `{ "action": "agent", "agentId": "..." }`
- 返回 agent 详情包含 capabilities 数组

---

### 测试 7.3: 多 Agent 并行派出

**测试目标**: 多个子 Agent 并行工作 + 列表管理。

**Prompt**:
```
我需要并行完成以下三个子任务，请分别派出子 agent：
1. scout-bee：调研 "2024年最受欢迎的5个JavaScript框架"
2. worker-bee：编写一个 Python 快速排序算法并附带注释
3. guard-bee：审查以下代码的安全性 "eval(user_input)"

派出后，列出所有活跃的子 agent。
```

**预期行为**:
- 3 次 `swarm_spawn`，每次带不同的 taskDescription 和 roleHint
- 3 个不同的 agentId 返回
- `swarm_spawn` list 返回 3 个活跃 agent

**验证要点**:
- [x] 不同角色正确分配
- [x] 并行创建无冲突
- [x] 列表正确显示全部 agent

---

## Level 8: 端到端场景测试

### 测试 8.1: 完整蜂群工作流（综合测试）

**测试目标**: 验证从计划设计到执行完成的完整流程。

**Prompt**:
```
我需要你用蜂群模式完成一个复杂任务。请按照以下步骤：

1. 先用 swarm_plan 为这个任务设计执行计划：
   "写一篇关于 AI Agent 技术趋势的分析报告，需要包括：技术调研、竞品分析、趋势预测、中文撰写。"

2. 查看蜂群当前状态

3. 根据计划，派出对应的子 agent：
   - 一个 scout-bee 负责技术调研
   - 一个 worker-bee 负责报告撰写

4. 在工作记忆 focus 层记录当前目标

5. 发射 TRAIL 信息素标记这个任务路径

6. 对计划做一次质量门控检查

7. 最后给我一个完整的蜂群状态报告
```

**预期行为**:
- 完整调用链：plan.design → query.status → spawn×2 → memory.working → pheromone.emit → gate.evaluate → query.status
- 全部 7 个工具至少被调用 1 次
- 各步骤串联无错误

**验证要点**:
- [x] 工具调用顺序正确
- [x] 数据在工具间正确流转（planId → spawn, agentId → gate）
- [x] 最终状态报告反映所有操作的结果

---

### 测试 8.2: 错误处理与容错（ALARM 信号链）

**测试目标**: 验证错误传播、ALARM 信息素、质量门控拒绝。

**Prompt**:
```
帮我测试蜂群的容错机制：
1. 派出一个子 agent 执行一个描述模糊的任务："做点什么"
2. 对这个任务的输出做质量评估（假设输出质量很差：{ "result": "不知道做什么" }）
3. 如果质量评估不通过，发射一个 ALARM 信息素
4. 检查 ALARM 密度是否触发了告警
5. 查看蜂群整体状态，确认告警信号被记录
```

**预期行为**:
- spawn 成功但质量评估可能 fail
- ALARM 信息素被发射
- alarms 查询显示告警信息

**验证要点**:
- [x] 低质量输出被质量门控正确识别
- [x] ALARM 信号链正常传播
- [x] 蜂群状态反映错误信息

---

### 测试 8.3: 记忆持久化与上下文注入

**测试目标**: 验证记忆系统跨会话持久化 + 上下文自动注入。

**Prompt（会话 A）**:
```
请在蜂群记忆中记录以下关键信息：
1. 情景记忆：类型 "decision"，主体 "architect"，谓词 "决定使用"，对象 "微服务架构"，重要性 0.95
2. 知识图谱：添加节点 "微服务"（类型 concept），然后连接到之前创建的任何节点
3. 工作记忆 focus 层：key "architecture_decision"，value "采用微服务 + event-driven 架构"
4. 查看记忆统计
```

**Prompt（会话 B，新对话）**:
```
回忆一下之前关于"架构"的决策记忆，然后从知识图谱中查询"微服务"相关的知识网络
```

**预期行为**:
- 会话 A：所有记忆操作成功
- 会话 B：recall 能检索到"微服务架构"决策，knowledge query 能找到节点

**验证要点**:
- [x] SQLite 持久化跨会话有效
- [x] 情景记忆检索正常
- [x] 知识图谱查询跨会话可用

---

### 测试 8.4: Zone 治理 + Agent 自动分配

**测试目标**: Zone 自动分配（Jaccard 匹配）+ 成员管理。

**Prompt**:
```
请执行以下 Zone 治理操作：
1. 确认 frontend 和 backend 两个 Zone 存在（不存在则创建）
2. 派出一个具有 ["react", "typescript", "css", "html"] 技能的 agent
3. 让系统自动将这个 agent 分配到最匹配的 Zone（不指定 zoneId）
4. 查看被分配 Zone 的成员列表
5. 对该 Zone 做健康检查
```

**预期行为**:
- 自动分配应匹配到 frontend Zone（Jaccard > 0.3）
- 返回 jaccardScore 和分配结果
- members 显示新成员
- health 更新状态

**验证要点**:
- [x] Jaccard 匹配算法正确计算
- [x] 自动分配选择最佳 Zone
- [x] 成员关系正确建立

---

## Level 9: 压力与边界测试

### 测试 9.1: 高频工具调用

**Prompt**:
```
请快速连续执行以下操作（测试数据库并发性能）：
1. 发射 5 个不同范围的信息素
2. 记录 5 条情景记忆
3. 在知识图谱添加 5 个节点并相互连接
4. 做一次全量蜂群状态查询
5. 做一次记忆统计
6. 做一次信息素衰减

告诉我每步操作的结果和是否有错误。
```

**验证要点**:
- [x] 快速连续调用无数据库锁冲突
- [x] WAL 模式 + busy_timeout 生效
- [x] 所有操作正确完成

---

### 测试 9.2: 边界值测试

**Prompt**:
```
测试边界情况：
1. 发射一个强度为 0 的信息素
2. 发射一个强度为 1.5 的信息素（应被裁剪到 1.0）
3. 记录一条重要性为 -0.5 的情景记忆（应处理边界）
4. 在工作记忆写入一个非常长的 value（500字以上）
5. 用一个不存在的 agentId 查询 agent 详情
6. 用一个不存在的 planId 验证计划
```

**验证要点**:
- [x] 强度裁剪到 [0, 1] 范围
- [x] 边界值处理无崩溃
- [x] 不存在的 ID 返回合理错误信息

---

## 测试检查清单 / Checklist

| # | 测试 | 覆盖模块 | 状态 |
|---|------|---------|------|
| 1.1 | 蜂群状态查询 | swarm_query, L1 数据库 | [ ] |
| 1.2 | Agent 列表查询 | swarm_query, Agent Repository | [ ] |
| 2.1 | 工作记忆读写 | swarm_memory (working), L3 WorkingMemory | [ ] |
| 2.2 | 情景记忆记录检索 | swarm_memory (record/recall), L3 EpisodicMemory | [ ] |
| 2.3 | 知识图谱构建遍历 | swarm_memory (knowledge), L3 SemanticMemory | [ ] |
| 3.1 | 信息素发射读取 | swarm_pheromone (emit/read), L2 PheromoneEngine | [ ] |
| 3.2 | 信息素衰减告警 | swarm_pheromone (decay/alarms), MMAS | [ ] |
| 4.1 | 任务计划设计 | swarm_plan (design/validate), L4 ExecutionPlanner | [ ] |
| 4.2 | 计划列表详情 | swarm_plan (list/detail), Plan Repository | [ ] |
| 5.1 | Zone 创建管理 | swarm_zone (create/list/health), L4 ZoneManager | [ ] |
| 6.1 | 质量评估流程 | swarm_gate (evaluate/appeal/stats), L4 QualityController | [ ] |
| 7.1 | 单 Agent 派出 | swarm_spawn (spawn), MoE, SoulDesigner | [ ] |
| 7.2 | Agent 状态查询 | swarm_query (agent), CapabilityEngine | [ ] |
| 7.3 | 多 Agent 并行 | swarm_spawn ×3, 列表管理 | [ ] |
| 8.1 | 完整蜂群工作流 | 全部 7 工具联合 | [ ] |
| 8.2 | 错误处理容错 | ALARM, QualityController, PipelineBreaker | [ ] |
| 8.3 | 记忆持久化 | 跨会话 SQLite 持久化 | [ ] |
| 8.4 | Zone 自动分配 | Jaccard 匹配, 成员管理 | [ ] |
| 9.1 | 高频调用 | 数据库并发, WAL | [ ] |
| 9.2 | 边界值 | 输入验证, 错误处理 | [ ] |

---

## 推荐执行顺序

```
Day 1: Level 1 + 2（基础 + 记忆）
Day 2: Level 3 + 4（信息素 + 计划）
Day 3: Level 5 + 6（Zone + 质量门控）
Day 4: Level 7（子 Agent 生命周期）
Day 5: Level 8（端到端场景）
Day 6: Level 9（压力 + 边界）
```

或者一次性全跑（约 30-45 分钟）。

---

## 问题排查

| 现象 | 可能原因 | 排查 |
|------|---------|------|
| 工具调用返回文本而非 JSON | 模型不支持 tool calling | 换用 Tier S/A 模型 |
| `Cannot find module 'node:sqlite'` | Node.js < 22 | 升级 Node.js |
| 数据库锁错误 | 并发访问冲突 | 检查 WAL 模式 + busy_timeout |
| MoE 角色推荐全部降级 regex | 无历史数据 | 正常现象，使用后会改善 |
| ALARM 密度不触发 | 阈值未达到 | 多发射几个 ALARM 信息素 |
| 记忆检索返回空 | 关键词不匹配 | 检查 recall 的 keyword 参数 |

---

*Last updated: 2026-03-08*
