import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { wsBridge } from '../../api/ws-bridge';
import { useOperatorFeedStore } from '../../stores/operator-feed-store';
import { useViewStore } from '../../stores/view-store';
import { colors } from '../../theme/tokens';
import type { OperatorFeedItem } from '../../stores/operator-feed-store';

interface FeedEvent {
  id: number;
  ts: number;
  topic: string;
  data: unknown;
}

type StoryKind =
  | 'workflow'
  | 'contract'
  | 'communication'
  | 'social'
  | 'recovery'
  | 'guardrail'
  | 'hooks'
  | 'operator'
  | 'completion';

let nextEventId = 0;

const RAW_TOPIC_COLORS: Record<string, string> = {
  'agent.lifecycle': colors.glow.info,
  task: colors.dimension.task,
  channel: colors.dimension.coordination,
  stigmergy: colors.dimension.knowledge,
  quality: colors.glow.warning,
  field: colors.dimension.knowledge,
  pheromone: colors.dimension.trail,
  reputation: colors.glow.success,
  spawn: colors.dimension.coordination,
  'user.notification': colors.glow.success,
  observe: colors.text.muted,
  tool: colors.dimension.coordination,
};

const STORY_META: Record<StoryKind, { label: string; color: string }> = {
  workflow: { label: 'Workflow', color: '#5CB8FF' },
  contract: { label: 'ContractNet', color: '#F5A623' },
  communication: { label: 'Signals', color: '#8B5CF6' },
  social: { label: 'Reputation', color: '#35D399' },
  recovery: { label: 'Recovery', color: '#F59E0B' },
  guardrail: { label: 'Guardrails', color: '#EF4444' },
  hooks: { label: 'Auto Hooks', color: '#8B5CF6' },
  operator: { label: 'Operator', color: '#8B5CF6' },
  completion: { label: 'Completion', color: '#35D399' },
};

function formatAge(ts: number) {
  const delta = Math.max(0, Date.now() - ts);
  if (delta < 1000) return 'now';
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  return `${Math.round(delta / 60_000)}m ago`;
}

function getRawTopicColor(topic: string): string {
  for (const [prefix, color] of Object.entries(RAW_TOPIC_COLORS)) {
    if (topic.startsWith(prefix)) return color;
  }
  return colors.text.secondary;
}

function asRecord(data: unknown): Record<string, unknown> | null {
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
}

function shortId(value: unknown, length = 12) {
  return typeof value === 'string' && value.length > 0
    ? value.slice(0, length)
    : null;
}

