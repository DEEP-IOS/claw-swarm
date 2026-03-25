/**
 * CognitionView — Memory spheres + emotion halos
 *
 * Purple-toned cognitive space with 3 memory layers:
 *   Working Memory (blue, top layer)
 *   Episodic Memory (purple, middle)
 *   Semantic Memory (green, bottom, most persistent)
 *
 * Agents rendered as hexagons with emotion-based color halos.
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useWorldStore } from '../stores/world-store';

interface CognitionViewProps {
  active: boolean;
}

const MEMORY_LAYERS = [
  { label: 'Working', color: '#3B82F6', y: 8, count: 8, sizeRange: [0.15, 0.35] },
  { label: 'Episodic', color: '#8B5CF6', y: 5, count: 12, sizeRange: [0.2, 0.5] },
  { label: 'Semantic', color: '#10B981', y: 2, count: 6, sizeRange: [0.3, 0.6] },
];

const EMOTION_COLORS: Record<string, string> = {
  frustration: '#EF4444',
  confidence: '#F5A623',
  joy: '#10B981',
  curiosity: '#3B82F6',
  urgency: '#EC4899',
  fatigue: '#6B7280',
};

/** Memory sphere floating in a layer */
function MemorySphere({ position, size, color }: {
  position: [number, number, number];
  size: number;
  color: string;
}) {
  const ref = useRef<THREE.Mesh>(null!);
  const phaseOffset = useMemo(() => Math.random() * Math.PI * 2, []);

  useFrame(({ clock }) => {
    if (ref.current) {
      const t = clock.getElapsedTime();
      ref.current.position.y = position[1] + Math.sin(t * 0.3 + phaseOffset) * 0.3;
      const pulse = 0.15 + Math.sin(t * 0.5 + phaseOffset) * 0.05;
      (ref.current.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
    }
  });

  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[size, 12, 8]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.3}
        transparent
        opacity={0.65}
        roughness={0.2}
        metalness={0.15}
      />
    </mesh>
  );
}

/** Brain outline wireframe */
function BrainOutline() {
  const ref = useRef<THREE.LineSegments>(null!);

  const geometry = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(12, 1);
    return new THREE.EdgesGeometry(g);
  }, []);

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.getElapsedTime() * 0.02;
    }
  });

  return (
    <lineSegments ref={ref} position={[0, 5, 0]} geometry={geometry}>
      <lineBasicMaterial color="#8B5CF6" transparent opacity={0.08} />
    </lineSegments>
  );
}

/** Memory connection lines between spheres */
function MemoryConnections({ positions }: { positions: [number, number, number][] }) {
  const lineGeom = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < positions.length - 1; i++) {
      if (Math.random() > 0.4) {
        const j = Math.min(i + 1 + Math.floor(Math.random() * 3), positions.length - 1);
        points.push(new THREE.Vector3(...positions[i]));
        points.push(new THREE.Vector3(...positions[j]));
      }
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [positions]);

  return (
    <lineSegments geometry={lineGeom}>
      <lineBasicMaterial color="#8B5CF6" transparent opacity={0.1} />
    </lineSegments>
  );
}

export function CognitionView({ active }: CognitionViewProps) {
  const snapshot = useWorldStore((s) => s.snapshot);

  // Generate stable memory sphere positions per layer
  const memoryPositions = useMemo(() => {
    const all: [number, number, number][] = [];
    for (const layer of MEMORY_LAYERS) {
      for (let i = 0; i < layer.count; i++) {
        const angle = (i / layer.count) * Math.PI * 2 + Math.random() * 0.5;
        const r = 4 + Math.random() * 6;
        const size = layer.sizeRange[0] + Math.random() * (layer.sizeRange[1] - layer.sizeRange[0]);
        all.push([Math.cos(angle) * r, layer.y + (Math.random() - 0.5) * 1.5, Math.sin(angle) * r]);
      }
    }
    return all;
  }, []);

  if (!active) return null;

  const agents = snapshot?.agents ?? [];
  let sphereIdx = 0;

  return (
    <group>
      {/* Brain outline */}
      <BrainOutline />

      {/* Memory layer labels */}
      {MEMORY_LAYERS.map((layer) => (
        <mesh key={layer.label} position={[0, layer.y, -12]}>
          <planeGeometry args={[20, 0.01]} />
          <meshBasicMaterial color={layer.color} transparent opacity={0.05} />
        </mesh>
      ))}

      {/* Memory spheres per layer */}
      {MEMORY_LAYERS.map((layer) => {
        const spheres = [];
        for (let i = 0; i < layer.count && sphereIdx < memoryPositions.length; i++) {
          const size = layer.sizeRange[0] + Math.random() * (layer.sizeRange[1] - layer.sizeRange[0]);
          spheres.push(
            <MemorySphere
              key={`${layer.label}-${i}`}
              position={memoryPositions[sphereIdx]}
              size={size}
              color={layer.color}
            />,
          );
          sphereIdx++;
        }
        return spheres;
      })}

      {/* Connections between memory nodes */}
      <MemoryConnections positions={memoryPositions} />

      {/* Cognition ambient light */}
      <pointLight position={[0, 6, 0]} color="#8B5CF6" intensity={0.5} distance={20} decay={2} />

      {/* Emotion halos for each agent (rendered at agent positions by BeeModel) */}
      {agents.map((agent) => {
        if (!agent.emotion) return null;
        const emo = agent.emotion;
        const dims = Object.entries(emo) as [string, number][];
        const dominant = dims.reduce((a, b) => (b[1] > a[1] ? b : a), ['curiosity', 0]);
        const haloColor = EMOTION_COLORS[dominant[0]] ?? '#8B5CF6';
        const intensity = dominant[1];
        if (intensity < 0.2) return null;

        return (
          <pointLight
            key={`halo-${agent.id}`}
            color={haloColor}
            intensity={intensity * 0.5}
            distance={4}
            decay={2}
            position={[0, 3, 0]}
          />
        );
      })}
    </group>
  );
}
