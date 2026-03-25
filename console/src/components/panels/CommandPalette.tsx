import { useEffect, useMemo, useRef, useState } from 'react';
import { wsBridge } from '../../api/ws-bridge';
import { getPheromoneTypeInfo } from '../../stores/pheromone-store';
import { useInteractionStore } from '../../stores/interaction-store';
import { useViewStore } from '../../stores/view-store';
import { useWorldStore } from '../../stores/world-store';
import type { ViewId } from '../../stores/view-store';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  title: string;
  subtitle: string;
  shortcut?: string;
  keywords: string[];
  run: () => Promise<void> | void;
}

const VIEW_COMMANDS: Array<{ id: ViewId; label: string; shortcut: string }> = [
  { id: 'hive', label: 'Hive', shortcut: '1' },
  { id: 'pipeline', label: 'Pipeline', shortcut: '2' },
  { id: 'cognition', label: 'Cognition', shortcut: '3' },
  { id: 'ecology', label: 'Ecology', shortcut: '4' },
  { id: 'network', label: 'Network', shortcut: '5' },
  { id: 'control', label: 'Control', shortcut: '6' },
  { id: 'field', label: 'Field', shortcut: '7' },
  { id: 'system', label: 'System', shortcut: '8' },
  { id: 'adaptation', label: 'Adaptation', shortcut: '9' },
  { id: 'communication', label: 'Communication', shortcut: '0' },
];

