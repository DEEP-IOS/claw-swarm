# Console Guide

> Claw-Swarm V9.2.0 real-time swarm console

[<- Back to README](../../README.md) | [中文](../zh-CN/console-guide.md)

---

## Overview

The V9 console is a React 18 single-page application served by `DashboardService` on port `19100` and fed by the `ConsoleDataBridge` WebSocket bridge on port `19101`.

Two transport paths exist in the codebase today:

- `DashboardService` still exposes the legacy SSE stream on `GET /api/v9/events`
- the 3D V9 console uses `console/src/api/ws-bridge.ts` and connects to `ws://127.0.0.1:19101`

That distinction matters. If you are debugging the current console, inspect the WebSocket bridge first, not the SSE path.

---

## Access

1. Start the gateway.
   ```bash
   openclaw gateway start
   ```
2. Open `http://127.0.0.1:19100/v9/console`.
3. Confirm the browser establishes a WebSocket connection to `ws://127.0.0.1:19101`.

The SPA is built with Vite and served from the dashboard process. No separate frontend dev server is required for normal runtime use.

---

## Live Data Contract

The console requests snapshots at 5 Hz with these fields:

- `agents`
- `pheromones`
- `field`
- `tasks`
- `system`
- `mode`
- `health`
- `budget`
- `breakers`

This request is issued from [App.tsx](../../console/src/App.tsx). The bridge client lives in [ws-bridge.ts](../../console/src/api/ws-bridge.ts).

---

## Views

The current console exposes 10 views, not 6:

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

You can switch with the bottom dock or by pressing keys `1-0`.

---

## Interaction Model

The frontend uses a 3-step UI depth model:

- `uiDepth = 1`: world overview
- `uiDepth = 2`: agent detail / inspector context
- `uiDepth = 3`: deep data overlay

This is a frontend interaction concept only. It is not the same thing as the V9 backend architecture domains.

State lives in [interaction-store.ts](../../console/src/stores/interaction-store.ts).

---

## Main Panels

### Left sidebar

- system overview
- live agents roster
- pheromone summary

### Right sidebar

- selected agent inspector when an agent is focused
- otherwise a view guide plus live event feed

### Deep Data Panel

Open from the inspector or by entering compare mode. Tabs currently include:

- `Radar`
- `Formula`
- `Trace`
- `Compare`
- `Raw`

---

## Keyboard Shortcuts

- `Ctrl+K` / `Cmd+K`: command palette
- `1-0`: switch views
- `Esc`: close open detail panels
- `Shift+Click` on a second agent: compare agents
- `Tab` inside the deep data panel: cycle tabs

---

## What To Verify First

If the console looks wrong, check these in order:

1. `DashboardService` is serving `/v9/console`
2. WebSocket bridge on `19101` is reachable
3. `system.bridgeReady` is `true` in the snapshot payload
4. `system.architecture.domains.active` matches the expected runtime
5. live `tasks` include normalized fields such as `name`, `status`, and `assigneeId`

---

## Known Reality

The current console is more truthful than the older docs, but it is still not fully complete:

- bundle size is still above the ideal target and Vite warns about the main chunk
- some historical docs in the repo still describe the old SSE-only 6-view console
- several backend behavior promises from older design notes remain aspirational rather than fully proven

[<- Back to README](../../README.md) | [中文](../zh-CN/console-guide.md)
