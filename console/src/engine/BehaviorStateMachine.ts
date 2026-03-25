/**
 * BehaviorStateMachine — 12 bee behaviors with priority-based activation
 *
 * Each behavior defines: trigger condition, Boids modifiers, visual modifiers,
 * and particle emission config. The state machine evaluates all behaviors per
 * agent per frame and activates the highest-priority match.
 */

import type { AgentSnapshot, WorldSnapshot } from '../api/ws-bridge';

// ── Types ───────────────────────────────────────────────────────────────────

export interface BoidsModifiers {
  separationMod?: number;  // multiplier on separation weight
  alignmentMod?: number;   // multiplier on alignment weight
  speedMod?: number;       // multiplier on max speed
}

export interface VisualModifiers {
  emissiveMod?: number;    // additive
  scaleMod?: number;       // multiplier
  wingHzMod?: number;      // multiplier
}

export interface ParticleConfig {
  type: string;            // 'trail' | 'dance' | 'alarm' | 'recruit' | 'spark' | 'air'
  rate: number;            // particles per second
  color?: string;
}

export interface BehaviorState {
  id: string;
  priority: number;        // 1 = highest
  shouldActivate: (agent: AgentSnapshot, world: WorldSnapshot) => boolean;
  getBoidsModifiers: () => BoidsModifiers;
  getVisualModifiers: () => VisualModifiers;
  getParticleEmission: () => ParticleConfig | null;
}

// ── Helper functions ────────────────────────────────────────────────────────

function getFieldValue(world: WorldSnapshot, dim: string): number {
  const field = world.field as Record<string, number> | undefined;
  return field?.[dim] ?? 0;
}

function getMaxPheromone(world: WorldSnapshot, type: string): number {
  const pheromones = world.pheromones;
  if (!pheromones) return 0;
  let max = 0;
  for (const p of pheromones) {
    if (p.type === type && p.intensity > max) max = p.intensity;
  }
  return max;
}

function hasYoungChild(agent: AgentSnapshot, world: WorldSnapshot): boolean {
  return world.agents.some(a => a.parentId === agent.id);
}

function roleIn(agent: AgentSnapshot, roles: string[]): boolean {
  const role = agent.role?.toLowerCase() ?? '';
  return roles.includes(role);
}

/** Agent spawn tracking (approximate — based on first-seen time) */
const firstSeen = new Map<string, number>();

function getAgentAge(agentId: string): number {
  const now = Date.now();
  if (!firstSeen.has(agentId)) {
    firstSeen.set(agentId, now);
    return 0;
  }
  return now - firstSeen.get(agentId)!;
}

function isNewlySpawned(agent: AgentSnapshot): boolean {
  return getAgentAge(agent.id) < 10_000; // 10 seconds
}

/** Track last known state for detecting transitions */
const lastState = new Map<string, string>();

function justCompletedTask(agent: AgentSnapshot): boolean {
  const prev = lastState.get(agent.id);
  const curr = agent.state?.toUpperCase() ?? 'IDLE';
  lastState.set(agent.id, curr);
  return prev === 'EXECUTING' && (curr === 'ACTIVE' || curr === 'IDLE');
}

const idleStart = new Map<string, number>();

function idleFor(agent: AgentSnapshot, ms: number): boolean {
  const state = agent.state?.toUpperCase() ?? 'IDLE';
  if (state !== 'IDLE') {
    idleStart.delete(agent.id);
    return false;
  }
  if (!idleStart.has(agent.id)) {
    idleStart.set(agent.id, Date.now());
    return false;
  }
  return Date.now() - idleStart.get(agent.id)! >= ms;
}

// ── 12 Behaviors ────────────────────────────────────────────────────────────

