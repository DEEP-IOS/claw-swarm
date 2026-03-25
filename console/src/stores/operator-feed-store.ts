import { create } from 'zustand';
import type { ViewId } from './view-store';
import type { AgentEvent } from './world-store';

export type OperatorNotificationType =
  | 'progress'
  | 'blocked'
  | 'choice'
  | 'complete'
  | 'spawned'
  | 'departed'
  | 'runtime'
  | 'alert';

export interface OperatorChoice {
  label: string;
  value: string;
}

export interface ClarificationQuestion {
  question: string;
  reason?: string;
}

export interface BridgeNotificationPayload {
  sessionId?: string | null;
  type?: string;
  message?: string;
  reason?: string;
  question?: string;
  options?: string[];
  choices?: Array<string | OperatorChoice>;
  clarificationQuestions?: Array<string | ClarificationQuestion>;
  result?: Record<string, unknown>;
  ts?: number;
}

export interface OperatorFeedItem {
  id: string;
  type: OperatorNotificationType;
  label: string;
  title: string;
  body: string;
  color: string;
  ts: number;
  sessionId: string | null;
  sticky: boolean;
  toastVisible: boolean;
  choices: OperatorChoice[];
  clarificationQuestions: ClarificationQuestion[];
  sourceTopic: string;
  targetView: ViewId | null;
  dedupeKey: string | null;
}

interface OperatorFeedState {
  items: OperatorFeedItem[];
  ingestBridgeNotification: (payload: BridgeNotificationPayload, topic?: string) => void;
  ingestAgentEvent: (event: AgentEvent) => void;
  ingestRuntimeEvent: (topic: string, payload: unknown) => void;
  hideToast: (id: string) => void;
  dismiss: (id: string) => void;
}

type RuntimeRecord = Record<string, unknown>;

const MAX_ITEMS = 24;
let operatorCounter = 0;

function nextId() {
  operatorCounter += 1;
  return `operator-item-${operatorCounter}`;
}

function asRecord(value: unknown): RuntimeRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as RuntimeRecord;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => getString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function formatPercent(value: number | null) {
  if (value === null) {
    return 'n/a';
  }
  return `${Math.round(value * 100)}%`;
}

function buildBodyLines(lines: Array<string | null | undefined>) {
  return lines.filter(Boolean).join(' ');
}

function normalizeChoices(choices: BridgeNotificationPayload['choices']): OperatorChoice[] {
  return (choices ?? []).map((choice) => (
    typeof choice === 'string'
      ? { label: choice, value: choice }
      : {
          label: choice.label,
          value: choice.value,
        }
  ));
}

function normalizeQuestions(
  questions: BridgeNotificationPayload['clarificationQuestions'],
): ClarificationQuestion[] {
  return (questions ?? []).map((entry) => (
    typeof entry === 'string'
      ? { question: entry }
      : {
          question: entry.question,
          reason: entry.reason,
        }
  ));
}

