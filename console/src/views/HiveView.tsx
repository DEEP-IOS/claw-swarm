/**
 * HiveView — Default view: warm amber hive world
 *
 * Adds view-specific overlay elements only visible in hive mode:
 *   - Volumetric hive glow pillar (layered transparent cylinders)
 *   - Central point light for warmth
 *   - Ambient firefly particles (additive blend, round)
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useWorldStore } from '../stores/world-store';

interface HiveViewProps {
  active: boolean;
}

export function HiveView({ active }: HiveViewProps) {
  const pillarGroupRef = useRef<THREE.Group>(null!);
  const fireflyRef = useRef<THREE.Points>(null!);
  const glowLightRef = useRef<THREE.PointLight>(null!);
  const snapshot = useWorldStore((s) => s.snapshot);

  // Firefly positions (30 ambient particles)
  const { positions, velocities } = useMemo(() => {
    const count = 30;
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 30;
      pos[i * 3 + 1] = 0.5 + Math.random() * 8;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 30;
      vel[i * 3] = (Math.random() - 0.5) * 0.01;
      vel[i * 3 + 1] = (Math.random() - 0.5) * 0.005;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.01;
    }
    return { positions: pos, velocities: vel };
  }, []);

  const fireflyGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, [positions]);

  // Round firefly texture (circle with soft edge)
  const fireflyTexture = useMemo(() => {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.3, 'rgba(255,200,100,0.8)');
    gradient.addColorStop(1, 'rgba(255,150,50,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }, []);

  const fireflyMat = useMemo(() => new THREE.PointsMaterial({
    color: '#FFB84D',
    size: 0.25,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
    map: fireflyTexture,
  }), [fireflyTexture]);

  useFrame(({ clock }) => {
    if (!active) return;
    const t = clock.getElapsedTime();

    // Pillar pulse
    if (pillarGroupRef.current) {
      const pulse = 0.5 + Math.sin(t * 0.5) * 0.2;
      pillarGroupRef.current.children.forEach((child, i) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.emissiveIntensity = pulse * (1 - i * 0.15);
          child.material.opacity = 0.03 + Math.sin(t * 0.3 + i * 0.5) * 0.015;
        }
      });
    }

    // Glow light pulse
    if (glowLightRef.current) {
      glowLightRef.current.intensity = 1.5 + Math.sin(t * 0.5) * 0.5;
    }

    // Firefly drift
    if (fireflyRef.current) {
      const posAttr = fireflyRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < positions.length / 3; i++) {
        positions[i * 3] += velocities[i * 3] + Math.sin(t * 0.3 + i) * 0.002;
        positions[i * 3 + 1] += velocities[i * 3 + 1] + Math.cos(t * 0.2 + i * 0.5) * 0.001;
        positions[i * 3 + 2] += velocities[i * 3 + 2] + Math.sin(t * 0.25 + i * 0.3) * 0.002;

        if (Math.abs(positions[i * 3]) > 18) positions[i * 3] *= -0.5;
        if (positions[i * 3 + 1] < 0.3 || positions[i * 3 + 1] > 10) velocities[i * 3 + 1] *= -1;
        if (Math.abs(positions[i * 3 + 2]) > 18) positions[i * 3 + 2] *= -0.5;
      }
      posAttr.needsUpdate = true;
      fireflyMat.opacity = 0.5 + Math.sin(t * 2) * 0.2;
    }
  });

  if (!active) return null;

  const mode = snapshot?.mode ?? 'EXPLOIT';
  const pillarColor = mode === 'EXPLORE' ? '#3B82F6' : '#F5A623';

  return (
    <group>
      {/* Volumetric hive glow pillar — 4 layered transparent cylinders */}
      <group ref={pillarGroupRef} position={[0, 5, 0]}>
        {/* Core — narrow bright */}
        <mesh>
          <cylinderGeometry args={[0.08, 0.15, 10, 8]} />
          <meshStandardMaterial
            color={pillarColor}
            transparent
            opacity={0.06}
            emissive={pillarColor}
            emissiveIntensity={0.8}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        {/* Inner glow */}
        <mesh>
          <cylinderGeometry args={[0.3, 0.5, 10, 8]} />
          <meshStandardMaterial
            color={pillarColor}
            transparent
            opacity={0.035}
            emissive={pillarColor}
            emissiveIntensity={0.5}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        {/* Mid glow */}
        <mesh>
          <cylinderGeometry args={[0.7, 1.0, 10, 12]} />
          <meshStandardMaterial
            color={pillarColor}
            transparent
            opacity={0.02}
            emissive={pillarColor}
            emissiveIntensity={0.3}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        {/* Outer haze */}
        <mesh>
          <cylinderGeometry args={[1.2, 1.8, 10, 12]} />
          <meshStandardMaterial
            color={pillarColor}
            transparent
            opacity={0.01}
            emissive={pillarColor}
            emissiveIntensity={0.15}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      </group>

      {/* Central warm point light */}
      <pointLight
        ref={glowLightRef}
        color={pillarColor}
        position={[0, 3, 0]}
        intensity={1.5}
        distance={25}
        decay={2}
      />

      {/* Ambient firefly particles */}
      <points ref={fireflyRef} geometry={fireflyGeom} material={fireflyMat} />
    </group>
  );
}
