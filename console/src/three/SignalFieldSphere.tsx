/**
 * SignalFieldSphere — 12D Icosahedron for Field view
 *
 * - Wireframe icosahedron (radius=2, detail=2)
 * - 12 dimension markers at Fibonacci sphere positions
 * - Marker size/brightness = dimension signal strength
 * - Auto-rotation (rotation.y += dt × 0.08)
 * - Signal particles fly from dimension points toward center on emit events
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { DIMENSION_META } from '../theme/tokens';

/** Generate 12 evenly-distributed points on a sphere (Fibonacci) */
function fibonacciSphere(count: number, radius: number): [number, number, number][] {
  const points: [number, number, number][] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2; // -1 to 1
    const r = Math.sqrt(1 - y * y);
    const theta = goldenAngle * i;
    points.push([
      Math.cos(theta) * r * radius,
      y * radius,
      Math.sin(theta) * r * radius,
    ]);
  }
  return points;
}

interface SignalFieldSphereProps {
  fieldValues: Record<string, number>;
}

export function SignalFieldSphere({ fieldValues }: SignalFieldSphereProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const markerRefs = useRef<THREE.Mesh[]>([]);

  const dimPositions = useMemo(() => fibonacciSphere(12, 3), []);

  // Wireframe icosahedron
  const icoGeom = useMemo(() => {
    return new THREE.IcosahedronGeometry(2.8, 2);
  }, []);

  const edgesGeom = useMemo(() => {
    return new THREE.EdgesGeometry(icoGeom);
  }, [icoGeom]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();

    // Auto-rotate
    groupRef.current.rotation.y += 0.0008;

    // Update dimension markers based on field values
    for (let i = 0; i < DIMENSION_META.length; i++) {
      const mesh = markerRefs.current[i];
      if (!mesh) continue;

      const dim = DIMENSION_META[i];
      const value = fieldValues[dim.id] ?? 0;
      const normalizedValue = Math.min(1, Math.max(0, value));

      // Size pulses with value
      const baseSize = 0.15 + normalizedValue * 0.35;
      const pulse = Math.sin(t * 1.5 + i * 0.5) * 0.02;
      mesh.scale.setScalar(baseSize + pulse);

      // Emissive intensity
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.2 + normalizedValue * 0.8;
    }
  });

  return (
    <group ref={groupRef} position={[0, 4, 0]}>
      {/* Wireframe sphere */}
      <lineSegments geometry={edgesGeom}>
        <lineBasicMaterial color="#7B61FF" transparent opacity={0.18} />
      </lineSegments>

      {/* Semi-transparent shell */}
      <mesh>
        <icosahedronGeometry args={[2.8, 2]} />
        <meshStandardMaterial
          color="#7B61FF"
          transparent
          opacity={0.03}
          side={THREE.DoubleSide}
          emissive="#7B61FF"
          emissiveIntensity={0.1}
        />
      </mesh>

      {/* 12 dimension markers */}
      {DIMENSION_META.map((dim, i) => {
        const pos = dimPositions[i];
        const value = fieldValues[dim.id] ?? 0;
        return (
          <group key={dim.id}>
            <mesh
              ref={(el) => { if (el) markerRefs.current[i] = el; }}
              position={pos}
            >
              <sphereGeometry args={[1, 10, 8]} />
              <meshStandardMaterial
                color={dim.color}
                emissive={dim.color}
                emissiveIntensity={0.3}
                transparent
                opacity={0.7}
              />
            </mesh>

            {/* Axis line from center to marker */}
            <primitive object={new THREE.Line(
              new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(...pos),
              ]),
              new THREE.LineBasicMaterial({ color: dim.color, transparent: true, opacity: 0.08 + value * 0.15 }),
            )} />

            {/* Dimension label */}
            <Html position={[pos[0] * 1.3, pos[1] * 1.3, pos[2] * 1.3]} center style={{ pointerEvents: 'none' }}>
              <div style={{
                color: dim.color,
                fontSize: 8,
                fontWeight: 600,
                fontFamily: '"Segoe UI", sans-serif',
                opacity: 0.6 + value * 0.4,
                whiteSpace: 'nowrap',
              }}>
                {dim.label}
              </div>
            </Html>
          </group>
        );
      })}

      {/* Central glow */}
      <pointLight color="#7B61FF" intensity={0.5} distance={8} decay={2} />
    </group>
  );
}
