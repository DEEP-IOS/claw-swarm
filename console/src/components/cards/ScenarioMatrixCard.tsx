import { useMemo, useState } from 'react';
import { useOperatorFeedStore } from '../../stores/operator-feed-store';
import { useViewStore } from '../../stores/view-store';
import { useWorldStore } from '../../stores/world-store';
import {
  ORIGINAL_SCENARIO_BASELINE,
  buildScenarioMatrix,
  summarizeScenarioMatrix,
  type ScenarioRoundState,
} from '../../utils/scenario-matrix';

const STATE_META: Record<ScenarioRoundState, { label: string; color: string }> = {
  live: { label: 'proven', color: '#35D399' },
  ready: { label: 'run it', color: '#5CB8FF' },
  gap: { label: 'missing', color: '#F59E0B' },
  offline: { label: 'offline', color: '#70749D' },
};

function formatAge(ts: number | null) {
  if (!ts) return 'waiting';

  const delta = Math.max(0, Date.now() - ts);
  if (delta < 1000) return 'now';
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  return `${Math.round(delta / 60_000)}m ago`;
}

export function ScenarioMatrixCard() {
  const connected = useWorldStore((state) => state.connected);
  const snapshot = useWorldStore((state) => state.snapshot);
  const operatorItems = useOperatorFeedStore((state) => state.items);
  const currentView = useViewStore((state) => state.currentView);
  const setView = useViewStore((state) => state.setView);
  const [activeDayId, setActiveDayId] = useState('day-1');

  const matrix = useMemo(
    () => buildScenarioMatrix(snapshot, operatorItems, connected),
    [connected, operatorItems, snapshot],
  );

  const summary = useMemo(() => summarizeScenarioMatrix(matrix), [matrix]);
  const activeDay = matrix.find((day) => day.id === activeDayId) ?? matrix[0] ?? null;

  if (!activeDay) {
    return null;
  }

  return (
    <section className="console-context-card console-scenario-card">
      <div className="console-sidebar__heading">
        <strong>Scenario Matrix</strong>
        <span>{summary.liveCount}/{ORIGINAL_SCENARIO_BASELINE.scenarioCards} proven</span>
      </div>

      <div className="console-scenario-hero">
        <div>
          <div className="console-scenario-hero__eyebrow">Converted design walkthrough</div>
          <div className="console-scenario-hero__title">
            Day 0 to Day 3, Round 1 to Round 15
          </div>
          <div className="console-scenario-hero__body">
            The original `converted-document.docx` is now a live matrix: 4 days, 15 rounds, 58 checks.
            We only mark a round as proven when runtime evidence actually exists.
          </div>
        </div>

        <div className="console-scenario-score">
          <strong>{summary.verifiedScore}%</strong>
          <span>round coverage</span>
          <em>{summary.readyCount} ready / {summary.gapCount} missing</em>
        </div>
      </div>

      <div className="console-scenario-day-tabs">
        {matrix.map((day) => {
          const liveCount = day.rounds.filter((round) => round.state === 'live').length;
          const gapCount = day.rounds.filter((round) => round.state === 'gap').length;
          const isActive = day.id === activeDay.id;

          return (
            <button
              key={day.id}
              type="button"
              className={`console-scenario-day-tab${isActive ? ' is-active' : ''}`}
              onClick={() => setActiveDayId(day.id)}
            >
              <span className="console-scenario-day-tab__label">{day.label}</span>
              <strong>{day.subtitle}</strong>
              <div className="console-scenario-day-tab__meta">
                <span>{liveCount}/{day.rounds.length} proven</span>
                {gapCount > 0 ? <span>{gapCount} missing</span> : null}
              </div>
            </button>
          );
        })}
      </div>

      <div className="console-scenario-round-list">
        {activeDay.rounds.map((round) => {
          const meta = STATE_META[round.state];

          return (
            <button
              key={round.id}
              type="button"
              className={`console-scenario-round is-${round.state}${currentView === round.view ? ' is-active' : ''}`}
              onClick={() => setView(round.view)}
            >
              <div className="console-scenario-round__head">
                <div>
                  <span className="console-scenario-round__label">{round.roundLabel}</span>
                  <strong>{round.title}</strong>
                </div>
                <span
                  className="console-scenario-round__state"
                  style={{ color: meta.color }}
                >
                  {meta.label}
                </span>
              </div>

              <p>{round.detail}</p>

              <div className="console-scenario-round__meta">
                <span>{currentView === round.view ? 'viewing' : `open ${round.view}`}</span>
                <span>evidence {formatAge(round.evidenceTs)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
