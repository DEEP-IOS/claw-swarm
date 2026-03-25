/**
 * EcologyView — Species/evolution landscape
 *
 * Green-toned ecology with:
 *   - Undulating terrain (PlaneGeometry + height displacement)
 *   - Role clusters as colored territory patches
 *   - Evolution tree (growing luminous branches)
 *   - Lotka-Volterra population curves floating above terrain
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CANONICAL_ROLES, ROLE_LAYOUT_OFFSETS, ROLE_PARAMS } from '../engine/constants';
import { useWorldStore } from '../stores/world-store';

interface EcologyViewProps {
  active: boolean;
}

/** Undulating terrain mesh */
function Terrain() {
  const ref = useRef<THREE.Mesh>(null!);

  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(40, 40, 64, 64);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const height = Math.sin(x * 0.3) * 0.5 + Math.cos(y * 0.25) * 0.4
        + Math.sin((x + y) * 0.15) * 0.3;
      pos.setZ(i, height);
    }
    g.computeVertexNormals();
    return g;
  }, []);

  useFrame(({ clock }) => {
    if (ref.current) {
      const mat = ref.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.02 + Math.sin(clock.getElapsedTime() * 0.2) * 0.01;
    }
  });

  return (
    <mesh ref={ref} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
      <meshStandardMaterial
        color="#0a2a15"
        emissive="#10B981"
        emissiveIntensity={0.06}
        roughness={0.7}
        metalness={0.15}
        side={THREE.DoubleSide}
        wireframe={false}
      />
    </mesh>
  );
}

/** Role territory marker (glowing circle on terrain) */
function TerritoryPatch({ role, count }: { role: string; count: number }) {
  const pos = ROLE_LAYOUT_OFFSETS[role] ?? [0, 0];
  const color = ROLE_PARAMS[role]?.color ?? '#10B981';
  const radius = 1.5 + count * 0.8;

  return (
    <mesh position={[pos[0], 0.05, pos[1]]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[radius, 24]} />
      <meshStandardMaterial
        color={color}
        transparent
        opacity={0.12}
        emissive={color}
        emissiveIntensity={0.15}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/** Evolution tree — growing luminous structure */
function EvolutionTree() {
  const ref = useRef<THREE.Group>(null!);

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.05) * 0.1;
    }
  });

  const branches = useMemo(() => {
    const result: Array<{ start: [number, number, number]; end: [number, number, number]; color: string }> = [];
    const roles = CANONICAL_ROLES.map((role) => [role, ROLE_PARAMS[role]] as const);

    // Trunk
    result.push({ start: [0, 0, 0], end: [0, 4, 0], color: '#10B981' });

    // Main branches per role
    roles.forEach(([, params], i) => {
      const angle = (i / roles.length) * Math.PI * 2;
      const branchEnd: [number, number, number] = [
        Math.cos(angle) * 3,
        4 + i * 0.5,
        Math.sin(angle) * 3,
      ];
      result.push({ start: [0, 3.5, 0], end: branchEnd, color: params.color });

      // Sub-branches
      for (let j = 0; j < 2; j++) {
        const subAngle = angle + (j - 0.5) * 0.5;
        result.push({
          start: branchEnd,
          end: [
            branchEnd[0] + Math.cos(subAngle) * 1.5,
            branchEnd[1] + 1 + j * 0.5,
            branchEnd[2] + Math.sin(subAngle) * 1.5,
          ],
          color: params.color,
        });
      }
    });
    return result;
  }, []);

  return (
    <group ref={ref} position={[0, 0, -8]}>
      {branches.map((b, i) => {
        const points = [new THREE.Vector3(...b.start), new THREE.Vector3(...b.end)];
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({ color: b.color, transparent: true, opacity: 0.55 });
        return (
          <primitive key={i} object={new THREE.Line(geom, mat)} />
        );
      })}

      {/* Leaf nodes (fitness indicators) */}
      {branches.slice(7).map((b, i) => (
        <mesh key={`leaf-${i}`} position={b.end}>
          <sphereGeometry args={[0.12, 8, 6]} />
          <meshStandardMaterial
            color={b.color}
            emissive={b.color}
            emissiveIntensity={0.5}
            transparent
            opacity={0.8}
          />
        </mesh>
      ))}
    </group>
  );
}

export function EcologyView({ active }: EcologyViewProps) {
  const snapshot = useWorldStore((s) => s.snapshot);

  if (!active) return null;

  const agents = snapshot?.agents ?? [];

  // Count agents per role
  const roleCounts: Record<string, number> = {};
  for (const a of agents) {
    roleCounts[a.role] = (roleCounts[a.role] ?? 0) + 1;
  }

  return (
    <group>
      {/* Undulating terrain */}
      <Terrain />

      {/* Territory patches per role */}
      {CANONICAL_ROLES.map((role) => (
        <TerritoryPatch key={role} role={role} count={roleCounts[role] ?? 0} />
      ))}

      {/* Evolution tree */}
      <EvolutionTree />

      {/* Population ring — floating indicator */}
      <mesh position={[0, 6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3, 3.08, 64]} />
        <meshBasicMaterial
          color="#10B981"
          transparent
          opacity={0.1}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Ecology ambient light */}
      <pointLight position={[0, 5, -5]} color="#10B981" intensity={0.5} distance={20} decay={2} />
    </group>
  );
}
