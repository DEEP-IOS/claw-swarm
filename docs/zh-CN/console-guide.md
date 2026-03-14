# 控制台指南

Claw-Swarm 控制台是 React SPA，在 `http://127.0.0.1:19100/v6/console` 提供服务。6 个视图、命令面板、事件时间线和代理检查器提供蜂群活动的实时可视化。

来源：`src/L6-monitoring/console/src/` — 98 个源文件。

## 访问

1. 启动 Gateway：`openclaw gateway start`。
2. 打开 `http://127.0.0.1:19100/v6/console`。
3. 自动通过 SSE 连接到 `/events`。

由 SwarmCore 子进程的 DashboardService 提供服务，无需单独 dev server。

## 六大视图

| 视图 | 功能 |
|------|------|
| **Hive** | Canvas 蜂群活动可视化，信息素粒子效果 |
| **Pipeline** | DAG 执行管线，合同生命周期（CFP→Bid→Award→Execution） |
| **Cognition** | 双过程路由，S1/S2 分布，信号权重条 |
| **Ecology** | Shapley 信用分配，种群进化时间线 |
| **Network** | SNA 图谱，度/介数中心性，聚集系数 |
| **Control** | RED 指标，预算，熔断器，ABC 角色分布 |

## 命令面板

**Ctrl+K**（macOS: Cmd+K）。快速切换视图和设置，输入过滤。

## 事件时间线

底部时间线。按时间显示蜂群事件，可展开详情。**回放模式**可逐步重放过往事件。

## Inspector 面板

点击代理节点打开。显示：代理概况、当前任务、子代理、5D 声誉、8D 能力雷达图。

## 设置抽屉

齿轮图标或 `SET` 命令。配置主题、通知、SSE 重连。

## 通知系统

右上角 Toast。5 级：INFO（蓝）、WARN（黄）、ERR（红）、OK（绿）、EVO（紫）。

## 状态管理

Zustand 切片：agent-slice、metrics-slice、notification-slice、bid-slice。SSE 事件通过 `sse-client.js` 分发，映射 16+ 事件类型到存储更新。

## SSE 连接

- 自动重连带退避。
- 首次连接 `loadInitialData()` 从 16 个端点获取基线。
- 100ms 批次处理。

## 技术细节

- Vite 构建，~112 KB gzip（< 300 KB 预算）。
- React 18 + Hooks。
- Zustand（无 Redux）。
- Canvas（HiveRenderer）+ DOM 渲染。
- 2 语言（en/zh）。
- ARIA 无障碍。

---
[← 返回 README](../../README.md) | [English](../en/console-guide.md)
