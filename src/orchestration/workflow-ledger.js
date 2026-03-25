/**
 * WorkflowLedger - backend-native workflow state contract for orchestration.
 *
 * Converts runtime orchestration events into an explicit workflow phase model
 * so downstream observers do not need to infer the system phase from UI-side
 * heuristics alone.
 *
 * @module orchestration/workflow-ledger
 * @version 9.0.0
 */

import { ModuleBase } from '../core/module-base.js'

const PHASES = Object.freeze({
  standby: 'Standing by',
  understand: 'Researching context',
  route: 'Routing work',
  implement: 'Implementing plan',
  review: 'Reviewing output',
  synthesize: 'Synthesizing result',
  guardrails: 'Guardrails engaged',
})

const RESEARCH_ROLES = new Set(['researcher', 'analyst', 'librarian', 'consultant', 'scout'])
const ROUTE_ROLES = new Set(['planner', 'coordinator', 'architect'])
const IMPLEMENT_ROLES = new Set(['implementer', 'debugger', 'tester', 'coder', 'guard'])
const REVIEW_ROLES = new Set(['reviewer'])
const SYNTHESIS_TTL_MS = 60_000

function toEventName(topic, payload) {
  const detail = payload?.dagId || payload?.nodeId || payload?.agentId || payload?.roleId || payload?.toolName
  return detail ? `${topic}:${detail}` : topic
}

function summarizeRoute(route) {
  if (!route) return 'none'
  const routeName = route.route?.name || route.name || 'unknown'
  const threshold = typeof route.threshold === 'number' ? route.threshold.toFixed(2) : 'n/a'
  const complexity = typeof route.complexity === 'number' ? route.complexity.toFixed(2) : 'n/a'
  return `${routeName} (complexity ${complexity}, threshold ${threshold})`
}

function classifyRolePhase(role) {
  if (REVIEW_ROLES.has(role)) return 'review'
  if (IMPLEMENT_ROLES.has(role)) return 'implement'
  if (RESEARCH_ROLES.has(role)) return 'understand'
  if (ROUTE_ROLES.has(role)) return 'route'
  return 'implement'
}

export class WorkflowLedger extends ModuleBase {
  static publishes() { return ['workflow.phase.changed'] }
  static subscribes() {
    return [
      'intent.classified',
      'routing.decided',
      'plan.created',
      'dag.created',
      'dag.state.changed',
      'dag.phase.started',
      'dag.phase.completed',
      'dag.phase.failed',
      'dag.completed',
      'quality.breaker.tripped',
      'quality.breaker.closed',
      'quality.compliance.violation',
      'quality.compliance.terminated',
      'deadline.warning',
      'deadline.exceeded',
      'quality.pipeline.broken',
      'session.ended',
      'synthesis.completed',
    ]
  }

  constructor({ bus } = {}) {
    super()
    this._bus = bus
    this._unsubscribers = []
    this._phaseId = 'standby'
    this._lastTransitionAt = Date.now()
    this._lastTransitionReason = 'boot'
    this._lastIntent = null
    this._lastRoute = null
    this._lastCompletedAt = 0
    this._completedDags = 0
    this._dags = new Map()
    this._openBreakers = new Set()
    this._deadlineWarnings = new Set()
    this._deadlineExceeded = new Set()
    this._pipelineBreaks = new Set()
    this._terminatedSessions = new Set()
    this._complianceViolations = 0
    this._lastEvent = null
    this._history = []
  }

  async start() {
    const listen = this._bus?.on?.bind(this._bus)
    if (!listen) return

    this._unsubscribers.push(
      listen('intent.classified', (payload) => this._onIntentClassified(payload)),
      listen('routing.decided', (payload) => this._onRoutingDecided(payload)),
      listen('plan.created', (payload) => this._onPlanCreated(payload)),
      listen('dag.created', (payload) => this._onDagCreated(payload)),
      listen('dag.state.changed', (payload) => this._onDagStateChanged(payload)),
      listen('dag.phase.started', (payload) => this._onDagPhaseStarted(payload)),
      listen('dag.phase.completed', (payload) => this._onDagPhaseCompleted(payload)),
      listen('dag.phase.failed', (payload) => this._onDagPhaseFailed(payload)),
      listen('dag.completed', (payload) => this._onDagCompleted(payload)),
      listen('quality.breaker.tripped', (payload) => this._onBreakerOpened(payload)),
      listen('quality.breaker.closed', (payload) => this._onBreakerClosed(payload)),
      listen('quality.compliance.violation', (payload) => this._onComplianceViolation(payload)),
      listen('quality.compliance.terminated', (payload) => this._onComplianceTerminated(payload)),
      listen('deadline.warning', (payload) => this._onDeadlineWarning(payload)),
      listen('deadline.exceeded', (payload) => this._onDeadlineExceeded(payload)),
      listen('quality.pipeline.broken', (payload) => this._onPipelineBroken(payload)),
      listen('session.ended', (payload) => this._onSessionEnded(payload)),
      listen('synthesis.completed', (payload) => this._onSynthesisCompleted(payload)),
    )
  }

