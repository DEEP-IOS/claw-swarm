import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ROLE_LABELS, ROLE_PARAMS } from '../../engine/constants';
import { useInteractionStore } from '../../stores/interaction-store';
import { useWorldStore } from '../../stores/world-store';

interface InspectorPanelProps {
  agentId: string;
}

const STATE_COLORS: Record<string, string> = {
  EXECUTING: '#F5A623',
  ACTIVE: '#10B981',
  REPORTING: '#3B82F6',
  IDLE: '#70749D',
};

function Section({
  title,
  defaultOpen = false,
  accentColor = '#F5A623',
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  accentColor?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const sectionStyle = {
    ['--section-accent' as string]: accentColor,
  } as CSSProperties;

  return (
    <section className="console-section" style={sectionStyle}>
      <button type="button" className="console-section__button" onClick={() => setOpen(!open)}>
        <strong>{title}</strong>
        <span
          className="console-section__chevron"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          {'>'}
        </span>
      </button>

      <div
        className="console-section__content"
        style={{
          maxHeight: open ? 520 : 0,
          padding: open ? '0 0 16px' : '0',
        }}
      >
        <div className="console-inspector-card">{children}</div>
      </div>
    </section>
  );
}

function Row({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="console-data-row">
      <span>{label}</span>
      <span className="console-data-row__value" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="console-progress">
      <div
        className="console-progress__fill"
        style={{
          width: `${Math.max(0, Math.min(100, value * 100))}%`,
          background: `linear-gradient(90deg, ${color}88, ${color})`,
        }}
      />
    </div>
  );
}

export function InspectorPanel({ agentId }: InspectorPanelProps) {
  const snapshot = useWorldStore((state) => state.snapshot);
  const setUiDepth = useInteractionStore((state) => state.setUiDepth);
  const agent = snapshot?.agents?.find((entry) => entry.id === agentId);

  if (!agent) {
    return (
      <div className="console-inspector__empty">
        Selected agent is no longer present in the live snapshot.
      </div>
    );
  }

  const roleParams = ROLE_PARAMS[agent.role] ?? ROLE_PARAMS.implementer;
  const roleLabel = ROLE_LABELS[agent.role] ?? agent.role;
  const state = agent.state?.toUpperCase() ?? 'IDLE';
  const stateColor = STATE_COLORS[state] ?? '#70749D';
  const emotion = agent.emotion ?? {
    frustration: 0,
    confidence: 0,
    joy: 0,
    urgency: 0,
    curiosity: 0,
    fatigue: 0,
  };

  const emotionEntries = Object.entries(emotion) as Array<[string, number]>;
  const dominantEmotion = emotionEntries.reduce<[string, number]>(
    (best, current) => (current[1] > best[1] ? current : best),
    ['none', 0],
  );
  const markStyle = {
    ['--agent-accent' as string]: roleParams.color,
  } as CSSProperties;

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <Section title="Identity" defaultOpen accentColor={roleParams.color}>
        <div className="console-inspector-agent" style={markStyle}>
          <div className="console-inspector-agent__mark">{roleParams.icon}</div>

          <div>
            <div className="console-inspector-agent__name">{roleLabel}</div>
            <div className="console-inspector-agent__id">{agentId.slice(0, 16)}</div>
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <span
            className="console-state-pill"
            style={{ color: stateColor, borderColor: `${stateColor}33` }}
          >
            {state}
          </span>
        </div>

        <Row label="Session" value={agent.sessionId?.slice(0, 16) ?? 'N/A'} />
        <Row label="ABC Mode" value={agent.abc ?? 'N/A'} />
        <Row label="Soul" value={agent.soul ? 'Attached' : 'None'} color={agent.soul ? '#8B5CF6' : undefined} />
        <Row label="Parent" value={agent.parentId?.slice(0, 12) ?? 'Root'} />

        <div style={{ paddingTop: 12 }}>
          <button
            type="button"
            className="console-action-button"
            onClick={() => setUiDepth(3)}
          >
            Open Deep Data Panel
          </button>
        </div>
      </Section>

      <Section title="Task" defaultOpen accentColor="#3B82F6">
        <Row label="Task ID" value={agent.taskId?.slice(0, 16) ?? 'Idle'} />
        <Row label="Spawned" value={formatTime(agent.spawnedAt)} />
        <Row label="Reputation" value={`${Math.round(agent.reputation * 100)}%`} />
      </Section>

      <Section title="Reputation" accentColor="#10B981">
        <div style={{ marginBottom: 10 }}>
          <Row label="Trust Score" value={`${Math.round(agent.reputation * 100)}%`} />
          <ProgressBar
            value={agent.reputation}
            color={agent.reputation > 0.7 ? '#10B981' : agent.reputation > 0.4 ? '#F5A623' : '#EF4444'}
          />
        </div>
      </Section>

      <Section title="Emotion" accentColor="#EC4899">
        {emotionEntries.map(([key, value]) => {
          const active = dominantEmotion[0] === key;
          return (
            <div key={key} style={{ marginBottom: 10 }}>
              <div className="console-data-row" style={{ paddingBottom: 6 }}>
                <span style={{ color: active ? '#EC4899' : undefined }}>
                  {key}
                </span>
                <span className="console-data-row__value">{Math.round(value * 100)}%</span>
              </div>
              <ProgressBar value={value} color={active ? '#EC4899' : '#7B61FF'} />
            </div>
          );
        })}
      </Section>

      <Section title="Capability" accentColor="#06B6D4">
        {(agent.capabilities ?? []).length > 0 ? (
          (agent.capabilities ?? []).map((value, index) => (
            <div key={`${agent.id}-cap-${index}`} style={{ marginBottom: 10 }}>
              <div className="console-data-row" style={{ paddingBottom: 6 }}>
                <span>Dim {index + 1}</span>
                <span className="console-data-row__value">{Math.round(value * 100)}%</span>
              </div>
              <ProgressBar value={value} color="#06B6D4" />
            </div>
          ))
        ) : (
          <div className="console-inspector__empty" style={{ padding: 0 }}>
            No capability telemetry in the current snapshot.
          </div>
        )}
      </Section>
    </div>
  );
}

function formatTime(ts: number) {
  if (!ts) {
    return 'N/A';
  }

  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
