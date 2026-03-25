import { useMemo } from 'react';
import { useInteractionStore } from '../../stores/interaction-store';
import { useViewStore } from '../../stores/view-store';
import { useWorldStore } from '../../stores/world-store';
import type { ViewId } from '../../stores/view-store';

const VIEW_GUIDES: Record<ViewId, {
  title: string;
  focus: string;
  read: string;
  next: string;
}> = {
  hive: {
    title: 'Spatial swarm map',
    focus: 'Use this view to understand who is active, where attention is clustering, and which agents deserve inspection.',
    read: 'Bright moving agents usually indicate live execution pressure. Stable clusters mean repeated coordination around the same scope.',
    next: 'Click one agent for detail, or shift+click a second one to compare profiles side by side.',
  },
  pipeline: {
    title: 'Workflow chain',
    focus: 'Track how work is flowing through planning, execution, review, and synthesis.',
    read: 'Look for stalled tasks, missing assignees, and node counts that stop changing while the workflow phase stays active.',
    next: 'Inspect the agent holding the blocked task, then open the deep data panel to review its recent trace.',
  },
  cognition: {
    title: 'Routing pressure',
    focus: 'See whether the system is behaving like a quick responder or a deliberate multi-step worker.',
    read: 'Use this view to validate system 1 vs system 2 decisions, confidence, and signal pressure.',
    next: 'Compare the visible routing phase against the current workflow summary and recent tool activity.',
  },
  ecology: {
    title: 'Swarm balance',
    focus: 'Read systemic balance across roles, trust, and adaptation pressure.',
    read: 'Use this view to spot over-concentration on one role, reputation drift, or unhealthy specialization.',
    next: 'Check whether the active role mix matches the current workflow stage and task inventory.',
  },
  network: {
    title: 'Coordination graph',
    focus: 'Inspect collaboration structure and whether information is flowing through a few chokepoints.',
    read: 'Bridge nodes with many connections can be useful, but they also become failure hotspots if too much work depends on them.',
    next: 'Inspect heavily connected agents and verify their workload is not disproportionate.',
  },
  control: {
    title: 'Operations control',
    focus: 'Monitor health, breakers, cost pressure, and operational safety margins.',
    read: 'This is the fastest place to confirm whether the runtime is healthy enough for continued autonomy.',
    next: 'If guardrails rise or health drops, inspect the most recent live events before issuing more work.',
  },
  field: {
    title: '12D signal field',
    focus: 'Read the raw field dimensions that connect the seven autonomous domains.',
    read: 'Treat this as the shared substrate. Sharp jumps usually mean task, alarm, trust, or learning pressure changed quickly.',
    next: 'Open Deep Data to inspect curves and raw payloads if the field shifts without an obvious visible cause.',
  },
  system: {
    title: 'Runtime architecture',
    focus: 'Validate that the V9 domains, runtime subsystems, and bridge are all actually online.',
    read: 'If the architecture card says domains are missing or the bridge is offline, do not trust the rest of the visuals blindly.',
    next: 'Compare the system card against the live event feed to see whether failures are structural or transient.',
  },
  adaptation: {
    title: 'Adaptive behavior',
    focus: 'Observe how the swarm shifts strategies under changing pressure, budgets, and recent outcomes.',
    read: 'This is where explore vs exploit behavior should become legible when the design is working properly.',
    next: 'Check whether task difficulty, cost pressure, and role mix are moving together instead of drifting independently.',
  },
  communication: {
    title: 'Message flow',
    focus: 'Inspect active communication, dispatch patterns, and passive signals between agents and domains.',
    read: 'Use this view when a workflow looks stalled but no obvious task failure is visible.',
    next: 'Correlate message activity with the live event feed and the selected agent task summary.',
  },
};

function formatDepth(uiDepth: 1 | 2 | 3) {
  return uiDepth === 1 ? 'overview' : uiDepth === 2 ? 'detail' : 'deep data';
}

export function ViewGuideCard() {
  const currentView = useViewStore((state) => state.currentView);
  const uiDepth = useInteractionStore((state) => state.uiDepth);
  const snapshot = useWorldStore((state) => state.snapshot);
  const guide = VIEW_GUIDES[currentView];

  const workflowSummary = snapshot?.system?.workflow.summary ?? 'Waiting for workflow telemetry.';
  const phaseLabel = snapshot?.system?.workflow.phase ?? 'Booting';
  const guideRows = useMemo(
    () => [
      { label: 'What this view is for', detail: guide.focus },
      { label: 'How to read it', detail: guide.read },
      { label: 'Best next move', detail: guide.next },
    ],
    [guide.focus, guide.next, guide.read],
  );

  return (
    <section className="console-context-card">
      <div className="console-sidebar__heading">
        <strong>Current View Guide</strong>
        <span>{guide.title}</span>
      </div>

      <p className="console-context-summary">{workflowSummary}</p>

      <div className="console-context-kpis">
        <div className="console-context-kpi">
          <span>View</span>
          <strong>{guide.title}</strong>
          <em>{currentView}</em>
        </div>
        <div className="console-context-kpi">
          <span>Workflow</span>
          <strong>{phaseLabel}</strong>
          <em>current phase</em>
        </div>
        <div className="console-context-kpi">
          <span>UI depth</span>
          <strong>{formatDepth(uiDepth)}</strong>
          <em>interaction state</em>
        </div>
      </div>

      <div className="console-context-stage-list">
        {guideRows.map((row) => (
          <div key={row.label} className="console-context-stage">
            <div className="console-context-stage__head">
              <strong>{row.label}</strong>
            </div>
            <p>{row.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
