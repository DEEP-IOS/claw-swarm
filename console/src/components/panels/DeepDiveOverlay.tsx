import { useEffect, useMemo, useState } from 'react';
import type { WorldSnapshot } from '../../api/ws-bridge';
import { RadarChart } from '../charts/RadarChart';
import { SparkLine } from '../charts/SparkLine';
import { useFieldStore } from '../../stores/field-store';
import { useInteractionStore } from '../../stores/interaction-store';
import { useWorldStore } from '../../stores/world-store';
import { DIMENSION_META } from '../../theme/tokens';

type TabId = 'radar' | 'formula' | 'trace' | 'compare' | 'raw';

const TAB_LABELS: Record<TabId, string> = {
  radar: 'Radar',
  formula: 'Formula',
  trace: 'Trace',
  compare: 'Compare',
  raw: 'Raw',
};

function dominantEmotion(
  emotion: Record<string, number> | undefined,
): { key: string; value: number } {
  if (!emotion) {
    return { key: 'none', value: 0 };
  }

  return Object.entries(emotion).reduce<{ key: string; value: number }>(
    (best, [key, value]) => (value > best.value ? { key, value } : best),
    { key: 'none', value: 0 },
  );
}

function mean(values: number[] | undefined) {
  if (!values || values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatTimestamp(ts: number | undefined) {
  if (!ts) {
    return 'N/A';
  }

  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function buildTrace(
  history: Array<{ ts: number; snapshot: WorldSnapshot }>,
  agentId: string,
) {
  const events: Array<{
    ts: number;
    state: string;
    taskId: string | null;
    reputation: number;
  }> = [];

  let previousState: string | null = null;
  let previousTask: string | null = null;

  for (const item of history) {
    const agent = (item.snapshot.agents ?? []).find((entry) => entry.id === agentId);

    if (!agent) {
      continue;
    }

    const state = agent.state ?? 'UNKNOWN';
    const taskId = agent.taskId ?? null;
    const reputation = agent.reputation ?? 0;

    if (state !== previousState || taskId !== previousTask) {
      events.push({
        ts: item.ts,
        state,
        taskId,
        reputation,
      });
      previousState = state;
      previousTask = taskId;
    }
  }

  return events.slice(-12).reverse();
}

function CompareMetric({
  label,
  left,
  right,
  numeric = false,
}: {
  label: string;
  left: string | number;
  right: string | number;
  numeric?: boolean;
}) {
  const leftValue = typeof left === 'number' ? left : Number.NaN;
  const rightValue = typeof right === 'number' ? right : Number.NaN;
  const delta =
    numeric && Number.isFinite(leftValue) && Number.isFinite(rightValue)
      ? leftValue - rightValue
      : null;

  return (
    <div className="console-layer3__compare-row">
      <div className="console-layer3__compare-value">{typeof left === 'number' ? formatPercent(left) : left}</div>
      <div className="console-layer3__compare-label">
        <strong>{label}</strong>
        {delta !== null ? (
          <span className={`console-layer3__compare-delta${delta > 0 ? ' is-positive' : delta < 0 ? ' is-negative' : ''}`}>
            {delta > 0 ? '+' : ''}
            {Math.round(delta * 100)} pts
          </span>
        ) : null}
      </div>
      <div className="console-layer3__compare-value is-right">{typeof right === 'number' ? formatPercent(right) : right}</div>
    </div>
  );
}

export function DeepDiveOverlay() {
  const uiDepth = useInteractionStore((state) => state.uiDepth);
  const selectedAgentId = useInteractionStore((state) => state.selectedAgentId);
  const compareAgentId = useInteractionStore((state) => state.compareAgentId);
  const closeDeepPanel = useInteractionStore((state) => state.closeDeepPanel);

  const snapshot = useWorldStore((state) => state.snapshot);
  const history = useWorldStore((state) => state.history);
  const fieldVector = useFieldStore((state) => state.vector);

  const selectedAgent = snapshot?.agents?.find((agent) => agent.id === selectedAgentId) ?? null;
  const compareAgent = snapshot?.agents?.find((agent) => agent.id === compareAgentId) ?? null;

  const availableTabs = useMemo<TabId[]>(() => {
    const tabs: TabId[] = ['radar', 'formula', 'trace'];
    if (compareAgentId) {
      tabs.push('compare');
    }
    tabs.push('raw');
    return tabs;
  }, [compareAgentId]);

  const [activeTab, setActiveTab] = useState<TabId>(compareAgentId ? 'compare' : 'radar');

  useEffect(() => {
    setActiveTab(compareAgentId ? 'compare' : 'radar');
  }, [compareAgentId, selectedAgentId]);

  useEffect(() => {
    if (uiDepth !== 3) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDeepPanel();
        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        setActiveTab((current) => {
          const index = availableTabs.indexOf(current);
          const nextIndex = (index + 1) % availableTabs.length;
          return availableTabs[nextIndex];
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [availableTabs, closeDeepPanel, uiDepth]);

  const dimensionSeries = useMemo(
    () =>
      DIMENSION_META.map((dimension) => ({
        ...dimension,
        current: Number(snapshot?.field?.[dimension.id] ?? fieldVector[dimension.id] ?? 0),
        series: history.map((item) => Number(item.snapshot.field?.[dimension.id] ?? 0)),
      })),
    [fieldVector, history, snapshot?.field],
  );

  const traceEvents = useMemo(
    () => (selectedAgentId ? buildTrace(history, selectedAgentId) : []),
    [history, selectedAgentId],
  );

  const formulaCards = useMemo(() => {
    const budgetUsed = Number(snapshot?.budget?.global?.spent ?? 0);
    const budgetLimit = Math.max(Number(snapshot?.budget?.global?.totalSession ?? 0), 1);
    const budgetPressure = budgetUsed / budgetLimit;
    const healthScore = Number(snapshot?.health?.score ?? 0);
    const selectedCapability = mean(selectedAgent?.capabilities);
    const selectedReputation = Number(selectedAgent?.reputation ?? 0);

    return [
      {
        title: 'Budget Pressure',
        formula: 'pressure = spent / total_session',
        value: formatPercent(budgetPressure),
        note: `${budgetUsed.toFixed(2)} / ${budgetLimit.toFixed(2)}`,
      },
      {
        title: 'Health Envelope',
        formula: 'health = score / 100',
        value: `${Math.round(healthScore)}`,
        note: snapshot?.health?.status ?? 'unknown',
      },
      {
        title: 'Agent Capability Mean',
        formula: 'cap_mean = sum(capability_i) / n',
        value: formatPercent(selectedCapability),
        note: selectedAgent ? `${selectedAgent.capabilities.length} capability lanes` : 'No selected agent',
      },
      {
        title: 'Agent Trust Proxy',
        formula: 'trust ~= reputation',
        value: formatPercent(selectedReputation),
        note: selectedAgent ? selectedAgent.role : 'No selected agent',
      },
    ];
  }, [
    selectedAgent,
    snapshot?.budget?.global?.spent,
    snapshot?.budget?.global?.totalSession,
    snapshot?.health?.score,
    snapshot?.health?.status,
  ]);

  const rawPayload = useMemo(
    () => ({
      selectedAgent,
      compareAgent,
      field: snapshot?.field ?? {},
      health: snapshot?.health ?? null,
      budget: snapshot?.budget ?? null,
      frameId: snapshot?.frameId ?? null,
    }),
    [compareAgent, selectedAgent, snapshot?.budget, snapshot?.field, snapshot?.frameId, snapshot?.health],
  );

  if (uiDepth !== 3 || !selectedAgentId) {
    return null;
  }

  return (
    <div className="console-layer3" role="dialog" aria-modal="true" aria-label="Deep data panel">
      <button
        type="button"
        className="console-layer3__backdrop"
        aria-label="Close deep data overlay"
        onClick={closeDeepPanel}
      />

      <div className="console-layer3__panel">
        <div className="console-layer3__header">
          <div>
            <div className="console-layer3__eyebrow">Deep Data Panel</div>
            <div className="console-layer3__title">
              <strong>{selectedAgent?.role ?? 'Selected Agent'}</strong>
              <span>{selectedAgentId.slice(0, 16)}</span>
            </div>
            <div className="console-layer3__subtitle">
              {compareAgent ? `Compare active against ${compareAgent.role} ${compareAgent.id.slice(0, 12)}` : 'Field, trace, and raw runtime state'}
            </div>
          </div>

          <div className="console-layer3__actions">
            <span className="console-kbd">Tab</span>
            <span className="console-kbd">Esc</span>
            <button
              type="button"
              className="console-icon-button"
              onClick={closeDeepPanel}
              aria-label="Close deep data overlay"
            >
              X
            </button>
          </div>
        </div>

        <div className="console-layer3__tabs" role="tablist" aria-label="Deep data tabs">
          {availableTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`console-layer3__tab${activeTab === tab ? ' is-active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        <div className="console-layer3__content">
          {activeTab === 'radar' ? (
            <div className="console-layer3__grid">
              <section className="console-layer3__card console-layer3__card--radar">
                <div className="console-layer3__card-head">
                  <strong>12D Signal Field</strong>
                  <span>{snapshot?.mode ?? 'live'}</span>
                </div>
                <RadarChart vector={snapshot?.field ?? fieldVector} width={520} height={520} />
              </section>

              <section className="console-layer3__card">
                <div className="console-layer3__card-head">
                  <strong>Historical Curves</strong>
                  <span>{history.length} snapshots</span>
                </div>
                <div className="console-layer3__spark-grid">
                  {dimensionSeries.map((dimension) => (
                    <div key={dimension.id} className="console-layer3__spark-row">
                      <div>
                        <div className="console-layer3__spark-label">{dimension.label}</div>
                        <div className="console-layer3__spark-meta">{formatPercent(dimension.current)}</div>
                      </div>
                      <SparkLine data={dimension.series} width={180} height={38} color={dimension.color} />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {activeTab === 'formula' ? (
            <div className="console-layer3__formula-grid">
              {formulaCards.map((card) => (
                <section key={card.title} className="console-layer3__card">
                  <div className="console-layer3__card-head">
                    <strong>{card.title}</strong>
                    <span>{card.value}</span>
                  </div>
                  <div className="console-layer3__formula">{card.formula}</div>
                  <div className="console-layer3__formula-note">{card.note}</div>
                </section>
              ))}
            </div>
          ) : null}

          {activeTab === 'trace' ? (
            <section className="console-layer3__card">
              <div className="console-layer3__card-head">
                <strong>Agent Trace Timeline</strong>
                <span>{traceEvents.length} transitions</span>
              </div>
              <div className="console-layer3__timeline">
                {traceEvents.length === 0 ? (
                  <div className="console-inspector__empty" style={{ padding: 0 }}>
                    No state transitions available yet for this agent.
                  </div>
                ) : (
                  traceEvents.map((event, index) => (
                    <div key={`${event.ts}-${index}`} className="console-layer3__timeline-row">
                      <div className="console-layer3__timeline-time">{formatTimestamp(event.ts)}</div>
                      <div className="console-layer3__timeline-line" />
                      <div className="console-layer3__timeline-body">
                        <strong>{event.state}</strong>
                        <span>{event.taskId ? `task ${event.taskId.slice(0, 14)}` : 'no active task'}</span>
                        <em>reputation {formatPercent(event.reputation)}</em>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          ) : null}

          {activeTab === 'compare' ? (
            <section className="console-layer3__card">
              <div className="console-layer3__card-head">
                <strong>Agent Compare</strong>
                <span>{compareAgent ? 'dual profile' : 'compare unavailable'}</span>
              </div>
              {selectedAgent && compareAgent ? (
                <div className="console-layer3__compare">
                  <div className="console-layer3__compare-head">
                    <strong>{selectedAgent.role}</strong>
                    <span>vs</span>
                    <strong>{compareAgent.role}</strong>
                  </div>
                  <CompareMetric label="State" left={selectedAgent.state} right={compareAgent.state} />
                  <CompareMetric label="Reputation" left={selectedAgent.reputation} right={compareAgent.reputation} numeric />
                  <CompareMetric label="Capability Mean" left={mean(selectedAgent.capabilities)} right={mean(compareAgent.capabilities)} numeric />
                  <CompareMetric label="Dominant Emotion" left={dominantEmotion(selectedAgent.emotion).key} right={dominantEmotion(compareAgent.emotion).key} />
                  <CompareMetric label="Urgency" left={selectedAgent.emotion.urgency} right={compareAgent.emotion.urgency} numeric />
                  <CompareMetric label="Curiosity" left={selectedAgent.emotion.curiosity} right={compareAgent.emotion.curiosity} numeric />
                </div>
              ) : (
                <div className="console-inspector__empty" style={{ padding: 0 }}>
                  Shift+click a second agent to open live compare mode.
                </div>
              )}
            </section>
          ) : null}

          {activeTab === 'raw' ? (
            <section className="console-layer3__card">
              <div className="console-layer3__card-head">
                <strong>Raw Runtime Payload</strong>
                <span>frame {snapshot?.frameId ?? 'N/A'}</span>
              </div>
              <pre className="console-layer3__raw">
                {JSON.stringify(rawPayload, null, 2)}
              </pre>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
