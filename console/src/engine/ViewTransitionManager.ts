/**
 * ViewTransitionManager — Camera fly + Agent morph + Color lerp
 *
 * Manages smooth 800ms transitions between 10 views:
 *   T=0-200:   Old UI fadeout
 *   T=0-800:   Environment color lerp
 *   T=100-700: Agent arc flight + morph (via PhysicsEngine target)
 *   T=400-800: New UI fadein
 *
 * Updates camera position/target, ambient/point light colors,
 * and sets the PhysicsEngine's viewTargetProvider per view.
 */

import * as THREE from 'three';
import { ROLE_LAYOUT_OFFSETS, VIEW_COLORS, VIEW_TRANSITION, SPRINGS } from './constants';
import type { PhysicsEngine, ViewTargetProvider } from './PhysicsEngine';
import type { AgentSnapshot, WorldSnapshot } from '../api/ws-bridge';
import type { ViewId } from '../stores/view-store';

// ── Easing ──────────────────────────────────────────────────────────────────

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// ── Hash helper ─────────────────────────────────────────────────────────────

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// ── View config ─────────────────────────────────────────────────────────────

export type AgentMorph = 'bee' | 'rect' | 'hex' | 'diamond' | 'scaled' | 'square';

export interface ViewConfig {
  id: ViewId;
  cameraPosition: THREE.Vector3;
  cameraTarget: THREE.Vector3;
  ambientColor: string;
  pointLightColor: string;
  agentMorph: AgentMorph;
  getAgentTarget: ViewTargetProvider;
}

// ── Layout helpers ──────────────────────────────────────────────────────────

/** Hive: ring layout by state */
function hiveLayout(agent: AgentSnapshot | undefined, _w: WorldSnapshot, cur: [number, number, number]): [number, number, number] {
  if (!agent) return [0, 0.5, 0];
  const state = agent.state?.toUpperCase() ?? 'IDLE';
  const h = hashCode(agent.id);
  const angle = (h % 360) * Math.PI / 180;

  if (state === 'IDLE') {
    const r = 1.5 + (h % 100) / 100;
    return [Math.cos(angle) * r, 0.5, Math.sin(angle) * r];
  }
  if (state === 'EXECUTING') {
    const r = 6 + (h % 100) / 50;
    return [Math.cos(angle) * r, 2 + (h % 30) / 10, Math.sin(angle) * r];
  }
  if (state === 'REPORTING') return cur;
  const r = 3 + (h % 100) / 50;
  return [Math.cos(angle) * r, 1.5, Math.sin(angle) * r];
}

/** Pipeline: swim lane layout */
function pipelineLane(agent: AgentSnapshot | undefined, world: WorldSnapshot): [number, number, number] {
  if (!agent) return [0, 2, 0];
  const task = world.tasks?.find(t => t.assigneeId === agent.id);
  const statuses = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'];
  const laneIndex = task ? statuses.indexOf(String(task.status).toUpperCase()) : 0;
  const lane = Math.max(0, laneIndex) * 8;
  const h = hashCode(agent.id);
  const row = (h % 5) * 3 - 6;
  return [lane, 2 + (h % 10) / 5, row];
}

/** Cognition: layered by memory type */
function cognitionLayout(agent: AgentSnapshot | undefined): [number, number, number] {
  if (!agent) return [0, 3, 0];
  const h = hashCode(agent.id);
  const angle = (h % 360) * Math.PI / 180;
  const r = 4 + (h % 100) / 40;
  const y = 2 + (agent.emotion?.curiosity ?? 0) * 4;
  return [Math.cos(angle) * r, y, Math.sin(angle) * r];
}

/** Ecology: clustered by role */
function ecologyLayout(agent: AgentSnapshot | undefined): [number, number, number] {
  if (!agent) return [0, 1, 0];
  const off = ROLE_LAYOUT_OFFSETS[agent.role] ?? [0, 0];
  const h = hashCode(agent.id);
  return [off[0] + (h % 40) / 10 - 2, 1 + (h % 20) / 10, off[1] + (h % 40) / 10 - 2];
}

