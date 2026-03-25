import type { CSSProperties } from 'react';
import { ROLE_LABELS, ROLE_PARAMS, MILLER } from '../../engine/constants';
import { useInteractionStore } from '../../stores/interaction-store';
import { useWorldStore } from '../../stores/world-store';
import { BehaviorAssuranceCard } from '../cards/BehaviorAssuranceCard';
import { Chapter14WalkthroughCard } from '../cards/Chapter14WalkthroughCard';
import { OperatorInboxCard } from '../cards/OperatorInboxCard';
import { PheromoneBar } from '../cards/PheromoneBar';
import { ScenarioMatrixCard } from '../cards/ScenarioMatrixCard';
import { SystemOverviewCard } from '../cards/SystemOverviewCard';
import { VerificationDeckCard } from '../cards/VerificationDeckCard';

const STATE_COLORS: Record<string, string> = {
  EXECUTING: '#F5A623',
  ACTIVE: '#10B981',
  REPORTING: '#3B82F6',
  IDLE: '#70749D',
};

export function LeftSidebar() {
  const snapshot = useWorldStore((state) => state.snapshot);
  const selectedAgentId = useInteractionStore((state) => state.selectedAgentId);
  const compareAgentId = useInteractionStore((state) => state.compareAgentId);
  const hoveredAgentId = useInteractionStore((state) => state.hoveredAgentId);
  const selectAgent = useInteractionStore((state) => state.selectAgent);
  const toggleCompare = useInteractionStore((state) => state.toggleCompare);
  const hoverAgent = useInteractionStore((state) => state.hoverAgent);

  const agents = snapshot?.agents ?? [];
  const visibleAgents = agents.slice(0, MILLER.AGENT_LIST_VISIBLE);
  const tasks = snapshot?.tasks ?? [];
  const taskByAssignee = new Map(
    tasks
      .filter((task) => task.assigneeId)
      .map((task) => [task.assigneeId as string, task]),
  );

  return (
    <aside className="console-sidebar console-sidebar--left">
      <div className="console-sidebar__section" style={{ paddingBottom: 14, overflow: 'auto', flex: 1 }}>
        <BehaviorAssuranceCard />
        <VerificationDeckCard />
        <ScenarioMatrixCard />
        <Chapter14WalkthroughCard />
        <SystemOverviewCard />
        <OperatorInboxCard />

        <div className="console-sidebar__heading">
          <strong>Live Agents</strong>
          <span>shift+click compare</span>
        </div>

        <div className="console-agent-list">
          {visibleAgents.length === 0 ? (
            <div className="console-inspector__empty" style={{ padding: '12px 0 0' }}>
              Waiting for live agent telemetry.
            </div>
          ) : null}

          {visibleAgents.map((agent) => {
            const roleParams = ROLE_PARAMS[agent.role] ?? ROLE_PARAMS.implementer;
            const roleLabel = ROLE_LABELS[agent.role] ?? agent.role;
            const state = agent.state?.toUpperCase() ?? 'IDLE';
            const stateColor = STATE_COLORS[state] ?? '#70749D';
            const isSelected = agent.id === selectedAgentId;
            const isCompare = agent.id === compareAgentId;
            const isHovered = agent.id === hoveredAgentId;
            const task = taskByAssignee.get(agent.id);
            const taskLabel = task?.summary || task?.name || agent.taskId || 'No active task';
            const style = {
              ['--agent-accent' as string]: roleParams.color,
            } as CSSProperties;

            return (
              <button
                key={agent.id}
                type="button"
                onClick={(event) => {
                  if (event.shiftKey && selectedAgentId && selectedAgentId !== agent.id) {
                    toggleCompare(agent.id);
                    return;
                  }

                  selectAgent(agent.id);
                }}
                onMouseEnter={() => hoverAgent(agent.id)}
                onMouseLeave={() => hoverAgent(null)}
                className={`console-agent-card${isSelected ? ' is-selected' : ''}${isCompare ? ' is-compare' : ''}${isHovered ? ' is-hovered' : ''}`}
                style={style}
              >
                <div className="console-agent-card__dot" />

                <div className="console-agent-card__body">
                  <div className="console-agent-card__title">
                    <span className="console-agent-card__name">{roleLabel}</span>
                    <span
                      className="console-state-pill"
                      style={{ color: stateColor, borderColor: `${stateColor}33` }}
                    >
                      {state}
                    </span>
                  </div>

                  <div className="console-agent-card__meta">{agent.id.slice(0, 12)}</div>
                  <div className="console-agent-card__task">{taskLabel}</div>
                </div>
              </button>
            );
          })}
        </div>

        {agents.length > MILLER.AGENT_LIST_VISIBLE ? (
          <div className="console-data-row" style={{ paddingTop: 10 }}>
            <span>Queue spillover</span>
            <span className="console-data-row__value">+{agents.length - MILLER.AGENT_LIST_VISIBLE}</span>
          </div>
        ) : null}
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="console-sidebar__section">
          <PheromoneBar />
        </div>
      </div>
    </aside>
  );
}
