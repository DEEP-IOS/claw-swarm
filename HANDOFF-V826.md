> **ARCHIVED**: This is a V8.2.6 handoff document. For current V9.0 status, see [HANDOFF-PROMPT.md](HANDOFF-PROMPT.md) and [HANDOFF-CODE-MAP.md](HANDOFF-CODE-MAP.md).

# Claw-Swarm V8.2.6 交接报告 / Handoff Report (ARCHIVED)

> 撰写时间: 2026-03-16 20:05 UTC
> 目的: 从小号 session 无损交接到大号 20x session

---

## 一、当前系统状态总览

### 版本与发布
| 项目 | 值 |
|------|-----|
| package.json version | 8.2.6 |
| openclaw.plugin.json version | 8.2.6 |
| src/index.js VERSION | 8.2.6 |
| src/swarm-core.js VERSION | 8.2.6 |
| src/plugin-adapter.js VERSION | 8.2.6 |
| npm published | openclaw-swarm@8.2.6 ✅ |
| GitHub main branch | 7b9b37a (force pushed) ✅ |
| GitHub tag v8.2.0 | 指向 7b9b37a ✅ |
| GitHub Release v8.2.0 | 存在 ✅ |
| 测试 | 2105/2105 通过, 134 文件, 0 失败 ✅ |
| plugin status | loaded ✅ |

### 关键路径
| 用途 | 路径 |
|------|------|
| 源码根目录 | `E:\OpenClaw\data\swarm\` |
| 源码 src | `E:\OpenClaw\data\swarm\src\` |
| Gateway 配置 (实际使用) | `E:\OpenClaw\.openclaw\openclaw.json` |
| 用户 home 配置 (备份) | `C:\Users\ASUS\.openclaw\openclaw.json` |
| 数据库 | `~/.openclaw/claw-swarm/claw-swarm.db` |
| npm token | `C:\Users\ASUS\.npmrc` → `[REDACTED]` |
| Console 前端 | `http://127.0.0.1:19100/v6/console` |
| Gateway 控制面板 | `http://127.0.0.1:18789` |

### Git 状态
- 工作树干净 (clean), 所有修改已 amend 进唯一 commit `7b9b37a`
- commit message: `fix: installer overhaul — npm name, agent detection, plugin id alignment`
- 该 commit 包含从 V8.2.0 release 到 V8.2.6 的所有修复

---

## 二、V8.2.0 → V8.2.6 完整修改清单

### V8.2.1 — npm 名称 + 安装流程修复
- `package.json`: name `claw-swarm` → `openclaw-swarm`, version → 8.2.x
- `openclaw.plugin.json`: id `claw-swarm` → `openclaw-swarm`
- `src/index.js` line 47: `const NAME = 'claw-swarm'` → `'openclaw-swarm'`
- `.npmignore`: 增加排除项 (tests/, tools/, .github/ 等)
- `package.json` files: 增加 `src/L0-field/`

### V8.2.2 — Gateway 配置迁移
- 两个 `openclaw.json` 中的 `plugins.entries['claw-swarm']` → `plugins.entries['openclaw-swarm']`

### V8.2.3 — 质量门控 + 信息素衰减修复
**质量门控误判**:
- `swarm-core.js` isSuccess: 新增 "实质结果优先" 逻辑 — 只要 >50字符输出且非 spawn_failed/timeout, 视为成功
- 背景: relay client 把所有 session 非正常结束都报 outcome='error', 即使 LLM 输出了完整结果
- score: 不再硬编码 0.8/0.3, 改为基于结果长度的梯度 (0.70/0.78/0.85)
- 信息素三分: success→trail+dance, hard failure→alarm(cap 0.8), ambiguous→weak trail(0.3)

**信息素衰减过快**:
- `pheromone-engine.js` BUILTIN_DEFAULTS 全面调低衰减率 (trail 0.05→0.008 等)
- Step decay 加速公式: `0.5^(ageMinutes/5)` (原 `0.7^(ageMinutes/10)`)
- maxTTL 强制执行: decayPass() 和 read() 都加入 maxTTL 检查
- MMAS 钳位: read() 增加 τ_min 下限 (原来只有 decayPass 做)

### V8.2.4 — ABC 调度器全雇佣蜂 bug
- `swarm-core.js`: 替换 population-counting 为持久化 round-robin 计数器
- 20-agent 周期: slot 0 = scout(5%), slot 1-10 = employed(50%), slot 11-19 = onlooker(45%)

### V8.2.5 — 质量门控二次修复 + DANCE 信号
- isSuccess 第二版: 移除 `!FAILURE_OUTCOMES.has(outcome)` 条件 → `hasSubstantiveResult && !spawnFailed && outcome !== 'timeout'`
- DANCE 信号 ~0.01: read() 加入 MMAS 钳位 + maxTTL 强制

### V8.2.6 — Agent 生命周期 + 无限重试修复 (本 session 主要工作)

