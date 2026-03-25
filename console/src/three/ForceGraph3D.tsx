/**
 * ForceGraph3D — 3D force-directed graph for Network view
 *
 * Self-contained force simulation (no d3-force dependency):
 *   Repulsion: F = -k / dist^2 (all node pairs)
 *   Attraction: F = dist × 0.01 (connected pairs)
 *
 * Nodes = spheres sized by centrality.
 * Edges = glowing lines with flowing light points for gossip events.
 */

import { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ROLE_PARAMS } from '../engine/constants';

export interface GraphNode {
  id: string;
  role: string;
  centrality: number;
  position: [number, number, number];
  velocity: [number, number, number];
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

interface ForceGraph3DProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const REPULSION_K = 50;
const ATTRACTION_K = 0.01;
const DAMPING = 0.92;
const MAX_SPEED = 0.3;
const CENTER_PULL = 0.002;

/** Run one iteration of the force simulation in-place */
function simulateForces(nodes: GraphNode[], edges: GraphEdge[]) {
  // Repulsion between all pairs
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = a.position[0] - b.position[0];
      const dy = a.position[1] - b.position[1];
      const dz = a.position[2] - b.position[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
      const force = REPULSION_K / (dist * dist);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const fz = (dz / dist) * force;
      a.velocity[0] += fx; a.velocity[1] += fy; a.velocity[2] += fz;
      b.velocity[0] -= fx; b.velocity[1] -= fy; b.velocity[2] -= fz;
    }
  }

  // Attraction along edges
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  for (const edge of edges) {
    const a = nodeMap.get(edge.source);
    const b = nodeMap.get(edge.target);
    if (!a || !b) continue;
    const dx = b.position[0] - a.position[0];
    const dy = b.position[1] - a.position[1];
    const dz = b.position[2] - a.position[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
    const force = dist * ATTRACTION_K * edge.weight;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    const fz = (dz / dist) * force;
    a.velocity[0] += fx; a.velocity[1] += fy; a.velocity[2] += fz;
    b.velocity[0] -= fx; b.velocity[1] -= fy; b.velocity[2] -= fz;
  }

  // Center pull + integration
  for (const node of nodes) {
    node.velocity[0] -= node.position[0] * CENTER_PULL;
    node.velocity[1] -= (node.position[1] - 3) * CENTER_PULL;
    node.velocity[2] -= node.position[2] * CENTER_PULL;

    // Damping
    node.velocity[0] *= DAMPING;
    node.velocity[1] *= DAMPING;
    node.velocity[2] *= DAMPING;

    // Clamp speed
    const speed = Math.sqrt(
      node.velocity[0] ** 2 + node.velocity[1] ** 2 + node.velocity[2] ** 2,
    );
    if (speed > MAX_SPEED) {
      const s = MAX_SPEED / speed;
      node.velocity[0] *= s; node.velocity[1] *= s; node.velocity[2] *= s;
    }

    // Integrate
    node.position[0] += node.velocity[0];
    node.position[1] += node.velocity[1];
    node.position[2] += node.velocity[2];
  }
}

/** Single graph node (sphere) */
function GraphNodeMesh({ node }: { node: GraphNode }) {
  const ref = useRef<THREE.Mesh>(null!);
  const color = ROLE_PARAMS[node.role]?.color ?? '#06B6D4';
  const size = 0.3 + node.centrality * 0.8;

  useFrame(() => {
    if (ref.current) {
      ref.current.position.set(...node.position);
    }
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[size, 12, 8]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.35 + node.centrality * 0.4}
        roughness={0.3}
        metalness={0.15}
      />
    </mesh>
  );
}

/** Edge line with flowing light point */
function GraphEdgeLine({ edge, nodes }: { edge: GraphEdge; nodes: GraphNode[] }) {
  const lineRef = useRef<THREE.Line>(null!);
  const dotRef = useRef<THREE.Mesh>(null!);
  const sourceNode = nodes.find(n => n.id === edge.source);
  const targetNode = nodes.find(n => n.id === edge.target);

  const geom = useMemo(() => new THREE.BufferGeometry(), []);
  const positions = useMemo(() => new Float32Array(6), []);
  const opacity = Math.min(0.5, 0.1 + edge.weight * 0.2);
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#06B6D4', transparent: true, opacity }), [opacity]);
  const lineObj = useMemo(() => new THREE.Line(geom, lineMat), [geom, lineMat]);

  useFrame(({ clock }) => {
    if (!sourceNode || !targetNode) return;

    // Update line positions
    positions[0] = sourceNode.position[0];
    positions[1] = sourceNode.position[1];
    positions[2] = sourceNode.position[2];
    positions[3] = targetNode.position[0];
    positions[4] = targetNode.position[1];
    positions[5] = targetNode.position[2];
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.attributes.position.needsUpdate = true;

    // Flowing dot
    if (dotRef.current) {
      const t = (clock.getElapsedTime() * 0.3 * edge.weight) % 1;
      dotRef.current.position.set(
        sourceNode.position[0] + (targetNode.position[0] - sourceNode.position[0]) * t,
        sourceNode.position[1] + (targetNode.position[1] - sourceNode.position[1]) * t,
        sourceNode.position[2] + (targetNode.position[2] - sourceNode.position[2]) * t,
      );
    }
  });

  return (
    <group>
      <primitive ref={lineRef} object={lineObj} />
      <mesh ref={dotRef}>
        <sphereGeometry args={[0.06, 6, 4]} />
        <meshStandardMaterial color="#06B6D4" emissive="#06B6D4" emissiveIntensity={0.5} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

export function ForceGraph3D({ nodes, edges }: ForceGraph3DProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const frameCount = useRef(0);

  useFrame(() => {
    // Run simulation every 2 frames for perf
    frameCount.current++;
    if (frameCount.current % 2 === 0) {
      simulateForces(nodes, edges);
    }
  });

  return (
    <group ref={groupRef}>
      {nodes.map(node => (
        <GraphNodeMesh key={node.id} node={node} />
      ))}
      {edges.map((edge, i) => (
        <GraphEdgeLine key={`${edge.source}-${edge.target}-${i}`} edge={edge} nodes={nodes} />
      ))}
    </group>
  );
}
