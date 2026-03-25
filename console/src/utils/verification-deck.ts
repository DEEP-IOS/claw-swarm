import type { WorldSnapshot } from '../api/ws-bridge';
import type { OperatorFeedItem } from '../stores/operator-feed-store';
import type { ViewId } from '../stores/view-store';

export type VerificationPromiseState = 'live' | 'ready' | 'attention' | 'offline';

export interface VerificationPromiseItem {
  id: string;
  title: string;
  detail: string;
  state: VerificationPromiseState;
  evidenceTs: number | null;
  view: ViewId;
}

export interface VerificationPromiseStage {
  id: string;
  label: string;
  summary: string;
  view: ViewId;
  items: VerificationPromiseItem[];
}

export interface VerificationDeckSummary {
  total: number;
  provenCount: number;
  readyCount: number;
  attentionCount: number;
  offlineCount: number;
  score: number;
}

function formatAge(ts: number | null) {
  if (!ts) return 'waiting';

  const delta = Math.max(0, Date.now() - ts);
  if (delta < 1_000) return 'now';
  if (delta < 60_000) return `${Math.round(delta / 1_000)}s ago`;
  return `${Math.round(delta / 60_000)}m ago`;
}

function latestByTopics(items: OperatorFeedItem[], topics: string[]) {
  return items.find((item) => topics.includes(item.sourceTopic)) ?? null;
}

function buildItem(
  id: string,
  title: string,
  state: VerificationPromiseState,
  detail: string,
  view: ViewId,
  evidenceTs: number | null = null,
): VerificationPromiseItem {
  return { id, title, state, detail, view, evidenceTs };
}

function countState(items: VerificationPromiseItem[], state: VerificationPromiseState) {
  return items.filter((item) => item.state === state).length;
}

