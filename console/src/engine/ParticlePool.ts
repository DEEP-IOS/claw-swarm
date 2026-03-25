/**
 * ParticlePool — GPU InstancedMesh particle system, max 5000
 *
 * Uses THREE.InstancedMesh with DynamicDrawUsage for zero-allocation
 * per-frame updates. Object pool pattern recycles dead particles.
 * Per-particle color via instanceColor attribute.
 */

import * as THREE from 'three';
import { PERF } from './constants';

// ── Types ───────────────────────────────────────────────────────────────────

export interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  size: number;
  life: number;       // 0→dead, 1→full
  decay: number;      // life lost per second
  type: string;
  blinkHz: number;    // 0 = no blink
  age: number;        // seconds since emit
  // Size/opacity over life (4-point curve: birth, grow, sustain, death)
  sizeOverLife: [number, number, number, number] | null;
  opacityOverLife: [number, number, number, number] | null;
}

export interface ParticleEmitConfig {
  position: THREE.Vector3;
  velocity?: THREE.Vector3;
  color: string;
  size?: number;
  life?: number;
  decay?: number;
  type?: string;
  count?: number;
  blinkHz?: number;
  sizeOverLife?: [number, number, number, number];
  opacityOverLife?: [number, number, number, number];
  // Spread: random cone around velocity direction
  spread?: number;    // radians
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sampleCurve(curve: [number, number, number, number], t: number): number {
  // t in [0,1] → interpolate 4-point curve
  const clamped = Math.max(0, Math.min(1, t));
  const idx = clamped * 3;
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, 3);
  const frac = idx - lo;
  return curve[lo] + (curve[hi] - curve[lo]) * frac;
}

function randomDirection(): THREE.Vector3 {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
  );
}

function spreadVelocity(base: THREE.Vector3, spreadAngle: number): THREE.Vector3 {
  if (spreadAngle <= 0 || base.lengthSq() < 0.0001) return base.clone();
  const dir = base.clone().normalize();
  const perp = new THREE.Vector3();
  if (Math.abs(dir.y) < 0.99) {
    perp.crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  } else {
    perp.crossVectors(dir, new THREE.Vector3(1, 0, 0)).normalize();
  }
  const perp2 = new THREE.Vector3().crossVectors(dir, perp);
  const angle = (Math.random() - 0.5) * spreadAngle;
  const angle2 = Math.random() * Math.PI * 2;
  const result = dir.clone()
    .add(perp.multiplyScalar(Math.sin(angle) * Math.cos(angle2)))
    .add(perp2.multiplyScalar(Math.sin(angle) * Math.sin(angle2)))
    .normalize()
    .multiplyScalar(base.length());
  return result;
}

// ── ParticlePool ────────────────────────────────────────────────────────────

export class ParticlePool {
  private mesh: THREE.InstancedMesh;
  private active: Particle[] = [];
  private pool: Particle[] = [];
  private dummy = new THREE.Object3D();
  private maxCount: number;
  private colorAttr: THREE.InstancedBufferAttribute;

  constructor(maxCount = PERF.MAX_PARTICLES) {
    this.maxCount = maxCount;
    const geometry = new THREE.SphereGeometry(0.1, 6, 4);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, this.maxCount);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;

    // Per-instance colors
    const colors = new Float32Array(this.maxCount * 3);
    this.colorAttr = new THREE.InstancedBufferAttribute(colors, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = this.colorAttr;
  }

  /** Get the mesh to add to Three.js scene */
  getMesh(): THREE.InstancedMesh {
    return this.mesh;
  }

  /** Current active particle count */
  get count(): number {
    return this.active.length;
  }

  /** Emit particles */
  emit(config: ParticleEmitConfig): void {
    const count = config.count ?? 1;
    const color = new THREE.Color(config.color);

    for (let i = 0; i < count; i++) {
      if (this.active.length >= this.maxCount) break;

      const p = this.pool.pop() ?? this._createParticle();
      p.position.copy(config.position);
      p.velocity.copy(
        config.velocity
          ? (config.spread ? spreadVelocity(config.velocity, config.spread) : config.velocity)
          : new THREE.Vector3(0, 0, 0),
      );
      p.color.copy(color);
      p.size = config.size ?? 0.1;
      p.life = config.life ?? 1.0;
      p.decay = config.decay ?? 1.0;
      p.type = config.type ?? 'generic';
      p.blinkHz = config.blinkHz ?? 0;
      p.age = 0;
      p.sizeOverLife = config.sizeOverLife ?? null;
      p.opacityOverLife = config.opacityOverLife ?? null;

      this.active.push(p);
    }
  }

  /** Update all particles. Call once per frame. */
  tick(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.age += dt;
      p.life -= p.decay * dt;

      // Physics: position += velocity * dt
      p.position.addScaledVector(p.velocity, dt);

      // Gravity-like drift for some types
      if (p.type === 'alarm') {
        p.velocity.y -= 0.3 * dt;
      }

      if (p.life <= 0) {
        // Recycle
        this.pool.push(p);
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
      }
    }

    this._updateGPU();
  }

  /** Clear all particles */
  clear(): void {
    for (const p of this.active) this.pool.push(p);
    this.active.length = 0;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Dispose GPU resources */
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  // ── Internal ──

  private _createParticle(): Particle {
    return {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      color: new THREE.Color(),
      size: 0.1,
      life: 1,
      decay: 1,
      type: 'generic',
      blinkHz: 0,
      age: 0,
      sizeOverLife: null,
      opacityOverLife: null,
    };
  }

  private _updateGPU(): void {
    const count = this.active.length;

    for (let i = 0; i < count; i++) {
      const p = this.active[i];
      const lifeT = 1 - Math.max(0, p.life);

      // Size from curve or simple life-based
      let size = p.size;
      if (p.sizeOverLife) {
        size *= sampleCurve(p.sizeOverLife, lifeT);
      } else {
        size *= Math.max(0, p.life);
      }

      // Blink effect
      if (p.blinkHz > 0) {
        const blink = Math.sin(p.age * p.blinkHz * Math.PI * 2);
        size *= 0.5 + 0.5 * Math.abs(blink);
      }

      this.dummy.position.copy(p.position);
      this.dummy.scale.setScalar(Math.max(0.001, size));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);

      // Opacity via color brightness modulation
      let opacity = 1;
      if (p.opacityOverLife) {
        opacity = sampleCurve(p.opacityOverLife, lifeT);
      } else {
        opacity = Math.max(0, p.life);
      }

      this.colorAttr.setXYZ(i,
        p.color.r * opacity,
        p.color.g * opacity,
        p.color.b * opacity,
      );
    }

    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }
}

export { randomDirection };
