# Console Guide

The Claw-Swarm Console is a React SPA served at `http://127.0.0.1:19100/v6/console`. It provides real-time visualization of swarm activity through 6 views, a command palette, event timeline, and agent inspector.

Source: `src/L6-monitoring/console/src/` — 98 source files (41 JSX, 55 JS, 2 CSS).

## Accessing the Console

1. Start the OpenClaw gateway: `openclaw gateway start`.
2. Open `http://127.0.0.1:19100/v6/console` in a browser.
3. The console connects via SSE to `/events` for real-time updates.

No separate dev server is needed. The console is served by `DashboardService` (`src/L6-monitoring/dashboard-service.js`) inside the SwarmCore child process.

## Views

### Hive View

Canvas-based visualization of swarm activity. Shows agent positions, pheromone trails, and task assignments in a hex-grid layout. Real-time particle effects represent pheromone intensity.

Component: `HiveOverlay` with `HiveRenderer` (canvas drawing engine).

### Pipeline View

Displays the DAG execution pipeline. Shows contract lifecycle (CFP → Bid → Award → Execution), phase progress, and dependency chains. Includes bid statistics and contract completion rates.

### Cognition View

Dual-process routing visualization. Shows System 1 (fast) vs System 2 (slow) decision distribution. Includes signal weight bars from the signal calibrator and quality gate pass/fail ratios.

### Ecology View

Shapley credit distribution across agents. Shows species evolution timeline, population dynamics, and credit attribution fairness metrics.

### Network View

Social network analysis graph. Displays agent collaboration edges, degree centrality, betweenness centrality, and clustering coefficients. Nodes represent agents; edges represent collaboration history.

### Control View

Operational dashboard with RED metrics (Rate/Error/Duration), budget tracking, circuit breaker status, and global modulator mode. Includes ABC role distribution (employed/onlooker/scout percentages).

## Command Palette

Keyboard shortcut: **Ctrl+K** (or Cmd+K on macOS).

Quick access to view switching, settings, and common actions. Type to filter available commands.

## Event Timeline

Located at the bottom of the console. Displays a chronological feed of swarm events (agent state changes, task completions, pheromone deposits, etc.). Events are expandable for detail inspection.

**Replay mode:** Click the replay button to step through past events. Useful for debugging event sequences and understanding causal chains.

## Inspector Panel

Click any agent node in the Hive or Network view to open the Inspector panel. Displays:

- **Agent profile:** ID, name, role, tier, status.
- **Current task:** Active assignment details.
- **Sub-agents:** Child agents spawned by this agent.
- **Reputation:** 5D score (competence, reliability, collaboration, innovation, trust).
- **Capabilities:** 8D radar chart (coding, architecture, testing, docs, security, performance, communication, domain).

## Settings Drawer

Access via the gear icon or the `SET` command in the command palette. Configure:

- Theme (light/dark).
- Notification preferences.
- SSE reconnection behavior.
- View-specific display options.

## Notification System

Toast notifications appear in the top-right corner. Five severity levels:

| Level | Color | Examples |
|-------|-------|---------|
| INFO | Blue | Agent registered, task assigned |
| WARN | Yellow | Budget warning, breaker HALF_OPEN |
| ERR | Red | Task failed, spawn failure |
| OK | Green | Task completed, quality gate passed |
| EVO | Purple | Species evolved, persona promoted |

## State Management

Zustand stores manage all frontend state. Slices include:

- `agent-slice.js` — Agent list, states, sub-agent trees.
- `metrics-slice.js` — RED metrics, bid stats, ABC roles.
- `notification-slice.js` — Toast queue with dedup.
- `bid-slice.js` — Contract and bid lifecycle.

SSE events are dispatched to appropriate slices via `sse-client.js`, which maps 16+ event types to store update actions.

## SSE Connection

The console connects to `/events` (SSE endpoint) on load. Connection behavior:

- **Auto-reconnect:** On connection drop, retry with backoff.
- **Initial data load:** On first connect, `loadInitialData()` fetches baseline state from 16 REST endpoints.
- **Batch processing:** Events arrive in batches (100 ms window from `StateBroadcaster`).

## Technical Details

- **Build:** Vite, output ~112 KB gzip (within 300 KB budget).
- **Framework:** React 18 with hooks.
- **State:** Zustand (no Redux).
- **Rendering:** Canvas (HiveRenderer) + DOM (overlays).
- **i18n:** 2 languages (English, Chinese) via locale files.
- **Accessibility:** ARIA semantic structure, screen reader announcements, live regions.

---
[← Back to README](../../README.md) | [中文版](../zh-CN/console-guide.md)
