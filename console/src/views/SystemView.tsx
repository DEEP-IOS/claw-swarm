/**
 * SystemView - runtime architecture and health telemetry
 *
 * Uses real health dimensions and workflow stages from the live snapshot.
 */

import { useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useWorldStore } from '../stores/world-store';

interface SystemViewProps {
  active: boolean;
}

const HEALTH_DIMS = [
  { key: 'cpu', label: 'CPU', color: '#F97316' },
  { key: 'memory', label: 'Memory', color: '#3B82F6' },
  { key: 'eventLoopLag', label: 'Loop Lag', color: '#10B981' },
  { key: 'signalCount', label: 'Signals', color: '#8B5CF6' },
  { key: 'agentCount', label: 'Agents', color: '#F5A623' },
  { key: 'errorRate', label: 'Errors', color: '#EF4444' },
] as const;

function GaugeRing3D({
  index,
  label,
  color,
  value,
}: {
  index: number;
  label: string;
  color: string;
  value: number;
}) {
  const ref = useRef<THREE.Mesh>(null!);
  const angle = (index / HEALTH_DIMS.length) * Math.PI * 2;
  const radius = 7;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const arc = Math.max(0.02, value) * Math.PI * 2;

  useFrame(({ clock }) => {
    if (!ref.current) return;
    (ref.current.material as THREE.MeshStandardMaterial).emissiveIntensity =
      0.12 + Math.sin(clock.getElapsedTime() * 0.6 + index) * 0.05;
  });

  return (
    <group position={[x, 2, z]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.25, 1.5, 40]} />
        <meshBasicMaterial color="#162033" transparent opacity={0.28} side={THREE.DoubleSide} />
      </mesh>

      <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.32, 1.45, 48, 1, 0, arc]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.16}
          side={THREE.DoubleSide}
        />
      </mesh>

      <Html position={[0, -0.48, 0]} center style={{ pointerEvents: 'none' }}>
        <div style={{
          color,
          fontSize: 9,
          fontWeight: 700,
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          textAlign: 'center',
        }}>
          <div>{label}</div>
          <div style={{ fontSize: 13 }}>{Math.round(value * 100)}%</div>
        </div>
      </Html>
    </group>
  );
}

function HealthSphere({
  score,
  status,
}: {
  score: number;
  status: string;
}) {
  const ref = useRef<THREE.Mesh>(null!);
  const color = status === 'healthy' ? '#10B981' : status === 'degraded' ? '#F5A623' : '#EF4444';

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const scale = 1 + Math.sin(clock.getElapsedTime() * 0.45) * 0.03;
    ref.current.scale.setScalar((1 + score * 0.45) * scale);
    (ref.current.material as THREE.MeshStandardMaterial).emissiveIntensity =
      0.22 + Math.sin(clock.getElapsedTime() * 0.75) * 0.08;
  });

  return (
    <group position={[0, 3, 0]}>
      <mesh ref={ref}>
        <sphereGeometry args={[1, 26, 18]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.24}
          transparent
          opacity={0.62}
          roughness={0.32}
          metalness={0.18}
        />
      </mesh>

      <Html center style={{ pointerEvents: 'none' }}>
        <div style={{
          padding: '10px 12px',
          borderRadius: 14,
          background: 'rgba(10, 14, 28, 0.72)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: '#F8FAFC',
          fontSize: 11,
          fontWeight: 600,
          textAlign: 'center',
          fontFamily: '"Segoe UI", system-ui, sans-serif',
        }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{Math.round(score * 100)}</div>
          <div>{status.toUpperCase()}</div>
        </div>
      </Html>
    </group>
  );
}

