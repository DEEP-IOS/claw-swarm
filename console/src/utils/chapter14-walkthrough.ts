import type { WorldSnapshot } from '../api/ws-bridge';
import type { OperatorFeedItem } from '../stores/operator-feed-store';
import type { ViewId } from '../stores/view-store';

export type WalkthroughStepState = 'live' | 'ready' | 'manual' | 'offline';

export interface WalkthroughStep {
  id: string;
  title: string;
  detail: string;
  view: ViewId;
  state: WalkthroughStepState;
  evidenceTs: number | null;
}

export interface WalkthroughSummary {
  prerequisiteCount: number;
  liveCount: number;
  readyCount: number;
  offlineCount: number;
  manualCount: number;
  readinessScore: number;
  canAttemptFinalSignoff: boolean;
  blockerTitles: string[];
}

function latestByTopics(items: OperatorFeedItem[], topics: string[]) {
  return items.find((item) => topics.includes(item.sourceTopic)) ?? null;
}

function countLive(steps: WalkthroughStep[]) {
  return steps.filter((step) => step.state === 'live').length;
}

export function buildChapter14Walkthrough(
  snapshot: WorldSnapshot | null,
  operatorItems: OperatorFeedItem[],
  connected: boolean,
): WalkthroughStep[] {
  const system = snapshot?.system;
  const workflow = system?.workflow;
  const behavior = system?.behavior;
  const adaptation = snapshot?.adaptation;

  const clarificationSeen = operatorItems.find((item) => item.type === 'choice') ?? null;
  const workflowSeen = latestByTopics(operatorItems, ['workflow.phase.changed', 'contract.cfp.issued', 'contract.awarded']);
  const completionSeen = operatorItems.find((item) => item.type === 'complete') ?? null;
  const signalSeen = latestByTopics(operatorItems, ['pheromone.deposited', 'stigmergy.updated', 'channel.message']);
  const reputationSeen = latestByTopics(operatorItems, ['reputation.updated']);
  const recoverySeen = latestByTopics(operatorItems, ['replan.strategy.selected', 'quality.pipeline.broken', 'quality.breaker.tripped', 'quality.anomaly.detected']);
  const budgetSeen = latestByTopics(operatorItems, ['budget.warning', 'budget.exceeded']);
  const complianceSeen = latestByTopics(operatorItems, ['quality.compliance.violation', 'quality.compliance.terminated']);

  const runtimeStep: WalkthroughStep = {
    id: 'runtime-coherence',
    title: 'Runtime starts as one coherent system',
    detail: !connected
      ? 'Console is offline.'
      : system?.architecture?.bridgeReady && workflow
        ? `${workflow.phase} phase visible with ${system.architecture.domains.active}/${system.architecture.domains.total} domains online.`
        : 'Bridge or workflow telemetry is still incomplete.',
    view: 'system',
    state: !connected
      ? 'offline'
      : system?.architecture?.bridgeReady && workflow
        ? 'live'
        : 'ready',
    evidenceTs: snapshot?.ts ?? null,
  };

  const clarificationStep: WalkthroughStep = {
    id: 'clarification',
    title: 'Ambiguous work asks before it executes',
    detail: clarificationSeen
      ? `${clarificationSeen.title} is already visible in the operator inbox.`
      : 'Waiting for a real ambiguous task to force a clarification turn.',
    view: 'system',
    state: !connected ? 'offline' : clarificationSeen ? 'live' : 'ready',
    evidenceTs: clarificationSeen?.ts ?? null,
  };

  const workflowStep: WalkthroughStep = {
    id: 'workflow-progression',
    title: 'Concrete work progresses through live workflow phases',
    detail: completionSeen
      ? `${completionSeen.title} completed after observable workflow movement.`
      : workflowSeen
        ? `${workflowSeen.title} proves the runtime workflow is moving.`
        : workflow
          ? `${workflow.phase} is visible, but no end-to-end task chain has completed yet.`
          : 'No workflow evidence yet.',
    view: 'pipeline',
    state: !connected
      ? 'offline'
      : completionSeen || workflowSeen || (workflow?.stageCounts.completedTasks ?? 0) > 0
        ? 'live'
        : workflow
          ? 'ready'
          : 'offline',
    evidenceTs: completionSeen?.ts ?? workflowSeen?.ts ?? snapshot?.ts ?? null,
  };

  const passiveCommunicationStep: WalkthroughStep = {
    id: 'passive-communication',
    title: 'Passive communication changes behavior',
    detail: signalSeen && reputationSeen
      ? `${signalSeen.title} and ${reputationSeen.title} are both visible.`
      : signalSeen
        ? `${signalSeen.title} is visible; waiting for reputation or downstream behavioral proof.`
        : 'Waiting for pheromone, stigmergy, or channel evidence from a live run.',
    view: 'communication',
    state: !connected
      ? 'offline'
      : signalSeen && reputationSeen
        ? 'live'
        : signalSeen || (behavior?.communication?.trailCount ?? 0) > 0
          ? 'ready'
          : 'offline',
    evidenceTs: reputationSeen?.ts ?? signalSeen?.ts ?? null,
  };

  const resilienceStep: WalkthroughStep = {
    id: 'resilience',
    title: 'Failure degrades gracefully instead of collapsing',
    detail: recoverySeen
      ? `${recoverySeen.title} is visible in the operator narrative.`
      : behavior?.resilience
        ? `${behavior.resilience.retryCount ?? 0} retries, ${behavior.resilience.breakerTrips ?? 0} breaker trips, ${behavior.resilience.pipelineBreaks ?? 0} pipeline breaks.`
        : 'Resilience telemetry is not available yet.',
    view: 'control',
    state: !connected
      ? 'offline'
      : recoverySeen || (behavior?.resilience?.retryCount ?? 0) > 0 || (behavior?.resilience?.pipelineBreaks ?? 0) > 0
        ? 'live'
        : behavior?.resilience
          ? 'ready'
          : 'offline',
    evidenceTs: recoverySeen?.ts ?? snapshot?.ts ?? null,
  };

  const guardrailStep: WalkthroughStep = {
    id: 'guardrails',
    title: 'Budget and compliance stay active during execution',
    detail: budgetSeen || complianceSeen
      ? `${budgetSeen?.title ?? complianceSeen?.title} is visible to the operator.`
      : behavior?.budget && behavior?.compliance
        ? `${Math.round((behavior.budget.utilization ?? 0) * 100)}% budget used, ${behavior.compliance.totalViolations ?? 0} compliance violations.`
        : 'Budget or compliance telemetry is not available yet.',
    view: 'adaptation',
    state: !connected
      ? 'offline'
      : budgetSeen || complianceSeen || Boolean(behavior?.budget && behavior?.compliance)
        ? 'live'
        : 'ready',
    evidenceTs: budgetSeen?.ts ?? complianceSeen?.ts ?? snapshot?.ts ?? null,
  };

  const ecologicalSteps = [
    runtimeStep,
    clarificationStep,
    workflowStep,
    passiveCommunicationStep,
    resilienceStep,
    guardrailStep,
  ];

  const ecologicalLiveCount = countLive(ecologicalSteps);

  const judgmentStep: WalkthroughStep = {
    id: 'operator-judgment',
    title: 'Operator judges the system as adaptive, not mechanical',
    detail: ecologicalLiveCount === ecologicalSteps.length
      ? 'All observable prerequisites are live. Final signoff still requires a human walkthrough note.'
      : `Only ${ecologicalLiveCount}/${ecologicalSteps.length} prerequisite steps are fully live. Keep exercising the system before signing off.`,
    view: 'system',
    state: connected ? 'manual' : 'offline',
    evidenceTs: null,
  };

  return [...ecologicalSteps, judgmentStep];
}

