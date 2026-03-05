# Security Policy / 安全策略

## Supported Versions / 支持的版本

| Version / 版本 | Supported / 是否支持 |
|----------------|---------------------|
| 9.0.x          | Yes / 是             |
| 8.2.x          | Security fixes only / 仅安全修复 |
| 7.0.x          | No / 否              |
| < 7.0          | No / 否              |

## Reporting a Vulnerability / 报告漏洞

If you discover a security vulnerability, please report it responsibly.
如果你发现安全漏洞，请负责任地报告。

**Do NOT open a public issue. / 不要开公开 issue。**

### Process / 流程

1. **Email**: security@deep-ios.dev (or open a private security advisory on GitHub)
   **邮箱**：security@deep-ios.dev（或在 GitHub 上提交私密安全公告）

2. Include the following / 请提供以下信息:
   - Description of the vulnerability / 漏洞描述
   - Steps to reproduce / 复现步骤
   - Potential impact / 潜在影响
   - Affected version(s) / 受影响的版本
   - Suggested fix, if any / 建议修复方案（如有）

3. **Response timeline / 响应时间线**:
   - Acknowledgment within 48 hours / 48 小时内确认收到
   - Critical issues: fix within 7 days / 关键问题：7 天内发布修复
   - Non-critical issues: fix within 30 days / 非关键问题：30 天内发布修复

## Security Considerations / 安全注意事项

### Data Storage / 数据存储

V9.0 uses an in-memory DomainStore with JSON snapshot persistence. Snapshot files are stored at `~/.openclaw/claw-swarm/snapshots/`. Protect snapshot directories with appropriate filesystem permissions.

V9.0 使用内存域存储（DomainStore）配合 JSON 快照持久化。快照文件存储在 `~/.openclaw/claw-swarm/snapshots/`。请用适当的文件系统权限保护快照目录。

### Dashboard / 监控面板

The observe domain's DashboardService (port 19100, served by `src/observe/dashboard/dashboard-service.js`) binds to `127.0.0.1` by default. In production, ensure the dashboard port is not exposed to untrusted networks.

观测域的 DashboardService（端口 19100，由 `src/observe/dashboard/dashboard-service.js` 提供服务）默认绑定 `127.0.0.1`。生产环境中请确保仪表盘端口不暴露给不受信任的网络。

### Credentials / 凭据

Claw-Swarm never stores API keys, tokens, or credentials. All LLM calls go through the OpenClaw gateway. The plugin does not make outbound network requests on its own.

Claw-Swarm 不存储 API 密钥、令牌或凭据。所有 LLM 调用通过 OpenClaw 网关进行。插件本身不发起外部网络请求。

### Sub-agent Isolation / 子代理隔离

Sub-agents spawned via `swarm_run` or `swarm_spawn` run as separate OpenClaw sessions through the gateway. They inherit the gateway's permission model and do not have filesystem access beyond what the gateway grants.

通过 `swarm_run` 或 `swarm_spawn` 派生的子代理作为独立的 OpenClaw 会话运行。它们继承网关的权限模型，不具有超出网关授权范围的文件系统访问权限。

### Compliance Monitoring / 合规监控

V9.0 includes a built-in compliance monitor (`src/quality/analysis/compliance-monitor.js`) that enforces four security boundaries: unsafe operations, unauthorized file access, sensitive data leakage, and scope deviation. Violations trigger a three-level escalation: prompt reminder → forced output modification → agent termination.

V9.0 内置合规监控器，执行四条安全边界：不安全操作、越权文件访问、敏感数据泄露和范围偏离。违规触发三级升级：提示提醒→强制修改输出→终止代理。
