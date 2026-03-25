/**
 * PipelineView — DAG swim lane visualization
 *
 * 4 horizontal lanes representing task phases: PENDING → RUNNING → COMPLETED → FAILED.
 * Tasks are hex cards floating in their respective lanes.
 * DAG dependency lines connect tasks with flowing light points.
 * Holographic swim-lane design with glowing beam dividers and data flow particles.
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useWorldStore } from '../stores/world-store';
import type { TaskSnapshot } from '../api/ws-bridge';

interface PipelineViewProps {
  active: boolean;
}

const LANE_LABELS = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'];
const LANE_COLORS = ['#6B7280', '#3B82F6', '#10B981', '#EF4444'];
const LANE_X = [0, 8, 16, 24];
const LANE_WIDTH = 6;
const LANE_DEPTH = 16;

function statusToLane(status: string): number {
  const idx = LANE_LABELS.findIndex(l => l === status.toUpperCase());
  return idx >= 0 ? idx : 0;
}

/** Glowing beam divider between/around lanes */
function BeamDivider({ x, color, height = 4 }: { x: number; color: string; height?: number }) {
  const ref = useRef<THREE.Group>(null!);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    // Subtle pulse on the beam
    const children = ref.current.children;
    for (let i = 0; i < children.length; i++) {
      const mesh = children[i] as THREE.Mesh;
      if (mesh.material && 'emissiveIntensity' in mesh.material) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.15 + Math.sin(t * 0.8 + i * 0.5) * 0.08;
      }
    }
  });

  return (
    <group ref={ref} position={[x, 0, 0]}>
      {/* Core beam — thin bright line */}
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.01, 0.01, height, 4]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.25}
          transparent
          opacity={0.8}
        />
      </mesh>
      {/* Glow halo around beam — wider, softer */}
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.08, 0.08, height, 6]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.06}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Base accent ring */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.08, 0.25, 12]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.12}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