function normalizeQuery(value: string) {
  return value.trim().toLowerCase();
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const snapshot = useWorldStore((state) => state.snapshot);
  const setView = useViewStore((state) => state.setView);
  const selectAgent = useInteractionStore((state) => state.selectAgent);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState('Enter to run. Esc closes the palette.');

  useEffect(() => {
    if (!open) {
      return;
    }

    setQuery('');
    setActiveIndex(0);
    setStatusMessage('Enter to run. Esc closes the palette.');

    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    for (const view of VIEW_COMMANDS) {
      items.push({
        id: `view-${view.id}`,
        title: `Switch to ${view.label}`,
        subtitle: `Open the ${view.label.toLowerCase()} scene view.`,
        shortcut: view.shortcut,
        keywords: ['view', 'scene', view.id, view.label.toLowerCase()],
        run: () => {
          setView(view.id);
        },
      });
    }

    for (const agent of snapshot?.agents ?? []) {
      const role = agent.role ?? 'generalist';
      items.push({
        id: `agent-${agent.id}`,
        title: `Inspect ${role}`,
        subtitle: `Open the detail panel for ${agent.id.slice(0, 12)}.`,
        keywords: ['agent', 'inspect', role.toLowerCase(), agent.id.toLowerCase()],
        run: () => {
          selectAgent(agent.id);
        },
      });
    }

    for (const pheromone of getPheromoneTypeInfo()) {
      items.push({
        id: `pheromone-${pheromone.type}`,
        title: `Deposit ${pheromone.label}`,
        subtitle: `Emit a ${pheromone.type} pheromone into the live communication field.`,
        keywords: ['pheromone', 'deposit', 'signal', pheromone.type, pheromone.label.toLowerCase()],
        run: async () => {
          await wsBridge.rpc('pheromone.deposit', {
            type: pheromone.type,
            scope: 'global',
            intensity: 0.6,
            metadata: { source: 'console-command' },
          });
          setStatusMessage(`Deposited ${pheromone.type} pheromone.`);
        },
      });
    }

    items.push({
      id: 'focus-health',
      title: 'Open System Health',
      subtitle: 'Jump to the health-focused system scene.',
      keywords: ['health', 'system', 'metrics', 'monitor'],
      run: () => {
        setView('system');
      },
    });

    items.push({
      id: 'focus-budget',
      title: 'Open Budget Control',
      subtitle: 'Jump to the control scene and inspect budget pressure.',
      keywords: ['budget', 'control', 'cost', 'breaker'],
      run: () => {
        setView('control');
      },
    });

    items.push({
      id: 'refresh-metrics',
      title: 'Refresh Metrics Snapshot',
      subtitle: 'Query the live metrics bridge and keep the transport hot.',
      keywords: ['metrics', 'snapshot', 'refresh', 'observe'],
      run: async () => {
        await wsBridge.rpc('metrics.snapshot');
        setStatusMessage('Metrics snapshot requested from bridge.');
      },
    });

    items.push({
      id: 'check-health',
      title: 'Run Health Check',
      subtitle: 'Query the live health endpoint through the console data bridge.',
      keywords: ['health', 'check', 'bridge', 'status'],
      run: async () => {
        await wsBridge.rpc('health.check');
        setStatusMessage('Health check requested from bridge.');
      },
    });

    items.push({
      id: 'budget-status',
      title: 'Query Budget Status',
      subtitle: 'Pull the current swarm budget envelope and active DAG spend.',
      keywords: ['budget', 'status', 'cost', 'dag'],
      run: async () => {
        await wsBridge.rpc('budget.status');
        setStatusMessage('Budget status requested from bridge.');
      },
    });

    return items;
  }, [selectAgent, setView, snapshot?.agents]);

  const filteredCommands = useMemo(() => {
    const normalized = normalizeQuery(query);
    if (!normalized) {
      return commands.slice(0, 12);
    }

    return commands
      .filter((item) => {
        const haystack = [item.title, item.subtitle, ...item.keywords].join(' ').toLowerCase();
        return haystack.includes(normalized);
      })
      .slice(0, 12);
  }, [commands, query]);

  useEffect(() => {
    if (activeIndex >= filteredCommands.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, filteredCommands.length]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = async (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((previous) => (previous + 1) % Math.max(filteredCommands.length, 1));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((previous) => {
          const count = Math.max(filteredCommands.length, 1);
          return (previous - 1 + count) % count;
        });
        return;
      }

      if (event.key === 'Enter') {
        const active = filteredCommands[activeIndex];
        if (!active) {
          return;
        }

        event.preventDefault();
        try {
          await active.run();
          onClose();
        } catch (error) {
          setStatusMessage(error instanceof Error ? error.message : 'Command failed.');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, filteredCommands, onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="console-command" role="dialog" aria-modal="true" aria-label="Command palette">
      <button
        type="button"
        className="console-command__backdrop"
        aria-label="Close command palette"
        onClick={onClose}
      />

      <div className="console-command__panel">
        <div className="console-command__header">
          <div className="console-command__eyebrow">Command Palette</div>
          <input
            ref={inputRef}
            className="console-command__input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder="Jump to a view, inspect an agent, or trigger a live action"
          />
        </div>

        <div className="console-command__results">
          {filteredCommands.length === 0 ? (
            <div className="console-inspector__empty">
              No matching command. Try a view name, a role, or "pheromone".
            </div>
          ) : (
            filteredCommands.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`console-command__item${index === activeIndex ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={async () => {
                  try {
                    await item.run();
                    onClose();
                  } catch (error) {
                    setStatusMessage(error instanceof Error ? error.message : 'Command failed.');
                  }
                }}
              >
                <div className="console-command__item-main">
                  <div className="console-command__item-title">{item.title}</div>
                  <div className="console-command__item-subtitle">{item.subtitle}</div>
                </div>

                {item.shortcut ? (
                  <span className="console-command__item-shortcut">{item.shortcut}</span>
                ) : null}
              </button>
            ))
          )}
        </div>

        <div className="console-command__footer">
          <div className="console-command__hint">
            <span className="console-kbd">Up</span>
            <span className="console-kbd">Down</span>
            browse
            <span className="console-kbd">Enter</span>
            run
            <span className="console-kbd">Esc</span>
            close
          </div>
          <span>{statusMessage}</span>
        </div>
      </div>
    </div>
  );
}
