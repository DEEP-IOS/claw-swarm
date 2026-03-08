# Installation & Configuration Guide / 安装与配置指南

**Claw-Swarm V5.0** — Swarm intelligence plugin for OpenClaw

---

## 1. Prerequisites / 前置条件

| Requirement / 要求 | Version / 版本 | Notes / 说明 |
|---|---|---|
| **Node.js** | >= 22.0.0 | Required for built-in `node:sqlite` (DatabaseSync). / 需要内置 `node:sqlite`。 |
| **OpenClaw** | Latest | Gateway must be installed and running. / 网关需已安装并运行。 |
| **npm** | >= 10.0.0 | Ships with Node.js 22+. / 随 Node.js 22+ 附带。 |

```bash
node -v   # Must show v22.x.x or higher / 必须为 v22.x.x 或更高
```

---

## 2. Installation Steps / 安装步骤

OpenClaw discovers plugins from the `~/.openclaw/extensions/` directory. Each subdirectory with an `openclaw.plugin.json` manifest is auto-detected.

OpenClaw 从 `~/.openclaw/extensions/` 目录发现插件。每个包含 `openclaw.plugin.json` 清单的子目录会被自动检测。

### Method A: Clone + Symlink (Recommended for development) / 克隆 + 符号链接（推荐开发方式）

```bash
# Step 1: Clone and install dependencies / 克隆并安装依赖
git clone https://github.com/DEEP-IOS/claw-swarm.git
cd claw-swarm
npm install

# Step 2: Link into OpenClaw extensions / 链接到 OpenClaw 扩展目录
# Linux / macOS:
ln -s "$(pwd)" ~/.openclaw/extensions/claw-swarm

# Windows (run CMD as Administrator / 以管理员身份运行 CMD):
mklink /J "%USERPROFILE%\.openclaw\extensions\claw-swarm" "%cd%"
```

### Method B: Direct clone into extensions / 直接克隆到扩展目录

```bash
cd ~/.openclaw/extensions
git clone https://github.com/DEEP-IOS/claw-swarm.git
cd claw-swarm && npm install
```

### Method C: CLI install / CLI 安装

```bash
openclaw plugins install --link /path/to/claw-swarm
openclaw plugins enable claw-swarm
```

### Enable and Verify / 启用并验证

```bash
# Step 3: Enable in config / 在配置中启用
# Edit ~/.openclaw/openclaw.json, add under "plugins.entries":
# 编辑 ~/.openclaw/openclaw.json，在 "plugins.entries" 下添加:
#
#   "claw-swarm": { "enabled": true }

# Step 4: Restart gateway / 重启网关
openclaw gateway restart

# Verify / 验证
openclaw plugins list    # should show claw-swarm as enabled
```

After installation, the plugin registers 8 OpenClaw hooks and 7 agent tools.

安装完成后，插件自动注册 8 个 OpenClaw 钩子和 7 个 Agent 工具。

### Plugin Discovery Order / 插件发现顺序

OpenClaw scans for plugins in this order (first match wins):

OpenClaw 按以下顺序扫描插件（首次匹配生效）：

1. `plugins.load.paths` in `openclaw.json` (custom paths / 自定义路径)
2. `<workspace>/.openclaw/extensions/` (workspace-level / 工作区级)
3. `~/.openclaw/extensions/` (user-level / 用户级)
4. `<openclaw-install>/extensions/` (bundled / 内置)

---

## 3. Configuration / 配置

Configure in `~/.openclaw/openclaw.json` under `plugins.entries`. Plugin-specific settings go inside the `config` key — `api.pluginConfig` receives this object directly.

在 `~/.openclaw/openclaw.json` 的 `plugins.entries` 中配置。插件配置必须嵌套在 `config` 键内 — 插件通过 `api.pluginConfig` 直接接收此对象。

```json
{
  "plugins": {
    "entries": {
      "claw-swarm": {
        "enabled": true,
        "config": {
          "dbPath": "~/.openclaw/claw-swarm/claw-swarm.db",
          "memory": { "inMemory": false, "maxFocus": 5, "maxContext": 15, "maxScratch": 30 },
          "pheromone": { "decayIntervalMs": 60000, "decayRate": 0.05 },
          "gossip": { "fanout": 3, "heartbeatMs": 5000 },
          "orchestration": { "qualityGates": true, "pipelineBreaker": true },
          "dashboard": { "enabled": false, "port": 19100 },
          "circuitBreaker": { "failureThreshold": 5, "successThreshold": 3, "resetTimeoutMs": 30000 }
        }
      }
    }
  }
}
```

### Option Reference / 选项说明

| Option / 选项 | Type | Default | Description / 说明 |
|---|---|---|---|
| `dbPath` | `string` | `<dataDir>/claw-swarm.db` | SQLite database path. Supports `~/`. `null` for in-memory. / 数据库路径，支持 `~/`。`null` 为内存模式。 |
| `memory.inMemory` | `boolean` | `false` | In-memory DB (data lost on restart). / 内存数据库（重启丢失）。 |
| `memory.maxFocus` | `number` | `5` | Working memory focus buffer size. / 工作记忆焦点缓冲区大小。 |
| `memory.maxContext` | `number` | `15` | Working memory context buffer size. / 工作记忆上下文缓冲区大小。 |
| `memory.maxScratch` | `number` | `30` | Working memory scratchpad size. / 工作记忆暂存区大小。 |
| `pheromone.decayIntervalMs` | `number` | `60000` | Decay pass interval (ms). / 衰减扫描间隔。 |
| `pheromone.decayRate` | `number` | `0.05` | Exponential decay rate. / 指数衰减速率。 |
| `gossip.fanout` | `number` | `3` | Peers per gossip round. / 每轮广播节点数。 |
| `gossip.heartbeatMs` | `number` | `5000` | Heartbeat interval (ms). / 心跳间隔。 |
| `dashboard.enabled` | `boolean` | `false` | Enable monitoring dashboard. / 启用监控仪表盘。 |
| `dashboard.port` | `number` | `19100` | Dashboard HTTP port. / 仪表盘端口。 |
| `circuitBreaker.failureThreshold` | `number` | `5` | Failures before circuit opens. / 断路器打开阈值。 |
| `circuitBreaker.successThreshold` | `number` | `3` | Successes to close half-open circuit. / 半开恢复阈值。 |
| `circuitBreaker.resetTimeoutMs` | `number` | `30000` | Open-to-half-open timeout (ms). / 开路转半开超时。 |

