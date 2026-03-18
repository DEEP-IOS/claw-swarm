# Claw-Swarm Decision Log / 架构决策日志

---

## Phase V9 — 2026-03-17~18 — Field-Mediated Coupling Architecture

### Decision 1: 7 Layers → 7 Domains / 七层改七域

**Problem**: V8's 7-layer model (L0-L6) caused three issues: (1) 6+ modules were idle (feature-flagged but never activated), (2) strict linear coupling prevented natural lateral communication, (3) MeshNode receptor/effector abstraction duplicated EventBus semantics.

**决策**：V8 的 7 层模型导致三个问题：(1) 6+ 模块空转（有功能开关但从未激活），(2) 严格线性耦合阻止了自然的横向通信，(3) MeshNode 受体/效应器抽象与 EventBus 语义重复。

**Decision**: Replace layers with 7 autonomous domains (core, communication, intelligence, orchestration, quality, observe, bridge). Domains communicate through field/bus/store, not layer imports.

**Rationale**: Domain model allows organic growth — intelligence can evolve independently of orchestration. No upward/downward dependency constraint.

### Decision 2: Dual Foundation / 双基座

**Problem**: V8 used SQLite (64 tables, schema V13) + MeshNode BFS signal propagation. The `node:sqlite` built-in was unreliable across platforms.

**Decision**: Replace with dual foundation: (1) SignalField — 12-dimensional forward-decay continuous field (in-memory), (2) DomainStore — key-value state with JSON snapshot persistence.

**Rationale**: Eliminates SQLite platform dependency. Forward-decay encoding is O(1) for emission vs BFS O(n) per signal. JSON snapshots are human-readable and git-friendly.

### Decision 3: 12 Dimensions, Not 5×19 / 12 维连续场

**Problem**: V8's 5 types × 19 subtypes created sparse coverage — many subtypes had no producer or consumer, causing idle signal channels.

**Decision**: 12 continuous dimensions (task_load, error_rate, latency, throughput, cost, quality, coherence, trust, novelty, urgency, complexity, resource_pressure). Each dimension has at least one producer and one consumer.

**Rationale**: Every dimension carries traffic. `_verifyCoupling()` checks this at startup. Zero idle channels.

### Decision 4: Zero Feature Flags / 零功能开关

**Problem**: V8's `config.enabled` flags on 16+ features meant most users ran with default config and never activated half the system.

**Decision**: Remove all feature flags. If code exists, it runs. `install.js` generates 7-domain config with no `enabled` properties.

**Rationale**: Simplifies config. Forces every module to be production-ready. Eliminates "untested path" risk.

### Decision 5: ModuleBase over MeshNode

**Problem**: MeshNode's receptor/effector pattern was powerful but required manual wiring. Adding a new engine meant modifying ScopeGraph edges and registering callbacks.

**Decision**: Replace with ModuleBase declaring `static produces()`/`consumes()`/`publishes()`/`subscribes()`. Coupling is verified automatically.

**Rationale**: Declarative coupling enables static analysis. New modules self-describe their field interactions.

### Decision 6: Single-Process over Fork+IPC

**Problem**: V8's `child_process.fork()` with 30s IPC timeout caused orphan processes, port conflicts, and debugging difficulty.

**Decision**: V9 runs entirely in-process within OpenClaw Gateway. `index.js` creates an adapter from V8 plugin API to V9 app interface.

**Rationale**: Eliminates IPC timeout, orphan PID, port conflict issues. Debugging is straightforward (single process, single stack trace).

---

## Phase 0 — 2026-03-14 — Signal Field Foundation

### API 探测结果
- **ProbeGate**: 代码已就绪，24 hooks + 10 API 探测逻辑完成
- 探测脚本 `probe-gate.js` 在 `gateway_start` 时自动执行
- 不存在的 hook/API 自动降级（featureFlag=false），不阻塞启动

### NativeCore 后端
- **当前**: js-fallback（纯 JS 实现，功能完整）
- **Rust native**: 预编译 binary 接口已定义，通过 `@claw-swarm/signal-field-native` npm optionalDependencies 分发
- **自动选择**: `native-core.js` 的 try/catch 模式——有 Rust 用 Rust，没有用 JS fallback

