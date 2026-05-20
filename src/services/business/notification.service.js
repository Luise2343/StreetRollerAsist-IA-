// src/services/business/notification.service.js
import { notificationRepository } from '../../repositories/notification.repository.js';
import { sendPushToTenant } from '../push.service.js';
import { logger } from '../../config/logger.js';

export const notificationService = {
  /**
   * Create a notification and optionally send push notification.
   * @param {number} tenantId
   * @param {object} notification - { type, title, body, severity, data, targetUserId }
   * @param {boolean} sendPush - whether to send push notification (default: true)
   * @returns {Promise<object>} Created notification
   */
  async notify(tenantId, { type, title, body, severity = 'info', data = {}, targetUserId = null }, sendPush = true) {
    try {
      const created = await notificationRepository.create(tenantId, {
        type,
        title,
        body,
        severity,
        data,
        targetUserId
      });

      if (sendPush) {
        try {
          await sendPushToTenant(tenantId, {
            title,
            body,
            tag: `notification-${created.id}`,
            data: {
              notificationId: created.id,
              type,
              ...data
            }
          });
        } catch (pushErr) {
          logger.warn({
            action: 'notification_push_failed',
            tenantId,
            notificationId: created.id,
            error: pushErr.message
          });
          // Don't fail the notification creation if push fails
        }
      }

      return created;
    } catch (err) {
      logger.error({
        action: 'notification_create_failed',
        tenantId,
        error: err.message,
        type,
        title
      });
      throw err;
    }
  },

  /**
   * List notifications with filtering and pagination.
   * @param {number} tenantId
   * @param {object} options - { limit, offset, unreadOnly, type, targetUserId }
   * @returns {Promise<object>} { notifications: [], total: number }
   */
  async list(tenantId, options = {}) {
    return notificationRepository.list(tenantId, options);
  },

  /**
   * Get unread notification count.
   * @param {number} tenantId
   * @param {string} targetUserId - optional
   * @returns {Promise<number>}
   */
  async unreadCount(tenantId, targetUserId = null) {
    return notificationRepository.unreadCount(tenantId, targetUserId);
  },

  /**
   * Mark a notification as read.
   * @param {number} tenantId
   * @param {number} notificationId
   * @returns {Promise<object|null>}
   */
  async markRead(tenantId, notificationId) {
    return notificationRepository.markRead(tenantId, notificationId);
  },

  /**
   * Mark all unread notifications as read.
   * @param {number} tenantId
   * @param {string} targetUserId - optional
   * @returns {Promise<number>} Count of updated notifications
   */
  async markAllRead(tenantId, targetUserId = null) {
    return notificationRepository.markAllRead(tenantId, targetUserId);
  },

  /**
   * Get a notification by ID.
   * @param {number} tenantId
   * @param {number} notificationId
   * @returns {Promise<object|null>}
   */
  async findById(tenantId, notificationId) {
    return notificationRepository.findById(tenantId, notificationId);
  }
};
