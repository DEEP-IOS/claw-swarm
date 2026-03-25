/**
 * NetworkView — SNA force-directed graph
 *
 * Cyan-toned network topology with:
 *   - ForceGraph3D component for node/edge layout
 *   - Centrality-based node sizing
 *   - Communication frequency edge weight
 *   - Gossip event light flow on edges
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { ForceGraph3D, type GraphNode, type GraphEdge } from '../three/ForceGraph3D';
import { useWorldStore } from '../stores/world-store';

interface NetworkViewProps {
  active: boolean;
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function NetworkView({ active }: NetworkViewProps) {
  const snapshot = useWorldStore((s) => s.snapshot);

  // Build graph from agents + pheromone data
  const { nodes, edges } = useMemo(() => {
    const agents = snapshot?.agents ?? [];
    const graphNodes: GraphNode[] = agents.map((a) => {
      const h = hashCode(a.id);
      // Fibonacci sphere distribution for initial placement
      const phi = Math.acos(1 - 2 * (h % 100) / 100);
      const theta = Math.PI * (1 + Math.sqrt(5)) * (h % 50);
      const r = 6;
      return {
        id: a.id,
        role: a.role,
        centrality: a.reputation ?? 0.5,
        position: [
          r * Math.sin(phi) * Math.cos(theta),
          3 + r * Math.cos(phi) * 0.3,
          r * Math.sin(phi) * Math.sin(theta),
        ] as [number, number, number],
        velocity: [0, 0, 0] as [number, number, number],
      };
    });

    // Build edges from: agents sharing tasks, parent-child, and proximity
    const graphEdges: GraphEdge[] = [];
    const edgeSet = new Set<string>();

    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const a = agents[i], b = agents[j];
        let weight = 0;

        // Parent-child
        if (a.parentId === b.id || b.parentId === a.id) weight += 1.5;
        // Same task
        if (a.taskId && a.taskId === b.taskId) weight += 1.0;
        // Same role cohesion
        if (a.role === b.role) weight += 0.3;

        if (weight > 0) {
          const key = `${a.id}-${b.id}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            graphEdges.push({ source: a.id, target: b.id, weight });
          }
        }
      }
    }

    return { nodes: graphNodes, edges: graphEdges };
  }, [snapshot?.agents]);

  if (!active) return null;

  return (
    <group>
      {/* Background glow ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 3, 0]}>
        <ringGeometry args={[10, 10.12, 64]} />
        <meshBasicMaterial
          color="#06B6D4"
          transparent
          opacity={0.1}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Network ambient light */}
      <pointLight position={[0, 6, 0]} color="#06B6D4" intensity={0.5} distance={20} decay={2} />

      {/* Force-directed graph */}
      <ForceGraph3D nodes={nodes} edges={edges} />
    </group>
  );
}
