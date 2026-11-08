import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { recordNotification } from '../notifications/notifications.js';

const ORDER_LIMITS = {
  items: 50,
  quantity: 50,
  choiceIds: 30,
};

export class OrderRequestError extends Error {
  constructor(message, status = 400, code = 'INVALID_ORDER') {
    super(message);
    this.name = 'OrderRequestError';
    this.status = status;
    this.code = code;
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(value, label, { min = 1, max = 500 } = {}) {
  if (typeof value !== 'string') {
    throw new OrderRequestError(`${label} is required.`);
  }
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw new OrderRequestError(
      `${label} must be between ${min} and ${max} characters.`,
    );
  }
  return text;
}

function normalizeRequest(body) {
  if (!isRecord(body)) {
    throw new OrderRequestError('The order request must be a JSON object.');
  }
  if (!isRecord(body.customer)) {
    throw new OrderRequestError('Customer details are required.');
  }

  const fullName = requiredText(body.customer.fullName, 'Full name', {
    min: 2,
    max: 120,
  });
  const phone = requiredText(body.customer.phone, 'Phone number', {
    min: 1,
    max: 32,
  });
  const phoneDigits = phone.replace(/\D/g, '');
  if (!/^\+?[0-9\s().-]+$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
    throw new OrderRequestError('Enter a valid phone number.');
  }

  if (!['delivery', 'pickup'].includes(body.fulfillmentType)) {
    throw new OrderRequestError('Choose delivery or self-pickup.');
  }
  const deliveryAddress =
    body.fulfillmentType === 'delivery'
      ? requiredText(body.deliveryAddress, 'Delivery address', {
          min: 8,
          max: 500,
        })
      : null;
  const deliveryInstructions =
    body.deliveryInstructions === undefined
      ? ''
      : requiredText(body.deliveryInstructions, 'Delivery instructions', {
          min: 0,
          max: 500,
        });
  const paymentMethod = requiredText(body.paymentMethod, 'Payment method', {
    max: 64,
  });

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new OrderRequestError('Add at least one item to your order.');
  }
  if (body.items.length > ORDER_LIMITS.items) {
    throw new OrderRequestError(
      `An order cannot contain more than ${ORDER_LIMITS.items} different items.`,
    );
  }

  const items = body.items.map((item, index) => {
    if (!isRecord(item)) {
      throw new OrderRequestError(`Order item ${index + 1} is invalid.`);
    }
    const productId = requiredText(item.productId, 'Product ID', {
      max: 128,
    });
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > ORDER_LIMITS.quantity) {
      throw new OrderRequestError(
        `Quantity for item ${index + 1} must be between 1 and ${ORDER_LIMITS.quantity}.`,
      );
    }
    const selectedChoiceIds = item.selectedChoiceIds ?? [];
    if (
      !Array.isArray(selectedChoiceIds) ||
      selectedChoiceIds.length > ORDER_LIMITS.choiceIds ||
      selectedChoiceIds.some(
        (id) => typeof id !== 'string' || id.length === 0 || id.length > 128,
      ) ||
      new Set(selectedChoiceIds).size !== selectedChoiceIds.length
    ) {
      throw new OrderRequestError(
        `Selected options for item ${index + 1} are invalid.`,
      );
    }
    return {
      productId,
      quantity: item.quantity,
      selectedChoiceIds: [...selectedChoiceIds].sort(),
    };
  });

  return {
    customer: { fullName, phone },
    fulfillmentType: body.fulfillmentType,
    deliveryAddress,
    deliveryInstructions,
    paymentMethod,
    items,
  };
}

function hashRequest(request) {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

function createOrderReference(database) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = randomBytes(16).toString('hex').toUpperCase();
    if (
      !database
        .prepare('SELECT 1 FROM orders WHERE order_reference = ?')
        .get(reference)
    ) {
      return reference;
    }
  }
  throw new Error('Could not generate a unique order reference.');
}

function findOrderByKey(database, idempotencyKey) {
  return database
    .prepare(`
      SELECT id, order_reference AS orderReference, request_hash AS requestHash,
        status, fulfillment_type AS fulfillmentType,
        subtotal_cents AS subtotalCents, delivery_fee_cents AS deliveryFeeCents,
        total_cents AS totalCents, created_at AS createdAt
      FROM orders
      WHERE idempotency_key = ?
    `)
    .get(idempotencyKey);
}

function publicOrder(order, replayed = false) {
  return {
    id: order.id,
    orderReference: order.orderReference,
    status: order.status,
    fulfillmentType: order.fulfillmentType,
    subtotalCents: order.subtotalCents,
    deliveryFeeCents: order.deliveryFeeCents,
    totalCents: order.totalCents,
    createdAt: order.createdAt,
    replayed,
  };
}

