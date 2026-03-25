import { useMemo } from 'react';
import { useOperatorFeedStore } from '../../stores/operator-feed-store';
import { useViewStore } from '../../stores/view-store';
import type { ViewId } from '../../stores/view-store';
import { useWorldStore } from '../../stores/world-store';

type AssuranceState = 'live' | 'ready' | 'attention' | 'offline';

const STATE_META: Record<AssuranceState, { label: string; color: string }> = {
  live: { label: 'live', color: '#35D399' },
  ready: { label: 'ready', color: '#5CB8FF' },
  attention: { label: 'watch', color: '#F59E0B' },
  offline: { label: 'offline', color: '#70749D' },
};

const QUICK_JUMPS: Array<{ view: ViewId; label: string }> = [
  { view: 'system', label: 'Runtime' },
  { view: 'pipeline', label: 'Workflow' },
  { view: 'communication', label: 'Signals' },
  { view: 'control', label: 'Recovery' },
];

function toPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function scoreForState(state: AssuranceState) {
  switch (state) {
    case 'live':
      return 1;
    case 'ready':
      return 0.8;
    case 'attention':
      return 0.55;
    default:
      return 0;
  }
}

export function BehaviorAssuranceCard() {
  const connected = useWorldStore((state) => state.connected);
  const snapshot = useWorldStore((state) => state.snapshot);
  const agentEvents = useWorldStore((state) => state.agentEvents);
  const currentView = useViewStore((state) => state.currentView);
  const setView = useViewStore((state) => state.setView);
  const operatorItems = useOperatorFeedStore((state) => state.items);

  const system = snapshot?.system;
  const workflow = system?.workflow;
  const behavior = system?.behavior;

  const attentionOperatorItems = operatorItems.filter(
    (item) => item.type === 'choice' || item.type === 'blocked' || item.type === 'alert',
  ).length;
  const progressItems = operatorItems.filter((item) => item.type === 'progress').length;
  const runtimeItems = operatorItems.filter((item) => item.type === 'runtime').length;
  const completionItems = operatorItems.filter((item) => item.type === 'complete').length;
  const recentSpawns = agentEvents.filter((item) => item.type === 'spawned').length;

  const checklist = useMemo(() => {
    const architecture = system?.architecture;
    const communication = behavior?.communication;
    const resilience = behavior?.resilience;
    const budget = behavior?.budget;
    const compliance = behavior?.compliance;
    const stageCounts = workflow?.stageCounts;

    const transportState: AssuranceState = !connected
      ? 'offline'
      : architecture?.bridgeReady
        ? 'live'
        : 'attention';

    const workflowState: AssuranceState = !workflow
      ? 'offline'
      : (stageCounts?.activeTasks ?? 0) > 0 || (stageCounts?.activeAgents ?? 0) > 0
        ? 'live'
        : workflow.phaseSource === 'runtime'
          ? 'ready'
          : 'attention';

    const operatorState: AssuranceState = !connected
      ? 'offline'
      : attentionOperatorItems > 0
        ? 'attention'
        : progressItems > 0 || runtimeItems > 0 || completionItems > 0 || recentSpawns > 0
          ? 'live'
          : 'ready';

    const passiveState: AssuranceState = !communication
      ? 'offline'
      : communication.activeTypes.length > 0 || communication.channelCount > 0 || communication.stigmergyEntries > 0
        ? 'live'
        : 'ready';

    const resilienceState: AssuranceState = !resilience
      ? 'offline'
      : (resilience.breakerTrips ?? 0) > 0 || (resilience.retryCount ?? 0) > 0 || (resilience.modelFallbacks ?? 0) > 0 || (resilience.pipelineBreaks ?? 0) > 0
        ? 'live'
        : 'ready';

    const budgetState: AssuranceState = !budget || !compliance
      ? 'offline'
      : (budget.utilization ?? 0) >= 0.8 || (compliance.totalViolations ?? 0) > 0 || compliance.healthStatus === 'degraded'
        ? 'attention'
        : 'live';

    return [
      {
        id: 'transport',
        title: 'Transport + bridge',
        detail: architecture
          ? `${architecture.toolCount} tools, ${architecture.domains.active}/${architecture.domains.total} domains online`
          : 'Waiting for runtime architecture telemetry.',
        state: transportState,
        view: 'system' as ViewId,
      },
      {
        id: 'workflow',
        title: 'Workflow chain',
        detail: workflow
          ? `${workflow.phase} | ${stageCounts?.activeTasks ?? 0} active tasks, ${stageCounts?.activeAgents ?? 0} active agents`
          : 'No workflow evidence yet.',
        state: workflowState,
        view: 'pipeline' as ViewId,
      },
      {
        id: 'operator',
        title: 'Operator loop',
        detail: attentionOperatorItems > 0
          ? `${attentionOperatorItems} operator-visible alerts need attention`
          : `${progressItems} bridge updates, ${runtimeItems} runtime events, ${completionItems} completions`,
        state: operatorState,
        view: 'system' as ViewId,
      },
      {
        id: 'passive',
        title: 'Passive communication',
        detail: communication
          ? `${communication.activeTypes.length} signal types | ${communication.channelCount} channels | ${communication.stigmergyEntries} notes`
          : 'Waiting for pheromone and stigmergy telemetry.',
        state: passiveState,
        view: 'communication' as ViewId,
      },
      {
        id: 'recovery',
        title: 'Recovery stack',
        detail: resilience
          ? `${resilience.retryCount ?? 0} retries | ${resilience.modelFallbacks ?? 0} fallbacks | ${resilience.breakerTrips ?? 0} breaker trips`
          : 'Resilience telemetry unavailable.',
        state: resilienceState,
        view: 'control' as ViewId,
      },
      {
        id: 'budget',
        title: 'Budget + compliance',
        detail: budget && compliance
          ? `${toPercent(budget.utilization ?? 0)} used | ${compliance.totalViolations ?? 0} violations | ${compliance.healthStatus}`
          : 'Budget or compliance telemetry unavailable.',
        state: budgetState,
        view: 'adaptation' as ViewId,
      },
    ];
  }, [
    behavior?.budget,
    behavior?.communication,
    behavior?.compliance,
    behavior?.resilience,
    completionItems,
    connected,
    attentionOperatorItems,
    progressItems,
    recentSpawns,
    runtimeItems,
    system?.architecture,
    workflow,
  ]);

  const assuranceScore = Math.round(
    (checklist.reduce((sum, item) => sum + scoreForState(item.state), 0) / checklist.length) * 100,
  );
  const liveChecks = checklist.filter((item) => item.state === 'live').length;
  const stageRail = workflow?.stages ?? [];

  return (
    <section className="console-context-card console-assurance-card">
      <div className="console-sidebar__heading">
        <strong>Runtime Assurance</strong>
        <span>{workflow?.phase ?? 'Booting'}</span>
      </div>

      <div className="console-assurance-hero">
        <div>
          <div className="console-assurance-hero__eyebrow">Operator-first verification</div>
          <div className="console-assurance-hero__title">
            {workflow?.phaseSource === 'runtime' ? 'Backend workflow is speaking directly' : 'Workflow still needs interpretation'}
          </div>
          <div className="console-assurance-hero__body">
            This board turns the behavior-guide promises into live evidence so you do not have to mentally stitch together five views before trusting the system.
          </div>
        </div>

        <div className="console-assurance-score">
          <strong>{assuranceScore}</strong>
          <span>assurance</span>
          <em>{liveChecks}/{checklist.length} checks live</em>
        </div>
      </div>

      <div className="console-assurance-rail">
        {stageRail.map((stage) => (
          <div
            key={stage.id}
            className={`console-assurance-rail__step is-${stage.status}`}
            title={stage.detail}
          >
            <span className="console-assurance-rail__dot" />
            <strong>{stage.label}</strong>
          </div>
        ))}
      </div>

      <div className="console-assurance-list">
        {checklist.map((item) => {
          const meta = STATE_META[item.state];
          return (
            <button
              key={item.id}
              type="button"
              className={`console-assurance-item is-${item.state}`}
              onClick={() => setView(item.view)}
            >
              <div className="console-assurance-item__head">
                <div>
                  <span
                    className="console-assurance-item__state"
                    style={{ color: meta.color }}
                  >
                    {meta.label}
                  </span>
                  <strong>{item.title}</strong>
                </div>
                <span className="console-assurance-item__jump">
                  {item.view === currentView ? 'viewing' : `open ${item.view}`}
                </span>
              </div>
              <p>{item.detail}</p>
            </button>
          );
        })}
      </div>

      <div className="console-assurance-actions">
        {QUICK_JUMPS.map((jump) => (
          <button
            key={jump.view}
            type="button"
            className={`console-assurance-action${currentView === jump.view ? ' is-active' : ''}`}
            onClick={() => setView(jump.view)}
          >
            {jump.label}
          </button>
        ))}
      </div>
    </section>
  );
}
