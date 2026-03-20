import { useMemo } from 'react';
import { Group } from '@visx/group';
import { scaleLinear } from '@visx/scale';
import { Line, Polygon } from '@visx/shape';
import { Point } from '@visx/point';
import { Text } from '@visx/text';
import { motion } from 'framer-motion';
import { colors, DIMENSIONS, DIMENSION_LABELS } from '../../theme/tokens';
import type { FieldVector } from '../../stores/field-store';

interface RadarChartProps {
  vector: FieldVector;
  width: number;
  height: number;
}

const LEVELS = 4;

function angleSlice(i: number, total: number): number {
  return (Math.PI * 2 * i) / total - Math.PI / 2;
}

function polarToCartesian(angle: number, radius: number, center: { x: number; y: number }): Point {
  return new Point({
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle),
  });
}

export function RadarChart({ vector, width, height }: RadarChartProps) {
  const margin = 50;
  const radius = Math.min(width, height) / 2 - margin;
  const center = { x: width / 2, y: height / 2 };
  const dims = DIMENSIONS;

  const rScale = useMemo(
    () => scaleLinear({ domain: [0, 1], range: [0, radius] }),
    [radius],
  );

  // Grid circles
  const gridCircles = useMemo(() => {
    return Array.from({ length: LEVELS }, (_, i) => {
      const r = (radius * (i + 1)) / LEVELS;
      const points = dims.map((_, j) => {
        const angle = angleSlice(j, dims.length);
        return polarToCartesian(angle, r, center);
      });
      return points;
    });
  }, [radius, center, dims]);

  // Axis lines
  const axes = useMemo(() => {
    return dims.map((_, i) => {
      const angle = angleSlice(i, dims.length);
      return polarToCartesian(angle, radius, center);
    });
  }, [radius, center, dims]);

  // Data polygon
  const dataPoints = useMemo(() => {
    return dims.map((dim, i) => {
      const val = Math.min(1, Math.max(0, vector[dim] ?? 0));
      const angle = angleSlice(i, dims.length);
      return polarToCartesian(angle, rScale(val), center);
    });
  }, [vector, dims, rScale, center]);

  // Label positions
  const labelPositions = useMemo(() => {
    return dims.map((dim, i) => {
      const angle = angleSlice(i, dims.length);
      const pos = polarToCartesian(angle, radius + 28, center);
      return { dim, ...pos };
    });
  }, [dims, radius, center]);

  return (
    <svg width={width} height={height}>
      <rect width={width} height={height} fill="transparent" rx={10} />

      <Group>
        {/* Grid polygons */}
        {gridCircles.map((points, i) => (
          <Polygon
            key={`grid-${i}`}
            points={points.map(p => [p.x, p.y] as [number, number])}
            fill="none"
            stroke={colors.bg.border}
            strokeWidth={0.5}
            strokeOpacity={0.6}
          />
        ))}

        {/* Axis lines */}
        {axes.map((end, i) => (
          <Line
            key={`axis-${i}`}
            from={center}
            to={end}
            stroke={colors.bg.border}
            strokeWidth={0.5}
            strokeOpacity={0.4}
          />
        ))}

        {/* Data polygon - filled area */}
        <motion.g
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          <Polygon
            points={dataPoints.map(p => [p.x, p.y] as [number, number])}
            fill={colors.glow.primary}
            fillOpacity={0.12}
            stroke={colors.glow.primary}
            strokeWidth={2}
            strokeOpacity={0.8}
          />
        </motion.g>

        {/* Data points */}
        {dataPoints.map((point, i) => {
          const val = vector[dims[i]] ?? 0;
          const dimColor = colors.dimension[dims[i]] || colors.glow.primary;
          return (
            <circle
              key={`point-${i}`}
              cx={point.x}
              cy={point.y}
              r={val > 0.01 ? 4 : 2}
              fill={dimColor}
              stroke={dimColor}
              strokeWidth={1}
              style={{
                filter: val > 0.3 ? `drop-shadow(0 0 4px ${dimColor})` : 'none',
                transition: 'all 300ms ease',
              }}
            />
          );
        })}

        {/* Dimension labels */}
        {labelPositions.map((pos, i) => (
          <Text
            key={`label-${i}`}
            x={pos.x}
            y={pos.y}
            textAnchor="middle"
            verticalAnchor="middle"
            fontSize={10}
            fill={colors.dimension[pos.dim] || colors.text.secondary}
            fontFamily="Inter, sans-serif"
          >
            {DIMENSION_LABELS[pos.dim] || pos.dim}
          </Text>
        ))}
      </Group>
    </svg>
  );
}
