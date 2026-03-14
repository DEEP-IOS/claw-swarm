/**
 * Command Palette
 */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import useStore from '../../store.js';
import { ROLE_COLORS, ROLE_ICONS, shortId } from '../../bridge/colors.js';

const GROUPS = [
  { key: 'views', label: 'Views', zh: '视图' },
  { key: 'agents', label: 'Agents', zh: '代理' },
  { key: 'tasks', label: 'Tasks', zh: '任务' },
  { key: 'pheromones', label: 'Pheromones', zh: '信息素' },
  { key: 'formulas', label: 'Formulas', zh: '公式' },
  { key: 'actions', label: 'Actions', zh: '操作' },
];

const VIEWS = [
  { id: 'hive', name: 'Hive View', zh: '蜂巢视图' },
  { id: 'pipeline', name: 'Pipeline View', zh: '流水线视图' },
  { id: 'cognition', name: 'Cognition View', zh: '认知视图' },
  { id: 'ecology', name: 'Ecology View', zh: '生态视图' },
  { id: 'network', name: 'Network View', zh: '网络视图' },
  { id: 'control', name: 'Control View', zh: '控制视图' },
];

const PHEROMONE_ITEMS = [
  { id: 'trail', name: 'Trail Pheromone', zh: '路径信息素' },
  { id: 'alarm', name: 'Alarm Pheromone', zh: '警报信息素' },
  { id: 'recruit', name: 'Recruit Pheromone', zh: '招募信息素' },
  { id: 'dance', name: 'Dance Pheromone', zh: '舞蹈信息素' },
  { id: 'queen', name: 'Queen Pheromone', zh: '蜂王信息素' },
  { id: 'food', name: 'Food Pheromone', zh: '食物信息素' },
  { id: 'danger', name: 'Danger Pheromone', zh: '危险信息素' },
];

const FORMULA_ITEMS = [
  { id: 'aco', name: 'ACO Selection', zh: 'ACO 选择' },
  { id: 'shapley', name: 'Shapley Value', zh: 'Shapley 值' },
  { id: 'lotka', name: 'Lotka-Volterra', zh: '捕食者动力学' },
  { id: 'attention', name: 'Attention', zh: '注意力机制' },
  { id: 'pi', name: 'PI Controller', zh: 'PI 控制器' },
  { id: 'boids', name: 'Boids Flocking', zh: 'Boids 群集' },
  { id: 'decay', name: 'Pheromone Decay', zh: '信息素衰减' },
  { id: 'reputation', name: 'Reputation Update', zh: '声誉更新' },
  { id: 'retrieval', name: 'Memory Retrieval', zh: '记忆检索' },
];

const ACTION_ITEMS = [
  { id: 'toggle-settings', name: 'Open Settings', zh: '打开设置' },
  { id: 'toggle-timeline', name: 'Toggle Timeline', zh: '切换时间线' },
  { id: 'toggle-formulas', name: 'Show Formulas', zh: '显示公式' },
  { id: 'open-export', name: 'Open Export', zh: '打开导出' },
  { id: 'enter-replay', name: 'Enter Replay', zh: '进入回放' },
  { id: 'demo-showcase', name: 'Start Showcase', zh: '启动演示轮播' },
  { id: 'demo-alarm', name: 'Trigger Alarm', zh: '触发告警场景' },
  { id: 'demo-spawning', name: 'Trigger Spawning', zh: '触发孵化场景' },
  { id: 'demo-contract', name: 'Trigger Contract', zh: '触发竞标场景' },
  { id: 'demo-evolution', name: 'Trigger Evolution', zh: '触发进化场景' },
  { id: 'demo-stop', name: 'Stop Mock Stream', zh: '停止模拟流' },
];

function fuzzyMatch(query, text) {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi += 1;
  }
  return qi === q.length;
}

