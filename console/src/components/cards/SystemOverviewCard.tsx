import { useMemo } from 'react';
import { useWorldStore } from '../../stores/world-store';

const STAGE_COLORS: Record<string, string> = {
  active: '#35D399',
  ready: '#5CB8FF',
  warning: '#F97316',
  offline: '#6B7280',
};

function titleCase(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function SystemOverviewCard() {
  const snapshot = useWorldStore((state) => state.snapshot);
  const system = snapshot?.system;

  const domainList = useMemo(() => {
    if (!system) {
      return [];
    }

    return Object.entries(system.architecture.domainStatus).map(([domain, online]) => ({
      domain,
      online,
    }));
  }, [system]);

  if (!system) {
    return (
      <section className="console-context-card">
        <div className="console-sidebar__heading">
          <strong>System Overview</strong>
          <span>waiting</span>
        </div>

        <div className="console-context-empty">
          Waiting for runtime architecture and workflow telemetry.
        </div>
      </section>
    );
  }

  const { architecture, workflow } = system;
  const behavior = system.behavior;
  const showInferenceNotice = workflow.phaseSource === 'inferred' && workflow.inferenceNotice;

  return (
    <section className="console-context-card">
      <div className="console-sidebar__heading">
        <strong>System Overview</strong>
        <span>{workflow.phase}</span>
      </div>

      <p className="console-context-summary">{workflow.summary}</p>
      {showInferenceNotice ? (
        <div className="console-context-note">
          {workflow.inferenceNotice}
        </div>
      ) : null}

      <div className="console-context-kpis">
        <div className="console-context-kpi">
          <span>Architecture</span>
          <strong>{architecture.domains.active}/{architecture.domains.total}</strong>
          <em>domains online</em>
        </div>

        <div className="console-context-kpi">
          <span>Runtime</span>
          <strong>{architecture.runtimeSubsystems.active}/{architecture.runtimeSubsystems.total}</strong>
          <em>subsystems live</em>
        </div>

        <div className="console-context-kpi">
          <span>Modules</span>
          <strong>{architecture.moduleCount}</strong>
          <em>loaded now</em>
        </div>

        <div className="console-context-kpi">
          <span>Bridge</span>
          <strong>{architecture.bridgeReady ? 'Ready' : 'Offline'}</strong>
          <em>{architecture.toolCount} tools</em>
        </div>
      </div>

      <div className="console-context-domain-list">
        {domainList.map(({ domain, online }) => (
          <span
            key={domain}
            className={`console-context-domain${online ? ' is-online' : ''}`}
          >
            <span className="console-context-domain__dot" />
            {titleCase(domain)}
          </span>
        ))}
      </div>

      {behavior ? (
        <div className="console-context-kpis">
          <div className="console-context-kpi">
            <span>Sensing</span>
            <strong>{behavior.sensing.activePheromoneTypes}</strong>
            <em>{behavior.sensing.stigmergyEntries} board notes</em>
          </div>

          <div className="console-context-kpi">
            <span>Escalation</span>
            <strong>{behavior.escalation.emotionHotAgents}</strong>
            <em>{behavior.escalation.complianceViolations} violations</em>
          </div>

          <div className="console-context-kpi">
            <span>Adaptation</span>
            <strong>{behavior.adaptation.mode}</strong>
            <em>success {behavior.adaptation.successRate.toFixed(2)}</em>
          </div>

          <div className="console-context-kpi">
            <span>Budget</span>
            <strong>{Math.round((behavior.budget.utilization ?? 0) * 100)}%</strong>
            <em>{behavior.budget.dagCount} DAGs tracked</em>
          </div>
        </div>
      ) : null}

      <div className="console-context-stage-list">
        {workflow.stages.map((stage) => (
          <div key={stage.id} className="console-context-stage">
            <div className="console-context-stage__head">
              <strong>{stage.label}</strong>
              <span
                className="console-state-pill"
                style={{
                  color: STAGE_COLORS[stage.status] ?? '#6B7280',
                  borderColor: `${STAGE_COLORS[stage.status] ?? '#6B7280'}33`,
                }}
              >
                {stage.status}
              </span>
            </div>
            <p>{stage.detail}</p>
          </div>
        ))}
      </div>

      {workflow.evidence ? (
        <div className="console-context-kpis">
          <div className="console-context-kpi">
            <span>Research</span>
            <strong>{workflow.evidence.roleCounts?.research ?? 0}</strong>
            <em>live readers</em>
          </div>
          <div className="console-context-kpi">
            <span>Implement</span>
            <strong>{workflow.evidence.roleCounts?.implement ?? 0}</strong>
            <em>live builders</em>
          </div>
          <div className="console-context-kpi">
            <span>Review</span>
            <strong>{workflow.evidence.roleCounts?.review ?? 0}</strong>
            <em>live reviewers</em>
          </div>
          <div className="console-context-kpi">
            <span>Sensing</span>
            <strong>{workflow.evidence.sensing?.pheromoneTrails ?? 0}</strong>
            <em>{workflow.evidence.sensing?.channelCount ?? 0} channels</em>
          </div>
        </div>
      ) : null}

      <div className="console-context-guide">
        <strong>How to read:</strong> click an agent for details, shift+click a second
        agent to compare, and press Ctrl+K for runtime actions.
      </div>
    </section>
  );
}