  async stop() {
    for (const unsubscribe of this._unsubscribers.splice(0)) {
      unsubscribe?.()
    }
  }

  getState() {
    const roleCounts = { research: 0, route: 0, implement: 0, review: 0 }
    const activeRoles = {}
    let activeTasks = 0
    let activeAgents = 0

    for (const dag of this._dags.values()) {
      if (dag.state !== 'completed' && dag.state !== 'cancelled') {
        activeTasks += 1
      }

      for (const node of dag.nodes.values()) {
        if (node.active) {
          activeAgents += node.agentId ? 1 : 0
          activeRoles[node.role] = (activeRoles[node.role] || 0) + 1

          if (RESEARCH_ROLES.has(node.role)) roleCounts.research += 1
          else if (ROUTE_ROLES.has(node.role)) roleCounts.route += 1
          else if (IMPLEMENT_ROLES.has(node.role)) roleCounts.implement += 1
          else if (REVIEW_ROLES.has(node.role)) roleCounts.review += 1
        }
      }
    }

    const openBreakers = this._openBreakers.size
    const evidence = {
      provenance: {
        phase: 'runtime',
        data: 'backend_workflow_ledger',
      },
      intent: this._lastIntent,
      route: this._lastRoute,
      roleCounts,
      taskCounts: {
        active: activeTasks,
        completed: this._completedDags,
      },
      guardrails: {
        openBreakers,
        deadlineWarnings: this._deadlineWarnings.size,
        deadlineExceeded: this._deadlineExceeded.size,
        pipelineBreaks: this._pipelineBreaks.size,
        complianceViolations: this._complianceViolations,
        terminatedSessions: this._terminatedSessions.size,
      },
      lastEvent: this._lastEvent,
      lastTransitionAt: this._lastTransitionAt,
      lastTransitionReason: this._lastTransitionReason,
      recentTransitions: this._history.slice(-12),
    }

    return {
      phaseId: this._phaseId,
      phase: PHASES[this._phaseId] ?? PHASES.standby,
      phaseSource: 'runtime',
      summary: this._buildSummary({
        activeAgents,
        activeTasks,
        openBreakers,
      }),
      activeRoles,
      stageCounts: {
        activeAgents,
        activeTasks,
        completedTasks: this._completedDags,
        openBreakers,
        terminatedSessions: this._terminatedSessions.size,
      },
      evidence,
    }
  }

  _onIntentClassified(payload) {
    this._lastIntent = {
      primary: payload?.primary ?? 'unknown',
      confidence: payload?.confidence ?? 0,
      ambiguity: payload?.ambiguity ?? [],
    }
    this._recordEvent('intent.classified', payload)
    this._setPhase('understand', `intent ${payload?.primary ?? 'unknown'} classified`)
  }

  _onRoutingDecided(payload) {
    this._lastRoute = {
      route: payload?.route ?? null,
      complexity: payload?.complexity ?? null,
      threshold: payload?.threshold ?? null,
      scope: payload?.scope ?? 'global',
    }
    this._recordEvent('routing.decided', payload)
    this._setPhase('route', `router selected ${payload?.route?.name ?? 'unknown'} path`)
  }

  _onPlanCreated(payload) {
    this._recordEvent('plan.created', payload)
    this._setPhase('route', `plan created for ${payload?.intentType ?? 'task'}`)
  }

  _onDagCreated(payload) {
    const dagId = payload?.dagId
    if (!dagId) return

    const nodes = new Map()
    for (const node of payload?.nodes ?? []) {
      nodes.set(node.id, {
        nodeId: node.id,
        role: node.role ?? 'unknown',
        agentId: node.agentId ?? null,
        active: false,
        completed: false,
      })
    }

    this._dags.set(dagId, {
      dagId,
      state: 'active',
      createdAt: Date.now(),
      nodes,
    })

    this._recordEvent('dag.created', payload)
    this._setPhase('route', `dag ${dagId} created`)
  }

