/**
 * SubAgentLinks — Dashed lines connecting parent and child agents
 *
 * Reads agent.parentId from WorldSnapshot, draws a dashed Line
 * from parent position to child position. Color = role color at 30% opacity.
 */

import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { ROLE_PARAMS } from '../engine/constants';
import type { PhysicsEngine } from '../engine/PhysicsEngine';

interface SubAgentLinksProps {
  agents: Array<{ id: string; role: string; parentId?: string | null }>;
  physicsEngine: PhysicsEngine;
  alpha: number;
}

export function SubAgentLinks({ agents, physicsEngine, alpha }: SubAgentLinksProps) {
  // Find all parent-child pairs
  const links = useMemo(() => {
    const result: Array<{ childId: string; parentId: string; color: string }> = [];
    for (const agent of agents) {
      if (agent.parentId && agents.some(a => a.id === agent.parentId)) {
        const roleParams = ROLE_PARAMS[agent.role] ?? ROLE_PARAMS.implementer;
        result.push({
          childId: agent.id,
          parentId: agent.parentId,
          color: roleParams.color,
        });
      }
    }
    return result;
  }, [agents]);

  if (links.length === 0) return null;

  return (
    <>
      {links.map(link => (
        <LinkLine
          key={`${link.parentId}-${link.childId}`}
          parentId={link.parentId}
          childId={link.childId}
          color={link.color}
          physicsEngine={physicsEngine}
          alpha={alpha}
        />
      ))}
    </>
  );
}

interface LinkLineProps {
  parentId: string;
  childId: string;
  color: string;
  physicsEngine: PhysicsEngine;
  alpha: number;
}

function LinkLine({ parentId, childId, color, physicsEngine, alpha }: LinkLineProps) {
  const parentPos = physicsEngine.getInterpolatedPosition(parentId, alpha);
  const childPos = physicsEngine.getInterpolatedPosition(childId, alpha);

  if (!parentPos || !childPos) return null;

  return (
    <Line
      points={[parentPos, childPos]}
      color={color}
      lineWidth={1.5}
      dashed
      dashSize={0.3}
      gapSize={0.4}
      opacity={0.3}
      transparent
    />
  );
}