export default function CommandPalette() {
  const open = useStore((s) => s.commandPaletteOpen);
  const toggleCommandPalette = useStore((s) => s.toggleCommandPalette);
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const setView = useStore((s) => s.setView);
  const selectAgent = useStore((s) => s.selectAgent);
  const selectTask = useStore((s) => s.selectTask);
  const setFormulaPanelOpen = useStore((s) => s.setFormulaPanelOpen);
  const toggleSettings = useStore((s) => s.toggleSettings);
  const toggleTimeline = useStore((s) => s.toggleTimeline);
  const setExportDialogOpen = useStore((s) => s.setExportDialogOpen);
  const enterReplay = useStore((s) => s.enterReplay);

  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const results = useMemo(() => {
    const items = [];

    VIEWS.forEach((v) => {
      if (fuzzyMatch(query, `${v.name} ${v.zh}`)) {
        items.push({ group: 'views', id: v.id, name: v.name, zh: v.zh, icon: 'VIEW' });
      }
    });

    agents.forEach((a) => {
      const id = a.id || '';
      const name = shortId(id);
      const role = a.role || 'default';
      if (fuzzyMatch(query, `${name} ${role} ${id}`)) {
        items.push({
          group: 'agents',
          id,
          name,
          zh: role,
          icon: ROLE_ICONS[role] || 'AGENT',
          color: ROLE_COLORS[role],
        });
      }
    });

    tasks.forEach((t, i) => {
      const taskId = t.id || t.taskId || `task-${i}`;
      const name = t.name || t.description || shortId(taskId);
      const phase = t.phase || t.status || 'CFP';
      if (fuzzyMatch(query, `${name} ${phase} ${taskId}`)) {
        items.push({ group: 'tasks', id: taskId, name, zh: phase, icon: 'TASK' });
      }
    });

    PHEROMONE_ITEMS.forEach((p) => {
      if (fuzzyMatch(query, `${p.name} ${p.zh}`)) {
        items.push({ group: 'pheromones', id: p.id, name: p.name, zh: p.zh, icon: 'PHERO' });
      }
    });

    FORMULA_ITEMS.forEach((f) => {
      if (fuzzyMatch(query, `${f.name} ${f.zh}`)) {
        items.push({ group: 'formulas', id: f.id, name: f.name, zh: f.zh, icon: 'FX' });
      }
    });

    ACTION_ITEMS.forEach((a) => {
      if (fuzzyMatch(query, `${a.name} ${a.zh}`)) {
        items.push({ group: 'actions', id: a.id, name: a.name, zh: a.zh, icon: 'ACT' });
      }
    });

    return items;
  }, [query, agents, tasks]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Escape') {
        toggleCommandPalette();
      }
      if (e.key === 'Enter' && results[selectedIdx]) {
        handleSelect(results[selectedIdx]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, results, selectedIdx]);

  const handleSelect = (item) => {
    const runMock = async (mode) => {
      const mod = await import('../../data/mock-generator.js');
      if (mode) mod.startMockData({ mode });
      else mod.stopMockData();
    };

    switch (item.group) {
      case 'views':
        setView(item.id);
        break;
      case 'agents':
        selectAgent(item.id);
        setView('hive');
        break;
      case 'tasks':
        selectTask(item.id);
        setView('pipeline');
        break;
      case 'pheromones':
        setView('hive');
        break;
      case 'formulas':
        setFormulaPanelOpen(true);
        break;
      case 'actions':
        if (item.id === 'toggle-settings') toggleSettings();
        if (item.id === 'toggle-timeline') toggleTimeline();
        if (item.id === 'toggle-formulas') setFormulaPanelOpen(true);
        if (item.id === 'open-export') setExportDialogOpen(true);
        if (item.id === 'enter-replay') enterReplay();
        if (item.id === 'demo-showcase') runMock('showcase');
        if (item.id === 'demo-alarm') runMock('alarm');
        if (item.id === 'demo-spawning') runMock('spawning');
        if (item.id === 'demo-contract') runMock('contract-net');
        if (item.id === 'demo-evolution') runMock('evolution');
        if (item.id === 'demo-stop') runMock(null);
        break;
      default:
        break;
    }
    toggleCommandPalette();
  };

  if (!open) return null;

  return (
    <div
      onClick={() => toggleCommandPalette()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: '90vw',
          maxHeight: '60vh',
          background: '#1F2937',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIdx(0);
            }}
            placeholder="Search agents, tasks, views... / 搜索代理、任务、视图..."
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#E5E7EB',
              fontSize: 14,
              fontFamily: 'inherit',
            }}
          />
        </div>

        <div style={{ maxHeight: 'calc(60vh - 50px)', overflow: 'auto', padding: '4px 0' }}>
          {results.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: '#4B5563', fontSize: 12 }}>
              No results / 无结果
            </div>
          )}

          {GROUPS.map((g) => {
            const groupItems = results.filter((r) => r.group === g.key);
            if (groupItems.length === 0) return null;
            return (
              <React.Fragment key={g.key}>
                <div style={{ padding: '6px 16px 2px', fontSize: 9, color: '#6B7280', fontWeight: 600, letterSpacing: 1 }}>
                  {g.label} / {g.zh}
                </div>
                {groupItems.map((item) => {
                  const idx = results.indexOf(item);
                  const isSelected = idx === selectedIdx;
                  return (
                    <div
                      key={`${item.group}-${item.id}`}
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 16px',
                        cursor: 'pointer',
                        background: isSelected ? 'rgba(245,166,35,0.08)' : 'transparent',
                        borderLeft: isSelected ? '2px solid #F5A623' : '2px solid transparent',
                      }}
                    >
                      <span style={{ fontSize: 10, width: 36, textAlign: 'center', color: item.color || '#9CA3AF', fontWeight: 700 }}>
                        {item.icon}
                      </span>
                      <span style={{ flex: 1, fontSize: 12, color: '#E5E7EB' }}>{item.name}</span>
                      <span style={{ fontSize: 10, color: '#6B7280', fontFamily: 'var(--font-zh)' }}>{item.zh}</span>
                    </div>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>

        <div
          style={{
            padding: '6px 16px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            gap: 12,
            fontSize: 9,
            color: '#4B5563',
          }}
        >
          <span>↑↓ Navigate</span>
          <span>Enter Select</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
}
