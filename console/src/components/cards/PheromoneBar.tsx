import type { CSSProperties } from 'react';
import { getPheromoneTypeInfo, usePheromoneStore } from '../../stores/pheromone-store';

const TYPE_INFO = getPheromoneTypeInfo();

export function PheromoneBar() {
  const levels = usePheromoneStore((s) => s.levels);

  return (
    <div className="console-pheromone-list">
      <div className="console-sidebar__heading" style={{ marginBottom: 2 }}>
        <strong>Pheromone Field</strong>
        <span>{TYPE_INFO.length} live types</span>
      </div>

      {TYPE_INFO.map(({ type, label, color }) => {
        const level = levels[type];
        const intensity = level?.maxIntensity ?? 0;
        const pct = Math.round(intensity * 100);
        const style = {
          ['--pheromone-accent' as string]: color,
        } as CSSProperties;

        return (
          <div
            key={type}
            className={`console-pheromone-row${intensity > 0.08 ? ' is-active' : ''}`}
            style={style}
          >
            <div
              className="console-pheromone-dot"
              style={{ opacity: Math.max(0.28, Math.min(1, intensity + 0.18)) }}
            />
            <span>{label}</span>
            <div className="console-pheromone-track">
              <div className="console-pheromone-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="console-data-row__value">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}
