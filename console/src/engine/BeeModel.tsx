/**
 * BeeModel — Stylized 3D bee with PhysicsEngine + Soul + Disney interaction
 *
 * Visual design:
 *   - Elongated body with 3 amber/dark-brown alternating bands
 *   - Semi-transparent iridescent wings (leaf-shaped, not rectangles)
 *   - Emissive glow amplified by Bloom post-processing
 *   - Head with two dark compound-eye dots
 *   - Curved antennae + stinger
 *   - Soul personality modifies scale, wingHz, emissive, hueShift, specialEffect
 *   - Hover: emissive boost + scale 1.1 + tooltip
 *   - Click: Disney CLICK_SQUASH + select
 */

import { useRef, useMemo, useCallback, useState } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { ROLE_LABELS, ROLE_PARAMS, STATE_PARAMS } from './constants';
import { getCachedSoulDims, toVisualParams } from './SoulVisualMapper';
import { getAgentBehavior } from './BehaviorStateMachine';
import { clickSquash } from './DisneyAnimator';
import { useInteractionStore } from '../stores/interaction-store';
import type { PhysicsEngine } from './PhysicsEngine';

interface BeeProps {
  agentId: string;
  role: string;
  state: string;
  soul?: string | null;
  selected?: boolean;
  physicsEngine: PhysicsEngine;
  alpha: number;
}


// ── Wing geometry (leaf/ellipse shape) ──────────────────────────────────────

function createWingGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  // Leaf-shaped wing: pointed at root and tip, widest in middle
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.15, 0.25, 0.5, 0.35, 0.85, 0.12);
  shape.bezierCurveTo(0.95, 0.05, 0.9, -0.05, 0.8, -0.08);
  shape.bezierCurveTo(0.5, -0.18, 0.15, -0.12, 0, 0);
  const geo = new THREE.ShapeGeometry(shape, 8);
  // Center pivot at root
  return geo;
}

// ── Stripe band (torus ring around body) ────────────────────────────────────

function StripeBand({ y, color, emissive, emissiveIntensity }: {
  y: number;
  color: string;
  emissive: string;
  emissiveIntensity: number;
}) {
  return (
    <mesh position={[0, 0, y]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.44, 0.09, 8, 16]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
        roughness={0.5}
        metalness={0.05}
      />
    </mesh>
  );
}

