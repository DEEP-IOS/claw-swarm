# Console Guide

> Claw-Swarm V9.0.0 — Real-time swarm visualization dashboard

[← Back to README](../../README.md) | [中文版](../zh-CN/console-guide.md)

---

## Overview

The Claw-Swarm Console is a React 18 single-page application that provides real-time visualization of swarm activity. It is served directly by the DashboardService inside the gateway process on port 19100. No separate dev server is required.

| Property         | Value                                          |
|------------------|-------------------------------------------------|
| Framework        | React 18 with hooks                            |
| State management | Zustand (no Redux)                              |
| Source files     | 99 JSX/JS/CSS files                            |
| Bundle size      | ~118 KB gzip (within 300 KB budget)            |
| Build tool       | Vite                                            |
| Rendering        | Canvas (HiveRenderer) + DOM (overlays)          |
| i18n             | 2 languages (English, Chinese) via locale files |
| Accessibility    | ARIA semantic structure, live regions           |

---

## Accessing the Console

1. Start the OpenClaw gateway:
   ```bash
   openclaw gateway start
   ```

2. Open `http://127.0.0.1:19100/v9/console` in a browser.

3. The console connects via SSE to the `/events` endpoint for real-time updates. On first connection, `loadInitialData()` fetches baseline state from REST endpoints.

No separate `npm run dev` or Vite dev server is needed. The console is served by DashboardService (`src/observe/dashboard/dashboard-service.js`) inside the gateway process.

---

## Views

The console provides 6 specialized views, each rendered as an overlay. Switch between views using the sidebar navigation or the Command Palette (Ctrl+K).

### Hive View (HiveOverlay)

Canvas-based visualization of swarm activity. Displays agent positions, pheromone trails, and task assignments in a hex-grid layout. Real-time particle effects represent pheromone intensity. Agent nodes are color-coded by status (active, idle, failed). Click any agent node to open the Inspector panel.

Component: `HiveOverlay` with `HiveRenderer` (canvas drawing engine).

### Pipeline View (PipelineOverlay)

Displays the DAG execution pipeline. Shows the full contract lifecycle from CFP (Call for Proposal) through Bid, Award, and Execution phases. Phase progress bars indicate completion status. Dependency chains between DAG nodes are rendered as directed edges. Includes bid statistics and contract completion rates.

### Cognition View (CognitionOverlay)

Dual-process routing visualization. Shows the distribution of System 1 (fast, intuitive) vs System 2 (slow, deliberate) decisions. Signal weight bars from the signal calibrator display the current influence of each signal dimension. Quality gate pass/fail ratios are shown alongside routing confidence scores.

### Ecology View (EcologyOverlay)

Shapley credit distribution across agents. Displays species evolution timeline, population dynamics, and credit attribution fairness metrics. When Lotka-Volterra dynamics are enabled, predator-prey population curves are rendered. Species fitness scores and generation history are tracked over time.

### Network View (NetworkOverlay)

Social network analysis graph. Nodes represent agents; edges represent collaboration history weighted by interaction frequency. Displays three centrality metrics:

- **Degree centrality** — number of direct collaborators
- **Betweenness centrality** — bridge role in collaboration paths
- **PageRank** — overall influence within the swarm network

Clustering coefficients and community detection results are overlaid on the graph.

### Control View (ControlOverlay)

Operational dashboard with RED metrics (Rate, Error rate, Duration). Displays token budget tracking, circuit breaker status per tool, and global modulator mode. ABC (Artificial Bee Colony) role distribution is shown as employed/onlooker/scout percentages. Budget forecaster projections and alerting thresholds are visible here.

---

## ModelComparisonPanel

The ModelComparisonPanel provides an 8-dimensional radar chart for comparing model capabilities side by side. Each axis represents one of the 8 capability dimensions from the built-in model profiles. Select two or more models from the dropdown to overlay their radar shapes. This panel is accessible from the Control view or via the Command Palette.

