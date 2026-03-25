/**
 * TrailRenderer — Ribbon trails behind EXECUTING bees
 *
 * Each EXECUTING agent maintains a position history (last 50 frames).
 * Rendered as a BufferGeometry ribbon with fading opacity from head to tail.
 * Color: trail amber (#F5A623) → transparent.
 */

import { useRef, useMemo, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PHEROMONE_COLORS } from '../engine/constants';
import type { PhysicsEngine } from '../engine/PhysicsEngine';
import { useWorldStore } from '../stores/world-store';

const TRAIL_LENGTH = 50;
const TRAIL_WIDTH = 0.08;

interface TrailData {
  positions: Float32Array;   // TRAIL_LENGTH × 3
  colors: Float32Array;      // TRAIL_LENGTH × 4 (RGBA)
  head: number;              // circular buffer head
  count: number;             // filled positions
}

interface TrailRendererProps {
  physicsEngine: PhysicsEngine;
}

export function TrailRenderer({ physicsEngine }: TrailRendererProps) {
  const trailsRef = useRef<Map<string, TrailData>>(new Map());
  const meshesRef = useRef<Map<string, THREE.Line>>(new Map());
  const groupRef = useRef<THREE.Group>(null!);

  const trailColor = useMemo(() => new THREE.Color(PHEROMONE_COLORS.trail), []);

  // Update trail positions for EXECUTING agents
  useFrame(() => {
    const snapshot = useWorldStore.getState().snapshot;
    const agents = snapshot?.agents ?? [];
    const trails = trailsRef.current;
    const meshes = meshesRef.current;
    const group = groupRef.current;
    if (!group) return;

    const executingIds = new Set<string>();

    for (const agent of agents) {
      const state = agent.state?.toUpperCase() ?? 'IDLE';
      if (state !== 'EXECUTING') continue;
      executingIds.add(agent.id);

      const pos = physicsEngine.getInterpolatedPosition(agent.id, 1.0);
      if (!pos) continue;

      // Get or create trail data
      let trail = trails.get(agent.id);
      if (!trail) {
        trail = {
          positions: new Float32Array(TRAIL_LENGTH * 3),
          colors: new Float32Array(TRAIL_LENGTH * 4),
          head: 0,
          count: 0,
        };
        // Fill with initial position
        for (let i = 0; i < TRAIL_LENGTH; i++) {
          trail.positions[i * 3] = pos[0];
          trail.positions[i * 3 + 1] = pos[1];
          trail.positions[i * 3 + 2] = pos[2];
        }
        trails.set(agent.id, trail);
      }

      // Add new position at head
      const h = trail.head;
      trail.positions[h * 3] = pos[0];
      trail.positions[h * 3 + 1] = pos[1];
      trail.positions[h * 3 + 2] = pos[2];
      trail.head = (h + 1) % TRAIL_LENGTH;
      trail.count = Math.min(trail.count + 1, TRAIL_LENGTH);

      // Build ordered position array for Line geometry (tail → head)
      const orderedPositions = new Float32Array(trail.count * 3);
      const orderedColors = new Float32Array(trail.count * 4);

      for (let i = 0; i < trail.count; i++) {
        const srcIdx = ((trail.head - trail.count + i + TRAIL_LENGTH) % TRAIL_LENGTH);
        const t = i / Math.max(1, trail.count - 1); // 0=tail, 1=head

        orderedPositions[i * 3] = trail.positions[srcIdx * 3];
        orderedPositions[i * 3 + 1] = trail.positions[srcIdx * 3 + 1];
        orderedPositions[i * 3 + 2] = trail.positions[srcIdx * 3 + 2];

        // Color: fade from transparent (tail) to full (head)
        orderedColors[i * 4] = trailColor.r;
        orderedColors[i * 4 + 1] = trailColor.g;
        orderedColors[i * 4 + 2] = trailColor.b;
        orderedColors[i * 4 + 3] = t * 0.6; // opacity: 0 → 0.6
      }

      // Get or create Line mesh
      let lineMesh = meshes.get(agent.id);
      if (!lineMesh) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(orderedPositions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(orderedColors, 4));
        const material = new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          linewidth: 1,
        });
        lineMesh = new THREE.Line(geometry, material);
        lineMesh.frustumCulled = false;
        meshes.set(agent.id, lineMesh);
        group.add(lineMesh);
      } else {
        // Update existing geometry
        const geom = lineMesh.geometry;
        geom.setAttribute('position', new THREE.BufferAttribute(orderedPositions, 3));
        geom.setAttribute('color', new THREE.BufferAttribute(orderedColors, 4));
        geom.attributes.position.needsUpdate = true;
        geom.attributes.color.needsUpdate = true;
      }
    }

    // Clean up trails for agents no longer EXECUTING
    for (const [id, lineMesh] of meshes) {
      if (!executingIds.has(id)) {
        group.remove(lineMesh);
        lineMesh.geometry.dispose();
        (lineMesh.material as THREE.Material).dispose();
        meshes.delete(id);
        trails.delete(id);
      }
    }
  });

  return <group ref={groupRef} />;
}
