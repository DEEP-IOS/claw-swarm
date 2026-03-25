/**
 * SoulVisualMapper — soul.md text → 4D personality → 3D visual params
 *
 * Parses Chinese/English keywords from soul text to derive
 * { creativity, caution, speed, empathy } dimensions.
 * Then maps those to visual parameters (scale, wingHz, emissive, color shift, effects).
 */

import { ROLE_PARAMS, STATE_PARAMS } from './constants';

// ── Types ───────────────────────────────────────────────────────────────────

export interface SoulDimensions {
  creativity: number;
  caution: number;
  speed: number;
  empathy: number;
}

export interface VisualParams {
  scale: number;
  wingHz: number;
  emissiveBoost: number;
  hueShift: number;         // degrees
  saturationMod: number;    // multiplier
  lightnessMod: number;     // multiplier
  trailLength: number;      // frames
  specialEffect: string | null;
}

// ── Keyword dictionary (30+ entries) ────────────────────────────────────────

interface KeywordDeltas {
  creativity?: number;
  caution?: number;
  speed?: number;
  empathy?: number;
}

const KEYWORDS: Array<[string[], KeywordDeltas]> = [
  // creativity
  [['创造', 'creative'],                  { creativity: 0.3 }],
  [['创新', 'innovative'],               { creativity: 0.3 }],
  [['探索', 'explore'],                   { creativity: 0.2, caution: -0.1, speed: 0.1 }],
  [['想象', 'imaginative'],               { creativity: 0.2 }],
  [['架构', 'architecture'],              { creativity: 0.2, caution: 0.1 }],
  [['设计', 'design'],                     { creativity: 0.2 }],
  [['冒险', 'adventurous'],               { creativity: 0.2, caution: -0.2, speed: 0.1 }],
  // caution
  [['谨慎', 'careful'],                   { caution: 0.3, speed: -0.1 }],
  [['严格', 'strict'],                     { creativity: -0.1, caution: 0.3, empathy: -0.1 }],
  [['精确', 'precise'],                   { caution: 0.2 }],
  [['细致', 'meticulous', '细节'],        { caution: 0.3 }],
  [['安全', 'security'],                  { caution: 0.3 }],
  [['审查', 'review'],                     { caution: 0.2 }],
  [['测试', 'testing'],                   { caution: 0.2 }],
  [['分析', 'analytical'],               { caution: 0.2 }],
  [['逻辑', 'logical'],                   { caution: 0.2 }],
  [['调试', 'debug'],                     { caution: 0.1, speed: 0.1 }],
  // speed
  [['快速', 'fast'],                       { caution: -0.1, speed: 0.3 }],
  [['高效', 'efficient'],                 { speed: 0.3 }],
  [['敏捷', 'agile'],                     { creativity: 0.1, speed: 0.2 }],
  [['果断', 'decisive'],                  { creativity: 0.1, speed: 0.2 }],
  // empathy
  [['合作', 'cooperative'],               { empathy: 0.3 }],
  [['友好', 'friendly', '友善'],          { empathy: 0.3 }],
  [['理解', 'empathetic', '倾听'],        { caution: 0.1, empathy: 0.3 }],
  [['支持', 'supportive'],               { empathy: 0.2 }],
  [['领导', 'leader'],                     { creativity: 0.1, caution: 0.1, empathy: 0.2 }],
  [['沟通', 'communicate'],               { empathy: 0.2 }],
  [['协调', 'coordinate'],               { caution: 0.1, empathy: 0.2 }],
  [['耐心', 'patient'],                   { caution: 0.1, speed: -0.1, empathy: 0.2 }],
  [['独立', 'independent'],               { creativity: 0.1, speed: 0.1, empathy: -0.1 }],
];

// ── Parser ──────────────────────────────────────────────────────────────────

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Parse soul text into 4D personality dimensions
 */
export function parseSoul(soulText: string): SoulDimensions {
  const dims = { creativity: 0, caution: 0, speed: 0, empathy: 0 };
  if (!soulText) return dims;

  const text = soulText.toLowerCase();

  for (const [keywords, deltas] of KEYWORDS) {
    for (const kw of keywords) {
      if (text.includes(kw)) {
        if (deltas.creativity) dims.creativity += deltas.creativity;
        if (deltas.caution) dims.caution += deltas.caution;
        if (deltas.speed) dims.speed += deltas.speed;
        if (deltas.empathy) dims.empathy += deltas.empathy;
        break; // Only match first keyword in group
      }
    }
  }

  // Clamp each dimension to [0, 1]
  dims.creativity = clamp01(dims.creativity);
  dims.caution = clamp01(dims.caution);
  dims.speed = clamp01(dims.speed);
  dims.empathy = clamp01(dims.empathy);

  // Normalize: total should not exceed 2.0
  const total = dims.creativity + dims.caution + dims.speed + dims.empathy;
  if (total > 2.0) {
    const factor = 2.0 / total;
    dims.creativity *= factor;
    dims.caution *= factor;
    dims.speed *= factor;
    dims.empathy *= factor;
  }

  return dims;
}

/**
 * Convert 4D soul dimensions to 3D visual parameters
 */
export function toVisualParams(
  dims: SoulDimensions,
  role: string,
  state: string,
): VisualParams {
  const rp = ROLE_PARAMS[role] ?? ROLE_PARAMS.implementer;
  const sp = STATE_PARAMS[state?.toUpperCase()] ?? STATE_PARAMS.IDLE;

  const scale = rp.scale * (1 + dims.caution * 0.2 - dims.speed * 0.15);
  const wingHz = rp.wingHz + (dims.speed * 6 - dims.caution * 3);
  const emissiveBoost = sp.emissive + dims.empathy * 0.5;
  const hueShift = dims.creativity * 30;
  const saturationMod = 1 + dims.empathy * 0.2;
  const lightnessMod = 1 + dims.speed * 0.1;
  const trailLength = 15 + dims.speed * 25 + dims.creativity * 10;

  // Determine special effect
  let specialEffect: string | null = null;
  if (dims.creativity > 0.7) specialEffect = 'sparks';
  else if (dims.caution > 0.7) specialEffect = 'shield';
  else if (dims.speed > 0.7) specialEffect = 'long_trail';
  else if (dims.empathy > 0.7) specialEffect = 'warm_glow';
  else if (dims.creativity > 0.5 && dims.speed > 0.5) specialEffect = 'rainbow_wings';
  else if (dims.caution > 0.5 && dims.empathy > 0.5) specialEffect = 'mentor_aura';

  return {
    scale,
    wingHz,
    emissiveBoost,
    hueShift,
    saturationMod,
    lightnessMod,
    trailLength,
    specialEffect,
  };
}

/**
 * Cache for parsed soul dimensions (avoids re-parsing every frame)
 */
const soulCache = new Map<string, SoulDimensions>();

export function getCachedSoulDims(agentId: string, soulText: string | null): SoulDimensions {
  if (!soulText) return { creativity: 0, caution: 0, speed: 0, empathy: 0 };

  const cached = soulCache.get(agentId);
  if (cached) return cached;

  const dims = parseSoul(soulText);
  soulCache.set(agentId, dims);
  return dims;
}

export function clearSoulCache(agentId?: string) {
  if (agentId) soulCache.delete(agentId);
  else soulCache.clear();
}
