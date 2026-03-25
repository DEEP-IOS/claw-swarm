import { useMemo, useState } from 'react';
import { useOperatorFeedStore } from '../../stores/operator-feed-store';
import { useViewStore } from '../../stores/view-store';
import { useWorldStore } from '../../stores/world-store';
import {
  buildChapter14Walkthrough,
  buildChapter14WalkthroughSummary,
  formatChapter14Brief,
  type WalkthroughStepState,
} from '../../utils/chapter14-walkthrough';

const STATE_META: Record<WalkthroughStepState, { label: string; color: string }> = {
  live: { label: 'live', color: '#35D399' },
  ready: { label: 'ready', color: '#5CB8FF' },
  manual: { label: 'manual', color: '#EC4899' },
  offline: { label: 'offline', color: '#70749D' },
};

function formatAge(ts: number | null) {
  if (!ts) return 'waiting';

  const delta = Math.max(0, Date.now() - ts);
  if (delta < 1000) return 'now';
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  return `${Math.round(delta / 60_000)}m ago`;
}

export function Chapter14WalkthroughCard() {
  const connected = useWorldStore((state) => state.connected);
  const snapshot = useWorldStore((state) => state.snapshot);
  const operatorItems = useOperatorFeedStore((state) => state.items);
  const currentView = useViewStore((state) => state.currentView);
  const setView = useViewStore((state) => state.setView);
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'failed'>('idle');

  const steps = useMemo(
    () => buildChapter14Walkthrough(snapshot, operatorItems, connected),
    [connected, operatorItems, snapshot],
  );
  const summary = useMemo(
    () => buildChapter14WalkthroughSummary(steps),
    [steps],
  );

  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(formatChapter14Brief(steps, summary));
      setCopyState('done');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <section className="console-context-card console-walkthrough-card">
      <div className="console-sidebar__heading">
        <strong>Chapter 14 Walkthrough</strong>
        <span>{summary.liveCount}/{summary.prerequisiteCount} live</span>
      </div>

      <div className="console-walkthrough-hero">
        <div>
          <div className="console-walkthrough-hero__eyebrow">Final ecosystem signoff</div>
          <div className="console-walkthrough-hero__title">
            Turn the manual walkthrough into an operator-visible checklist
          </div>
          <div className="console-walkthrough-hero__body">
            This panel mirrors the Chapter 14 live signoff path so we can see when the
            system is ready for a real ecosystem judgment instead of guessing from scattered views.
          </div>
        </div>

        <div className="console-walkthrough-score">
          <strong>{summary.readinessScore}%</strong>
          <span>readiness</span>
          <em>{summary.canAttemptFinalSignoff ? 'manual judgment unlocked' : `${summary.blockerTitles.length} blockers left`}</em>
        </div>
      </div>

      <div className="console-walkthrough-summary">
        <div className={`console-walkthrough-summary__status${summary.canAttemptFinalSignoff ? ' is-ready' : ''}`}>
          <strong>{summary.canAttemptFinalSignoff ? 'Ready for live signoff' : 'Keep exercising the runtime'}</strong>
          <p>
            {summary.canAttemptFinalSignoff
              ? 'Every prerequisite step has direct live evidence. Chapter 14 still needs an operator judgment note before we can sign it.'
              : 'The final judgment step stays manual, and the runtime still has prerequisite gaps that need real evidence.'}
          </p>
        </div>

        <button
          type="button"
          className={`console-walkthrough-action${copyState === 'done' ? ' is-success' : copyState === 'failed' ? ' is-warning' : ''}`}
          onClick={() => {
            void copyBrief();
          }}
        >
          {copyState === 'done'
            ? 'Brief copied'
            : copyState === 'failed'
              ? 'Copy failed'
              : 'Copy signoff brief'}
        </button>
      </div>

      {summary.blockerTitles.length > 0 ? (
        <div className="console-walkthrough-blockers">
          {summary.blockerTitles.map((title) => (
            <span key={title} className="console-walkthrough-blocker">
              {title}
            </span>
          ))}
        </div>
      ) : null}

      <div className="console-walkthrough-list">
        {steps.map((step, index) => {
          const meta = STATE_META[step.state];
          return (
            <button
              key={step.id}
              type="button"
              className={`console-walkthrough-item is-${step.state}${currentView === step.view ? ' is-active' : ''}`}
              onClick={() => setView(step.view)}
            >
              <div className="console-walkthrough-item__head">
                <div>
                  <span className="console-walkthrough-item__index">Step {index + 1}</span>
                  <strong>{step.title}</strong>
                </div>
                <span
                  className="console-walkthrough-item__state"
                  style={{ color: meta.color }}
                >
                  {meta.label}
                </span>
              </div>

              <p>{step.detail}</p>

              <div className="console-walkthrough-item__meta">
                <span>{currentView === step.view ? 'viewing' : `open ${step.view}`}</span>
                <span>evidence {formatAge(step.evidenceTs)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