/** Network: positions set by force graph, fallback to sphere */
function networkLayout(agent: AgentSnapshot | undefined): [number, number, number] {
  if (!agent) return [0, 3, 0];
  const h = hashCode(agent.id);
  const phi = (h % 180) * Math.PI / 180;
  const theta = ((h * 7) % 360) * Math.PI / 180;
  const r = 6 + (agent.reputation ?? 0.5) * 4;
  return [r * Math.sin(phi) * Math.cos(theta), 3 + r * Math.cos(phi) * 0.3, r * Math.sin(phi) * Math.sin(theta)];
}

/** Control: grid layout */
function controlLayout(agent: AgentSnapshot | undefined): [number, number, number] {
  if (!agent) return [0, 2, 0];
  const h = hashCode(agent.id);
  const col = (h % 6) * 3 - 7.5;
  const row = ((h * 3) % 4) * 3 - 4.5;
  return [col, 2, row];
}

/** Field: sphere distribution around signal field */
function fieldLayout(agent: AgentSnapshot | undefined): [number, number, number] {
  if (!agent) return [0, 3, 0];
  const h = hashCode(agent.id);
  const phi = (h % 180) * Math.PI / 180;
  const theta = ((h * 13) % 360) * Math.PI / 180;
  const r = 8;
  return [r * Math.sin(phi) * Math.cos(theta), 3 + r * Math.cos(phi) * 0.5, r * Math.sin(phi) * Math.sin(theta)];
}

/** System: ring around health sphere */
function systemLayout(agent: AgentSnapshot | undefined): [number, number, number] {
  if (!agent) return [0, 3, 0];
  const h = hashCode(agent.id);
  const angle = (h % 360) * Math.PI / 180;
  const r = 7;
  return [Math.cos(angle) * r, 2 + (h % 20) / 10, Math.sin(angle) * r];
}

/** Adaptation: left-right by mode preference */
function adaptationLayout(agent: AgentSnapshot | undefined): [number, number, number] {
  if (!agent) return [0, 2, 0];
  const h = hashCode(agent.id);
  const x = (agent.reputation ?? 0.5) > 0.5 ? 5 : -5;
  return [x + (h % 60) / 15 - 2, 2 + (h % 20) / 10, (h % 80) / 10 - 4];
}

/** Communication: clustered by communication frequency */
function communicationLayout(agent: AgentSnapshot | undefined): [number, number, number] {
  if (!agent) return [0, 3, 0];
  const h = hashCode(agent.id);
  const angle = (h % 360) * Math.PI / 180;
  const r = 5 + (h % 60) / 15;
  return [Math.cos(angle) * r, 2 + (h % 30) / 10, Math.sin(angle) * r];
}

// ── Configs ─────────────────────────────────────────────────────────────────