function buildBridgeItem(
  payload: BridgeNotificationPayload,
  topic = 'user.notification',
): OperatorFeedItem | null {
  const ts = payload.ts ?? Date.now();
  const sessionId = payload.sessionId ?? null;
  const type = payload.type ?? 'progress';
  const choices = normalizeChoices(payload.choices);
  const clarificationQuestions = normalizeQuestions(payload.clarificationQuestions);

  if (type === 'blocked') {
    const optionText = (payload.options ?? []).length > 0
      ? `Suggested next steps: ${(payload.options ?? []).join(' | ')}`
      : '';
    return {
      id: nextId(),
      type: 'blocked',
      label: 'Blocked',
      title: 'Execution is waiting for input',
      body: buildBodyLines([
        payload.reason ?? 'A worker reported that it cannot proceed safely.',
        optionText,
      ]),
      color: '#F97316',
      ts,
      sessionId,
      sticky: true,
      toastVisible: true,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'system',
      dedupeKey: sessionId ? `bridge-blocked:${sessionId}` : null,
    };
  }

  if (type === 'choice') {
    return {
      id: nextId(),
      type: 'choice',
      label: 'Needs Clarification',
      title: payload.question ?? 'The swarm needs a sharper task definition.',
      body: choices.length > 0
        ? `Candidate directions: ${choices.map((choice) => choice.label).join(' | ')}`
        : 'Reply with one of the suggested paths or provide a more precise requirement.',
      color: '#5CB8FF',
      ts,
      sessionId,
      sticky: true,
      toastVisible: true,
      choices,
      clarificationQuestions,
      sourceTopic: topic,
      targetView: 'system',
      dedupeKey: sessionId ? `bridge-choice:${sessionId}` : null,
    };
  }

  if (type === 'complete') {
    const result = payload.result ?? {};
    const title = typeof result.summary === 'string'
      ? result.summary
      : typeof result.status === 'string'
        ? `Task ${result.status.toLowerCase()}`
        : 'Task completed';
    const body = buildBodyLines([
      typeof result.message === 'string' ? result.message : null,
      typeof result.agentId === 'string' ? `Agent ${result.agentId.slice(0, 10)} reported completion.` : null,
    ]) || 'Execution returned a completion signal.';
    return {
      id: nextId(),
      type: 'complete',
      label: 'Complete',
      title,
      body,
      color: '#35D399',
      ts,
      sessionId,
      sticky: false,
      toastVisible: true,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'pipeline',
      dedupeKey: sessionId ? `bridge-complete:${sessionId}` : null,
    };
  }

  const message = payload.message ?? 'The swarm reported fresh progress.';
  return {
    id: nextId(),
    type: 'progress',
    label: 'Progress',
    title: 'Workflow advanced',
    body: message,
    color: '#8B5CF6',
    ts,
    sessionId,
    sticky: false,
    toastVisible: true,
    choices: [],
    clarificationQuestions: [],
    sourceTopic: topic,
    targetView: 'pipeline',
    dedupeKey: sessionId ? `bridge-progress:${sessionId}` : null,
  };
}

function buildAgentItem(event: AgentEvent): OperatorFeedItem {
  const spawned = event.type === 'spawned';
  return {
    id: nextId(),
    type: spawned ? 'spawned' : 'departed',
    label: spawned ? 'Agent Spawned' : 'Agent Departed',
    title: spawned
      ? `${event.role} entered the live swarm`
      : 'Agent left the active mesh',
    body: spawned
      ? `Agent ${event.agentId.slice(0, 8)} joined${event.parentId ? ` under ${event.parentId.slice(0, 8)}` : ''}.`
      : `Agent ${event.agentId.slice(0, 8)} is no longer active in the current world view.`,
    color: spawned ? '#F5A623' : '#70749D',
    ts: event.ts,
    sessionId: null,
    sticky: false,
    toastVisible: true,
    choices: [],
    clarificationQuestions: [],
    sourceTopic: 'agent.lifecycle',
    targetView: 'hive',
    dedupeKey: null,
  };
}

