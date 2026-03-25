/**
 * HiveEnvironment — Hexagonal honeycomb floor + dust + radar + heatmap
 *
 * 200 hexagonal cells with pheromone-driven heatmap coloring.
 * Radar sweep (2s/revolution) brightens bees as it passes.
 * Dust particles float and get pushed by nearby bees.
 */

import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ATMOSPHERE, PHEROMONE_COLORS } from '../engine/constants';
import { createRadarMesh, updateRadar, pushDustFromBees } from '../engine/AtmosphereVFX';
import { normalizePheromoneType } from '../stores/pheromone-store';
import { useWorldStore } from '../stores/world-store';
import type { PhysicsEngine } from '../engine/PhysicsEngine';

const HEX_COUNT = 200;
const HEX_RADIUS = 0.5;
const HEX_GAP = 0.06;
const COLS = 16;

// Pre-compute hex world positions
const HEX_POSITIONS: Array<[number, number, number]> = [];
for (let i = 0; i < HEX_COUNT; i++) {
  const row = Math.floor(i / COLS);
  const col = i % COLS;
  const xSpacing = (HEX_RADIUS * 2 + HEX_GAP) * 0.866;
  const ySpacing = (HEX_RADIUS * 2 + HEX_GAP) * 0.75;
  const xOffset = row % 2 === 0 ? 0 : xSpacing / 2;
  const x = col * xSpacing + xOffset - (COLS * xSpacing) / 2;
  const z = row * ySpacing - (Math.ceil(HEX_COUNT / COLS) * ySpacing) / 2;
  HEX_POSITIONS.push([x, 0, z]);
}

interface HiveEnvironmentProps {
  physicsEngine?: PhysicsEngine;
}

