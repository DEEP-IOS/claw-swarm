import { Arc } from '@visx/shape';
import { Group } from '@visx/group';
import { colors } from '../../theme/tokens';

interface GaugeRingProps {
  value: number;  // 0-1
  label: string;
  width: number;
  height: number;
  color?: string;
}

export function GaugeRing({ value, label, width, height, color = colors.glow.primary }: GaugeRingProps) {
  const size = Math.min(width, height);
  const outerRadius = size / 2 - 8;
  const innerRadius = outerRadius - 10;
  const center = { x: width / 2, y: height / 2 };
  const clampedValue = Math.min(1, Math.max(0, value));
  const endAngle = -Math.PI + clampedValue * 2 * Math.PI;

  return (
    <svg width={width} height={height}>
      <Group top={center.y} left={center.x}>
        {/* Background ring */}
        <Arc
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          startAngle={-Math.PI}
          endAngle={Math.PI}
          fill={colors.bg.border}
          fillOpacity={0.4}
        />
        {/* Value arc */}
        <Arc
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          startAngle={-Math.PI}
          endAngle={endAngle}
          fill={color}
          fillOpacity={0.8}
          style={{ filter: `drop-shadow(0 0 4px ${color})`, transition: 'all 500ms ease' }}
        />
        {/* Center text */}
        <text
          textAnchor="middle"
          dy="-0.1em"
          fontSize={size > 100 ? 24 : 16}
          fontWeight={700}
          fill={color}
          fontFamily="Inter, sans-serif"
        >
          {(clampedValue * 100).toFixed(0)}%
        </text>
        <text
          textAnchor="middle"
          dy="1.4em"
          fontSize={10}
          fill={colors.text.muted}
          fontFamily="Inter, sans-serif"
        >
          {label}
        </text>
      </Group>
    </svg>
  );
}
