// src/repositories/notification.repository.js
import { pool } from '../config/db.js';

export const notificationRepository = {
  /**
   * Create a new notification.
   * @param {number} tenantId
   * @param {object} notification - { type, title, body, severity, data, targetUserId }
   * @returns {Promise<object>} Created notification with camelCase keys
   */
  async create(tenantId, { type, title, body, severity = 'info', data = {}, targetUserId = null }) {
    const { rows } = await pool.query(
      `INSERT INTO notification (tenant_id, target_user_id, type, severity, title, body, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, tenant_id AS "tenantId", target_user_id AS "targetUserId",
                 type, severity, title, body, data, read_at AS "readAt",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [tenantId, targetUserId, type, severity, title, body, JSON.stringify(data)]
    );
    return rows[0];
  },

  /**
   * List notifications for a tenant with optional filtering.
   * @param {number} tenantId
   * @param {object} options - { limit, offset, unreadOnly, type, targetUserId }
   * @returns {Promise<object>} { notifications: [], total: number }
   */
  async list(
    tenantId,
    {
      limit = 20,
      offset = 0,
      unreadOnly = false,
      type = null,
      targetUserId = null
    } = {}
  ) {
    let whereClause = 'WHERE tenant_id = $1';
    const params = [tenantId];
    let paramIndex = 2;

    if (unreadOnly) {
      whereClause += ' AND read_at IS NULL';
    }

    if (type) {
      whereClause += ` AND type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (targetUserId) {
      whereClause += ` AND target_user_id = $${paramIndex}`;
      params.push(targetUserId);
      paramIndex++;
    }

    params.push(limit);
    params.push(offset);

    const countResult = await pool.query(`SELECT COUNT(*) as count FROM notification ${whereClause}`, params.slice(0, paramIndex - 2));
    const total = parseInt(countResult.rows[0].count, 10);

    const { rows } = await pool.query(
      `SELECT id, tenant_id AS "tenantId", target_user_id AS "targetUserId",
              type, severity, title, body, data, read_at AS "readAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM notification
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    return {
      notifications: rows,
      total
    };
  },

  /**
   * Get unread notification count for a tenant (and optionally a user).
   * @param {number} tenantId
   * @param {string} targetUserId - optional
   * @returns {Promise<number>} Count of unread notifications
   */
  async unreadCount(tenantId, targetUserId = null) {
    let query = 'SELECT COUNT(*) as count FROM notification WHERE tenant_id = $1 AND read_at IS NULL';
    const params = [tenantId];

    if (targetUserId) {
      query += ' AND target_user_id = $2';
      params.push(targetUserId);
    }

    const { rows } = await pool.query(query, params);
    return parseInt(rows[0].count, 10);
  },

  /**
   * Mark a single notification as read.
   * @param {number} tenantId
   * @param {number} notificationId
   * @returns {Promise<object|null>} Updated notification or null if not found
   */
  async markRead(tenantId, notificationId) {
    const { rows } = await pool.query(
      `UPDATE notification
       SET read_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, tenant_id AS "tenantId", target_user_id AS "targetUserId",
                 type, severity, title, body, data, read_at AS "readAt",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [notificationId, tenantId]
    );
    return rows[0] ?? null;
  },

  /**
   * Mark all unread notifications as read for a tenant (and optionally a user).
   * @param {number} tenantId
   * @param {string} targetUserId - optional
   * @returns {Promise<number>} Count of updated notifications
   */
  async markAllRead(tenantId, targetUserId = null) {
    let query = 'UPDATE notification SET read_at = NOW(), updated_at = NOW() WHERE tenant_id = $1 AND read_at IS NULL';
    const params = [tenantId];

    if (targetUserId) {
      query += ' AND target_user_id = $2';
      params.push(targetUserId);
    }

    const result = await pool.query(query, params);
    return result.rowCount;
  },

  /**
   * Get a single notification by ID.
   * @param {number} tenantId
   * @param {number} notificationId
   * @returns {Promise<object|null>} Notification or null if not found
   */
  async findById(tenantId, notificationId) {
    const { rows } = await pool.query(
      `SELECT id, tenant_id AS "tenantId", target_user_id AS "targetUserId",
              type, severity, title, body, data, read_at AS "readAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM notification
       WHERE id = $1 AND tenant_id = $2`,
      [notificationId, tenantId]
    );
    return rows[0] ?? null;
  }
};
