/**
 * 无障碍工具 / Accessibility Utilities
 *
 * WCAG 2.1 AA 兼容:
 *   - ARIA 属性生成
 *   - 屏幕阅读器文本
 *   - 键盘导航辅助
 *   - 对比度检查
 *   - Focus 管理
 *
 * @module utils/accessibility
 * @author DEEP-IOS
 */

/**
 * 生成 Agent ARIA 属性 / Generate Agent ARIA props
 * @param {Object} agent
 * @returns {Object} aria 属性
 */
export function agentAriaProps(agent) {
  return {
    role: 'listitem',
    'aria-label': `Agent ${agent.name || agent.id}, role: ${agent.role}, state: ${agent.state}`,
    'aria-selected': false,
    tabIndex: 0,
  };
}

/**
 * 生成 Agent ARIA 属性 (选中状态) / Generate selected agent ARIA props
 * @param {Object} agent
 * @returns {Object}
 */
export function selectedAgentAriaProps(agent) {
  return {
    ...agentAriaProps(agent),
    'aria-selected': true,
    'aria-expanded': true,
  };
}

/**
 * 生成任务 ARIA 属性 / Generate Task ARIA props
 * @param {Object} task
 * @returns {Object}
 */
export function taskAriaProps(task) {
  return {
    role: 'listitem',
    'aria-label': `Task ${task.name || task.id}, phase: ${task.phase}, progress: ${Math.round((task.progress || 0) * 100)}%`,
    tabIndex: 0,
  };
}

/**
 * 屏幕阅读器专用文本样式 / Screen reader only style
 * @returns {Object} style
 */
export function srOnlyStyle() {
  return {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: 0,
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0,0,0,0)',
    whiteSpace: 'nowrap',
    border: 0,
  };
}

/**
 * 生成 live region 属性 / Generate live region props
 * @param {'polite'|'assertive'} [politeness='polite']
 * @returns {Object}
 */
export function liveRegionProps(politeness = 'polite') {
  return {
    'aria-live': politeness,
    'aria-atomic': true,
    role: 'status',
  };
}

/**
 * 构建状态变更公告 / Build state change announcement
 * @param {string} agentId
 * @param {string} oldState
 * @param {string} newState
 * @returns {string}
 */
export function stateChangeAnnouncement(agentId, oldState, newState) {
  return `Agent ${agentId} changed from ${oldState} to ${newState}`;
}

// ═══════════════════════════════════════════════════════
// V7.0 新增 / V7.0 Additions
// ═══════════════════════════════════════════════════════

/**
 * 屏幕阅读器文本 / Screen reader text for events
 *
 * @param {string} type - 事件类型
 * @param {Object} data - 事件数据
 * @returns {string}
 */
export function srText(type, data = {}) {
  switch (type) {
    case 'mode_change':
      return `System mode changed to ${data.mode}`;
    case 'breaker_open':
      return `Warning: Circuit breaker opened. Failures: ${data.failures}`;
    case 'breaker_close':
      return 'Circuit breaker closed. System recovered.';
    case 'agent_state':
      return `Agent ${data.agentId} state changed to ${data.state}`;
    case 'task_complete':
      return `Task ${data.taskName || data.taskId} completed`;
    case 'alarm':
      return `Alarm pheromone level high: ${data.level}`;
    case 'health_low':
      return `Warning: System health dropped to ${data.health}%`;
    case 'view_change':
      return `Switched to ${data.view} view`;
    default:
      return '';
  }
}

/**
 * 生成面板折叠 ARIA / Generate panel collapse ARIA
 *
 * @param {string} id - 面板 ID
 * @param {boolean} expanded
 * @returns {Object}
 */
export function panelAriaProps(id, expanded) {
  return {
    'aria-expanded': expanded,
    'aria-controls': `panel-content-${id}`,
    role: 'button',
  };
}

/**
 * 生成视图切换 ARIA / Generate view tab ARIA
 *
 * @param {string} viewId
 * @param {boolean} isActive
 * @returns {Object}
 */
export function viewTabAriaProps(viewId, isActive) {
  return {
    role: 'tab',
    'aria-selected': isActive,
    'aria-controls': `view-panel-${viewId}`,
    tabIndex: isActive ? 0 : -1,
  };
}

/**
 * 对比度检查 (WCAG AA 标准) / Contrast ratio check
 *
 * @param {string} foreground - 前景色 hex
 * @param {string} background - 背景色 hex
 * @returns {{ ratio: number, passAA: boolean, passAAA: boolean }}
 */
export function checkContrast(foreground, background) {
  const fgLum = relativeLuminance(foreground);
  const bgLum = relativeLuminance(background);
  const lighter = Math.max(fgLum, bgLum);
  const darker = Math.min(fgLum, bgLum);
  const ratio = (lighter + 0.05) / (darker + 0.05);

  return {
    ratio: Math.round(ratio * 100) / 100,
    passAA: ratio >= 4.5,    // 正文 normal text
    passAAA: ratio >= 7.0,   // AAA 级
  };
}

/**
 * 计算相对亮度 / Calculate relative luminance
 * @param {string} hex
 * @returns {number}
 */
function relativeLuminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const sR = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const sG = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const sB = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

  return 0.2126 * sR + 0.7152 * sG + 0.0722 * sB;
}

/**
 * 键盘陷阱 (模态对话框) / Keyboard trap for modals
 *
 * @param {HTMLElement} container - 模态容器
 * @param {KeyboardEvent} e
 */
export function trapFocus(container, e) {
  if (e.key !== 'Tab') return;

  const focusable = container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );

  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Focus 可见样式 / Focus visible style
 * 2px 白色轮廓
 * @returns {Object}
 */
export function focusVisibleStyle() {
  return {
    outline: '2px solid rgba(255,255,255,0.8)',
    outlineOffset: 2,
  };
}
