# 仿生算法与设计哲学

**Claw-Swarm V9.2.0** | 20 种仿生算法全解

Claw-Swarm 从生物系统、认知科学和社会动力学中汲取灵感，解决 LLM 多代理协调中的核心挑战：无中央调度的任务分配、无重训练的自适应行为、无可靠传输保障的弹性通信、以及无 ground truth 的公平贡献归因。本文档对每种算法详述其生物来源、形式化数学、源码锚点及设计决策。

---

## 目录

1. [MMAS（最大-最小蚁群系统）](#1-mmas最大-最小蚁群系统)
2. [ACO 轮盘赌选择](#2-aco-轮盘赌选择)
3. [响应阈值 + PI 控制器](#3-响应阈值--pi-控制器)
4. [人工蜂群（ABC）](#4-人工蜂群abc)
5. [Ebbinghaus 遗忘曲线](#5-ebbinghaus-遗忘曲线)
6. [双过程理论（Kahneman）](#6-双过程理论kahneman)
7. [工作记忆缓冲区](#7-工作记忆缓冲区)
8. [语义知识图谱](#8-语义知识图谱)
9. [负选择算法](#9-负选择算法)
10. [失败疫苗](#10-失败疫苗)
11. [FIPA 合同网协议](#11-fipa-合同网协议)
12. [蒙特卡洛 Shapley 值](#12-蒙特卡洛-shapley-值)
13. [Lotka-Volterra 竞争模型](#13-lotka-volterra-竞争模型)
14. [GEP 锦标赛选择](#14-gep-锦标赛选择)
15. [Gossip（SWIM）协议](#15-gossipswim协议)
16. [互信息信号校准](#16-互信息信号校准)
17. [Turing 反应-扩散](#17-turing-反应-扩散)
18. [6D 情绪向量（EMA）](#18-6d-情绪向量ema)
19. [文化摩擦模型](#19-文化摩擦模型)
20. [SNA 中心性指标](#20-sna-中心性指标)

---

## 1. MMAS（最大-最小蚁群系统）

### 生物来源

蚁群通过在基质上沉积易挥发的化学踪迹（信息素）协调觅食行为。较长或低产出的路径因蒸发而积累较少的信息素，形成正反馈环路，最终收敛至最优路径。然而，Dorigo（1992）提出的原始蚁群系统存在过早收敛问题。Stutzle 和 Hoos（2000）提出 MMAS 变体，通过将信息素浓度限制在显式区间 [tau_min, tau_max] 内来解决此问题。

### 数学公式

信息素更新规则（含 MMAS 边界约束）：

```
tau_ij(t+1) = clamp( (1 - rho) * tau_ij(t) + Delta_tau_ij,  tau_min,  tau_max )

参数说明:
  rho        = 蒸发率（按信息素类型不同，范围 0.02 ~ 0.20）
  Delta_tau  = 迭代最优蚂蚁的沉积量
  tau_min    = 下界（防止路径饥饿）
  tau_max    = 上界（防止路径垄断）
```

系统定义了七种信息素类型，各自具有生物学驱动的衰减率：

| 类型 | 衰减率 | TTL（分钟） | 生物类比 |
|------|--------|-------------|---------|
| `trail` | 0.05 | 120 | 食物源路径标记 |
| `alarm` | 0.15 | 30 | 危险信号（快速衰减） |
| `recruit` | 0.10 | 60 | 任务招募信息素 |
| `queen` | 0.02 | 480 | 全群协调（最缓慢衰减） |
| `dance` | 0.08 | 90 | 摇摆舞信息共享 |
| `food` | 0.04 | 180 | 食物源质量标记 |
| `danger` | 0.20 | 20 | 历史别名；不是现行 V9 运行时的标准类型 |

衰减采用**惰性计算**策略：信息素浓度在读取时按时间差重新计算，而非通过定时器驱动，避免了对未访问路径的无谓开销。

### 源码锚点

`src/communication/pheromone/pheromone-engine.js` -- `deposit()`, `_applyDecay()`, MMAS 常量定义。

### 设计决策

无边界的信息素系统会导致停滞：一旦某条主导路径出现，其浓度会淹没所有替代方案。在 LLM 多代理系统中，这表现为反复路由到同一类型的代理。MMAS 的边界保证：任何路径都不会被完全遗弃（tau_min），任何路径也不能垄断选择（tau_max），从而在蜂群整个生命周期内维持探索能力。

---

## 2. ACO 轮盘赌选择

### 生物来源

觅食蚂蚁不做确定性选择——它们展示出随机选择行为，选择权重取决于信息素强度和局部启发式质量（如到食物源的距离）。Dorigo 和 Gambardella（1997）将此形式化为候选路径上的概率分布。

### 数学公式

```
P(path_i) = tau_i^alpha * eta_i^beta / sum_j( tau_j^alpha * eta_j^beta )

参数说明:
  tau_i  = 路径 i 上的信息素浓度
  eta_i  = 路径 i 的启发式质量（如能力匹配分数）
  alpha  = 信息素影响指数（默认: 1.0）
  beta   = 启发式影响指数（默认: 2.0）
```

`alpha` 参数控制过去经验（信息素）对决策的影响强度；`beta` 控制即时质量评估的权重。当 `beta > alpha` 时，系统偏向利用已知的优秀代理，同时仍允许信息素驱动的探索。

### 源码锚点

`src/communication/pheromone/pheromone-engine.js` -- `acoSelect(candidates, alpha, beta)` 方法。

### 设计决策

轮盘赌选择在利用与探索之间提供天然平衡，无需显式的 epsilon-greedy 参数。与锦标赛选择不同，它能随种群规模平滑缩放，并赋予每个候选者非零的被选概率——这在蜂群需要发现新代理能力时至关重要。

---

## 3. 响应阈值 + PI 控制器

### 生物来源

Bonabeau 等人（1998）观察到，个体蚂蚁对特定任务类型维护内部响应阈值。当某任务的环境刺激超过蚂蚁的个人阈值时，该蚂蚁被激活。这一机制在无中央分配的情况下产生了自组织的劳动分工。Robinson（1992）在蜜蜂中发现了与年龄相关的阈值变化（年龄多态性）。

### 数学公式

代理 `a` 对任务刺激 `s` 的激活概率：

```
P_activate(a, s) = s^n / (s^n + theta_a^n)

参数说明:
  s       = 任务刺激强度（信息素浓度）
  theta_a = 代理 a 的个人响应阈值
  n       = 陡峭度参数（默认: 2）
```

PI（比例-积分）控制器调整阈值以维持目标活动率：

```
theta_a(t+1) = theta_a(t) + Kp * e(t) + Ki * integral(e, 0, t)

参数说明:
  e(t)  = 实际活动率 - 目标活动率
  Kp    = 比例增益
  Ki    = 积分增益
```

当活动率超过目标时，阈值上升（更少代理激活）；当活动率低于目标时，阈值下降（更多代理响应）。

### 源码锚点

`src/orchestration/adaptation/response-threshold.js` -- `shouldActivate(agentId, stimulus)`, `_piUpdate()`。

### 设计决策

中央调度器在 10+ 代理的蜂群中会成为瓶颈。响应阈值模型与代理数量线性缩放，因为每个代理独立做出局部决策。PI 控制器防止了纯阈值模型在突发性工作负载下表现出的振荡现象（所有代理同时激活然后同时空闲）。

---

## 4. 人工蜂群（ABC）

### 生物来源

Karaboga（2005）对意大利蜜蜂（Apis mellifera）的觅食行为建模，观察到三种专业化角色：利用已知食物源的雇佣蜂、评估报告并概率性选择最佳源的旁观蜂、以及放弃枯竭源去发现新源的侦察蜂。这种三阶段循环维持了利用与探索之间的平衡。

### 数学公式

角色分配：

```
雇佣蜂:    50% 蜂群  -- 利用已分配的任务解决方案
旁观蜂:    45% 蜂群  -- 基于质量的轮盘赌选择
侦察蜂:     5% 蜂群  -- 随机探索新方案

旁观蜂选择概率:
  P(i) = quality_i / sum_j( quality_j )

放弃准则:
  若 trial_count(i) > limit，食物源 i 被放弃，侦察蜂展开探索。
```

### 源码锚点

`src/orchestration/scheduling/contract-net.js` -- ABC 调度逻辑已合并至 contract-net。继承 ModuleBase，接收 RECRUIT 信号。

### 设计决策

DAG 编排擅长处理结构化工作流，但无法适应非结构化的探索任务。ABC 调度提供了互补模式：当蜂群面对开放性问题（如根因未知的调试任务）时，雇佣/旁观/侦察的分工确保了系统性覆盖，同时集中资源于有前途的方向。

---

## 5. Ebbinghaus 遗忘曲线

### 生物来源

Hermann Ebbinghaus（1885）通过实验证明，人类记忆保持率随时间呈指数衰减，且受材料有意义程度的调制。他的原始公式 R = e^(-t/S)（其中 S 为记忆稳定性）至今仍是间隔重复系统的基础。

### 数学公式

```
R(t) = e^( -t / (lambda * importance) )

参数说明:
  t          = 编码后经过的时间（毫秒）
  lambda     = 基础保持半衰期（默认: 30 天 = 2,592,000,000 ms）
  importance = 主观重要性评分 [0, 1]
```

检索评分将遗忘与多维度相关性结合：

```
score = importance * 0.4 + timeDecay * 0.2 + relevance * 0.2 + reward * 0.2

其中:
  timeDecay = R(t)，如上定义
```

### 源码锚点

`src/intelligence/memory/episodic-memory.js` -- `_calculateRetention(timestamp, importance)`, `retrieve(query, topK)`。

### 设计决策

LLM 上下文窗口是有限的，并非所有过往经验都值得同等表示。Ebbinghaus 曲线提供了有原则的淘汰策略：常规事件自然消退，而高重要性事件（失败、突破、用户反馈）则保持更久。这模拟了人类专家如何保留关键教训同时遗忘日常细节的方式，为 LLM 提示产生更相关的上下文。

---

## 6. 双过程理论（Kahneman）

### 生物来源

Daniel Kahneman（2011）描述人类认知以两种模式运行：系统 1（快速、直觉、自动）和系统 2（缓慢、审慎、分析性）。系统 1 以最小认知负荷处理熟悉情境；系统 2 在新颖性、复杂性或风险要求仔细推理时介入。

### 数学公式

系统 1 激活分数（阈值: 0.55）：

```
S1_score = w1 * vaccine_match + w2 * breaker_closed + w3 * affinity_high

系统 1（DIRECT 模式）触发条件:
  - repair_memory 中存在疫苗匹配
  - 熔断器状态 == CLOSED（近期成功率 > 90%）
  - 任务亲和度评分高于阈值
```

系统 2 激活分数（阈值: 0.50）：

```
S2_score = w1 * is_new_type + w2 * breaker_half_open + w3 * alarm_density

系统 2（PREPLAN 模式）触发条件:
  - 任务类型从未出现过
  - 熔断器状态 == HALF_OPEN
  - 警报信息素密度超过阈值
  - 近期存在质量门失败
```

### 源码锚点

`src/orchestration/adaptation/dual-process-router.js` -- `route(task)`，返回 `{ mode: 'DIRECT' | 'PREPLAN' }`。

### 设计决策

并非每个任务都需要完整的 DAG 分解和规划开销。具有已知解决方案的常规任务应立即调度（系统 1），而新颖或高风险任务则需要审慎规划（系统 2）。这种双模式方法将熟悉任务类型的中位延迟降低 40-60%，同时为陌生任务保持安全裕度。

---

## 7. 工作记忆缓冲区

### 生物来源

Baddeley 和 Hitch（1974）提出了多组件工作记忆模型：中央执行系统引导注意力，语音回路处理语言信息，视觉空间画板处理空间数据，情景缓冲区整合不同来源。Miller（1956）确立了 7 +/- 2 项的容量限制。

### 数学公式

三级缓冲区架构（基于优先级的淘汰策略）：

```
缓冲区       | 容量 | 优先级底线 | 角色
------------|------|----------|------------------
Focus（焦点） |   5  |  8 (p8)  | 活动任务，最高优先级
Context（上下文）| 15 |  5 (p5)  | 近期上下文，中等优先级
ScratchPad（暂存板）| 30 | 0 (p0) | 临时计算空间

激活衰减:
  activation(item) = baseScore * (1 / (1 + ageMs / 60000))

淘汰级联: Focus 溢出 -> Context -> ScratchPad -> 丢弃
```

当条目的激活度降至其当前缓冲区的优先级底线以下时，它级联到下一个缓冲区。降至 ScratchPad 底线（0）以下的条目被丢弃。

### 源码锚点

`src/intelligence/memory/working-memory.js` -- `push(item, priority)`, `_evict()`, `getContext(maxTokens)`。

### 设计决策

LLM 提示有硬性 token 限制。扁平的近期条目列表会浪费 token 在低价值信息上。三级缓冲区模型确保最相关的条目（Focus）始终出现在提示中，上下文条目填充剩余空间，暂存计算可用但可舍弃。激活衰减函数自然地淘汰陈旧条目，无需显式清理。

---

## 8. 语义知识图谱

### 生物来源

Quillian（1967）提出了人类记忆的语义网络模型：概念为节点，关系为有向边。Collins 和 Loftus（1975）扩展了扩散激活理论：访问一个概念会激发相关概念，激活随图距离衰减。

### 数学公式

```
图 G = (V, E)，其中:
  V = 概念节点集（每个节点带有嵌入向量）
  E = 有向边集（每条边带有关系类型和权重）

核心操作:
  BFS 遍历:    reachable(source, maxDepth)
  最短路径:    dijkstra(source, target)，使用边权重
  概念合并:    merge(a, b)，当 similarity(a, b) > merge_threshold
  上下文生成:  收集 k 跳内的概念，按相关性排序
```

### 源码锚点

`src/intelligence/memory/semantic-memory.js` -- `addConcept()`, `addRelation()`, `query(concept, depth)`, `merge(conceptA, conceptB)`。

### 设计决策

情景记忆捕获特定事件；语义记忆捕获泛化知识。当代理遇到新任务时，知识图谱的 BFS 遍历能浮现近期情景记忆中可能不存在的相关概念。这类似于人类专家如何在解决新问题时依赖领域知识（语义记忆）而非仅凭过往项目经验（情景记忆）。

---

## 9. 负选择算法

### 生物来源

Forrest 等人（1994）基于生物免疫系统的 T 细胞成熟过程形式化了负选择算法。在胸腺中，能与自身抗原结合的 T 细胞被消除（负选择），只留下能检测外来（非自身）模式的细胞。这提供了无需建模异常外观即可进行异常检测的能力。

### 数学公式

```
模式类别（检测器）:
  1. error_keyword      -- 错误签名的正则模式
  2. resource_exhaust   -- 内存/token/时间阈值违规
  3. null_reference     -- null/undefined 访问模式
  4. network_failure    -- 连接/超时/DNS 模式
  5. rate_limit         -- 429/retry-after/配额模式

检测:
  match(output, detector_set) -> { matched: bool, confidence: float }
  当 confidence > 0.6 时标记为异常
```

### 源码锚点

`src/quality/analysis/anomaly-detector.js` -- `detect(agentOutput)`, `_matchPatterns(text, category)`。

### 设计决策

正向检测（定义错误的样貌）需要随着新错误类型出现而不断维护。负选择反转了问题：定义正常模式，标记其余一切。五个内置类别覆盖了 LLM 代理最常见的失败模式，而 0.6 的置信度阈值在灵敏度与误报之间取得平衡。

---

## 10. 失败疫苗

### 生物来源

Jenner（1798）证明接触牛痘可以产生对天花的免疫力，这是疫苗接种的基础原理。适应性免疫系统存储记忆 B 细胞和 T 细胞，使再次暴露时能快速产生二次应答。这种生物学记忆将多天的初次应答转化为数小时的二次应答。

### 数学公式

```
错误类别: { network, validation, timeout, logic }

疫苗记录:
  v = (pattern, category, repair_strategy, success_count, failure_count, created_at)

疫苗有效率:
  efficacy(v) = success_count / (success_count + failure_count)

查找: 工具执行前，查询 repair_memory WHERE pattern ~ current_error
  若疫苗存在 AND efficacy > threshold:
    应用 repair_strategy（系统 1 快速路径）
  否则:
    进入系统 2（完整审慎推理）
```

### 源码锚点

`src/quality/resilience/failure-vaccination.js` -- `lookup(errorSignature)`, `record(pattern, strategy)`。存储: DomainStore `repair_memory` 集合（JSON 快照）。

### 设计决策

LLM 代理反复遇到相同类型的错误（API 速率限制、JSON 格式错误、超时）。没有疫苗机制时，每次出现都触发完整的系统 2 审慎推理。有了疫苗机制，已知失败模式通过存储的修复策略在单轮 LLM 交互中解决，对于反复出现的错误，延迟和 token 消耗降低一个数量级。

---

## 11. FIPA 合同网协议

### 生物来源

合同网协议（Smith, 1980; FIPA 2002 标准化）虽非直接源自生物学，但借鉴了基于市场的资源分配。在生物学层面，它类似于蜜蜂的摇摆舞：觅食者发布食物源信息（CFP），其他蜜蜂根据自身状态评估（Bid），蜂群集体将资源引向最佳机会（Award）。

### 数学公式

```
协议阶段:
  1. CFP（建议征集）:  管理者广播任务规格
  2. Bid（竞标）:      承包商评估并提交提案
  3. Award（授予）:    管理者选择获胜投标
  4. Execution（执行）: 获奖承包商执行任务
  5. Report（报告）:   结果返回给管理者

投标评分:
  bid_score = w1 * capability_match + w2 * reputation + w3 * availability + w4 * cost

授予: argmax(bid_score)，在截止期限内的有效投标中选择。
```

### 源码锚点

`src/orchestration/scheduling/contract-net.js` -- `issueCFP(task)`, `submitBid(cfpId, proposal)`, `awardContract(cfpId)`, `reportResult(contractId, result)`。

### 设计决策

直接分配（调度器选择代理）会形成单点故障，且需要全局知识。合同网将分配决策分布化：代理根据自身能力自主选择，形成类似市场的效率。当代理能力动态变化时（新技能习得、熔断器跳闸），这一机制尤为关键，因为最新信息驻留在每个代理本地。

---

## 12. 蒙特卡洛 Shapley 值

### 生物来源

Shapley（1953）证明 Shapley 值是唯一满足效率性、对称性、虚拟参与者和可加性四条公理的贡献归因方案。虽源于合作博弈论，但在生物学中存在类比：真社会性昆虫群体中，个体适应度是群体层面贡献的函数。

### 数学公式

```
代理 i 的 Shapley 值:
  phi_i(v) = (1/n!) * sum 遍历 N 的所有排列 pi:
    [ v(S_pi_i union {i}) - v(S_pi_i) ]

蒙特卡洛近似（m = 100 次采样）:
  phi_i ~= (1/m) * sum_{k=1}^{m}:
    [ v(S_k union {i}) - v(S_k) ]

  其中 S_k 为均匀随机抽取的联盟子集。
```

特征函数 `v(S)` 衡量联盟质量（如任务完成率）。100 次蒙特卡洛采样使计算复杂度为 O(m * n)，而非精确计算的 O(2^n)。

### 源码锚点

`src/orchestration/adaptation/shapley-credit.js` -- `compute(dagResult)`，计算在 Gateway 进程内执行。

### 设计决策

简单的信用分配方案（平均分摊、按贡献比例）会产生不当激励。平均分摊打击高绩效者；按比例分配可被博弈（代理膨胀其贡献指标）。Shapley 值是唯一在四条公理下可证明公平的方案，而 100 次蒙特卡洛采样对最多 20 个代理的蜂群提供了足够的近似精度。

---

## 13. Lotka-Volterra 竞争模型

### 生物来源

Lotka（1925）和 Volterra（1926）独立推导出描述两个物种竞争共享资源的竞争方程。当种间竞争超过种内竞争时，一个物种将另一个驱向灭绝（竞争排斥）。这一动力学支配了代理物种如何竞争任务分配席位。

### 数学公式

```
dx/dt = alpha * x * (1 - x/K) - beta * x * y

参数说明:
  x, y   = 两个竞争物种的种群大小
  alpha  = 内禀增长率（出生率 - 死亡率）
  K      = 环境承载力（最大可持续种群）
  beta   = 种间竞争系数
```

在 Claw-Swarm 中，`x` 表示某物种的分配频率，`K` 为活跃物种上限（10），`beta` 由生态位重叠度导出（能力画像相似的物种竞争更为激烈）。

### 源码锚点

`src/orchestration/adaptation/species-evolver.js` -- `_lotkaVolterraStep(populations)`, `_computeNicheOverlap(speciesA, speciesB)`。

### 设计决策

没有种群动力学，蜂群会无限制地积累物种。Lotka-Volterra 提供了自然的承载力，自动淘汰冗余物种（其生态位与更成功的同类重叠），同时保留填充独特生态角色的物种。活跃物种上限 10 防止了合同网竞标阶段的组合爆炸。

---

## 14. GEP 锦标赛选择

### 生物来源

Ferreira（2001）提出基因表达编程（GEP）作为一种映射到表达树的线性遗传表示。与基于树的遗传编程（GP）不同，GEP 的固定长度染色体简化了交叉和变异操作。锦标赛选择（Goldberg 和 Deb, 1991）从种群中随机抽取 `k` 个个体并选择最适者，在选择压力与多样性之间取得平衡。

### 数学公式

```
GEP 染色体: 编码物种参数的固定长度字符串
  （权重、阈值、调度偏好）

锦标赛选择:
  1. 从种群中均匀抽取 k 个候选者
  2. 选择获胜者 = argmax(fitness(c)), c 属于候选集
  3. 重复填充交配池

物种生命周期:
  试用期:          最少 30 天
  最低成功率:      0.7（70%）方可毕业
  活跃物种上限:    10
  权重范围:        [0.05, 1.0]
```

### 源码锚点

`src/orchestration/adaptation/species-evolver.js` -- `_gepTournament(population, tournamentSize)`, `_evolveParameters(species)`。

### 设计决策

手工调优代理物种参数在超过 3-4 个物种后就无法扩展。GEP 以生物学原则驱动的搜索自动化了参数优化。30 天试用期和 70% 成功率阈值防止了仅凭运气表现良好的物种被过早提升，而活跃上限 10 限制了计算开销。

---

## 15. Gossip（SWIM）协议

### 生物来源

传染病模型（Kermack 和 McKendrick, 1927）描述了信息如何通过种群中的随机接触传播。SWIM 协议（Das 等人, 2002）将其适配于分布式故障检测：每个节点周期性地 ping 随机子集的对等方，以 O(log n) 的传播复杂度和有界的网络开销实现信息扩散。

### 数学公式

```
参数:
  fanout         = 每次心跳 ping 3 个对等方
  heartbeat      = 5 秒
  max_state_age  = 60 秒（过期状态被丢弃）

有效载荷搭载:
  记忆摘要:      按重要性评分取 top 3
  信息素快照:    按强度取 top 10

故障检测（SWIM）:
  1. 节点 A ping 随机节点 B
  2. 若 B 在超时内未响应:
     A 请求 k 个随机节点代为 ping B（间接探测）
  3. 若间接探测也失败:
     B 被标记为疑似故障，宽限期后确认死亡
```

### 源码锚点

`src/communication/stigmergy/gossip-protocol.js` -- `_heartbeat()`, `_onGossipReceived(payload)`, `_swimProbe(targetId)`。

### 设计决策

集中式心跳监控形成单点故障且不可扩展。Gossip 以每节点恒定开销（每个节点每次心跳恰好发送 `fanout` 条消息）实现分布式存活检测。在心跳消息上搭载记忆摘要和信息素快照，消除了对单独同步协议的需求，降低了总网络流量。

---

## 16. 互信息信号校准

### 生物来源

Shannon（1948）将互信息定义为给定一个随机变量的知识后，另一个随机变量不确定性的减少量。在生物感觉系统中，神经元根据其输入的统计结构校准灵敏度（Barlow, 1961: 高效编码假说）。信号校准器将这一原理应用于调整多个顾问信号的相对权重。

### 数学公式

```
互信息:
  I(X; Y) = sum_x sum_y p(x,y) * log( p(x,y) / (p(x) * p(y)) )

权重更新:
  w_i(t+1) = clamp( w_i(t) + eta * (I(signal_i; outcome) - I_baseline),  0.03,  0.40 )

参数说明:
  w_i       = 顾问信号 i 的权重
  eta       = 学习率
  I_baseline = 所有信号的运行平均 MI
  边界      = [0.03, 0.40]（下限防止信号灭绝，上限防止垄断）
```

### 源码锚点

`src/orchestration/adaptation/signal-calibrator.js` -- `calibrate(signalHistory, outcomes)`，继承 ModuleBase。MI 计算在 Gateway 进程内执行。

### 设计决策

固定的顾问权重随蜂群组成和任务分布的变化而退化。基于 MI 的校准自动提高对任务结果有预测力的信号权重，降低噪声信号权重。[0.03, 0.40] 边界确保没有单一信号能主导聚合（防止脆弱的单信号依赖），也没有信号被完全静默（保留恢复能力——当先前弱信号变为信息性时可重新利用）。

---

## 17. Turing 反应-扩散

### 生物来源

Alan Turing（1952）提出，生物系统中的空间模式（斑马鱼的条纹、豹的斑点）源于两种化学物质的相互作用：一种促进自身产生的激活子（activator）和一种抑制激活子但扩散更快的抑制子（inhibitor）。差异扩散率从均匀初始条件中产生稳定的空间模式。

### 数学公式

```
信号场中的信号传播:

激活子信号 (TRAIL, RECRUIT):
  d[A]/dt = D_a * nabla^2(A) + f(A, I)
  -- 慢扩散，局部放大

抑制子信号 (ALARM):
  d[I]/dt = D_i * nabla^2(I) + g(A, I)
  -- 快扩散，抑制激活子

约束:
  D_i > D_a  （抑制子扩散快于激活子）
  f(A, I) = 激活子反应项（自催化）
  g(A, I) = 抑制子反应项（交叉催化）
```

在离散实现中，BFS 传播模拟扩散，每个节点的信号强度根据局部激活子/抑制子浓度更新。

### 源码锚点

`src/core/field/signal-store.js` -- `deposit(signal)`, `_notifyModules()`，基于 BFS 的传播，扩散率按信号类型区分。

### 设计决策

简单的广播泛洪（所有信号等强度到达所有节点）会造成信息过载。反应-扩散创建了空间结构：招募信号在活动工作区域附近聚集，而警报信号广泛传播以警告远处的代理。这模拟了生物群落如何在食物源附近集中工蜂，同时维持全群的威胁感知。

---

## 18. 6D 情绪向量（EMA）

### 生物来源

Plutchik（1980）提出了八种基本情绪，按对立配对排列。Russell（1980）将情感建模为连续的二维空间（效价 x 唤醒度）。现代情感计算（Picard, 1997）将其扩展为多维情绪状态跟踪。Claw-Swarm 使用 6 维模型，捕获与 LLM 代理协作相关的情绪动力学。

### 数学公式

```
情绪向量 E = (frustration, confidence, joy, urgency, curiosity, fatigue)
            （挫败感,    自信,       愉悦,  紧迫感,    好奇心,    疲劳）

基线:     E_0 = (0.5, 0.5, 0.5, 0.5, 0.5, 0.5)

EMA 更新:
  E_i(t) = alpha * observed_i + (1 - alpha) * E_i(t-1)
  alpha  = 0.3（平滑因子）

向基线的自然衰减:
  E_i(t) = E_i(t-1) + decay * (0.5 - E_i(t-1))
  decay  = 0.05
```

每个维度限制在 [0, 1] 范围内。EMA（指数移动平均）提供平滑跟踪，抵抗单次交互的噪声，同时对持续的情绪变化保持响应。

### 源码锚点

`src/intelligence/social/emotional-state.js` -- `update(agentId, observations)`, `getState(agentId)`, `getEmotionalContext(agentId)`。

### 设计决策

与人类交互的 LLM 代理展示出隐含的情绪动力学：反复失败增加挫败感，成功协作建立自信，新颖任务激发好奇心。跟踪这些维度使蜂群能够自适应行为——例如，将挫败代理的任务分解为更简单的子任务，或在截止期限临近时提高紧迫感权重。alpha = 0.3 在响应性与稳定性之间取得平衡。

---

## 19. 文化摩擦模型

### 生物来源

Hofstede（1980）识别了预测跨文化协作摩擦的文化维度：权力距离、个人主义、不确定性规避、刚柔度、长期导向和放纵度。在多模型 LLM 蜂群中，不同的基础模型展示出不同的行为"文化"（指令遵循风格、详细程度、风险容忍度），产生类似跨文化误解的协作摩擦。

### 数学公式

```
模型 A 与模型 B 之间的文化摩擦:
  F(A, B) = sum_d w_d * |C_d(A) - C_d(B)|

参数说明:
  C_d(X) = 模型 X 在文化维度 d 上的评分
  w_d    = 维度权重
  d      = { instruction_compliance,  -- 指令遵循度
             verbosity,              -- 详细程度
             risk_tolerance,         -- 风险容忍度
             format_consistency,     -- 格式一致性
             reasoning_depth,        -- 推理深度
             tool_usage_pattern }    -- 工具使用模式

协作成本调整:
  adjusted_cost(task, A, B) = base_cost(task) * (1 + gamma * F(A, B))
  gamma = 摩擦放大因子
```

### 源码锚点

`src/intelligence/social/cultural-friction.js` -- `estimateFriction(modelA, modelB)`, `adjustCollaborationCost(task, team)`。

### 设计决策

多模型蜂群（混合不同 LLM 提供商）会遇到微妙的兼容性问题：一个模型的输出格式可能混淆另一个模型的解析器，或一个模型的风险规避行为可能与另一个模型的探索倾向冲突。文化摩擦模型量化这些不兼容性，并将其反馈到合同网竞标过程中，在需要紧密协作的任务中自然偏向兼容模型组合。

---

## 20. SNA 中心性指标

### 生物来源

社会网络分析源自 Moreno 的社会计量学（1934），并通过图论中心性度量加以形式化。在生物群落中，某些个体充当信息中介（介数中心性）、高连接度枢纽（度中心性）或有影响力的领袖（特征向量中心性）。Freeman（1977）将这些度量统一为现代 SNA 框架。

### 数学公式

```
度中心性:
  C_D(v) = deg(v) / (n - 1)

介数中心性:
  C_B(v) = sum_{s != v != t} ( sigma_st(v) / sigma_st )
  其中 sigma_st     = 从 s 到 t 的总最短路径数
       sigma_st(v)  = 经过 v 的最短路径数

PageRank:
  PR(v) = (1 - d) / n + d * sum_{u in in(v)} PR(u) / out_degree(u)
  d = 阻尼因子（默认: 0.85）
```

### 源码锚点

`src/intelligence/social/sna-analyzer.js` -- `computeDegree()`, `computeBetweenness()`, `computePageRank(dampingFactor, iterations)`。

### 设计决策

扁平的协作模式（所有代理被选中协作的概率相等）会产生次优的信息流。SNA 指标识别出瓶颈代理（高介数——可能成为单点故障）、孤立代理（低度——未被充分利用）和有影响力的代理（高 PageRank——其行为对蜂群产生不成比例的影响）。这些指标为区域分配、领导选举和 gossip 协议的目标选择提供依据。

---

## 跨算法交互图谱

20 种算法并非孤立运行，关键交互路径如下：

| 路径 | 描述 |
|------|------|
| 信息素 (1,2) -> 响应阈值 (3) | 信息素浓度作为阈值比较的任务刺激 |
| 负选择 (9) -> 疫苗 (10) -> 双过程 (6) | 检测到的异常成为疫苗模式，将路由从系统 2 转移至系统 1 |
| ABC (4) -> 合同网 (11) | 侦察蜂发现新任务源，进入合同网拍卖 |
| Shapley (12) -> 声誉 -> 阈值 (3) | 公平的贡献归因更新声誉评分，声誉调制响应阈值 |
| Lotka-Volterra (13) + GEP (14) | 种群动力学决定哪些物种存活；GEP 优化存活物种的参数 |
| Gossip (15) -> SNA (20) | Gossip 通信模式构成 SNA 分析的社会网络图 |
| 反应-扩散 (17) -> 信号校准 (16) | 信号场传播产生原始信号数据，MI 校准进行调优 |
| 情绪 (18) + 文化摩擦 (19) | 情绪状态影响文化摩擦阈值（挫败代理的摩擦容忍度更低） |
| 工作记忆 (7) + 情景 (5) + 语义 (8) | 三层记忆系统提供分层上下文：即时、经验和概念 |

---

## 参考文献

- Bonabeau, E. et al. (1998). Fixed response thresholds and the regulation of division of labor in insect societies.
- Collins, A. M. & Loftus, E. F. (1975). A spreading-activation theory of semantic processing.
- Das, A. et al. (2002). SWIM: Scalable Weakly-consistent Infection-style Process Group Membership Protocol.
- Dorigo, M. & Gambardella, L. M. (1997). Ant Colony System: A cooperative learning approach to the TSP.
- Ebbinghaus, H. (1885). Memory: A Contribution to Experimental Psychology.
- Ferreira, C. (2001). Gene Expression Programming: A new adaptive algorithm for solving problems.
- Forrest, S. et al. (1994). Self-nonself discrimination in a computer.
- Freeman, L. C. (1977). A set of measures of centrality based on betweenness.
- Hofstede, G. (1980). Culture's Consequences: International Differences in Work-Related Values.
- Kahneman, D. (2011). Thinking, Fast and Slow.
- Karaboga, D. (2005). An Idea Based on Honey Bee Swarm for Numerical Optimization.
- Lotka, A. J. (1925). Elements of Physical Biology.
- Picard, R. W. (1997). Affective Computing.
- Plutchik, R. (1980). Emotion: A Psychoevolutionary Synthesis.
- Quillian, M. R. (1967). Word concepts: A theory and simulation of some basic semantic capabilities.
- Shannon, C. E. (1948). A mathematical theory of communication.
- Shapley, L. S. (1953). A value for n-person games.
- Smith, R. G. (1980). The Contract Net Protocol: High-level communication and control in a distributed problem solver.
- Stutzle, T. & Hoos, H. H. (2000). MAX-MIN Ant System.
- Turing, A. M. (1952). The chemical basis of morphogenesis.
- Volterra, V. (1926). Variazioni e fluttuazioni del numero d'individui in specie animali conviventi.

---

[← 返回 README](../../README.zh-CN.md) | [English](../en/biomimicry.md)