export const VIEW_CONFIGS: Record<ViewId, ViewConfig> = {
  hive: {
    id: 'hive',
    cameraPosition: new THREE.Vector3(0, 15, 25),
    cameraTarget: new THREE.Vector3(0, 0, 0),
    ambientColor: VIEW_COLORS.hive.ambient,
    pointLightColor: VIEW_COLORS.hive.point,
    agentMorph: 'bee',
    getAgentTarget: (a, w, c) => hiveLayout(a, w, c),
  },
  pipeline: {
    id: 'pipeline',
    cameraPosition: new THREE.Vector3(15, 12, 20),
    cameraTarget: new THREE.Vector3(12, 0, 0),
    ambientColor: VIEW_COLORS.pipeline.ambient,
    pointLightColor: VIEW_COLORS.pipeline.point,
    agentMorph: 'rect',
    getAgentTarget: (a, w) => pipelineLane(a, w),
  },
  cognition: {
    id: 'cognition',
    cameraPosition: new THREE.Vector3(0, 10, 18),
    cameraTarget: new THREE.Vector3(0, 3, 0),
    ambientColor: VIEW_COLORS.cognition.ambient,
    pointLightColor: VIEW_COLORS.cognition.point,
    agentMorph: 'hex',
    getAgentTarget: (a) => cognitionLayout(a),
  },
  ecology: {
    id: 'ecology',
    cameraPosition: new THREE.Vector3(0, 20, 22),
    cameraTarget: new THREE.Vector3(0, 0, 0),
    ambientColor: VIEW_COLORS.ecology.ambient,
    pointLightColor: VIEW_COLORS.ecology.point,
    agentMorph: 'diamond',
    getAgentTarget: (a) => ecologyLayout(a),
  },
  network: {
    id: 'network',
    cameraPosition: new THREE.Vector3(0, 8, 20),
    cameraTarget: new THREE.Vector3(0, 3, 0),
    ambientColor: VIEW_COLORS.network.ambient,
    pointLightColor: VIEW_COLORS.network.point,
    agentMorph: 'scaled',
    getAgentTarget: (a) => networkLayout(a),
  },
  control: {
    id: 'control',
    cameraPosition: new THREE.Vector3(0, 14, 18),
    cameraTarget: new THREE.Vector3(0, 2, 0),
    ambientColor: VIEW_COLORS.control.ambient,
    pointLightColor: VIEW_COLORS.control.point,
    agentMorph: 'square',
    getAgentTarget: (a) => controlLayout(a),
  },
  field: {
    id: 'field',
    cameraPosition: new THREE.Vector3(0, 5, 18),
    cameraTarget: new THREE.Vector3(0, 3, 0),
    ambientColor: VIEW_COLORS.field.ambient,
    pointLightColor: VIEW_COLORS.field.point,
    agentMorph: 'bee',
    getAgentTarget: (a) => fieldLayout(a),
  },
  system: {
    id: 'system',
    cameraPosition: new THREE.Vector3(0, 10, 20),
    cameraTarget: new THREE.Vector3(0, 2, 0),
    ambientColor: VIEW_COLORS.system.ambient,
    pointLightColor: VIEW_COLORS.system.point,
    agentMorph: 'bee',
    getAgentTarget: (a) => systemLayout(a),
  },
  adaptation: {
    id: 'adaptation',
    cameraPosition: new THREE.Vector3(0, 12, 22),
    cameraTarget: new THREE.Vector3(0, 2, 0),
    ambientColor: VIEW_COLORS.adaptation.ambient,
    pointLightColor: VIEW_COLORS.adaptation.point,
    agentMorph: 'bee',
    getAgentTarget: (a) => adaptationLayout(a),
  },
  communication: {
    id: 'communication',
    cameraPosition: new THREE.Vector3(0, 10, 20),
    cameraTarget: new THREE.Vector3(0, 2, 0),
    ambientColor: VIEW_COLORS.communication.ambient,
    pointLightColor: VIEW_COLORS.communication.point,
    agentMorph: 'bee',
    getAgentTarget: (a) => communicationLayout(a),
  },
};

// ── TransitionManager ───────────────────────────────────────────────────────

export class ViewTransitionManager {
  private _transitioning = false;
  private _startTime = 0;
  private _fromView: ViewId = 'hive';
  private _toView: ViewId = 'hive';
  private _fromCamPos = new THREE.Vector3();
  private _toCamPos = new THREE.Vector3();
  private _fromCamTarget = new THREE.Vector3();
  private _toCamTarget = new THREE.Vector3();
  private _fromAmbient = new THREE.Color();
  private _toAmbient = new THREE.Color();
  private _fromPoint = new THREE.Color();
  private _toPoint = new THREE.Color();
  private _currentMorph: AgentMorph = 'bee';
  private _uiFadeProgress = 1; // 0=faded out, 1=fully visible
  private _physicsEngine: PhysicsEngine;

