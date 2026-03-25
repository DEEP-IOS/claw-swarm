/**
 * FieldView — 12D Signal Field visualization
 *
 * Indigo-purple space with SignalFieldSphere at center.
 * Agents orbit around the sphere, attracted to their most sensitive dimension.
 * Weight bars as ring segments around equator.
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SignalFieldSphere } from '../three/SignalFieldSphere';
import { useWorldStore } from '../stores/world-store';

interface FieldViewProps {
  active: boolean;
}

export function FieldView({ active }: FieldViewProps) {
  const snapshot = useWorldStore((s) => s.snapshot);
  const ringRef = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    if (ringRef.current) {
      ringRef.current.rotation.y = clock.getElapsedTime() * 0.03;
    }
  });

  if (!active) return null;

  const fieldValues = snapshot?.field ?? {};

  return (
    <group>
      {/* 12D Signal Field Sphere */}
      <SignalFieldSphere fieldValues={fieldValues} />

      {/* Equatorial weight ring */}
      <mesh ref={ringRef} position={[0, 4, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.5, 3.55, 64]} />
        <meshStandardMaterial
          color="#7B61FF"
          emissive="#7B61FF"
          emissiveIntensity={0.15}
          transparent
          opacity={0.2}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Ambient field glow */}
      <pointLight position={[0, 4, 0]} color="#7B61FF" intensity={0.5} distance={15} decay={2} />

      {/* Equatorial glow ring — ground level */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[4, 4.1, 64]} />
        <meshBasicMaterial
          color="#7B61FF"
          transparent
          opacity={0.08}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
