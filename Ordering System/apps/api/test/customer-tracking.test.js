import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { importRestaurantConfig } from '../src/database/catalog.js';
import { openDatabase } from '../src/database/database.js';
import { createOrder } from '../src/database/orders.js';
import { updateOrderStatus } from '../src/database/admin-orders.js';

const demoConfigurationPath = fileURLToPath(
  new URL(
    '../../../packages/restaurant-configuration/examples/demo-restaurant.json',
    import.meta.url,
  ),
);
const demoConfiguration = JSON.parse(
  await readFile(demoConfigurationPath, 'utf8'),
);

test('tracking reference returns order progress and items without customer private data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'restaurant-customer-tracking-'));
  const database = await openDatabase(join(directory, 'tracking.sqlite'));
  importRestaurantConfig(database, structuredClone(demoConfiguration));
  const order = createOrder(
    database,
    {
      customer: {
        fullName: 'Private Customer',
        phone: '+1 (555) 234-5678',
      },
      fulfillmentType: 'delivery',
      deliveryAddress: '123 Private Street, Sample City',
      deliveryInstructions: 'Call when outside.',
      paymentMethod: 'cash_on_delivery',
      items: [
        {
          productId: 'garden-sandwich',
          quantity: 2,
          selectedChoiceIds: ['whole-grain'],
        },
      ],
    },
    'tracking-reference-test',
  );
  updateOrderStatus(database, order.id, 'packed', 'Private admin note.', null);
  const app = createApp(database, {
    allowedOrigins: [],
    sessionSecret: 'test-session-secret-with-more-than-32-characters',
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(
      `${baseUrl}/api/orders/${order.orderReference}`,
    );
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(result.order.orderReference, order.orderReference);
    assert.equal(result.order.status, 'packed');
    assert.equal(result.order.statusHistory.length, 2);
    assert.equal(result.order.items[0].productName, 'Garden Sandwich');
    assert.equal(result.order.items[0].selectedOptions[0].choices[0].name, 'Whole grain');
    assert.equal(result.restaurant.name, 'Sample Kitchen');
    assert.equal(result.restaurant.currency, 'USD');
    assert.equal('customerFullName' in result.order, false);
    assert.equal('customerPhone' in result.order, false);
    assert.equal('deliveryAddress' in result.order, false);
    assert.equal('deliveryInstructions' in result.order, false);
    assert.equal('id' in result.order, false);
    assert.equal('note' in result.order.statusHistory[1], false);
    assert.doesNotMatch(JSON.stringify(result), /Private Customer|Private Street|Private admin note/);

    const invalidReference = await fetch(`${baseUrl}/api/orders/not-a-reference`);
    const unknownReference = await fetch(
      `${baseUrl}/api/orders/${'A'.repeat(32)}`,
    );
    assert.equal(invalidReference.status, 404);
    assert.equal(unknownReference.status, 404);
    assert.equal(
      (await unknownReference.json()).error.code,
      'ORDER_NOT_FOUND',
    );
    const lowercaseReference = await fetch(
      `${baseUrl}/api/orders/${order.orderReference.toLowerCase()}`,
    );
    assert.equal(lowercaseReference.status, 200);
  } finally {
    app.locals.adminSessionStore.close();
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