  _onDagStateChanged(payload) {
    const dag = this._dags.get(payload?.dagId)
    if (dag) {
      dag.state = payload?.state ?? dag.state
    }
    this._recordEvent('dag.state.changed', payload)
    this._recomputePhase(`dag state ${payload?.state ?? 'unknown'}`)
  }

  _onDagPhaseStarted(payload) {
    const dag = this._ensureDag(payload?.dagId)
    if (!dag) return
    const node = this._ensureNode(dag, payload)
    node.active = true
    node.completed = false
    node.agentId = payload?.agentId ?? node.agentId ?? null
    node.role = payload?.role ?? node.role ?? 'unknown'

    this._recordEvent('dag.phase.started', payload)
    this._setPhase(classifyRolePhase(node.role), `node ${node.nodeId} started by ${node.role}`)
  }

  _onDagPhaseCompleted(payload) {
    const dag = this._ensureDag(payload?.dagId)
    if (!dag) return
    const node = this._ensureNode(dag, payload)
    node.active = false
    node.completed = true
    node.agentId = payload?.agentId ?? node.agentId ?? null
    node.role = payload?.role ?? node.role ?? 'unknown'

    this._recordEvent('dag.phase.completed', payload)
    this._recomputePhase(`node ${node.nodeId} completed`)
  }

  _onDagPhaseFailed(payload) {
    const dag = this._ensureDag(payload?.dagId)
    if (!dag) return
    const node = this._ensureNode(dag, payload)
    node.active = false
    node.completed = false
    node.agentId = payload?.agentId ?? node.agentId ?? null
    node.role = payload?.role ?? node.role ?? 'unknown'

    this._recordEvent('dag.phase.failed', payload)
    this._recomputePhase(`node ${node.nodeId} failed`)
  }

  _onDagCompleted(payload) {
    const dag = this._ensureDag(payload?.dagId)
    if (dag) {
      dag.state = 'completed'
      for (const node of dag.nodes.values()) {
        node.active = false
      }
    }

    this._completedDags += 1
    this._lastCompletedAt = Date.now()
    this._deadlineWarnings.delete(payload?.dagId)
    this._deadlineExceeded.delete(payload?.dagId)
    this._pipelineBreaks.delete(payload?.dagId)

    this._recordEvent('dag.completed', payload)
    this._setPhase('synthesize', `dag ${payload?.dagId ?? 'unknown'} completed`)
  }

  _onBreakerOpened(payload) {
    const breakerId = payload?.toolName ?? payload?.name ?? payload?.breakerId ?? 'unknown'
    this._openBreakers.add(breakerId)
    this._recordEvent('quality.breaker.tripped', payload)
    this._setPhase('guardrails', `breaker ${breakerId} opened`)
  }

  _onBreakerClosed(payload) {
    const breakerId = payload?.toolName ?? payload?.name ?? payload?.breakerId ?? 'unknown'
    this._openBreakers.delete(breakerId)
    this._recordEvent('quality.breaker.closed', payload)
    this._recomputePhase(`breaker ${breakerId} closed`)
  }

  _onComplianceViolation(payload) {
    this._complianceViolations += 1
    this._recordEvent('quality.compliance.violation', payload)
    this._setPhase('guardrails', 'compliance violation raised')
  }

  _onComplianceTerminated(payload) {
    if (payload?.sessionId) {
      this._terminatedSessions.add(payload.sessionId)
    }
    this._recordEvent('quality.compliance.terminated', payload)
    this._setPhase('guardrails', `compliance terminated session ${payload?.sessionId ?? 'unknown'}`)
  }

  _onDeadlineWarning(payload) {
    if (payload?.dagId) this._deadlineWarnings.add(payload.dagId)
    this._recordEvent('deadline.warning', payload)
    this._recomputePhase(`deadline warning for ${payload?.dagId ?? 'unknown'}`)
  }

  _onDeadlineExceeded(payload) {
    if (payload?.dagId) this._deadlineExceeded.add(payload.dagId)
    this._recordEvent('deadline.exceeded', payload)
    this._setPhase('guardrails', `deadline exceeded for ${payload?.dagId ?? 'unknown'}`)
  }

