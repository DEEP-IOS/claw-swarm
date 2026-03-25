/**
 * PhysicsEngine — 3D Boids simulation with 4 forces
 *
 * Forces: target attraction, separation, alignment, state-specific.
 * Runs at 30Hz via FrameScheduler. Each body stores prevPosition for
 * render-frame interpolation (lerp with alpha from FrameScheduler).
 *
 * V8 hard constraints preserved: separation radius 6.0, alignment radius 10.0,
 * damping 0.95, drag 0.02, max force 0.05.
 */

import { BOIDS } from './constants';
import type { AgentSnapshot, WorldSnapshot } from '../api/ws-bridge';

// ── Types ───────────────────────────────────────────────────────────────────

export type { AgentSnapshot, WorldSnapshot };

export interface PhysicsBody {
  id: string;
  position: [number, number, number];
  velocity: [number, number, number];
  prevPosition: [number, number, number];
  target: [number, number, number];
  role: string;
  state: string;
  maxSpeed: number;
  parentId: string | null;
}

export type ViewTargetProvider = (
  agent: AgentSnapshot | undefined,
  world: WorldSnapshot,
  currentPos: [number, number, number],
) => [number, number, number];

// ── Constants ───────────────────────────────────────────────────────────────

const SEP_RADIUS = BOIDS.SEPARATION_DIST;             // 6.0
const ALIGN_RADIUS = BOIDS.ALIGNMENT_DIST;            // 10.0
const MAX_FORCE = BOIDS.MAX_FORCE;                    // 0.05
const DAMPING = BOIDS.DAMPING;                        // 0.95
const DRAG = BOIDS.DRAG_COEFFICIENT;                  // 0.02
const TARGET_ATTRACTION = 0.002;
const ALIGNMENT_WEIGHT = 0.05;
const BOUNDARY = 20;
const MIN_Y = 0.3;
const MAX_Y = 15;
const HIVE_CENTER: [number, number, number] = [0, 0.5, 0];

/** Separation weight by state */
const SEP_WEIGHTS: Record<string, number> = {
  EXECUTING: 0.8,
  ACTIVE: 0.5,
  IDLE: 0.3,
  REPORTING: 0.3,
};

/** Max speed by state */
const MAX_SPEEDS: Record<string, number> = {
  EXECUTING: 0.25,
  ACTIVE: 0.12,
  IDLE: 0.06,
  REPORTING: 0.18,
};

// ── Vector helpers (no allocation) ──────────────────────────────────────────

type V3 = [number, number, number];

