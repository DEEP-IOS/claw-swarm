# 当蚁群、蜂群和遗忘曲线走进 AI Agent —— Claw-Swarm V5.0 设计手记

> 用 12 种仿生算法让多个 AI Agent 像蜂群一样协作。

---

## 为什么需要仿生？

现在的多 Agent 框架大多在做"调度"——把任务拆成子任务，分配给子 Agent，收集结果。这当然能跑，但有几个问题真正做过的人都会遇到：

1. **任务分配靠硬编码规则**，Agent A 擅长写代码、Agent B 擅长测试——但"擅长"是你告诉系统的，不是系统自己学到的。
2. **Agent 之间无法间接通信**。Agent A 发现了一个关键信息，Agent B 必须通过中心调度器才能知道。
3. **没有记忆衰减**。所有历史信息权重相同，context window 很快就会爆。
4. **缺乏自适应**。任务负载变化时，系统不会自动调整策略。

自然界已经解决了这些问题。蚁群通过信息素实现间接通信（stigmergy），蜜蜂用舞蹈传递食物源信息，人类大脑用遗忘曲线自动清理不重要的记忆。这些机制经过亿万年进化检验，简单、鲁棒、去中心化。

Claw-Swarm V5.0 把 12 种仿生算法整合进了一个 6 层架构，作为 OpenClaw 的插件运行。下面聊聊每个算法的设计思路和工程取舍。

---

## 架构速览

```
L6 Monitoring    ── Dashboard、RED 指标、SSE 实时推送
L5 Application   ── OpenClaw 插件适配、7 个 Agent 工具
L4 Orchestration  ── DAG 编排、CNP 协商、ABC 调度、质量门控
L3 Agent          ── 三层记忆、SOUL 人格、能力引擎、声誉账本
L2 Communication  ── 信息素引擎、消息总线、Gossip 协议
L1 Infrastructure ── SQLite(WAL)、配置管理(Zod)、8 个仓库
```

层级严格向下依赖，L4 可以用 L3/L2/L1，但 L2 绝不能 import L4。这保证了每一层可以独立测试。490 个测试用例，跑完不到 2 秒。

---

## 12 种仿生算法详解

### 1. MMAS（最大-最小蚁群系统）

**问题：** 信息素浓度要么涨到天花板（所有 Agent 都走同一条路），要么衰减到零（信息丢失）。

**方案：** 给每种信息素类型设置 `[τ_min, τ_max]` 边界。比如 `trail`（足迹）信息素的边界是 `[0.05, 1.00]`，`queen`（女王指令）的下界更高 `[0.10, 1.00]`，因为它的权威性不应该被轻易削弱。

```javascript
// 5 种信息素类型，各有不同的衰减速率和 MMAS 边界
trail:   { decayRate: 0.05, maxTTLMin: 120, mmasMin: 0.05, mmasMax: 1.00 }
alarm:   { decayRate: 0.15, maxTTLMin: 30,  mmasMin: 0.05, mmasMax: 1.00 }
recruit: { decayRate: 0.10, maxTTLMin: 60,  mmasMin: 0.05, mmasMax: 1.00 }
queen:   { decayRate: 0.02, maxTTLMin: 480, mmasMin: 0.10, mmasMax: 1.00 }
dance:   { decayRate: 0.08, maxTTLMin: 90,  mmasMin: 0.05, mmasMax: 1.00 }
```

`alarm` 衰减最快（0.15/min）——紧急警报不应该长期存在。`queen` 衰减最慢（0.02/min），生存 8 小时——战略指令需要持久性。

### 2. ACO 轮盘赌选择

**问题：** 当多条信息素路径并存时，Agent 该走哪条？

**方案：** 经典 ACO 轮盘赌。路径 i 被选中的概率 `P(i) = τ_i / Σ(τ_j)`。信息素浓度越高，被选中概率越大，但不是确定性的——低浓度路径仍有被探索的机会，避免过早收敛。

