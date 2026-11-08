import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createApp } from '../src/app.js';
import {
  createAdminUser,
} from '../src/auth/admin-auth.js';
import { hashAdminPassword } from '../src/auth/passwords.js';
import { importRestaurantConfig } from '../src/database/catalog.js';
import {
  getOrderDetails,
  getOrderSummary,
  listOrders,
  updateOrderStatus,
} from '../src/database/admin-orders.js';
import { openDatabase } from '../src/database/database.js';
import { createOrder } from '../src/database/orders.js';

const sessionSecret = 'test-session-secret-with-more-than-32-characters';
const demoConfigurationPath = fileURLToPath(
  new URL(
    '../../../packages/restaurant-configuration/examples/demo-restaurant.json',
    import.meta.url,
  ),
);
const demoConfiguration = JSON.parse(
  await readFile(demoConfigurationPath, 'utf8'),
);

function makeOrder(database, overrides = {}) {
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
      ...overrides,
    },
    'admin-orders-test-key',
  );
}

async function withDatabase(run) {
  const directory = await mkdtemp(join(tmpdir(), 'restaurant-admin-orders-'));
  const database = await openDatabase(join(directory, 'orders.sqlite'));
  importRestaurantConfig(database, structuredClone(demoConfiguration));
  try {
    await run({ database });
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test('lists and summarizes database orders and includes order snapshots', async () => {
  await withDatabase(async ({ database }) => {
    const created = makeOrder(database);
    const summary = getOrderSummary(database);
    const result = listOrders(database, {
      status: 'pending',
      search: 'Alex Customer',
      page: 1,
      pageSize: 10,
    });
    const details = getOrderDetails(database, created.orderReference);

    assert.equal(summary.totalOrders, 1);
    assert.equal(summary.ordersByStatus.pending, 1);
    assert.equal(summary.ordersByStatus.delivering, 0);
    assert.equal(result.pagination.total, 1);
    assert.equal(result.orders[0].orderReference, created.orderReference);
    assert.equal(details.customerPhone, '+1 (555) 234-5678');
    assert.equal(details.items[0].productName, 'Garden Sandwich');
    assert.equal(details.items[0].selectedOptions[0].choices[0].name, 'Whole grain');
    assert.equal(details.statusHistory[0].status, 'pending');
    assert.equal(getOrderDetails(database, 'missing-reference'), null);
  });
});

test('validates order filters, pagination, and status transitions', async () => {
  await withDatabase(async ({ database }) => {
    const created = makeOrder(database);
    assert.throws(
      () => listOrders(database, { status: 'unknown' }),
      /valid order status/,
    );
    assert.throws(
      () => listOrders(database, { pageSize: 1000 }),
      /Page size must be between/,
    );

    assert.throws(
      () => updateOrderStatus(database, created.id, 'delivering', '', null),
      /cannot move from pending to delivering/,
    );
    const packed = updateOrderStatus(
      database,
      created.id,
      'packed',
      'Confirmed by phone.',
      null,
    );
    assert.equal(packed.status, 'packed');
    assert.throws(
      () => updateOrderStatus(database, created.id, 'packed', '', null),
      /already in that status/,
    );
    assert.equal(
      getOrderDetails(database, created.orderReference).statusHistory.length,
      2,
    );
  });
});

test('protects order APIs and records authorized CSRF-protected status changes', async () => {
  await withDatabase(async ({ database }) => {
    const created = makeOrder(database);
    const admin = await createAdminUser(
      database,
      'OWNER@EXAMPLE.COM',
      'SecureTestPass123!',
      hashAdminPassword,
    );
    const app = createApp(database, {
      allowedOrigins: ['https://admin.example'],
      sessionSecret,
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    async function request(path, init = {}, cookie = '') {
      const headers = new Headers(init.headers);
      if (cookie) {
        headers.set('Cookie', cookie);
      }
      const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
      const contentType = response.headers.get('content-type') ?? '';
      return {
        response,
        body: contentType.includes('application/json')
          ? await response.json()
          : null,
        cookie: response.headers.get('set-cookie')?.split(';')[0] ?? cookie,
      };
    }

    try {
      const unauthorized = await request('/api/admin/summary');
      assert.equal(unauthorized.response.status, 401);

      const csrf = await request('/api/admin/csrf');
      const login = await request(
        '/api/admin/login',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf.body.csrfToken,
          },
          body: JSON.stringify({
            email: 'owner@example.com',
            password: 'SecureTestPass123!',
          }),
        },
        csrf.cookie,
      );
      assert.equal(login.response.status, 200);
      assert.deepEqual(login.body.admin, {
        id: admin.id,
        email: 'owner@example.com',
      });

      const csrfFailure = await request(
        `/api/admin/orders/${created.id}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'packed' }),
        },
        login.cookie,
      );
      assert.equal(csrfFailure.response.status, 403);

      const notifications = await request(
        '/api/admin/notifications?afterId=0',
        {},
        login.cookie,
      );
      assert.equal(notifications.response.status, 200);
      assert.equal(notifications.body.notifications.length, 1);
      assert.equal(
        notifications.body.notifications[0].eventType,
        'order_created',
      );

      const preflight = await request(
        `/api/admin/orders/${created.id}/status`,
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://admin.example',
            'Access-Control-Request-Method': 'PATCH',
            'Access-Control-Request-Headers': 'content-type,x-csrf-token',
          },
        },
      );
      assert.equal(preflight.response.status, 204);
      assert.match(
        preflight.response.headers.get('access-control-allow-methods'),
        /PATCH/,
      );

      const updated = await request(
        `/api/admin/orders/${created.id}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': login.body.csrfToken,
          },
          body: JSON.stringify({ status: 'packed', note: 'Order packed.' }),
        },
        login.cookie,
      );
      assert.equal(updated.response.status, 200);
      assert.equal(updated.body.order.status, 'packed');
      const statusNotifications = await request(
        `/api/admin/notifications?afterId=${notifications.body.latestId}`,
        {},
        login.cookie,
      );
      assert.equal(statusNotifications.body.notifications.length, 1);
      assert.equal(
        statusNotifications.body.notifications[0].eventType,
        'order_status_changed',
      );

      const details = await request(
        `/api/admin/orders/${created.orderReference}`,
        {},
        login.cookie,
      );
      assert.equal(details.response.status, 200);
      assert.equal(details.body.order.statusHistory[1].adminEmail, admin.email);
      assert.equal(details.body.order.statusHistory[1].note, 'Order packed.');
    } finally {
      app.locals.adminSessionStore.close();
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
