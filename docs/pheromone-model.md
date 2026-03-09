# Pheromone Model / 信息素模型

## Concept / 概念

Pheromones are **time-decaying environmental signals** inspired by ant colony communication. In nature, ants deposit chemical trails that evaporate over time, creating a distributed, stigmergic coordination mechanism. Claw-Swarm applies this concept to multi-agent AI systems.

信息素是受蚁群通信启发的**随时间衰减的环境信号**。自然界中蚂蚁留下随时间蒸发的化学痕迹，创造分布式协调机制。Claw-Swarm 将此概念应用于多智能体 AI 系统。

### Why Pheromones, Not Just Memory? / 为什么用信息素而非记忆？

| Characteristic | Memory | Pheromone | 区别 |
|---------------|--------|-----------|------|
| **Persistence** | Permanent | Decays over time | 持久 vs 衰减 |
| **Communication** | Point-to-point | Broadcast | 点对点 vs 广播 |
| **Accumulation** | Overwrite | Stack (intensity adds) | 覆盖 vs 叠加 |
| **Agent awareness** | Active query needed | Passive injection | 主动查询 vs 被动注入 |

**Key insight / 关键洞察：** Pheromones create **temporal context** — a signal that says "X happened recently and is still relevant." Memory alone cannot express urgency or freshness.

---

## Pheromone Types / 信息素类型

### trail — Work Breadcrumb / 工作痕迹

**Purpose / 用途：** "I worked on X" — leaves a trace of agent activity.

**Biological analogy / 生物学类比：** Trail pheromone that ants leave when returning from a food source. Other ants follow the trail.

**In Claw-Swarm / 蜂群中：** When an agent completes work on a scope (file, feature, module), it emits a `trail` pheromone. Other agents see this and can coordinate their work to avoid duplication or build upon it.

| Property | Value |
|----------|-------|
| Decay rate | 0.05/min |
| Max TTL | 120 min |
| Initial intensity | 1.0 |
| Typical use | `agent_end` hook automatically emits trail |

### alarm — Problem Warning / 问题警报

**Purpose / 用途：** "Problem at X" — warns others about issues.

**Biological analogy / 生物学类比：** Alarm pheromone that triggers defensive behavior in the colony.

**In Claw-Swarm / 蜂群中：** Emitted when repeated failures occur. Fast decay (30 min) because problems are either fixed quickly or escalated. Used by the struggle detector to distinguish individual vs systemic failures.

| Property | Value |
|----------|-------|
| Decay rate | 0.15/min |
| Max TTL | 30 min |
| Initial intensity | 1.0 |
| Typical use | Struggle detector emits on repeated failures |

### recruit — Help Request / 求助信号

**Purpose / 用途：** "Help needed at X" — requests assistance.

**Biological analogy / 生物学类比：** Recruitment pheromone that attracts nestmates to a task.

**In Claw-Swarm / 蜂群中：** Emitted when the struggle detector determines an agent needs help (and the problem is individual, not systemic). Medium decay — stays active long enough for another agent to respond.

| Property | Value |
|----------|-------|
| Decay rate | 0.10/min |
| Max TTL | 60 min |
| Initial intensity | 1.0 |
| Typical use | Struggle detector emits when agent is struggling |

### queen — Priority Directive / 优先指令

**Purpose / 用途：** High-priority directive from orchestrator or user.

**Biological analogy / 生物学类比：** Queen mandibular pheromone that influences colony behavior and worker activity.

**In Claw-Swarm / 蜂群中：** Slowest decay rate — persists for hours. Used for strategic directives that should influence all agents in a scope over an extended period.

| Property | Value |
|----------|-------|
| Decay rate | 0.02/min |
| Max TTL | 480 min (8 hours) |
| Initial intensity | 1.0 |
| Typical use | Orchestrator emits for priority tasks |

### dance — Knowledge Discovery / 资源发现

**Purpose / 用途：** "Found resource at X" — shares discoveries.

**Biological analogy / 生物学类比：** Waggle dance in honeybees that communicates the location of food sources.

**In Claw-Swarm / 蜂群中：** Emitted when an agent discovers useful information (API endpoint, documentation, solution pattern). Medium decay — stays relevant for about 90 minutes.

| Property | Value |
|----------|-------|
| Decay rate | 0.08/min |
| Max TTL | 90 min |
| Initial intensity | 1.0 |
| Typical use | Agent uses collaborate tool with dance type |

---

## Decay Model / 衰减模型

### Formula / 公式

```
intensity(t) = initial_intensity × e^(-decayRate × elapsed_minutes)
```

Where:
- `initial_intensity`: Starting intensity (default 1.0, max 1.0)
- `decayRate`: Type-specific rate (see table above)
- `elapsed_minutes`: Time since emission

### Cleanup Threshold / 清理阈值

When `intensity < MIN_INTENSITY (0.01)`, the pheromone is considered expired and removed during the next decay pass.

当 `intensity < MIN_INTENSITY (0.01)` 时，信息素被视为过期，在下次衰减扫描时移除。

### Decay Pass / 衰减扫描

The background `pheromone-decay-service` runs a decay pass at a configurable interval (default: 60 seconds):

后台 `pheromone-decay-service` 以可配置间隔（默认 60 秒）运行衰减扫描：

1. **Delete expired:** `DELETE FROM pheromones WHERE expires_at < NOW()`
2. **Recalculate:** For remaining pheromones, intensity is recalculated on read (not stored — avoids frequent UPDATEs)

**Performance note / 性能注意：** The `expires_at` column is indexed (`idx_pher_expires`). Deletion targets only expired rows — no full table scan. This handles 100k+ rows efficiently.

