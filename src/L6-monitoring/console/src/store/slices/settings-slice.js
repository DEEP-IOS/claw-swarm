/**
 * Settings Slice / 设置切片
 *
 * 管理用户偏好设置，支持 localStorage 持久化。
 * Manages user preferences with localStorage persistence.
 *
 * @module store/slices/settings-slice
 * @author DEEP-IOS
 */

const STORAGE_KEY = 'claw-swarm-settings';

/**
 * Normalize legacy keys from older console builds.
 * Keeps persisted user preferences after key renames.
 * @param {Object|null} raw
 * @returns {Object}
 */
function normalizeSettings(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const next = { ...raw };

  if (next.showEdges === undefined && next.showBeams !== undefined) next.showEdges = next.showBeams;
  if (next.sound === undefined && next.soundEnabled !== undefined) next.sound = next.soundEnabled;
  if (next.envParticles === undefined && next.showDust !== undefined) next.envParticles = next.showDust;
  if (next.glitchFx === undefined && next.glitchEffects !== undefined) next.glitchFx = next.glitchEffects;
  if (next.labelMode === undefined && next.lang !== undefined) next.labelMode = next.lang;
  if (next.labelMode === 'dual') next.labelMode = 'bilingual';

  delete next.showBeams;
  delete next.soundEnabled;
  delete next.showDust;
  delete next.glitchEffects;
  delete next.lang;
  return next;
}

/**
 * 从 localStorage 加载设置 / Load settings from localStorage
 * @returns {Object|null}
 */
function loadPersistedSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * 保存设置到 localStorage / Save settings to localStorage
 * @param {Object} settings
 */
function persistSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* quota exceeded, ignore */ }
}

/** 默认设置 / Default settings */
const DEFAULT_SETTINGS = {
  animSpeed: 1.0,
  particleDensity: 1.0,
  showTrails: true,
  showEdges: true,
  showSubAgents: true,
  showFormulas: true,
  sound: false,
  envParticles: true,
  glitchFx: true,
  perfMode: false,
  labelMode: 'bilingual',   // 'en' | 'zh' | 'bilingual'
  colorBlindMode: 'none',   // 'none' | 'deuteranopia' | 'protanopia' | 'tritanopia'
};

/**
 * @param {Function} set - Zustand set
 * @param {Function} get - Zustand get
 * @returns {Object} Settings slice
 */
export const createSettingsSlice = (set, get) => {
  const persisted = loadPersistedSettings();
  const merged = { ...DEFAULT_SETTINGS, ...normalizeSettings(persisted) };

  return {
    // ── 语言 / Language ──
    lang: merged.labelMode || 'bilingual',

    // ── 设置 / Settings ──
    settings: merged,

    // ── 更新单个设置 / Update single setting ──
    updateSetting: (key, value) => set((s) => {
      const next = { ...s.settings, [key]: value };
      persistSettings(next);
      // 同步 lang 字段
      const patch = { settings: next };
      if (key === 'labelMode') patch.lang = value;
      return patch;
    }),

    // ── 批量更新设置 / Bulk update settings ──
    updateSettings: (patch) => set((s) => {
      const next = { ...s.settings, ...patch };
      persistSettings(next);
      const result = { settings: next };
      if (patch.labelMode) result.lang = patch.labelMode;
      return result;
    }),

    // ── 重置设置 / Reset settings ──
    resetSettings: () => set(() => {
      persistSettings(DEFAULT_SETTINGS);
      return { settings: { ...DEFAULT_SETTINGS }, lang: DEFAULT_SETTINGS.labelMode };
    }),
  };
};
