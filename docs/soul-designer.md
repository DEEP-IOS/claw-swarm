# Soul Designer / 灵魂设计器

## Overview / 概述

The Soul Designer is Claw-Swarm V5.1's agent personality system. It provides persona templates that influence agent behavior, communication style, and decision-making. The system learns from outcomes over time, evolving persona selection for better task-agent matching.

灵魂设计器是 Claw-Swarm V5.1 的智能体人格系统。提供影响行为、沟通风格和决策的人格模板。系统从结果中学习，随时间进化人格选择以提升任务匹配。

### Design Principle / 设计原则

**Different tasks need different personalities / 不同任务需要不同人格：**
- A security audit needs a cautious, thorough agent (guard-bee)
- Rapid prototyping needs an exploratory, risk-tolerant agent (scout-bee)
- Steady implementation needs a methodical, reliable agent (worker-bee)
- Strategic coordination needs a directive, big-picture agent (queen-messenger)
- Visualization and UI design needs an aesthetic-driven, visual-first agent (designer-bee)

The Soul Designer bridges this gap by recommending personas based on task keywords and historical performance data.

灵魂设计器通过基于任务关键词和历史表现数据推荐人格来弥合这一差距。

---

## Built-in Personas / 内置人格

### scout-bee — Explorer / 侦察蜂

| Property | Value |
|----------|-------|
| **Personality** | Curiosity: 0.9, Risk tolerance: 0.7, Thoroughness: 0.5 |
| **Best for** | Research, prototyping, exploration, investigation, discovery |
| **SOUL snippet** | Exploratory agent prioritizing breadth over depth |
| **When to use** | Unknown territory, feasibility studies, initial investigation |

**Biological analogy / 生物类比：** Scout bees leave the hive to find new food sources, evaluating quality and distance before reporting back via the waggle dance.

### worker-bee — Builder / 工蜂 (Default)

| Property | Value |
|----------|-------|
| **Personality** | Reliability: 0.9, Thoroughness: 0.8, Caution: 0.6 |
| **Best for** | Implementation, coding, testing, building, development |
| **SOUL snippet** | Methodical agent focused on quality and completeness |
| **When to use** | Well-defined tasks, implementation work, test writing |

**Biological analogy / 生物类比：** Worker bees are the colony's builders — constructing comb, processing nectar, and maintaining the hive with remarkable consistency.

### guard-bee — Defender / 守卫蜂

| Property | Value |
|----------|-------|
| **Personality** | Caution: 0.9, Thoroughness: 0.9, Risk tolerance: 0.2 |
| **Best for** | Security, review, audit, validation, verification |
| **SOUL snippet** | Cautious agent that thoroughly validates before proceeding |
| **When to use** | Security audits, code review, validation tasks |

**Biological analogy / 生物类比：** Guard bees protect the hive entrance, inspecting every incoming bee and rejecting intruders based on chemical signatures.

### queen-messenger — Coordinator / 信使蜂

| Property | Value |
|----------|-------|
| **Personality** | Leadership: 0.8, Communication: 0.9, Strategic thinking: 0.8 |
| **Best for** | Planning, coordination, strategy, architecture, design |
| **SOUL snippet** | Strategic agent focused on coordination and high-level planning |
| **When to use** | Project planning, architecture decisions, team coordination |

**Biological analogy / 生物类比：** The queen's pheromone signals coordinate colony-wide behavior, while messenger bees carry information between different parts of the hive.

### designer-bee — Creator / 设计蜂 (V5.1 New)

| Property | Value |
|----------|-------|
| **Personality** | Aesthetics: 0.9, Creativity: 0.8, Thoroughness: 0.7 |
| **Best for** | Visualization, dashboard, design, chart, UI, layout, color, style, aesthetic |
| **SOUL snippet** | Aesthetic-driven agent focused on visual quality and design excellence |
| **When to use** | Data visualization, UI/UX design, dashboard creation, aesthetic review |

**Biological analogy / 生物类比：** Designer bees are the architects of the hive — constructing the perfect hexagonal comb structure with precise geometry, optimal angles, and harmonious proportions. They bring this pursuit of formal beauty into the digital world.

设计蜂是蜂巢的建筑师。蜂巢的六边形结构是自然界最高效的空间利用形式——完美的几何学、精确的角度、和谐的比例。设计蜂将这种对形式美的追求带入数字世界。

---

## Persona Selection / 人格选择

### Keyword Matching / 关键词匹配

The Soul Designer uses keyword-based matching to recommend personas:

```
Task: "Investigate the authentication vulnerability in the API"
  → Keywords matched: "investigate" (scout), "vulnerability" (guard)
  → Highest match: guard-bee (security keyword takes priority)
  → Result: guard-bee persona recommended
```

Each persona has a `bestFor` keyword list. The task description is scanned for these keywords, and the persona with the most keyword matches wins. Ties are broken by keyword order priority.

### Default Behavior / 默认行为

When no keywords match, `worker-bee` is used as the default persona. This is the safest choice for general-purpose tasks. V5.1 adds `designer-bee` for visualization and design tasks.