/** Single swim lane with holographic platform */
function SwimLane({ index }: { index: number }) {
  const platformRef = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    if (platformRef.current) {
      const mat = platformRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.04 + Math.sin(clock.getElapsedTime() * 0.3 + index * 0.8) * 0.02;
    }
  });

  return (
    <group position={[LANE_X[index], 0, 0]}>
      {/* Lane platform — subtle holographic ground */}
      <mesh ref={platformRef} position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[LANE_WIDTH - 0.3, LANE_DEPTH]} />
        <meshStandardMaterial
          color="#0c0c20"
          emissive={LANE_COLORS[index]}
          emissiveIntensity={0.04}
          transparent
          opacity={0.15}
          side={THREE.DoubleSide}
          roughness={0.8}
          metalness={0.2}
        />
      </mesh>

      {/* Inner grid lines (3 horizontal, subtle) */}
      {[-4, 0, 4].map((z) => (
        <mesh key={z} position={[0, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[LANE_WIDTH - 0.6, 0.015]} />
          <meshBasicMaterial
            color={LANE_COLORS[index]}
            transparent
            opacity={0.08}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      {/* Beam dividers on lane edges */}
      <BeamDivider x={-LANE_WIDTH / 2} color={LANE_COLORS[index]} />
      <BeamDivider x={LANE_WIDTH / 2} color={LANE_COLORS[index]} />

      {/* Lane label — positioned above, large and clear */}
      <Html position={[0, 4.5, -LANE_DEPTH / 2 + 0.5]} center style={{ pointerEvents: 'none' }}>
        <div style={{
          color: LANE_COLORS[index],
          fontSize: 13,
          fontWeight: 700,
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          opacity: 0.85,
          letterSpacing: 3,
          textShadow: `0 0 8px ${LANE_COLORS[index]}60, 0 0 20px ${LANE_COLORS[index]}30`,
          userSelect: 'none',
        }}>
          {LANE_LABELS[index]}
        </div>
      </Html>

      {/* Arrow indicator at bottom of lane → pointing to next lane */}
      {index < 3 && (
        <mesh position={[LANE_WIDTH / 2 + 0.5, 0.5, 0]}>
          <coneGeometry args={[0.12, 0.35, 3]} />
          <meshStandardMaterial
            color={LANE_COLORS[index]}
            emissive={LANE_COLORS[index]}
            emissiveIntensity={0.2}
            transparent
            opacity={0.4}
          />
        </mesh>
      )}
    </group>
  );
}

/** Data flow particles streaming between lanes */
function DataFlowParticles() {
  const ref = useRef<THREE.Points>(null!);
  const PARTICLE_COUNT = 60;

  const { positions, velocities, colors } = useMemo(() => {
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const vel = new Float32Array(PARTICLE_COUNT);
    const col = new Float32Array(PARTICLE_COUNT * 3);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Spread across the pipeline width
      pos[i * 3] = Math.random() * 28 - 2;
      pos[i * 3 + 1] = 0.3 + Math.random() * 3;
      pos[i * 3 + 2] = (Math.random() - 0.5) * LANE_DEPTH;
      vel[i] = 0.02 + Math.random() * 0.04;

      // Color based on x position (which lane they're near)
      const laneIdx = Math.min(3, Math.floor(pos[i * 3] / 8));
      const c = new THREE.Color(LANE_COLORS[Math.max(0, laneIdx)]);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    return { positions: pos, velocities: vel, colors: col };
  }, []);

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return g;
  }, [positions, colors]);

  useFrame(() => {
    if (!ref.current) return;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] += velocities[i];
      // Slight vertical drift
      positions[i * 3 + 1] += Math.sin(positions[i * 3] * 0.3 + i) * 0.003;

      // Wrap around
      if (positions[i * 3] > 28) {
        positions[i * 3] = -2;
        positions[i * 3 + 1] = 0.3 + Math.random() * 3;
        positions[i * 3 + 2] = (Math.random() - 0.5) * LANE_DEPTH;
      }

      // Update color based on current lane
      const laneIdx = Math.min(3, Math.max(0, Math.floor(positions[i * 3] / 8)));
      const c = new THREE.Color(LANE_COLORS[laneIdx]);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geom.attributes.position.needsUpdate = true;
    geom.attributes.color.needsUpdate = true;
  });

  return (
    <points ref={ref} geometry={geom}>
      <pointsMaterial
        size={0.08}
        vertexColors
        transparent
        opacity={0.5}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

/** Task hex card floating in a lane */
function TaskCard({ task, yOffset }: { task: TaskSnapshot; yOffset: number }) {
  const ref = useRef<THREE.Mesh>(null!);
  const glowRef = useRef<THREE.Mesh>(null!);
  const lane = statusToLane(task.status);
  const color = LANE_COLORS[lane];

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref.current) {
      ref.current.position.y = 1.5 + Math.sin(t * 0.5 + yOffset) * 0.15;
      ref.current.rotation.y = Math.sin(t * 0.2 + yOffset) * 0.05;
    }
    if (glowRef.current) {
      glowRef.current.position.y = 1.5 + Math.sin(t * 0.5 + yOffset) * 0.15;
      const mat = glowRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.04 + Math.sin(t * 0.8 + yOffset) * 0.02;
    }
  });

  const hashCode = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  };
  const z = ((hashCode(task.id) % 100) / 100) * LANE_DEPTH - LANE_DEPTH / 2;

  return (
    <group position={[LANE_X[lane], 0, z]}>
      {/* Card body — hex token */}
      <mesh ref={ref} rotation={[0, Math.PI / 6, 0]}>
        <cylinderGeometry args={[0.55, 0.55, 0.12, 6]} />
        <meshStandardMaterial
          color="#0c0c24"
          emissive={color}
          emissiveIntensity={0.35}
          transparent
          opacity={0.85}
          metalness={0.4}
          roughness={0.3}
        />
      </mesh>
      {/* Glow shell */}
      <mesh ref={glowRef} rotation={[0, Math.PI / 6, 0]}>
        <cylinderGeometry args={[0.7, 0.7, 0.06, 6]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.05}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Label */}
      <Html position={[0, 2.5, z > 0 ? 0.5 : -0.5]} center style={{ pointerEvents: 'none' }}>
        <div style={{
          color: '#e0e0f0',
          fontSize: 9,
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          background: 'rgba(8,8,22,0.85)',
          padding: '2px 8px',
          borderRadius: 4,
          border: `1px solid ${color}50`,
          boxShadow: `0 0 6px ${color}20`,
          whiteSpace: 'nowrap',
          maxWidth: 90,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          userSelect: 'none',
        }}>
          {task.name || task.id.slice(0, 8)}
        </div>
      </Html>
    </group>
  );
}

