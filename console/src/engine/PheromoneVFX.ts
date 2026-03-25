/**
 * Canonical V9 pheromone visual effect configurations.
 *
 * The current runtime exposes six canonical pheromone types:
 * trail, alarm, recruit, dance, queen, and food.
 */

import * as THREE from 'three';
import { PHEROMONE_COLORS } from './constants';
import type { ParticleEmitConfig } from './ParticlePool';
import { randomDirection } from './ParticlePool';

export type PheromoneType = 'trail' | 'alarm' | 'recruit' | 'dance' | 'queen' | 'food';

export interface PheromoneVFXConfig {
  type: PheromoneType;
  color: string;
  emitRate: number;
  burstCount: number;
  particleSize: number;
  life: number;
  decay: number;
  blinkHz: number;
  sizeOverLife: [number, number, number, number] | null;
  opacityOverLife: [number, number, number, number] | null;
  velocityFn: (beeVelocity: THREE.Vector3) => THREE.Vector3;
  spread: number;
  useSpecialGeometry: boolean;
  ringInterval: number;
  ringMaxRadius: number;
  ringSpeed: number;
  lightIntensity: number;
  glowRadius: number;
  pulseHz: number;
  markerSize: number;
}

const TRAIL: PheromoneVFXConfig = {
  type: 'trail',
  color: PHEROMONE_COLORS.trail,
  emitRate: 15,
  burstCount: 0,
  particleSize: 0.08,
  life: 1.7,
  decay: 1 / 1.7,
  blinkHz: 0,
  sizeOverLife: [1.0, 1.3, 0.6, 0],
  opacityOverLife: [0.8, 0.6, 0.24, 0],
  velocityFn: (beeVel) => beeVel.clone().multiplyScalar(-0.3),
  spread: 0.2,
  useSpecialGeometry: false,
  ringInterval: 0,
  ringMaxRadius: 0,
  ringSpeed: 0,
  lightIntensity: 0,
  glowRadius: 0,
  pulseHz: 0,
  markerSize: 0,
};

const ALARM: PheromoneVFXConfig = {
  type: 'alarm',
  color: PHEROMONE_COLORS.alarm,
  emitRate: 0,
  burstCount: 18,
  particleSize: 0.15,
  life: 0.4,
  decay: 1 / 0.4,
  blinkHz: 5,
  sizeOverLife: [0.5, 1.0, 0.8, 0],
  opacityOverLife: [1.0, 0.8, 0.4, 0],
  velocityFn: () => randomDirection().multiplyScalar(0.3 + Math.random() * 0.2),
  spread: 0,
  useSpecialGeometry: false,
  ringInterval: 0,
  ringMaxRadius: 0,
  ringSpeed: 0,
  lightIntensity: 0,
  glowRadius: 0,
  pulseHz: 0,
  markerSize: 0,
};

const RECRUIT: PheromoneVFXConfig = {
  type: 'recruit',
  color: PHEROMONE_COLORS.recruit,
  emitRate: 0,
  burstCount: 0,
  particleSize: 0,
  life: 2.0,
  decay: 1 / 2.0,
  blinkHz: 0,
  sizeOverLife: null,
  opacityOverLife: null,
  velocityFn: () => new THREE.Vector3(),
  spread: 0,
  useSpecialGeometry: true,
  ringInterval: 300,
  ringMaxRadius: 8.0,
  ringSpeed: 0.15,
  lightIntensity: 0,
  glowRadius: 0,
  pulseHz: 0,
  markerSize: 0,
};

const DANCE: PheromoneVFXConfig = {
  type: 'dance',
  color: PHEROMONE_COLORS.dance,
  emitRate: 10,
  burstCount: 0,
  particleSize: 0.06,
  life: 0.6,
  decay: 1 / 0.6,
  blinkHz: 0,
  sizeOverLife: [0.8, 1.0, 0.5, 0],
  opacityOverLife: [0.7, 0.5, 0.2, 0],
  velocityFn: (beeVel) => beeVel.clone().multiplyScalar(0.1),
  spread: 0.4,
  useSpecialGeometry: false,
  ringInterval: 0,
  ringMaxRadius: 0,
  ringSpeed: 0,
  lightIntensity: 0,
  glowRadius: 0,
  pulseHz: 0,
  markerSize: 0,
};

const QUEEN: PheromoneVFXConfig = {
  type: 'queen',
  color: PHEROMONE_COLORS.queen,
  emitRate: 0,
  burstCount: 0,
  particleSize: 0,
  life: 0,
  decay: 0,
  blinkHz: 0,
  sizeOverLife: null,
  opacityOverLife: null,
  velocityFn: () => new THREE.Vector3(),
  spread: 0,
  useSpecialGeometry: true,
  ringInterval: 0,
  ringMaxRadius: 0,
  ringSpeed: 0,
  lightIntensity: 0.5,
  glowRadius: 4.0,
  pulseHz: 0.5,
  markerSize: 0,
};

const FOOD: PheromoneVFXConfig = {
  type: 'food',
  color: PHEROMONE_COLORS.food,
  emitRate: 0,
  burstCount: 0,
  particleSize: 0,
  life: 0,
  decay: 0,
  blinkHz: 0,
  sizeOverLife: null,
  opacityOverLife: null,
  velocityFn: () => new THREE.Vector3(),
  spread: 0,
  useSpecialGeometry: true,
  ringInterval: 0,
  ringMaxRadius: 0,
  ringSpeed: 0,
  lightIntensity: 0,
  glowRadius: 0,
  pulseHz: 0,
  markerSize: 0.15,
};

export const PHEROMONE_CONFIGS: Record<PheromoneType, PheromoneVFXConfig> = {
  trail: TRAIL,
  alarm: ALARM,
  recruit: RECRUIT,
  dance: DANCE,
  queen: QUEEN,
  food: FOOD,
};

export function buildEmitConfig(
  pheromoneType: PheromoneType,
  position: THREE.Vector3,
  beeVelocity?: THREE.Vector3,
): ParticleEmitConfig | null {
  const cfg = PHEROMONE_CONFIGS[pheromoneType];
  if (!cfg || cfg.useSpecialGeometry) return null;

  const vel = beeVelocity ?? new THREE.Vector3();
  const count = cfg.burstCount > 0 ? cfg.burstCount : 1;

  return {
    position: position.clone(),
    velocity: cfg.velocityFn(vel),
    color: cfg.color,
    size: cfg.particleSize,
    life: cfg.life,
    decay: cfg.decay,
    type: cfg.type,
    count,
    blinkHz: cfg.blinkHz,
    sizeOverLife: cfg.sizeOverLife ?? undefined,
    opacityOverLife: cfg.opacityOverLife ?? undefined,
    spread: cfg.spread,
  };
}

export function getAllPheromoneTypes(): PheromoneType[] {
  return ['trail', 'alarm', 'recruit', 'dance', 'queen', 'food'];
}
