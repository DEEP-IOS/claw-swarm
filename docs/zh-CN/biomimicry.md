# 仿生学与设计哲学

Claw-Swarm V7.0 借鉴生物系统和认知科学解决 LLM 多代理协调问题。每个算法映射到具体的源码模块。本文档说明生物灵感及其代码级实现。

## 蚁群：信息素通信

真实蚂蚁留下随时间蒸发的化学踪迹，无需中央控制即可实现间接协调。Claw-Swarm 将此实现为数字信息素。

**来源：** `src/L2-communication/pheromone-engine.js`

七种信息素类型映射生物功能：

| 类型 | 衰减率 | TTL（分钟） | 生物类比 |
|------|--------|------------|----------|
| `trail` | 0.05 | 120 | 食物源路径标记 |
| `alarm` | 0.15 | 30 | 危险信号（快速衰减） |
| `recruit` | 0.10 | 60 | 任务招募信息素 |
| `queen` | 0.02 | 480 | 全群协调（缓慢衰减） |
| `dance` | 0.08 | 90 | 摇摆舞信息共享 |
| `food` | 0.04 | 180 | 食物源质量标记 |
| `danger` | 0.20 | 20 | 威胁警告（最快衰减） |

**算法：** MMAS（最大最小蚁群系统），浓度边界 [tau_min, tau_max]。路径选择使用 ACO 轮盘赌公式。**惰性衰减：** 信息素浓度在读取时计算，而非定时器驱动。

## 蚁群：响应阈值模型

**来源：** `src/L3-agent/response-threshold.js`

每个代理维护响应阈值。任务刺激超过阈值时代理激活。PI 控制器调整阈值以维持蜂群目标活动率。

## 蜂群：ABC 调度

**来源：** `src/L4-orchestration/abc-scheduler.js`

| 角色 | 比例 | 行为 |
|------|------|------|
| 雇佣蜂 | 50% | 利用已知任务方案 |
| 旁观蜂 | 45% | 轮盘赌质量选择 |
| 侦察蜂 | 5% | 放弃低质量方案，随机探索 |

## 免疫系统：负选择

**来源：** `src/L3-agent/negative-selection.js`

维护 5 个内置模式类别（error_keyword、resource_exhaust、null_reference、network_failure、rate_limit），置信度阈值 0.6。

## 免疫系统：失败疫苗

**来源：** `src/L3-agent/failure-vaccination.js`

记录失败模式并创建修复策略（疫苗）。疫苗存储在 SQLite `repair_memory` 表中。双过程路由器发现疫苗匹配时路由到快速路径。

## 进化算法：种群进化

**来源：** `src/L4-orchestration/species-evolver.js`

生命周期：提案 → 试用（30天，>70%成功率）→ 淘汰（底部20%）→ GEP 锦标赛 → Lotka-Volterra 动力学。活跃种群上限 10 个。

## 传染病传播：Gossip 协议

**来源：** `src/L2-communication/gossip-protocol.js`

扇出 3，心跳 5 秒。搭载记忆摘要和信息素快照。SWIM 协议用于存活监控。

## 认知科学：双过程路由

**来源：** `src/L4-orchestration/dual-process-router.js`

System 1（快速，阈值 0.55）：疫苗匹配 + 熔断器 CLOSED + 高亲和 → DIRECT 模式。
System 2（缓慢，阈值 0.50）：新任务类型 + HALF_OPEN + 高 alarm → PREPLAN 模式。

## 人类记忆：三层模型

### 工作记忆

**来源：** `src/L3-agent/memory/working-memory.js`

焦点（5项）/ 上下文（15项）/ 暂存板（30项）。激活公式含老化衰减，级联淘汰。

### 情景记忆

**来源：** `src/L3-agent/memory/episodic-memory.js`

Ebbinghaus 遗忘曲线：`retention(t) = e^(-t / (lambda * importance))`，lambda = 30 天。

### 语义记忆

**来源：** `src/L3-agent/memory/semantic-memory.js`

知识图谱，BFS 遍历，概念合并。

## 痕迹协作

**来源：** `src/L2-communication/stigmergic-board.js`

持久化全局公告板。代理修改共享状态而非直接通信，实现去中心化协调。

## 信号校准

**来源：** `src/L4-orchestration/signal-calibrator.js`

基于互信息自动调整顾问权重。权重边界：下限 0.03，上限 0.40。

---
[← 返回 README](../../README.md) | [English](../en/biomimicry.md)
