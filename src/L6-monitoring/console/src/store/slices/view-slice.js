/**
 * View Slice / 视图切片
 *
 * 管理 UI 视图状态、选中元素和连接状态。
 * Manages UI view state, selections, and connection status.
 *
 * @module store/slices/view-slice
 * @author DEEP-IOS
 */

/**
 * @param {Function} set - Zustand set
 * @param {Function} get - Zustand get
 * @returns {Object} View slice
 */
export const createViewSlice = (set, get) => ({
  // ── 视图 / View ──
  view: 'hive',                        // 'hive' | 'pipeline' | 'cognition' | 'ecology' | 'network' | 'control'
  prevView: null,                      // 前一视图 (形变过渡用)

  // ── 选中元素 / Selections ──
  selectedAgentId: null,
  selectedTaskId: null,
  compareAgentId: null,                // 对比 Agent ID

  // ── UI 面板状态 / UI Panel State ──
  commandPaletteOpen: false,
  settingsPanelOpen: false,
  timelineExpanded: false,
  inspectorPinned: false,
  formulaPanelOpen: false,
  exportDialogOpen: false,

  // ── 连接状态 / Connection State ──
  sseConnected: false,
  connectionState: 'offline',          // 'online' | 'offline' | 'connecting'
  lastEventTime: null,

  // ── Timeline Replay / 时间线回放 ──
  replayActive: false,
  replayPlaying: false,
  replaySpeed: 1,
  replayIndex: 0,
  replaySnapshots: [],
  replayLiveBackup: null,

  // ── 切换视图 (保存前一视图) / Switch view (save previous) ──
  setView: (view) => set((s) => ({ prevView: s.view, view })),

  // ── 选择 Agent ──
  selectAgent: (id) => set({ selectedAgentId: id }),

  // ── 选择 Task ──
  selectTask: (id) => set({ selectedTaskId: id }),

  // ── 设置对比 Agent / Set compare agent ──
  setCompareAgent: (id) => set({ compareAgentId: id }),

  // ── 切换命令面板 / Toggle command palette ──
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),

  // ── 切换设置面板 / Toggle settings panel ──
  toggleSettings: () => set((s) => ({ settingsPanelOpen: !s.settingsPanelOpen })),

  // ── 切换时间线 / Toggle timeline ──
  toggleTimeline: () => set((s) => ({ timelineExpanded: !s.timelineExpanded })),

  // ── 切换检查器固定 / Toggle inspector pin ──
  toggleInspectorPin: () => set((s) => ({ inspectorPinned: !s.inspectorPinned })),

  // ── 切换公式面板 / Toggle formula panel ──
  setFormulaPanelOpen: (v) => set({ formulaPanelOpen: v }),

  // ── 导出面板 / Export dialog ──
  toggleExportDialog: () => set((s) => ({ exportDialogOpen: !s.exportDialogOpen })),
  setExportDialogOpen: (v) => set({ exportDialogOpen: Boolean(v) }),

  // ── 别名方法 (面板系统使用) / Alias methods for panel system ──
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),
  setCompareAgentId: (id) => set({ compareAgentId: id }),

  // ── 设置连接状态 / Set connection state ──
  setConnected: (v) => set({
    sseConnected: v,
    connectionState: v ? 'online' : 'offline',
  }),

  // ── 设置连接中状态 / Set connecting state ──
  setConnecting: () => set({ connectionState: 'connecting' }),

  // ── 记录快照 / Record replay snapshot ──
  recordReplaySnapshot: (snapshot) => set((s) => ({
    replaySnapshots: [
      ...s.replaySnapshots,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        ...snapshot,
      },
    ].slice(-360),
  })),

  // ── 进入回放 / Enter replay mode ──
  enterReplay: () => set((s) => {
    if (!s.replaySnapshots.length || s.replayActive) return {};
    const backup = {
      agents: s.agents,
      subAgents: s.subAgents,
      tasks: s.tasks,
      edges: s.edges,
      pheromones: s.pheromones,
      mode: s.mode,
      health: s.health,
      red: s.red,
      breaker: s.breaker,
      budget: s.budget,
      shapley: s.shapley,
      signals: s.signals,
      piController: s.piController,
      coldStart: s.coldStart,
      dual: s.dual,
      quality: s.quality,
      bidStats: s.bidStats,
      knowledge: s.knowledge,
      view: s.view,
    };
    const replayIndex = s.replaySnapshots.length - 1;
    const snap = s.replaySnapshots[replayIndex];
    return {
      replayActive: true,
      replayPlaying: false,
      replayIndex,
      replayLiveBackup: backup,
      mode: snap.mode ?? s.mode,
      agents: snap.agents ?? s.agents,
      subAgents: snap.subAgents ?? s.subAgents,
      tasks: snap.tasks ?? s.tasks,
      edges: snap.edges ?? s.edges,
      pheromones: snap.pheromones ?? s.pheromones,
      health: snap.health ?? s.health,
      red: snap.red ?? s.red,
      breaker: snap.breaker ?? s.breaker,
      budget: snap.budget ?? s.budget,
      shapley: snap.shapley ?? s.shapley,
      signals: snap.signals ?? s.signals,
      piController: snap.piController ?? s.piController,
      coldStart: snap.coldStart ?? s.coldStart,
      dual: snap.dual ?? s.dual,
      quality: snap.quality ?? s.quality,
      bidStats: snap.bidStats ?? s.bidStats,
      knowledge: snap.knowledge ?? s.knowledge,
      view: snap.view ?? s.view,
    };
  }),

  // ── 退出回放 / Exit replay mode ──
  exitReplay: () => set((s) => {
    if (!s.replayActive) return {};
    const backup = s.replayLiveBackup;
    if (!backup) {
      return {
        replayActive: false,
        replayPlaying: false,
        replayLiveBackup: null,
      };
    }
    return {
      replayActive: false,
      replayPlaying: false,
      replayLiveBackup: null,
      agents: backup.agents,
      subAgents: backup.subAgents,
      tasks: backup.tasks,
      edges: backup.edges,
      pheromones: backup.pheromones,
      mode: backup.mode,
      health: backup.health,
      red: backup.red,
      breaker: backup.breaker,
      budget: backup.budget,
      shapley: backup.shapley,
      signals: backup.signals,
      piController: backup.piController,
      coldStart: backup.coldStart,
      dual: backup.dual,
      quality: backup.quality,
      bidStats: backup.bidStats,
      knowledge: backup.knowledge,
      view: backup.view,
    };
  }),

  setReplayPlaying: (v) => set({ replayPlaying: Boolean(v) }),
  setReplaySpeed: (v) => set({ replaySpeed: Math.max(0.25, Math.min(4, Number(v) || 1)) }),

  // ── 跳转回放游标并应用快照 / Seek replay cursor and apply snapshot ──
  seekReplay: (index) => set((s) => {
    if (!s.replaySnapshots.length) return {};
    const i = Math.max(0, Math.min(s.replaySnapshots.length - 1, Number(index) || 0));
    const snap = s.replaySnapshots[i];
    return {
      replayIndex: i,
      mode: snap.mode ?? s.mode,
      agents: snap.agents ?? s.agents,
      subAgents: snap.subAgents ?? s.subAgents,
      tasks: snap.tasks ?? s.tasks,
      edges: snap.edges ?? s.edges,
      pheromones: snap.pheromones ?? s.pheromones,
      health: snap.health ?? s.health,
      red: snap.red ?? s.red,
      breaker: snap.breaker ?? s.breaker,
      budget: snap.budget ?? s.budget,
      shapley: snap.shapley ?? s.shapley,
      signals: snap.signals ?? s.signals,
      piController: snap.piController ?? s.piController,
      coldStart: snap.coldStart ?? s.coldStart,
      dual: snap.dual ?? s.dual,
      quality: snap.quality ?? s.quality,
      bidStats: snap.bidStats ?? s.bidStats,
      knowledge: snap.knowledge ?? s.knowledge,
      view: snap.view ?? s.view,
    };
  }),

  stepReplay: (delta = 1) => {
    const s = get();
    if (!s.replaySnapshots.length) return;
    s.seekReplay(s.replayIndex + delta);
  },
});