  constructor(physicsEngine: PhysicsEngine) {
    this._physicsEngine = physicsEngine;
    const cfg = VIEW_CONFIGS.hive;
    this._fromAmbient.set(cfg.ambientColor);
    this._toAmbient.set(cfg.ambientColor);
    this._fromPoint.set(cfg.pointLightColor);
    this._toPoint.set(cfg.pointLightColor);
    this._physicsEngine.setViewTargetProvider(cfg.getAgentTarget);
  }

  get transitioning(): boolean { return this._transitioning; }
  get currentMorph(): AgentMorph { return this._currentMorph; }
  get uiFadeProgress(): number { return this._uiFadeProgress; }

  transition(fromView: ViewId, toView: ViewId) {
    if (this._transitioning) return;
    const from = VIEW_CONFIGS[fromView];
    const to = VIEW_CONFIGS[toView];
    if (!from || !to) return;

    this._transitioning = true;
    this._startTime = performance.now();
    this._fromView = fromView;
    this._toView = toView;

    this._fromCamPos.copy(from.cameraPosition);
    this._toCamPos.copy(to.cameraPosition);
    this._fromCamTarget.copy(from.cameraTarget);
    this._toCamTarget.copy(to.cameraTarget);
    this._fromAmbient.set(from.ambientColor);
    this._toAmbient.set(to.ambientColor);
    this._fromPoint.set(from.pointLightColor);
    this._toPoint.set(to.pointLightColor);

    // Update physics targets immediately (spring physics handles smooth flight)
    this._physicsEngine.setViewTargetProvider(to.getAgentTarget);
  }

  /**
   * Called every render frame. Updates camera, lights, morph, UI fade.
   */
  tick(
    camera: THREE.Camera,
    ambientLight: THREE.Light | null,
    pointLight: THREE.PointLight | null,
  ) {
    if (!this._transitioning) return;

    const elapsed = performance.now() - this._startTime;
    const duration = VIEW_TRANSITION.TOTAL_DURATION;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeInOutCubic(progress);

    // Camera position lerp
    camera.position.lerpVectors(this._fromCamPos, this._toCamPos, eased);

    // Camera lookAt lerp
    const target = new THREE.Vector3().lerpVectors(this._fromCamTarget, this._toCamTarget, eased);
    camera.lookAt(target);

    // Ambient light color lerp
    if (ambientLight && 'color' in ambientLight) {
      (ambientLight as THREE.AmbientLight).color.copy(this._fromAmbient).lerp(this._toAmbient, eased);
    }

    // Point light color lerp
    if (pointLight) {
      pointLight.color.copy(this._fromPoint).lerp(this._toPoint, eased);
    }

    // Agent morph: switch at midpoint
    if (progress > 0.5) {
      this._currentMorph = VIEW_CONFIGS[this._toView].agentMorph;
    }

    // UI fade: fadeout 0-200ms, fadein 400-800ms
    if (elapsed < VIEW_TRANSITION.UI_FADEOUT.end) {
      this._uiFadeProgress = 1 - elapsed / VIEW_TRANSITION.UI_FADEOUT.end;
    } else if (elapsed < VIEW_TRANSITION.UI_FADEIN.start) {
      this._uiFadeProgress = 0;
    } else {
      this._uiFadeProgress = (elapsed - VIEW_TRANSITION.UI_FADEIN.start) /
        (VIEW_TRANSITION.UI_FADEIN.end - VIEW_TRANSITION.UI_FADEIN.start);
    }
    this._uiFadeProgress = Math.max(0, Math.min(1, this._uiFadeProgress));

    // Done
    if (progress >= 1) {
      this._transitioning = false;
      this._uiFadeProgress = 1;
      this._currentMorph = VIEW_CONFIGS[this._toView].agentMorph;
    }
  }

  /** Get current view config (for fog/environment setup) */
  getConfig(viewId: ViewId): ViewConfig {
    return VIEW_CONFIGS[viewId];
  }
}
