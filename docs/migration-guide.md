# Migration Guide / 迁移指南

## From V5.1 to V5.2 / 从 V5.1 迁移到 V5.2

### Overview / 概述

V5.2 is a **non-breaking upgrade** from V5.1. All V5.1 configuration, data, and APIs remain compatible. V5.2 adds 5 new modules, 6 new database tables, and activates previously deferred features.

V5.2 是 V5.1 的**非破坏性升级**。所有 V5.1 配置、数据和 API 保持兼容。V5.2 新增 5 个模块、6 张数据库表，并激活了之前搁置的功能。

### Automatic Migration / 自动迁移

On first start after upgrade, MigrationRunner automatically:

升级后首次启动时，MigrationRunner 自动：

1. Detects SCHEMA_VERSION = 6 (V5.1)
2. Creates 6 new tables: `agent_thresholds`, `pheromone_type_config`, `stigmergic_posts`, `failure_vaccines`, `trace_spans`, `skill_symbiosis`
3. Updates SCHEMA_VERSION to 7
4. Auto-backup before migration (as always)

### What Changes / 变化内容

| Aspect / 维度 | V5.1 | V5.2 |
|---|---|---|
| SCHEMA_VERSION | 6 | 7 |
| Database tables | 38 | 44 (+6) |
| Source files | 66+ | 75+ (+5 new modules) |
| Tests | 573 / 30+ files | 659 / 43 files |
| Algorithms | 12 | 18+ |
| Event topics | 27 | 37 (+10) |

### New Feature Flags / 新增特性标志

All new V5.2 feature flags are **enabled by default**:

| Flag | Default | Purpose / 用途 |
|------|---------|---|
| `pheromoneEscalation` | ✅ | Pressure gradient auto-escalation / 压力梯度自动升级 |
| `responseThreshold` | ✅ | Per-agent FRTM thresholds / 每 Agent 响应阈值 |
| `multiTypePheromone` | ✅ | Typed decay models / 多类型衰减 |
| `evolution.lotkaVolterra` | ✅ | Lotka-Volterra population dynamics / 种群动力学 |
| `evolution.abc` | ✅ | ABC three-stage evolution / ABC 三阶段进化 |

To disable any new feature, add it to your `openclaw.json` config:

```json
{
  "plugins": {
    "entries": {
      "claw-swarm": {
        "config": {
          "pheromoneEscalation": false,
          "responseThreshold": false
        }
      }
    }
  }
}
```

### New REST Endpoints / 新增 REST 端点

| Endpoint | Description / 说明 |
|---|---|
| `GET /api/v1/context-debug` | Sanitized context structure (no actual text) / 脱敏上下文结构 |
| `GET /api/v1/breaker-status` | Circuit breaker states / 断路器状态 |
| `GET /api/v1/trace-spans` | Jaeger-lite trace spans / 追踪 spans |
| `GET /api/v1/startup-summary` | Startup diagnostics / 启动诊断 |

### Verification / 验证

```bash
cd data/swarm
npm test                    # Should show 659 tests, 43 files
```

---

## From OME v1.1.0 to Claw-Swarm v4.0 / 从 OME v1.1.0 迁移到 Claw-Swarm v4.0

### Overview / 概述

Claw-Swarm v4.0 **replaces** OME. The memory engine is fully incorporated into Claw-Swarm's Layer 2. Your existing memory data is preserved through automatic import.

Claw-Swarm v4.0 **替代** OME。记忆引擎完全并入 Claw-Swarm 的 Layer 2。现有记忆数据通过自动导入保留。

> **Important / 重要：** Do not run OME and Claw-Swarm v4.0 simultaneously. Both register `before_agent_start` at priority 50, which will cause conflicts.
>
> 请勿同时运行 OME 和 Claw-Swarm v4.0。两者都在 priority 50 注册 `before_agent_start`，会产生冲突。

### Automatic Data Import / 自动数据导入

On first run, Claw-Swarm v4.0 automatically detects and imports your existing OME database:

首次运行时，Claw-Swarm v4.0 自动检测并导入现有 OME 数据库：

1. **Detection / 检测：** Looks for `ome.db` at the path specified in `config.memory.importOmePath` (defaults to `~/.openclaw/ome/ome.db`)
2. **Backup / 备份：** Creates `swarm.db.backup-{timestamp}` before import
3. **Import / 导入：** Copies all 6 OME tables (memories, daily_summaries, checkpoints, events, tasks, event_cursors) into the unified `swarm.db`
4. **Flag / 标记：** Sets `ome_imported` key in `swarm_meta` table to prevent duplicate imports
5. **Non-destructive / 无损：** Original `ome.db` is never modified (read-only copy)

### What Changes / 变化内容

| Aspect | OME v1.1.0 | Claw-Swarm v4.0 |
|--------|-----------|------------|
| Plugin ID | `ome` | `claw-swarm` |
| DB file | `ome.db` | `swarm.db` |
| Hook priority | 50 | 50 (same) |
| Context injection | Memory only | Memory + peers + pheromones |
| Configuration | `{ maxPrependChars }` | `{ memory: { enabled, maxPrependChars } }` |
| Checkpoint trigger | agent_end | agent_end (same) |

### Config Migration / 配置迁移

**Before (OME config):**
```json
{
  "maxPrependChars": 4000,
  "checkpointOnEnd": true
}
```

**After (Claw-Swarm config):**
```json
{
  "memory": {
    "enabled": true,
    "maxPrependChars": 4000
  }
}
```

