import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Html } from '@react-three/drei';
import * as THREE from 'three';
import { colors, DIMENSIONS, DIMENSION_LABELS } from '../../theme/tokens';
import type { FieldVector } from '../../stores/field-store';

// Golden spiral distribution for 12 points on a sphere
function fibonacciSphere(n: number, radius: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const phi = Math.PI * (Math.sqrt(5) - 1); // golden angle
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    points.push(new THREE.Vector3(
      Math.cos(theta) * r * radius,
      y * radius,
      Math.sin(theta) * r * radius,
    ));
  }
  return points;
}

function SignalSphere({ vector }: { vector: FieldVector }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  const dimPositions = useMemo(() => fibonacciSphere(12, 2.2), []);

  // Animate rotation
  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.08;
    }
    if (glowRef.current) {
      glowRef.current.rotation.y -= delta * 0.03;
    }
  });

  // Compute overall energy from vector
  const energy = useMemo(() => {
    const vals = Object.values(vector);
    if (vals.length === 0) return 0;
    return vals.reduce((sum, v) => sum + (v || 0), 0) / vals.length;
  }, [vector]);

  const sphereColor = new THREE.Color(colors.glow.primary).lerp(
    new THREE.Color(colors.glow.secondary),
    Math.min(1, energy * 2),
  );

  return (
    <>
      {/* Inner wireframe sphere */}
      <mesh ref={meshRef}>
        <icosahedronGeometry args={[1.8, 2]} />
        <meshBasicMaterial
          color={sphereColor}
          wireframe
          transparent
          opacity={0.15 + energy * 0.3}
        />
      </mesh>

      {/* Outer glow sphere */}
      <mesh ref={glowRef}>
        <icosahedronGeometry args={[2.0, 1]} />
        <meshBasicMaterial
          color={sphereColor}
          wireframe
          transparent
          opacity={0.05 + energy * 0.1}
        />
      </mesh>

      {/* Core point */}
      <mesh>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial color={colors.glow.primary} />
      </mesh>

      {/* Dimension markers on sphere surface */}
      {DIMENSIONS.map((dim, i) => {
        const pos = dimPositions[i];
        if (!pos) return null;
        const val = vector[dim] ?? 0;
        const dimColor = colors.dimension[dim] || colors.glow.primary;
        const markerSize = 0.04 + val * 0.12;

        return (
          <group key={dim} position={[pos.x, pos.y, pos.z]}>
            {/* Glowing dot */}
            <mesh>
              <sphereGeometry args={[markerSize, 12, 12]} />
              <meshBasicMaterial
                color={dimColor}
                transparent
                opacity={0.4 + val * 0.6}
              />
            </mesh>

            {/* Axis line from center */}
            <line>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[new Float32Array([0, 0, 0, -pos.x, -pos.y, -pos.z]), 3]}
                  count={2}
                  itemSize={3}
                />
              </bufferGeometry>
              <lineBasicMaterial color={dimColor} transparent opacity={0.1 + val * 0.3} />
            </line>

            {/* Label */}
            <Html
              position={[pos.x * 0.25, pos.y * 0.25, pos.z * 0.25]}
              center
              style={{ pointerEvents: 'none' }}
            >
              <div style={{
                fontSize: 9,
                color: dimColor,
                whiteSpace: 'nowrap',
                opacity: 0.7 + val * 0.3,
                textShadow: `0 0 6px ${dimColor}44`,
                fontFamily: 'Inter, sans-serif',
              }}>
                {DIMENSION_LABELS[dim]}
                {val > 0.01 && <span style={{ marginLeft: 3, opacity: 0.6 }}>{val.toFixed(2)}</span>}
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}

interface FieldSphereProps {
  vector: FieldVector;
  width?: number;
  height?: number;
}

export function FieldSphere({ vector, width = 500, height = 400 }: FieldSphereProps) {
  return (
    <div style={{ width, height, borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <Canvas
        camera={{ position: [0, 0, 5.5], fov: 50 }}
        style={{ background: 'transparent' }}
        gl={{ alpha: true, antialias: true }}
      >
        <ambientLight intensity={0.3} />
        <pointLight position={[10, 10, 10]} intensity={0.5} />
        <SignalSphere vector={vector} />
        <OrbitControls
          enableZoom={true}
          enablePan={false}
          minDistance={3}
          maxDistance={9}
          autoRotate={false}
        />
      </Canvas>
    </div>
  );
}
