import { useMemo } from 'react';
import { useOperatorFeedStore } from '../../stores/operator-feed-store';
import { useViewStore } from '../../stores/view-store';
import { useWorldStore } from '../../stores/world-store';
import { buildVerificationDeck, summarizeVerificationDeck, type VerificationPromiseItem, type VerificationPromiseState } from '../../utils/verification-deck';

const STATE_META: Record<VerificationPromiseState, { label: string; color: string }> = {
  live: { label: 'proven', color: '#35D399' },
  ready: { label: 'ready', color: '#5CB8FF' },
  attention: { label: 'watch', color: '#F59E0B' },
  offline: { label: 'offline', color: '#70749D' },
};

function formatAge(ts: number | null) {
  if (!ts) return 'waiting';

  const delta = Math.max(0, Date.now() - ts);
  if (delta < 1000) return 'now';
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  return `${Math.round(delta / 60_000)}m ago`;
}

function countState(items: VerificationPromiseItem[], state: VerificationPromiseState) {
  return items.filter((item) => item.state === state).length;
}

export function VerificationDeckCard() {
  const connected = useWorldStore((state) => state.connected);
  const snapshot = useWorldStore((state) => state.snapshot);
  const operatorItems = useOperatorFeedStore((state) => state.items);
  const currentView = useViewStore((state) => state.currentView);
  const setView = useViewStore((state) => state.setView);

  const deck = useMemo(() => {
    return buildVerificationDeck(snapshot, operatorItems, connected);
  }, [connected, operatorItems, snapshot]);

  const summary = useMemo(() => summarizeVerificationDeck(deck), [deck]);
  const { provenCount, readyCount, attentionCount, score: deckScore, total } = summary;

  return (
    <section className="console-context-card console-verification-card">
      <div className="console-sidebar__heading">
        <strong>Verification Deck</strong>
        <span>{provenCount}/{total} proven</span>
      </div>

      <div className="console-verification-hero">
        <div>
          <div className="console-verification-hero__eyebrow">Original operator checklist</div>
          <div className="console-verification-hero__title">
            Stop guessing whether the behavior guide is real
          </div>
          <div className="console-verification-hero__body">
            This deck tracks the Day 0 to Day 3 promises from the original console concept and
            lights them up only when runtime evidence actually appears.
          </div>
        </div>

        <div className="console-verification-score">
          <strong>{deckScore}</strong>
          <span>verified</span>
          <em>{readyCount} ready / {attentionCount} watch</em>
        </div>
      </div>

      <div className="console-verification-stage-list">
        {deck.map((stage) => {
          const stageProven = countState(stage.items, 'live');

          return (
            <section key={stage.id} className="console-verification-stage">
              <button
                type="button"
                className={`console-verification-stage__head${currentView === stage.view ? ' is-active' : ''}`}
                onClick={() => setView(stage.view)}
              >
                <div>
                  <span className="console-verification-stage__label">{stage.label}</span>
                  <strong>{stage.summary}</strong>
                </div>
                <span className="console-verification-stage__score">
                  {stageProven}/{stage.items.length}
                </span>
              </button>

              <div className="console-verification-item-list">
                {stage.items.map((item) => {
                  const meta = STATE_META[item.state];

                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`console-verification-item is-${item.state}${currentView === item.view ? ' is-active' : ''}`}
                      onClick={() => setView(item.view)}
                    >
                      <div className="console-verification-item__head">
                        <div>
                          <span
                            className="console-verification-item__state"
                            style={{ color: meta.color }}
                          >
                            {meta.label}
                          </span>
                          <strong>{item.title}</strong>
                        </div>
                        <span className="console-verification-item__jump">
                          {currentView === item.view ? 'viewing' : `open ${item.view}`}
                        </span>
                      </div>

                      <p>{item.detail}</p>

                      <div className="console-verification-item__meta">
                        <span>evidence {formatAge(item.evidenceTs)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