function WorkflowBoard() {
  const system = useWorldStore((state) => state.snapshot?.system);

  if (!system) {
    return null;
  }

  const activeStage = system.workflow.stages.find((stage) => stage.status === 'active') ?? system.workflow.stages[0];
  const visibleStages = system.workflow.stages;
  const evidence = system.workflow.evidence;

  return (
    <Html position={[0, 6.1, -5.2]} center style={{ pointerEvents: 'none' }}>
      <div style={{
        width: 360,
        padding: 14,
        borderRadius: 18,
        background: 'rgba(7, 10, 20, 0.82)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 18px 48px rgba(0,0,0,0.28)',
        color: '#E2E8F0',
        fontFamily: '"Segoe UI", system-ui, sans-serif',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#F8FAFC' }}>Workflow Evidence</div>
        <div style={{ marginTop: 6, fontSize: 12, color: '#94A3B8' }}>{system.workflow.summary}</div>
        {system.workflow.phaseSource === 'inferred' ? (
          <div style={{ marginTop: 6, fontSize: 11, color: '#F5A623', lineHeight: 1.4 }}>
            {system.workflow.inferenceNotice}
          </div>
        ) : null}
        <div style={{ marginTop: 6, fontSize: 11, color: '#CBD5E1' }}>
          Active focus: <strong style={{ color: '#F8FAFC' }}>{activeStage?.label ?? 'Waiting'}</strong>
          <span style={{ color: '#94A3B8' }}> | {activeStage?.detail ?? 'No active workflow evidence yet.'}</span>
        </div>

        {evidence ? (
          <div style={{
            marginTop: 10,
            display: 'grid',
            gap: 8,
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          }}>
            <div style={{ padding: '7px 9px', borderRadius: 12, background: 'rgba(255,255,255,0.03)' }}>
              <div style={{ fontSize: 10, color: '#94A3B8', textTransform: 'uppercase' }}>Role Evidence</div>
              <div style={{ marginTop: 4, fontSize: 12 }}>
                R {evidence.roleCounts?.research ?? 0} | I {evidence.roleCounts?.implement ?? 0} | V {evidence.roleCounts?.review ?? 0}
              </div>
            </div>
            <div style={{ padding: '7px 9px', borderRadius: 12, background: 'rgba(255,255,255,0.03)' }}>
              <div style={{ fontSize: 10, color: '#94A3B8', textTransform: 'uppercase' }}>Signal Evidence</div>
              <div style={{ marginTop: 4, fontSize: 12 }}>
                {evidence.sensing?.pheromoneTrails ?? 0} trails | {evidence.sensing?.channelCount ?? 0} channels
              </div>
            </div>
          </div>
        ) : null}

        <div style={{
          marginTop: 10,
          display: 'grid',
          gap: 8,
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        }}>
          {visibleStages.map((stage) => (
            <div key={stage.id} style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 10,
              padding: '7px 9px',
              borderRadius: 12,
              background: stage.id === activeStage?.id ? 'rgba(92,184,255,0.12)' : 'rgba(255,255,255,0.03)',
            }}>
              <span style={{ fontWeight: 600 }}>{stage.label}</span>
              <span style={{ color: '#5CB8FF', textTransform: 'uppercase', fontSize: 11 }}>{stage.status}</span>
            </div>
          ))}
        </div>
      </div>
    </Html>
  );
}

export function SystemView({ active }: SystemViewProps) {
  const snapshot = useWorldStore((state) => state.snapshot);

  if (!active) return null;

  const health = snapshot?.health ?? { score: 0.5, status: 'unknown', ts: 0, dimensions: {} };
  const dimensions = health.dimensions ?? {};

  return (
    <group>
      <HealthSphere score={health.score ?? 0.5} status={health.status ?? 'unknown'} />

      {HEALTH_DIMS.map((dim, index) => (
        <GaugeRing3D
          key={dim.key}
          index={index}
          label={dim.label}
          color={dim.color}
          value={dimensions[dim.key]?.score ?? 0}
        />
      ))}

      <WorkflowBoard />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[10, 10.15, 64]} />
        <meshBasicMaterial
          color="#F97316"
          transparent
          opacity={0.08}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <pointLight position={[0, 6, 0]} color="#F97316" intensity={0.4} distance={20} decay={2} />
    </group>
  );
}