const BEHAVIORS: BehaviorState[] = [
  // 1. Alarm — highest priority
  {
    id: 'alarm',
    priority: 1,
    shouldActivate: (_a, w) => getMaxPheromone(w, 'alarm') > 0.7,
    getBoidsModifiers: () => ({ separationMod: 2.0, speedMod: 1.5 }),
    getVisualModifiers: () => ({ emissiveMod: 0.8, scaleMod: 1.0, wingHzMod: 1.8 }),
    getParticleEmission: () => ({ type: 'alarm', rate: 20, color: '#FF4B6E' }),
  },

  // 2. Guarding
  {
    id: 'guarding',
    priority: 2,
    shouldActivate: (a, w) =>
      roleIn(a, ['reviewer', 'debugger', 'tester', 'guard']) &&
      Math.max(getFieldValue(w, 'alarm'), getMaxPheromone(w, 'alarm')) > 0.5,
    getBoidsModifiers: () => ({ separationMod: 0.5, speedMod: 0.8 }),
    getVisualModifiers: () => ({ emissiveMod: 0.5, scaleMod: 1.1, wingHzMod: 1.2 }),
    getParticleEmission: () => null,
  },

  // 3. Foraging (executing task)
  {
    id: 'foraging',
    priority: 3,
    shouldActivate: (a) => a.state?.toUpperCase() === 'EXECUTING',
    getBoidsModifiers: () => ({ separationMod: 1.2, speedMod: 1.3 }),
    getVisualModifiers: () => ({ emissiveMod: 1.0, scaleMod: 1.0, wingHzMod: 1.0 }),
    getParticleEmission: () => ({ type: 'trail', rate: 15, color: '#F5A623' }),
  },

  // 4. Waggle dance (reporting)
  {
    id: 'waggle_dance',
    priority: 4,
    shouldActivate: (a) => a.state?.toUpperCase() === 'REPORTING',
    getBoidsModifiers: () => ({ separationMod: 0.3, speedMod: 0.9 }),
    getVisualModifiers: () => ({ emissiveMod: 0.7, scaleMod: 1.0, wingHzMod: 1.3 }),
    getParticleEmission: () => ({ type: 'dance', rate: 10, color: '#10B981' }),
  },

  // 5. Fanning (collective coordination/calibration pressure high)
  {
    id: 'fanning',
    priority: 5,
    shouldActivate: (_a, w) =>
      Math.max(
        getFieldValue(w, 'coordination'),
        getFieldValue(w, 'calibration'),
      ) > 0.7,
    getBoidsModifiers: () => ({ separationMod: 0.3, speedMod: 0.1 }),
    getVisualModifiers: () => ({ emissiveMod: 0.3, scaleMod: 1.0, wingHzMod: 2.0 }),
    getParticleEmission: () => ({ type: 'air', rate: 8, color: '#ffffff' }),
  },

  // 6. Nursing (has young child)
  {
    id: 'nursing',
    priority: 6,
    shouldActivate: (a, w) => hasYoungChild(a, w),
    getBoidsModifiers: () => ({ separationMod: 0.3, speedMod: 0.6 }),
    getVisualModifiers: () => ({ emissiveMod: 0.4, scaleMod: 1.0, wingHzMod: 0.8 }),
    getParticleEmission: () => null,
  },

  // 7. Storing (just completed task)
  {
    id: 'storing',
    priority: 7,
    shouldActivate: (a) => justCompletedTask(a),
    getBoidsModifiers: () => ({ separationMod: 0.5, speedMod: 0.7 }),
    getVisualModifiers: () => ({ emissiveMod: 0.6, scaleMod: 1.05, wingHzMod: 0.9 }),
    getParticleEmission: () => ({ type: 'spark', rate: 5, color: '#FFB800' }),
  },

  // 8. Orientation (newly spawned)
  {
    id: 'orientation',
    priority: 8,
    shouldActivate: (a) => isNewlySpawned(a) && a.state?.toUpperCase() === 'ACTIVE',
    getBoidsModifiers: () => ({ separationMod: 0.8, speedMod: 1.2 }),
    getVisualModifiers: () => ({ emissiveMod: 0.8, scaleMod: 0.9, wingHzMod: 1.5 }),
    getParticleEmission: () => null,
  },

  // 9. Pollen collection (food pheromone)
  {
    id: 'pollen',
    priority: 9,
    shouldActivate: (_a, w) => getMaxPheromone(w, 'food') > 0.5,
    getBoidsModifiers: () => ({ separationMod: 0.5, speedMod: 0.8 }),
    getVisualModifiers: () => ({ emissiveMod: 0.3, scaleMod: 1.05, wingHzMod: 0.8 }),
    getParticleEmission: () => null,
  },

  // 10. Resting (idle for 10+ seconds)
  {
    id: 'resting',
    priority: 10,
    shouldActivate: (a) => idleFor(a, 10_000),
    getBoidsModifiers: () => ({ separationMod: 0.2, speedMod: 0.05 }),
    getVisualModifiers: () => ({ emissiveMod: -0.3, scaleMod: 0.95, wingHzMod: 0.1 }),
    getParticleEmission: () => null,
  },

  // 11. Active (general active state)
  {
    id: 'active',
    priority: 11,
    shouldActivate: (a) => a.state?.toUpperCase() === 'ACTIVE',
    getBoidsModifiers: () => ({ separationMod: 1.0, speedMod: 1.0 }),
    getVisualModifiers: () => ({ emissiveMod: 0.2, scaleMod: 1.0, wingHzMod: 1.0 }),
    getParticleEmission: () => null,
  },

  // 12. Idle (default fallback — always activates)
  {
    id: 'idle',
    priority: 12,
    shouldActivate: () => true,
    getBoidsModifiers: () => ({ separationMod: 0.3, speedMod: 0.3 }),
    getVisualModifiers: () => ({ emissiveMod: -0.2, scaleMod: 1.0, wingHzMod: 0.4 }),
    getParticleEmission: () => null,
  },
];

