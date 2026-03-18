# 信号场架构 (Signal Field Architecture)

[<- 返回 README](../../README.zh-CN.md) | [English](../en/signal-mesh.md)

Claw-Swarm V9 用 **12 维连续信号场** 替代了 V8 的信号-网格（5 类型 x 19 子类型离散事件 + ScopeGraph BFS 传播）。所有模块浸泡在同一个场中：向特定维度释放信号，通过叠加后的场向量感知环境并做出决策。模块之间不直接调用——所有跨模块协调都经由场中介。

---

## 目录

1. [V8 vs V9 对比](#v8-vs-v9-对比)
2. [12 维度定义](#12-维度定义)
3. [Forward Decay 编码](#forward-decay-编码)
4. [核心组件](#核心组件)
   - [SignalStore](#signalstore)
   - [MemoryBackend](#memorybackend)
   - [FieldVector](#fieldvector)
   - [GCScheduler](#gcscheduler)
5. [信号生命周期](#信号生命周期)
6. [场向量叠加](#场向量叠加)
7. [灵敏度过滤器](#灵敏度过滤器)
8. [垃圾回收](#垃圾回收)
9. [ModuleBase 契约](#modulebase-契约)
10. [零空转启动验证](#零空转启动验证)
11. [四种耦合机制](#四种耦合机制)
12. [V8 空转模块的激活设计](#v8-空转模块的激活设计)
13. [性能特征](#性能特征)
14. [测试](#测试)

---

## V8 vs V9 对比

| 维度 | V8 信号网格 | V9 信号场 |
|------|-----------|----------|
| 信号模型 | 5 类型 x 19 子类型（离散） | 12 连续维度 |
| 传播方式 | ScopeGraph BFS 逐跳传播 | 按作用域键存储，直接叠加 |
| 衰减机制 | MMAS 钳位 [0.001, 1.0] | Forward Decay: `s * exp(-lambda * age)` |
| 基类 | `MeshNode`（受体/效应器） | `ModuleBase`（produces/consumes） |
| 耦合方式 | 地址 + BFS 可达性 | 场中介：向维度释放信号，通过 superpose 感知 |
| 空转模块 | 6 个模块零订阅者 | 零空转——启动验证强制 producer/consumer 配对 |
| 存储实现 | NativeCore（图 + 存储） | MemoryBackend（三索引 Map） |
| GC | 无（依赖衰减蒸发） | GCScheduler：定期 + 100K 信号紧急回收 |

### 架构范式变化

```
V8 (点对点 + BFS):
  MeshNode-A ──deposit──> SignalField ──BFS──> ScopeGraph ──notify──> MeshNode-B
  问题：BFS 复杂度 O(V+E)，6 个模块无订阅者

V9 (场中介):
  Module-A ──emit──> SignalStore[scope][dim] ──superpose──> FieldVector ──perceive──> Module-B
  解决：emit O(1)，零空转保证
```

---

## 12 维度定义

**源码：** `src/core/field/types.js` (133 行)

每个信号恰好属于 12 个维度之一。维度决定信号的语义和默认衰减率。

| # | 常量 | 键名 | 语义 | 默认 lambda | TTL (ms) | 衰减速度 |
|---|------|------|------|-----------|----------|---------|
| 1 | `DIM_TRAIL` | `trail` | Agent 移动和任务路径 | 0.008 | ~863,000 | 慢 |
| 2 | `DIM_ALARM` | `alarm` | 异常、错误、紧急事件 | 0.15 | ~46,000 | 快 |
| 3 | `DIM_REPUTATION` | `reputation` | Agent 可信度和表现评分 | 0.005 | ~1,381,000 | 慢 |
| 4 | `DIM_TASK` | `task` | 任务发布、进度、完成 | 0.01 | ~691,000 | 中 |
| 5 | `DIM_KNOWLEDGE` | `knowledge` | 知识发现、共享、蒸馏 | 0.003 | ~2,302,000 | 慢 |
| 6 | `DIM_COORDINATION` | `coordination` | 多代理协作、同步 | 0.02 | ~345,000 | 中 |
| 7 | `DIM_EMOTION` | `emotion` | Agent 情绪状态、压力指示 | 0.1 | ~69,000 | 快 |
| 8 | `DIM_TRUST` | `trust` | 代理间信任关系 | 0.006 | ~1,151,000 | 慢 |
| 9 | `DIM_SNA` | `sna` | 社交网络分析、中心度 | 0.004 | ~1,727,000 | 慢 |
| 10 | `DIM_LEARNING` | `learning` | 经验习得、技能提升 | 0.002 | ~3,453,000 | 极慢 |
| 11 | `DIM_CALIBRATION` | `calibration` | 系统参数校准、调优 | 0.01 | ~691,000 | 中 |
| 12 | `DIM_SPECIES` | `species` | 种群进化、变异、淘汰 | 0.001 | ~6,908,000 | 极慢 |

**TTL 公式：** `TTL = ln(1 / threshold) / lambda`，其中 `threshold = 0.001`

**设计意图：** 快衰减维度（alarm: 0.15, emotion: 0.1）代表瞬态状态，迅速失去相关性。慢衰减维度（species: 0.001, learning: 0.002）代表累积知识，跨会话持久保留。

### 维度分类

```
快衰减 (lambda >= 0.1):          ┌─ alarm (0.15)  — 46 秒 TTL
  瞬态信号，秒级失效              └─ emotion (0.1) — 69 秒 TTL

中衰减 (0.01 <= lambda < 0.1):   ┌─ coordination (0.02) — 345 秒 TTL
  分钟级别有效                    ├─ task (0.01)         — 691 秒 TTL
                                  └─ calibration (0.01)  — 691 秒 TTL

慢衰减 (lambda < 0.01):          ┌─ trail (0.008)      — 863 秒 TTL
  持久知识和关系                  ├─ trust (0.006)      — 1,151 秒 TTL
                                  ├─ reputation (0.005) — 1,381 秒 TTL
                                  ├─ sna (0.004)        — 1,727 秒 TTL
                                  ├─ knowledge (0.003)  — 2,302 秒 TTL
                                  ├─ learning (0.002)   — 3,453 秒 TTL
                                  └─ species (0.001)    — 6,908 秒 TTL
```

---

## Forward Decay 编码

**源码：** `src/core/field/forward-decay.js` (108 行)

Forward Decay 消除了定期衰减扫描的需求。信号在发射时编码、在查询时解码——无需后台定时器。

### 数学公式

```
编码（写入时，forward-decay.js:33-37）：
  encodedScore = strength * exp(lambda * emitTime)

解码（读取时，forward-decay.js:48-52）：
  decodedStrength = encodedScore * exp(-lambda * readTime)

直接计算（避免中间值溢出，forward-decay.js:67-76）：
  actualStrength = strength * exp(-lambda * max(0, readTime - emitTime))

过期检查（forward-decay.js:89-91）：
  isExpired = actualStrength(s, lambda, tEmit, tRead) < threshold

存活时间（forward-decay.js:105-108）：
  TTL = ln(1 / threshold) / lambda
```

### 为什么选择 Forward Decay？

| 方法 | 写入开销 | 读取开销 | 后台开销 | 溢出风险 |
|------|---------|---------|---------|---------|
| 定期扫描 | O(1) | O(1) | O(N)/周期 | 无 |
| 惰性衰减 | O(1) | O(1)+exp | 无 | 中等 |
| **Forward Decay** | **O(1)+exp** | **O(1)+exp** | **无** | **已用直接计算缓解** |

`actualStrength()` 函数（`forward-decay.js:67`）完全绕过 encode/decode 对，直接计算 `s * exp(-lambda * age)`。这避免了 `exp(lambda * emitTime)` 对大时间戳产生的天文数字级中间值。

### 边界情况处理（forward-decay.js:33-76）

| 场景 | 行为 |
|------|------|
| `strength <= 0` | 返回 0（无信号） |
| `lambda <= 0` | 返回钳位后的 strength（永不衰减） |
| `readTime < emitTime` | age 视为 0（时钟偏移保护） |
| 结果超出 [0, 1] | 钳位到 [0, 1] |

### 衰减曲线示例

```
strength=0.8, lambda=0.008 (trail):

  1.0 |
  0.8 |*
  0.6 | ****
  0.4 |     ******
  0.2 |           *********
  0.0 |____________________*********____
      0   100   200   300   400   500  (秒)
                                        TTL ~863s

strength=0.8, lambda=0.15 (alarm):

  1.0 |
  0.8 |*
  0.6 | *
  0.4 |  *
  0.2 |   **
  0.0 |_____****________________________
      0    10   20   30   40   50  (秒)
                                    TTL ~46s
```

---

## 核心组件

### SignalStore

**源码：** `src/core/field/signal-store.js` (382 行)

信号场的顶层模块，组合 MemoryBackend + ForwardDecay + FieldVector + GCScheduler。继承 `ModuleBase`，声明 `produces() = ALL_DIMENSIONS`、`consumes() = []`。

**窄腰 API (Narrow-Waist API)：**

| 方法 | 描述 | 复杂度 |
|------|------|--------|
| `emit(partial)` | 向信号场发射新信号（Forward Decay 编码后存储） | O(1) |
| `query(filter)` | 查询信号（附加 actualStrength，过滤 + 排序） | O(N)，N=匹配信号数 |
| `superpose(scope, dims?)` | 按作用域计算 12 维场向量 | O(N)，N=该 scope 信号数 |
| `gc()` | 手动触发垃圾回收 | O(N)，N=全部信号数 |
| `start()` | 启动定时 GC | O(1) |
| `stop()` | 停止定时 GC | O(1) |
| `stats()` | 获取合并统计数据（后端 + GC + 操作计数） | O(1) |

**emit() 返回的信号结构（signal-store.js:139-220）：**

```javascript
{
  id:           'abc123def456',          // nanoid(12)
  dimension:    'alarm',                 // ALL_DIMENSIONS 之一
  scope:        'agent-researcher-1',    // 作用域键
  strength:     0.8,                     // 原始强度 [0, 1]
  lambda:       0.15,                    // 衰减率
  emitTime:     1710720000000,           // 发射时 Date.now()
  encodedScore: 2.34e+46,               // strength * exp(lambda * emitTime)
  emitterId:    'AnomalyDetector',       // 发射者标识
  metadata:     { errorType: 'timeout' } // 可选附加数据
}
```

**emit() 参数验证规则（signal-store.js:141-175）：**

| 参数 | 验证规则 |
|------|---------|
| `dimension` | 必须是 `ALL_DIMENSIONS` 12 个值之一，否则抛出 Error |
| `scope` | 必须是非空字符串，否则抛出 Error |
| `strength` | 必须是有效数字，自动钳位到 [0, 1] |
| `lambda` | 可选，默认按维度查表 `DEFAULT_LAMBDA[dimension]` |
| `emitTime` | 可选，默认 `Date.now()` |
| `emitterId` | 可选，默认 `'system'` |

**发布的事件主题（signal-store.js:40-44）：**

| 事件主题 | 触发时机 |
|---------|---------|
| `field.signal.emitted` | 每次 `emit()` 调用后 |
| `field.gc.completed` | 手动 `gc()` 完成后 |
| `field.emergency_gc` | 信号数超过 `maxSignals`（默认 100,000）时 |

**query() 处理流程（signal-store.js:236-273）：**

```
步骤 1: 后端扫描（利用索引加速） → scan(backendFilter)
步骤 2: 附加 _actualStrength（直接计算，避免溢出）
步骤 3: 按 minStrength 过滤
步骤 4: 按 sortBy 排序（'strength' 或 'emitTime'）
步骤 5: 按 limit 截断
返回: Signal[] 带 _actualStrength 字段
```

### MemoryBackend

**源码：** `src/core/field/backends/memory.js` (215 行)

三索引内存存储后端，提供跨三种访问模式的快速查询：

```
索引 1: _allSignals   Map<id, Signal>              — O(1) 按 ID 查找
索引 2: _scopeIndex   Map<scope, Map<id, Signal>>  — O(1) 按作用域过滤
索引 3: _dimIndex     Map<dimension, Set<id>>       — O(1) 按维度过滤
```

**查询策略选择（memory.js:65-131）：**

| 过滤组合 | 策略 | 复杂度 |
|---------|------|--------|
| `scope + dimension` | scope Map 与 dimension Set 取交集 | O(min(S, D)) |
| 仅 `scope` | 直接取 scope Map 的值 | O(S) |
| 仅 `dimension` | dimension Set 映射到信号查找 | O(D) |
| 无过滤 | `_allSignals` 全量扫描 | O(N) |

索引加速选择后，再依次应用二次过滤（emitterId、maxAge）和排序（strength、emitTime）。

**写入流程（memory.js:35-56）：**

```
put(signal):
  1. _allSignals.set(id, signal)        — 主存储
  2. _scopeIndex[scope].set(id, signal) — 作用域索引
  3. _dimIndex[dimension].add(id)       — 维度索引
  三次索引同步写入，保证查询一致性
```

**批量删除流程（memory.js:140-172）：**

```
remove(ids):
  对每个 id:
    1. 从 _allSignals 删除
    2. 从 _scopeIndex[scope] 删除（空 Map 则删除整个 scope 键）
    3. 从 _dimIndex[dimension] 删除（空 Set 则删除整个维度键）
  返回: 实际删除数量
```

**内存估算（memory.js:199-213）：**

```
memoryEstimateBytes = signalCount * 300 + scopeCount * 64 + dimensionCount * 64
  每个信号 ~300 bytes（对象 + 3 索引引用）
```

### FieldVector

**源码：** `src/core/field/field-vector.js` (178 行)

12 维向量运算模块，用于信号叠加与感知计算。

**核心函数：**

| 函数 | 签名 | 描述 |
|------|------|------|
| `superpose` | `(signals, dims?, readTime?) -> FieldVector` | 按维度求和实际强度，每维度钳位 [0, 1] |
| `applyFilter` | `(rawVector, sensitivity) -> FieldVector` | 逐维度乘以灵敏度系数（默认 0 = 忽略） |
| `applyCalibration` | `(rawVector, weights) -> FieldVector` | 逐维度乘以校准权重（默认 1.0 = 不变） |
| `magnitude` | `(vector) -> number` | L2 范数（向量长度） |
| `dominant` | `(vector) -> { dimension, strength }` | 找到最强的维度 |
| `diff` | `(v1, v2) -> FieldVector` | 逐维度相减 |
| `normalize` | `(vector) -> FieldVector` | 单位化（L2 范数 = 1，零向量返回零向量） |

**superpose 算法（field-vector.js:48-63）：**

```
输入: signals[] — 信号数组
      dimensions[] — 参与叠加的维度（默认全部 12 维）
      readTime — 读取时间戳

算法:
  v = zeroVector()  // 12 维全零
  for each signal in signals:
    if signal.dimension not in dimensions: skip
    actual = actualStrength(signal.strength, signal.lambda, signal.emitTime, readTime)
    v[signal.dimension] += actual
  for each dim in ALL_DIMENSIONS:
    v[dim] = clamp(v[dim], 0, 1)
  return v
```

**applyFilter vs applyCalibration：**

| 操作 | 默认值 | 用途 | 调用者 |
|------|--------|------|--------|
| `applyFilter` | 0（忽略） | 角色灵敏度——不同角色感知不同维度 | SensitivityFilter |
| `applyCalibration` | 1.0（不变） | 系统校准——动态调整维度权重 | SignalCalibrator 产出 |

### GCScheduler

**源码：** `src/core/field/gc-scheduler.js` (156 行)

时间分块垃圾回收调度器，避免 stop-the-world 暂停。

| 模式 | 间隔 | 触发条件 | 行为 |
|------|------|---------|------|
| 定期 | 60 秒（可配） | setInterval 定时器 | 扫描全部信号，移除低于过期阈值的 |
| 紧急 | emit() 时 | 信号数 > `maxSignals` (100,000) | 定期 GC + 若仍超限则移除最旧 10% |

**定时器不阻止进程退出：** `timer.unref()` 确保 GC 定时器不会阻止 Node.js 进程正常退出（gc-scheduler.js:52）。

---

## 信号生命周期

```
                    ┌──────────────────────────────────────────────────────┐
                    │                  信号生命周期                          │
                    │                                                      │
   模块 A           │  ┌──────┐    ┌───────────┐    ┌──────────────┐      │  模块 B
   (生产者)         │  │ emit │───>│ Backend   │───>│ superpose()  │      │  (消费者)
        │           │  │      │    │ put()     │    │ 按作用域叠加  │      │       │
        │           │  │ O(1) │    │ 三索引    │    │ O(N)         │      │       │
        ▼           │  └──┬───┘    │ 写入      │    └──────┬───────┘      │       ▼
   field.emit({     │     │        └─────┬─────┘           │             │  perceived =
     dimension,     │     │              │                  │             │  applyFilter(
     scope,         │     │         ┌────▼────┐      ┌─────▼───────┐    │    raw, sens)
     strength,      │     │         │   GC    │      │ FieldVector │    │
     ...            │     │         │ 定期扫描 │      │ 12 维       │    │
   })               │     │         │ + 紧急回 │      │ 钳位 [0,1]  │    │
                    │     │         │ 收      │      │             │    │
                    │     │         └─────────┘      └─────────────┘    │
                    │     │                                              │
                    │     ▼                                              │
                    │  EventBus: field.signal.emitted                    │
                    └──────────────────────────────────────────────────────┘

  时间轴:
  ──────────────────────────────────────────────────────────────────────>
  t=emit         strength = s                   (新鲜信号)
  t=emit+dt      strength = s * e^(-lambda*dt)  (正在衰减)
  t=TTL          strength < 0.001               (已过期，GC 移除)
```

---

## 场向量叠加

当模块需要感知场的状态时，调用 `superpose(scope)` 获取 12 维向量：

```javascript
// SignalStore.superpose() (signal-store.js:287-290)
superpose(scope, dimensions = ALL_DIMENSIONS) {
  const signals = this._backend.scan({ scope })
  return computeSuperpose(signals, dimensions, Date.now())
}
```

叠加过程对给定 scope 内所有信号按维度求和实际（衰减后）强度，每维度钳位 [0, 1]：

```
对每个维度 d:
  vector[d] = clamp( SUM( actualStrength(s_i) for s_i where s_i.dimension == d ), 0, 1 )
```

**示例：** 某 Agent 作用域有 3 个活跃信号：

| 信号 | 维度 | 原始强度 | 年龄 (ms) | lambda | 实际强度 |
|------|------|---------|----------|--------|---------|
| sig-1 | trail | 0.8 | 10,000 | 0.008 | 0.738 |
| sig-2 | alarm | 0.7 | 5,000 | 0.15 | 0.331 |
| sig-3 | trail | 0.5 | 20,000 | 0.008 | 0.426 |

叠加向量（部分）：`{ trail: 1.0 (从 1.164 钳位), alarm: 0.331, ... 其余维度: 0 }`

### 决策模块如何使用场向量

```javascript
// SpawnAdvisor 的决策不是线性 if-else，是场向量的多维感知
class SpawnAdvisor {
  advise(taskScope, requestedRole) {
    // 一次性读取 12 维叠加向量
    const fv = this.field.superpose(taskScope, ALL_DIMENSIONS)

    // 应用 SignalCalibrator 权重校准（DIM_CALIBRATION）
    const calibrated = applyCalibration(fv, calibrationWeights)

    // 应用角色灵敏度（可能已被 SpeciesEvolver 进化过）
    const perceived = applyFilter(calibrated, roleSensitivity)

    // 多维度加权决策
    return {
      role:        this._selectRole(perceived),        // TASK + KNOWLEDGE + SNA
      model:       this._selectModel(perceived),       // EMOTION + TRUST + LEARNING
      priority:    this._selectPriority(perceived),    // ALARM + COORDINATION
      companions:  this._selectCompanions(perceived),  // SNA + TRUST
      constraints: this._selectConstraints(perceived)  // SPECIES + CALIBRATION
    }
  }
}
```

**关键：SpawnAdvisor 不 import EmotionalState、不 import TrustDynamics、不 import SNAAnalyzer。它只读场向量。场向量包含了所有模块释放的信号。模块之间完全解耦，但通过场紧密协作。**

---

## 灵敏度过滤器

**源码：** `src/intelligence/identity/sensitivity-filter.js` (118 行)

不同角色对同一场的感知不同。`researcher` 对 `knowledge` 信号高度敏感，对 `alarm` 信号不太敏感。`implementer` 则相反。

### 核心公式

```
perceived[dim] = raw[dim] * sensitivity[dim]
```

### SensitivityFilter API

| 方法 | 描述 |
|------|------|
| `applyFilter(rawVector, roleId)` | 对原始 12 维向量应用角色灵敏度 |
| `perceive(scope, roleId)` | superpose + filter 一步完成 |
| `comparePerceptions(scope, roleIds)` | 比较不同角色对同一 scope 的感知差异 |

### 灵敏度系数示例

| 维度 | researcher | implementer | debugger | coordinator |
|------|-----------|-------------|----------|-------------|
| trail | 0.3 | 0.8 | 0.5 | 0.6 |
| alarm | 0.2 | 0.6 | 0.95 | 0.8 |
| knowledge | 0.95 | 0.4 | 0.3 | 0.5 |
| task | 0.5 | 0.9 | 0.7 | 0.85 |
| emotion | 0.4 | 0.3 | 0.8 | 0.7 |
| trust | 0.3 | 0.5 | 0.4 | 0.9 |
| sna | 0.6 | 0.3 | 0.2 | 0.95 |
| learning | 0.7 | 0.5 | 0.3 | 0.4 |

### 感知差异示例

假设某 scope 的原始场向量为：`{ alarm: 0.8, knowledge: 0.6, task: 0.5, ... }`

```
researcher 感知:  { alarm: 0.16, knowledge: 0.57, task: 0.25, ... }
  → 高知识感知，低警报感知 → 专注于信息发现

debugger 感知:    { alarm: 0.76, knowledge: 0.18, task: 0.35, ... }
  → 高警报感知，低知识感知 → 专注于错误排查
```

**灵敏度是活的：** 当 SpeciesEvolver 向 `DIM_SPECIES` 维度写入进化后的灵敏度配置时，RoleRegistry 读取并应用——灵敏度从静态配置变成了进化的属性。

---

## 垃圾回收

### 双层策略

**第一层——定期 GC（gc-scheduler.js:73-100）：**

```
每 60 秒（通过 gcIntervalMs 可配）：
  1. 从后端扫描全部信号
  2. 对每个信号计算 actualStrength(now)
  3. 若 actualStrength < threshold (0.001) → 标记为过期
  4. 批量从后端移除所有过期信号 ID
  5. 返回 { removed, remaining, durationMs }
```

**第二层——紧急 GC（gc-scheduler.js:109-138）：**

```
触发条件：backend.count() > maxSignals (100,000)

  1. 先执行第一层（定期 GC）
  2. 若 remaining 仍 > maxSignals:
     a. 扫描全部信号，按 emitTime 升序排序
     b. 选取最旧的 10%（ceil）
     c. 批量移除
  3. 返回 { removed, remaining, durationMs, emergency: true }
```

### GC 统计数据（gc-scheduler.js:147-155）

| 指标 | 描述 |
|------|------|
| `lastGCTime` | 最后一次 GC 的时间戳 |
| `lastRemoved` | 最后一次 GC 移除的信号数 |
| `totalRemoved` | 累计移除的信号总数 |
| `runs` | GC 总执行次数 |
| `emergencyRuns` | 紧急 GC 执行次数 |

---

## ModuleBase 契约

**源码：** `src/core/module-base.js` (59 行)

每个 V9 模块继承 `ModuleBase`，声明自己的信号场接口：

```javascript
class ModuleBase {
  static produces()   { return [] }  // 向场释放的维度（DIM_* 常量）
  static consumes()   { return [] }  // 从场读取的维度（DIM_* 常量）
  static publishes()  { return [] }  // 在 EventBus 上发布的事件主题
  static subscribes() { return [] }  // 在 EventBus 上订阅的事件主题
  async start() {}                   // 启动（初始化资源、注册订阅）
  async stop() {}                    // 停止（释放资源、取消订阅）
}
```

**实际模块声明示例：**

| 模块 | produces() | consumes() |
|------|-----------|------------|
| SignalStore | ALL_DIMENSIONS (12) | [] |
| SensitivityFilter | [] | ALL_DIMENSIONS (12) |
| EmotionalState | [DIM_EMOTION] | [DIM_ALARM, DIM_REPUTATION] |
| TrustDynamics | [DIM_TRUST] | [DIM_REPUTATION, DIM_TRAIL] |
| SNAAnalyzer | [DIM_SNA] | [DIM_TRAIL, DIM_COORDINATION] |
| EpisodeLearner | [DIM_LEARNING] | [DIM_TRAIL, DIM_KNOWLEDGE] |
| SignalCalibrator | [DIM_CALIBRATION] | [DIM_TRAIL, DIM_ALARM, ...] |
| SpeciesEvolver | [DIM_SPECIES] | [DIM_REPUTATION, DIM_LEARNING] |
| SpawnAdvisor | [DIM_TASK, DIM_COORDINATION] | 11 个维度 |

---

## 零空转启动验证

启动时 `swarm-core.js` 收集所有模块的 `produces()` 和 `consumes()` 声明，验证两个不变量：

```
不变量 1: 对于每个有生产者的维度 D，D 必须有至少一个消费者。
  违反 → Error: "空转检测: D 被 [X] 释放但无消费者"

不变量 2: 对于每个有消费者的维度 D，D 必须有至少一个生产者。
  违反 → Error: "断线检测: D 被 [Y] 消费但无生产者"
```

如果任一不变量失败，系统拒绝启动。这是零空转的架构级保证——由运行时代码强制执行，而非文档约定。

```
V8: 15,000 行代码 x 13% 活跃 = ~2,000 行有效代码
V9: 12,380 行代码 x 100% 活跃 = 12,380 行有效代码

有效代码量提升 6 倍。
```

---

## 四种耦合机制

V9 中模块之间只通过以下四种方式交互，不存在直接函数调用跨域：

| # | 机制 | 适用场景 | 示意 |
|---|------|---------|------|
| 1 | **场中介耦合** | 连续信号、需要衰减、多对多 | Module --emit--> SignalStore --superpose--> Module |
| 2 | **事件总线耦合** | 一次性通知、不需衰减 | Module --publish--> EventBus --subscribe--> Module |
| 3 | **存储中介耦合** | 持久数据、异步共享 | Module --put--> DomainStore --query--> Module |
| 4 | **依赖注入** | 启动时组装，仅限域内 | swarm-core.js 创建模块 -> 注入引用 |

**规则：跨域交互必须走机制 1-3。机制 4 仅限域内模块互引。**

```
传统架构：A -> B -> C -> D （线性，增加一个模块要改调用链）

场架构：
  A ──释放──> 场 <──感知── D
  B ──释放──>   <──感知── E
  C ──释放──>   <──感知── F

  增加模块 G：G ──释放──> 场  （零改动，已有感知者自动受益）
  增加感知者 H：场 <──感知── H （零改动，已有释放者自动被感知）
```

---

## V8 空转模块的激活设计

V8 中有 6 个模块存在"只写不读"的空转问题。V9 通过 12 维信号场为每个模块建立了完整的生产者-消费者链：

| # | 模块 | V8 问题 | V9 维度 | V9 消费者 |
|---|------|---------|---------|----------|
| 1 | EmotionalState | 发布事件，零订阅者 | DIM_EMOTION | SpawnAdvisor, PromptBuilder, EILayer |
| 2 | TrustDynamics | 零订阅者 | DIM_TRUST | ResultSynthesizer, SpawnAdvisor, ContractNet |
| 3 | SNAAnalyzer | 仅 Dashboard 读 | DIM_SNA | ExecutionPlanner, SpawnAdvisor, HierarchicalCoord |
| 4 | EpisodeLearner | 零订阅者，纯积累 | DIM_LEARNING | SpawnAdvisor, BudgetTracker, ScopeEstimator |
| 5 | SignalCalibrator | 初始化后无调用 | DIM_CALIBRATION | FieldVector 权重调整（间接影响所有消费者） |
| 6 | SpeciesEvolver | Lotka-Volterra 关闭 | DIM_SPECIES | RoleRegistry, SpawnAdvisor |

### 激活示例：EmotionalState -> DIM_EMOTION

```
释放：
  Agent 连续失败 -> EmotionalState 计算 frustration 指数
  -> field.emit({ dimension: 'emotion', scope: agentScope, strength: 0.8,
                  metadata: { frustration: 0.8, confidence: 0.2 } })

感知：
  SpawnAdvisor.advise():
    fv = field.superpose(scope)
    if (fv.emotion > 0.6) -> 建议升级模型或更换角色

  PromptBuilder.build():
    perceived = sensitivityFilter.perceive(scope, roleId)
    if (perceived.emotion > 0.5) -> 注入行为提示
```

### 激活示例：SignalCalibrator -> DIM_CALIBRATION（元级优化）

```
释放：
  每 N 轮任务 -> SignalCalibrator 计算互信息
  -> ALARM vs 实际失败相关性 = 0.3（大量误报）
  -> KNOWLEDGE vs 任务成功相关性 = 0.9（高度相关）
  -> field.emit({ dimension: 'calibration', scope: 'global', strength: 0.8,
                  metadata: { weights: { alarm: 0.5, knowledge: 1.2, ... } } })

感知：
  所有调用 applyCalibration() 的模块:
    alarm 权重从 1.0 降到 0.5 -> 减少误报影响
    knowledge 权重从 1.0 升到 1.2 -> 增强知识信号的决策影响力

SignalCalibrator 调节的不是决策本身，而是场的感知灵敏度。
所有读取场的模块自动受益。
```

---

## 性能特征

| 操作 | 复杂度 | 源码位置 |
|------|--------|---------|
| `emit()` | O(1) 摊还 | signal-store.js:139-220 |
| `query()`（有索引） | O(S) 或 O(D) | signal-store.js:236-273, memory.js:65-131 |
| `query()`（全量扫描） | O(N) | memory.js:97-98 |
| `superpose()` | O(N)，N=scope 内信号数 | signal-store.js:287-290, field-vector.js:48-63 |
| `gc()` 定期 | O(N)，N=全部信号数 | gc-scheduler.js:73-100 |
| `gc()` 紧急 | O(N) + O(N log N) 排序 | gc-scheduler.js:109-138 |
| Backend `put()` | O(1) | memory.js:35-56 |
| Backend `remove()` | O(K)，K=待删 ID 数 | memory.js:140-172 |
| Backend `count()` | O(1) | memory.js:179-181 |

### 内存估算

| 指标 | 估算值 |
|------|--------|
| 每个信号 | ~300 bytes（对象 + 3 索引引用） |
| 10,000 个信号 | ~3 MB |
| 100,000 个信号（紧急 GC 前上限） | ~30 MB |
| 作用域索引开销 | ~64 bytes / 唯一作用域 |
| 维度索引开销 | ~64 bytes / 维度（固定 12 个） |

### 与 V8 性能对比

| 指标 | V8 | V9 |
|------|-----|-----|
| 信号写入 | O(V+E) BFS 传播 | O(1) emit |
| 信号匹配 | O(R)/MeshNode/信号 | N/A（查询时叠加） |
| 存储查找 | NativeCore 索引 O(1) | 三索引 O(1) |
| 空转模块率 | ~87% (6/11 MeshNode 零消费者) | 0%（启动时验证） |

---

## 测试

### 测试文件

| 测试文件 | 覆盖目标 |
|---------|---------|
| `test/core/field/forward-decay.test.js` | 数学正确性、边界值 (0, 1, 负数)、lambda=0、时钟回拨、TTL 计算 |
| `test/core/field/field-vector.test.js` | superpose、applyFilter、applyCalibration、magnitude、dominant、diff、normalize |
| `test/core/field/gc-scheduler.test.js` | 过期清理、未过期保留、紧急 GC 触发阈值、stats 累计、start/stop |
| `test/core/field/backends/memory.test.js` | 三索引 put/scan/remove、索引策略选择、空 Map/Set 清理 |
| `test/core/field/signal-store.test.js` | 完整 emit/query/superpose 流程、非法维度拒绝、scope 隔离、紧急 GC |
| `test/intelligence/identity/sensitivity-filter.test.js` | 角色过滤、perceive()、comparePerceptions() |

### 关键测试场景

| 场景 | 验证内容 |
|------|---------|
| 12 维叠加完整性 | 所有 12 维正确求和并钳位 |
| Forward Decay lambda=0 | 信号永不衰减（返回原始强度） |
| 时钟偏移 (readTime < emitTime) | age 视为 0，无负衰减 |
| 100K+ 信号紧急 GC | 定期 GC 后仍超限则移除最旧 10% |
| 作用域隔离 | scope A 的信号对 superpose(scope B) 不可见 |
| 全零灵敏度过滤 | 感知向量全为零 |
| GC 期间并发 emit | 无数据损坏或信号丢失 |
| 12 维度各自 lambda 衰减曲线 | 每个维度按其默认 lambda 正确衰减 |
| superpose 空输入 | 返回 12 维全零向量 |
| 多信号叠加超过 1.0 | 正确钳位到 1.0 |

### 测试策略

- **单元测试**：每个源文件独立测试（forward-decay、field-vector、gc-scheduler、memory backend）
- **集成测试**：完整 emit -> query -> superpose 流程端到端验证
- **边界测试**：lambda=0、strength=0、空信号数组、超大时间戳
- **并发测试**：GC 与 emit 同时执行的数据一致性
- **通过 `forceJsFallback()` 确保可移植性**（如果使用原生后端）

---

[<- 返回 README](../../README.zh-CN.md) | [English](../en/signal-mesh.md)
