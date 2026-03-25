/**
 * SpringSystem — 5 preset spring configurations for physics-driven animation
 *
 * Uses critically/over/under-damped spring math for smooth transitions.
 * Each preset defines stiffness, damping, and mass.
 */

export interface SpringPreset {
  stiffness: number;
  damping: number;
  mass: number;
}

export interface SpringState {
  position: number;
  velocity: number;
}

/** 5 spring presets from V8 design spec */
export const SPRING_PRESETS: Record<string, SpringPreset> = {
  interaction: { stiffness: 300, damping: 24, mass: 1 },
  navigation:  { stiffness: 200, damping: 20, mass: 1 },
  morphing:    { stiffness: 150, damping: 18, mass: 1.2 },
  gentle:      { stiffness: 100, damping: 15, mass: 1.5 },
  bounce:      { stiffness: 400, damping: 10, mass: 0.8 },
};

/**
 * Advance a spring one step
 * @param current  Current position
 * @param target   Target position
 * @param velocity Current velocity
 * @param preset   Spring configuration
 * @param dt       Time step (default 1/60)
 * @returns Updated { position, velocity }
 */
export function springStep(
  current: number,
  target: number,
  velocity: number,
  preset: SpringPreset,
  dt = 1 / 60,
): SpringState {
  const displacement = current - target;
  const springForce = -preset.stiffness * displacement;
  const dampingForce = -preset.damping * velocity;
  const acceleration = (springForce + dampingForce) / preset.mass;
  const newVelocity = velocity + acceleration * dt;
  const newPosition = current + newVelocity * dt;
  return { position: newPosition, velocity: newVelocity };
}

/** 3D spring step — applies spring independently to x, y, z */
export function springStep3D(
  current: [number, number, number],
  target: [number, number, number],
  velocity: [number, number, number],
  preset: SpringPreset,
  dt = 1 / 60,
): { position: [number, number, number]; velocity: [number, number, number] } {
  const rx = springStep(current[0], target[0], velocity[0], preset, dt);
  const ry = springStep(current[1], target[1], velocity[1], preset, dt);
  const rz = springStep(current[2], target[2], velocity[2], preset, dt);
  return {
    position: [rx.position, ry.position, rz.position],
    velocity: [rx.velocity, ry.velocity, rz.velocity],
  };
}

/**
 * Check if spring is "at rest" (close enough to target and nearly zero velocity)
 */
export function springAtRest(
  current: number,
  target: number,
  velocity: number,
  epsilon = 0.001,
): boolean {
  return Math.abs(current - target) < epsilon && Math.abs(velocity) < epsilon;
}
