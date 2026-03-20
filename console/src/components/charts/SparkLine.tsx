import { useMemo } from 'react';
import { LinePath } from '@visx/shape';
import { scaleLinear } from '@visx/scale';
import { curveMonotoneX } from '@visx/curve';
import { colors } from '../../theme/tokens';

interface SparkLineProps {
  data: number[];
  width: number;
  height: number;
  color?: string;
}

export function SparkLine({ data, width, height, color = colors.glow.primary }: SparkLineProps) {
  const xScale = useMemo(
    () => scaleLinear({ domain: [0, Math.max(1, data.length - 1)], range: [2, width - 2] }),
    [data.length, width],
  );
  const yScale = useMemo(() => {
    const max = Math.max(...data, 0.01);
    return scaleLinear({ domain: [0, max], range: [height - 2, 2] });
  }, [data, height]);

  if (data.length < 2) return null;

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <LinePath
        data={data}
        x={(_, i) => xScale(i)}
        y={(d) => yScale(d)}
        stroke={color}
        strokeWidth={1.5}
        strokeOpacity={0.8}
        curve={curveMonotoneX}
      />
    </svg>
  );
}
