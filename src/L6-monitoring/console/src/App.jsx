import React, { useEffect, useRef, useCallback, useState } from 'react';
import useStore from './store.js';
import { connectSSE, disconnectSSE, loadInitialData } from './sse-client.js';
import { HiveRenderer } from './canvas/HiveRenderer.js';

import Header from './components/Header.jsx';
import LeftSidebar from './components/LeftSidebar.jsx';
import HiveOverlay from './views/HiveOverlay.jsx';
import PipelineOverlay from './views/PipelineOverlay.jsx';
import CognitionOverlay from './views/CognitionOverlay.jsx';
import EcologyOverlay from './views/EcologyOverlay.jsx';
import NetworkOverlay from './views/NetworkOverlay.jsx';
import ControlOverlay from './views/ControlOverlay.jsx';
import EmptyStateGuide from './views/EmptyStateGuide.jsx';

import ThemeProvider from './themes/ThemeProvider.jsx';
import CommandPalette from './components/overlays/CommandPalette.jsx';
import NotificationStack from './components/overlays/NotificationStack.jsx';
import SettingsDrawer from './components/overlays/SettingsDrawer.jsx';
import OnboardingOverlay from './components/overlays/OnboardingOverlay.jsx';
import EventTimeline from './components/timeline/EventTimeline.jsx';
import PanelRouter from './panels/PanelRouter.jsx';
import MorphTransitionContainer from './components/MorphTransition.jsx';
import CanvasFallback from './components/CanvasFallback.jsx';
import EntryHeatbar from './components/ui/EntryHeatbar.jsx';
import ExportDialog from './components/overlays/ExportDialog.jsx';
import MobileDrawer from './components/overlays/MobileDrawer.jsx';

import { useKeyboard } from './hooks/use-keyboard.js';
import { useMediaQuery, useReducedMotion } from './hooks/use-media-query.js';
import { useAdaptiveUI } from './hooks/use-adaptive-ui.js';
import { srText, liveRegionProps, srOnlyStyle } from './utils/accessibility.js';
import { exportCanvasPNG, exportStateJSON } from './utils/exporters.js';

const VIEW_OVERLAYS = {
  hive: HiveOverlay,
  pipeline: PipelineOverlay,
  cognition: CognitionOverlay,
  ecology: EcologyOverlay,
  network: NetworkOverlay,
  control: ControlOverlay,
};

function deepClone(data) {
  if (typeof structuredClone === 'function') return structuredClone(data);
  return JSON.parse(JSON.stringify(data));
}