### API Compatibility / API 兼容性

If you had custom code importing OME modules, update imports:

如果有自定义代码导入 OME 模块，请更新导入路径：

| OME Path | Claw-Swarm v4.0 Path |
|----------|-----------------|
| `ome/src/db.js` → `writeMemory()` | `swarm/src/layer1-core/db.js` → `writeMemory()` |
| `ome/src/services/context-service.js` | `swarm/src/layer2-engines/memory/context-service.js` |
| `ome/src/services/checkpoint-service.js` | `swarm/src/layer2-engines/memory/checkpoint-service.js` |
| `ome/src/hooks/before-agent-start.js` | `swarm/src/layer4-adapter/hooks/before-agent-start.js` |

Function signatures are preserved. Memory DB functions (`writeMemory`, `readMemories`, `saveCheckpoint`, etc.) have the same parameters.

函数签名保持不变。记忆 DB 函数参数相同。

---

## From Swarm Lite v3.0 to Claw-Swarm v4.0 / 从 Swarm Lite v3.0 迁移到 Claw-Swarm v4.0

### Overview / 概述

Swarm Lite's governance layer is fully incorporated into Claw-Swarm v4.0 Layer 2. Orchestration logic moved to Layer 3. The circuit breaker was extracted to a standalone Layer 1 module.

Swarm Lite 的治理层完全并入 Claw-Swarm v4.0 Layer 2。编排逻辑移至 Layer 3。断路器提取为独立 Layer 1 模块。

### Automatic Data Import / 自动数据导入

Similar to OME import:

1. Set `config.governance.importSwarmLitePath` to your existing swarm-lite DB path
2. On first run, all 16 governance + orchestration tables are imported
3. Flagged by `swarmv3_imported` key in `swarm_meta`
4. Non-destructive (read-only from source)

### What Changes / 变化内容

| Aspect | Swarm Lite v3.0 | Claw-Swarm v4.0 |
|--------|----------------|------------|
| Package | Standalone | Merged into unified plugin |
| DB file | `swarm-lite.db` | `swarm.db` |
| Governance | Always on | `governance.enabled` toggle |
| Task functions | `createTask()` | `createSwarmTask()` |
| Config | Flat | Nested with subsystem toggles |
| Circuit breaker | Inline in orchestrator | Standalone `circuit-breaker.js` |

### Import Path Changes / 导入路径变化

| v3.0 Path | v4.0 Path |
|-----------|-----------|
| `src/db.js` | `src/layer1-core/db.js` |
| `src/types.js` | `src/layer1-core/types.js` |
| `src/errors.js` | `src/layer1-core/errors.js` |
| `src/config.js` | `src/layer1-core/config.js` |
| `src/monitor.js` | `src/layer1-core/monitor.js` |
| `src/governance/capability-engine.js` | `src/layer2-engines/governance/capability-engine.js` |
| `src/governance/reputation-ledger.js` | `src/layer2-engines/governance/reputation-ledger.js` |
| `src/governance/voting-system.js` | `src/layer2-engines/governance/voting-system.js` |
| `src/governance/evaluation-queue.js` | `src/layer2-engines/governance/evaluation-queue.js` |
| `src/orchestrator.js` | `src/layer3-intelligence/orchestration/orchestrator.js` |
| `src/role-manager.js` | `src/layer3-intelligence/orchestration/role-manager.js` |
| `src/task-distributor.js` | `src/layer3-intelligence/orchestration/task-distributor.js` |

### DB Function Name Changes / DB 函数名变化

Orchestration functions were prefixed with `Swarm` to avoid conflicts with OME's `tasks` table:

编排函数增加 `Swarm` 前缀以避免与 OME 的 `tasks` 表冲突：

| v3.0 | v4.0 |
|------|------|
| `createTask()` | `createSwarmTask()` |
| `getTask()` | `getSwarmTask()` |
| `updateTaskStatus()` | `updateSwarmTaskStatus()` |
| `listTasks()` | `listSwarmTasks()` |
| `createRole()` | `createSwarmRole()` |
| `getRolesByTask()` | `getSwarmRolesByTask()` |
| `saveCheckpoint()` (orchestration) | `saveSwarmCheckpoint()` |
| `getArtifactsByTask()` | `getArtifactsBySwarmTask()` |

Governance functions are **unchanged** (no prefix needed — no naming conflicts).

治理函数**不变**（无需前缀 — 无命名冲突）。

---

## Rollback Procedure / 回滚流程

If you need to revert to separate plugins:

如果需要回退到独立插件：

1. **Stop Claw-Swarm v4.0** — Remove from OpenClaw plugin config
2. **Restore OME** — Re-enable OME plugin. Your original `ome.db` is untouched
3. **Restore Swarm Lite** — Re-enable swarm-lite plugin with its original DB
4. **Swarm DB backup** — `swarm.db.backup-{timestamp}` files contain pre-migration snapshots

No data is lost during migration. Both source databases are read-only during import.

迁移过程中不会丢失数据。两个源数据库在导入期间均为只读。

---

## Verification / 验证

After migration, verify everything works:

迁移后验证一切正常：

```bash
cd data/swarm

# Run all tests / 运行全部测试
npm test

# Specifically test migration / 专门测试迁移
npm run test:migration

# Check your memory data was imported / 检查记忆数据已导入
# (The plugin will log "OME data imported successfully" on first run)
```
