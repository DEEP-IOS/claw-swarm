/**
 * V8 Hard Constraints + V9 3D Extensions
 * Every value from V8 design docs (289KB/7254 lines). DO NOT modify.
 */

// Role Parameters

export const ROLE_PARAMS: Record<string, {
  scale: number;
  color: string;
  wingHz: number;
  icon: string;
}> = {
  researcher:  { scale: 0.9,  color: '#06B6D4', wingHz: 18, icon: 'R' },
  analyst:     { scale: 1.0,  color: '#6366F1', wingHz: 11, icon: 'A' },
  planner:     { scale: 1.1,  color: '#F59E0B', wingHz: 9,  icon: 'P' },
  implementer: { scale: 1.0,  color: '#10B981', wingHz: 14, icon: '{}' },
  debugger:    { scale: 1.05, color: '#EF4444', wingHz: 12, icon: '!' },
  tester:      { scale: 0.95, color: '#3B82F6', wingHz: 10, icon: 'T' },
  reviewer:    { scale: 1.05, color: '#F97316', wingHz: 9,  icon: 'V' },
  consultant:  { scale: 1.1,  color: '#8B5CF6', wingHz: 8,  icon: 'C' },
  coordinator: { scale: 1.15, color: '#EC4899', wingHz: 13, icon: '<>' },
  librarian:   { scale: 0.92, color: '#84CC16', wingHz: 10, icon: '[]' },
  architect:   { scale: 1.1,  color: '#F59E0B', wingHz: 9,  icon: 'P' },
  coder:       { scale: 1.0,  color: '#10B981', wingHz: 14, icon: '{}' },
  scout:       { scale: 0.9,  color: '#06B6D4', wingHz: 18, icon: 'R' },
  guard:       { scale: 1.05, color: '#EF4444', wingHz: 12, icon: '!' },
};

export const ROLE_LABELS: Record<string, string> = {
  researcher: 'Researcher',
  analyst: 'Analyst',
  planner: 'Planner',
  implementer: 'Implementer',
  debugger: 'Debugger',
  tester: 'Tester',
  reviewer: 'Reviewer',
  consultant: 'Consultant',
  coordinator: 'Coordinator',
  librarian: 'Librarian',
  architect: 'Planner',
  coder: 'Implementer',
  scout: 'Researcher',
  guard: 'Debugger',
};

export const CANONICAL_ROLES = [
  'researcher',
  'analyst',
  'planner',
  'implementer',
  'debugger',
  'tester',
  'reviewer',
  'consultant',
  'coordinator',
  'librarian',
] as const;

export const ROLE_LAYOUT_OFFSETS: Record<string, [number, number]> = {
  researcher: [-10, -7],
  analyst: [-3, -7],
  planner: [4, -7],
  implementer: [10, -2],
  debugger: [-10, 2],
  tester: [-3, 2],
  reviewer: [4, 2],
  consultant: [10, 2],
  coordinator: [-3, 9],
  librarian: [4, 9],
  architect: [4, -7],
  coder: [10, -2],
  scout: [-10, -7],
  guard: [-10, 2],
};

// State Parameters

export const STATE_PARAMS: Record<string, {
  saturation: number;
  speed: number;
  breatheHz: number;
  emissive: number;
}> = {
  EXECUTING:  { saturation: 1.0, speed: 0.25, breatheHz: 3, emissive: 1.5 },
  ACTIVE:     { saturation: 0.8, speed: 0.12, breatheHz: 1.5, emissive: 1.0 },
  REPORTING:  { saturation: 0.9, speed: 0.18, breatheHz: 2, emissive: 1.2 },
  IDLE:       { saturation: 0.4, speed: 0.03, breatheHz: 0.5, emissive: 0.4 },
};

// Pheromone Colors

export const PHEROMONE_COLORS: Record<string, string> = {
  trail:   '#F5A623',
  alarm:   '#EF4444',
  recruit: '#3B82F6',
  dance:   '#10B981',
  queen:   '#8B5CF6',
  food:    '#84CC16',
  danger:  '#EC4899',
};

// Boids Physics

