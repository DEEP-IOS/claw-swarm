# V9.0 代码定位地图 / Code Location Map

> 本文件供新 session 快速定位关键代码位置

---

## 1. src/index.js — Plugin 入口 (205行)

| 行号范围 | 功能 |
|----------|------|
| 16-18 | `VERSION = '9.0.0'`, `NAME = 'openclaw-swarm'`, `DASHBOARD_PORT = 19100` |
| 31-53 | `createAppAdapter(api)` — V8 plugin API → V9 app 接口适配 |
| 82-93 | `startup()` — 调用 `activateV9(app)`, 设置 `_v9Instance` |
| 111-113 | `gateway_start` hook → `startup()` |
| 139-165 | Gateway Dashboard 代理路由 (`/swarm/api/v9/*` → 19100) |

---

## 2. src/index-v9.js — V9 激活 (172行)

| 行号范围 | 功能 |
|----------|------|
| 主要导出 | `activate(app)`, `deactivate(app)` |
| activate | 创建 SwarmCoreV9 → core.start() → HookAdapter 注册 → 工具注册 |

---

## 3. src/swarm-core-v9.js — 核心编排器 (475行)

| 行号范围 | 功能 |
|----------|------|
| 55-83 | 构造函数: 创建 SignalField + DomainStore + EventBus |
| 90-193 | `initialize()`: 动态导入5个域工厂, try/catch 每个域 |
| 94-100 | `Promise.all([tryImport])` 并行导入5域 |
| 105-116 | communication 域创建 |
| 119-130 | intelligence 域创建 |
| 133-148 | orchestration 域创建 (注入 intelligence 的交叉引用) |
| 152-165 | quality 域创建 (注入 reputationCRDT) |
| 169-186 | observe 域创建 (注入所有其他域的引用) |
| 332-382 | `start()`: restore → field.start → verifyCoupling → domains.start → ready |
| 347-353 | `_verifyCoupling()`: 检查所有维度都有生产者和消费者 |

---

## 4. 域工厂入口

| 域 | 文件 | 导出函数 |
|---|---|---|
| communication | `src/communication/index.js` (~134行) | `createCommunicationSystem()` |
| intelligence | `src/intelligence/index.js` (~270行) | `createIntelligenceSystem()` |
| orchestration | `src/orchestration/index.js` | `createOrchestrationSystem()` |
| quality | `src/quality/index.js` | `createQualitySystem()` |
| observe | `src/observe/index.js` | `createObserveSystem()` |

---

## 5. 信号场核心

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/core/field/signal-store.js` | 382 | 12维信号场: emit/query/superpose/gc |
| `src/core/field/forward-decay.js` | 108 | 前向衰减编码: score = base × e^(λt) |
| `src/core/field/field-vector.js` | 178 | 场向量叠加计算 |
| `src/core/field/gc-scheduler.js` | 156 | GC 调度 (30s正常/5s异常/emergency at 100K) |
| `src/core/field/types.js` | 133 | 12维度常量定义 + 衰减率 |
| `src/core/field/backends/memory.js` | 215 | 内存存储后端 |

---

## 6. Bridge 工具

| 工具 | 文件 | 行数 |
|------|------|------|
| swarm_run | `src/bridge/tools/run-tool.js` | 248 |
| swarm_query | `src/bridge/tools/query-tool.js` | 320 |
| swarm_plan | `src/bridge/tools/plan-tool.js` | 320 |
| swarm_gate | `src/bridge/tools/gate-tool.js` | 261 |
| swarm_zone | `src/bridge/tools/zone-tool.js` | 255 |
| swarm_pheromone | `src/bridge/tools/pheromone-tool.js` | 242 |
| swarm_memory | `src/bridge/tools/memory-tool.js` | 238 |
| swarm_checkpoint | `src/bridge/tools/checkpoint-tool.js` | 232 |
| swarm_spawn | `src/bridge/tools/spawn-tool.js` | 186 |
| swarm_dispatch | `src/bridge/tools/dispatch-tool.js` | — |

---

## 7. Hook 体系

`src/bridge/hooks/hook-adapter.js` 第 69-84 行注册 16 个 hook:
session_start, session_end, message_created, before_agent_start, agent_start, agent_end, llm_output, before_tool_call, after_tool_call, prependSystemContext, before_shutdown, error, tool_result, agent_message, activate, deactivate

---

## 8. Dashboard API

`src/observe/dashboard/dashboard-service.js` (662行), 端口 19100

- 第 269-423 行: 57+ REST 路由注册
- 第 631-639 行: `start()` — 创建 HTTP server 监听 127.0.0.1:19100
- 第 646-661 行: `stop()` — 关闭 SSE 客户端 + HTTP server

---

## 9. 已知的坑

| 坑 | 位置 | 说明 |
|---|---|---|
| Gateway PID 孤立 | — | `openclaw gateway stop/start` 不杀 DashboardService, 需手动 kill port 19100 |
| DomainStore 必填参数 | swarm-core-v9.js:55-65 | 构造函数必须传 domain + snapshotDir, 否则报错 |
| bus.subscribe vs bus.on | observe/metrics + health | MetricsCollector 和 HealthChecker 使用兼容适配（subscribe || on） |
| Gateway label 上限 | — | label 最大 64 字符，taskId 用 slice(-12) |