无关键词匹配时默认使用 `worker-bee`，这是通用任务最安全的选择。V5.1 新增 `designer-bee` 用于可视化和设计任务。

---

## Custom Personas / 自定义人格

Users can add or override personas via configuration. Custom personas have the same structure as built-in ones.

用户可通过配置添加或覆盖人格。自定义人格与内置人格结构相同。

### Adding a New Persona / 添加新人格

```json
{
  "soul": {
    "enabled": true,
    "personas": {
      "devops-bee": {
        "name": "DevOps Bee",
        "personality": {
          "caution": 0.8,
          "thoroughness": 0.9,
          "reliability": 0.9
        },
        "soulSnippet": "You are a DevOps specialist focused on deployment safety, monitoring, and infrastructure reliability. Always verify rollback procedures before proceeding.",
        "bestFor": ["deployment", "monitoring", "infra", "ci-cd", "pipeline", "docker", "kubernetes"]
      }
    }
  }
}
```

### Overriding a Built-in Persona / 覆盖内置人格

To modify `worker-bee` with higher caution:

```json
{
  "soul": {
    "personas": {
      "worker-bee": {
        "personality": { "caution": 0.9 },
        "soulSnippet": "You are a methodical builder with extra emphasis on safety checks."
      }
    }
  }
}
```

The merge is shallow — user fields override defaults for the same key.

合并为浅覆盖 — 用户字段覆盖同名默认字段。

---

## Persona Evolution / 人格进化

### Outcome Tracking / 结果追踪

After each task, the outcome is recorded:

```javascript
personaEvolution.recordOutcome({
  personaId: 'scout-bee',
  taskType: 'research',
  success: true,
  duration: 45000,
  quality: 0.85
});
```

### Win-Rate Computation / 胜率计算

Over time, the system computes win-rates per persona × taskType:

```
scout-bee × research: 87% success rate (23/26 tasks)
worker-bee × research: 62% success rate (8/13 tasks)
→ Recommendation: Use scout-bee for research tasks
```

### Future: ML Interface / 未来：机器学习接口

The current implementation uses simple keyword matching + win-rate statistics. The architecture reserves space for future ML-based persona selection:

当前实现使用简单关键词匹配 + 胜率统计。架构预留了未来基于 ML 的人格选择接口：

```javascript
// Reserved interface (not yet implemented)
// 预留接口（尚未实现）
class MLPersonaSelector {
  async predict(taskDescription, agentCapabilities) {
    // Future: embedding-based similarity, reinforcement learning
    return { personaId, confidence };
  }
}
```

---

## Integration with SOUL.md / 与 SOUL.md 集成

In OpenClaw, each agent has a `SOUL.md` file defining its personality and behavior guidelines. The Soul Designer generates SOUL-compatible snippets that can be appended to or integrated with existing SOUL.md content.

在 OpenClaw 中，每个智能体有定义人格和行为准则的 `SOUL.md` 文件。灵魂设计器生成 SOUL 兼容的片段，可追加或整合到现有 SOUL.md 内容中。

### Usage via swarm_design Tool / 通过 swarm_design 工具使用

```
Agent uses swarm_design tool:
  Input: { taskDescription: "audit the payment module for security issues" }
  Output: {
    recommendedPersona: "guard-bee",
    confidence: 0.85,
    soulSnippet: "You are a cautious agent that thoroughly validates...",
    reasoning: "Keywords matched: 'audit', 'security'"
  }
```

The agent can then incorporate the SOUL snippet into its behavior for the current task.

智能体可将 SOUL 片段融入当前任务的行为中。

---

## API Reference / API 参考

### SoulDesigner

```javascript
import { SoulDesigner } from 'swarm/intelligence/soul/soul-designer.js';

const designer = new SoulDesigner(config);

// Select best persona for a task / 为任务选择最佳人格
const result = designer.selectPersona('investigate auth vulnerability');
// → { personaId: 'guard-bee', confidence: 0.8, template: {...} }

// Generate SOUL snippet / 生成 SOUL 片段
const soul = designer.generateSoul('implement user registration');
// → { snippet: '...', persona: 'worker-bee' }

// List all available personas / 列出所有可用人格
const personas = designer.listPersonas();
// → [{ id: 'scout-bee', ... }, { id: 'worker-bee', ... }, ...]

// Get recommendation with reasoning / 获取带推理的推荐
const rec = designer.getRecommendation('plan the microservice architecture');
// → { personaId: 'queen-messenger', reasoning: '...', confidence: 0.75 }
```

### PersonaEvolution

```javascript
import { PersonaEvolution } from 'swarm/intelligence/soul/persona-evolution.js';

const evolution = new PersonaEvolution(db);

// Record outcome / 记录结果
evolution.recordOutcome({ personaId, taskType, success, duration, quality });

// Get stats / 获取统计
const stats = evolution.getStats('scout-bee');

// Get best persona for task type / 获取任务类型的最佳人格
const best = evolution.getBestPersona('research');
```
