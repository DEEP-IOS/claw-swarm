/**
 * PheromoneSystem — React Three Fiber pheromone visualization
 *
 * Consumes WorldSnapshot.pheromones + agent positions from PhysicsEngine.
 * Manages:
 *   - ParticlePool for trail/alarm/dance particles
 *   - Recruit expanding torus rings
 *   - Queen point light + glow sphere
 *   - Food directional markers for success-rich areas
 */

import { useRef, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ParticlePool } from '../engine/ParticlePool';
import { PHEROMONE_CONFIGS, buildEmitConfig } from '../engine/PheromoneVFX';
import { PHEROMONE_COLORS } from '../engine/constants';
import { useWorldStore } from '../stores/world-store';
import { normalizePheromoneType } from '../stores/pheromone-store';
import type { PhysicsEngine } from '../engine/PhysicsEngine';

// ── Types ───────────────────────────────────────────────────────────────────

interface PheromoneSystemProps {
  physicsEngine: PhysicsEngine;
}

interface RecruitRing {
  position: THREE.Vector3;
  radius: number;
  maxRadius: number;
  speed: number;
  opacity: number;
  color: string;
}

interface SpecialMarker {
  id: string;
  type: 'food';
  position: THREE.Vector3;
  intensity: number;
  color: string;
}

// ── Emit accumulators (track fractional emit rates) ─────────────────────────

const emitAccumulators = new Map<string, number>();

// ── Component ───────────────────────────────────────────────────────────────