### 3. 艾宾浩斯遗忘曲线

**问题：** 情景记忆越积越多，哪些该忘、哪些该记？

**方案：** `retention(t) = e^(-t / (λ × importance))`

其中 `λ = 30 天`（默认），`importance` 是记忆的重要性评分（0-1）。重要的记忆衰减慢，不重要的快速遗忘。

检索评分综合四个维度：
```
score = importance × 0.4 + timeDecay × 0.2 + relevance × 0.2 + reward × 0.2
```

这意味着一条两周前的高重要性记忆，可能比一小时前的低重要性记忆得分更高。

### 4. BFS 知识图谱遍历

**问题：** Agent 需要理解概念之间的关系。"React" 和 "组件" 之间隔了几层？

**方案：** 语义记忆存储为知识图谱（节点 + 带权边）。查询时用 BFS 做 N 跳遍历，找出相关节点。支持路径查找和节点合并（当两个概念被发现实际是同一个东西时）。

遍历深度限制为 3 层——实测超过 3 层的关联通常噪声大于信号。

### 5. PARL 人格 A/B 测试

**问题：** Agent 用哪种"人设"效果更好？

**方案：** 受强化学习 A/B 测试启发。给 Agent 随机分配人格变体（比如"严格代码审查者" vs "建设性代码审查者"），追踪每种人格的任务完成率和质量评分，逐步收敛到最优人格。

内置 4 种蜜蜂人格模板：`scout`（侦察蜂）、`worker`（工蜂）、`guard`（守卫蜂）、`queen-messenger`（女王信使），通过关键词自动匹配。

### 6. GEP 执行计划生成

**问题：** 如何从自然语言任务描述生成 DAG 执行计划？

**方案：** 借鉴基因表达式编程思想。把任务拆解成"基因"（子任务），通过依赖分析组装成表达式树，最终展开为 DAG。支持并行分支和同步屏障。

### 7. CPM 关键路径分析

**问题：** DAG 计划中，哪些任务在关键路径上？延误会影响整体进度吗？

**方案：** 经典 CPM（关键路径法）。正向传播算最早开始/结束时间，反向传播算最迟时间，浮动时间 = 0 的任务构成关键路径。调度器优先保障关键路径上的任务资源。

### 8. Jaccard 相似度

**双重用途：**

- **结果去重：** 多个 Agent 返回的结果可能高度重叠。用 Jaccard 系数检测相似度，合并重复结果。
- **Zone 自动分配：** 计算 Agent 的能力向量与 Zone 要求的 Jaccard 距离，自动分配到最匹配的工作区。

### 9. MoE 混合专家路由

**问题：** 来了一个任务，该分给哪个"专家角色"？

**方案：** 7 个内置角色模板（architect、developer、tester、reviewer、devops、designer、analyst），每个有 8 维能力评分。任务到来时，先通过关键词匹配缩小候选集，再用能力维度的余弦相似度评分，选最匹配的角色。

角色模板支持动态注册和生命周期管理：相似度 > 0.95 的新模板自动合并到已有角色，长期未使用的自定义角色自动修剪。

### 10. FIPA 合同网协议（CNP）

**问题：** 多个 Agent 都能做这个任务，谁来做？

**方案：** 实现完整的 FIPA CNP 协议流程：`CFP → BID → AWARD → EXECUTE → COMPLETE/FAIL`

投标评分公式：
```
bid = capability_match × 0.4 + workload_factor × 0.2
    + success_rate × 0.3 - opportunity_cost × 0.1
```

注意 `opportunity_cost` 是负项——如果一个 Agent 当前有更重要的任务在做，它的投标分会降低，即使它能力最强。这避免了"能者多劳到过载"的问题。

### 11. ABC 人工蜂群调度

**问题：** 如何在探索（发现新的好方案）和开发（利用已知好方案）之间平衡？

**方案：** 将 Agent 群体分为三种蜜蜂角色：

