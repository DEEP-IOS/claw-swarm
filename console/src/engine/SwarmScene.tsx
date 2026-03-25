/**
 * SwarmScene — Root 3D Canvas with physics, transitions, and 10 views
 *
 * Architecture:
 *   - PhysicsEngine (30Hz Boids) + FrameScheduler (decoupled from 60Hz render)
 *   - ViewTransitionManager (800ms camera fly + color lerp + agent morph)
 *   - BehaviorStateMachine (12 behaviors per agent)
 *   - 10 domain views (hive/pipeline/cognition/ecology/network/control/field/system/adaptation/communication)
 *   - HiveEnvironment (hex floor + dust + radar) — always rendered
 *   - PheromoneSystem + TrailRenderer + SubAgentLinks — always rendered
 *   - BeeInstance per agent with soul-driven visuals
 */

import { useRef, useMemo, useEffect, useCallback, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

// Engine
import { PhysicsEngine } from './PhysicsEngine';
import { FrameScheduler } from './FrameScheduler';
import { ViewTransitionManager, VIEW_CONFIGS } from './ViewTransitionManager';
import { evaluateBehavior } from './BehaviorStateMachine';
import { BeeInstance } from './BeeModel';
import { PostProcessing } from './PostProcessing';

// 3D environment
import { HiveEnvironment } from '../three/HiveEnvironment';
import { PheromoneSystem } from '../three/PheromoneSystem';
import { TrailRenderer } from '../three/TrailRenderer';
import { SubAgentLinks } from '../three/SubAgentLinks';

// 10 views
import { HiveView } from '../views/HiveView';
import { PipelineView } from '../views/PipelineView';
import { CognitionView } from '../views/CognitionView';
import { EcologyView } from '../views/EcologyView';
import { NetworkView } from '../views/NetworkView';
import { ControlView } from '../views/ControlView';
import { FieldView } from '../views/FieldView';
import { SystemView } from '../views/SystemView';
import { AdaptationView } from '../views/AdaptationView';
import { CommunicationView } from '../views/CommunicationView';

// Stores
import { useWorldStore } from '../stores/world-store';
import { useViewStore } from '../stores/view-store';
import { useInteractionStore } from '../stores/interaction-store';
import type { ViewId } from '../stores/view-store';

// ── Exported for Header tab-switch integration ──────────────────────────────

/** Singleton manager — created once inside SceneContent, exported for Header */
export let transitionManager: {
  transition: (from: ViewId, to: ViewId) => void;
  tick: (camera: THREE.Camera, ambient: THREE.Light | null, point: THREE.PointLight | null) => void;
  transitioning: boolean;
} = { transition: () => {}, tick: () => {}, transitioning: false };

// ── SceneContent (rendered inside Canvas) ───────────────────────────────────

function SceneContent() {
  const { camera } = useThree();

  // Stores
  const snapshot = useWorldStore((s) => s.snapshot);
  const currentView = useViewStore((s) => s.currentView);
  const previousView = useViewStore((s) => s.previousView);
  const transitioning = useViewStore((s) => s.transitioning);
  const setTransitioning = useViewStore((s) => s.setTransitioning);
  const selectedAgentId = useInteractionStore((s) => s.selectedAgentId);
  const compareAgentId = useInteractionStore((s) => s.compareAgentId);

  // Refs for lights (ViewTransitionManager lerps their colors)
  const ambientRef = useRef<THREE.AmbientLight>(null!);
  const pointRef = useRef<THREE.PointLight>(null!);

  // Physics + scheduling + transitions — stable singletons
  const physicsEngine = useMemo(() => new PhysicsEngine(), []);
  const frameScheduler = useMemo(() => new FrameScheduler(() => {
    const snap = useWorldStore.getState().snapshot;
    if (snap) {
      // Evaluate behaviors for all agents
      for (const agent of snap.agents) {
        evaluateBehavior(agent, snap);
      }
      physicsEngine.tick(snap);
    }
  }, 30), [physicsEngine]);

  const viewTransition = useMemo(
    () => new ViewTransitionManager(physicsEngine),
    [physicsEngine],
  );

  // Expose transition manager for Header
  useEffect(() => {
    transitionManager = viewTransition;
    return () => {
      transitionManager = { transition: () => {}, tick: () => {}, transitioning: false };
    };
  }, [viewTransition]);

  // React to view changes from store
  const prevViewRef = useRef<ViewId>(currentView);
  useEffect(() => {
    if (transitioning && previousView && previousView !== currentView) {
      viewTransition.transition(previousView, currentView);
      prevViewRef.current = currentView;
    }
  }, [transitioning, previousView, currentView, viewTransition]);

  // End transition when ViewTransitionManager finishes
  useEffect(() => {
    if (!viewTransition.transitioning && transitioning) {
      setTransitioning(false);
    }
  });

  // Alpha for interpolation
  const alphaRef = useRef(0);

  // Main render loop
  useFrame((_state, _delta) => {
    const now = performance.now();
    alphaRef.current = frameScheduler.update(now);

    // Drive camera + light transitions
    viewTransition.tick(
      camera,
      ambientRef.current,
      pointRef.current,
    );
  });

  // Set initial camera position
  useEffect(() => {
    const cfg = VIEW_CONFIGS[currentView];
    if (cfg) {
      camera.position.copy(cfg.cameraPosition);
      camera.lookAt(cfg.cameraTarget);
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Agents from snapshot
  const agents = snapshot?.agents ?? [];

  // Initial light colors from current view config
  const viewCfg = VIEW_CONFIGS[currentView];

  return (
    <>
      {/* Fog — depth atmosphere */}
      <fog attach="fog" args={['#080816', 25, 80]} />

      {/* Lighting — colors driven by ViewTransitionManager */}
      <ambientLight
        ref={ambientRef}
        color={viewCfg?.ambientColor ?? '#1a1a3e'}
        intensity={0.5}
      />
      <pointLight
        ref={pointRef}
        color={viewCfg?.pointLightColor ?? '#7B61FF'}
        position={[0, 12, 0]}
        intensity={1.5}
        distance={60}
        decay={2}
      />
      {/* Rim fill from below-behind for depth */}
      <pointLight
        color="#1a1a3e"
        position={[0, -5, -15]}
        intensity={0.4}
        distance={40}
        decay={2}
      />
      {/* Hemisphere for soft ambient gradient */}
      <hemisphereLight
        color="#1a1a4e"
        groundColor="#0a0a12"
        intensity={0.3}
      />

      {/* Minimal ground plane — always visible as spatial anchor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]}>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial
          color="#050510"
          emissive="#0a0a1e"
          emissiveIntensity={0.05}
          roughness={0.95}
          metalness={0.1}
        />
      </mesh>

      {/* Hex floor, dust, radar — only in Hive view */}
      {currentView === 'hive' && (
        <HiveEnvironment physicsEngine={physicsEngine} />
      )}

      {/* Pheromone particles — only in Hive view */}
      {currentView === 'hive' && (
        <PheromoneSystem physicsEngine={physicsEngine} />
      )}

      {/* Ribbon trails for EXECUTING agents */}
      <TrailRenderer physicsEngine={physicsEngine} />

      {/* Parent-child dashed links */}
      <SubAgentLinks
        agents={agents.map(a => ({ id: a.id, role: a.role, parentId: a.parentId }))}
        physicsEngine={physicsEngine}
        alpha={alphaRef.current}
      />

      {/* Bee instances — one per agent */}
      {agents.map((agent) => (
        <BeeInstance
          key={agent.id}
          agentId={agent.id}
          role={agent.role}
          state={agent.state}
          soul={agent.soul}
          selected={agent.id === selectedAgentId || agent.id === compareAgentId}
          physicsEngine={physicsEngine}
          alpha={alphaRef.current}
        />
      ))}

      {/* 10 domain views — only the active one renders its 3D elements */}
      <HiveView active={currentView === 'hive'} />
      <PipelineView active={currentView === 'pipeline'} />
      <CognitionView active={currentView === 'cognition'} />
      <EcologyView active={currentView === 'ecology'} />
      <NetworkView active={currentView === 'network'} />
      <ControlView active={currentView === 'control'} />
      <FieldView active={currentView === 'field'} />
      <SystemView active={currentView === 'system'} />
      <AdaptationView active={currentView === 'adaptation'} />
      <CommunicationView active={currentView === 'communication'} />

      {/* Bloom via native Three.js UnrealBloomPass — added in PostProcessing component */}
      <PostProcessing />
    </>
  );
}

// ── SwarmScene (root component) ─────────────────────────────────────────────

export function SwarmScene() {
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
      <Canvas
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          stencil: false,
          depth: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.2,
        }}
        camera={{
          fov: 50,
          near: 0.1,
          far: 200,
          position: [0, 15, 25],
        }}
        dpr={[1, 1.5]}
        style={{ background: '#080816' }}
      >
        <Suspense fallback={null}>
          <SceneContent />
        </Suspense>
      </Canvas>
    </div>
  );
}
