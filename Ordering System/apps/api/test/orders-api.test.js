import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { importRestaurantConfig } from '../src/database/catalog.js';
import { openDatabase } from '../src/database/database.js';

const demoConfigurationPath = fileURLToPath(
  new URL(
    '../../../packages/restaurant-configuration/examples/demo-restaurant.json',
    import.meta.url,
  ),
);
const demoConfiguration = JSON.parse(
  await readFile(demoConfigurationPath, 'utf8'),
);
const testAppOptions = {
  allowedOrigins: [],
  sessionSecret: 'test-session-secret-with-more-than-32-characters',
};

async function withConfiguredApp(run) {
  const directory = await mkdtemp(join(tmpdir(), 'restaurant-orders-'));
  const database = await openDatabase(join(directory, 'orders.sqlite'));
  importRestaurantConfig(database, structuredClone(demoConfiguration));
  const app = createApp(database, testAppOptions);
  try {
    await run({ app, database });
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function request(app, body, idempotencyKey = 'test-key-0001') {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/orders`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: JSON.stringify(body),
      },
    );
    return {
      status: response.status,
      body: await response.json(),
    };
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function validOrder(overrides = {}) {
  return {
    customer: {
      fullName: 'Alex Customer',
      phone: '+1 (555) 234-5678',
    },
    fulfillmentType: 'delivery',
    deliveryAddress: '123 Example Street, Sample City',
    deliveryInstructions: 'Ring the bell.',
    paymentMethod: 'cash_on_delivery',
    items: [
      {
        productId: 'garden-sandwich',
        quantity: 2,
        selectedChoiceIds: ['whole-grain'],
      },
    ],
    ...overrides,
  };
}

test('creates an order using database prices and the configured delivery fee', async () => {
  await withConfiguredApp(async ({ app, database }) => {
    const result = await request(
      app,
      validOrder({
        items: [
          {
            productId: 'garden-sandwich',
            quantity: 2,
            selectedChoiceIds: ['whole-grain'],
            priceCents: 1,
            unitPriceCents: 1,
            lineTotalCents: 2,
          },
        ],
        subtotalCents: 2,
        totalCents: 3,
      }),
    );

    assert.equal(result.status, 201);
    assert.equal(result.body.order.status, 'pending');
    assert.equal(result.body.order.subtotalCents, 1800);
    assert.equal(result.body.order.deliveryFeeCents, 250);
    assert.equal(result.body.order.totalCents, 2050);
    assert.match(result.body.order.orderReference, /^[A-F0-9]{32}$/);
    assert.equal('customer' in result.body.order, false);

    const storedOrder = database
      .prepare(`
        SELECT customer_full_name AS fullName, customer_phone AS phone
        FROM orders
        WHERE id = ?
      `)
      .get(result.body.order.id);
    assert.equal(storedOrder.fullName, 'Alex Customer');
    assert.equal(storedOrder.phone, '+1 (555) 234-5678');
    assert.equal(
      database
        .prepare('SELECT COUNT(*) AS count FROM order_items WHERE order_id = ?')
        .get(result.body.order.id).count,
      1,
    );
    assert.equal(
      database
        .prepare(
          "SELECT status FROM order_status_history WHERE order_id = ?",
        )
        .get(result.body.order.id).status,
      'pending',
    );
    assert.equal(
      database
        .prepare(
          "SELECT event_type FROM notification_events WHERE order_id = ?",
        )
        .get(result.body.order.id).event_type,
      'order_created',
    );
  });
});

test('calculates pickup totals without a delivery fee', async () => {
  await withConfiguredApp(async ({ app }) => {
    const order = validOrder({
      fulfillmentType: 'pickup',
      deliveryAddress: null,
      deliveryInstructions: '',
    });
    const result = await request(app, order, 'pickup-key-0001');

    assert.equal(result.status, 201);
    assert.equal(result.body.order.fulfillmentType, 'pickup');
    assert.equal(result.body.order.subtotalCents, 1800);
    assert.equal(result.body.order.deliveryFeeCents, 0);
    assert.equal(result.body.order.totalCents, 1800);
  });
});

test('returns the original order for an idempotent retry and rejects key reuse', async () => {
  await withConfiguredApp(async ({ app, database }) => {
    const body = validOrder();
    const first = await request(app, body, 'retry-key-0001');
    const retry = await request(app, body, 'retry-key-0001');
    const changed = await request(
      app,
      validOrder({
        customer: { ...body.customer, fullName: 'Different Person' },
      }),
      'retry-key-0001',
    );

    assert.equal(first.status, 201);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.order.replayed, true);
    assert.equal(
      retry.body.order.orderReference,
      first.body.order.orderReference,
    );
    assert.equal(changed.status, 409);
    assert.equal(changed.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM orders').get().count,
      1,
    );
    assert.equal(
      database
        .prepare('SELECT COUNT(*) AS count FROM notification_events')
        .get().count,
      1,
    );
  });
});

test('validates customer, address, payment, minimum, products, and options', async () => {
  await withConfiguredApp(async ({ app }) => {
    const invalidCases = [
      [
        validOrder({ customer: { fullName: 'Alex', phone: '12' } }),
        'Enter a valid phone number.',
        400,
      ],
      [
        validOrder({ deliveryAddress: 'short' }),
        'Delivery address must be between 8 and 500 characters.',
        400,
      ],
      [
        validOrder({ paymentMethod: 'credit_card' }),
        'This payment method is not currently available.',
        400,
      ],
      [
        validOrder({
          items: [
            {
              productId: 'crispy-potatoes',
              quantity: 1,
              selectedChoiceIds: [],
            },
          ],
        }),
        'The minimum order is 1000 cents.',
        400,
      ],
      [
        validOrder({
          items: [
            {
              productId: 'garden-sandwich',
              quantity: 1,
              selectedChoiceIds: [],
            },
          ],
        }),
        'Choose valid options for Garden Sandwich.',
        400,
      ],
      [
        validOrder({
          items: [
            {
              productId: 'not-a-product',
              quantity: 1,
              selectedChoiceIds: [],
            },
          ],
        }),
        'Item 1 is unavailable. Refresh the menu and try again.',
        409,
      ],
    ];

    for (const [index, [body, expectedMessage, expectedStatus]] of invalidCases.entries()) {
      const result = await request(app, body, `invalid-key-${index}`);
      assert.equal(result.status, expectedStatus);
      assert.equal(result.body.error.message, expectedMessage);
    }

    const noKey = await request(app, validOrder(), null);
    assert.equal(noKey.status, 400);
    assert.equal(noKey.body.error.code, 'INVALID_IDEMPOTENCY_KEY');
  });
});
