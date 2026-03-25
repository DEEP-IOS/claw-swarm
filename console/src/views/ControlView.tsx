/**
 * ControlView - runtime guardrails and budget status
 *
 * Uses real breaker, budget, and quality metrics data instead of placeholder indicators.
 */

import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { useWorldStore } from '../stores/world-store';

interface ControlViewProps {
  active: boolean;
}

const BREAKER_STATES: Record<string, { color: string; emissive: number }> = {
  CLOSED: { color: '#10B981', emissive: 0.35 },
  HALF_OPEN: { color: '#F5A623', emissive: 0.55 },
  OPEN: { color: '#EF4444', emissive: 0.82 },
};

function BreakerSwitch({
  name,
  state,
  position,
}: {
  name: string;
  state: string;
  position: [number, number, number];
}) {
  const ref = useRef<THREE.Mesh>(null!);
  const config = BREAKER_STATES[state] ?? BREAKER_STATES.CLOSED;

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const material = ref.current.material as THREE.MeshStandardMaterial;
    if (state === 'HALF_OPEN') {
      material.emissiveIntensity = Math.sin(clock.getElapsedTime() * 4.5) > 0 ? config.emissive : config.emissive * 0.22;
      return;
    }
    material.emissiveIntensity = config.emissive;
  });

  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[0.85, 0.32, 0.42]} />
        <meshStandardMaterial color="#172033" roughness={0.68} metalness={0.25} />
      </mesh>

      <mesh ref={ref} position={[0, 0.24, 0]}>
        <sphereGeometry args={[0.16, 12, 8]} />
        <meshStandardMaterial color={config.color} emissive={config.color} emissiveIntensity={config.emissive} />
      </mesh>

      <Html position={[0, -0.52, 0]} center style={{ pointerEvents: 'none' }}>
        <div style={{
          color: config.color,
          fontSize: 8,
          fontWeight: 700,
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          textTransform: 'uppercase',
          letterSpacing: 1,
          textAlign: 'center',
        }}>
          {name.slice(0, 12)}
        </div>
      </Html>
    </group>
  );
}

function BudgetGauge({ utilization, spent, limit }: { utilization: number; spent: number; limit: number }) {
  const ref = useRef<THREE.Mesh>(null!);
  const ratio = Math.max(0, Math.min(1, utilization));
  const color = ratio > 0.9 ? '#EF4444' : ratio > 0.7 ? '#F5A623' : '#10B981';
  const arc = Math.max(0.02, ratio) * Math.PI * 2;

  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.z = clock.getElapsedTime() * 0.05;
  });

  return (
    <group position={[0, 3, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.8, 3, 64]} />
        <meshBasicMaterial color="#142033" transparent opacity={0.38} side={THREE.DoubleSide} />
      </mesh>

      <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.85, 2.96, 64, 1, 0, arc]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.46} side={THREE.DoubleSide} />
      </mesh>

      <Html center style={{ pointerEvents: 'none' }}>
        <div style={{
          color,
          fontSize: 18,
          fontWeight: 700,
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          textAlign: 'center',
        }}>
          <div>{Math.round(ratio * 100)}%</div>
          <div style={{ color: '#94A3B8', fontSize: 9, fontWeight: 600 }}>SESSION BUDGET</div>
          <div style={{ color: '#CBD5E1', fontSize: 9, fontWeight: 500 }}>
            {Math.round(spent)} / {Math.round(limit)}
          </div>
        </div>
      </Html>
    </group>
  );
}

function StatusLamp({
  label,
  value,
  tone,
  position,
}: {
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'bad';
  position: [number, number, number];
}) {
  const palette = tone === 'good'
    ? { color: '#10B981', glow: 0.35 }
    : tone === 'warn'
      ? { color: '#F5A623', glow: 0.5 }
      : { color: '#EF4444', glow: 0.72 };

  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[0.12, 12, 8]} />
        <meshStandardMaterial color={palette.color} emissive={palette.color} emissiveIntensity={palette.glow} />
      </mesh>

      <Html position={[0.55, 0, 0]} style={{ pointerEvents: 'none' }}>
        <div style={{
          minWidth: 120,
          padding: '5px 8px',
          borderRadius: 10,
          background: 'rgba(8, 12, 22, 0.7)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: '#E2E8F0',
          fontSize: 9,
          fontFamily: '"Segoe UI", system-ui, sans-serif',
        }}>
          <div style={{ fontWeight: 700, color: palette.color }}>{label}</div>
          <div>{value}</div>
        </div>
      </Html>
    </group>
  );
}

export function ControlView({ active }: ControlViewProps) {
  const snapshot = useWorldStore((state) => state.snapshot);

  if (!active) return null;

  const breakers = snapshot?.breakers ?? {};
  const budget = snapshot?.budget?.global ?? { totalSession: 100, spent: 0, remaining: 100, utilization: 0 };
  const quality = snapshot?.metrics?.quality ?? {};
  const breakerEntries = Object.entries(breakers);
  const cols = Math.max(1, Math.ceil(Math.sqrt(breakerEntries.length || 1)));
  const openBreakers = breakerEntries.filter(([, breaker]) => String(breaker.state).toUpperCase() === 'OPEN').length;
  const gatePassRate = quality.gatePassRate ?? 0;
  const violations = quality.violations ?? 0;
  const pipelineBreaks = quality.pipelineBreaks ?? 0;

  return (
    <group>
      <BudgetGauge
        utilization={budget.utilization ?? 0}
        spent={budget.spent ?? 0}
        limit={budget.totalSession ?? 0}
      />

      {breakerEntries.map(([name, breaker], index) => {
        const col = (index % cols) - (cols - 1) / 2;
        const row = Math.floor(index / cols);
        return (
          <BreakerSwitch
            key={name}
            name={name}
            state={String(breaker.state ?? 'CLOSED').toUpperCase()}
            position={[col * 2.1, 1, row * 2.1 + 5]}
          />
        );
      })}

      <StatusLamp
        label="Gate Pass Rate"
        value={`${Math.round(gatePassRate * 100)}%`}
        tone={gatePassRate > 0.8 ? 'good' : gatePassRate > 0.6 ? 'warn' : 'bad'}
        position={[-6, 1.1, -4]}
      />
      <StatusLamp
        label="Compliance Violations"
        value={`${violations}`}
        tone={violations === 0 ? 'good' : violations < 3 ? 'warn' : 'bad'}
        position={[-6, 2.0, -4]}
      />
      <StatusLamp
        label="Open Breakers"
        value={`${openBreakers}`}
        tone={openBreakers === 0 ? 'good' : openBreakers < 2 ? 'warn' : 'bad'}
        position={[-6, 2.9, -4]}
      />
      <StatusLamp
        label="Pipeline Breaks"
        value={`${pipelineBreaks}`}
        tone={pipelineBreaks === 0 ? 'good' : pipelineBreaks < 2 ? 'warn' : 'bad'}
        position={[-6, 3.8, -4]}
      />

      <Html fullscreen style={{ pointerEvents: 'none' }}>
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.02) 2px, rgba(0,0,0,0.02) 4px)',
          pointerEvents: 'none',
          zIndex: 5,
        }} />
      </Html>

      <pointLight position={[0, 5, 0]} color="#EF4444" intensity={0.3} distance={18} decay={2} />
    </group>
  );
}
