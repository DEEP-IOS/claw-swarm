/**
 * McpRegistry - discovers and manages MCP tools, resolving per-role permissions.
 * Each role has a set of allowed tool categories; tools are filtered accordingly.
 */
export class McpRegistry {
  constructor(config = {}) {
    this._tools = []; // discovered MCP tools: { name, schema, provider, categories? }
    this._rolePermissions = config.rolePermissions ?? {
      coder: ['*'],
      reviewer: ['read', 'search', 'analyze'],
      scout: ['read', 'search', 'web'],
      architect: ['read', 'search', 'analyze', 'diagram'],
      designer: ['read', 'search', 'design', 'style'],
    };
  }

  /**
   * Discover tools from an app or return stored tools.
   * @param {object} [app] - optional app instance to query for tools
   * @returns {Array<{ name: string, schema: object, provider: string }>}
   */
  discoverTools(app) {
    if (app?.getRegisteredTools) {
      try {
        const discovered = app.getRegisteredTools();
        if (Array.isArray(discovered)) {
          for (const tool of discovered) {
            // Avoid duplicates by name
            if (!this._tools.some(t => t.name === tool.name)) {
              this._tools.push({
                name: tool.name,
                schema: tool.parameters || tool.schema || {},
                provider: tool.provider || 'app',
                categories: tool.categories || [],
              });
            }
          }
        }
      } catch (_) { /* discovery failure is non-fatal */ }
    }
    return [...this._tools];
  }

  /**
   * Register a single MCP tool.
   * @param {{ name: string, parameters?: object, provider?: string, categories?: string[] }} tool
   */
  registerTool(tool) {
    // Replace existing tool with same name
    const idx = this._tools.findIndex(t => t.name === tool.name);
    const entry = {
      name: tool.name,
      schema: tool.parameters || {},
      provider: tool.provider || 'unknown',
      categories: tool.categories || [],
    };

    if (idx >= 0) {
      this._tools[idx] = entry;
    } else {
      this._tools.push(entry);
    }
  }

  /**
   * Unregister a tool by name.
   * @param {string} name
   * @returns {boolean}
   */
  unregisterTool(name) {
    const idx = this._tools.findIndex(t => t.name === name);
    if (idx >= 0) {
      this._tools.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Resolve which MCP tools a role is allowed to use.
   * @param {string} roleId
   * @param {Array<{ name: string, categories?: string[] }>} allMcpTools
   * @returns {Array}
   */
  resolveForRole(roleId, allMcpTools) {
    const perms = this._rolePermissions[roleId]
      || this._rolePermissions.coder
      || ['*'];

    // Wildcard: return all tools
    if (perms.includes('*')) return allMcpTools;

    return allMcpTools.filter(t => {
      return perms.some(p =>
        t.name.includes(p) ||
        (Array.isArray(t.categories) && t.categories.includes(p))
      );
    });
  }

  /**
   * Set permissions for a role.
   * @param {string} roleId
   * @param {string[]} permissions
   */
  setRolePermissions(roleId, permissions) {
    this._rolePermissions[roleId] = permissions;
  }

  /**
   * Return aggregate statistics.
   */
  getStats() {
    return {
      totalTools: this._tools.length,
      roles: Object.keys(this._rolePermissions),
      toolNames: this._tools.map(t => t.name),
    };
  }
}
