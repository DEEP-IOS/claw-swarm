/**
 * English Translations / 英文翻译
 * @module i18n/en
 * @author DEEP-IOS
 */
export default {
  // ── Views / 视图 ──
  'view.hive': 'Hive',
  'view.pipeline': 'Pipeline',
  'view.cognition': 'Cognition',
  'view.ecology': 'Ecology',
  'view.network': 'Network',
  'view.control': 'Control',

  // ── Header / 顶栏 ──
  'header.title': 'Swarm Console',
  'header.health': 'Health',
  'header.agents': 'Agents',

  // ── Sidebar / 侧栏 ──
  'sidebar.agents': 'Agents',
  'sidebar.pheromones': 'Pheromones',
  'sidebar.red': 'RED Metrics',
  'sidebar.budget': 'Budget',
  'sidebar.breaker': 'Circuit Breaker',
  'sidebar.shapley': 'Shapley Credits',
  'sidebar.signals': 'Signal Weights',
  'sidebar.pi': 'PI Controller',

  // ── Agent States / Agent 状态 ──
  'state.ACTIVE': 'Active',
  'state.IDLE': 'Idle',
  'state.EXECUTING': 'Executing',
  'state.REPORTING': 'Reporting',
  'state.RETIRED': 'Retired',

  // ── Agent Roles / Agent 角色 ──
  'role.architect': 'Architect',
  'role.coder': 'Coder',
  'role.reviewer': 'Reviewer',
  'role.scout': 'Scout',
  'role.guard': 'Guard',
  'role.worker': 'Worker',

  // ── ABC Roles ──
  'abc.employed': 'Employed',
  'abc.onlooker': 'Onlooker',
  'abc.scout': 'Scout',

  // ── Pheromone Types / 信息素类型 ──
  'phero.trail': 'Trail',
  'phero.alarm': 'Alarm',
  'phero.recruit': 'Recruit',
  'phero.dance': 'Dance',
  'phero.queen': 'Queen',
  'phero.food': 'Food',
  'phero.danger': 'Danger',

  // ── Task Phases / 任务阶段 ──
  'phase.CFP': 'Call for Proposal',
  'phase.BID': 'Bidding',
  'phase.EXECUTE': 'Executing',
  'phase.QUALITY': 'Quality Gate',
  'phase.DONE': 'Done',

  // ── Modulator Modes / 调制器模式 ──
  'mode.EXPLOIT': 'Exploit',
  'mode.EXPLORE': 'Explore',
  'mode.URGENT': 'Urgent',
  'mode.RELIABLE': 'Reliable',

  // ── Breaker States / 断路器状态 ──
  'breaker.CLOSED': 'Closed',
  'breaker.OPEN': 'Open',
  'breaker.HALF_OPEN': 'Half-Open',

  // ── Panel / 面板 ──
  'panel.identity': 'Identity',
  'panel.currentTask': 'Current Task',
  'panel.subAgents': 'Sub-agents',
  'panel.reputation': 'Reputation',
  'panel.capabilities': 'Capabilities',
  'panel.history': 'History',
  'panel.compare': 'Compare',
  'panel.taskFlow': 'Task Flow',
  'panel.dag': 'Dependencies',
  'panel.quality': 'Quality Audit',
  'panel.formula': 'Formulas',

  // ── Notifications / 通知 ──
  'notif.circuitOpen': 'Circuit Breaker OPEN',
  'notif.recovery': 'Recovery Complete',
  'notif.alarmRising': 'Alarm Rising',
  'notif.cfpIssued': 'CFP Issued',
  'notif.taskAwarded': 'Task Awarded',
  'notif.qualityPassed': 'Quality Gate Passed',
  'notif.qualityFailed': 'Quality Gate Failed',
  'notif.speciesEvolved': 'Species Evolved',
  'notif.speciesProposed': 'Species Proposed',
  'notif.speciesCulled': 'Species Culled',
  'notif.subAgentSpawned': 'Sub-agent Spawned',
  'notif.subAgentDone': 'Sub-agent Done',
  'notif.anomalyDetected': 'Anomaly Detected',
  'notif.knowledgeTransfer': 'Knowledge Transfer',
  'notif.budgetDegradation': 'Budget Degradation',
  'notif.piActuated': 'PI Controller Actuated',
  'notif.modeSwitched': 'Mode Switched',
  'notif.dreamConsolidation': 'Dream Consolidation',

  // ── Settings / 设置 ──
  'settings.title': 'Settings',
  'settings.animSpeed': 'Animation Speed',
  'settings.particleDensity': 'Particle Density',
  'settings.showTrails': 'Show Trails',
  'settings.showEdges': 'Show Edges',
  'settings.showSubAgents': 'Show Sub-agents',
  'settings.showFormulas': 'Show Formulas',
  'settings.sound': 'Sound Effects',
  'settings.envParticles': 'Env Particles',
  'settings.glitchFx': 'Glitch Effects',
  'settings.perfMode': 'Performance Mode',
  'settings.labelMode': 'Label Language',
  'settings.colorBlindMode': 'Colorblind Mode',
  'settings.reset': 'Reset Defaults',
  'settings.retriggerOnboarding': 'Re-trigger Guide',

  // ── Command Palette / 命令面板 ──
  'cmd.placeholder': 'Search agents, tasks, formulas...',
  'cmd.agents': 'Agents',
  'cmd.tasks': 'Tasks',
  'cmd.formulas': 'Formulas',
  'cmd.views': 'Views',
  'cmd.noResults': 'No results found',

  // ── Timeline / 时间线 ──
  'timeline.title': 'Event Timeline',
  'timeline.expand': 'Expand',
  'timeline.collapse': 'Collapse',

  // ── Connection / 连接 ──
  'conn.live': 'LIVE',
  'conn.offline': 'OFFLINE',
  'conn.connecting': 'CONNECTING',

  // ── Freshness / 新鲜度 ──
  'fresh.live': 'Real-time',
  'fresh.recent': 'Recent',
  'fresh.stale': 'Stale',
  'fresh.disconnected': 'Disconnected',

  // ── Footer / 底栏 ──
  'footer.agents': 'Agents',
  'footer.health': 'Health',
  'footer.rate': 'Rate',
  'footer.err': 'Err',

  // ── Onboarding / 引导 ──
  'onboard.step1': 'Welcome to the Swarm Console! This is the Hive View.',
  'onboard.step2': 'Each bee represents an AI agent with a unique role.',
  'onboard.step3': 'Colored particles show pheromone signals between agents.',
  'onboard.step4': 'Switch between 6 views using the top tabs or keys 1-6.',
  'onboard.step5': 'Click any bee to inspect it. Press Ctrl+K for search.',
  'onboard.next': 'Next',
  'onboard.prev': 'Previous',
  'onboard.done': 'Start Exploring',
  'onboard.skip': 'Skip',
};
