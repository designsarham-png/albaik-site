import assert from 'node:assert/strict';
import test from 'node:test';
import { createOrderingClient } from '../src/client.js';

test('loads a restaurant catalog through the configured API base URL', async () => {
  const requests = [];
  const client = createOrderingClient({
    baseUrl: 'https://api.example.test/api/',
    fetchImplementation: async (url, options) => {
      requests.push({ url, options });
      return Response.json({
        restaurant: { name: 'Example Kitchen' },
        categories: [],
      });
    },
  });
  const controller = new AbortController();
  const catalog = await client.getCatalog({ signal: controller.signal });

  assert.equal(catalog.restaurant.name, 'Example Kitchen');
  assert.equal(requests[0].url, 'https://api.example.test/api/catalog');
  assert.equal(requests[0].options.signal, controller.signal);
});

test('submits orders with a caller-reusable idempotency key and reports API errors', async () => {
  let request;
  const client = createOrderingClient({
    baseUrl: '/api/',
    fetchImplementation: async (url, options) => {
      request = { url, options };
      return Response.json(
        { order: { orderReference: 'A'.repeat(32), status: 'pending' } },
        { status: 201 },
      );
    },
  });
  const orderRequest = {
    customer: { fullName: 'Alex Customer' },
    items: [{ productId: 'sandwich', quantity: 1 }],
  };
  const order = await client.createOrder(orderRequest, {
    idempotencyKey: 'checkout-attempt-01',
  });

  assert.equal(order.status, 'pending');
  assert.equal(request.url, '/api/orders');
  assert.equal(request.options.method, 'POST');
  assert.equal(
    request.options.headers['Idempotency-Key'],
    'checkout-attempt-01',
  );
  assert.deepEqual(JSON.parse(request.options.body), orderRequest);

  const failingClient = createOrderingClient({
    fetchImplementation: async () =>
      Response.json(
        {
          error: {
            code: 'PRODUCT_UNAVAILABLE',
            message: 'A selected item is unavailable.',
          },
        },
        { status: 409 },
      ),
  });
  await assert.rejects(
    failingClient.createOrder(orderRequest, {
      idempotencyKey: 'checkout-attempt-01',
    }),
    (error) =>
      error.name === 'OrderingApiError' &&
      error.status === 409 &&
      error.code === 'PRODUCT_UNAVAILABLE',
  );
});

test('loads private tracking without caching and URL-encodes the reference', async () => {
  let request;
  const client = createOrderingClient({
    baseUrl: '/api',
    fetchImplementation: async (url, options) => {
      request = { url, options };
      return Response.json({
        order: { status: 'accepted' },
        restaurant: { name: 'Example Kitchen' },
      });
    },
  });
  const tracking = await client.getOrderTracking('REF 123');

  assert.equal(tracking.order.status, 'accepted');
  assert.equal(request.url, '/api/orders/REF%20123');
  assert.equal(request.options.cache, 'no-store');
});

test('parses live status events and closes the stream on unsubscribe', () => {
  class MockEventSource {
    static instance;

    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      this.closed = false;
      MockEventSource.instance = this;
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    removeEventListener(type, listener) {
      if (this.listeners.get(type) === listener) {
        this.listeners.delete(type);
      }
    }

    close() {
      this.closed = true;
    }
  }
  const client = createOrderingClient({
    baseUrl: 'https://api.example.test/api',
    fetchImplementation: async () => Response.json({}),
    eventSourceConstructor: MockEventSource,
  });
  let update;
  let opened = false;
  let connectionError = false;
  const unsubscribe = client.subscribeToOrderUpdates('ORDER-123', {
    onUpdate: (value) => {
      update = value;
    },
    onOpen: () => {
      opened = true;
    },
    onError: () => {
      connectionError = true;
    },
  });
  const stream = MockEventSource.instance;

  assert.equal(
    stream.url,
    'https://api.example.test/api/orders/ORDER-123/events',
  );
  stream.listeners.get('order_update')({
    data: JSON.stringify({ status: 'preparing' }),
  });
  stream.listeners.get('open')();
  stream.listeners.get('error')();
  assert.deepEqual(update, { status: 'preparing' });
  assert.equal(opened, true);
  assert.equal(connectionError, true);

  unsubscribe();
  assert.equal(stream.closed, true);
  assert.equal(stream.listeners.size, 0);
});

test('requires a valid base URL, tracking reference, and idempotency key', async () => {
  assert.throws(() => createOrderingClient({ baseUrl: '' }), /base URL/);
  const client = createOrderingClient({
    fetchImplementation: async () => Response.json({ order: {} }),
  });
  await assert.rejects(
    client.createOrder({}, { idempotencyKey: 'short' }),
    /idempotency key/,
  );
  await assert.rejects(client.getOrderTracking(''), /tracking reference/);
  assert.throws(
    () => client.subscribeToOrderUpdates('', { onUpdate() {} }),
    /tracking reference/,
  );
});
