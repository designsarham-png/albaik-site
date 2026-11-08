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

function makeOrder(database) {
  return createOrder(
    database,
    {
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
    },
    'notifications-test-key',
  );
}

async function withNotificationServer(run) {
  const directory = await mkdtemp(join(tmpdir(), 'restaurant-notifications-'));
  const database = await openDatabase(join(directory, 'notifications.sqlite'));
  importRestaurantConfig(database, structuredClone(demoConfiguration));
  const app = createApp(database, {
    allowedOrigins: [],
    sessionSecret: 'test-session-secret-with-more-than-32-characters',
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await run({
      app,
      database,
      baseUrl: `http://127.0.0.1:${server.address().port}`,
    });
  } finally {
    app.locals.adminSessionStore.close();
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test('streams only order status updates to a customer holding the order reference', async () => {
  await withNotificationServer(async ({ database, baseUrl }) => {
    const order = makeOrder(database);
    const controller = new AbortController();
    const response = await fetch(
      `${baseUrl}/api/orders/${order.orderReference}/events`,
      { signal: controller.signal },
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.match(response.headers.get('cache-control'), /no-cache/);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      const initial = decoder.decode((await reader.read()).value);
      assert.match(initial, /event: order_update/);
      assert.match(initial, /"status":"pending"/);
      assert.doesNotMatch(initial, /Alex Customer|\+1 \(555\)/);

      updateOrderStatus(database, order.id, 'packed', '', null);
      const changed = await Promise.race([
        reader.read(),
        new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Timed out waiting for a status update.')),
            5000,
          );
          timeout.unref?.();
        }),
      ]);
      const update = decoder.decode(changed.value);
      assert.match(update, /"status":"packed"/);
      assert.doesNotMatch(update, /Alex Customer|\+1 \(555\)/);
    } finally {
      await reader.cancel();
      controller.abort();
    }

    const invalidReference = await fetch(
      `${baseUrl}/api/orders/not-a-valid-reference/events`,
    );
    assert.equal(invalidReference.status, 404);
  });
});