#### 问题 1: 900+ agents 从不清理
**根因**: agent-repo.js 没有 delete/prune 方法, onAgentEnd 不更新 DB status

**修复**:
- `agent-repo.js`: 新增 `ensureAgent()`, `upsertAgent()`, `deleteAgent()`, `pruneStaleAgents()` (批量 SQL)
- `plugin-adapter.js` onAgentEnd: 新增 `updateAgent(id, { status: 'ended' })`
- `plugin-adapter.js`: 30 分钟定期清理 interval (`_pruneInterval`)
- `swarm-core.js` init: 启动时先 UPDATE active→inactive (>2h), 再批量 prune

#### 问题 2: Inspector 面板数值全 50%/0 (默认值, 从不变化)
**根因**: onAgentStart 调 `upsertAgent()` 但该方法不存在 → agent 从未写入 DB → reputation/capability/contribution 写入因 FK 约束静默失败

**修复**:
- `agent-repo.js`: 实现 `upsertAgent()` (alias for `ensureAgent()`)
- `swarm-core.js` auto-hooks: 在 5 个 auto-hook 前先调 `ensureAgent(agentId)` 确保 DB 存在
- `swarm-core.js` 能力评分: 同样加 `ensureAgent()`
- `swarm-core.js` init: 创建 "main" agent 记录 (role=coordinator, tier=senior)
- `ensureAgent` 支持 tier 参数

#### 问题 3: LLM 无限重试 not_ready 死循环
**根因**: Layer 4 not_ready 响应包含 `"hint": "Please retry"`, LLM 无限重试烧 token

**修复** (`src/index.js`):
- 加入 `_notReadyRetryCount` 计数器, 上限 `MAX_NOT_READY_RETRIES = 3`
- ≤3次: 警告 "attempt N/3, DO NOT retry immediately"
- >3次: 返回 `permanently_unavailable`, 明确禁止 LLM 调用, 指示告诉用户重启 Gateway
- 成功调用后计数器归零

---

## 三、修改文件索引 (V8.2.6 相对 V8.2.0 release commit)

### 核心源码
| 文件 | 修改摘要 |
|------|---------|
| `src/index.js` (~39KB) | NAME→openclaw-swarm, VERSION→8.2.6, not_ready 重试计数器 |
| `src/swarm-core.js` (~172KB) | VERSION→8.2.6, isSuccess实质结果优先, score梯度, 信息素三分, ABC round-robin, ensureAgent, main agent创建, 启动清理 |
| `src/L5-application/plugin-adapter.js` (~61KB) | VERSION→8.2.6, onAgentEnd标记ended, 30min pruneInterval, _pruneInterval cleanup |
| `src/L2-communication/pheromone-engine.js` (~35KB) | BUILTIN_DEFAULTS衰减率调低, step decay加速, read() MMAS钳位+maxTTL |
| `src/L1-infrastructure/database/repositories/agent-repo.js` (~14KB) | ensureAgent(+tier), upsertAgent, deleteAgent, pruneStaleAgents(批量SQL) |

### 配置/清单
| 文件 | 修改 |
|------|------|
| `package.json` | name→openclaw-swarm, version→8.2.6 |
| `openclaw.plugin.json` | id→openclaw-swarm, version→8.2.6 |

### 测试
| 文件 | 修改 |
|------|------|
| `tests/unit/version-consistency.test.js` | 8.2.6 断言 |
| `tests/unit/version-consistency-v62.test.js` | 8.2.6 断言 |
| `tests/integration/architecture-v6.test.js` | openclaw-swarm |
| `tests/integration/v8-full-integration.test.js` | openclaw-swarm |
| `tests/unit/L2/pheromone-engine.test.js` | 新衰减率 |
| `tests/unit/L2/pheromone-engine-v57.test.js` | 新 step decay 值 |

---

## 四、已知问题与未完成工作

### 4.1 已知 Bug (需验证/修复)

#### 🔴 P0: 用户报告的 "无限卡死" 问题
- **状态**: 代码层面已修复 (not_ready 重试上限), 但**未经真实交互验证**
- **修复位置**: `src/index.js` 工具注册区域
- **验证方法**: 重启 Gateway, 触发 swarm_run, 观察 SwarmCore 未就绪时是否在 3 次后停止
- **风险**: SwarmCore 可能因为新增的启动清理 (`pruneStaleAgents`) 延迟就绪, 但 try/catch 包裹了

#### 🔴 P0: 启动清理可能过于激进
- `swarm-core.js` init 阶段:
  1. 先 UPDATE 所有 >2h 未活跃的 active agent → inactive
  2. 再 DELETE 所有 ended/offline/inactive 且 >2h 的 agent
- **风险**: 如果有正在运行的长任务 agent, 2h 阈值可能误杀
- **建议**: 观察启动日志 `[SwarmCore] 启动清理: 已清除 N 个过时代理`, 确认数量合理