The 8 dimensions match the MoE routing vectors used internally for task-to-model matching, providing visibility into how the dual-process router selects models for different task types.

---

## Keyboard Shortcuts

### Command Palette (Ctrl+K)

Press **Ctrl+K** (or **Cmd+K** on macOS) to open the Command Palette. Type to filter available commands:

- Switch between the 6 views
- Open the Settings Drawer
- Navigate to specific agents or tasks
- Trigger common actions

The palette supports fuzzy matching on command names.

---

## Event Timeline

Located at the bottom of the console. Displays a chronological feed of swarm events including agent state changes, task completions, contract lifecycle transitions, pheromone deposits, species evolution events, and more. The system handles 27 distinct event types.

- **Expandable entries:** Click any event to see its full payload.
- **Replay mode:** Click the replay button to step through past events one by one. This is useful for debugging event sequences and understanding causal chains between agent actions.
- **Filtering:** Filter events by type, agent, or severity using the filter bar.

---

## Inspector Panel

Click any agent node in the Hive or Network view to open the Inspector panel. It displays:

- **Agent profile:** ID, name, role, tier, and current status.
- **Current task:** Active assignment details including goal, phase, and progress.
- **Sub-agents:** Child agents spawned by this agent, with their status and task descriptions.
- **Reputation:** 5-dimensional score comprising competence, reliability, collaboration, innovation, and trust.
- **Capabilities:** 8D radar chart showing the agent's capability profile (coding, architecture, testing, docs, security, performance, communication, domain expertise).

---

## Toast Notifications

Toast notifications appear in the top-right corner of the console, delivered in real-time via SSE. Five severity levels are used:

| Level | Color  | Examples                                     |
|-------|--------|----------------------------------------------|
| INFO  | Blue   | Agent registered, task assigned               |
| WARN  | Yellow | Budget warning, circuit breaker HALF_OPEN     |
| ERR   | Red    | Task failed, spawn failure, IPC timeout       |
| OK    | Green  | Task completed, quality gate passed           |
| EVO   | Purple | Species evolved, persona promoted, GEP cycle  |

Notifications are deduplicated to avoid flooding the UI with identical messages within a short time window.

---

## SSE Connection

The console connects to the `/events` SSE endpoint on load. Connection behavior:

- **Auto-reconnect:** On connection drop, the client retries with exponential backoff. A visual indicator in the header shows connection status (connected, reconnecting, disconnected).
- **Initial data load:** On first connect, `loadInitialData()` fetches baseline state from REST endpoints to populate all views before live events begin streaming.
- **Batch processing:** Events arrive in batches (100 ms window from `StateBroadcaster`) to reduce re-render frequency.
- **Event mapping:** `sse-client.js` maps incoming event types to the appropriate Zustand store slices, handling 27 event types with alias normalization for backward compatibility.

---

## Settings Drawer

Access via the gear icon in the header or the `SET` command in the Command Palette. Configure:

- **Theme:** Light or dark mode.
- **Notification preferences:** Toggle severity levels, set auto-dismiss duration.
- **SSE reconnection:** Adjust retry interval and maximum retries.
- **View-specific display options:** Toggle labels, adjust particle density (Hive), edge thickness (Network), and other per-view rendering parameters.

---

## State Management

Zustand stores manage all frontend state. Key slices include:

| Slice                   | Responsibility                                |
|-------------------------|-----------------------------------------------|
| `agent-slice.js`        | Agent list, states, sub-agent trees           |
| `metrics-slice.js`      | RED metrics, bid stats, ABC roles             |
| `notification-slice.js` | Toast queue with deduplication                |
| `bid-slice.js`          | Contract and bid lifecycle                    |

SSE events are dispatched to the appropriate slices via `sse-client.js`, which maps event types to store update actions with alias normalization for event name consistency across versions.

---

[← Back to README](../../README.md) | [中文版](../zh-CN/console-guide.md)