function buildRuntimeItem(topic: string, payload: unknown): OperatorFeedItem | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const ts = getNumber(record.timestamp) ?? getNumber(record.ts) ?? Date.now();

  if (topic === 'spawn.advised') {
    const sessionId = getString(record.sessionId);
    const role = getString(record.role) ?? 'generalist';
    const task = getString(record.task);

    return {
      id: nextId(),
      type: 'runtime',
      label: 'Routing',
      title: `Spawn advisor selected ${role}`,
      body: buildBodyLines([
        task ? `Task: ${task}.` : null,
        sessionId ? `Session ${sessionId.slice(0, 10)}.` : null,
      ]) || 'The routing layer selected a role before execution started.',
      color: '#5CB8FF',
      ts,
      sessionId,
      sticky: false,
      toastVisible: true,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'pipeline',
      dedupeKey: sessionId ? `spawn-advised:${sessionId}` : null,
    };
  }

  if (topic === 'workflow.phase.changed') {
    const phase = getString(record.phase) ?? getString(record.to) ?? 'unknown';
    const from = getString(record.from);
    const reason = getString(record.reason);

    return {
      id: nextId(),
      type: 'runtime',
      label: 'Workflow',
      title: `Workflow moved to ${phase}`,
      body: buildBodyLines([
        from ? `From ${from}.` : null,
        reason,
      ]) || 'The backend workflow ledger reported a native phase transition.',
      color: '#5CB8FF',
      ts,
      sessionId: null,
      sticky: false,
      toastVisible: true,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'pipeline',
      dedupeKey: 'workflow-phase',
    };
  }

  if (topic === 'channel.message') {
    const channelId = getString(record.channelId) ?? 'unknown channel';
    const from = getString(record.from);
    const message = asRecord(record.message);
    const messageType = getString(message?.type);

    return {
      id: nextId(),
      type: 'runtime',
      label: 'Channel',
      title: `Task channel activity on ${channelId}`,
      body: buildBodyLines([
        from ? `From ${from.slice(0, 10)}.` : null,
        messageType ? `Message type ${messageType}.` : null,
      ]) || 'A structured agent-to-agent channel message was observed.',
      color: '#5CB8FF',
      ts,
      sessionId: null,
      sticky: false,
      toastVisible: false,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'communication',
      dedupeKey: `channel:${channelId}`,
    };
  }

  if (topic === 'pheromone.deposited') {
    const pheromoneType = getString(record.canonicalType) ?? getString(record.type) ?? 'trail';
    const scope = getString(record.scope) ?? 'global';
    const emitterId = getString(record.emitterId);
    const intensity = getNumber(record.intensity);

    return {
      id: nextId(),
      type: 'runtime',
      label: 'Signal Field',
      title: `Pheromone deposited (${pheromoneType})`,
      body: buildBodyLines([
        `Scope ${scope}.`,
        emitterId ? `Emitter ${emitterId.slice(0, 10)}.` : null,
        intensity !== null ? `Intensity ${Math.round(intensity * 100)}%.` : null,
      ]) || 'A passive pheromone trail was written into the field.',
      color: '#8B5CF6',
      ts,
      sessionId: null,
      sticky: false,
      toastVisible: false,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'communication',
      dedupeKey: `pheromone:${pheromoneType}:${scope}`,
    };
  }

  if (topic === 'stigmergy.updated') {
    const key = getString(record.key);
    const scope = getString(record.scope) ?? 'global';
    const agentId = getString(record.agentId);

    return {
      id: nextId(),
      type: 'runtime',
      label: 'Stigmergy',
      title: 'Shared board updated',
      body: buildBodyLines([
        key ? `Key ${key}.` : null,
        `Scope ${scope}.`,
        agentId ? `Agent ${agentId.slice(0, 10)}.` : null,
      ]) || 'A stigmergic board update is now visible in the shared environment.',
      color: '#35D399',
      ts,
      sessionId: null,
      sticky: false,
      toastVisible: false,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'communication',
      dedupeKey: key ? `stigmergy:${scope}:${key}` : `stigmergy:${scope}`,
    };
  }

  if (topic === 'reputation.updated') {
    const agentId = getString(record.agentId) ?? 'unknown agent';
    const action = getString(record.action) ?? 'updated';
    const score = asRecord(record.score);
    const ratio = getNumber(score?.ratio);
    const net = getNumber(score?.net);
    const total = getNumber(score?.total);

    return {
      id: nextId(),
      type: 'runtime',
      label: 'Reputation',
      title: `Reputation ${action} for ${agentId.slice(0, 10)}`,
      body: buildBodyLines([
        ratio !== null ? `Trust ratio ${Math.round(ratio * 100)}%.` : null,
        net !== null ? `Net ${net}.` : null,
        total !== null ? `Observations ${total}.` : null,
      ]) || 'Social feedback updated the agent reputation ledger.',
      color: '#35D399',
      ts,
      sessionId: null,
      sticky: false,
      toastVisible: false,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'adaptation',
      dedupeKey: `reputation:${agentId}`,
    };
  }

  if (topic === 'contract.cfp.issued') {
    const task = asRecord(record.task);
    const taskLabel = getString(task?.summary)
      ?? getString(task?.name)
      ?? getString(task?.taskId)
      ?? getString(task?.id)
      ?? 'unnamed task';
    const roles = getStringArray(record.candidateRoles);

    return {
      id: nextId(),
      type: 'runtime',
      label: 'ContractNet',
      title: 'Call for proposals issued',
      body: buildBodyLines([
        `${taskLabel}.`,
        roles.length > 0 ? `${roles.length} candidate role(s): ${roles.join(', ')}.` : null,
      ]),
      color: '#F5A623',
      ts,
      sessionId: null,
      sticky: false,
      toastVisible: true,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'pipeline',
      dedupeKey: `contract-cfp:${taskLabel}`,
    };
  }

  if (topic === 'contract.awarded') {
    const winner = asRecord(record.winner);
    const roleId = getString(winner?.roleId) ?? 'unknown role';
    const modelId = getString(winner?.modelId)
      ?? getString(winner?.preferredModel)
      ?? getString(winner?.model)
      ?? null;
    const cost = getString(winner?.cost);
    const speed = getNumber(winner?.speedEstimate);
    const score = getNumber(record.score);
    const reason = getString(record.reason);

    return {
      id: nextId(),
      type: 'runtime',
      label: 'ContractNet',
      title: modelId ? `Contract awarded to ${roleId} via ${modelId}` : `Contract awarded to ${roleId}`,
      body: buildBodyLines([
        score !== null ? `Score ${score.toFixed(3)}.` : null,
        cost ? `Cost tier ${cost}.` : null,
        speed !== null ? `Speed estimate ${Math.round(speed * 100)}%.` : null,
        reason,
      ]) || 'The scheduler selected a winning bid.',
      color: '#35D399',
      ts,
      sessionId: null,
      sticky: false,
      toastVisible: true,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'pipeline',
      dedupeKey: null,
    };
  }

  if (topic === 'quality.audit.completed' || topic === 'auto.quality.gate') {
    const agentId = getString(record.agentId);
    const grade = getString(record.grade) ?? 'unknown';
    const score = getNumber(record.qualityScore);

    return {
      id: nextId(),
      type: 'runtime',
      label: 'Auto Hook',
      title: `Quality gate completed (${grade})`,
      body: buildBodyLines([
        agentId ? `Agent ${agentId.slice(0, 10)}.` : null,
        score !== null ? `Score ${score.toFixed(2)}.` : null,
      ]) || 'Quality telemetry completed a post-output audit.',
      color: '#5CB8FF',
      ts,
      sessionId: null,
      sticky: false,
      toastVisible: true,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'control',
      dedupeKey: agentId ? `quality-audit:${agentId}` : 'quality-audit',
    };
  }

  if (topic === 'shapley.computed' || topic === 'auto.shapley.credit') {
    const dagId = getString(record.dagId) ?? 'unknown';
    const totalValue = getNumber(record.totalValue);
    const values = asRecord(record.values);
    const topContributor = values
      ? Object.entries(values)
          .filter(([, value]) => typeof value === 'number')
          .sort((a, b) => (b[1] as number) - (a[1] as number))[0]
      : null;

    return {
      id: nextId(),
      type: 'runtime',
      label: 'Auto Hook',
      title: `Shapley credit computed for ${dagId}`,
      body: buildBodyLines([
        topContributor ? `Top contributor ${topContributor[0].slice(0, 10)}.` : null,
        totalValue !== null ? `Total value ${totalValue.toFixed(2)}.` : null,
      ]) || 'Contribution credit has been attributed to the finished DAG.',
      color: '#35D399',
      ts,
      sessionId: null,
      sticky: false,
      toastVisible: true,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'adaptation',
      dedupeKey: `shapley:${dagId}`,
    };
  }

  if (topic === 'memory.episode.recorded') {
    const episodeId = getString(record.episodeId);
    const taskId = getString(record.taskId);
    const role = getString(record.role);

    return {
      id: nextId(),
      type: 'runtime',
      label: 'Memory',
      title: 'Episode recorded',
      body: buildBodyLines([
        episodeId ? `Episode ${episodeId.slice(0, 10)}.` : null,
        taskId ? `Task ${taskId.slice(0, 10)}.` : null,
        role ? `Role ${role}.` : null,
      ]) || 'Episodic memory stored a new task execution trace.',
      color: '#8B5CF6',
      ts,
      sessionId: null,
      sticky: false,
      toastVisible: true,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'cognition',
      dedupeKey: episodeId ? `memory:${episodeId}` : null,
    };
  }

  if (topic === 'replan.strategy.selected') {
    const strategy = asRecord(record.strategy);
    const strategyKey = getString(record.strategyKey) ?? 'unknown';
    const strategyName = getString(strategy?.name) ?? strategyKey;
    const dagId = getString(record.dagId);
    const nodeId = getString(record.nodeId);
    const reason = getString(record.reason);
    const isAbort = strategyKey === 'ABORT_WITH_REPORT';

    return {
      id: nextId(),
      type: isAbort ? 'alert' : 'runtime',
      label: isAbort ? 'Recovery Alert' : 'Recovery Plan',
      title: `Recovery strategy: ${strategyName}`,
      body: buildBodyLines([
        dagId ? `DAG ${dagId}.` : null,
        nodeId ? `Node ${nodeId}.` : null,
        reason,
      ]) || 'The replan engine selected a recovery strategy.',
      color: isAbort ? '#EF4444' : '#F59E0B',
      ts,
      sessionId: null,
      sticky: isAbort,
      toastVisible: true,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'control',
      dedupeKey: dagId && nodeId ? `replan:${dagId}:${nodeId}` : null,
    };
  }

  if (topic === 'budget.warning' || topic === 'budget.exceeded') {
    const dagId = getString(record.dagId) ?? 'unknown';
    const utilization = getNumber(record.utilization);
    const spent = getNumber(record.spent);
    const totalBudget = getNumber(record.totalBudget);
    const exceeded = topic === 'budget.exceeded';

    return {
      id: nextId(),
      type: 'alert',
      label: exceeded ? 'Budget Exceeded' : 'Budget Warning',
      title: exceeded ? `Budget exceeded on ${dagId}` : `Budget pressure on ${dagId}`,
      body: buildBodyLines([
        `${formatPercent(utilization)} used.`,
        spent !== null && totalBudget !== null ? `${Math.round(spent)} / ${Math.round(totalBudget)} tokens spent.` : null,
      ]) || 'Budget telemetry crossed an operator threshold.',
      color: exceeded ? '#EF4444' : '#F59E0B',
      ts,
      sessionId: null,
      sticky: true,
      toastVisible: true,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'adaptation',
      dedupeKey: `budget:${dagId}`,
    };
  }

  if (topic === 'quality.breaker.tripped') {
    const toolName = getString(record.toolName) ?? 'unknown tool';
    const reason = getString(record.reason);

    return {
      id: nextId(),
      type: 'alert',
      label: 'Guardrail',
      title: `Circuit breaker tripped on ${toolName}`,
      body: reason ?? 'The tool resilience layer blocked execution because the breaker is open.',
      color: '#EF4444',
      ts,
      sessionId: null,
      sticky: true,
      toastVisible: true,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'control',
      dedupeKey: `breaker:${toolName}`,
    };
  }

  if (topic === 'quality.anomaly.detected') {
    const agentId = getString(record.agentId);
    const worst = asRecord(record.worst);
    const anomalyType = getString(worst?.type) ?? getString(record.type) ?? 'unknown anomaly';
    const description = getString(worst?.description) ?? getString(record.error);
    const confidence = getNumber(worst?.confidence);

    return {
      id: nextId(),
      type: 'alert',
      label: 'Anomaly',
      title: `Behavioral anomaly: ${anomalyType}`,
      body: buildBodyLines([
        agentId ? `Agent ${agentId.slice(0, 10)}.` : null,
        description,
        confidence !== null ? `Confidence ${Math.round(confidence * 100)}%.` : null,
      ]) || 'The anomaly detector flagged an execution pattern as risky.',
      color: '#F97316',
      ts,
      sessionId: null,
      sticky: false,
      toastVisible: true,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'control',
      dedupeKey: agentId ? `anomaly:${agentId}:${anomalyType}` : `anomaly:${anomalyType}`,
    };
  }

  if (topic === 'quality.pipeline.broken') {
    const dagId = getString(record.dagId) ?? 'unknown';
    const reason = getString(record.reason);
    const elapsed = getNumber(record.elapsed);
    const budget = getNumber(record.budget);

    return {
      id: nextId(),
      type: 'alert',
      label: 'Pipeline Breaker',
      title: `Pipeline broken for ${dagId}`,
      body: buildBodyLines([
        reason ? `Reason: ${reason}.` : null,
        elapsed !== null ? `Elapsed ${Math.round(elapsed)} ms.` : null,
        budget !== null ? `Budget ${Math.round(budget)} ms.` : null,
      ]) || 'The runtime breaker interrupted a DAG pipeline.',
      color: '#EF4444',
      ts,
      sessionId: null,
      sticky: true,
      toastVisible: true,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'control',
      dedupeKey: `pipeline:${dagId}`,
    };
  }

  if (topic === 'quality.compliance.violation') {
    const sessionId = getString(record.sessionId);
    const escalationLevel = getNumber(record.escalationLevel);
    const violations = Array.isArray(record.violations)
      ? record.violations
          .map((entry) => {
            const violation = asRecord(entry);
            return getString(violation?.message) ?? getString(violation?.id);
          })
          .filter((entry): entry is string => Boolean(entry))
      : [];

    return {
      id: nextId(),
      type: 'alert',
      label: 'Compliance',
      title: 'Compliance violation detected',
      body: buildBodyLines([
        sessionId ? `Session ${sessionId.slice(0, 10)}.` : null,
        escalationLevel !== null ? `Escalation level ${escalationLevel}.` : null,
        violations.length > 0 ? `Signals: ${violations.join(', ')}.` : null,
      ]) || 'The compliance monitor raised a violation.',
      color: escalationLevel !== null && escalationLevel >= 2 ? '#EF4444' : '#F97316',
      ts,
      sessionId,
      sticky: (escalationLevel ?? 0) >= 2,
      toastVisible: true,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'control',
      dedupeKey: sessionId ? `compliance:${sessionId}` : 'compliance',
    };
  }

  if (topic === 'quality.compliance.terminated') {
    const sessionId = getString(record.sessionId);
    const totalViolations = getNumber(record.totalViolations);

    return {
      id: nextId(),
      type: 'alert',
      label: 'Compliance',
      title: 'Session terminated by compliance guardrails',
      body: buildBodyLines([
        sessionId ? `Session ${sessionId.slice(0, 10)}.` : null,
        totalViolations !== null ? `${Math.round(totalViolations)} violation(s) recorded.` : null,
      ]) || 'Compliance guardrails terminated a session.',
      color: '#EF4444',
      ts,
      sessionId,
      sticky: true,
      toastVisible: true,
      choices: [],
      clarificationQuestions: [],
      sourceTopic: topic,
      targetView: 'control',
      dedupeKey: sessionId ? `compliance-terminated:${sessionId}` : 'compliance-terminated',
    };
  }

  return null;
}

