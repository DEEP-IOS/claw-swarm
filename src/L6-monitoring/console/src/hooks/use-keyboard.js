/**
 * 键盘快捷键 Hook / Keyboard Shortcuts Hook
 *
 * 注册全局和局部键盘快捷键。
 * Registers global and local keyboard shortcuts.
 *
 * @module hooks/use-keyboard
 * @author DEEP-IOS
 */
import { useEffect, useCallback } from 'react';

/**
 * @typedef {Object} KeyBinding
 * @property {string} key - 键名 (如 'k', 'Escape', '1')
 * @property {boolean} [ctrl] - 需要 Ctrl/Meta
 * @property {boolean} [shift] - 需要 Shift
 * @property {boolean} [alt] - 需要 Alt
 * @property {Function} handler - 回调
 * @property {string} [description] - 描述 (用于命令面板)
 */

/**
 * 注册键盘快捷键 / Register keyboard shortcuts
 * @param {KeyBinding[]} bindings
 * @param {boolean} [enabled=true] - 是否启用
 */
export function useKeyboard(bindings, enabled = true) {
  const handler = useCallback((e) => {
    if (!enabled) return;
    // 忽略输入框中的快捷键 / Skip when typing in inputs
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    for (const b of bindings) {
      const ctrlMatch = b.ctrl ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey);
      const shiftMatch = b.shift ? e.shiftKey : !e.shiftKey;
      const altMatch = b.alt ? e.altKey : !e.altKey;
      const keyMatch = e.key === b.key || e.key.toLowerCase() === b.key?.toLowerCase();

      // 数字键特殊处理 / Special handling for number keys
      const numMatch = /^[1-6]$/.test(b.key) && e.key === b.key && !b.ctrl && !b.shift && !b.alt;

      if ((keyMatch && ctrlMatch && shiftMatch && altMatch) || numMatch) {
        e.preventDefault();
        b.handler(e);
        return;
      }
    }
  }, [bindings, enabled]);

  useEffect(() => {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handler]);
}

export default useKeyboard;
