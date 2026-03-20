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
    task_load:         '#4ECBFF',
    error_rate:        '#FF4B6E',
    latency:           '#FFB800',
    throughput:        '#00FFAA',
    cost:              '#FF8B4E',
    quality:           '#00FF88',
    coherence:         '#7B61FF',
    trust:             '#61FFB4',
    novelty:           '#FF61E6',
    urgency:           '#FFD93D',
    complexity:        '#B4FF61',
    resource_pressure: '#FF61A6',
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
  'task_load', 'error_rate', 'latency', 'throughput',
  'cost', 'quality', 'coherence', 'trust',
  'novelty', 'urgency', 'complexity', 'resource_pressure',
] as const;

export const DIMENSION_LABELS: Record<string, string> = {
  task_load: 'Task Load',
  error_rate: 'Error Rate',
  latency: 'Latency',
  throughput: 'Throughput',
  cost: 'Cost',
  quality: 'Quality',
  coherence: 'Coherence',
  trust: 'Trust',
  novelty: 'Novelty',
  urgency: 'Urgency',
  complexity: 'Complexity',
  resource_pressure: 'Resource',
};