export const BOIDS = {
  SEPARATION_DIST: 6.0,
  ALIGNMENT_DIST: 10.0,
  DRAG_COEFFICIENT: 0.02,
  MAX_FORCE: 0.05,
  TURN_RATE: 0.15,
  DAMPING: 0.95,
  PHYSICS_HZ: 30,
  RENDER_HZ: 60,
  BOUNDARY_MARGIN: 5.0,
  PERCEPTION_RADIUS: 8.0,
  SAME_ROLE_COHESION_BONUS: 0.3,
  SAME_STATE_ALIGNMENT_BONUS: 0.2,
  SAME_TASK_DEP_PROXIMITY: 3.0,
} as const;

// Spring Presets

export const SPRINGS = {
  interaction: { stiffness: 300, damping: 24, mass: 1 },
  navigation:  { stiffness: 200, damping: 20, mass: 1 },
  morphing:    { stiffness: 150, damping: 18, mass: 1.2 },
  gentle:      { stiffness: 100, damping: 15, mass: 1.5 },
  bounce:      { stiffness: 400, damping: 10, mass: 0.8 },
} as const;

// Disney Animation

export const DISNEY = {
  CLICK_SQUASH_DURATION: 300,
  ANTICIPATION_PRE: 120,
  ANTICIPATION_MAIN: 300,
  PANEL_OVERSHOOT: -0.03,
  ARC_PATH_OFFSET: 0.3,
  SECONDARY_DELAY: 150,
  SECONDARY_SCALE: 0.5,
} as const;

// View Transition

export const VIEW_TRANSITION = {
  TOTAL_DURATION: 800,
  UI_FADEOUT: { start: 0, end: 200 },
  AGENT_FLY: { start: 100, end: 700 },
  UI_FADEIN: { start: 400, end: 800 },
} as const;

// Atmosphere

export const ATMOSPHERE = {
  DUST_COUNT: 150,
  DUST_SIZE: [0.02, 0.04] as [number, number],
  DUST_SPEED: 0.001,
  GLITCH_OFFSET: [0.03, 0.08] as [number, number],
  GLITCH_DURATION: 100,
  RADAR_PERIOD: 2000,
  RADAR_OPACITY: 0.08,
} as const;

// Interaction

export const SEMANTIC_ZOOM = {
  OVERVIEW:  { min: 0, max: 0.7, zoom: 0.5 },
  STANDARD:  { min: 0.7, max: 1.5, zoom: 1.0 },
  CLOSEUP:   { min: 1.5, max: 2.5, zoom: 2.0 },
  INSPECT:   { min: 2.5, max: 3.5, zoom: 3.0 },
} as const;

export const MILLER = {
  AGENT_LIST_VISIBLE: 7,
  INSPECTOR_DEFAULT_OPEN: 2,
  TOOLTIP_MAX_SECONDARY: 3,
  NOTIFICATION_MAX_STACK: 5,
  TABS_TOTAL: 10,
  TIMELINE_EVENTS_VISIBLE: 10,
} as const;

// Performance Budget

export const PERF = {
  TARGET_FPS: 55,
  MAX_PARTICLES: 5000,
  MAX_DRAW_CALLS: 50,
  MAX_TRIANGLES: 100_000,
  BUNDLE_GZIP_KB: 500,
  GLTF_MAX_KB: 2048,
} as const;

// View Ambient Colors

export const VIEW_COLORS: Record<string, { ambient: string; point: string }> = {
  hive:          { ambient: '#F5A623', point: '#F5A623' },
  pipeline:      { ambient: '#3B82F6', point: '#3B82F6' },
  cognition:     { ambient: '#8B5CF6', point: '#8B5CF6' },
  ecology:       { ambient: '#10B981', point: '#10B981' },
  network:       { ambient: '#06B6D4', point: '#06B6D4' },
  control:       { ambient: '#EF4444', point: '#EF4444' },
  field:         { ambient: '#7B61FF', point: '#7B61FF' },
  system:        { ambient: '#F97316', point: '#F97316' },
  adaptation:    { ambient: '#84CC16', point: '#84CC16' },
  communication: { ambient: '#EC4899', point: '#EC4899' },
};