function describeRawEvent(topic: string, data: unknown) {
  const record = asRecord(data);

  if (topic.startsWith('agent.lifecycle')) {
    const agentId = shortId(record?.agentId ?? record?.id);
    const state = typeof record?.state === 'string' ? record.state : 'state changed';
    return agentId ? `${agentId} ${state}` : 'Agent lifecycle update';
  }

  if (topic.startsWith('task')) {
    const taskId = shortId(record?.taskId ?? record?.dagId ?? record?.id);
    const status = typeof record?.status === 'string' ? record.status : null;
    if (taskId && status) return `${taskId} ${status}`;
    if (taskId) return `${taskId} task update`;
    return 'Task pipeline update';
  }

  if (topic === 'spawn.advised') {
    const role = typeof record?.role === 'string' ? record.role : 'generalist';
    const task = typeof record?.task === 'string' ? record.task : null;
    return task ? `Spawn advisor chose ${role} for ${task}` : `Spawn advisor chose ${role}`;
  }

  if (topic === 'contract.cfp.issued') {
    const task = asRecord(record?.task);
    const taskLabel = typeof task?.summary === 'string'
      ? task.summary
      : typeof task?.name === 'string'
        ? task.name
        : 'task';
    return `CFP issued for ${taskLabel}`;
  }

  if (topic === 'contract.awarded') {
    const winner = asRecord(record?.winner);
    const roleId = typeof winner?.roleId === 'string' ? winner.roleId : 'unknown role';
    const modelId = typeof winner?.modelId === 'string'
      ? winner.modelId
      : typeof winner?.preferredModel === 'string'
        ? winner.preferredModel
        : typeof winner?.model === 'string'
          ? winner.model
          : null;
    return modelId ? `${roleId} won via ${modelId}` : `${roleId} won the contract`;
  }

  if (topic.startsWith('channel')) {
    const channelId = shortId(record?.channelId, 16);
    const from = shortId(record?.from);
    const message = asRecord(record?.message);
    const messageType = typeof message?.type === 'string' ? message.type : null;
    return [
      channelId ? `channel ${channelId}` : 'channel',
      from ? `from ${from}` : null,
      messageType ? `${messageType} message` : 'message observed',
    ].filter(Boolean).join(' ');
  }

  if (topic.startsWith('tool')) {
    const toolName = typeof record?.tool === 'string'
      ? record.tool
      : typeof record?.toolName === 'string'
        ? record.toolName
        : 'tool';
    const status = typeof record?.status === 'string' ? record.status : 'activity';
    return `${toolName} ${status}`;
  }

  if (topic === 'user.notification') {
    const type = typeof record?.type === 'string' ? record.type : 'progress';
    if (type === 'choice') {
      return typeof record?.question === 'string'
        ? `Clarification requested: ${record.question}`
        : 'Clarification requested';
    }
    if (type === 'blocked') {
      return typeof record?.reason === 'string'
        ? `Blocked: ${record.reason}`
        : 'Execution blocked';
    }
    if (type === 'complete') {
      const summary = typeof record?.result === 'object' && record.result && typeof (record.result as Record<string, unknown>).summary === 'string'
        ? (record.result as Record<string, unknown>).summary as string
        : null;
      return summary ?? 'Completion notice emitted';
    }
    return typeof record?.message === 'string' ? record.message : 'Progress notice emitted';
  }

  if (topic.startsWith('quality')) {
    if (topic === 'quality.audit.completed') {
      const grade = typeof record?.grade === 'string' ? record.grade : 'unknown';
      return `Quality audit completed (${grade})`;
    }
    const detail = typeof record?.message === 'string'
      ? record.message
      : typeof record?.error === 'string'
        ? record.error
        : null;
    return detail ?? 'Quality or guardrail update';
  }

  if (topic === 'shapley.computed') {
    const dagId = typeof record?.dagId === 'string' ? record.dagId : 'unknown DAG';
    return `Shapley credit computed for ${dagId}`;
  }

  if (topic === 'memory.episode.recorded') {
    const episodeId = typeof record?.episodeId === 'string' ? record.episodeId : 'unknown episode';
    return `Episode recorded: ${episodeId}`;
  }

  if (topic.startsWith('field')) {
    const dimension = typeof record?.dimension === 'string' ? record.dimension : 'signal';
    return `Field update on ${dimension}`;
  }

  if (topic.startsWith('pheromone')) {
    const type = typeof record?.type === 'string' ? record.type : 'trail';
    const intensity = typeof record?.intensity === 'number'
      ? `${Math.round(record.intensity * 100)}%`
      : null;
    return intensity ? `${type} at ${intensity}` : `${type} deposit`;
  }

  if (topic.startsWith('stigmergy')) {
    const key = typeof record?.key === 'string' ? record.key : 'entry';
    const scope = typeof record?.scope === 'string' ? record.scope : null;
    return scope ? `${key} updated at ${scope}` : `${key} updated`;
  }

  if (topic === 'reputation.updated') {
    const agentId = shortId(record?.agentId);
    const action = typeof record?.action === 'string' ? record.action : 'updated';
    return agentId ? `reputation ${action} for ${agentId}` : 'reputation updated';
  }

  if (topic === 'quality.breaker.tripped') {
    const toolName = typeof record?.toolName === 'string' ? record.toolName : 'tool';
    return `breaker tripped on ${toolName}`;
  }

  if (topic === 'quality.anomaly.detected') {
    const worst = asRecord(record?.worst);
    const anomalyType = typeof worst?.type === 'string'
      ? worst.type
      : typeof record?.type === 'string'
        ? record.type
        : 'unknown anomaly';
    return `anomaly detected: ${anomalyType}`;
  }

  if (record?.message && typeof record.message === 'string') {
    return record.message;
  }

  return 'Runtime event received';
}

function isStoryItem(item: OperatorFeedItem) {
  return item.type !== 'spawned' && item.type !== 'departed';
}

function classifyStoryKind(item: OperatorFeedItem): StoryKind {
  if (item.sourceTopic.startsWith('workflow.') || item.sourceTopic === 'spawn.advised') return 'workflow';
  if (item.sourceTopic.startsWith('contract.')) return 'contract';
  if (
    item.sourceTopic.startsWith('channel.')
    || item.sourceTopic.startsWith('pheromone.')
    || item.sourceTopic.startsWith('stigmergy.')
  ) {
    return 'communication';
  }
  if (item.sourceTopic === 'reputation.updated') return 'social';
  if (item.sourceTopic.startsWith('replan.') || item.sourceTopic.startsWith('quality.pipeline.')) return 'recovery';
  if (
    item.sourceTopic.startsWith('budget.')
    || item.sourceTopic.startsWith('quality.compliance.')
    || item.sourceTopic === 'quality.breaker.tripped'
    || item.sourceTopic === 'quality.anomaly.detected'
  ) {
    return 'guardrail';
  }
  if (
    item.sourceTopic === 'quality.audit.completed'
    || item.sourceTopic === 'auto.quality.gate'
    || item.sourceTopic === 'shapley.computed'
    || item.sourceTopic === 'auto.shapley.credit'
    || item.sourceTopic === 'memory.episode.recorded'
  ) {
    return 'hooks';
  }
  if (item.type === 'complete') return 'completion';
  return 'operator';
}

