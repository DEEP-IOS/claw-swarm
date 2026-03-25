import type { CSSProperties } from 'react';
import { useInteractionStore } from '../../stores/interaction-store';
import { useOperatorFeedStore } from '../../stores/operator-feed-store';
import { useViewStore } from '../../stores/view-store';
import { useWorldStore } from '../../stores/world-store';
import type { ViewId } from '../../stores/view-store';
import { VIEW_COLORS } from '../../engine/constants';
import { buildVerificationDeck, summarizeVerificationDeck } from '../../utils/verification-deck';

const VIEW_LABELS: Record<ViewId, string> = {
  hive: 'Hive',
  pipeline: 'Pipeline',
  cognition: 'Cognition',
  ecology: 'Ecology',
  network: 'Network',
  control: 'Control',
  field: 'Field',
  system: 'System',
  adaptation: 'Adaptation',
  communication: 'Communication',
};

function formatTimestamp(ts?: number | null) {
  if (!ts) return 'Waiting for telemetry';
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function Header() {
  const connected = useWorldStore((s) => s.connected);
  const snapshot = useWorldStore((s) => s.snapshot);
  const currentView = useViewStore((s) => s.currentView);
  const setView = useViewStore((s) => s.setView);
  const uiDepthLevel = useInteractionStore((s) => s.uiDepth);
  const operatorItems = useOperatorFeedStore((s) => s.items);
  const system = snapshot?.system;

  const pendingOperatorItems = operatorItems.filter(
    (item) => item.type === 'choice' || item.type === 'blocked' || item.type === 'alert',
  ).length;

  const mode = snapshot?.mode ?? 'STANDBY';
  const health = snapshot?.health;
  const healthScore = Math.round((health?.score ?? 0) * 100);
  const healthStatus = health?.status ?? 'unknown';
  const accent = VIEW_COLORS[currentView]?.ambient ?? '#F5A623';
  const tasks = snapshot?.tasks?.length ?? 0;
  const agents = snapshot?.agents?.length ?? 0;
  const breakers = snapshot?.breakers ? Object.keys(snapshot.breakers).length : 0;
  const workflowPhase = system?.workflow.phase ?? 'Booting';
  const workflowSource = system?.workflow.phaseSource === 'runtime' ? 'native' : 'fallback';
  const uiDepth = uiDepthLevel === 1 ? 'Overview' : uiDepthLevel === 2 ? 'Detail' : 'Deep Data';
  const architectureLabel = system
    ? `${system.architecture.domains.active}/${system.architecture.domains.total} domains`
    : 'Waiting for runtime map';

  const deck = buildVerificationDeck(snapshot, operatorItems, connected);
  const verification = summarizeVerificationDeck(deck);

  const chipStyle = {
    ['--view-accent' as string]: accent,
  } as CSSProperties;

  const healthColor = healthStatus === 'healthy'
    ? '#10B981'
    : healthStatus === 'degraded'
      ? '#F5A623'
      : '#EF4444';

  const modeColor = mode === 'EXPLORE'
    ? '#3B82F6'
    : mode === 'EXPLOIT'
      ? '#F5A623'
      : mode === 'RELIABLE'
        ? '#10B981'
        : '#EC4899';

  const liveColor = connected ? '#35D399' : '#EF4444';

  return (
    <header className="console-header" style={chipStyle}>
      <div className="console-header__primary">
        <div className="console-header__brand">
          <div className="console-header__mark">SW</div>
          <div>
            <div className="console-header__eyebrow">Swarm V9 Console</div>
            <div className="console-header__title">
              <span>Operator Station</span>
              <span className="console-header__subtitle">
                {VIEW_LABELS[currentView]} view | {architectureLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="console-header__live-strip">
          <span className="console-chip console-chip--signal">
            <span className="console-chip__dot" style={{ color: liveColor }} />
            <strong>{connected ? 'LIVE' : 'OFFLINE'}</strong>
            transport
          </span>

          <span className="console-chip console-chip--signal">
            <span className="console-chip__dot" style={{ color: modeColor }} />
            <strong>{mode}</strong>
            routing mode
          </span>

          <span className="console-chip">
            <strong>{workflowPhase}</strong>
            workflow {workflowSource}
          </span>

          <span className="console-chip">
            <span className="console-chip__dot" style={{ color: healthColor }} />
            <strong>{healthScore}%</strong>
            {healthStatus}
          </span>

          <span className="console-chip console-chip--accent">
            <strong>{verification.score}%</strong>
            promise deck
          </span>
        </div>
      </div>

      <div className="console-header__mission">
        <div className="console-header__mission-head">
          <div>
            <div className="console-header__eyebrow">Day 0 to Day 3 live verification</div>
            <div className="console-header__mission-title">
              <strong>{verification.provenCount}/{verification.total}</strong>
              <span>promises proven by live runtime evidence</span>
            </div>
          </div>

          <div className="console-header__meta">
            <span className="console-chip console-chip--accent">
              <span className="console-chip__dot" style={{ color: accent }} />
              <strong>{VIEW_LABELS[currentView]}</strong>
              active focus
            </span>

            <span className="console-chip">
              <strong>{agents}</strong>
              agents
            </span>

            <span className="console-chip">
              <strong>{tasks}</strong>
              workflows
            </span>

            <span className="console-chip">
              <strong>{uiDepth}</strong>
              UI depth
            </span>

            <span className="console-chip">
              <strong>{pendingOperatorItems}</strong>
              inbox
            </span>

            <span className="console-chip">
              <strong>{breakers}</strong>
              breakers
            </span>

            <span className="console-chip">
              <strong>{verification.readyCount}</strong>
              ready
            </span>

            <span className="console-chip">
              <strong>{verification.attentionCount}</strong>
              watch
            </span>

            <span className="console-chip">
              <strong>{formatTimestamp(snapshot?.ts)}</strong>
            </span>

            <span className="console-chip console-chip--accent">
              <strong>Ctrl+K</strong>
              palette
            </span>
          </div>
        </div>

        <div className="console-header__stage-track">
          {deck.map((stage) => {
            const stageProven = stage.items.filter((item) => item.state === 'live').length;
            const stageAttention = stage.items.filter((item) => item.state === 'attention').length;
            const stageOffline = stage.items.filter((item) => item.state === 'offline').length;
            const isActive = currentView === stage.view;

            return (
              <button
                key={stage.id}
                type="button"
                className={`console-header__stage-chip${isActive ? ' is-active' : ''}`}
                onClick={() => setView(stage.view)}
              >
                <span className="console-header__stage-label">{stage.label}</span>
                <strong>{stage.summary}</strong>
                <div className="console-header__stage-meta">
                  <span>{stageProven}/{stage.items.length} proven</span>
                  {stageAttention > 0 ? <span>{stageAttention} watch</span> : null}
                  {stageOffline > 0 ? <span>{stageOffline} offline</span> : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}
