/**
 * AtmosphereVFX — Radar sweep + dust interaction + glitch trigger
 *
 * Radar: Golden scanning sector, 2s per revolution, centered at hive.
 * Dust interaction: Bees push nearby dust particles (2× body radius).
 * Glitch: Triggered when alarm > 0.7 or any breaker OPEN.
 */

import * as THREE from 'three';
import { ATMOSPHERE } from './constants';

// ── Radar ───────────────────────────────────────────────────────────────────

export interface RadarState {
  angle: number;           // current angle in radians
  mesh: THREE.Mesh | null;
}

/**
 * Create radar sweep mesh: semi-transparent golden sector (30° arc)
 */
export function createRadarMesh(): THREE.Mesh {
  // Sector shape (30° = π/6)
  const sectorAngle = Math.PI / 6;
  const radius = 15;
  const segments = 16;
  const shape = new THREE.Shape();

  shape.moveTo(0, 0);
  for (let i = 0; i <= segments; i++) {
    const a = -sectorAngle / 2 + (sectorAngle / segments) * i;
    shape.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
  }
  shape.lineTo(0, 0);

  const geometry = new THREE.ShapeGeometry(shape);
  const material = new THREE.MeshBasicMaterial({
    color: '#F5A623',
    transparent: true,
    opacity: ATMOSPHERE.RADAR_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  // Lay flat on XZ plane (rotate from XY to XZ)
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.15; // Just above hex floor
  mesh.frustumCulled = false;

  return mesh;
}

/**
 * Update radar rotation. Called per frame.
 * @param mesh The radar mesh
 * @param elapsedTime Clock elapsed time in seconds
 */
export function updateRadar(mesh: THREE.Mesh, elapsedTime: number): void {
  // Full rotation in RADAR_PERIOD ms
  const periodSec = ATMOSPHERE.RADAR_PERIOD / 1000;
  mesh.rotation.z = (elapsedTime / periodSec) * Math.PI * 2;
}

/**
 * Check if an agent is within the radar sweep beam.
 * Used to temporarily brighten bees as the radar passes.
 * @param agentPos Agent world position
 * @param radarAngle Current radar angle (radians)
 * @param beamWidth Angular width of the beam (radians)
 * @returns 0-1 intensity (1 = center of beam, 0 = outside)
 */
export function radarSweepIntensity(
  agentPos: [number, number, number],
  radarAngle: number,
  beamWidth = Math.PI / 6,
): number {
  const agentAngle = Math.atan2(agentPos[2], agentPos[0]);
  let diff = agentAngle - radarAngle;
  // Normalize to [-π, π]
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;

  const halfBeam = beamWidth / 2;
  if (Math.abs(diff) > halfBeam) return 0;
  return 1 - Math.abs(diff) / halfBeam;
}

// ── Dust Interaction ────────────────────────────────────────────────────────

/**
 * Push dust particles away from bee positions.
 * Call per frame for the dust Points geometry.
 * @param dustPositions Float32Array of dust positions
 * @param beePositions Array of [x,y,z] bee positions
 * @param pushRadius Distance at which bees push dust (default 2.0)
 * @param pushStrength Push force multiplier (default 0.005)
 */
export function pushDustFromBees(
  dustPositions: Float32Array,
  beePositions: Array<[number, number, number]>,
  pushRadius = 2.0,
  pushStrength = 0.005,
): void {
  const count = dustPositions.length / 3;
  const pushRadiusSq = pushRadius * pushRadius;

  for (let i = 0; i < count; i++) {
    const dx = dustPositions[i * 3];
    const dy = dustPositions[i * 3 + 1];
    const dz = dustPositions[i * 3 + 2];

    for (const bp of beePositions) {
      const ddx = dx - bp[0];
      const ddy = dy - bp[1];
      const ddz = dz - bp[2];
      const distSq = ddx * ddx + ddy * ddy + ddz * ddz;

      if (distSq < pushRadiusSq && distSq > 0.01) {
        const dist = Math.sqrt(distSq);
        const force = pushStrength * (1 - dist / pushRadius);
        dustPositions[i * 3] += (ddx / dist) * force;
        dustPositions[i * 3 + 1] += (ddy / dist) * force;
        dustPositions[i * 3 + 2] += (ddz / dist) * force;
      }
    }
  }
}

// ── Glitch Detection ────────────────────────────────────────────────────────

export interface GlitchState {
  active: boolean;
  startTime: number;
  duration: number;
}

/**
 * Check if glitch should be triggered.
 * Triggers on: alarm pheromone > 0.7 OR any circuit breaker OPEN.
 */
export function shouldTriggerGlitch(
  pheromones: Array<{ type: string; intensity: number }>,
  breakers: Record<string, { state: string }>,
): boolean {
  // Check alarm pheromone
  for (const p of pheromones) {
    if (p.type === 'alarm' && p.intensity > 0.7) return true;
  }
  // Check circuit breakers
  for (const key of Object.keys(breakers)) {
    if (breakers[key].state === 'OPEN') return true;
  }
  return false;
}

/**
 * Update glitch state. Returns whether glitch effect should be rendered.
 */
export function updateGlitch(
  glitch: GlitchState,
  shouldTrigger: boolean,
  now: number,
): boolean {
  if (shouldTrigger && !glitch.active) {
    glitch.active = true;
    glitch.startTime = now;
    glitch.duration = ATMOSPHERE.GLITCH_DURATION;
  }

  if (glitch.active && now - glitch.startTime > glitch.duration) {
    glitch.active = false;
  }

  return glitch.active;
}