#### 🟡 P1: Inspector 面板数值变化验证
- **状态**: 代码层面修复 (ensureAgent + auto-hooks), 但**未经真实交互验证**
- **验证方法**:
  1. 重启 Gateway (`openclaw gateway stop && openclaw gateway start`)
  2. 发一条消息触发 swarm_run, 让子代理完成任务
  3. 打开 Console `http://127.0.0.1:19100/v6/console`
  4. Inspector 面板查看 agent 数据: reputation 应该不再全是 50, success_count 应该递增
- **如果仍然全是 50**: 检查 `agents` 表是否有记录 (`SELECT * FROM agents LIMIT 10`)

#### 🟡 P1: Agent 清理效果验证
- **验证方法**:
  1. 重启 Gateway
  2. 查看启动日志中 prune 数量
  3. 运行一段时间后检查 `SELECT COUNT(*) FROM agents` 是否合理 (<100)
  4. 等 30+ 分钟后再次检查, 确认定期清理生效

#### 🟢 P2: pheromone 衰减平衡性
- 前两次验证报告发现衰减太快/ALARM 比例太高
- V8.2.3-V8.2.5 调整后未经第三轮验证
- 建议运行 24h 后检查信息素分布

### 4.2 用户上次报告但 session 中断未详查的问题

#### 🟡 "有些功能没激活"
- 用户第二次验证报告提到某些功能未激活, 但未详细说明是哪些
- 可能指 feature flags 中 disabled 的功能 (contextEngine, skillGovernor, evolution.clustering/gep/abc 等)
- 这些是刻意 disabled 的 (渐进启用策略), 不是 bug

### 4.3 技术债务

| 项目 | 说明 |
|------|------|
| 版本号策略 | npm 从 8.2.0 跳到 8.2.6 (中间 8.2.1-8.2.5 都已发布但被覆盖), git 只有 1 个 amend commit |
| DB migration | 新增的 ensureAgent/pruneStaleAgents 不需要 schema 变更, 但如果未来加 CASCADE DELETE 约束需要 migration |
| 孤立子进程 | `openclaw gateway stop/start` 不杀死 swarm-core.js 子进程 (已知坑), 需要手动 kill |
| npm token | 当前有效 token: `[REDACTED]` (存于 `~/.npmrc`) |

---

## 五、发布流程备忘 (每次修复后的标准操作)

```bash
# 1. 跑测试
cd E:\OpenClaw\data\swarm && npx vitest run

# 2. 确保所有 VERSION 常量一致
grep -n "const VERSION" src/index.js src/swarm-core.js src/L5-application/plugin-adapter.js
grep '"version"' package.json openclaw.plugin.json

# 3. Git amend + force push + tag
git add <modified files>
git commit --amend --no-edit
git push origin main --force
git tag -f v8.2.0
git push origin v8.2.0 --force

# 4. npm publish
npm publish

# 5. 更新 Gateway
openclaw gateway stop
# 如果 port 19100 被占用: netstat -ano | findstr ":19100" → kill PID
openclaw gateway start

# 6. 验证
openclaw plugins list   # 应显示 loaded + 正确版本
```

---

## 六、架构关键知识 (新 session 必须知道的)

### 进程模型
```
Gateway (主进程, port 18789)
  └─ Plugin: openclaw-swarm (src/index.js)
       └─ fork() → SwarmCore 子进程 (src/swarm-core.js)
            ├─ IPC Bridge (JSON-RPC over child_process)
            ├─ DashboardService (Fastify, port 19100)
            ├─ 所有 L1-L6 引擎
            └─ WebSocket DirectSpawnClient → Gateway agent RPC
```

### 工具注册链
```
src/index.js register(api)
  → startCore() → fork swarm-core.js
  → IPC call 'getToolManifests'
  → api.registerTool() × 4 (swarm_run/query/dispatch/checkpoint)
  → execute: IPC proxy → coreBridge.call('tool:xxx')
```

### Auto-hooks 链 (subagent_ended)
```
subagent_ended event
  → ensureAgent(agentId)     [V8.2.6 新增]
  → isSuccess 判定 (实质结果优先)
  → score 梯度 (0.70/0.78/0.85 | 0.1/0.2/0.3)
  → success_count/failure_count 更新
  → Auto-hook 1: qualityController.recordEvaluation
  → Auto-hook 2: shapleyCredit.recordContribution
  → Auto-hook 3: reputationLedger.recordEvent
  → Auto-hook 4: pheromoneEngine.emitPheromone (三分逻辑)
  → Auto-hook 5: episodicMemory.record
  → SignalField deposit (LLM-as-Judge async)
```

### 用户硬性约束
1. **禁止 "claude" 字样** (AI 模型产品名如 claude-opus-4-6 保留)
2. **作者/贡献者仅 DEEP-IOS**
3. **License: AGPL-3.0-or-later**
4. **测试必须真实浏览器验证** (Chrome MCP, 不用 preview 工具)
5. **Console 通过 SwarmCore DashboardService port 19100**, 不启动 vite dev server
6. **Gateway URL 用 127.0.0.1** 不用 localhost
7. **中文交流**