export default function App() {
  const searchParams = new URLSearchParams(window.location.search);
  const scenarioMode = searchParams.get('scenario') || (searchParams.has('demo') ? 'showcase' : 'normal');
  const forceMockScenario = searchParams.has('demo') || scenarioMode !== 'normal';

  const view = useStore((s) => s.view);
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const subAgents = useStore((s) => s.subAgents);
  const pheromones = useStore((s) => s.pheromones);
  const edges = useStore((s) => s.edges);
  const mode = useStore((s) => s.mode);
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const sseConnected = useStore((s) => s.sseConnected);
  const settings = useStore((s) => s.settings);
  const replayActive = useStore((s) => s.replayActive);
  const recordReplaySnapshot = useStore((s) => s.recordReplaySnapshot);
  const setExportDialogOpen = useStore((s) => s.setExportDialogOpen);
  const addNotification = useStore((s) => s.addNotification);

  const canvasBgRef = useRef(null);
  const canvasFxRef = useRef(null);
  const canvasFgRef = useRef(null);
  const rendererRef = useRef(null);
  const mainAreaRef = useRef(null);
  const srAnnouncementRef = useRef(null);

  const [demoMode, setDemoMode] = useState(searchParams.has('demo'));
  const [mobilePane, setMobilePane] = useState(null);

  const prefersReducedMotion = useReducedMotion();
  const useCanvasDOM = prefersReducedMotion && !settings?.perfMode;
  const isTablet = useMediaQuery('(max-width: 1024px)');
  const adaptive = useAdaptiveUI();

  const announce = useCallback((text) => {
    if (srAnnouncementRef.current) srAnnouncementRef.current.textContent = text;
  }, []);

  const doExportPng = useCallback(() => {
    if (useCanvasDOM) return false;
    return exportCanvasPNG({
      canvasBg: canvasBgRef.current,
      canvasFx: canvasFxRef.current,
      canvasFg: canvasFgRef.current,
      prefix: 'swarm-console',
    });
  }, [useCanvasDOM]);

  // Init renderer
  useEffect(() => {
    if (useCanvasDOM) return;
    if (!canvasBgRef.current || !canvasFxRef.current || !canvasFgRef.current) return;

    const renderer = new HiveRenderer({
      canvasBg: canvasBgRef.current,
      canvasFx: canvasFxRef.current,
      canvasFg: canvasFgRef.current,
    });
    rendererRef.current = renderer;

    const rect = mainAreaRef.current?.getBoundingClientRect();
    if (rect) renderer.resize(rect.width, rect.height);

    renderer.start();
    renderer.syncTasks(useStore.getState().tasks || []);

    const onResize = () => {
      const r = mainAreaRef.current?.getBoundingClientRect();
      if (r) renderer.resize(r.width, r.height);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [useCanvasDOM]);

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.syncAgents(agents);
  }, [agents]);

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.syncTasks(tasks || []);
  }, [tasks]);

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.syncPheromones(pheromones || {});
  }, [pheromones]);

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.syncNetworkEdges(edges || []);
  }, [edges]);

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.syncSubAgents(subAgents || []);
  }, [subAgents]);

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.setView(view);
    announce(srText('view_change', { view }));
  }, [view, announce]);

  useEffect(() => {
    if (!rendererRef.current) return;
    rendererRef.current.setModeColor(mode?.m || 'EXPLOIT');
    rendererRef.current.setShowEdges(Boolean(settings?.showEdges ?? settings?.showBeams));
    rendererRef.current.setShowTrails(Boolean(settings?.showTrails));
    rendererRef.current.setShowSubAgents(Boolean(settings?.showSubAgents));
    rendererRef.current.setPerfMode(Boolean(settings?.perfMode));
    rendererRef.current.setAnimationSpeed(Number(settings?.animSpeed ?? 1));
    rendererRef.current.setParticleDensity(Number(settings?.particleDensity ?? 1));
    rendererRef.current.setEnvParticlesEnabled(Boolean(settings?.envParticles ?? settings?.showDust));
    rendererRef.current.setGlitchEnabled(Boolean(settings?.glitchFx ?? settings?.glitchEffects));
  }, [mode, settings]);

  // Adaptive rendering hooks into renderer instead of being just analytics.
  useEffect(() => {
    if (!rendererRef.current) return;
    rendererRef.current.setTargetFps?.(adaptive.targetFps);
    rendererRef.current.setAdaptiveParticleMultiplier?.(adaptive.particleMultiplier);
  }, [adaptive.targetFps, adaptive.particleMultiplier]);

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.setSelectedId(selectedAgentId);
  }, [selectedAgentId]);

  const lastEventTime = useStore((s) => s.lastEventTime);
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.updateFreshness(sseConnected, lastEventTime);
    }
  }, [sseConnected, lastEventTime]);

  // Connect SSE / fallback to mock.
  useEffect(() => {
    const basePath = import.meta.env?.VITE_API_BASE || '';
    let disposed = false;
    let stopMock = null;

    const startMockMode = async (modeName) => {
      const mod = await import('./data/mock-generator.js');
      if (disposed) return;
      mod.startMockData({ mode: modeName });
      stopMock = mod.stopMockData;
      useStore.getState().setConnected(true);
    };

    if (forceMockScenario) {
      startMockMode(scenarioMode);
      return () => {
        disposed = true;
        stopMock?.();
      };
    }

    loadInitialData(basePath).catch(() => startMockMode('showcase'));
    connectSSE(basePath);

    if (import.meta.env?.VITE_MOCK_MODE === 'true') {
      startMockMode('showcase');
    }

    return () => {
      disposed = true;
      disconnectSSE();
      stopMock?.();
    };
  }, [forceMockScenario, scenarioMode]);

  // Pause live stream while replaying; restore when exiting replay.
  const prevReplayRef = useRef(replayActive);
  useEffect(() => {
    if (forceMockScenario) {
      prevReplayRef.current = replayActive;
      return;
    }
    const basePath = import.meta.env?.VITE_API_BASE || '';
    if (!prevReplayRef.current && replayActive) {
      disconnectSSE();
    } else if (prevReplayRef.current && !replayActive) {
      loadInitialData(basePath).catch(() => {});
      connectSSE(basePath);
    }
    prevReplayRef.current = replayActive;
  }, [replayActive, forceMockScenario]);

  // Periodic state snapshots for replay timeline.
  useEffect(() => {
    const capture = () => {
      const s = useStore.getState();
      if (s.replayActive) return;
      recordReplaySnapshot({
        view: s.view,
        mode: deepClone(s.mode),
        agents: deepClone(s.agents),
        subAgents: deepClone(s.subAgents),
        tasks: deepClone(s.tasks),
        edges: deepClone(s.edges),
        pheromones: deepClone(s.pheromones),
        health: s.health,
        red: deepClone(s.red),
        breaker: deepClone(s.breaker),
        budget: deepClone(s.budget),
        shapley: deepClone(s.shapley),
        signals: deepClone(s.signals),
        piController: deepClone(s.piController),
        coldStart: deepClone(s.coldStart),
        dual: deepClone(s.dual),
        quality: deepClone(s.quality),
        bidStats: deepClone(s.bidStats),
        knowledge: deepClone(s.knowledge),
      });
    };

    capture();
    const timer = setInterval(capture, 10000);
    return () => clearInterval(timer);
  }, [recordReplaySnapshot]);

  const handleCanvasClick = useCallback((e) => {
    if (!rendererRef.current || !canvasFgRef.current) return;
    const rect = canvasFgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const agentId = rendererRef.current.handleClick(x, y);

    const state = useStore.getState();
    if (e.shiftKey && agentId && state.selectedAgentId) {
      state.setCompareAgent(agentId);
    } else {
      state.selectAgent(agentId);
      if (state.compareAgentId) state.setCompareAgent(null);
    }
    if (agentId) adaptive.recordClick?.(agentId);
  }, [adaptive]);

  useKeyboard([
    { key: 'k', ctrl: true, handler: () => useStore.getState().toggleCommandPalette() },
    {
      key: 'Escape',
      handler: () => {
        const s = useStore.getState();
        if (s.commandPaletteOpen) return;
        if (s.settingsPanelOpen) { s.toggleSettings(); return; }
        if (s.exportDialogOpen) { s.setExportDialogOpen(false); return; }
        if (s.formulaPanelOpen) { s.setFormulaPanelOpen(false); return; }
        s.selectAgent(null);
        s.selectTask(null);
        s.setCompareAgent(null);
      },
    },
    { key: '1', handler: () => useStore.getState().setView('hive') },
    { key: '2', handler: () => useStore.getState().setView('pipeline') },
    { key: '3', handler: () => useStore.getState().setView('cognition') },
    { key: '4', handler: () => useStore.getState().setView('ecology') },
    { key: '5', handler: () => useStore.getState().setView('network') },
    { key: '6', handler: () => useStore.getState().setView('control') },
    { key: 'p', ctrl: true, shift: true, handler: () => setDemoMode((v) => !v) },
    { key: ',', ctrl: true, handler: () => useStore.getState().toggleSettings() },
    {
      key: 's',
      ctrl: true,
      shift: true,
      handler: () => {
        const ok = doExportPng();
        if (!ok) addNotification?.({ type: 'warning', title: 'Screenshot Unavailable', titleZh: '截图不可用' });
      },
    },
    {
      key: 'e',
      ctrl: true,
      shift: true,
      handler: () => exportStateJSON(useStore.getState()),
    },
    {
      key: 'x',
      ctrl: true,
      shift: true,
      handler: () => setExportDialogOpen(true),
    },
  ]);

  useEffect(() => {
    document.documentElement.classList.toggle('demo-mode', demoMode);
    return () => document.documentElement.classList.remove('demo-mode');
  }, [demoMode]);

  useEffect(() => {
    if (!(forceMockScenario || demoMode)) return undefined;
    const cycle = ['hive', 'pipeline', 'cognition', 'ecology', 'network', 'control'];
    let idx = cycle.indexOf(useStore.getState().view);
    const timer = setInterval(() => {
      idx = (idx + 1) % cycle.length;
      useStore.getState().setView(cycle[idx]);
    }, 9000);
    return () => clearInterval(timer);
  }, [forceMockScenario, demoMode]);

  const ViewOverlay = VIEW_OVERLAYS[view] || HiveOverlay;
  const shouldShowEmptyGuide = !forceMockScenario
    && !replayActive
    && (agents?.length || 0) === 0
    && (tasks?.length || 0) === 0
    && (subAgents?.length || 0) === 0;

  const startShowcaseDemo = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('demo', '1');
    window.location.href = url.toString();
  }, []);

  return (
    <ThemeProvider>
      <div className={`app-layout${demoMode ? ' demo' : ''}`}>
        <Header />
        <LeftSidebar />

        <div className="main-area" ref={mainAreaRef}>
          {useCanvasDOM ? (
            <CanvasFallback />
          ) : (
            <>
              <div className="canvas-stack">
                <canvas ref={canvasBgRef} style={{ zIndex: 1 }} />
                <canvas ref={canvasFxRef} style={{ zIndex: 2 }} />
                <canvas
                  ref={canvasFgRef}
                  style={{ zIndex: 3, cursor: 'pointer' }}
                  onClick={handleCanvasClick}
                  onWheel={(e) => {
                    e.preventDefault();
                    if (!rendererRef.current) return;
                    const rect = canvasFgRef.current.getBoundingClientRect();
                    rendererRef.current.handleWheel(
                      e.deltaY,
                      e.clientX - rect.left,
                      e.clientY - rect.top,
                    );
                  }}
                />
              </div>

              <MorphTransitionContainer>
                <div className="view-overlay">
                  <ViewOverlay />
                </div>
              </MorphTransitionContainer>
            </>
          )}

          {view === 'hive' && (
            <div className="entry-heatbar-wrap">
              <EntryHeatbar />
            </div>
          )}

          {shouldShowEmptyGuide && (
            <EmptyStateGuide sseConnected={sseConnected} onStartDemo={startShowcaseDemo} />
          )}
        </div>

        <aside className="right-sidebar">
          <PanelRouter />
        </aside>

        <EventTimeline />

        <div
          ref={srAnnouncementRef}
          {...liveRegionProps('polite')}
          style={srOnlyStyle()}
        />
      </div>

      <MobileDrawer
        enabled={isTablet && !demoMode}
        pane={mobilePane}
        onPane={(pane) => setMobilePane((prev) => (prev === pane ? null : pane))}
        onClose={() => setMobilePane(null)}
        leftContent={<LeftSidebar />}
        rightContent={<PanelRouter />}
      />

      <CommandPalette />
      <NotificationStack />
      <SettingsDrawer />
      <ExportDialog onExportPng={doExportPng} />
      <OnboardingOverlay />
    </ThemeProvider>
  );
}
