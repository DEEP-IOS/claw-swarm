/**
 * 认知极限常量 / Cognitive Limits Constants
 *
 * 7+-2 规则 + Fitts 法则 + Hick 法则
 *
 * @module constants/cognitive-limits
 * @author DEEP-IOS
 */

/** Miller 7+-2: 同时显示的信息单元上限 */
export const MILLER_MAX = 9;
export const MILLER_OPTIMAL = 7;
export const MILLER_MIN = 5;

/** Fitts 法则: 最小可点击尺寸 (px) */
export const FITTS_MIN_TARGET = 44;
/** Fitts 法则: 推荐可点击尺寸 (px) */
export const FITTS_OPTIMAL_TARGET = 48;

/** Hick 法则: 最大可选项数 (超过应分组) */
export const HICK_MAX_CHOICES = 7;

/** 最大同时显示通知数 */
export const MAX_VISIBLE_NOTIFICATIONS = 5;

/** 最大同时显示 Agent 数 (性能约束) */
export const MAX_VISIBLE_AGENTS = 20;

/** 面板最大折叠区数 */
export const MAX_PANEL_SECTIONS = 5;

/** 搜索结果最大显示数 */
export const MAX_SEARCH_RESULTS = 12;

/** 时间线最大事件数 */
export const MAX_TIMELINE_EVENTS = 100;