### ContextEngine 独占插槽
- `openclaw-adapter.js` 中 `OpenClawContextEngine.registerWithPlatform(api)` 已实现
- 包含 A6 活性验证（注册后 30 秒检查 callCount）
- 降级方案：如果 `registerContextEngine` API 不可用 → 回退到 `before_prompt_build` hook 注入

### 数据迁移
- `data-migrator.js` 实现 3 阶段迁移（机械映射 → LLM 辅助 → 验证回滚）
- 9 个直接映射子方法覆盖核心表（agents, capabilities, pheromones, breaker_state 等）
- Persona 保护：decayRate=0.0, intensity=1.0（永久信号，灵魂不衰减）
- 信息素 1:1 映射：type/intensity/scope/decayRate 完全对应
- 回滚保护：迁移前快照 + 迁移后验证 + 失败自动恢复

### 信号场核心设计决策
- **ScopeGraph**: 网状拓扑（非树状），边有 spreadFactor 衰减，BFS 信号扩散 maxHops=5
- **MMAS 夹紧**: intensity 范围 [0.001, 1.0]
- **7 种信号原语**: Signal, ScopeGraph, Entity, SignalField, MeshNode, PlatformAdapter, NativeCore
- **5 种信号类型**: biochemical, stigmergic, episodic, nutritional, emotional
- **反应规则**: 两种信号在同一位置共存且强度 > 阈值时自动产生新信号（Turing 反应-扩散）

### 落地保障机制
- **ProbeGate**: API 先探后用（probe-gate.js）
- **IPC Schema**: 消息格式硬校验（ipc-schema.js 嵌入 ipc-bridge.js）
- **金丝雀信号**: message_received → canary 信号沉淀，证明转导链活着
- **转导静默检测**: hook 触发但 0 信号 → silenceCount++
- **双路径断言**: 旧路径保留为断言基准，新旧结果不一致 → 用旧值覆盖
- **信号因果追踪**: deposit → sense → markInfluenced 全链路追踪
- **Phase 门控**: checkPhaseEntry(1) 全部通过才能进 Phase 1

### 修改的现有文件
| 文件 | 变更 | 行数 |
|------|------|------|
| swarm-core.js | init() 末尾创建 SignalField + Transducer + LandingGuard + DataMigrator; subagent_ended 末尾信号转导 | +55 |
| plugin-adapter.js | async NativeCore 可用性标记 (.then() 模式避免 sync init 中 await 问题) | +12 |
| health-checker.js | WEIGHTS 增加 signalField 维度 (0.10); _calculateSignalFieldScore() | +40 |
| ipc-bridge.js | _handleRequest() 入口 ipc-schema 校验 | +7 |
| index.js | ProbeGate 探测 + 11 个新 hook 注册 (priority 15) | +30 |

### 关键决策与放弃的替代方案
1. **plugin-adapter.js 中 NativeCore 加载**: 最初用 `await import()` 但 init() 是同步函数导致测试失败。改为 `.then()` 模式——非阻塞，NativeCore 后续可用时自动标记
2. **信号存储双层路由**: StorageRouter 区分 V7 引擎类型（PheromoneEngine/StigmergicBoard/EpisodicMemory/WorkingMemory）和新类型。现有信号走 EngineStorageAdapter 兼容旧路径，新信号走 NativeStorageAdapter
3. **绞杀者策略**: Phase 0 纯新增代码（零删除），新旧并行运行。旧代码在 Phase 1-4 渐进替换时变为双路径断言

### 性能基线（JS fallback）
- **createSignal()**: 4,728,086 ops/sec (0.2μs/call) — 信号工厂极快
- **ScopeGraph.addNode()**: 576,384 ops/sec (1.7μs/call)
- **ScopeGraph.propagationField() 100节点 BFS**: 8,093 ops/sec (123.6μs/call)
- **deposit() 含 100 节点传播**: 6,686 ops/sec (149.6μs/call) — ~150μs/deposit
- **sense() 大范围过滤 (~100 信号)**: 177 ops/sec (5.6ms/call) — 有优化空间，Rust 可提升 47x
- **gradient() 5 邻居**: 3,781 ops/sec (264.5μs/call)
- **deposit+sense 端到端**: 8,156 ops/sec (122.6μs/call)
- **acoSelect() 10 候选**: 2,296,053 ops/sec (0.4μs/call) — ACO 选择极快
- **Rust native 预期提升**: deposit <200μs ✅ 已达标(JS), sense 将从 5.6ms → ~120μs (47x), gradient ~10μs (26x)
- 基准测试命令: `npx vitest bench tests/benchmark/signal-field.bench.js`

