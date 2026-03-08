# Security Policy / 安全策略

## Supported Versions / 支持的版本

| Version | Supported |
|---------|-----------|
| 5.0.x   | Yes       |
| < 5.0   | No        |

## Reporting a Vulnerability / 报告漏洞

If you discover a security vulnerability, please report it responsibly:
如果你发现安全漏洞，请负责任地报告：

1. **Do NOT** open a public issue / **不要**开公开 issue
2. Email: security@deep-ios.dev (or open a private security advisory on GitHub)
3. Include / 请提供:
   - Description of the vulnerability / 漏洞描述
   - Steps to reproduce / 复现步骤
   - Potential impact / 潜在影响
   - Suggested fix (if any) / 建议修复方案（如有）

We will respond within 48 hours and aim to release a fix within 7 days for critical issues.
我们将在 48 小时内回复，关键问题将在 7 天内发布修复。

## Security Considerations / 安全注意事项

- **Database**: SQLite files contain agent state and task data. Protect `.db` files with appropriate filesystem permissions.
- **Dashboard**: The L6 dashboard (port 19100) binds to `0.0.0.0` by default. In production, use a reverse proxy or bind to `localhost`.
- **No credentials**: Claw-Swarm never stores API keys, tokens, or credentials. All LLM calls go through OpenClaw's gateway.