| 角色 | 比例 | 行为 |
|------|------|------|
| 引领蜂 (Employed) | 50% | 开发已知食物源，执行已分配任务 |
| 跟随蜂 (Onlooker) | 45% | 按质量做轮盘赌选择，跟随高质量方案 |
| 侦察蜂 (Scout) | 5% | 放弃低质量方案，随机探索新方案 |

如果一个方案连续 5 轮没有改善，就触发 scout 行为——放弃并随机生成新方案。这保证了系统不会陷入局部最优。

### 12. k-means++ 角色发现

**问题：** 除了预定义角色，Agent 的行为中是否隐含了新角色？

**方案：** 收集 Agent 的 8 维能力向量作为特征，跑 k-means++（D² 加权初始化）聚类。每个聚类的质心就对应一个"发现的角色"——系统自动生成角色名称和能力描述，注册到 RoleManager。

收敛阈值设为 0.001，最大迭代 100 次。实测 3-5 个聚类就能覆盖大多数场景。

---

## 工程取舍

### 为什么选 SQLite 而不是 Redis/PostgreSQL？

单进程嵌入式数据库，零运维。一个 `npm install` 就能跑，不需要用户额外装任何东西。Node.js 22 内置了 `node:sqlite`（DatabaseSync API），连原生绑定都不需要编译。

WAL 模式 + `busy_timeout=5000ms`，读写不互斥。34 张表，8 个 Repository 封装所有数据访问。

### 为什么不用向量数据库做语义检索？

在 Agent 协作场景下，我们需要的是**精确的结构化查询**（"这个 Agent 最近 5 分钟的所有 trail 信息素"），而不是模糊语义搜索。SQLite 的索引查询在这个量级下（< 5000 条信息素记录）比任何向量数据库都快。

语义相关性通过 BFS 知识图谱 + Jaccard 相似度组合解决，不需要 embedding。

### 为什么要懒衰减？

信息素的真实强度是 `intensity × e^(-decayRate × ageMinutes)`。如果每分钟都对所有记录做衰减计算，CPU 开销会随记录数线性增长。

改用**懒衰减**：数据库中存原始强度和时间戳，读取时才计算真实强度。定期的 `decayPass()` 只负责清理已蒸发（< 0.01）的记录，不做强度更新。读多写少的场景下这个策略很划算。

---

## 实时监控

L6 层提供了一个暗色主题的实时仪表盘，基于 Fastify + SSE：

- RED 指标（Rate / Errors / Duration）
- 活跃任务列表和完成率
- Agent 状态、能力评分、声誉值
- 信息素分布和衰减可视化

在配置中启用：`{ "dashboard": { "enabled": true, "port": 19100 } }`

---

## 快速开始

```bash
# npm 安装
npm install openclaw-swarm
cd node_modules/openclaw-swarm
node install.js
openclaw gateway restart

# 或 git clone
git clone https://github.com/DEEP-IOS/claw-swarm.git
cd claw-swarm
node install.js
openclaw gateway restart
```

要求 Node.js >= 22.0.0 + OpenClaw。

---

## 数字

| 指标 | 数值 |
|------|------|
| 源文件 | 55+ |
| 数据库表 | 34 |
| 测试用例 | 490 |
| 测试耗时 | < 2s |
| npm 包大小 | 382 KB |
| 运行时依赖 | 5 个（eventemitter3, fastify, nanoid, pino, zod） |
| 仿生算法 | 12 种 |

---

## 链接

- **GitHub**: [DEEP-IOS/claw-swarm](https://github.com/DEEP-IOS/claw-swarm)
- **npm**: [openclaw-swarm](https://www.npmjs.com/package/openclaw-swarm)
- **架构文档**: [docs/architecture.md](https://github.com/DEEP-IOS/claw-swarm/blob/main/docs/architecture.md)
- **安装指南**: [docs/installation.md](https://github.com/DEEP-IOS/claw-swarm/blob/main/docs/installation.md)

MIT License. 欢迎 Issue 和 PR。
