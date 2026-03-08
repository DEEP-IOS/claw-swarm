/**
 * ZoneRepository — Zone 治理分区数据访问 / Zone Governance Data Access
 *
 * 管理 zones + zone_memberships 表。
 * Manages zones + zone_memberships tables.
 *
 * @module L1-infrastructure/database/repositories/zone-repo
 * @author DEEP-IOS
 */

export class ZoneRepository {
  constructor(dbManager) {
    this.db = dbManager;
  }

  // ━━━ Zones ━━━

  createZone({ id, name, description, techStack, leaderId, config }) {
    const zoneId = id || this.db.generateId('zone');
    const now = Date.now();
    const stmt = this.db.prepare('zone_create', `
      INSERT INTO zones (id, name, description, tech_stack, leader_id, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      zoneId, name, description || null,
      techStack ? JSON.stringify(techStack) : null,
      leaderId || null,
      config ? JSON.stringify(config) : null,
      now, now,
    );
    return zoneId;
  }

  getZone(id) {
    const row = this.db.get('SELECT * FROM zones WHERE id = ?', id);
    return row ? this._parseZone(row) : null;
  }

  getZoneByName(name) {
    const row = this.db.get('SELECT * FROM zones WHERE name = ?', name);
    return row ? this._parseZone(row) : null;
  }

  listZones() {
    return this.db.all('SELECT * FROM zones ORDER BY name').map(r => this._parseZone(r));
  }

  updateZone(id, updates) {
    const sets = [];
    const values = [];

    if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
    if (updates.description !== undefined) { sets.push('description = ?'); values.push(updates.description); }
    if (updates.techStack !== undefined) { sets.push('tech_stack = ?'); values.push(JSON.stringify(updates.techStack)); }
    if (updates.leaderId !== undefined) { sets.push('leader_id = ?'); values.push(updates.leaderId); }
    if (updates.config !== undefined) { sets.push('config = ?'); values.push(JSON.stringify(updates.config)); }

    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    this.db.run(`UPDATE zones SET ${sets.join(', ')} WHERE id = ?`, ...values);
  }

  deleteZone(id) {
    this.db.transaction(() => {
      this.db.run('DELETE FROM zone_memberships WHERE zone_id = ?', id);
      this.db.run('DELETE FROM zones WHERE id = ?', id);
    });
  }

  // ━━━ Memberships ━━━

  addMember(zoneId, agentId, role = 'member') {
    this.db.run(
      'INSERT OR REPLACE INTO zone_memberships (zone_id, agent_id, role, joined_at) VALUES (?, ?, ?, ?)',
      zoneId, agentId, role, Date.now(),
    );
  }

  removeMember(zoneId, agentId) {
    this.db.run('DELETE FROM zone_memberships WHERE zone_id = ? AND agent_id = ?', zoneId, agentId);
  }

  getMembers(zoneId) {
    return this.db.all(
      'SELECT * FROM zone_memberships WHERE zone_id = ? ORDER BY joined_at ASC',
      zoneId,
    );
  }

  getMemberCount(zoneId) {
    const row = this.db.get(
      'SELECT COUNT(*) as count FROM zone_memberships WHERE zone_id = ?', zoneId,
    );
    return row ? row.count : 0;
  }

  getAgentZones(agentId) {
    return this.db.all(
      `SELECT z.*, zm.role as member_role, zm.joined_at
       FROM zones z JOIN zone_memberships zm ON z.id = zm.zone_id
       WHERE zm.agent_id = ?`,
      agentId,
    ).map(r => ({ ...this._parseZone(r), memberRole: r.member_role, joinedAt: r.joined_at }));
  }

  updateMemberRole(zoneId, agentId, role) {
    this.db.run(
      'UPDATE zone_memberships SET role = ? WHERE zone_id = ? AND agent_id = ?',
      role, zoneId, agentId,
    );
  }

  // ━━━ Internal ━━━

  _parseZone(row) {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      techStack: row.tech_stack ? JSON.parse(row.tech_stack) : null,
      leaderId: row.leader_id,
      config: row.config ? JSON.parse(row.config) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