/** DAG dependency lines with flowing light */
function DependencyLine({ from, to }: { from: [number, number, number]; to: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null!);

  const points = useMemo(() => [
    new THREE.Vector3(...from),
    new THREE.Vector3(...to),
  ], [from, to]);

  const lineGeom = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [points]);

  useFrame(({ clock }) => {
    if (ref.current) {
      const t = (clock.getElapsedTime() * 0.5) % 1;
      const pos = new THREE.Vector3().lerpVectors(points[0], points[1], t);
      ref.current.position.copy(pos);
    }
  });

  const lineMat = useMemo(() => new THREE.LineBasicMaterial({
    color: '#3B82F6',
    transparent: true,
    opacity: 0.15,
  }), []);
  const lineObj = useMemo(() => new THREE.Line(lineGeom, lineMat), [lineGeom, lineMat]);

  return (
    <group>
      <primitive object={lineObj} />
      {/* Flowing light point */}
      <mesh ref={ref}>
        <sphereGeometry args={[0.06, 6, 4]} />
        <meshStandardMaterial
          color="#3B82F6"
          emissive="#3B82F6"
          emissiveIntensity={0.5}
          transparent
          opacity={0.7}
        />
      </mesh>
    </group>
  );
}

/** Horizontal scan line effect */
function ScanLine() {
  const ref = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    if (ref.current) {
      const t = (clock.getElapsedTime() * 0.15) % 1;
      ref.current.position.z = -LANE_DEPTH / 2 + t * LANE_DEPTH;
      const mat = ref.current.material as THREE.MeshBasicMaterial;
      // Fade at edges
      mat.opacity = 0.06 * Math.sin(t * Math.PI);
    }
  });

  return (
    <mesh ref={ref} position={[12, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[30, 0.15]} />
      <meshBasicMaterial
        color="#3B82F6"
        transparent
        opacity={0.06}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export function PipelineView({ active }: PipelineViewProps) {
  const snapshot = useWorldStore((s) => s.snapshot);

  if (!active) return null;

  const tasks = snapshot?.tasks ?? [];

  return (
    <group position={[-4, 0, 0]}>
      {/* Scan line effect sweeping across the lanes */}
      <ScanLine />

      {/* Data flow particles */}
      <DataFlowParticles />

      {/* 4 swim lanes */}
      {LANE_LABELS.map((_, i) => (
        <SwimLane key={i} index={i} />
      ))}

      {/* Task hex cards */}
      {tasks.map((task, i) => (
        <TaskCard key={task.id} task={task} yOffset={i * 0.7} />
      ))}

      {/* Dependency lines */}
      {tasks.map((task) =>
        task.dependencies?.map((depId) => {
          const depTask = tasks.find(t => t.id === depId);
          if (!depTask) return null;
          const fromLane = statusToLane(depTask.status);
          const toLane = statusToLane(task.status);
          const hashFrom = Math.abs(depId.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0));
          const hashTo = Math.abs(task.id.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0));
          const zFrom = ((hashFrom % 100) / 100) * LANE_DEPTH - LANE_DEPTH / 2;
          const zTo = ((hashTo % 100) / 100) * LANE_DEPTH - LANE_DEPTH / 2;
          return (
            <DependencyLine
              key={`${depId}-${task.id}`}
              from={[LANE_X[fromLane] - 4, 1.5, zFrom]}
              to={[LANE_X[toLane] - 4, 1.5, zTo]}
            />
          );
        }),
      )}

      {/* Pipeline ambient light — blue tint */}
      <pointLight position={[12, 6, 0]} color="#3B82F6" intensity={0.3} distance={25} decay={2} />
    </group>
  );
}
