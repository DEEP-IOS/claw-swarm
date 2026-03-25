/**
 * Pheromone Store — Zustand store for pheromone concentration tracking
 *
 * Derives per-type max intensity from WorldSnapshot pheromones.
 * Provides aggregated view for PheromoneBar UI + heatmap coloring.
 */

import { create } from 'zustand';
import type { PheromoneSnapshot } from '../api/ws-bridge';

// ── Types ───────────────────────────────────────────────────────────────────

export type PheromoneType = 'trail' | 'alarm' | 'recruit' | 'dance' | 'queen' | 'food';

export interface PheromoneLevel {
  type: PheromoneType;
  maxIntensity: number;     // highest intensity among all pheromones of this type
  count: number;            // number of active pheromones of this type
  avgIntensity: number;     // average intensity
}

interface PheromoneState {
  levels: Record<PheromoneType, PheromoneLevel>;
  totalCount: number;
  /** Update from a WorldSnapshot pheromone array */
  updateFromSnapshot: (pheromones: PheromoneSnapshot[]) => void;
}

// ── Default levels ──────────────────────────────────────────────────────────

export const PHEROMONE_TYPES: PheromoneType[] = ['trail', 'alarm', 'recruit', 'dance', 'queen', 'food'];

const PHEROMONE_TYPE_ALIASES: Record<string, PheromoneType> = {
  progress: 'trail',
  dependency: 'trail',
  success: 'food',
  warning: 'alarm',
  failure: 'alarm',
  conflict: 'alarm',
  collaboration: 'recruit',
  dispatch: 'recruit',
  checkpoint: 'queen',
  discovery: 'dance',
};

export function normalizePheromoneType(pheromone: PheromoneSnapshot): PheromoneType | null {
  const type = pheromone.canonicalType ?? pheromone.type;
  if (PHEROMONE_TYPES.includes(type as PheromoneType)) {
    return type as PheromoneType;
  }

  return PHEROMONE_TYPE_ALIASES[pheromone.type] ?? null;
}

function defaultLevels(): Record<PheromoneType, PheromoneLevel> {
  const result = {} as Record<PheromoneType, PheromoneLevel>;
  for (const t of PHEROMONE_TYPES) {
    result[t] = { type: t, maxIntensity: 0, count: 0, avgIntensity: 0 };
  }
  return result;
}

// ── Store ───────────────────────────────────────────────────────────────────

export const usePheromoneStore = create<PheromoneState>((set) => ({
  levels: defaultLevels(),
  totalCount: 0,

  updateFromSnapshot: (pheromones) => {
    const levels = defaultLevels();
    let totalCount = 0;

    for (const p of pheromones) {
      const type = normalizePheromoneType(p);
      if (!type) continue;
      if (!levels[type]) continue;

      levels[type].count++;
      totalCount++;
      if (p.intensity > levels[type].maxIntensity) {
        levels[type].maxIntensity = p.intensity;
      }
      levels[type].avgIntensity += p.intensity;
    }

    // Compute averages
    for (const t of PHEROMONE_TYPES) {
      if (levels[t].count > 0) {
        levels[t].avgIntensity /= levels[t].count;
      }
    }

    set({ levels, totalCount });
  },
}));

/**
 * Get all pheromone types with their display info
 */
export function getPheromoneTypeInfo(): Array<{
  type: PheromoneType;
  label: string;
  color: string;
}> {
  return [
    { type: 'trail', label: 'Trail', color: '#F5A623' },
    { type: 'alarm', label: 'Alarm', color: '#EF4444' },
    { type: 'recruit', label: 'Recruit', color: '#3B82F6' },
    { type: 'dance', label: 'Knowledge', color: '#10B981' },
    { type: 'queen', label: 'Directive', color: '#8B5CF6' },
    { type: 'food', label: 'Success', color: '#84CC16' },
  ];
}