### 代码量统计
- **L0-field 源代码**: 17 文件, 4,535 行
- **测试代码**: 11 文件, 1,809 行
- **总新增**: 28 文件, 6,344 行 + 现有文件修改 ~144 行

### 测试结果
- **1548/1548 测试全部通过**（1463 原有 + 75 L0-field 单元 + 10 集成）
- **零回归**
- 113 → 114 测试文件

### Phase 0 真实 Gateway 验证（2026-03-14）

**Gateway 环境**:
- Gateway PID 162800 (port 18789), SwarmCore PID 70860 (port 19100)
- Platform: Clawdbot (原 OpenClaw 改名)
- 启动方式: `api.registerService()` (Clawdbot 不触发 `gateway_start` hook)

**验证结果清单**:
| 验证项 | 状态 | 详情 |
|--------|------|------|
| 1548 测试全通过 | ✅ | `npm test` — 114 test files, 0 failures |
| 49 API 端点全部 200 OK | ✅ | `/api/v1/*` 全部正常返回 |
| Console 前端 200 OK | ✅ | `/v6/console/` 正常加载，零 JS 错误 |
| Health: 100 | ✅ | Console 显示满分健康度 |
| signalField 维度已集成 | ✅ | health-checker WEIGHTS 含 signalField: 0.10 |
| NativeCore (js-fallback) | ✅ | backend='js-fallback', 6 个核心 API 全部可用 |
| ProbeGate 探测 | ✅ | 24/24 hooks, 10/10 APIs available |
| SignalField deposit/sense/gradient | ✅ | 三原语独立验证通过 |
| ScopeGraph 动态拓扑 | ✅ | addNode/addEdge/neighbors/propagationField 正常 |
| MeshNode 多受体 | ✅ | trail+alarm+recruit 同时感知，3 次激活 |
| SignalTransducer 24 hooks | ✅ | 全部映射就绪，message_received→2 信号(queen+canary) |
| 转导静默检测 | ✅ | silenceCount=0 |
| DataMigrator 完成 | ✅ | Migration completed (0 data — 新 DB) |
| 63 引擎初始化 | ✅ | engines=63 |
| 4 工具注册 | ✅ | swarm_run/query/dispatch/checkpoint |
| 反应规则框架 | ✅ | addReaction() 可用 |

**Clawdbot 平台适配关键发现**:
1. `gateway_start` hook 在 Clawdbot 中**从未被调用**（函数定义但未 invoke）
2. 必须同时实现 `api.registerService()` 作为 Clawdbot 启动路径
3. 需要 `clawdbot.plugin.json` 清单 + `package.json` 中 `"clawdbot"` section
4. 配置目录: `~/.clawdbot-mpu-d3/clawdbot.json`

**Phase 0 → Phase 1 交接合格**

---

## Phase 1 — 2026-03-14 — Communication Foundation

### Phase 1a: Gateway API 验证结果
| API | 状态 | 详情 |
|-----|------|------|
| `sessions_yield` | ❌ 不可用 | Clawdbot 只有 `chat.inject`，无 yield |
| `registerWorker` | ❌ 不可用 | Clawdbot 不支持 worker 注册 |
| `registerHttpRoute` | ✅ 可用 | 已用于 Dashboard 代理路由 |
| `registerGatewayMethod` | ✅ 可用 | 预留，未启用 |
| `modelAuth` | ❌ 不可用 | Gateway 自行管理 API key |
| WS push | ✅ 自动推送 | 无需显式订阅 |
| `idempotencyKey` | ✅ 内建 | Gateway 协议自带 |
| Protocol | v3 | 无 v4 可用 |

### Phase 1b: 实施内容

**新建文件 (3)**:
| 文件 | 说明 | 行数 |
|------|------|------|
| `L2-communication/ws-connection-pool.js` | WS 连接池（acquire/release/idle/health） | ~300 |
| `L3-agent/cultural-friction.js` | 文化摩擦度量（5D 行为画像 + EMA + 摩擦矩阵） | ~310 |
| `L4-orchestration/integration-strategy.js` | 整合策略选择器（LIGHT_TOUCH/MODERATE/DEEP） | ~280 |