function trimItems(items: OperatorFeedItem[]) {
  return items.slice(0, MAX_ITEMS);
}

function upsertByDedupeKey(items: OperatorFeedItem[], nextItem: OperatorFeedItem) {
  if (!nextItem.dedupeKey) {
    return trimItems([nextItem, ...items]);
  }

  const existing = items.find((item) => item.dedupeKey === nextItem.dedupeKey);
  if (!existing) {
    return trimItems([nextItem, ...items]);
  }

  const updated = items
    .filter((item) => item.id !== existing.id)
    .map((item) => item);

  return trimItems([{ ...nextItem, id: existing.id }, ...updated]);
}

export const useOperatorFeedStore = create<OperatorFeedState>((set) => ({
  items: [],

  ingestBridgeNotification: (payload, topic = 'user.notification') => {
    const nextItem = buildBridgeItem(payload, topic);
    if (!nextItem) {
      return;
    }

    set((state) => ({
      items: upsertByDedupeKey(state.items, nextItem),
    }));
  },

  ingestAgentEvent: (event) => {
    set((state) => ({
      items: trimItems([buildAgentItem(event), ...state.items]),
    }));
  },

  ingestRuntimeEvent: (topic, payload) => {
    const nextItem = buildRuntimeItem(topic, payload);
    if (!nextItem) {
      return;
    }

    set((state) => ({
      items: upsertByDedupeKey(state.items, nextItem),
    }));
  },

  hideToast: (id) => {
    set((state) => ({
      items: state.items.map((item) => (
        item.id === id
          ? { ...item, toastVisible: false }
          : item
      )),
    }));
  },

  dismiss: (id) => {
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
    }));
  },
}));