function calculateOrderItems(database, request) {
  const productStatement = database.prepare(`
    SELECT p.id, p.name, p.price_cents AS priceCents
    FROM products p
    JOIN categories c
      ON c.restaurant_id = p.restaurant_id AND c.id = p.category_id
    WHERE p.id = ? AND p.restaurant_id = ? AND p.available = 1 AND c.active = 1
  `);
  const optionsStatement = database.prepare(`
    SELECT id, name, selection_type AS selectionType, required,
      min_selections AS minSelections, max_selections AS maxSelections
    FROM product_options
    WHERE restaurant_id = ? AND product_id = ?
  `);
  const choicesStatement = database.prepare(`
    SELECT id, name, price_delta_cents AS priceDeltaCents, available
    FROM product_option_choices
    WHERE restaurant_id = ? AND option_id = ?
  `);
  const restaurantId = database
    .prepare('SELECT id FROM restaurants LIMIT 1')
    .get()?.id;
  if (!restaurantId) {
    throw new OrderRequestError(
      'This restaurant is not configured to accept orders.',
      503,
      'RESTAURANT_NOT_CONFIGURED',
    );
  }

  const orderItems = request.items.map((requestedItem, itemIndex) => {
    const product = productStatement.get(requestedItem.productId, restaurantId);
    if (!product) {
      throw new OrderRequestError(
        `Item ${itemIndex + 1} is unavailable. Refresh the menu and try again.`,
        409,
        'PRODUCT_UNAVAILABLE',
      );
    }

    const options = optionsStatement.all(restaurantId, product.id);
    const selectedIds = new Set(requestedItem.selectedChoiceIds);
    const knownChoices = new Set();
    const selectedOptions = [];
    let unitPriceCents = product.priceCents;

    for (const option of options) {
      const choices = choicesStatement.all(restaurantId, option.id);
      for (const choice of choices) {
        if (knownChoices.has(choice.id)) {
          throw new Error('Catalog contains duplicate option choice IDs.');
        }
        knownChoices.add(choice.id);
      }

      const selectedChoices = choices.filter((choice) =>
        selectedIds.has(choice.id),
      );
      if (selectedChoices.some((choice) => !choice.available)) {
        throw new OrderRequestError(
          `An option for ${product.name} is no longer available.`,
          409,
          'OPTION_UNAVAILABLE',
        );
      }
      if (
        selectedChoices.length < option.minSelections ||
        selectedChoices.length > option.maxSelections
      ) {
        throw new OrderRequestError(
          `Choose valid options for ${product.name}.`,
          400,
          'INVALID_PRODUCT_OPTIONS',
        );
      }

      if (selectedChoices.length > 0) {
        selectedOptions.push({
          optionId: option.id,
          name: option.name,
          choices: selectedChoices.map((choice) => ({
            choiceId: choice.id,
            name: choice.name,
            priceDeltaCents: choice.priceDeltaCents,
          })),
        });
        for (const choice of selectedChoices) {
          unitPriceCents += choice.priceDeltaCents;
          if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) {
            throw new Error('Catalog has an invalid configured product price.');
          }
        }
      }
    }

    for (const choiceId of selectedIds) {
      if (!knownChoices.has(choiceId)) {
        throw new OrderRequestError(
          `An option for ${product.name} is invalid. Refresh the menu and try again.`,
          400,
          'INVALID_PRODUCT_OPTIONS',
        );
      }
    }

    const lineTotalCents = unitPriceCents * requestedItem.quantity;
    if (!Number.isSafeInteger(lineTotalCents)) {
      throw new OrderRequestError('The order total is too large.');
    }
    return {
      id: randomUUID(),
      productId: product.id,
      productName: product.name,
      unitPriceCents,
      quantity: requestedItem.quantity,
      lineTotalCents,
      selectedOptions,
    };
  });

  const subtotalCents = orderItems.reduce(
    (total, item) => total + item.lineTotalCents,
    0,
  );
  if (!Number.isSafeInteger(subtotalCents)) {
    throw new OrderRequestError('The order total is too large.');
  }
  return { orderItems, subtotalCents, restaurantId };
}