export function EventFeed({ maxItems = 30 }: { maxItems?: number }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const operatorItems = useOperatorFeedStore((state) => state.items);
  const setView = useViewStore((state) => state.setView);

  useEffect(() => {
    return wsBridge.onEvent('*', (data, topic) => {
      setEvents((prev) => {
        const next = [{ id: ++nextEventId, ts: Date.now(), topic, data }, ...prev];
        return next.slice(0, maxItems);
      });
    });
  }, [maxItems]);

  const storylineItems = useMemo(
    () => operatorItems.filter(isStoryItem).slice(0, 8),
    [operatorItems],
  );

  const storylineCounts = useMemo(() => {
    const counts: Record<StoryKind, number> = {
      workflow: 0,
      contract: 0,
      communication: 0,
      social: 0,
      recovery: 0,
      guardrail: 0,
      hooks: 0,
      operator: 0,
      completion: 0,
    };

    for (const item of storylineItems) {
      counts[classifyStoryKind(item)] += 1;
    }

    return counts;
  }, [storylineItems]);

  const wiretapEvents = useMemo(
    () => events.slice(0, 10),
    [events],
  );

  return (
    <section className="console-event-feed">
      <div className="console-event-feed__header">
        <strong>Live Narrative + Wiretap</strong>
        <span>{storylineItems.length} story / {wiretapEvents.length} raw</span>
      </div>

      <div className="console-event-feed__list">
        <div className="console-event-feed__section">
          <div className="console-event-feed__section-head">
            <div>
              <strong>Operator Timeline</strong>
              <span>Backend promises translated into human-readable runtime evidence</span>
            </div>
          </div>

          <div className="console-event-feed__story-summary">
            {(Object.keys(STORY_META) as StoryKind[]).map((kind) => (
              <div
                key={kind}
                className="console-event-feed__story-chip"
                style={{ ['--story-accent' as string]: STORY_META[kind].color }}
              >
                <strong>{storylineCounts[kind]}</strong>
                <span>{STORY_META[kind].label}</span>
              </div>
            ))}
          </div>

          <div className="console-event-feed__story-list">
            <AnimatePresence initial={false}>
              {storylineItems.map((item) => {
                const kind = classifyStoryKind(item);
                const meta = STORY_META[kind];

                return (
                  <motion.button
                    key={item.id}
                    type="button"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.18 }}
                    className={`console-event-feed__story-item${item.targetView ? ' is-clickable' : ''}`}
                    style={{ ['--story-accent' as string]: meta.color }}
                    onClick={() => {
                      if (item.targetView) {
                        setView(item.targetView);
                      }
                    }}
                  >
                    <div className="console-event-feed__story-head">
                      <span className="console-event-feed__story-label">{meta.label}</span>
                      <span className="console-event-feed__story-time">{formatAge(item.ts)}</span>
                    </div>

                    <strong>{item.title}</strong>
                    <p>{item.body}</p>

                    <div className="console-event-feed__story-meta">
                      <span>{item.sourceTopic}</span>
                      {item.targetView ? <span>open {item.targetView}</span> : null}
                    </div>
                  </motion.button>
                );
              })}
            </AnimatePresence>

            {storylineItems.length === 0 ? (
              <div className="console-event-feed__empty">
                Waiting for operator-facing runtime evidence.
              </div>
            ) : null}
          </div>
        </div>

        <div className="console-event-feed__section is-wiretap">
          <div className="console-event-feed__section-head">
            <div>
              <strong>Wiretap</strong>
              <span>Raw bridge events for debugging and trace correlation</span>
            </div>
          </div>

          <div className="console-event-feed__wiretap-list">
            <AnimatePresence initial={false}>
              {wiretapEvents.map((event) => {
                const color = getRawTopicColor(event.topic);
                return (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, x: 16, height: 0 }}
                    animate={{ opacity: 1, x: 0, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                    className="console-event-feed__item"
                  >
                    <span
                      className="console-event-feed__dot"
                      style={{ background: color, boxShadow: `0 0 12px ${color}55` }}
                    />

                    <div className="console-event-feed__body">
                      <div className="console-event-feed__meta">
                        <span className="console-event-feed__topic" style={{ color }}>
                          {event.topic}
                        </span>
                        <span className="console-event-feed__time">
                          {new Date(event.ts).toLocaleTimeString()}
                        </span>
                      </div>

                      <div className="console-event-feed__summary">
                        {describeRawEvent(event.topic, event.data)}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {wiretapEvents.length === 0 ? (
              <div className="console-event-feed__empty">
                Waiting for live bridge events.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