---

## Intensity Stacking / 强度叠加

When multiple agents emit the same pheromone type to the same scope, intensities don't overwrite — they coexist as separate records. When building a snapshot for agent injection, the `buildSnapshot()` method aggregates by scope and type, presenting the highest-intensity signal.

当多个智能体向同一 scope 发射相同类型信息素时，强度不覆盖 — 作为独立记录共存。构建注入快照时，`buildSnapshot()` 按 scope 和 type 聚合，展示最高强度信号。

**Example / 示例：** If 3 agents each emit `trail` to `/src/auth/`:
- DB stores 3 records with individual intensities
- Snapshot shows `trail @ /src/auth/ (intensity: 0.95)` (highest)
- This signals "multiple agents actively working on auth" — a strong coordination signal

---

## Integration Points / 集成点

### Emission / 发射

1. **Automatic:** `agent_end` hook emits `trail` pheromone for the agent's working scope
2. **Struggle detector:** Emits `recruit` when individual struggle detected
3. **Manual:** Agent uses `pheromone` tool to emit any type
4. **Collaborate tool:** High-urgency messages emit `alarm`; knowledge sharing emits `dance`

### Reading / 读取

1. **Automatic:** `before_agent_start` hook injects pheromone snapshot into context
2. **Manual:** Agent uses `pheromone` tool with `read` action
3. **Struggle detector:** Checks ALARM density to reduce false positives

### Pheromone-Aware Struggle Detection / 信息素感知的困难检测

```
Agent A fails 3 times in window of 5 calls
  → StruggleDetector checks: how many ALARM pheromones nearby?
  → If >= 2 ALARMs: systemic problem (API down, etc.) — DON'T emit RECRUIT
  → If < 2 ALARMs: individual struggle — EMIT RECRUIT pheromone
```

This reduces false positives from ~40% to ~10% in scenarios where external services fail.

此机制将外部服务故障场景下的误报率从约 40% 降至约 10%。

---

## Configuration / 配置

```json
{
  "pheromone": {
    "enabled": true,
    "decayIntervalMs": 60000,
    "maxPheromones": 1000,
    "types": {
      "trail": { "decayRate": 0.05, "maxTTLMinutes": 120 },
      "alarm": { "decayRate": 0.15, "maxTTLMinutes": 30 }
    }
  }
}
```

Set `pheromone.enabled = false` to completely disable the pheromone subsystem. No DB tables are accessed, no background service runs, no snapshot injection occurs.

设置 `pheromone.enabled = false` 完全禁用信息素子系统。不访问 DB 表、不运行后台服务、不注入快照。

---

## V5.2 Enhancements / V5.2 增强

### Pressure Gradient Auto-Escalation / 压力梯度自动升级

V5.2 introduces `PheromoneResponseMatrix` — a scanning module that monitors pheromone pressure and auto-escalates when a threshold is exceeded.

V5.2 引入信息素响应矩阵 — 扫描模块，监控信息素压力并在超阈值时自动升级。

**Pressure formula / 压力公式:**

```
pressure = base_intensity * (1 + k * log(1 + age_minutes))
```

Where:
- `base_intensity`: Current pheromone intensity after decay
- `k`: Escalation rate constant (configurable, default 0.5)
- `age_minutes`: Time since emission in minutes

When pressure exceeds the escalation threshold, the matrix emits a `PHEROMONE_ESCALATED` event and may trigger replanning or reinforcement.

当压力超过升级阈值时，矩阵发射 `PHEROMONE_ESCALATED` 事件，可能触发重规划或强化。

Feature flag: `pheromoneEscalation` (enabled by default)

### Multi-Type Pheromone Decay / 多类型信息素衰减

V5.2 extends the PheromoneEngine with `computeTypedDecay()` — different pheromone types now have distinct decay behaviors:

V5.2 扩展信息素引擎，不同类型有不同的衰减行为：

| Type | Decay Model | Formula / 公式 | Rationale / 原理 |
|------|-------------|----------------|-------------------|
| `trail` | Linear | `I(t) = I0 * max(0, 1 - rate * t)` | Work traces fade steadily / 工作痕迹均匀衰减 |
| `alarm` | Step (threshold) | `I(t) = t < halflife ? I0 : 0` | Warnings either active or gone / 警报非有即无 |
| `recruit` | Exponential | `I(t) = I0 * e^(-rate * t)` | Help requests fade gradually / 求助信号逐渐消退 |
| `food` | Exponential | `I(t) = I0 * e^(-rate * t)` | Resource signals standard decay / 资源信号标准衰减 |
| `danger` | Step (threshold) | `I(t) = t < halflife ? I0 : 0` | Danger alerts binary / 危险警报二元化 |

Feature flag: `multiTypePheromone` (enabled by default)

### StigmergicBoard / 公告板

V5.2 adds a persistent bulletin board that complements short-lived pheromones:

V5.2 新增持久公告板，补充短寿信息素：

```
Pheromone: short-lived (minutes), auto-decay, intensity-based
StigmergicBoard: long-lived (TTL-based), persistent, text-based

信息素：短寿命（分钟级），自动衰减，强度驱动
公告板：长寿命（TTL 控制），持久化，文本驱动
```

**API / 接口:**
- `post({ authorId, scope, title, content, category, priority, ttlMinutes })` → post ID
- `read(scope, { category?, limit? })` → post array
- `expireOld()` → cleanup count

Posts are stored in the `stigmergic_posts` table and auto-expired by TTL.

公告存储在 `stigmergic_posts` 表中，按 TTL 自动过期。