---

## 4. Dashboard Setup / 仪表盘配置

Enable the L6 monitoring dashboard by setting `dashboard.enabled: true`:

启用 L6 监控仪表盘：将 `dashboard.enabled` 设为 `true`：

```json
{ "dashboard": { "enabled": true, "port": 19100 } }
```

Access at: `http://localhost:19100`

**Features / 功能：**

- **Real-time SSE events** -- Live swarm event stream. / 实时蜂群事件流。
- **RED metrics** -- Rate, Errors, Duration for all operations. / 速率、错误、耗时指标。
- **Task monitoring** -- Active tasks, completion rates, pipeline status. / 任务监控。
- **Agent monitoring** -- Agent states, capability scores, reputation. / Agent 监控。
- **Pheromone monitoring** -- Active signals, decay visualization, type distribution. / 信息素监控。

Powered by `StateBroadcaster`, `MetricsCollector`, and `DashboardService` (Fastify HTTP).

---

## 5. Replacing OME / 替代 OME

Claw-Swarm V5.0's L3 memory system fully replaces OME (OpenClaw Memory Engine). If you have OME installed:

V5.0 的 L3 记忆系统完全替代 OME。如果你安装了 OME：

```json
{
  "plugins": {
    "entries": {
      "ome": { "enabled": false },
      "claw-swarm": { "enabled": true }
    }
  }
}
```

| OME Feature / OME 功能 | V5.0 Replacement / V5.0 替代 |
|---|---|
| Session checkpoints | WorkingMemory (3-tier: Focus/Context/Scratch) |
| prependContext injection | ContextService (memory + knowledge graph + pheromone) |
| D1/D5/D6 memory layers | EpisodicMemory (Ebbinghaus) + SemanticMemory (BFS) |
| File modification tracking | after_tool_call hook + capability dimension scoring |

---

## 6. Upgrading from v4.0 / 从 v4.0 升级

### Architecture Changes / 架构变更

V5.0 replaced the v4.0 4-layer architecture with a new 6-layer architecture:

V5.0 用全新的 6 层架构替代了 v4.0 的 4 层架构：

| v4.0 | v5.0 | Content |
|---|---|---|
| `layer1-core/` | `L1-infrastructure/` | Database, config, schemas, types |
| `layer2-engines/` | `L2-communication/` | MessageBus, PheromoneEngine, Gossip |
| `layer3-intelligence/` | `L3-agent/` + `L4-orchestration/` | Memory, Soul, Orchestrator, Quality |
| `layer4-adapter/` | `L5-application/` | PluginAdapter, tools |
| _(new)_ | `L6-monitoring/` | Dashboard, metrics |

### Other Breaking Changes / 其他重大变更

- **Entry point**: `createPlugin()` changed to `{ id, register(api) }` pattern.
- **Database**: Expanded from 25 to 34 tables (9 new: knowledge graphs, zones, plans, stats).
- **Tests**: `node:test` replaced by **vitest** (`npm test` runs `vitest run`).
- **Manifest**: `openclaw.plugin.json` added at project root.
- **Dependencies**: 5 npm runtime dependencies added (eventemitter3, fastify, nanoid, pino, zod).

---

## 7. Uninstall / 卸载

```bash
# Remove the symlink/directory from extensions / 从扩展目录移除符号链接
rm ~/.openclaw/extensions/claw-swarm    # Linux/macOS
rmdir "%USERPROFILE%\.openclaw\extensions\claw-swarm"  # Windows (junction)

# Remove from config / 从配置中移除
# Delete the "claw-swarm" entry from plugins.entries in ~/.openclaw/openclaw.json

# Restart / 重启
openclaw gateway restart
```

The database file (`claw-swarm.db`) is not auto-deleted. Remove manually if needed.

数据库文件不会自动删除，如不需要请手动删除。

---

## 8. Troubleshooting / 故障排除

| Issue / 问题 | Cause / 原因 | Fix / 解决 |
|---|---|---|
| `Cannot find module 'node:sqlite'` | Node.js < 22.0.0 | Upgrade to Node.js >= 22.0.0 / 升级 Node.js |
| Plugin not discovered | Not in extensions dir | Verify symlink: `ls ~/.openclaw/extensions/claw-swarm/openclaw.plugin.json` |
| Plugin shows as "disabled" | Not enabled in config | Add `"claw-swarm": { "enabled": true }` to `plugins.entries` |
| Hook conflict at priority 60 | Other plugin at same priority | Adjust priority in `src/index.js` / 调整优先级 |
| Dashboard port in use | Port 19100 occupied | Change `dashboard.port` in config / 更改端口 |
| Database locked errors | Concurrent access | DB uses WAL mode + `busy_timeout=5000ms`. Check no external locks. / 检查外部锁 |
| Tests failing after upgrade | Stale deps | `rm -rf node_modules && npm install && npm test` |
| Gossip heartbeat warnings | No active peers | Normal in single-agent mode. Ignored safely. / 单 Agent 模式正常 |