export function createOrder(database, body, idempotencyKey) {
  const request = normalizeRequest(body);
  if (
    typeof idempotencyKey !== 'string' ||
    !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)
  ) {
    throw new OrderRequestError(
      'A valid Idempotency-Key header is required.',
      400,
      'INVALID_IDEMPOTENCY_KEY',
    );
  }

  const requestHash = hashRequest(request);
  const existingOrder = findOrderByKey(database, idempotencyKey);
  if (existingOrder) {
    if (existingOrder.requestHash !== requestHash) {
      throw new OrderRequestError(
        'This idempotency key was already used for a different order.',
        409,
        'IDEMPOTENCY_KEY_REUSED',
      );
    }
    return publicOrder(existingOrder, true);
  }

  const settings = database
    .prepare(`
      SELECT delivery_fee_cents AS deliveryFeeCents,
        minimum_order_cents AS minimumOrderCents,
        payment_methods_json AS paymentMethods
      FROM restaurant_settings
      LIMIT 1
    `)
    .get();
  if (!settings) {
    throw new OrderRequestError(
      'This restaurant is not configured to accept orders.',
      503,
      'RESTAURANT_NOT_CONFIGURED',
    );
  }

  let paymentMethods;
  try {
    paymentMethods = JSON.parse(settings.paymentMethods);
  } catch (error) {
    throw new Error('Restaurant payment configuration is invalid.', {
      cause: error,
    });
  }
  if (!Array.isArray(paymentMethods)) {
    throw new Error('Restaurant payment configuration must be a list.');
  }
  if (
    request.paymentMethod !== 'cash_on_delivery' ||
    !paymentMethods.includes(request.paymentMethod)
  ) {
    throw new OrderRequestError(
      'This payment method is not currently available.',
      400,
      'PAYMENT_METHOD_UNAVAILABLE',
    );
  }

  const { orderItems, subtotalCents } = calculateOrderItems(database, request);
  if (subtotalCents < settings.minimumOrderCents) {
    throw new OrderRequestError(
      `The minimum order is ${settings.minimumOrderCents} cents.`,
      400,
      'MINIMUM_ORDER_NOT_MET',
    );
  }
  const deliveryFeeCents =
    request.fulfillmentType === 'delivery' ? settings.deliveryFeeCents : 0;
  const totalCents = subtotalCents + deliveryFeeCents;
  if (!Number.isSafeInteger(totalCents)) {
    throw new OrderRequestError('The order total is too large.');
  }

  const order = {
    id: randomUUID(),
    orderReference: createOrderReference(database),
    idempotencyKey,
    requestHash,
    request,
    orderItems,
    subtotalCents,
    deliveryFeeCents,
    totalCents,
  };

  const insertOrder = database.prepare(`
    INSERT INTO orders (
      id, order_reference, idempotency_key, request_hash,
      customer_full_name, customer_phone, fulfillment_type,
      delivery_address, delivery_instructions, payment_method,
      subtotal_cents, delivery_fee_cents, total_cents
    ) VALUES (
      @id, @orderReference, @idempotencyKey, @requestHash,
      @fullName, @phone, @fulfillmentType, @deliveryAddress,
      @deliveryInstructions, @paymentMethod, @subtotalCents,
      @deliveryFeeCents, @totalCents
    )
  `);
  const insertItem = database.prepare(`
    INSERT INTO order_items (
      id, order_id, product_id, product_name, unit_price_cents, quantity,
      line_total_cents, selected_options_json
    ) VALUES (
      @id, @orderId, @productId, @productName, @unitPriceCents, @quantity,
      @lineTotalCents, @selectedOptions
    )
  `);
  const insertHistory = database.prepare(`
    INSERT INTO order_status_history (id, order_id, status, note)
    VALUES (?, ?, 'pending', 'Order received')
  `);
  const saveOrder = database.transaction(() => {
    insertOrder.run({
      id: order.id,
      orderReference: order.orderReference,
      idempotencyKey: order.idempotencyKey,
      requestHash: order.requestHash,
      fullName: request.customer.fullName,
      phone: request.customer.phone,
      fulfillmentType: request.fulfillmentType,
      deliveryAddress: request.deliveryAddress,
      deliveryInstructions: request.deliveryInstructions,
      paymentMethod: request.paymentMethod,
      subtotalCents,
      deliveryFeeCents,
      totalCents,
    });
    for (const item of orderItems) {
      insertItem.run({
        ...item,
        orderId: order.id,
        selectedOptions: JSON.stringify(item.selectedOptions),
      });
    }
    insertHistory.run(randomUUID(), order.id);
    recordNotification(database, order.id, 'order_created', 'pending');
  });
  try {
    saveOrder();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const concurrentOrder = findOrderByKey(database, idempotencyKey);
      if (concurrentOrder) {
        if (concurrentOrder.requestHash !== requestHash) {
          throw new OrderRequestError(
            'This idempotency key was already used for a different order.',
            409,
            'IDEMPOTENCY_KEY_REUSED',
          );
        }
        return publicOrder(concurrentOrder, true);
      }
    }
    throw error;
  }

  return publicOrder({
    ...order,
    status: 'pending',
    fulfillmentType: request.fulfillmentType,
    createdAt: database
      .prepare('SELECT created_at AS createdAt FROM orders WHERE id = ?')
      .get(order.id).createdAt,
  });
}
