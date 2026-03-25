import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useInteractionStore } from '../../stores/interaction-store';
import { useOperatorFeedStore } from '../../stores/operator-feed-store';
import { useViewStore } from '../../stores/view-store';
import { useWorldStore } from '../../stores/world-store';
import type { ViewId } from '../../stores/view-store';
import { VIEW_COLORS } from '../../engine/constants';
import { buildVerificationDeck, summarizeVerificationDeck } from '../../utils/verification-deck';

const VIEW_TABS: Array<{ id: ViewId; label: string; hint: string }> = [
  { id: 'hive', label: 'Hive', hint: '1' },
  { id: 'pipeline', label: 'Pipeline', hint: '2' },
  { id: 'cognition', label: 'Cognition', hint: '3' },
  { id: 'ecology', label: 'Ecology', hint: '4' },
  { id: 'network', label: 'Network', hint: '5' },
  { id: 'control', label: 'Control', hint: '6' },
  { id: 'field', label: 'Field', hint: '7' },
  { id: 'system', label: 'System', hint: '8' },
  { id: 'adaptation', label: 'Adapt', hint: '9' },
  { id: 'communication', label: 'Comm', hint: '0' },
];

function formatFreshness(ms: number | null) {
  if (ms === null) return 'waiting for feed';
  if (ms < 1_000) return `${ms} ms fresh`;
  return `${(ms / 1000).toFixed(1)} s behind`;
}

export function StatusBar() {
  const connected = useWorldStore((s) => s.connected);
  const snapshot = useWorldStore((s) => s.snapshot);
  const frameId = useWorldStore((s) => s.frameId);
  const currentView = useViewStore((s) => s.currentView);
  const setView = useViewStore((s) => s.setView);
  const uiDepthLevel = useInteractionStore((s) => s.uiDepth);
  const selectedAgentId = useInteractionStore((s) => s.selectedAgentId);
  const pendingOperatorItems = useOperatorFeedStore((s) =>
    s.items.filter((item) => item.type === 'choice' || item.type === 'blocked' || item.type === 'alert').length,
  );
  const operatorItems = useOperatorFeedStore((s) => s.items);
  const system = snapshot?.system;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || target?.isContentEditable) {
        return;
      }

      const index = VIEW_TABS.findIndex((tab) => tab.hint === event.key);
      if (index >= 0) {
        setView(VIEW_TABS[index].id);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setView]);

  const freshnessMs = snapshot ? Math.max(0, now - snapshot.ts) : null;
  const budgetRatio = Math.round((snapshot?.budget?.global?.utilization ?? 0) * 100);
  const workflowPhase = system?.workflow.phase ?? 'Booting';
  const guardrails = system?.workflow.stageCounts.openBreakers ?? 0;
  const uiDepth = uiDepthLevel === 1 ? 'overview' : uiDepthLevel === 2 ? 'detail' : 'deep-data';
  const verification = useMemo(
    () => summarizeVerificationDeck(buildVerificationDeck(snapshot, operatorItems, connected)),
    [connected, operatorItems, snapshot],
  );
  const topStatus = useMemo(
    () => connected ? '#10B981' : '#EF4444',
    [connected],
  );

  return (
    <footer className="console-dock">
      <div className="console-dock__row">
        <div className="console-dock__status">
          <span className="console-chip">
            <span className="console-chip__dot" style={{ color: topStatus }} />
            <strong>{connected ? 'Live transport' : 'Offline transport'}</strong>
          </span>
          <span className="console-dock__metric">
            Feed <strong>{formatFreshness(freshnessMs)}</strong>
          </span>
          <span className="console-dock__metric">
            Frame <strong>{frameId}</strong>
          </span>
          <span className="console-dock__metric">
            Budget <strong>{budgetRatio}%</strong>
          </span>
          <span className="console-dock__metric">
            Workflow <strong>{workflowPhase}</strong>
          </span>
          <span className="console-dock__metric">
            Guardrails <strong>{guardrails}</strong>
          </span>
          <span className="console-dock__metric">
            Verified <strong>{verification.score}%</strong>
          </span>
          <span className="console-dock__metric">
            Inbox <strong>{pendingOperatorItems}</strong>
          </span>
          {selectedAgentId && (
            <span className="console-dock__metric">
              Focus <strong>{selectedAgentId.slice(0, 10)}</strong>
            </span>
          )}
        </div>

        <div className="console-dock__status">
          <span className="console-dock__metric">
            UI depth <strong>{uiDepth}</strong>
          </span>
          <span className="console-dock__metric">
            Views <strong>1-0</strong>
          </span>
          <span className="console-dock__metric">
            <strong>Esc</strong> close panels
          </span>
          <span className="console-dock__metric">
            <strong>Shift+Click</strong> compare agents
          </span>
          <span className="console-dock__metric">
            <strong>Ctrl+K</strong> operator palette
          </span>
        </div>
      </div>

      <nav className="console-tabs" aria-label="Console views">
        {VIEW_TABS.map((tab) => {
          const isActive = currentView === tab.id;
          const accent = VIEW_COLORS[tab.id]?.ambient ?? '#F5A623';
          const style = {
            ['--tab-accent' as string]: accent,
          } as CSSProperties;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id)}
              className={`console-tab${isActive ? ' is-active' : ''}`}
              style={style}
            >
              <span className="console-tab__index">{tab.hint}</span>
              <span className="console-tab__label">{tab.label}</span>
              <span className="console-tab__hint">{tab.id}</span>
            </button>
          );
        })}
      </nav>
    </footer>
  );
}