function v3Length(v: V3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function v3Dist(a: V3, b: V3): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function v3Normalize(v: V3): V3 {
  const len = v3Length(v);
  if (len < 0.0001) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function v3ClampMag(v: V3, maxMag: number): V3 {
  const len = v3Length(v);
  if (len <= maxMag) return v;
  const s = maxMag / len;
  return [v[0] * s, v[1] * s, v[2] * s];
}

function v3Lerp(a: V3, b: V3, t: number): V3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

// ── PhysicsEngine ───────────────────────────────────────────────────────────

export class PhysicsEngine {
  private bodies = new Map<string, PhysicsBody>();
  private viewTargetProvider: ViewTargetProvider;
  private time = 0;

  constructor(viewTargetProvider?: ViewTargetProvider) {
    this.viewTargetProvider = viewTargetProvider ?? PhysicsEngine.defaultTargetProvider;
  }

  /** Default target: IDLE → hive center, EXECUTING → ring around center */
  static defaultTargetProvider(
    agent: AgentSnapshot | undefined,
    _world: WorldSnapshot,
    _currentPos: V3,
  ): V3 {
    if (!agent) return HIVE_CENTER;
    const state = agent.state?.toUpperCase() ?? 'IDLE';

    if (state === 'IDLE') {
      // Small random offset from hive center (consistent per agent)
      const hash = hashCode(agent.id);
      const angle = (hash % 360) * (Math.PI / 180);
      const r = 1.5 + (hash % 100) / 100;
      return [Math.cos(angle) * r, 0.5, Math.sin(angle) * r];
    }

    if (state === 'EXECUTING') {
      // Ring around center, offset by agent index
      const hash = hashCode(agent.id);
      const angle = (hash % 360) * (Math.PI / 180);
      const r = 6 + (hash % 100) / 50;
      return [Math.cos(angle) * r, 2 + (hash % 30) / 10, Math.sin(angle) * r];
    }

    if (state === 'REPORTING') {
      // Stay near current position (8-figure motion done by state force)
      return _currentPos;
    }

    // ACTIVE — gentle drift
    const hash2 = hashCode(agent.id);
    const angle2 = (hash2 % 360) * (Math.PI / 180);
    const r2 = 3 + (hash2 % 100) / 50;
    return [Math.cos(angle2) * r2, 1.5, Math.sin(angle2) * r2];
  }

  setViewTargetProvider(provider: ViewTargetProvider) {
    this.viewTargetProvider = provider;
  }

  /**
   * Main tick — called at 30Hz
   */
  tick(worldSnapshot: WorldSnapshot) {
    this.time += 1 / 30;
    this.syncBodies(worldSnapshot.agents);

    // Update targets
    for (const body of this.bodies.values()) {
      const agent = worldSnapshot.agents.find(a => a.id === body.id);
      body.state = agent?.state?.toUpperCase() ?? 'IDLE';
      body.role = agent?.role ?? 'implementer';
      body.parentId = agent?.parentId ?? null;
      body.maxSpeed = MAX_SPEEDS[body.state] ?? 0.12;
      body.target = this.viewTargetProvider(agent, worldSnapshot, body.position);
    }

    // Compute forces and integrate
    const bodiesArr = Array.from(this.bodies.values());
    for (const body of bodiesArr) {
      body.prevPosition = [...body.position] as V3;
      const force = this.computeForces(body, bodiesArr);
      this.integrate(body, force);
    }
  }

  // ── Body management ──

  private syncBodies(agents: AgentSnapshot[]) {
    const activeIds = new Set(agents.map(a => a.id));

    // Remove departed agents
    for (const id of this.bodies.keys()) {
      if (!activeIds.has(id)) this.bodies.delete(id);
    }

    // Add new agents
    for (const agent of agents) {
      if (!this.bodies.has(agent.id)) {
        this.addBody(agent);
      }
    }
  }

  addBody(agent: AgentSnapshot) {
    // Spawn near hive center with small random offset
    const hash = hashCode(agent.id);
    const angle = (hash % 360) * (Math.PI / 180);
    const r = 0.5 + Math.random() * 2;
    const pos: V3 = [Math.cos(angle) * r, 1 + Math.random() * 2, Math.sin(angle) * r];

    this.bodies.set(agent.id, {
      id: agent.id,
      position: pos,
      velocity: [0, 0, 0],
      prevPosition: [...pos] as V3,
      target: HIVE_CENTER,
      role: agent.role ?? 'implementer',
      state: agent.state?.toUpperCase() ?? 'IDLE',
      maxSpeed: MAX_SPEEDS[agent.state?.toUpperCase() ?? 'IDLE'] ?? 0.12,
      parentId: agent.parentId ?? null,
    });
  }

  removeBody(id: string) {
    this.bodies.delete(id);
  }

  // ── Force computation ──

  private computeForces(body: PhysicsBody, allBodies: PhysicsBody[]): V3 {
    const f1 = this.forceTargetAttraction(body);
    const f2 = this.forceSeparation(body, allBodies);
    const f3 = this.forceAlignment(body, allBodies);
    const f4 = this.forceStateSpecific(body);

    const total: V3 = [
      f1[0] + f2[0] + f3[0] + f4[0],
      f1[1] + f2[1] + f3[1] + f4[1],
      f1[2] + f2[2] + f3[2] + f4[2],
    ];

    return v3ClampMag(total, MAX_FORCE);
  }

  /** Force 1: Target attraction */
  private forceTargetAttraction(body: PhysicsBody): V3 {
    const dx = body.target[0] - body.position[0];
    const dy = body.target[1] - body.position[1];
    const dz = body.target[2] - body.position[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.01) return [0, 0, 0];

    const strength = Math.min(dist * TARGET_ATTRACTION, 0.05);
    const dir = v3Normalize([dx, dy, dz]);
    return [dir[0] * strength, dir[1] * strength, dir[2] * strength];
  }

  /** Force 2: Separation */
  private forceSeparation(body: PhysicsBody, allBodies: PhysicsBody[]): V3 {
    const sepWeight = SEP_WEIGHTS[body.state] ?? 0.5;
    const force: V3 = [0, 0, 0];

    for (const other of allBodies) {
      if (other.id === body.id) continue;
      const dist = v3Dist(body.position, other.position);
      if (dist > SEP_RADIUS || dist < 0.001) continue;

      const dx = body.position[0] - other.position[0];
      const dy = body.position[1] - other.position[1];
      const dz = body.position[2] - other.position[2];
      const norm = v3Normalize([dx, dy, dz]);
      const strength = ((SEP_RADIUS - dist) / SEP_RADIUS) * sepWeight;
      force[0] += norm[0] * strength * 0.02;
      force[1] += norm[1] * strength * 0.02;
      force[2] += norm[2] * strength * 0.02;
    }

    return force;
  }

  /** Force 3: Alignment (with Gestalt grouping bonus) */
  private forceAlignment(body: PhysicsBody, allBodies: PhysicsBody[]): V3 {
    let avgVx = 0, avgVy = 0, avgVz = 0, count = 0;

    for (const other of allBodies) {
      if (other.id === body.id) continue;
      const dist = v3Dist(body.position, other.position);
      if (dist > ALIGN_RADIUS) continue;

      // Gestalt bonus: same role +0.3, same state +0.2
      let weight = 1.0;
      if (other.role === body.role) weight += 0.3;
      if (other.state === body.state) weight += 0.2;

      avgVx += other.velocity[0] * weight;
      avgVy += other.velocity[1] * weight;
      avgVz += other.velocity[2] * weight;
      count += weight;
    }

    if (count < 0.5) return [0, 0, 0];

    avgVx /= count;
    avgVy /= count;
    avgVz /= count;

    return [
      (avgVx - body.velocity[0]) * ALIGNMENT_WEIGHT,
      (avgVy - body.velocity[1]) * ALIGNMENT_WEIGHT,
      (avgVz - body.velocity[2]) * ALIGNMENT_WEIGHT,
    ];
  }

  /** Force 4: State-specific forces */
  private forceStateSpecific(body: PhysicsBody): V3 {
    const state = body.state;

    if (state === 'IDLE') {
      // Weak hive center attraction
      return [
        (HIVE_CENTER[0] - body.position[0]) * 0.0005,
        (HIVE_CENTER[1] - body.position[1]) * 0.0005,
        (HIVE_CENTER[2] - body.position[2]) * 0.0005,
      ];
    }

    if (state === 'REPORTING') {
      // 8-figure Lissajous motion
      const t = this.time * 2;
      return [
        Math.cos(t * 2) * 0.3,
        Math.sin(t * 4) * 0.15,
        Math.cos(t) * 0.05,
      ];
    }

    if (state === 'ACTIVE') {
      // Very weak hive center attraction
      return [
        (HIVE_CENTER[0] - body.position[0]) * 0.0002,
        (HIVE_CENTER[1] - body.position[1]) * 0.0002,
        (HIVE_CENTER[2] - body.position[2]) * 0.0002,
      ];
    }

    // EXECUTING: no extra force (target attraction is sufficient)
    return [0, 0, 0];
  }

  // ── Integration ──

  private integrate(body: PhysicsBody, force: V3) {
    // Apply force
    body.velocity[0] = (body.velocity[0] + force[0]) * DAMPING;
    body.velocity[1] = (body.velocity[1] + force[1]) * DAMPING;
    body.velocity[2] = (body.velocity[2] + force[2]) * DAMPING;

    // Apply drag
    body.velocity[0] -= body.velocity[0] * DRAG;
    body.velocity[1] -= body.velocity[1] * DRAG;
    body.velocity[2] -= body.velocity[2] * DRAG;

    // Clamp speed
    const speed = v3Length(body.velocity);
    if (speed > body.maxSpeed) {
      const s = body.maxSpeed / speed;
      body.velocity[0] *= s;
      body.velocity[1] *= s;
      body.velocity[2] *= s;
    }

    // Update position
    body.position[0] += body.velocity[0];
    body.position[1] += body.velocity[1];
    body.position[2] += body.velocity[2];

    // Boundary constraints
    if (Math.abs(body.position[0]) > BOUNDARY) {
      body.velocity[0] *= -0.5;
      body.position[0] = Math.max(-BOUNDARY, Math.min(BOUNDARY, body.position[0]));
    }
    if (body.position[1] < MIN_Y) {
      body.velocity[1] = Math.abs(body.velocity[1]) * 0.3;
      body.position[1] = MIN_Y;
    }
    if (body.position[1] > MAX_Y) {
      body.velocity[1] *= -0.5;
      body.position[1] = MAX_Y;
    }
    if (Math.abs(body.position[2]) > BOUNDARY) {
      body.velocity[2] *= -0.5;
      body.position[2] = Math.max(-BOUNDARY, Math.min(BOUNDARY, body.position[2]));
    }
  }

  // ── Public API ──

  /** Get interpolated position for rendering (between prev and current) */
  getInterpolatedPosition(id: string, alpha: number): V3 | null {
    const body = this.bodies.get(id);
    if (!body) return null;
    return v3Lerp(body.prevPosition, body.position, alpha);
  }

  /** Get current velocity for rotation */
  getVelocity(id: string): V3 | null {
    const body = this.bodies.get(id);
    return body ? body.velocity : null;
  }

  /** Get body (for reading state, position, etc.) */
  getBody(id: string): PhysicsBody | undefined {
    return this.bodies.get(id);
  }

  /** Get all body IDs */
  getBodyIds(): string[] {
    return Array.from(this.bodies.keys());
  }

  /** Body count */
  get bodyCount(): number {
    return this.bodies.size;
  }
}

// ── Utility ──

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
