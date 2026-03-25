/**
 * DisneyAnimator — 5 Disney animation principles for 3D + DOM
 *
 * 1. CLICK_SQUASH: Squash & stretch on bee click (300ms)
 * 2. ANTICIPATION: Scale dip before main action (120ms + 300ms)
 * 3. PANEL_OVERSHOOT: Panel slide-in with overshoot (-3%)
 * 4. ARC_PATH: Quadratic bezier arc paths for transitions
 * 5. SECONDARY: Delayed reactions on child objects
 *
 * All timings from V8 hard constraints (DISNEY constants).
 */

import * as THREE from 'three';
import { DISNEY } from './constants';

// ── Types ───────────────────────────────────────────────────────────────────

interface AnimationHandle {
  cancel: () => void;
}

// ── Easing functions ────────────────────────────────────────────────────────

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeOutElastic(t: number): number {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ── 1. CLICK_SQUASH: Squash & stretch ──────────────────────────────────────

/**
 * Squash & stretch animation on click.
 * Keyframes: 0→(1,1,1), 60ms→(1.1,0.9,1.1), 150ms→(0.95,1.05,0.95), 300ms→(1,1,1)
 */
export function clickSquash(object3D: THREE.Object3D, baseScale = 1): AnimationHandle {
  const duration = DISNEY.CLICK_SQUASH_DURATION;
  const start = performance.now();
  let cancelled = false;
  let raf: number;

  const keyframes = [
    { t: 0, sx: 1, sy: 1, sz: 1 },
    { t: 60 / duration, sx: 1.1, sy: 0.9, sz: 1.1 },
    { t: 150 / duration, sx: 0.95, sy: 1.05, sz: 0.95 },
    { t: 1, sx: 1, sy: 1, sz: 1 },
  ];

  function interpolateKeyframes(progress: number): [number, number, number] {
    // Find segment
    for (let i = 0; i < keyframes.length - 1; i++) {
      const a = keyframes[i];
      const b = keyframes[i + 1];
      if (progress >= a.t && progress <= b.t) {
        const segT = (progress - a.t) / (b.t - a.t);
        const e = easeOutBack(segT);
        return [
          a.sx + (b.sx - a.sx) * e,
          a.sy + (b.sy - a.sy) * e,
          a.sz + (b.sz - a.sz) * e,
        ];
      }
    }
    return [1, 1, 1];
  }

  function tick() {
    if (cancelled) return;
    const elapsed = performance.now() - start;
    const progress = Math.min(elapsed / duration, 1);

    const [sx, sy, sz] = interpolateKeyframes(progress);
    object3D.scale.set(sx * baseScale, sy * baseScale, sz * baseScale);

    if (progress < 1) {
      raf = requestAnimationFrame(tick);
    } else {
      object3D.scale.setScalar(baseScale);
    }
  }

  raf = requestAnimationFrame(tick);

  return {
    cancel: () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      object3D.scale.setScalar(baseScale);
    },
  };
}

// ── 2. ANTICIPATION: Scale dip before main action ──────────────────────────

/**
 * Anticipation: scale dips to 0.92 then returns to 1.0
 */
export function anticipation(
  object3D: THREE.Object3D,
  baseScale = 1,
  onComplete?: () => void,
): AnimationHandle {
  const preDuration = DISNEY.ANTICIPATION_PRE;
  const mainDuration = DISNEY.ANTICIPATION_MAIN;
  const totalDuration = preDuration + mainDuration;
  const start = performance.now();
  let cancelled = false;
  let raf: number;

  function tick() {
    if (cancelled) return;
    const elapsed = performance.now() - start;

    if (elapsed < preDuration) {
      // Dip phase
      const t = elapsed / preDuration;
      const scale = 1 - 0.08 * easeInOutCubic(t);
      object3D.scale.setScalar(scale * baseScale);
    } else if (elapsed < totalDuration) {
      // Recovery phase
      const t = (elapsed - preDuration) / mainDuration;
      const scale = 0.92 + 0.08 * easeOutBack(t);
      object3D.scale.setScalar(scale * baseScale);
    } else {
      object3D.scale.setScalar(baseScale);
      onComplete?.();
      return;
    }

    raf = requestAnimationFrame(tick);
  }

  raf = requestAnimationFrame(tick);
  return { cancel: () => { cancelled = true; cancelAnimationFrame(raf); } };
}

// ── 3. PANEL_OVERSHOOT: DOM panel slide-in with overshoot ──────────────────

/**
 * Panel overshoot: translateX 100% → -3% → 0% (400ms)
 * Uses CSS transition for best performance.
 */
export function panelOvershoot(element: HTMLElement): AnimationHandle {
  // Set initial state
  element.style.transform = 'translateX(100%)';
  element.style.transition = 'none';

  // Force reflow
  void element.offsetHeight;

  // Start animation
  element.style.transition = `transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1)`;
  element.style.transform = 'translateX(0)';

  const cleanup = () => {
    element.style.transition = '';
  };

  const timer = setTimeout(cleanup, 420);

  return {
    cancel: () => {
      clearTimeout(timer);
      element.style.transition = 'none';
      element.style.transform = 'translateX(100%)';
    },
  };
}

/**
 * Panel slide-out: 0% → 100% (300ms)
 */
export function panelSlideOut(element: HTMLElement): AnimationHandle {
  element.style.transition = 'transform 300ms ease-in';
  element.style.transform = 'translateX(100%)';

  const timer = setTimeout(() => {
    element.style.transition = '';
  }, 320);

  return {
    cancel: () => {
      clearTimeout(timer);
      element.style.transition = 'none';
    },
  };
}

// ── 4. ARC_PATH: Quadratic bezier arc ──────────────────────────────────────

/**
 * Create a quadratic bezier curve with arc offset (30% of distance vertically)
 */
export function arcPath(
  start: THREE.Vector3,
  end: THREE.Vector3,
  arcOffset = DISNEY.ARC_PATH_OFFSET,
): THREE.QuadraticBezierCurve3 {
  const mid = start.clone().add(end).multiplyScalar(0.5);
  const dist = start.distanceTo(end);
  mid.y += dist * arcOffset;
  return new THREE.QuadraticBezierCurve3(start, mid, end);
}

// ── 5. SECONDARY: Delayed reaction on children ─────────────────────────────

/**
 * Secondary reaction: children animate with delay and reduced amplitude
 */
export function secondaryReaction(
  children: THREE.Object3D[],
  parentScale: number,
  delay = DISNEY.SECONDARY_DELAY,
  amplitude = DISNEY.SECONDARY_SCALE,
): AnimationHandle {
  let cancelled = false;

  const timer = setTimeout(() => {
    if (cancelled) return;
    for (const child of children) {
      const delta = (parentScale - 1) * amplitude;
      child.scale.setScalar(1 + delta);

      // Return to normal over 300ms
      const start = performance.now();
      const animate = () => {
        if (cancelled) return;
        const elapsed = performance.now() - start;
        const t = Math.min(elapsed / 300, 1);
        child.scale.setScalar(1 + delta * (1 - easeOutElastic(t)));
        if (t < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    }
  }, delay);

  return {
    cancel: () => {
      cancelled = true;
      clearTimeout(timer);
    },
  };
}
