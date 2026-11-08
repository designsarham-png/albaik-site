import express from 'express';

const ORDER_REFERENCE_PATTERN = /^[A-F0-9]{32}$/;

export function getCustomerOrderTracking(database, reference) {
  if (!ORDER_REFERENCE_PATTERN.test(reference)) {
    return null;
  }
  const order = database
    .prepare(`
      SELECT id, order_reference AS orderReference, status,
        fulfillment_type AS fulfillmentType,
        payment_method AS paymentMethod,
        subtotal_cents AS subtotalCents,
        delivery_fee_cents AS deliveryFeeCents,
        total_cents AS totalCents,
        created_at AS createdAt
      FROM orders
      WHERE order_reference = ?
    `)
    .get(reference);
  if (!order) {
    return null;
  }
  const { id, ...publicOrder } = order;

  const items = database
    .prepare(`
      SELECT id, product_name AS productName,
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
      SELECT status, created_at AS createdAt
      FROM order_status_history
      WHERE order_id = ?
      ORDER BY created_at, rowid
    `)
    .all(order.id);
  const restaurant = database
    .prepare(`
      SELECT name, currency, primary_color AS primaryColor,
        secondary_color AS secondaryColor
      FROM restaurants
      LIMIT 1
    `)
    .get();

  return {
    order: { ...publicOrder, items, statusHistory },
    restaurant: {
      name: restaurant.name,
      currency: restaurant.currency,
      brandColors: {
        primary: restaurant.primaryColor,
        secondary: restaurant.secondaryColor,
      },
    },
  };
}

export function createCustomerTrackingRouter(database) {
  const router = express.Router();
  router.get('/orders/:reference', (request, response) => {
    response.set('Cache-Control', 'no-store');
    const tracking = getCustomerOrderTracking(
      database,
      request.params.reference.toUpperCase(),
    );
    if (!tracking) {
      return response.status(404).json({
        error: {
          code: 'ORDER_NOT_FOUND',
          message: 'No order was found for this tracking reference.',
        },
      });
    }
    return response.json(tracking);
  });
  return router;
}
