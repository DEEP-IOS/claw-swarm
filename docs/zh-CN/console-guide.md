# 控制台指南

> Claw-Swarm V9.2.0 实时蜂群控制台

[<- 返回 README](../../README.zh-CN.md) | [English](../en/console-guide.md)

---

## 概览

V9 控制台是一个 React 18 单页应用，由 `DashboardService` 在 `19100` 端口提供页面，由 `ConsoleDataBridge` 通过 WebSocket 在 `19101` 端口推送实时数据。

当前代码里其实有两条实时链路：

- `DashboardService` 仍然保留了旧的 SSE 流：`GET /api/v9/events`
- 现在这套 3D V9 控制台实际使用的是 `console/src/api/ws-bridge.ts`，连接 `ws://127.0.0.1:19101`

所以如果你在排查当前控制台问题，优先检查 WebSocket bridge，而不是先盯着 SSE。

---

## 访问方式

1. 启动网关。
   ```bash
   openclaw gateway start
   ```
2. 打开 `http://127.0.0.1:19100/v9/console`
3. 确认浏览器已经连上 `ws://127.0.0.1:19101`

这个 SPA 由 dashboard 进程直接提供，正常运行时不需要额外启动单独的前端开发服务器。

---

## 实时数据契约

控制台当前以 5 Hz 请求这些快照字段：

- `agents`
- `pheromones`
- `field`
- `tasks`
- `system`
- `mode`
- `health`
- `budget`
- `breakers`

这部分请求逻辑在 [App.tsx](../../console/src/App.tsx)，桥接客户端在 [ws-bridge.ts](../../console/src/api/ws-bridge.ts)。

---

## 视图

当前控制台是 10 个视图，不是旧文档里的 6 个：

1. `Hive`
2. `Pipeline`
3. `Cognition`
4. `Ecology`
5. `Network`
6. `Control`
7. `Field`
8. `System`
9. `Adaptation`
10. `Communication`

可以通过底部 dock 或键盘 `1-0` 切换。

---

## 交互模型

前端现在使用 3 级 `uiDepth` 交互状态：

- `uiDepth = 1`：总览
- `uiDepth = 2`：细节面板 / Inspector
- `uiDepth = 3`：Deep Data 深层面板

这只是前端交互概念，不是 V9 后端的架构域概念。

状态定义在 [interaction-store.ts](../../console/src/stores/interaction-store.ts)。

---

## 主要面板

### 左侧栏

- 系统总览
- 实时 agent 列表
- 信息素摘要

### 右侧栏

- 选中 agent 时显示 Inspector
- 未选中 agent 时显示当前视图指南和实时事件流

### Deep Data Panel

可从 Inspector 打开，也可在 compare 模式下进入。当前标签页包括：

- `Radar`
- `Formula`
- `Trace`
- `Compare`
- `Raw`

---

## 快捷键

- `Ctrl+K` / `Cmd+K`：命令面板
- `1-0`：切换视图
- `Esc`：关闭已打开的细节面板
- `Shift+Click` 第二个 agent：进入对比
- 在 Deep Data 面板里按 `Tab`：轮换标签页

---

## 首先应该验证什么

如果控制台看起来不对，建议按这个顺序排查：

1. `DashboardService` 是否真的在提供 `/v9/console`
2. `19101` 上的 WebSocket bridge 是否可达
3. 快照里的 `system.bridgeReady` 是否为 `true`
4. `system.architecture.domains.active` 是否符合预期运行状态
5. 实时 `tasks` 是否已经带有 `name`、`status`、`assigneeId` 这些规范字段

---

## 当前现实情况

这套控制台已经比旧文档更接近真实实现，但还没有完全收口：

- 主包体积仍偏大，Vite 还会提示 chunk 警告
- 仓库里还有一些历史文档仍在描述旧的 SSE-only 6 视图控制台
- 一些更早设计文档里的后端行为预期，仍然是“目标”而不是“已被源码和运行链路证明的事实”

[<- 返回 README](../../README.zh-CN.md) | [English](../en/console-guide.md)