// ── State Machine ───────────────────────────────────────────────────────────

export interface ActiveBehavior {
  id: string;
  boids: BoidsModifiers;
  visual: VisualModifiers;
  particles: ParticleConfig | null;
}

/** Per-agent behavior cache */
const agentBehaviors = new Map<string, ActiveBehavior>();

/**
 * Evaluate all behaviors for an agent, activate highest priority match.
 * Call this once per physics tick per agent.
 */
export function evaluateBehavior(
  agent: AgentSnapshot,
  world: WorldSnapshot,
): ActiveBehavior {
  for (const behavior of BEHAVIORS) {
    if (behavior.shouldActivate(agent, world)) {
      const result: ActiveBehavior = {
        id: behavior.id,
        boids: behavior.getBoidsModifiers(),
        visual: behavior.getVisualModifiers(),
        particles: behavior.getParticleEmission(),
      };
      agentBehaviors.set(agent.id, result);
      return result;
    }
  }

  // Fallback (should never reach here since 'idle' always activates)
  const fallback: ActiveBehavior = {
    id: 'idle',
    boids: { separationMod: 0.3, speedMod: 0.3 },
    visual: { emissiveMod: 0, scaleMod: 1.0, wingHzMod: 0.5 },
    particles: null,
  };
  agentBehaviors.set(agent.id, fallback);
  return fallback;
}

/**
 * Get the current behavior for an agent (cached from last evaluation)
 */
export function getAgentBehavior(agentId: string): ActiveBehavior | undefined {
  return agentBehaviors.get(agentId);
}

/**
 * Clean up tracking state for removed agents
 */
export function removeAgentTracking(agentId: string) {
  agentBehaviors.delete(agentId);
  firstSeen.delete(agentId);
  lastState.delete(agentId);
  idleStart.delete(agentId);
}

/**
 * Get all behavior definitions (for UI listing)
 */
export function getAllBehaviors(): Array<{ id: string; priority: number }> {
  return BEHAVIORS.map(b => ({ id: b.id, priority: b.priority }));
}