export function PheromoneSystem({ physicsEngine }: PheromoneSystemProps) {
  const { scene } = useThree();
  const poolRef = useRef<ParticlePool | null>(null);
  const ringsRef = useRef<RecruitRing[]>([]);
  const ringMeshesRef = useRef<THREE.Mesh[]>([]);
  const queenLightRef = useRef<THREE.PointLight | null>(null);
  const queenGlowRef = useRef<THREE.Mesh | null>(null);
  const lastRingTimeRef = useRef<Map<string, number>>(new Map());

  // Initialize particle pool
  useEffect(() => {
    const pool = new ParticlePool(5000);
    poolRef.current = pool;
    scene.add(pool.getMesh());

    return () => {
      scene.remove(pool.getMesh());
      pool.dispose();
      poolRef.current = null;
    };
  }, [scene]);

  // Main per-frame update
  useFrame(({ clock }, dt) => {
    const pool = poolRef.current;
    if (!pool) return;

    const snapshot = useWorldStore.getState().snapshot;
    const pheromones = snapshot?.pheromones ?? [];
    const agents = snapshot?.agents ?? [];
    const now = clock.getElapsedTime() * 1000;

    // ── 1. Trail + Dance: continuous particles for active bees ──

    for (const agent of agents) {
      const state = agent.state?.toUpperCase() ?? 'IDLE';
      const pos = physicsEngine.getInterpolatedPosition(agent.id, 1.0);
      if (!pos) continue;

      const beePos = new THREE.Vector3(pos[0], pos[1], pos[2]);
      const vel = physicsEngine.getVelocity(agent.id);
      const beeVel = vel ? new THREE.Vector3(vel[0], vel[1], vel[2]) : new THREE.Vector3();

      // Trail particles for EXECUTING bees
      if (state === 'EXECUTING') {
        const cfg = PHEROMONE_CONFIGS.trail;
        const key = `trail-${agent.id}`;
        const acc = (emitAccumulators.get(key) ?? 0) + cfg.emitRate * dt;
        const toEmit = Math.floor(acc);
        emitAccumulators.set(key, acc - toEmit);

        for (let i = 0; i < toEmit; i++) {
          const emitCfg = buildEmitConfig('trail', beePos, beeVel);
          if (emitCfg) pool.emit(emitCfg);
        }
      } else {
        emitAccumulators.delete(`trail-${agent.id}`);
      }

      // Dance particles for REPORTING bees
      if (state === 'REPORTING') {
        const cfg = PHEROMONE_CONFIGS.dance;
        const key = `dance-${agent.id}`;
        const acc = (emitAccumulators.get(key) ?? 0) + cfg.emitRate * dt;
        const toEmit = Math.floor(acc);
        emitAccumulators.set(key, acc - toEmit);

        for (let i = 0; i < toEmit; i++) {
          const emitCfg = buildEmitConfig('dance', beePos, beeVel);
          if (emitCfg) pool.emit(emitCfg);
        }
      } else {
        emitAccumulators.delete(`dance-${agent.id}`);
      }
    }

    // ── 2. Alarm: burst on high alarm pheromone ──

    for (const p of pheromones) {
      const canonicalType = normalizePheromoneType(p);
      if (canonicalType === 'alarm' && p.intensity > 0.7) {
        const emitterId = p.emitterId;
        const pos = physicsEngine.getInterpolatedPosition(emitterId, 1.0);
        if (pos) {
          const key = `alarm-${p.id}`;
          if (!emitAccumulators.has(key)) {
            emitAccumulators.set(key, 1);
            const emitCfg = buildEmitConfig('alarm', new THREE.Vector3(pos[0], pos[1], pos[2]));
            if (emitCfg) pool.emit(emitCfg);
          }
        }
      }
    }

    // ── 3. Recruit rings ──

    for (const p of pheromones) {
      const canonicalType = normalizePheromoneType(p);
      if (canonicalType === 'recruit' && p.intensity > 0.3) {
        const cfg = PHEROMONE_CONFIGS.recruit;
        const lastTime = lastRingTimeRef.current.get(p.id) ?? 0;
        if (now - lastTime > cfg.ringInterval) {
          lastRingTimeRef.current.set(p.id, now);
          const emitterPos = physicsEngine.getInterpolatedPosition(p.emitterId, 1.0);
          if (emitterPos) {
            ringsRef.current.push({
              position: new THREE.Vector3(emitterPos[0], emitterPos[1], emitterPos[2]),
              radius: 0.5,
              maxRadius: cfg.ringMaxRadius,
              speed: cfg.ringSpeed,
              opacity: 0.6,
              color: cfg.color,
            });
          }
        }
      }
    }

    // Update recruit rings
    for (let i = ringsRef.current.length - 1; i >= 0; i--) {
      const ring = ringsRef.current[i];
      ring.radius += ring.speed;
      ring.opacity = 0.6 * (1 - ring.radius / ring.maxRadius);
      if (ring.radius >= ring.maxRadius || ring.opacity <= 0) {
        ringsRef.current.splice(i, 1);
      }
    }

    // ── 4. Queen light pulse ──

    const hasQueen = pheromones.some((p) => normalizePheromoneType(p) === 'queen' && p.intensity > 0.3);
    if (queenLightRef.current) {
      const targetIntensity = hasQueen
        ? PHEROMONE_CONFIGS.queen.lightIntensity * (0.7 + 0.3 * Math.sin(clock.getElapsedTime() * PHEROMONE_CONFIGS.queen.pulseHz * Math.PI * 2))
        : 0;
      queenLightRef.current.intensity += (targetIntensity - queenLightRef.current.intensity) * 0.1;
    }
    if (queenGlowRef.current) {
      const targetScale = hasQueen ? PHEROMONE_CONFIGS.queen.glowRadius : 0;
      const current = queenGlowRef.current.scale.x;
      queenGlowRef.current.scale.setScalar(current + (targetScale - current) * 0.05);
      const mat = queenGlowRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = hasQueen ? 0.08 * (0.7 + 0.3 * Math.sin(clock.getElapsedTime() * 0.5 * Math.PI * 2)) : 0;
    }

    // ── 5. Tick particle pool ──
    pool.tick(dt);
  });

  // ── Derived data for special geometry ──

  const snapshot = useWorldStore((s) => s.snapshot);
  const pheromones = snapshot?.pheromones ?? [];

  // Success markers
  const markers = useMemo<SpecialMarker[]>(() => {
    const result: SpecialMarker[] = [];
    for (const p of pheromones) {
      if (normalizePheromoneType(p) !== 'food' || p.intensity <= 0.2) continue;
      const pos = p.position
        ? new THREE.Vector3(p.position.x, p.position.y, p.position.z)
        : new THREE.Vector3(0, 1, 0);
      result.push({
        id: p.id,
        type: 'food',
        position: pos,
        intensity: p.intensity,
        color: PHEROMONE_COLORS.food,
      });
    }
    return result;
  }, [pheromones]);

  return (
    <group>
      {/* Queen glow sphere (always present, intensity controlled in useFrame) */}
      <pointLight
        ref={(ref) => { queenLightRef.current = ref; }}
        position={[0, 2, 0]}
        color={PHEROMONE_COLORS.queen}
        intensity={0}
        distance={PHEROMONE_CONFIGS.queen.glowRadius * 2}
      />
      <mesh
        ref={(ref) => { queenGlowRef.current = ref; }}
        position={[0, 2, 0]}
      >
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial
          color={PHEROMONE_COLORS.queen}
          transparent
          opacity={0}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>

      {/* Recruit expanding rings (dynamically generated) */}
      {ringsRef.current.map((ring, i) => (
        <mesh
          key={`ring-${i}`}
          position={ring.position}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[ring.radius, 0.03, 8, 32]} />
          <meshBasicMaterial
            color={ring.color}
            transparent
            opacity={ring.opacity}
            depthWrite={false}
          />
        </mesh>
      ))}

      {/* Success markers */}
      {markers.map(m => (
        <FoodMarker key={m.id} position={m.position} intensity={m.intensity} color={m.color} />
      ))}
    </group>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function FoodMarker({ position, intensity, color }: { position: THREE.Vector3; intensity: number; color: string }) {
  const ref = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.y = clock.getElapsedTime() * 0.5;
    ref.current.position.y = position.y + Math.sin(clock.getElapsedTime()) * 0.1;
  });

  return (
    <mesh ref={ref} position={position}>
      <coneGeometry args={[0.15 * intensity, 0.3 * intensity, 4]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.6 * intensity}
        depthWrite={false}
      />
    </mesh>
  );
}