  _onPipelineBroken(payload) {
    if (payload?.dagId) this._pipelineBreaks.add(payload.dagId)
    this._recordEvent('quality.pipeline.broken', payload)
    this._setPhase('guardrails', `pipeline broken for ${payload?.dagId ?? 'unknown'}`)
  }

  _onSessionEnded(payload) {
    if (payload?.sessionId) {
      this._terminatedSessions.delete(payload.sessionId)
    }
    this._recordEvent('session.ended', payload)
    this._recomputePhase(`session ended ${payload?.sessionId ?? 'unknown'}`)
  }

  _onSynthesisCompleted(payload) {
    this._lastCompletedAt = Date.now()
    this._recordEvent('synthesis.completed', payload)
    this._setPhase('synthesize', `synthesis completed for ${payload?.dagId ?? 'unknown'}`)
  }

  _recomputePhase(reason) {
    const counts = this._computeActiveRoleCounts()
    const now = Date.now()

    let nextPhase = 'standby'
    if (this._openBreakers.size > 0 || this._deadlineExceeded.size > 0 || this._pipelineBreaks.size > 0 || this._terminatedSessions.size > 0) {
      nextPhase = 'guardrails'
    } else if (counts.review > 0) {
      nextPhase = 'review'
    } else if (counts.implement > 0) {
      nextPhase = 'implement'
    } else if (counts.understand > 0) {
      nextPhase = 'understand'
    } else if (counts.route > 0 || this._hasActiveDags()) {
      nextPhase = 'route'
    } else if (this._lastCompletedAt > 0 && (now - this._lastCompletedAt) <= SYNTHESIS_TTL_MS) {
      nextPhase = 'synthesize'
    }

    this._setPhase(nextPhase, reason)
  }

  _setPhase(phaseId, reason) {
    if (!PHASES[phaseId]) {
      phaseId = 'standby'
    }
    if (this._phaseId === phaseId && this._lastTransitionReason === reason) {
      return
    }

    const previous = this._phaseId
    this._phaseId = phaseId
    this._lastTransitionAt = Date.now()
    this._lastTransitionReason = reason
    this._history.push({
      ts: this._lastTransitionAt,
      from: previous,
      to: phaseId,
      reason,
    })
    if (this._history.length > 100) {
      this._history.splice(0, this._history.length - 100)
    }

    if (previous !== phaseId) {
      this._bus?.publish?.('workflow.phase.changed', {
        from: previous,
        to: phaseId,
        phase: PHASES[phaseId],
        reason,
        timestamp: this._lastTransitionAt,
      }, 'workflow-ledger')
    }
  }

  _computeActiveRoleCounts() {
    const counts = { understand: 0, route: 0, implement: 0, review: 0 }
    for (const dag of this._dags.values()) {
      for (const node of dag.nodes.values()) {
        if (!node.active) continue
        counts[classifyRolePhase(node.role)] += 1
      }
    }
    return counts
  }

  _hasActiveDags() {
    for (const dag of this._dags.values()) {
      if (dag.state !== 'completed' && dag.state !== 'cancelled') {
        return true
      }
    }
    return false
  }

  _buildSummary({ activeAgents, activeTasks, openBreakers }) {
    return `${PHASES[this._phaseId]}. ${activeAgents} active agent(s), ${activeTasks} live plan(s), ${this._completedDags} completed, ${openBreakers} breaker(s) open.`
  }

  _ensureDag(dagId) {
    if (!dagId) return null
    if (!this._dags.has(dagId)) {
      this._dags.set(dagId, {
        dagId,
        state: 'active',
        createdAt: Date.now(),
        nodes: new Map(),
      })
    }
    return this._dags.get(dagId)
  }

  _ensureNode(dag, payload) {
    const nodeId = payload?.nodeId ?? payload?.phase ?? 'unknown-node'
    if (!dag.nodes.has(nodeId)) {
      dag.nodes.set(nodeId, {
        nodeId,
        role: payload?.role ?? 'unknown',
        agentId: payload?.agentId ?? null,
        active: false,
        completed: false,
      })
    }
    return dag.nodes.get(nodeId)
  }

  _recordEvent(topic, payload) {
    this._lastEvent = {
      topic,
      name: toEventName(topic, payload),
      ts: Date.now(),
    }
  }
}

export default WorkflowLedger
