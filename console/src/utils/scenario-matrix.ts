import type { WorldSnapshot } from '../api/ws-bridge';
import type { OperatorFeedItem } from '../stores/operator-feed-store';
import type { ViewId } from '../stores/view-store';

export type ScenarioRoundState = 'live' | 'ready' | 'gap' | 'offline';

export interface ScenarioRound {
  id: string;
  roundLabel: string;
  title: string;
  detail: string;
  state: ScenarioRoundState;
  view: ViewId;
  evidenceTs: number | null;
}

export interface ScenarioDay {
  id: string;
  label: string;
  subtitle: string;
  view: ViewId;
  rounds: ScenarioRound[];
}

export interface ScenarioMatrixSummary {
  totalRounds: number;
  liveCount: number;
  readyCount: number;
  gapCount: number;
  offlineCount: number;
  verifiedScore: number;
}

export const ORIGINAL_SCENARIO_BASELINE = {
  days: 4,
  rounds: 15,
  scenarioCards: 16,
  checks: 58,
} as const;

function latestByTopics(items: OperatorFeedItem[], topics: string[]) {
  return items.find((item) => topics.includes(item.sourceTopic)) ?? null;
}

function countState(rounds: ScenarioRound[], state: ScenarioRoundState) {
  return rounds.filter((round) => round.state === state).length;
}

function collectPreferredModels(snapshot: WorldSnapshot | null) {
  const seen = new Set<string>();
  for (const entry of snapshot?.adaptation?.species?.population ?? []) {
    if (entry.preferredModel) {
      seen.add(entry.preferredModel);
    }
  }
  return seen;
}

function buildRound(
  id: string,
  roundLabel: string,
  title: string,
  state: ScenarioRoundState,
  detail: string,
  view: ViewId,
  evidenceTs: number | null = null,
): ScenarioRound {
  return {
    id,
    roundLabel,
    title,
    state,
    detail,
    view,
    evidenceTs,
  };
}

