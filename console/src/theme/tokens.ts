/** Design tokens — Bioluminescent deep-sea aesthetic */

export const colors = {
  bg: {
    deep:    '#0A0A1A',
    surface: '#0F0F23',
    card:    '#161630',
    hover:   '#1C1C42',
    border:  '#2A2A5A',
    glass:   'rgba(15, 15, 35, 0.85)',
  },
  glow: {
    primary:   '#00FFAA',
    secondary: '#7B61FF',
    warning:   '#FFB800',
    danger:    '#FF4B6E',
    info:      '#4ECBFF',
    success:   '#00FF88',
  },
  /** 12 signal dimensions — each with a unique hue */
  dimension: {
    trail:        '#4ECBFF',
    alarm:        '#FF4B6E',
    reputation:   '#F5A623',
    task:         '#00FFAA',
    knowledge:    '#7B61FF',
    coordination: '#06B6D4',
    emotion:      '#FF61A6',
    trust:        '#61FFB4',
    sna:          '#84CC16',
    learning:     '#10B981',
    calibration:  '#FFD93D',
    species:      '#FF8B4E',
  } as Record<string, string>,
  text: {
    primary:   '#E8E8FF',
    secondary: '#8888AA',
    muted:     '#555577',
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  round: '50%',
} as const;

export const transitions = {
  fast:   '150ms ease',
  normal: '300ms ease',
  slow:   '500ms ease',
  spring: { type: 'spring' as const, stiffness: 300, damping: 30 },
} as const;

export const DIMENSIONS = [
  'trail',
  'alarm',
  'reputation',
  'task',
  'knowledge',
  'coordination',
  'emotion',
  'trust',
  'sna',
  'learning',
  'calibration',
  'species',
] as const;

export type DimensionId = (typeof DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<DimensionId, string> = {
  trail: 'Trail',
  alarm: 'Alarm',
  reputation: 'Reputation',
  task: 'Task',
  knowledge: 'Knowledge',
  coordination: 'Coordination',
  emotion: 'Emotion',
  trust: 'Trust',
  sna: 'SNA',
  learning: 'Learning',
  calibration: 'Calibration',
  species: 'Species',
};

export const DIMENSION_META: ReadonlyArray<{
  id: DimensionId;
  label: string;
  color: string;
}> = DIMENSIONS.map((id) => ({
  id,
  label: DIMENSION_LABELS[id],
  color: colors.dimension[id],
}));