**修改文件 (7)**:
| 文件 | 变更 |
|------|------|
| `swarm-relay-client.js` | 8 个 WS 方法改为 acquire/release 连接池模式；Clawdbot 配置路径支持 |
| `plugin-adapter.js` | CulturalFriction + IntegrationStrategy 引擎（.then() 非阻塞初始化） |
| `dashboard-service.js` | +3 新端点（cultural-friction/integration-strategy/ws-pool） |
| `swarm-core.js` | WS 连接池启用 + 文化摩擦 llm_output 观测接线 |
| `index.js` | registerHttpRoute 代理 Dashboard 路由到 Gateway 端口 |
| `state-broadcaster.js` | 订阅 cultural.*/integration.*/ws.* 事件 |
| `event-catalog.js` | +7 事件主题（129 总） |

**DB 迁移**: SCHEMA_VERSION 9→10，+2 新表（cultural_friction_log, integration_strategies），共 54 表

**测试**: +3 测试文件 63 个测试用例，总测试 1611/1611 全通过

### 真实 Gateway 验证（2026-03-14）
| 验证项 | 状态 |
|--------|------|
| 1611 测试全通过 | ✅ |
| 43 API 端点全部 200 OK | ✅ |
| Console 前端 200 OK（零 JS 错误） | ✅ |
| Health: 100 | ✅ |
| DatabaseManager Created 54 tables | ✅ |
| SignalField backend=js-fallback | ✅ |
| CulturalFriction + IntegrationStrategy initialized | ✅ |
| WS connection pool enabled (maxConnections=5) | ✅ |
| Dashboard routes registered on Gateway (/swarm/*) | ✅ |
| ProbeGate: 24/24 hooks, 10/10 APIs | ✅ |
| engines=63, tools=4 | ✅ |

### 关键决策与放弃的替代方案
1. **plugin-adapter.js 中 await import()**: init() 是同步函数导致编译报错。改为 `Promise.all([import()]).then()` 模式——与 NativeCore 相同策略
2. **sessions_yield 不可用**: 保留 `chat.inject` 作为唯一结果注入路径，不做 fallback 分支
3. **Dashboard 代理路由**: 使用 `registerHttpRoute` 在 Gateway 端口注册 `/swarm/*` 代理到 19100，fetch 转发模式
4. **WS 连接池整合**: 所有 8 个 WS 方法统一使用 acquire/release 模式，而非只改核心 spawn 方法

**Phase 1 → Phase 2 交接合格**

---

## Phase 2 — 2026-03-14 — Emotional Sensemaking Engine

### 实施内容

**新建文件 (4)**:
| 文件 | 说明 | 行数 |
|------|------|------|
| `L3-agent/emotional-state-tracker.js` | 6D 情感向量追踪（frustration/confidence/curiosity/resistance/openness/trust） | ~637 |
| `L3-agent/ei-layer.js` | 情商注入层（EmpathyFrame 生成 + 风险评估 + 合规修正 + 干预策略） | ~300 |
| `L3-agent/prejudice-detector.js` | 偏见检测审计（Gini 系数 + 卡方检验 + 5 种偏见类型） | ~456 |
| `L4-orchestration/sensemaking-protocols.js` | 6 种意义建构协议（TOLERATING/CHALLENGING/INFUSING/IMPOSING/WITHDRAWING/TWISTING） | ~423 |

**修改文件 (7)**:
| 文件 | 变更 |
|------|------|
| `plugin-adapter.js` | Promise.all 异步初始化 4 新引擎（.then() 非阻塞模式） |
| `swarm-core.js` | llm_output 情感追踪 + 偏见记录；before_agent_start EI Layer 注入；agent_end 成功/失败情感事件；after_tool_call 工具错误情感事件 |
| `event-catalog.js` | +9 事件主题（emotional.*/prejudice.*/sensemaking.*），总 138 |
| `database-schemas.js` | SCHEMA_VERSION 10→11，+3 新表（emotional_states/prejudice_audit/sensemaking_episodes），共 57 表 |
| `reputation-ledger.js` | 6D → 7D：新增 emotionalResilience 维度，权重重分配 |
| `dashboard-service.js` | +3 新端点（emotional-states/prejudice-audit/sensemaking） |
| `state-broadcaster.js` | 订阅 emotional.*/prejudice.*/sensemaking.* 事件 |

**测试**: +4 测试文件 102 个测试用例，总测试 1713/1713 全通过

### 真实 Gateway 验证（2026-03-14）
| 验证项 | 状态 |
|--------|------|
| 1713 测试全通过 | ✅ |
| API 端点全部 200 OK | ✅ |
| Console 前端 200 OK（零 JS 错误） | ✅ |
| Health: 100 | ✅ |
| DatabaseManager Created 57 tables | ✅ |
| EmotionalStateTracker initialized (alpha=0.3) | ✅ |
| EILayer initialized (enabled=true) | ✅ |
| PrejudiceDetector initialized | ✅ |
| SensemakingProtocols initialized | ✅ |
| SignalField backend=js-fallback | ✅ |
| CulturalFriction + IntegrationStrategy (Ph1) still working | ✅ |
| WS connection pool enabled | ✅ |
| ProbeGate: 24/24 hooks, 10/10 APIs | ✅ |
| engines=63, tools=4 | ✅ |

### 关键决策与放弃的替代方案
1. **plugin-adapter.js 异步初始化**: 与 Phase 1 相同的 `Promise.all([]).then()` 模式，init() 是同步函数不能 await
2. **情感追踪挂载点**: 选择在 llm_output（合规检测后）、agent_end（成功/失败）、after_tool_call（工具错误）三个 hook 上记录事件，而非创建独立的 hook handler
3. **EI Layer 注入位置**: 在 before_agent_start 的 soulSnippet 构建末尾、onPrependContext 之前注入 empathyFrame，确保情感上下文不被压缩覆盖
4. **声誉维度 6D→7D**: emotionalResilience 新维度，权重 0.10，从 competence（0.30→0.25）和 reliability（0.25→0.22）中分配
5. **偏见检测统计方法**: Gini 系数用于分配公平性，卡方检验用于 provider 分布偏离，双重统计互相印证

**Phase 2 → Phase 3 交接合格**

---

## Phase 3 — 2026-03-14 — API Modernization + Dynamic Prejudice Evolution

### 实施内容

**新建文件 (5)**:
| 文件 | 说明 | 行数 |
|------|------|------|
| `L3-agent/prejudice-trust-dyad.js` | Agent-pair 对偶信任矩阵（EMA 信任/偏见、毒性检测、热力图） | ~506 |
| `L3-agent/episode-learner.js` | 情节式学习引擎（模式提取：成功路径/失败恢复/协作协同/工具链效率） | ~362 |
| `L3-agent/provider-culture-profile.js` | 5D Provider 文化画像（verbosity/riskTolerance/compliance/creativity/concurrencyStyle） | ~408 |
| `L4-orchestration/cross-provider-facilitator.js` | 跨 Provider 桥接 + 4 阶段 onboarding（INTRODUCTION→SHADOWING→COLLABORATION→AUTONOMY） | ~499 |
| `L5-application/error-codes.js` | 标准化错误码注册表（17 个错误码，5 类别，中英双语） | ~216 |

**修改文件 (7)**:
| 文件 | 变更 |
|------|------|
| `plugin-adapter.js` | Phase 3 异步引擎初始化（PrejudiceTrustDyad/EpisodeLearner/ProviderCultureProfile/CrossProviderFacilitator/ErrorCodes） |
| `swarm-core.js` | llm_output: Provider 文化观测(recordBehavior); agent_end: 对偶信任更新+情节记录+onboarding推进; before_agent_start: 跨Provider桥接+情节学习注入 |
| `event-catalog.js` | +10 事件主题（dyad.*/episode.*/provider.*/cross_provider.*/newcomer.*），总 148 |
| `database-schemas.js` | SCHEMA_VERSION 11→12，+4 新表（prejudice_trust_dyads/episode_learnings/provider_culture_profiles/newcomer_onboarding），共 61 表 |
| `dashboard-service.js` | +4 新端点（dyad-matrix/episode-learnings/provider-profiles/newcomer-status） |
| `state-broadcaster.js` | 订阅 dyad.*/episode.*/provider.*/cross_provider.*/newcomer.* 事件 |

**测试**: +4 测试文件 114 个测试用例，总测试 1827/1827 全通过

### 方法签名修复（关键坑）
发现 5 处方法调用不匹配（swarm-core.js ↔ 新引擎实际 API），全部修复：
1. `ptd.getToxicPairs()` → `ptd.detectToxicPairs()` (dashboard-service.js)
2. `pcp.recordObservation()` → `pcp.recordBehavior()` (swarm-core.js)
3. `cpf.generateBridgeContext(agentId, {...})` → `cpf.generateBridgeContext(fromProvider, toProvider, taskContext)` (swarm-core.js)
4. `el.getRelevantLearnings()` 返回数组非字符串 → 格式化为 XML 字符串; `provider` → `providerId`, `limit` → `topK` (swarm-core.js)
5. `el.recordEpisode()` 缺少 `sessionKey` 字段; `success` → `outcome`, `provider` → `providerId`, `tools` → `steps` (swarm-core.js)
6. `cpf.recordTaskCompletion()` 不存在 → `cpf.advanceOnboarding(providerId)` (swarm-core.js)
7. `el.getLearnings({ patternType })` → `el.getLearnings({ pattern })` (dashboard-service.js)
8. `cpf.getOnboardingStatus(agentId)` → `cpf.getOnboardingProgress(providerId)` (dashboard-service.js)

**教训**: 新引擎文件创建后必须逐一对照实际方法签名验证调用点，AI 生成代码容易幻觉出不存在的方法名。

### 真实 Gateway 验证（2026-03-14）
| 验证项 | 状态 |
|--------|------|
| 1827 测试全通过 | ✅ |
| 23+ API 端点全部 200 OK | ✅ |
| Console 前端 200 OK（零 JS 错误） | ✅ |
| Health: 100 | ✅ |
| /api/v1/dyad-matrix — 返回 heatmap+toxicPairs+stats | ✅ |
| /api/v1/episode-learnings — 返回 learnings+stats | ✅ |
| /api/v1/provider-profiles — 返回 profiles+stats | ✅ |
| /api/v1/newcomer-status — 返回 stats+stageDistribution | ✅ |
| Phase 0-2 所有功能无回归 | ✅ |

### 关键决策与放弃的替代方案
1. **generateBridgeContext 触发条件**: 要求 fromProvider 和 toProvider 都不是 'unknown' 且不相同，避免同 Provider 内不必要的桥接注入
2. **getRelevantLearnings 格式化**: 使用 XML tag `<episode-learnings>` 包裹，保持与蜂群其他上下文注入格式一致
3. **onboarding 推进方式**: 每次 agent_end 时对该 Provider 调用 advanceOnboarding（基于 turn count），而非基于质量/成功率的复杂推进逻辑
4. **episode 记录粒度**: sessionKey 优先取 ctx.sessionKey，fallback 到 event.taskId 或 agentId，确保不会因缺少 sessionKey 而静默失败

**Phase 3 → Phase 4 交接合格**

---

## Phase 4 — 2026-03-14 — Reflective Intelligence + New Capabilities

### 实施内容

**新建文件 (5)**:
| 文件 | 说明 | 行数 |
|------|------|------|
| `L3-agent/context-engine-v8.js` | 信号场驱动的上下文组装（assembleContext/compactContext/subagentContext） | ~861 |
| `L3-agent/self-reflection.js` | Agent 自我反思引擎（输出特征记录、模式分析、漂移检测） | ~641 |
| `L3-agent/feedback-loops.js` | 双向反馈引擎（parent↔child 反馈记录、关系健康度、失衡检测） | ~505 |
| `L3-agent/role-reversal-detector.js` | 角色反转检测（performance 追踪、"学生"超越"老师"检测） | ~443 |
| `L5-application/tool-signals.js` | 工具信号适配器（执行注册、进度报告、取消支持） | ~513 |

**修改文件 (6)**:
| 文件 | 变更 |
|------|------|
| `plugin-adapter.js` | Phase 4 异步引擎初始化（ContextEngineV8/SelfReflection/FeedbackLoops/RoleReversalDetector/ToolSignals） |
| `swarm-core.js` | llm_output: 自我反思记录(recordOutput); before_agent_start: 反思注入+反馈上下文注入; agent_end: 反馈记录+角色反转记录 |
| `event-catalog.js` | +11 事件主题（context.*/self_reflection.*/feedback.*/role_reversal.*/tool.execution.*），总 159 |
| `database-schemas.js` | SCHEMA_VERSION 12→13，+3 新表（self_reflections/feedback_signals/role_reversals），共 64 表 |
| `dashboard-service.js` | +5 新端点（self-reflections/feedback-loops/role-reversals/tool-executions/context-engine） |
| `state-broadcaster.js` | 订阅 context.*/self_reflection.*/feedback.*/role_reversal.*/tool.execution.* 事件 |

**DB 迁移链**: SCHEMA_VERSION 9→10(Ph1)→11(Ph2)→12(Ph3)→13(Ph4)

**测试**: +5 测试文件 179 个测试用例，总测试 2006/2006 全通过

### DB Schema 字段名坑
Phase 4 新表定义使用了 `ddl:` 字段名，但现有所有表使用 `sql:` 字段名。导致 213 个测试失败（`TypeError: The "sql" argument must be a string`）。修复：3 处 `ddl:` → `sql:`。

### 真实 Gateway 验证（2026-03-14）
| 验证项 | 状态 |
|--------|------|
| 2006 测试全通过 | ✅ |
| 28+ API 端点全部 200 OK | ✅ |
| Console 前端 200 OK（零 JS 错误） | ✅ |
| Health: 100 | ✅ |
| DatabaseManager Created 64 tables | ✅ |
| /api/v1/self-reflections — 返回 reflections+stats | ✅ |
| /api/v1/feedback-loops — 返回 relationships+stats | ✅ |
| /api/v1/role-reversals — 返回 reversals+stats | ✅ |
| /api/v1/tool-executions — 返回 active+stats | ✅ |
| /api/v1/context-engine — 返回 stats | ✅ |
| Phase 0-3 所有功能无回归 | ✅ |

### Hook 注入顺序确认
- **before_agent_start**: soulSnippet → Ph2 EI Layer → Ph3 跨Provider桥接 → Ph3 情节学习 → Ph4 自我反思 → Ph4 反馈上下文 → onPrependContext
- **llm_output**: Ph2 情感追踪+偏见检测 → Ph3 Provider文化观测 → Ph4 自我反思记录
- **agent_end**: Ph2 情感事件 → Ph3 对偶信任+情节记录+onboarding推进 → Ph4 反馈记录+角色反转记录 → B1 清理

### 关键决策与放弃的替代方案
1. **SelfReflection.recordOutput()**: 在 llm_output 中记录而非 agent_end，因为 agent_end 时 output 内容已不可用
2. **FeedbackLoops.recordFeedback()**: 使用 isSuccess 判断 type（approval/correction），而非更复杂的多级反馈分类
3. **RoleReversalDetector.recordPerformance()**: parentAgentId 优先取 ctx，fallback 到 event，最后默认 'main'
4. **异步初始化模式**: 与 Phase 1-3 一致的 `Promise.all([import()]).then()` 模式，保持 init() 同步兼容

**Phase 4 → Phase 5 交接合格**

---

## Phase 5 — 2026-03-15 — Signal Field Convergence + Reliability Hardening

### 实施内容

**修改文件 (4)**:
| 文件 | 变更 |
|------|------|
| `swarm-core.js` | 内存泄漏加固：_subagentLabelMap TTL 清理（30min stale 驱逐）、_soulCache 200 上限、_dagCompletionResults 1h TTL 清理、_subagentLabelMap 条目增加 _createdAt 时间戳 |
| `health-checker.js` | _lastActivity + _connectionStatus 清理（200 上限 + 30min offline 驱逐），防止 Map 无限增长 |
| `phase-checklist.js` | Phase 2-5 占位检查替换为真实前置条件检查（引擎存在性 + SCHEMA_VERSION 最低版本） |
| `database-schemas.js` | 全部 12 张 Phase 1-4 新表追加 CREATE INDEX 语句（共 36 个索引）到 sql 字段 |

**新建文件 (1)**:
| 文件 | 说明 | 行数 |
|------|------|------|
| `tests/integration/v8-full-integration.test.js` | V8.0 全阶段集成测试（Phase 0-5 组件验证 + 跨阶段一致性） | ~250 |

### 内存泄漏加固详情
| Map/缓存 | 风险 | 加固措施 |
|---------|------|---------|
| `_subagentLabelMap` | 孤立子代理条目永不清理 | >50 条时扫描 _createdAt >30min 的 stale 条目删除 |
| `_soulCache` | Agent 数无限增长 | 硬上限 200，溢出时删除最早条目 |
| `_dagCompletionResults` | 完成 DAG 结果永不过期 | >50 条时扫描 _completedAt >1h 的 stale 条目删除 |
| `_lastActivity` (HealthChecker) | 已下线 agent 追踪数据永不清理 | >200 条时扫描 >30min + 非 online 的条目删除 |
| `_connectionStatus` (HealthChecker) | 同上 | 随 _lastActivity 一起清理 |
| `_causalLog` (SignalField) | 已有 LRU 驱逐（10K 上限） | Phase 0 已实现，无需额外处理 |
| `_agentHistory` (SwarmCore) | 已有 100 上限 | V6.0 已实现，无需额外处理 |
| `_recentEvents` (SwarmCore) | 已有 20 上限 | V6.3 已实现，无需额外处理 |

### 新表索引优化
为 12 张 Phase 1-4 新表添加了 36 个 CREATE INDEX 语句：
- Phase 1（2 表）：cultural_friction_log、integration_strategies
- Phase 2（3 表）：emotional_states、prejudice_audit、sensemaking_episodes
- Phase 3（4 表）：prejudice_trust_dyads、episode_learnings、provider_culture_profiles、newcomer_onboarding
- Phase 4（3 表）：self_reflections、feedback_signals、role_reversals

### PhaseChecklist 真实检查
| Phase | 前置检查 |
|-------|---------|
| Phase 1→2 | wsConnectionPool 存在 + culturalFriction 存在 + SCHEMA_VERSION ≥ 10 |
| Phase 2→3 | emotionalStateTracker + prejudiceDetector + sensemakingProtocols + SCHEMA_VERSION ≥ 11 |
| Phase 3→4 | prejudiceTrustDyad + episodeLearner + providerCultureProfile + SCHEMA_VERSION ≥ 12 |
| Phase 4→5 | selfReflection + feedbackLoops + roleReversalDetector + contextEngineV8 + SCHEMA_VERSION ≥ 13 |

### 真实 Gateway 验证（2026-03-15）
| 验证项 | 状态 |
|--------|------|
| 2041 测试全通过（131 test files） | ✅ |
| V8 集成测试 35/35 通过 | ✅ |
| Console 前端 200 OK | ✅ |
| Health: 100 | ✅ |
| 零 JS 错误 | ✅ |
| Gateway PID 180648 (port 18789) | ✅ |
| SwarmCore PID 180248 (port 19100) | ✅ |
| Phase 0-4 所有功能无回归 | ✅ |

### V8.0 最终统计
| 指标 | V7.1 基线 | V8.0 最终 | 增量 |
|------|----------|----------|------|
| 测试数 | 1,463 | 2,041 | +578 (+39.5%) |
| 测试文件 | 114 | 131 | +17 |
| DB 表数 | 52 | 64 | +12 |
| SCHEMA_VERSION | 9 | 13 | +4 |
| EventTopics | 122 | 159 | +37 |
| 新引擎文件 | 0 | 22 | +22 |
| API 端点 | 38 | 53+ | +15+ |
| L0-field 基座 | 0 文件 | 17 文件 / 4,535 行 | 信号场全新架构 |

### 关键决策
1. **内存清理策略**: 选择惰性清理（触发条件为 Map.size > 阈值），而非定时器扫描。原因：减少 setInterval 数量，避免子进程中过多定时器导致进程无法优雅退出
2. **索引策略**: 在 sql 字段中内联 CREATE INDEX，与 createAllTables() 中的 indexes 数组形成双路径创建，确保索引无论哪种路径都能创建
3. **PhaseChecklist**: 检查引擎存在性而非功能正确性——因为功能正确性由单元测试保证，checklist 只需确认部署完整性

**V8.0 全部 5 个 Phase 实施完成。**
