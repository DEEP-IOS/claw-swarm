# Installation & Configuration Guide / 安装与配置指南

**Claw-Swarm V5.0** — Swarm intelligence plugin for OpenClaw

---

## 1. Prerequisites / 前置条件

| Requirement / 要求 | Version / 版本 | Notes / 说明 |
|---|---|---|
| **Node.js** | >= 22.0.0 | Required for built-in `node:sqlite` (DatabaseSync). / 需要内置 `node:sqlite`。 |
| **OpenClaw CLI** | Latest | `openclaw` command must be in PATH. / `openclaw` 命令需在 PATH 中可用。 |
| **npm** | >= 10.0.0 | Ships with Node.js 22+. / 随 Node.js 22+ 附带。 |

```bash
node -v   # Must show v22.x.x or higher / 必须为 v22.x.x 或更高
```

---

## 2. Installation Steps / 安装步骤

```bash
# Step 1: Install dependencies / 安装依赖
cd E:\OpenClaw\data\swarm
npm install

# Step 2: Link-install to OpenClaw / 链接安装到 OpenClaw
openclaw plugins install -l E:\OpenClaw\data\swarm

# Step 3: Enable the plugin / 启用插件
openclaw plugins enable claw-swarm

# Step 4: Restart gateway / 重启网关
openclaw gateway restart

# Verify / 验证
openclaw plugins list    # should show claw-swarm as enabled
openclaw hooks list      # should show 8 registered hooks
```

After installation, the plugin registers 8 OpenClaw hooks and 7 agent tools.

安装完成后，插件自动注册 8 个 OpenClaw 钩子和 7 个 Agent 工具。

---

## 3. Configuration / 配置

Configure via your OpenClaw configuration file / 通过 OpenClaw 配置文件进行配置：

```json
{
  "plugins": {
    "claw-swarm": {
      "dbPath": "path/to/claw-swarm.db",
      "memory": { "inMemory": false, "maxFocus": 5, "maxContext": 15, "maxScratch": 30 },
      "pheromone": { "decayIntervalMs": 60000, "decayRate": 0.05 },
      "gossip": { "fanout": 3, "heartbeatMs": 5000 },
      "orchestration": {},
      "quality": {},
      "dashboard": { "enabled": false, "port": 19100 },
      "circuitBreaker": { "failureThreshold": 5, "successThreshold": 3, "resetTimeoutMs": 30000 }
    }
  }
}
```

### Option Reference / 选项说明

| Option / 选项 | Type | Default | Description / 说明 |
|---|---|---|---|
| `dbPath` | `string` | `<dataDir>/claw-swarm.db` | SQLite database path. `null` for in-memory. / 数据库路径，`null` 为内存模式。 |
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

## 5. Upgrading from v4.0 / 从 v4.0 升级

### Directory Structure / 目录结构

V5.0 uses **L1-L6 directories**. Legacy `layer1-4` directories remain but are unused.

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

入口点、数据库架构、测试框架和插件清单均有变更，详见上方。

---

## 6. Uninstall / 卸载

```bash
openclaw plugins disable claw-swarm
openclaw plugins uninstall claw-swarm
```

The database file (`claw-swarm.db`) is not auto-deleted. Remove manually if needed.

数据库文件不会自动删除，如不需要请手动删除。

---

## 7. Troubleshooting / 故障排除

| Issue / 问题 | Cause / 原因 | Fix / 解决 |
|---|---|---|
| `Cannot find module 'node:sqlite'` | Node.js < 22.0.0 | Upgrade to Node.js >= 22.0.0 / 升级 Node.js |
| Plugin shows as "disabled" | Enable step missed | `openclaw plugins enable claw-swarm && openclaw gateway restart` |
| Hook conflict at priority 50 | OME v1.1.0 running simultaneously | Disable OME. Claw-Swarm replaces it. / 禁用 OME |
| Dashboard port in use | Port 19100 occupied | Change `dashboard.port` in config / 更改端口 |
| Database locked errors | Concurrent access | DB uses WAL mode + `busy_timeout=5000ms`. Check no external locks. / 检查外部锁 |
| Tests failing after upgrade | Stale deps | `rm -rf node_modules && npm install && npm test` |
| Gossip heartbeat warnings | No active peers | Normal in single-agent mode. Ignored safely. / 单 Agent 模式正常 |
