/**
 * Chinese Translations / 中文翻译
 * @module i18n/zh
 * @author DEEP-IOS
 */
export default {
  // ── Views / 视图 ──
  'view.hive': '蜂巢',
  'view.pipeline': '流水线',
  'view.cognition': '认知',
  'view.ecology': '生态',
  'view.network': '网络',
  'view.control': '控制',

  // ── Header / 顶栏 ──
  'header.title': '蜂群控制台',
  'header.health': '健康度',
  'header.agents': '代理',

  // ── Sidebar / 侧栏 ──
  'sidebar.agents': '代理列表',
  'sidebar.pheromones': '信息素',
  'sidebar.red': 'RED 指标',
  'sidebar.budget': '预算',
  'sidebar.breaker': '断路器',
  'sidebar.shapley': 'Shapley 信用',
  'sidebar.signals': '信号权重',
  'sidebar.pi': 'PI 控制器',

  // ── Agent States / Agent 状态 ──
  'state.ACTIVE': '活跃',
  'state.IDLE': '空闲',
  'state.EXECUTING': '执行中',
  'state.REPORTING': '汇报中',
  'state.RETIRED': '已退役',

  // ── Agent Roles / Agent 角色 ──
  'role.architect': '架构师',
  'role.coder': '编码员',
  'role.reviewer': '审查员',
  'role.scout': '侦察兵',
  'role.guard': '守卫',
  'role.worker': '工蜂',

  // ── ABC Roles ──
  'abc.employed': '雇佣蜂',
  'abc.onlooker': '旁观蜂',
  'abc.scout': '侦察蜂',

  // ── Pheromone Types / 信息素类型 ──
  'phero.trail': '轨迹',
  'phero.alarm': '警报',
  'phero.recruit': '招募',
  'phero.dance': '舞蹈',
  'phero.queen': '蜂王',
  'phero.food': '食物',
  'phero.danger': '危险',

  // ── Task Phases / 任务阶段 ──
  'phase.CFP': '征求提案',
  'phase.BID': '竞标中',
  'phase.EXECUTE': '执行中',
  'phase.QUALITY': '质量门',
  'phase.DONE': '已完成',

  // ── Modulator Modes / 调制器模式 ──
  'mode.EXPLOIT': '利用',
  'mode.EXPLORE': '探索',
  'mode.URGENT': '紧急',
  'mode.RELIABLE': '稳定',

  // ── Breaker States / 断路器状态 ──
  'breaker.CLOSED': '关闭',
  'breaker.OPEN': '打开',
  'breaker.HALF_OPEN': '半开',

  // ── Panel / 面板 ──
  'panel.identity': '身份',
  'panel.currentTask': '当前任务',
  'panel.subAgents': '子代理',
  'panel.reputation': '声誉',
  'panel.capabilities': '能力',
  'panel.history': '历史',
  'panel.compare': '对比',
  'panel.taskFlow': '任务流程',
  'panel.dag': '依赖关系',
  'panel.quality': '质量审计',
  'panel.formula': '公式',

  // ── Notifications / 通知 ──
  'notif.circuitOpen': '断路器打开',
  'notif.recovery': '恢复完成',
  'notif.alarmRising': '警报升高',
  'notif.cfpIssued': 'CFP 发布',
  'notif.taskAwarded': '任务授予',
  'notif.qualityPassed': '质量门通过',
  'notif.qualityFailed': '质量门失败',
  'notif.speciesEvolved': '物种进化',
  'notif.speciesProposed': '物种提议',
  'notif.speciesCulled': '物种淘汰',
  'notif.subAgentSpawned': '子代理孵化',
  'notif.subAgentDone': '子代理完成',
  'notif.anomalyDetected': '异常检测触发',
  'notif.knowledgeTransfer': '知识转移',
  'notif.budgetDegradation': '预算降级',
  'notif.piActuated': 'PI 控制器触发',
  'notif.modeSwitched': '模式切换',
  'notif.dreamConsolidation': '梦境巩固完成',

  // ── Settings / 设置 ──
  'settings.title': '设置',
  'settings.animSpeed': '动画速度',
  'settings.particleDensity': '粒子密度',
  'settings.showTrails': '显示轨迹',
  'settings.showEdges': '显示交互线',
  'settings.showSubAgents': '显示子代理',
  'settings.showFormulas': '显示公式',
  'settings.sound': '声音效果',
  'settings.envParticles': '环境粒子',
  'settings.glitchFx': '故障特效',
  'settings.perfMode': '性能模式',
  'settings.labelMode': '标签语言',
  'settings.colorBlindMode': '色盲模式',
  'settings.reset': '恢复默认',
  'settings.retriggerOnboarding': '重新引导',

  // ── Command Palette / 命令面板 ──
  'cmd.placeholder': '搜索代理、任务、公式...',
  'cmd.agents': '代理',
  'cmd.tasks': '任务',
  'cmd.formulas': '公式',
  'cmd.views': '视图',
  'cmd.noResults': '无结果',

  // ── Timeline / 时间线 ──
  'timeline.title': '事件时间线',
  'timeline.expand': '展开',
  'timeline.collapse': '收起',

  // ── Connection / 连接 ──
  'conn.live': '在线',
  'conn.offline': '离线',
  'conn.connecting': '连接中',

  // ── Freshness / 新鲜度 ──
  'fresh.live': '实时',
  'fresh.recent': '最近',
  'fresh.stale': '陈旧',
  'fresh.disconnected': '断连',

  // ── Footer / 底栏 ──
  'footer.agents': '代理',
  'footer.health': '健康',
  'footer.rate': '速率',
  'footer.err': '错误',

  // ── Onboarding / 引导 ──
  'onboard.step1': '欢迎来到蜂群控制台！这是蜂巢视图。',
  'onboard.step2': '每只蜜蜂代表一个 AI 代理，拥有独特的角色。',
  'onboard.step3': '彩色粒子展示代理之间的信息素信号。',
  'onboard.step4': '使用顶部标签页或按键 1-6 切换 6 个视图。',
  'onboard.step5': '点击任意蜜蜂查看详情。按 Ctrl+K 搜索。',
  'onboard.next': '下一步',
  'onboard.prev': '上一步',
  'onboard.done': '开始探索',
  'onboard.skip': '跳过',
};
