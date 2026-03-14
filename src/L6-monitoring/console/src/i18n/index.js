/**
 * 国际化入口 / i18n Entry
 *
 * 提供 t(key) 翻译函数和 BilingualText 辅助。
 * 根据 store.settings.labelMode 选择语言。
 *
 * @module i18n
 * @author DEEP-IOS
 */
import en from './en.js';
import zh from './zh.js';
import useStore from '../store.js';

const DICTS = { en, zh };

/**
 * 获取翻译 / Get translation
 *
 * @param {string} key - 翻译键 (如 'view.hive')
 * @param {string} [lang] - 强制语言 ('en'|'zh'), 默认从 store 读取
 * @returns {string} 翻译结果, 未找到时返回 key 本身
 */
export function t(key, lang) {
  const mode = lang || useStore.getState().lang || 'bilingual';
  if (mode === 'bilingual' || mode === 'en') {
    return en[key] || key;
  }
  return zh[key] || en[key] || key;
}

/**
 * 获取双语文本 / Get bilingual text pair
 *
 * @param {string} key - 翻译键
 * @returns {{ en: string, zh: string }} 双语对
 */
export function bilingual(key) {
  return {
    en: en[key] || key,
    zh: zh[key] || en[key] || key,
  };
}

/**
 * 获取所有翻译键 / Get all keys (for search)
 * @returns {string[]}
 */
export function allKeys() {
  return Object.keys(en);
}

export { en, zh };
