import express from 'express';
import { requireAdmin } from '../auth/admin-auth.js';

const ORDER_REFERENCE_PATTERN = /^[A-F0-9]{32}$/i;
const DEFAULT_NOTIFICATION_LIMIT = 25;
const MAX_NOTIFICATION_LIMIT = 100;
const CUSTOMER_POLL_INTERVAL_MS = 2000;

export function recordNotification(database, orderId, eventType, status) {
  if (!['order_created', 'order_status_changed'].includes(eventType)) {
    throw new TypeError('Notification event type is invalid.');
  }
  const result = database
    .prepare(`
      INSERT INTO notification_events (order_id, event_type, status)
      VALUES (?, ?, ?)
    `)
    .run(orderId, eventType, status);
  return Number(result.lastInsertRowid);
}

function findOrderByReference(database, reference) {
  return database
    .prepare(`
      SELECT id, status
      FROM orders
      WHERE order_reference = ?
    `)
    .get(reference);
}

export function getLatestNotificationId(database) {
  return database
    .prepare('SELECT COALESCE(MAX(id), 0) AS latestId FROM notification_events')
    .get().latestId;
}

export function getAdminNotifications(database, afterId, limit) {
  return database
    .prepare(`
      SELECT n.id, n.event_type AS eventType, n.status,
        n.created_at AS createdAt,
        o.order_reference AS orderReference,
        o.customer_full_name AS customerFullName
      FROM notification_events n
      JOIN orders o ON o.id = n.order_id
      WHERE n.id > ?
      ORDER BY n.id
      LIMIT ?
    `)
    .all(afterId, limit);
}

function parseCursor(value, label) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const cursor = Number(value);
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return cursor;
}

export function createAdminNotificationsRouter(database) {
  const router = express.Router();
  router.get('/notifications/latest', requireAdmin, (request, response) => {
    response.json({ latestId: getLatestNotificationId(database) });
  });
  router.get('/notifications', requireAdmin, (request, response) => {
    let afterId;
    try {
      afterId = parseCursor(request.query.afterId, 'afterId');
    } catch (error) {
      return response.status(400).json({
        error: {
          code: 'INVALID_NOTIFICATION_CURSOR',
          message: error.message,
        },
      });
    }

    const limit =
      request.query.limit === undefined
        ? DEFAULT_NOTIFICATION_LIMIT
        : Number(request.query.limit);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAX_NOTIFICATION_LIMIT
    ) {
      return response.status(400).json({
        error: {
          code: 'INVALID_NOTIFICATION_LIMIT',
          message: `Notification limit must be between 1 and ${MAX_NOTIFICATION_LIMIT}.`,
        },
      });
    }
    const notifications = getAdminNotifications(database, afterId, limit);
    return response.json({
      notifications,
      latestId: notifications.at(-1)?.id ?? afterId,
    });
  });
  return router;
}

export function createCustomerNotificationHandler(database) {
  return function customerNotificationHandler(request, response) {
    const reference = request.params.reference;
    if (!ORDER_REFERENCE_PATTERN.test(reference)) {
      return response.status(404).end();
    }
    const order = findOrderByReference(database, reference.toUpperCase());
    if (!order) {
      return response.status(404).end();
    }

    let cursor;
    try {
      cursor = parseCursor(request.get('Last-Event-ID'), 'Last-Event-ID');
    } catch {
      return response.status(400).end();
    }

    response.status(200);
    response.set({
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();

    let closed = false;
    let isPolling = false;
    let lastKnownStatus = order.status;
    const send = (id, status, createdAt, eventType) => {
      response.write(
        `id: ${id}\nevent: order_update\ndata: ${JSON.stringify({
          status,
          createdAt,
          eventType,
        })}\n\n`,
      );
      cursor = id;
      lastKnownStatus = status;
    };

    const latestOrderEvent = database
      .prepare(`
        SELECT id, status, created_at AS createdAt, event_type AS eventType
        FROM notification_events
        WHERE order_id = ?
        ORDER BY id DESC
        LIMIT 1
      `)
      .get(order.id);
    if (cursor === 0 && latestOrderEvent) {
      send(
        latestOrderEvent.id,
        latestOrderEvent.status,
        latestOrderEvent.createdAt,
        latestOrderEvent.eventType,
      );
    }

    const poll = () => {
      if (closed || isPolling) {
        return;
      }
      isPolling = true;
      try {
        const events = database
          .prepare(`
            SELECT id, status, created_at AS createdAt,
              event_type AS eventType
            FROM notification_events
            WHERE order_id = ? AND id > ?
            ORDER BY id
            LIMIT 100
          `)
          .all(order.id, cursor);
        for (const event of events) {
          send(event.id, event.status, event.createdAt, event.eventType);
        }
        const currentOrder = database
          .prepare('SELECT status FROM orders WHERE id = ?')
          .get(order.id);
        if (currentOrder && currentOrder.status !== lastKnownStatus) {
          response.write(
            `event: order_update\ndata: ${JSON.stringify({
              status: currentOrder.status,
              createdAt: new Date().toISOString(),
              eventType: 'order_status_changed',
            })}\n\n`,
          );
          lastKnownStatus = currentOrder.status;
        }
      } catch (error) {
        clearInterval(interval);
        if (!closed) {
          console.error('Customer notification stream failed:', error);
          response.destroy();
        }
      } finally {
        isPolling = false;
      }
    };
    const interval = setInterval(poll, CUSTOMER_POLL_INTERVAL_MS);
    interval.unref?.();
    const heartbeat = setInterval(() => {
      if (!closed) {
        response.write(': keep-alive\n\n');
      }
    }, 15000);
    heartbeat.unref?.();
    response.on('close', () => {
      closed = true;
      clearInterval(interval);
      clearInterval(heartbeat);
    });
    return undefined;
  };
}

export { DEFAULT_NOTIFICATION_LIMIT, MAX_NOTIFICATION_LIMIT };
