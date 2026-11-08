import { randomUUID } from 'node:crypto';
import express from 'express';
import { requireAdmin, requireCsrf } from '../auth/admin-auth.js';
import { recordNotification } from '../notifications/notifications.js';

const ORDER_STATUSES = [
  'pending',
  'packed',
  'delivering',
];

const STATUS_TRANSITIONS = {
  pending: ['packed'],
  packed: ['delivering'],
  delivering: [],
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export class AdminOrderRequestError extends Error {
  constructor(message, status = 400, code = 'INVALID_ORDER_REQUEST') {
    super(message);
    this.name = 'AdminOrderRequestError';
    this.status = status;
    this.code = code;
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapedSearch(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

function getOrderByReference(database, reference) {
  return database
    .prepare(`
      SELECT id, order_reference AS orderReference,
        customer_full_name AS customerFullName,
        customer_phone AS customerPhone,
        fulfillment_type AS fulfillmentType,
        delivery_address AS deliveryAddress,
        delivery_instructions AS deliveryInstructions,
        payment_method AS paymentMethod, status,
        subtotal_cents AS subtotalCents,
        delivery_fee_cents AS deliveryFeeCents,
        total_cents AS totalCents, created_at AS createdAt
      FROM orders
      WHERE order_reference = ?
    `)
    .get(reference);
}

export function getOrderSummary(database) {
  const counts = database
    .prepare('SELECT status, COUNT(*) AS count FROM orders GROUP BY status')
    .all();
  const ordersByStatus = Object.fromEntries(
    ORDER_STATUSES.map((status) => [status, 0]),
  );
  for (const row of counts) {
    ordersByStatus[row.status] = row.count;
  }

  const aggregate = database
    .prepare(`
      SELECT COUNT(*) AS totalOrders,
        COALESCE(SUM(CASE
          WHEN date(created_at) = date('now') THEN 1 ELSE 0
        END), 0) AS todayOrders,
        COALESCE(SUM(total_cents), 0) AS totalSalesCents,
        COALESCE(SUM(CASE
          WHEN date(created_at) = date('now') THEN total_cents ELSE 0
        END), 0) AS todaySalesCents
      FROM orders
    `)
    .get();

  return { ...aggregate, ordersByStatus };
}

export function listOrders(database, query) {
  const status = query.status ?? 'all';
  if (status !== 'all' && !ORDER_STATUSES.includes(status)) {
    throw new AdminOrderRequestError('Choose a valid order status.');
  }
  const search = query.search ?? '';
  if (typeof search !== 'string' || search.length > 100) {
    throw new AdminOrderRequestError(
      'Search text must be 100 characters or fewer.',
    );
  }
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize =
    query.pageSize === undefined ? DEFAULT_PAGE_SIZE : Number(query.pageSize);
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new AdminOrderRequestError('Page must be a positive integer.');
  }
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_PAGE_SIZE
  ) {
    throw new AdminOrderRequestError(
      `Page size must be between 1 and ${MAX_PAGE_SIZE}.`,
    );
  }

  const clauses = [];
  const parameters = [];
  if (status !== 'all') {
    clauses.push('status = ?');
    parameters.push(status);
  }
  if (search.trim()) {
    const term = `%${escapedSearch(search.trim())}%`;
    clauses.push(
      "(order_reference LIKE ? ESCAPE '\\' OR customer_full_name LIKE ? ESCAPE '\\' OR customer_phone LIKE ? ESCAPE '\\')",
    );
    parameters.push(term, term, term);
  }
  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = database
    .prepare(`SELECT COUNT(*) AS count FROM orders ${whereClause}`)
    .get(...parameters).count;
  const orders = database
    .prepare(`
      SELECT id, order_reference AS orderReference,
        customer_full_name AS customerFullName,
        customer_phone AS customerPhone,
        fulfillment_type AS fulfillmentType,
        payment_method AS paymentMethod, status,
        subtotal_cents AS subtotalCents,
        delivery_fee_cents AS deliveryFeeCents,
        total_cents AS totalCents, created_at AS createdAt
      FROM orders
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `)
    .all(...parameters, pageSize, (page - 1) * pageSize);

  return {
    orders,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export function getOrderDetails(database, reference) {
  const order = getOrderByReference(database, reference);
  if (!order) {
    return null;
  }

  const items = database
    .prepare(`
      SELECT id, product_id AS productId, product_name AS productName,
        unit_price_cents AS unitPriceCents, quantity,
        line_total_cents AS lineTotalCents,
        selected_options_json AS selectedOptions
      FROM order_items
      WHERE order_id = ?
      ORDER BY rowid
    `)
    .all(order.id)
    .map((item) => ({
      ...item,
      selectedOptions: JSON.parse(item.selectedOptions),
    }));
  const statusHistory = database
    .prepare(`
      SELECT h.status, h.note, h.created_at AS createdAt,
        u.email AS adminEmail
      FROM order_status_history h
      LEFT JOIN admin_users u ON u.id = h.admin_user_id
      WHERE h.order_id = ?
      ORDER BY h.created_at, h.rowid
    `)
    .all(order.id);

  return { ...order, items, statusHistory };
}

export function updateOrderStatus(
  database,
  orderId,
  requestedStatus,
  note,
  adminUserId,
) {
  if (!ORDER_STATUSES.includes(requestedStatus)) {
    throw new AdminOrderRequestError('Choose a valid order status.');
  }
  if (note !== undefined && (typeof note !== 'string' || note.length > 500)) {
    throw new AdminOrderRequestError(
      'Status note must be 500 characters or fewer.',
    );
  }

  const update = database.transaction(() => {
    const order = database
      .prepare(`
        SELECT id, status
        FROM orders
        WHERE id = ?
      `)
      .get(orderId);
    if (!order) {
      return null;
    }

    if (order.status === requestedStatus) {
      throw new AdminOrderRequestError(
        'The order is already in that status.',
        409,
        'ORDER_STATUS_UNCHANGED',
      );
    }
    if (!STATUS_TRANSITIONS[order.status]?.includes(requestedStatus)) {
      throw new AdminOrderRequestError(
        `An order cannot move from ${order.status} to ${requestedStatus}.`,
        409,
        'INVALID_ORDER_STATUS_TRANSITION',
      );
    }
    database
      .prepare('UPDATE orders SET status = ? WHERE id = ?')
      .run(requestedStatus, orderId);
    database
      .prepare(`
        INSERT INTO order_status_history (
          id, order_id, status, note, admin_user_id
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        orderId,
        requestedStatus,
        note?.trim() ?? '',
        adminUserId,
      );
    recordNotification(
      database,
      orderId,
      'order_status_changed',
      requestedStatus,
    );
    return database
      .prepare(`
        SELECT order_reference AS orderReference, status,
          fulfillment_type AS fulfillmentType
        FROM orders WHERE id = ?
      `)
      .get(orderId);
  });

  return update();
}

export function createAdminOrdersRouter(database) {
  const router = express.Router();

  router.get('/summary', requireAdmin, (request, response) => {
    response.json({ summary: getOrderSummary(database) });
  });

  router.get('/orders', requireAdmin, (request, response) => {
    try {
      return response.json(
        listOrders(database, {
          status: request.query.status,
          search: request.query.search,
          page: request.query.page,
          pageSize: request.query.pageSize,
        }),
      );
    } catch (error) {
      if (error instanceof AdminOrderRequestError) {
        return response.status(error.status).json({
          error: { code: error.code, message: error.message },
        });
      }
      throw error;
    }
  });

  router.get('/orders/:reference', requireAdmin, (request, response) => {
    const order = getOrderDetails(database, request.params.reference);
    if (!order) {
      return response.status(404).json({
        error: {
          code: 'ORDER_NOT_FOUND',
          message: 'No order was found with that reference.',
        },
      });
    }
    return response.json({ order });
  });

  router.patch(
    '/orders/:id/status',
    requireAdmin,
    requireCsrf,
    (request, response) => {
    if (!isRecord(request.body)) {
      return response.status(400).json({
        error: {
          code: 'INVALID_ORDER_REQUEST',
          message: 'Request body must be an object.',
        },
      });
    }
    try {
      const order = updateOrderStatus(
        database,
        request.params.id,
        request.body.status,
        request.body.note,
        request.session.admin.id,
      );
      if (!order) {
        return response.status(404).json({
          error: {
            code: 'ORDER_NOT_FOUND',
            message: 'No order was found with that ID.',
          },
        });
      }
      return response.json({ order });
    } catch (error) {
      if (error instanceof AdminOrderRequestError) {
        return response.status(error.status).json({
          error: { code: error.code, message: error.message },
        });
      }
      throw error;
    }
  });

  return router;
}

export { ORDER_STATUSES, STATUS_TRANSITIONS };