export function buildVerificationDeck(
  snapshot: WorldSnapshot | null,
  operatorItems: OperatorFeedItem[],
  connected: boolean,
): VerificationPromiseStage[] {
  const system = snapshot?.system;
  const workflow = system?.workflow;
  const behavior = system?.behavior;
  const metrics = snapshot?.metrics;
  const adaptation = snapshot?.adaptation;

  const qualityHook = latestByTopics(operatorItems, ['quality.audit.completed', 'auto.quality.gate']);
  const shapleyHook = latestByTopics(operatorItems, ['shapley.computed', 'auto.shapley.credit']);
  const memoryHook = latestByTopics(operatorItems, ['memory.episode.recorded']);
  const signalHook = latestByTopics(operatorItems, ['pheromone.deposited', 'stigmergy.updated', 'channel.message']);
  const reputationHook = latestByTopics(operatorItems, ['reputation.updated']);
  const contractCfp = latestByTopics(operatorItems, ['contract.cfp.issued']);
  const contractAward = latestByTopics(operatorItems, ['contract.awarded']);
  const recoverySignal = latestByTopics(operatorItems, ['replan.strategy.selected', 'quality.pipeline.broken']);
  const budgetSignal = latestByTopics(operatorItems, ['budget.warning', 'budget.exceeded']);
  const complianceSignal = latestByTopics(operatorItems, ['quality.compliance.violation', 'quality.compliance.terminated']);

  const clarificationSeen = operatorItems.find((item) => item.type === 'choice') ?? null;
  const progressSeen = operatorItems.find((item) => item.type === 'progress' || item.sourceTopic === 'workflow.phase.changed') ?? null;
  const completionSeen = operatorItems.find((item) => item.type === 'complete') ?? null;

  const architecture = system?.architecture;
  const communication = behavior?.communication;
  const resilience = behavior?.resilience;
  const compliance = behavior?.compliance;
  const budget = behavior?.budget;

  const signalFieldVisible = Boolean(
    (snapshot?.pheromones?.length ?? 0) > 0
    || (communication?.activeTypes.length ?? 0) > 0
    || (communication?.channelCount ?? 0) > 0,
  );

  const day0Items: VerificationPromiseItem[] = [
    buildItem(
      'transport',
      'Live transport + bridge',
      !connected
        ? 'offline'
        : architecture?.bridgeReady
          ? 'live'
          : 'attention',
      architecture
        ? `${architecture.toolCount} tools exposed, ${architecture.domains.active}/${architecture.domains.total} domains online.`
        : 'Waiting for architecture telemetry from the backend bridge.',
      'system',
    ),
    buildItem(
      'workflow-ledger',
      'Native workflow phase',
      !connected
        ? 'offline'
        : workflow?.phaseSource === 'runtime'
          ? 'live'
          : workflow
            ? 'attention'
            : 'ready',
      workflow?.phaseSource === 'runtime'
        ? `Workflow ledger is speaking directly: ${workflow.phase}.`
        : workflow
          ? `Workflow is still inferred as ${workflow.phase}; keep pushing for native evidence.`
          : 'No workflow telemetry yet.',
      'pipeline',
    ),
    buildItem(
      'field-signal',
      'Signal substrate visible',
      !connected
        ? 'offline'
        : signalHook || signalFieldVisible
          ? 'live'
          : 'ready',
      signalHook
        ? `${signalHook.title}. Runtime evidence landed ${formatAge(signalHook.ts)}.`
        : signalFieldVisible
        ? `${communication?.activeTypes.length ?? 0} signal types, ${communication?.channelCount ?? 0} channels, ${communication?.stigmergyEntries ?? 0} board notes.`
        : 'The field is wired, but this session has not left a visible passive trail yet.',
      'communication',
      signalHook?.ts ?? null,
    ),
  ];

  const contractVisible = Boolean(contractCfp && contractAward);
  const day1Items: VerificationPromiseItem[] = [
    buildItem(
      'clarification-loop',
      'Clarification loop',
      !connected
        ? 'offline'
        : clarificationSeen
          ? 'live'
          : 'ready',
      clarificationSeen
        ? `${clarificationSeen.title}. Last operator decision surfaced ${formatAge(clarificationSeen.ts)}.`
        : 'The bridge can request clarification, but this run has not exercised it yet.',
      'system',
      clarificationSeen?.ts ?? null,
    ),
    buildItem(
      'contract-net',
      'ContractNet bid and award',
      !connected
        ? 'offline'
        : contractVisible
          ? 'live'
          : contractCfp || contractAward
            ? 'attention'
            : 'ready',
      contractVisible
        ? `CFP and winning bid were both observed. Latest award ${formatAge(contractAward?.ts ?? null)}.`
        : contractCfp || contractAward
          ? 'Only one side of the ContractNet story is visible. Keep tracing the missing edge.'
          : 'No live ContractNet handoff has been observed in this session yet.',
      'pipeline',
      contractAward?.ts ?? contractCfp?.ts ?? null,
    ),
    buildItem(
      'progress-chain',
      'Progress and completion receipts',
      !connected
        ? 'offline'
        : completionSeen || (workflow?.stageCounts.completedTasks ?? 0) > 0
          ? 'live'
          : 'ready',
      completionSeen
        ? `${completionSeen.title}. Completion receipt landed ${formatAge(completionSeen.ts)}.`
        : progressSeen
          ? `Progress is flowing, but no completion receipt has landed yet. Last movement ${formatAge(progressSeen.ts)}.`
          : 'No first-task pulse has been recorded yet.',
      'pipeline',
      completionSeen?.ts ?? progressSeen?.ts ?? null,
    ),
  ];

  const qualityAudits = metrics?.quality?.gateEvaluations ?? 0;
  const day2Items: VerificationPromiseItem[] = [
    buildItem(
      'quality-hook',
      'Auto quality gate',
      !connected
        ? 'offline'
        : qualityHook || qualityAudits > 0
          ? 'live'
          : 'ready',
      qualityHook
        ? `${qualityHook.title}. Last audit ${formatAge(qualityHook.ts)}.`
        : qualityAudits > 0
          ? `${qualityAudits} quality audit(s) recorded in metrics, but no operator-facing runtime item was retained.`
          : 'Quality controller is wired, waiting for the first visible audit.',
      'control',
      qualityHook?.ts ?? null,
    ),
    buildItem(
      'shapley-hook',
      'Shapley credit attribution',
      !connected
        ? 'offline'
        : shapleyHook || (adaptation?.shapley?.dagCount ?? 0) > 0
          ? 'live'
          : 'ready',
      shapleyHook
        ? `${shapleyHook.title}. Credit update seen ${formatAge(shapleyHook.ts)}.`
        : (adaptation?.shapley?.dagCount ?? 0) > 0
          ? `${adaptation?.shapley?.dagCount ?? 0} DAG credit map(s) exist in adaptation telemetry.`
          : 'No Shapley credit event has surfaced yet.',
      'adaptation',
      shapleyHook?.ts ?? null,
    ),
    buildItem(
      'memory-hook',
      'Episode memory write',
      !connected
        ? 'offline'
        : memoryHook
          ? 'live'
          : 'ready',
      memoryHook
        ? `${memoryHook.title}. Memory write observed ${formatAge(memoryHook.ts)}.`
        : 'Episodic memory is wired, but this session has not yet produced a visible recorded episode.',
      'cognition',
      memoryHook?.ts ?? null,
    ),
    buildItem(
      'stigmergy-hook',
      'Passive trail and board updates',
      !connected
        ? 'offline'
        : signalHook || (communication?.stigmergyEntries ?? 0) > 0 || signalFieldVisible
          ? 'live'
          : 'ready',
      signalHook
        ? `${signalHook.title}. Passive communication evidence surfaced ${formatAge(signalHook.ts)}.`
        : signalFieldVisible
        ? `${communication?.stigmergyEntries ?? 0} board notes and ${behavior?.sensing?.pheromoneTrails ?? 0} pheromone trails are visible.`
        : 'Waiting for pheromone or stigmergic evidence from a real task run.',
      'communication',
      signalHook?.ts ?? null,
    ),
    buildItem(
      'reputation-loop',
      'Reputation feedback loop',
      !connected
        ? 'offline'
        : reputationHook
          ? 'live'
          : (adaptation?.shapley?.dagCount ?? 0) > 0
            ? 'attention'
            : 'ready',
      reputationHook
        ? `${reputationHook.title}. Social credit moved ${formatAge(reputationHook.ts)}.`
        : (adaptation?.shapley?.dagCount ?? 0) > 0
          ? 'Shapley credit exists, but operator-facing reputation evidence has not surfaced yet.'
          : 'Waiting for the first visible reputation adjustment from live execution.',
      'adaptation',
      reputationHook?.ts ?? null,
    ),
  ];

  const day3Items: VerificationPromiseItem[] = [
    buildItem(
      'budget-guardrail',
      'Budget guardrails',
      !connected
        ? 'offline'
        : budgetSignal || (budget?.dagCount ?? 0) > 0
          ? 'live'
          : budget
            ? 'ready'
            : 'offline',
      budgetSignal
        ? `${budgetSignal.title}. Latest budget alert ${formatAge(budgetSignal.ts)}.`
        : budget
          ? `${Math.round((budget.utilization ?? 0) * 100)}% utilization across ${budget.dagCount} tracked DAG(s).`
          : 'Budget telemetry is not available.',
      'adaptation',
      budgetSignal?.ts ?? null,
    ),
    buildItem(
      'recovery-lane',
      'Recovery and pipeline break handling',
      !connected
        ? 'offline'
        : recoverySignal || (resilience?.retryCount ?? 0) > 0 || (resilience?.pipelineBreaks ?? 0) > 0
          ? 'live'
          : resilience
            ? 'ready'
            : 'offline',
      recoverySignal
        ? `${recoverySignal.title}. Recovery evidence landed ${formatAge(recoverySignal.ts)}.`
        : resilience
          ? `${resilience.retryCount ?? 0} retries, ${resilience.breakerTrips ?? 0} breaker trips, ${resilience.pipelineBreaks ?? 0} pipeline breaks.`
          : 'Resilience telemetry is not available.',
      'control',
      recoverySignal?.ts ?? null,
    ),
    buildItem(
      'compliance-lane',
      'Compliance escalation path',
      !connected
        ? 'offline'
        : complianceSignal || (compliance?.totalViolations ?? 0) > 0
          ? 'live'
          : compliance
            ? 'ready'
            : 'offline',
      complianceSignal
        ? `${complianceSignal.title}. Last compliance evidence ${formatAge(complianceSignal.ts)}.`
        : compliance
          ? `${compliance.totalViolations ?? 0} violations, ${compliance.breakerOpenCount ?? 0} open breakers, health ${compliance.healthStatus}.`
          : 'Compliance telemetry is not available.',
      'control',
      complianceSignal?.ts ?? null,
    ),
  ];

  return [
    {
      id: 'day-0',
      label: 'Day 0',
      summary: 'Transport, ledger truth, and signal substrate',
      view: 'system',
      items: day0Items,
    },
    {
      id: 'day-1',
      label: 'Day 1',
      summary: 'First task chain from clarification to completion',
      view: 'pipeline',
      items: day1Items,
    },
    {
      id: 'day-2',
      label: 'Day 2',
      summary: 'Auto hooks that prove the ecosystem is self-writing evidence',
      view: 'communication',
      items: day2Items,
    },
    {
      id: 'day-3',
      label: 'Day 3',
      summary: 'Recovery, budget, and compliance under stress',
      view: 'control',
      items: day3Items,
    },
  ];
}

export function summarizeVerificationDeck(deck: VerificationPromiseStage[]): VerificationDeckSummary {
  const flatItems = deck.flatMap((stage) => stage.items);
  const total = flatItems.length;
  const provenCount = countState(flatItems, 'live');
  const readyCount = countState(flatItems, 'ready');
  const attentionCount = countState(flatItems, 'attention');
  const offlineCount = countState(flatItems, 'offline');

  return {
    total,
    provenCount,
    readyCount,
    attentionCount,
    offlineCount,
    score: total > 0 ? Math.round((provenCount / total) * 100) : 0,
  };
}