export function buildScenarioMatrix(
  snapshot: WorldSnapshot | null,
  operatorItems: OperatorFeedItem[],
  connected: boolean,
): ScenarioDay[] {
  const system = snapshot?.system;
  const workflow = system?.workflow;
  const behavior = system?.behavior;
  const adaptation = snapshot?.adaptation;
  const tasks = snapshot?.tasks ?? [];

  const contractCfp = latestByTopics(operatorItems, ['contract.cfp.issued']);
  const contractAward = latestByTopics(operatorItems, ['contract.awarded']);
  const progressSeen = operatorItems.find((item) => item.type === 'progress' || item.sourceTopic === 'workflow.phase.changed') ?? null;
  const completionSeen = operatorItems.find((item) => item.type === 'complete') ?? null;
  const clarificationSeen = operatorItems.find((item) => item.type === 'choice') ?? null;
  const blockedSeen = operatorItems.find((item) => item.type === 'blocked') ?? null;
  const qualityHook = latestByTopics(operatorItems, ['quality.audit.completed', 'auto.quality.gate']);
  const shapleyHook = latestByTopics(operatorItems, ['shapley.computed', 'auto.shapley.credit']);
  const memoryHook = latestByTopics(operatorItems, ['memory.episode.recorded']);
  const signalHook = latestByTopics(operatorItems, ['pheromone.deposited', 'stigmergy.updated', 'channel.message']);
  const reputationHook = latestByTopics(operatorItems, ['reputation.updated']);
  const recoverySignal = latestByTopics(operatorItems, [
    'replan.strategy.selected',
    'quality.pipeline.broken',
    'quality.breaker.tripped',
    'quality.anomaly.detected',
  ]);
  const budgetSignal = latestByTopics(operatorItems, ['budget.warning', 'budget.exceeded']);
  const complianceSignal = latestByTopics(operatorItems, ['quality.compliance.violation', 'quality.compliance.terminated']);

  const hasDependencyGraph = tasks.some((task) => (task.dependencies?.length ?? 0) > 0);
  const hasParallelWork = (workflow?.stageCounts.activeTasks ?? 0) > 1 || tasks.length > 1;
  const hasCancelledTask = tasks.some((task) => task.status.toUpperCase() === 'CANCELLED');
  const canSeeSwarmState = Boolean(
    (snapshot?.agents?.length ?? 0) > 0
    && (snapshot?.pheromones?.length ?? 0) > 0
    && system?.behavior
    && adaptation,
  );
  const preferredModels = collectPreferredModels(snapshot);
  const hasMultiplePreferredModels = preferredModels.size > 1;
  const awardMentionsModel = Boolean(contractAward?.title.includes(' via '));
  const skillHintsVisible = (adaptation?.skillGovernor?.topSkills?.length ?? 0) > 0;
  const budgetTelemetryVisible = Boolean(budgetSignal || behavior?.budget || adaptation?.budgetForecast?.historyCount);
  const resilienceTelemetryVisible = Boolean(recoverySignal || behavior?.resilience || adaptation?.resilience);
  const immuneTelemetryVisible = Boolean((behavior?.resilience?.antigenCount ?? 0) > 0);
  const routeLearningVisible = Boolean(reputationHook && signalHook);

  const day0Rounds: ScenarioRound[] = [
    buildRound(
      'day0-console-boot',
      'Day 0',
      'Install + live console boot',
      !connected
        ? 'offline'
        : system?.architecture?.bridgeReady && (snapshot?.agents?.length ?? 0) > 0
          ? 'live'
          : 'ready',
      system?.architecture?.bridgeReady
        ? `${system.architecture.domains.active}/${system.architecture.domains.total} domains online, ${snapshot?.agents?.length ?? 0} agent(s) rendered, mode ${snapshot?.mode ?? 'unknown'}.`
        : 'Transport or architecture telemetry is still incomplete for the Day 0 boot checklist.',
      'system',
      snapshot?.ts ?? null,
    ),
  ];

  const day1Rounds: ScenarioRound[] = [
    buildRound(
      'round1-casual-downgrade',
      'Round 1',
      'Casual chat downgrades to direct reply',
      !connected
        ? 'offline'
        : workflow?.phase.toLowerCase() === 'direct reply'
          ? 'live'
          : 'gap',
      workflow?.phase.toLowerCase() === 'direct reply'
        ? 'A direct-reply phase is visible without swarm execution.'
        : 'The original design expects explicit direct-reply evidence, but the runtime still lacks a dedicated operator-facing event for this path.',
      'system',
      snapshot?.ts ?? null,
    ),
    buildRound(
      'round2-simple-task',
      'Round 2',
      'Simple task end-to-end chain',
      !connected
        ? 'offline'
        : contractCfp && contractAward && completionSeen && qualityHook && shapleyHook && memoryHook && signalHook
          ? 'live'
          : contractCfp || contractAward || completionSeen || progressSeen
            ? 'ready'
            : 'gap',
      contractCfp && contractAward && completionSeen && qualityHook && shapleyHook && memoryHook && signalHook
        ? 'ContractNet, progress, completion, quality, Shapley, memory, and passive trail evidence all landed in one chain.'
        : contractCfp || contractAward || completionSeen || progressSeen
          ? 'The chain has started, but one or more auto hooks are still missing from the visible operator evidence.'
          : 'The baseline simple-task chain has not been exercised in this session yet.',
      'pipeline',
      completionSeen?.ts ?? qualityHook?.ts ?? contractAward?.ts ?? contractCfp?.ts ?? null,
    ),
    buildRound(
      'round3-context-carryover',
      'Round 3',
      'Context continuation from prior work',
      !connected
        ? 'offline'
        : memoryHook && signalHook
          ? 'ready'
          : 'gap',
      memoryHook && signalHook
        ? 'Memory and passive communication are live, but the operator still cannot directly see the injected upstream-finding prompt payload.'
        : 'The original design calls for visible upstream-finding reuse; current telemetry still does not prove that prompt carryover end to end.',
      'cognition',
      memoryHook?.ts ?? signalHook?.ts ?? null,
    ),
    buildRound(
      'round4-dag-cascade',
      'Round 4',
      'Multi-phase DAG cascade',
      !connected
        ? 'offline'
        : hasDependencyGraph && hasParallelWork && contractAward && (completionSeen || budgetSignal || recoverySignal)
          ? 'live'
          : hasDependencyGraph || hasParallelWork || workflow
            ? 'ready'
            : 'gap',
      hasDependencyGraph && hasParallelWork && contractAward && (completionSeen || budgetSignal || recoverySignal)
        ? 'Dependency graph, parallel work, and downstream cascade evidence are all visible in the runtime.'
        : hasDependencyGraph || hasParallelWork || workflow
          ? 'The DAG substrate is present, but this session has not yet produced a clean cascade proof with downstream completion.'
          : 'No dependency-driven cascade evidence is visible yet.',
      'pipeline',
      completionSeen?.ts ?? budgetSignal?.ts ?? recoverySignal?.ts ?? contractAward?.ts ?? null,
    ),
    buildRound(
      'round5-cancel',
      'Round 5',
      'Cancellation propagates through active work',
      !connected
        ? 'offline'
        : hasCancelledTask
          ? 'live'
          : 'gap',
      hasCancelledTask
        ? 'A cancelled task is visible in the live DAG.'
        : 'The original walkthrough expects DAG cancellation evidence, but no operator-visible cancel event or cancelled DAG node has surfaced yet.',
      'pipeline',
      hasCancelledTask ? snapshot?.ts ?? null : null,
    ),
    buildRound(
      'round6-isolation',
      'Round 6',
      'Isolation and tools.deny guardrails',
      !connected
        ? 'offline'
        : blockedSeen && complianceSignal
          ? 'ready'
          : 'gap',
      blockedSeen && complianceSignal
        ? 'The runtime can surface blocked work and compliance pressure, but the specific exec/session deny path is still not separately evidenced to the operator.'
        : 'The original design expects visible deny-path interceptions for forbidden tools and sessions; that proof is still missing from operator telemetry.',
      'control',
      blockedSeen?.ts ?? complianceSignal?.ts ?? null,
    ),
    buildRound(
      'round7-swarm-query',
      'Round 7',
      'Swarm state awareness on demand',
      !connected
        ? 'offline'
        : canSeeSwarmState
          ? 'live'
          : 'ready',
      canSeeSwarmState
        ? `${snapshot?.agents?.length ?? 0} agents, ${snapshot?.pheromones?.length ?? 0} pheromones, ${snapshot?.channels?.length ?? 0} channels, and adaptation telemetry are all queryable from the live snapshot.`
        : 'Some live state is visible, but the full query picture is not yet present in one place.',
      'system',
      snapshot?.ts ?? null,
    ),
  ];

  const day2Rounds: ScenarioRound[] = [
    buildRound(
      'round8-learning-effect',
      'Round 8',
      'Learning changes routing behavior',
      !connected
        ? 'offline'
        : routeLearningVisible && contractAward
          ? 'live'
          : routeLearningVisible || Boolean(adaptation?.modulator?.modeChanges)
            ? 'ready'
            : 'gap',
      routeLearningVisible && contractAward
        ? 'Reputation, passive trails, and fresh contract awards are all visible in one feedback loop.'
        : routeLearningVisible || Boolean(adaptation?.modulator?.modeChanges)
          ? 'Learning signals exist, but the operator cannot yet compare before/after award bias as a single narrative.'
          : 'No operator-visible learning loop has surfaced yet.',
      'adaptation',
      reputationHook?.ts ?? signalHook?.ts ?? contractAward?.ts ?? null,
    ),
    buildRound(
      'round9-task-routing',
      'Round 9',
      'Different task types drive different routing choices',
      !connected
        ? 'offline'
        : skillHintsVisible && awardMentionsModel
          ? 'live'
          : skillHintsVisible || hasMultiplePreferredModels
            ? 'ready'
            : 'gap',
      skillHintsVisible && awardMentionsModel
        ? 'Skill governor hints and model-aware contract awards are both visible to the operator.'
        : skillHintsVisible || hasMultiplePreferredModels
          ? 'Routing substrate is visible, but we still need a clean side-by-side task-type contrast run to sign this off.'
          : 'The original design expects task-type routing to be legible; current operator telemetry still does not make that contrast explicit.',
      'adaptation',
      contractAward?.ts ?? snapshot?.ts ?? null,
    ),
    buildRound(
      'round10-failure-recovery',
      'Round 10',
      'Failure and graceful recovery',
      !connected
        ? 'offline'
        : recoverySignal && resilienceTelemetryVisible
          ? 'live'
          : resilienceTelemetryVisible
            ? 'ready'
            : 'gap',
      recoverySignal && resilienceTelemetryVisible
        ? 'Recovery, breaker, or anomaly evidence is now visible as an operator-facing timeline item.'
        : resilienceTelemetryVisible
          ? 'Resilience metrics exist, but this session has not yet produced a clean live failure-and-recovery walkthrough.'
          : 'No recovery evidence is visible yet.',
      'control',
      recoverySignal?.ts ?? snapshot?.ts ?? null,
    ),
    buildRound(
      'round11-model-selection',
      'Round 11',
      'Cheap vs strong model choice is operator-visible',
      !connected
        ? 'offline'
        : awardMentionsModel && hasMultiplePreferredModels
          ? 'live'
          : hasMultiplePreferredModels || skillHintsVisible
            ? 'ready'
            : 'gap',
      awardMentionsModel && hasMultiplePreferredModels
        ? `Model-aware contract awards are visible, and the species population currently spans ${preferredModels.size} preferred models.`
        : hasMultiplePreferredModels || skillHintsVisible
          ? 'Multiple model preferences are present, but the operator still needs paired live runs to prove cheap-vs-strong routing against the original checklist.'
          : 'The original design expects explicit model-choice contrast, but current operator evidence is still too thin.',
      'adaptation',
      contractAward?.ts ?? snapshot?.ts ?? null,
    ),
  ];

  const day3Rounds: ScenarioRound[] = [
    buildRound(
      'round12-speculation',
      'Round 12',
      'Speculative execution',
      !connected ? 'offline' : 'gap',
      'The original Day 3 design expects parallel speculative branches, but no live speculative runtime evidence or operator telemetry exists yet.',
      'pipeline',
      null,
    ),
    buildRound(
      'round13-negotiation',
      'Round 13',
      'Cross-model negotiation and conflict resolution',
      !connected ? 'offline' : 'gap',
      'The design calls for negotiation visibility, but there is still no operator-facing runtime event proving model-to-model arbitration.',
      'communication',
      null,
    ),
    buildRound(
      'round14-immune',
      'Round 14',
      'Negative selection / immune interception',
      !connected
        ? 'offline'
        : immuneTelemetryVisible
          ? 'ready'
          : 'gap',
      immuneTelemetryVisible
        ? 'Failure-vaccination telemetry exists, but we still need a real live intercept event to prove negative selection behavior.'
        : 'The immune interception path is still missing visible runtime proof.',
      'control',
      snapshot?.ts ?? null,
    ),
    buildRound(
      'round15-dream',
      'Round 15',
      'Dream consolidation and offline learning',
      !connected ? 'offline' : 'gap',
      'The design expects a dream-consolidation event and semantic promotion proof, but that evidence is not yet exposed in the live runtime.',
      'cognition',
      null,
    ),
  ];

  return [
    {
      id: 'day-0',
      label: 'Day 0',
      subtitle: 'Install validation and first live console boot',
      view: 'system',
      rounds: day0Rounds,
    },
    {
      id: 'day-1',
      label: 'Day 1',
      subtitle: 'First task chain, DAGs, cancellation, and state query',
      view: 'pipeline',
      rounds: day1Rounds,
    },
    {
      id: 'day-2',
      label: 'Day 2',
      subtitle: 'Learning effects, task-type routing, failure handling, and model choice',
      view: 'adaptation',
      rounds: day2Rounds,
    },
    {
      id: 'day-3',
      label: 'Day 3',
      subtitle: 'Speculation, negotiation, immune response, and dream consolidation',
      view: 'control',
      rounds: day3Rounds,
    },
  ];
}

export function summarizeScenarioMatrix(days: ScenarioDay[]): ScenarioMatrixSummary {
  const rounds = days.flatMap((day) => day.rounds);
  const totalRounds = rounds.length;
  const liveCount = countState(rounds, 'live');
  const readyCount = countState(rounds, 'ready');
  const gapCount = countState(rounds, 'gap');
  const offlineCount = countState(rounds, 'offline');

  return {
    totalRounds,
    liveCount,
    readyCount,
    gapCount,
    offlineCount,
    verifiedScore: totalRounds > 0 ? Math.round((liveCount / totalRounds) * 100) : 0,
  };
}