export function BeeInstance({
  agentId,
  role,
  state,
  soul,
  selected = false,
  physicsEngine,
  alpha,
}: BeeProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const leftWingRef = useRef<THREE.Mesh>(null!);
  const rightWingRef = useRef<THREE.Mesh>(null!);
  const bodyMatRef = useRef<THREE.MeshStandardMaterial>(null!);
  const [hovered, setHovered] = useState(false);

  const selectAgent = useInteractionStore((s) => s.selectAgent);
  const selectedAgentId = useInteractionStore((s) => s.selectedAgentId);
  const toggleCompare = useInteractionStore((s) => s.toggleCompare);
  const hoverAgent = useInteractionStore((s) => s.hoverAgent);

  const params = ROLE_PARAMS[role] ?? ROLE_PARAMS.implementer;
  const stateParams = STATE_PARAMS[state?.toUpperCase()] ?? STATE_PARAMS.IDLE;

  // Soul visual modifications
  const soulDims = getCachedSoulDims(agentId, soul ?? null);
  const soulVisual = useMemo(
    () => toVisualParams(soulDims, role, state),
    [soulDims, role, state],
  );

  // Base color with soul hue shift
  const baseColor = useMemo(() => {
    const c = new THREE.Color(params.color);
    if (soulVisual.hueShift > 0) {
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      c.setHSL(
        hsl.h + soulVisual.hueShift / 360,
        Math.min(1, hsl.s * soulVisual.saturationMod),
        Math.min(1, hsl.l * soulVisual.lightnessMod),
      );
    }
    return c;
  }, [params.color, soulVisual.hueShift, soulVisual.saturationMod, soulVisual.lightnessMod]);

  // Amber/gold for bee body (role-tinted)
  const amberColor = useMemo(() => {
    const amber = new THREE.Color('#F5A623');
    return amber.lerp(baseColor.clone(), 0.3);
  }, [baseColor]);

  const darkBandColor = useMemo(() => {
    const dark = new THREE.Color('#2A1A05');
    return dark.lerp(baseColor.clone(), 0.15);
  }, [baseColor]);

  // Wing geometry (shared)
  const wingGeometry = useMemo(() => createWingGeometry(), []);

  // Wing material — semi-transparent iridescent
  const wingMaterial = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: '#c0d8ff',
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    emissive: baseColor,
    emissiveIntensity: 0.4,
    roughness: 0.1,
    metalness: 0.3,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    transmission: 0.3,
    depthWrite: false,
  }), [baseColor]);

  // Interaction handlers
  const handlePointerOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    hoverAgent(agentId);
    document.body.style.cursor = 'pointer';
  }, [agentId, hoverAgent]);

  const handlePointerOut = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(false);
    hoverAgent(null);
    document.body.style.cursor = 'default';
  }, [hoverAgent]);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (groupRef.current) {
      clickSquash(groupRef.current, soulVisual.scale);
    }
    if (e.nativeEvent.shiftKey && selectedAgentId && selectedAgentId !== agentId) {
      toggleCompare(agentId);
      return;
    }
    selectAgent(agentId);
  }, [agentId, selectAgent, selectedAgentId, soulVisual.scale, toggleCompare]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();

    // Get interpolated position from physics engine
    const pos = physicsEngine.getInterpolatedPosition(agentId, alpha);
    if (pos && groupRef.current) {
      groupRef.current.position.set(pos[0], pos[1], pos[2]);
    }

    // Face velocity direction
    const vel = physicsEngine.getVelocity(agentId);
    if (vel && groupRef.current) {
      const speed = Math.sqrt(vel[0] * vel[0] + vel[2] * vel[2]);
      if (speed > 0.005) {
        const targetAngle = Math.atan2(vel[0], vel[2]);
        const current = groupRef.current.rotation.y;
        groupRef.current.rotation.y = current + (targetAngle - current) * 0.1;
      }
    }

    // Behavior visual modifiers
    const behavior = getAgentBehavior(agentId);
    const wingHzMod = behavior?.visual.wingHzMod ?? 1.0;
    const scaleMod = behavior?.visual.scaleMod ?? 1.0;

    const hoverMod = hovered ? 1.1 : 1.0;

    // Wing flapping — faster frequency, more dramatic angle
    const effectiveWingHz = soulVisual.wingHz * wingHzMod;
    const wingAngle = Math.sin(t * effectiveWingHz * Math.PI * 2 / 60) * 0.7;
    if (leftWingRef.current) {
      leftWingRef.current.rotation.z = 0.5 + wingAngle;
    }
    if (rightWingRef.current) {
      rightWingRef.current.rotation.z = -(0.5 + wingAngle);
    }

    // Breathing + hover bob
    if (groupRef.current) {
      const breathe = 1 + Math.sin(t * stateParams.breatheHz * Math.PI * 2) * 0.03;
      groupRef.current.scale.setScalar(soulVisual.scale * scaleMod * breathe * hoverMod);
    }

    // Emissive from behavior + hover
    if (bodyMatRef.current) {
      const baseEmissive = soulVisual.emissiveBoost * 0.8;
      const emissiveMod = behavior?.visual.emissiveMod ?? 0;
      const hoverBoost = hovered ? 0.5 : 0;
      bodyMatRef.current.emissiveIntensity = Math.max(0.1, baseEmissive + emissiveMod * 0.3 + hoverBoost);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Invisible hit area */}
      <mesh
        visible={false}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      >
        <sphereGeometry args={[0.9, 8, 6]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* Abdomen (rear body) — elongated amber */}
      <mesh position={[0, 0, -0.25]} scale={[1, 0.9, 1.3]}>
        <sphereGeometry args={[0.45, 16, 12]} />
        <meshStandardMaterial
          ref={bodyMatRef}
          color={amberColor}
          emissive={amberColor}
          emissiveIntensity={stateParams.emissive * 0.8}
          roughness={0.35}
          metalness={0.08}
        />
      </mesh>

      {/* Dark stripe bands on abdomen */}
      <StripeBand y={-0.15} color={`#${darkBandColor.getHexString()}`} emissive={`#${darkBandColor.getHexString()}`} emissiveIntensity={0.1} />
      <StripeBand y={-0.38} color={`#${darkBandColor.getHexString()}`} emissive={`#${darkBandColor.getHexString()}`} emissiveIntensity={0.1} />

      {/* Thorax (mid section) */}
      <mesh position={[0, 0.05, 0.2]} scale={[0.85, 0.8, 0.7]}>
        <sphereGeometry args={[0.38, 14, 10]} />
        <meshStandardMaterial
          color={darkBandColor}
          emissive={amberColor}
          emissiveIntensity={0.15}
          roughness={0.4}
          metalness={0.05}
        />
      </mesh>

      {/* Head */}
      <mesh position={[0, 0.05, 0.55]}>
        <sphereGeometry args={[0.22, 12, 10]} />
        <meshStandardMaterial
          color={amberColor}
          emissive={amberColor}
          emissiveIntensity={stateParams.emissive * 0.5}
          roughness={0.4}
          metalness={0.1}
        />
      </mesh>

      {/* Compound eyes (dark glossy) */}
      <mesh position={[0.12, 0.1, 0.68]}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshStandardMaterial color="#111" emissive={baseColor} emissiveIntensity={0.3} roughness={0.1} metalness={0.6} />
      </mesh>
      <mesh position={[-0.12, 0.1, 0.68]}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshStandardMaterial color="#111" emissive={baseColor} emissiveIntensity={0.3} roughness={0.1} metalness={0.6} />
      </mesh>

      {/* Left wing (leaf shape) */}
      <mesh
        ref={leftWingRef}
        position={[0.15, 0.25, 0.1]}
        rotation={[0.15, 0.1, 0.5]}
        scale={[1, 1, 1]}
        geometry={wingGeometry}
        material={wingMaterial}
      />

      {/* Right wing (leaf shape, mirrored) */}
      <mesh
        ref={rightWingRef}
        position={[-0.15, 0.25, 0.1]}
        rotation={[0.15, -0.1, -0.5]}
        scale={[-1, 1, 1]}
        geometry={wingGeometry}
        material={wingMaterial}
      />

      {/* Antennae — curved with ball tips */}
      <mesh position={[0.08, 0.18, 0.72]} rotation={[0.6, 0.15, 0.25]}>
        <cylinderGeometry args={[0.012, 0.008, 0.35, 4]} />
        <meshStandardMaterial color="#2A1A05" roughness={0.5} />
      </mesh>
      <mesh position={[0.15, 0.32, 0.88]}>
        <sphereGeometry args={[0.025, 6, 6]} />
        <meshStandardMaterial color={amberColor} emissive={amberColor} emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[-0.08, 0.18, 0.72]} rotation={[0.6, -0.15, -0.25]}>
        <cylinderGeometry args={[0.012, 0.008, 0.35, 4]} />
        <meshStandardMaterial color="#2A1A05" roughness={0.5} />
      </mesh>
      <mesh position={[-0.15, 0.32, 0.88]}>
        <sphereGeometry args={[0.025, 6, 6]} />
        <meshStandardMaterial color={amberColor} emissive={amberColor} emissiveIntensity={0.4} />
      </mesh>

      {/* Stinger */}
      <mesh position={[0, -0.02, -0.68]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.04, 0.25, 6]} />
        <meshStandardMaterial color="#1a1008" roughness={0.3} metalness={0.2} />
      </mesh>

      {/* Legs (3 pairs, simplified) */}
      {[-0.18, 0, 0.18].map((z, i) => (
        <group key={i}>
          <mesh position={[0.3, -0.2, z]} rotation={[0, 0, -0.8]}>
            <cylinderGeometry args={[0.012, 0.008, 0.3, 3]} />
            <meshStandardMaterial color="#2A1A05" roughness={0.6} />
          </mesh>
          <mesh position={[-0.3, -0.2, z]} rotation={[0, 0, 0.8]}>
            <cylinderGeometry args={[0.012, 0.008, 0.3, 3]} />
            <meshStandardMaterial color="#2A1A05" roughness={0.6} />
          </mesh>
        </group>
      ))}

      {/* Selection ring */}
      {selected && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.9, 0.95, 32]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.8} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Ambient glow sphere (soft emissive halo — Bloom will amplify) */}
      <mesh>
        <sphereGeometry args={[0.7, 8, 6]} />
        <meshBasicMaterial
          color={baseColor}
          transparent
          opacity={0.04}
          depthWrite={false}
        />
      </mesh>

      {/* Hover tooltip */}
      {hovered && (
        <Html position={[0, 1.2, 0]} center style={{ pointerEvents: 'none' }}>
          <div style={{
            background: 'rgba(12,12,30,0.9)',
            backdropFilter: 'blur(8px)',
            border: `1px solid ${params.color}40`,
            borderRadius: 6,
            padding: '4px 10px',
            color: '#fff',
            fontSize: 11,
            whiteSpace: 'nowrap',
            fontFamily: '"Segoe UI", sans-serif',
          }}>
            <span style={{ color: params.color, fontWeight: 600 }}>
              {ROLE_LABELS[role] ?? role}
            </span>
            <span style={{ color: '#888', margin: '0 4px' }}>·</span>
            <span style={{ color: '#aaa' }}>{state?.toUpperCase()}</span>
            <div style={{ color: '#666', fontSize: 9, marginTop: 1 }}>
              {agentId.slice(0, 12)}
            </div>
          </div>
        </Html>
      )}

      {/* Soul special effect: shield */}
      {soulVisual.specialEffect === 'shield' && (
        <mesh>
          <sphereGeometry args={[1.0, 16, 12]} />
          <meshStandardMaterial
            color="#3B82F6"
            transparent
            opacity={0.06}
            side={THREE.DoubleSide}
            emissive="#3B82F6"
            emissiveIntensity={0.5}
          />
        </mesh>
      )}
    </group>
  );
}

