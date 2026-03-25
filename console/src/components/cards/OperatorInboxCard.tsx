import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useOperatorFeedStore } from '../../stores/operator-feed-store';
import { useViewStore } from '../../stores/view-store';
import { useWorldStore } from '../../stores/world-store';

function formatAge(ts: number) {
  const delta = Math.max(0, Date.now() - ts);
  if (delta < 1000) return 'now';
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  return `${Math.round(delta / 60_000)}m ago`;
}

export function OperatorInboxCard() {
  const items = useOperatorFeedStore((state) => state.items);
  const dismiss = useOperatorFeedStore((state) => state.dismiss);
  const connected = useWorldStore((state) => state.connected);
  const setView = useViewStore((state) => state.setView);

  const pendingCount = useMemo(
    () => items.filter((item) => item.type === 'choice' || item.type === 'blocked' || item.type === 'alert').length,
    [items],
  );

  return (
    <section className="console-context-card console-operator-card">
      <div className="console-sidebar__heading">
        <strong>Operator Inbox</strong>
        <span>{pendingCount > 0 ? `${pendingCount} pending` : 'live sync'}</span>
      </div>

      <div className="console-operator-hero">
        <div>
          <div className="console-operator-hero__title">
            {pendingCount > 0 ? 'Decision needed' : 'Console is following runtime notices'}
          </div>
          <div className="console-operator-hero__body">
            {pendingCount > 0
              ? 'Clarifications, critical alerts, and blocked states stay visible until you dismiss them.'
              : 'Bridge notices, runtime workflow shifts, contract awards, and recovery alerts land here.'}
          </div>
        </div>

        <div className={`console-operator-pill${connected ? ' is-live' : ''}`}>
          {connected ? 'LIVE' : 'OFFLINE'}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="console-context-empty">
          Waiting for operator-facing events from the swarm.
        </div>
      ) : (
        <div className="console-operator-list">
          {items.slice(0, 6).map((item) => (
            <article
              key={item.id}
              className={`console-operator-item${item.sticky ? ' is-sticky' : ''}`}
              style={{ ['--operator-accent' as string]: item.color } as CSSProperties}
            >
              <div className="console-operator-item__head">
                <div>
                  <div className="console-operator-item__label">{item.label}</div>
                  <strong>{item.title}</strong>
                </div>

                <button
                  type="button"
                  className="console-operator-item__dismiss"
                  onClick={() => dismiss(item.id)}
                  aria-label={`Dismiss ${item.label}`}
                >
                  x
                </button>
              </div>

              <p>{item.body}</p>

              {item.clarificationQuestions.length > 0 ? (
                <div className="console-operator-item__questions">
                  {item.clarificationQuestions.map((question, index) => (
                    <div key={`${item.id}-question-${index}`} className="console-operator-item__question">
                      <strong>Q{index + 1}</strong>
                      <span>{question.question}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {item.choices.length > 0 ? (
                <div className="console-operator-item__chips">
                  {item.choices.map((choice) => (
                    <span key={`${item.id}-${choice.value}`} className="console-operator-item__chip">
                      {choice.label}
                    </span>
                  ))}
                </div>
              ) : null}

              {item.targetView ? (
                <div className="console-operator-item__actions">
                  <button
                    type="button"
                    className="console-operator-item__open"
                    onClick={() => setView(item.targetView!)}
                  >
                    Open {item.targetView}
                  </button>
                </div>
              ) : null}

              <div className="console-operator-item__meta">
                <span>{formatAge(item.ts)}</span>
                {item.sessionId ? <span>session {item.sessionId.slice(0, 8)}</span> : null}
                <span>{item.sourceTopic}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
