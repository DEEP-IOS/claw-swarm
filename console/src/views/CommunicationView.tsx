/**
 * CommunicationView - live communication telemetry
 *
 * Shows two real runtime layers:
 * - canonical pheromone activity by type
 * - active task channels with message load
 */

import { useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useWorldStore } from '../stores/world-store';
import { getPheromoneTypeInfo, usePheromoneStore } from '../stores/pheromone-store';

interface CommunicationViewProps {
  active: boolean;
}

function PheromoneStream({
  label,
  color,
  index,
  intensity,
}: {
  label: string;
  color: string;
  index: number;
  intensity: number;
}) {
  const groupRef = useRef<THREE.Group>(null!);
  const angle = (index / 6) * Math.PI * 2;
  const radius = 8;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;

  const { positions, count, geometry } = useMemo(() => {
    const pointCount = 18;
    const pos = new Float32Array(pointCount * 3);
    for (let i = 0; i < pointCount; i++) {
      const t = i / pointCount;
      pos[i * 3] = Math.cos(angle + t * 0.65) * (radius - t * 3.5);
      pos[i * 3 + 1] = 0.8 + t * 3.5;
      pos[i * 3 + 2] = Math.sin(angle + t * 0.65) * (radius - t * 3.5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return { positions: pos, count: pointCount, geometry: g };
  }, [angle]);

  useFrame(({ clock }) => {
    const elapsed = clock.getElapsedTime();
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      const phase = (i / count + elapsed * (0.12 + intensity * 0.08)) % 1;
      const currentAngle = angle + phase * 1.2;
      const currentRadius = radius * (1 - phase * 0.45);
      positions[i * 3] = Math.cos(currentAngle) * currentRadius;
      positions[i * 3 + 1] = 0.5 + phase * 4.6;
      positions[i * 3 + 2] = Math.sin(currentAngle) * currentRadius;
    }
    posAttr.needsUpdate = true;

    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(elapsed * 0.18 + index) * 0.03;
    }
  });

  const opacity = Math.max(0.15, 0.25 + intensity * 0.55);

  return (
    <group ref={groupRef}>
      <points geometry={geometry}>
        <pointsMaterial
          color={color}
          size={0.08 + intensity * 0.12}
          transparent
          opacity={opacity}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          sizeAttenuation
        />
      </points>

      <mesh position={[x, 0.5, z]}>
        <sphereGeometry args={[0.26, 12, 8]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.35 + intensity * 0.45}
          transparent
          opacity={0.72}
        />
      </mesh>

      <Html position={[x, 1.05, z]} center style={{ pointerEvents: 'none' }}>
        <div style={{
          color,
          fontSize: 9,
          fontWeight: 700,
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          textAlign: 'center',
          textShadow: `0 0 8px ${color}55`,
        }}>
          <div>{label}</div>
          <div style={{ fontSize: 11 }}>{Math.round(intensity * 100)}%</div>
        </div>
      </Html>
    </group>
  );
}

function ChannelColumn({
  channelId,
  memberCount,
  messageCount,
  index,
}: {
  channelId: string;
  memberCount: number;
  messageCount: number;
  index: number;
}) {
  const height = 0.5 + Math.min(4, messageCount * 0.35 + memberCount * 0.2);
  const x = -5 + index * 2;
  const color = messageCount > 0 ? '#F472B6' : '#94A3B8';

  return (
    <group position={[x, 0, -5]}>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.35, 0.45, height, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.22}
          transparent
          opacity={0.82}
        />
      </mesh>

      <Html position={[0, height + 0.35, 0]} center style={{ pointerEvents: 'none' }}>
        <div style={{
          minWidth: 68,
          padding: '4px 6px',
          borderRadius: 10,
          background: 'rgba(8, 10, 20, 0.72)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: '#F8FAFC',
          fontSize: 9,
          fontWeight: 600,
          textAlign: 'center',
          fontFamily: '"Segoe UI", system-ui, sans-serif',
        }}>
          <div>{channelId}</div>
          <div style={{ color: '#C084FC' }}>{memberCount} members</div>
          <div style={{ color: '#F472B6' }}>{messageCount} msgs</div>
        </div>
      </Html>
    </group>
  );
}

function CentralVortex({ activeTypes, activeChannels }: { activeTypes: number; activeChannels: number }) {
  const ref = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.y = clock.getElapsedTime() * 0.32;
    (ref.current.material as THREE.MeshStandardMaterial).emissiveIntensity =
      0.18 + Math.sin(clock.getElapsedTime() * 1.1) * 0.08;
  });

  return (
    <group position={[0, 3, 0]}>
      <mesh ref={ref}>
        <torusGeometry args={[1.5, 0.12, 10, 40]} />
        <meshStandardMaterial
          color="#EC4899"
          emissive="#EC4899"
          emissiveIntensity={0.22}
          transparent
          opacity={0.45}
          side={THREE.DoubleSide}
        />
      </mesh>

      <Html center style={{ pointerEvents: 'none' }}>
        <div style={{
          padding: '10px 12px',
          borderRadius: 14,
          background: 'rgba(8, 10, 20, 0.72)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: '#FDF2F8',
          fontSize: 10,
          fontWeight: 600,
          textAlign: 'center',
          fontFamily: '"Segoe UI", system-ui, sans-serif',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Communication Mesh</div>
          <div>{activeTypes} active pheromone types</div>
          <div>{activeChannels} live channels</div>
        </div>
      </Html>
    </group>
  );
}

export function CommunicationView({ active }: CommunicationViewProps) {
  const snapshot = useWorldStore((state) => state.snapshot);
  const levels = usePheromoneStore((state) => state.levels);

  const pheromoneInfo = useMemo(() => getPheromoneTypeInfo(), []);
  const channels = snapshot?.channels ?? [];

  if (!active) return null;

  const activeTypes = pheromoneInfo.filter(({ type }) => (levels[type]?.count ?? 0) > 0).length;

  return (
    <group>
      {pheromoneInfo.map(({ type, label, color }, index) => (
        <PheromoneStream
          key={type}
          label={label}
          color={color}
          index={index}
          intensity={levels[type]?.maxIntensity ?? 0}
        />
      ))}

      <CentralVortex activeTypes={activeTypes} activeChannels={channels.length} />

      {channels.slice(0, 5).map((channel, index) => (
        <ChannelColumn
          key={channel.channelId}
          channelId={channel.channelId}
          memberCount={channel.memberCount}
          messageCount={channel.messageCount}
          index={index}
        />
      ))}

      <pointLight position={[0, 5, 0]} color="#EC4899" intensity={0.55} distance={22} decay={2} />
    </group>
  );
}