/**
 * DemoBee — standalone bee for preview, no physics engine.
 */
export function DemoBee({
  role = 'implementer',
  state = 'ACTIVE',
  position = [0, 3, 0] as [number, number, number],
}: {
  role?: string;
  state?: string;
  position?: [number, number, number];
}) {
  const groupRef = useRef<THREE.Group>(null!);
  const leftWingRef = useRef<THREE.Mesh>(null!);
  const rightWingRef = useRef<THREE.Mesh>(null!);

  const params = ROLE_PARAMS[role] ?? ROLE_PARAMS.implementer;
  const stateParams = STATE_PARAMS[state?.toUpperCase()] ?? STATE_PARAMS.IDLE;
  const color = useMemo(() => new THREE.Color(params.color), [params.color]);
  const amber = useMemo(() => new THREE.Color('#F5A623').lerp(color.clone(), 0.3), [color]);
  const dark = useMemo(() => new THREE.Color('#2A1A05').lerp(color.clone(), 0.15), [color]);
  const wingGeo = useMemo(() => createWingGeometry(), []);
  const wingMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: '#c0d8ff',
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    emissive: color,
    emissiveIntensity: 0.4,
    roughness: 0.1,
    metalness: 0.3,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    depthWrite: false,
  }), [color]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const wingAngle = Math.sin(t * params.wingHz * Math.PI * 2 / 60) * 0.7;
    if (leftWingRef.current) leftWingRef.current.rotation.z = 0.5 + wingAngle;
    if (rightWingRef.current) rightWingRef.current.rotation.z = -(0.5 + wingAngle);
    if (groupRef.current) {
      const breathe = 1 + Math.sin(t * stateParams.breatheHz * Math.PI * 2) * 0.03;
      groupRef.current.scale.setScalar(params.scale * breathe);
      groupRef.current.position.y = position[1] + Math.sin(t * 0.8) * 0.15;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      <mesh position={[0, 0, -0.25]} scale={[1, 0.9, 1.3]}>
        <sphereGeometry args={[0.45, 16, 12]} />
        <meshStandardMaterial color={amber} emissive={amber} emissiveIntensity={stateParams.emissive * 0.8} roughness={0.35} metalness={0.08} />
      </mesh>
      <StripeBand y={-0.15} color={`#${dark.getHexString()}`} emissive={`#${dark.getHexString()}`} emissiveIntensity={0.1} />
      <StripeBand y={-0.38} color={`#${dark.getHexString()}`} emissive={`#${dark.getHexString()}`} emissiveIntensity={0.1} />
      <mesh position={[0, 0.05, 0.2]} scale={[0.85, 0.8, 0.7]}>
        <sphereGeometry args={[0.38, 14, 10]} />
        <meshStandardMaterial color={dark} emissive={amber} emissiveIntensity={0.15} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.05, 0.55]}>
        <sphereGeometry args={[0.22, 12, 10]} />
        <meshStandardMaterial color={amber} emissive={amber} emissiveIntensity={stateParams.emissive * 0.5} roughness={0.4} />
      </mesh>
      <mesh ref={leftWingRef} position={[0.15, 0.25, 0.1]} rotation={[0.15, 0.1, 0.5]} geometry={wingGeo} material={wingMat} />
      <mesh ref={rightWingRef} position={[-0.15, 0.25, 0.1]} rotation={[0.15, -0.1, -0.5]} scale={[-1, 1, 1]} geometry={wingGeo} material={wingMat} />
      <mesh position={[0, -0.02, -0.68]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.04, 0.25, 6]} />
        <meshStandardMaterial color="#1a1008" roughness={0.3} metalness={0.2} />
      </mesh>
    </group>
  );
}