export function buildChapter14WalkthroughSummary(steps: WalkthroughStep[]): WalkthroughSummary {
  const prerequisites = steps.filter((step) => step.id !== 'operator-judgment');
  const liveCount = prerequisites.filter((step) => step.state === 'live').length;
  const readyCount = prerequisites.filter((step) => step.state === 'ready').length;
  const offlineCount = prerequisites.filter((step) => step.state === 'offline').length;
  const manualCount = steps.filter((step) => step.state === 'manual').length;

  return {
    prerequisiteCount: prerequisites.length,
    liveCount,
    readyCount,
    offlineCount,
    manualCount,
    readinessScore: prerequisites.length
      ? Math.round((liveCount / prerequisites.length) * 100)
      : 0,
    canAttemptFinalSignoff: prerequisites.length > 0 && liveCount === prerequisites.length,
    blockerTitles: prerequisites
      .filter((step) => step.state !== 'live')
      .map((step) => step.title),
  };
}

export function formatChapter14Brief(
  steps: WalkthroughStep[],
  summary: WalkthroughSummary,
) {
  const header = [
    'OpenClaw Chapter 14 Operator Brief',
    `Readiness: ${summary.readinessScore}% (${summary.liveCount}/${summary.prerequisiteCount} prerequisite steps live)`,
    `Final signoff: ${summary.canAttemptFinalSignoff ? 'ready for manual judgment' : 'not ready yet'}`,
  ];

  if (summary.blockerTitles.length > 0) {
    header.push(`Blocking steps: ${summary.blockerTitles.join('; ')}`);
  }

  const lines = steps.map((step, index) => {
    const evidence = step.evidenceTs ? `evidence @ ${new Date(step.evidenceTs).toISOString()}` : 'no live timestamp yet';
    return `${index + 1}. [${step.state}] ${step.title} - ${step.detail} (${evidence})`;
  });

  return [...header, '', ...lines].join('\n');
}
