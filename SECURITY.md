# Security Policy / 安全策略

## Supported Versions / 支持的版本

| Version / 版本 | Supported / 是否支持 |
|----------------|---------------------|
| 7.0.x          | Yes / 是             |
| 6.0.x          | Security fixes only / 仅安全修复 |
| 5.0.x          | No / 否              |
| < 5.0          | No / 否              |

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

### Database / 数据库

SQLite files contain agent state, task data, and pheromone signals. Protect `.db` files with appropriate filesystem permissions. The database path defaults to `~/.openclaw/claw-swarm/claw-swarm.db`.

SQLite 文件包含智能体状态、任务数据和信息素信号。请用适当的文件系统权限保护 `.db` 文件。数据库路径默认为 `~/.openclaw/claw-swarm/claw-swarm.db`。

### Dashboard / 监控面板

The L6 monitoring console (port 19100, served by `src/L6-monitoring/dashboard-service.js`) binds to `0.0.0.0` by default. In production, use a reverse proxy or configure it to bind to `127.0.0.1` only.

L6 监控面板（端口 19100，由 `src/L6-monitoring/dashboard-service.js` 提供服务）默认绑定 `0.0.0.0`。生产环境中请使用反向代理或配置为仅绑定 `127.0.0.1`。

### Credentials / 凭据

Claw-Swarm never stores API keys, tokens, or credentials. All LLM calls go through the OpenClaw gateway. The plugin does not make outbound network requests on its own.

Claw-Swarm 不存储 API 密钥、令牌或凭据。所有 LLM 调用通过 OpenClaw 网关进行。插件本身不发起外部网络请求。

### Sub-agent Isolation / 子代理隔离

Sub-agents spawned via `swarm_run` run as separate OpenClaw sessions through the gateway. They inherit the gateway's permission model and do not have filesystem access beyond what the gateway grants.

通过 `swarm_run` 派生的子代理作为独立的 OpenClaw 会话运行。它们继承网关的权限模型，不具有超出网关授权范围的文件系统访问权限。