export function HiveEnvironment({ physicsEngine }: HiveEnvironmentProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const wireRef = useRef<THREE.InstancedMesh>(null!);
  const dustRef = useRef<THREE.Points>(null!);
  const radarRef = useRef<THREE.Mesh | null>(null);
  const hexColorsRef = useRef<Float32Array | null>(null);

  // Set up hex positions + instanceColor
  useEffect(() => {
    if (!meshRef.current) return;
    const dummy = new THREE.Object3D();
    const colors = new Float32Array(HEX_COUNT * 3);
    const baseColor = new THREE.Color('#16162e');

    for (let i = 0; i < HEX_COUNT; i++) {
      const [x, y, z] = HEX_POSITIONS[i];
      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      // Also update wireframe overlay positions
      if (wireRef.current) {
        wireRef.current.setMatrixAt(i, dummy.matrix);
      }
      colors[i * 3] = baseColor.r;
      colors[i * 3 + 1] = baseColor.g;
      colors[i * 3 + 2] = baseColor.b;
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (wireRef.current) {
      wireRef.current.instanceMatrix.needsUpdate = true;
    }

    // Set up instanceColor attribute
    const colorAttr = new THREE.InstancedBufferAttribute(colors, 3);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    meshRef.current.instanceColor = colorAttr;
    hexColorsRef.current = colors;
  }, []);

  // Create radar mesh
  useEffect(() => {
    const radarMesh = createRadarMesh();
    radarRef.current = radarMesh;
    return () => {
      radarMesh.geometry.dispose();
      (radarMesh.material as THREE.Material).dispose();
    };
  }, []);

  // Dust particle positions
  const dustGeometry = useMemo(() => {
    const positions = new Float32Array(ATMOSPHERE.DUST_COUNT * 3);
    for (let i = 0; i < ATMOSPHERE.DUST_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 1] = Math.random() * 10 + 1;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 30;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, []);

  // Per-frame updates: dust, radar, heatmap
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();

    // ── Radar rotation ──
    if (radarRef.current) {
      updateRadar(radarRef.current, t);
    }

    // ── Dust animation + bee push ──
    if (dustRef.current) {
      const positions = dustRef.current.geometry.attributes.position;
      const arr = positions.array as Float32Array;

      // Ambient drift
      for (let i = 0; i < ATMOSPHERE.DUST_COUNT; i++) {
        arr[i * 3 + 1] += Math.sin(t + i) * 0.001;
        arr[i * 3] += Math.cos(t * 0.3 + i * 0.1) * 0.0005;
      }

      // Push dust from bee positions
      if (physicsEngine) {
        const bodyIds = physicsEngine.getBodyIds();
        const beePositions: Array<[number, number, number]> = [];
        for (const id of bodyIds) {
          const pos = physicsEngine.getInterpolatedPosition(id, 1.0);
          if (pos) beePositions.push(pos);
        }
        if (beePositions.length > 0) {
          pushDustFromBees(arr, beePositions);
        }
      }

      positions.needsUpdate = true;
    }

    // ── Heatmap: update hex colors based on pheromones ──
    if (meshRef.current && hexColorsRef.current) {
      const snapshot = useWorldStore.getState().snapshot;
      const pheromones = snapshot?.pheromones ?? [];
      const colors = hexColorsRef.current;
      const baseColor = new THREE.Color('#1e1e40');

      // Reset all to base color
      for (let i = 0; i < HEX_COUNT; i++) {
        colors[i * 3] = baseColor.r;
        colors[i * 3 + 1] = baseColor.g;
        colors[i * 3 + 2] = baseColor.b;
      }

      // For each pheromone, find nearest hex and tint it
      if (pheromones.length > 0) {
        for (const p of pheromones) {
          if (p.intensity < 0.1) continue;

          // If pheromone has position, use it; otherwise use emitter position
          let px = 0, pz = 0;
          if (p.position) {
            px = p.position.x;
            pz = p.position.z;
          } else if (physicsEngine) {
            const emitterPos = physicsEngine.getInterpolatedPosition(p.emitterId, 1.0);
            if (emitterPos) {
              px = emitterPos[0];
              pz = emitterPos[2];
            }
          }

          // Find nearest hex(es) and tint them
          const canonicalType = normalizePheromoneType(p) ?? 'trail';
          const pColor = new THREE.Color(PHEROMONE_COLORS[canonicalType] ?? '#F5A623');
          const radius = 3.0; // influence radius

          for (let i = 0; i < HEX_COUNT; i++) {
            const hx = HEX_POSITIONS[i][0];
            const hz = HEX_POSITIONS[i][2];
            const dx = hx - px;
            const dz = hz - pz;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < radius) {
              const influence = p.intensity * 0.15 * (1 - dist / radius);
              colors[i * 3] += pColor.r * influence;
              colors[i * 3 + 1] += pColor.g * influence;
              colors[i * 3 + 2] += pColor.b * influence;
            }
          }
        }
      }

      meshRef.current.instanceColor!.needsUpdate = true;
    }
  });

  return (
    <group>
      {/* Hexagonal floor — semi-glossy with warm emissive edge */}
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, HEX_COUNT]}
        receiveShadow
      >
        <cylinderGeometry args={[HEX_RADIUS, HEX_RADIUS, 0.12, 6]} />
        <meshStandardMaterial
          color="#16162e"
          emissive="#F5A623"
          emissiveIntensity={0.12}
          roughness={0.4}
          metalness={0.5}
          vertexColors
        />
      </instancedMesh>

      {/* Edge wireframe overlay for hex outlines */}
      <instancedMesh ref={wireRef} args={[undefined, undefined, HEX_COUNT]}>
        <cylinderGeometry args={[HEX_RADIUS * 1.01, HEX_RADIUS * 1.01, 0.13, 6]} />
        <meshBasicMaterial
          color="#F5A623"
          wireframe
          transparent
          opacity={0.06}
          depthWrite={false}
        />
      </instancedMesh>

      {/* Radar sweep */}
      {radarRef.current && (
        <primitive object={radarRef.current} />
      )}

      {/* Dust particles — additive glow */}
      <points ref={dustRef} geometry={dustGeometry}>
        <pointsMaterial
          color="#FFB84D"
          size={0.12}
          transparent
          opacity={0.4}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* Ground plane — very dark with subtle emissive */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.07, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial
          color="#050510"
          emissive="#0a0a1e"
          emissiveIntensity={0.1}
          roughness={0.95}
          metalness={0.1}
        />
      </mesh>
    </group>
  );
}
