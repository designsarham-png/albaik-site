import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { createAdminUser } from '../src/auth/admin-auth.js';
import { hashAdminPassword } from '../src/auth/passwords.js';
import { getCatalog, importRestaurantConfig } from '../src/database/catalog.js';
import { openDatabase } from '../src/database/database.js';
import { getRestaurantConfig } from '../src/database/admin-configuration.js';

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

async function request(app, path, init = {}, cookie = '') {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const headers = new Headers(init.headers);
    if (cookie) {
      headers.set('Cookie', cookie);
    }
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}${path}`,
      { ...init, headers },
    );
    const contentType = response.headers.get('content-type') ?? '';
    return {
      status: response.status,
      body: contentType.includes('application/json')
        ? await response.json()
        : null,
      cookie: response.headers.get('set-cookie')?.split(';')[0] ?? cookie,
      headers: response.headers,
    };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('protects centralized restaurant config and saves validated changes atomically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'restaurant-admin-config-'));
  const database = await openDatabase(join(directory, 'configuration.sqlite'));
  importRestaurantConfig(database, structuredClone(demoConfiguration));
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
  try {
    const unauthorized = await request(app, '/api/admin/config');
    assert.equal(unauthorized.status, 401);

    const tokenResponse = await request(app, '/api/admin/csrf');
    const login = await request(
      app,
      '/api/admin/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': tokenResponse.body.csrfToken,
        },
        body: JSON.stringify({
          email: admin.email,
          password: 'SecureTestPass123!',
        }),
      },
      tokenResponse.cookie,
    );
    assert.equal(login.status, 200);

    const get = await request(app, '/api/admin/config', {}, login.cookie);
    assert.equal(get.status, 200);
    assert.equal(get.headers.get('cache-control'), 'no-store');
    assert.deepEqual(get.body.configuration, getRestaurantConfig(database));
    assert.equal(get.body.configuration.categories.length, 2);
    assert.equal(get.body.configuration.products[0].options[0].choices.length, 2);

    const missingCsrf = await request(
      app,
      '/api/admin/config',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(demoConfiguration),
      },
      login.cookie,
    );
    assert.equal(missingCsrf.status, 403);

    const preflight = await request(
      app,
      '/api/admin/config',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://admin.example',
          'Access-Control-Request-Method': 'PUT',
          'Access-Control-Request-Headers': 'content-type,x-csrf-token',
        },
      },
    );
    assert.equal(preflight.status, 204);
    assert.match(
      preflight.headers.get('access-control-allow-methods'),
      /PUT/,
    );

    const invalid = structuredClone(demoConfiguration);
    invalid.settings.deliveryFeeCents = -1;
    const invalidUpdate = await request(
      app,
      '/api/admin/config',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': login.body.csrfToken,
        },
        body: JSON.stringify(invalid),
      },
      login.cookie,
    );
    assert.equal(invalidUpdate.status, 400);
    assert.equal(
      invalidUpdate.body.error.code,
      'INVALID_RESTAURANT_CONFIGURATION',
    );
    assert.equal(getCatalog(database).settings.deliveryFeeCents, 250);

    const updated = structuredClone(get.body.configuration);
    updated.restaurant.name = 'Updated Sample Kitchen';
    updated.restaurant.brandColors.primary = '#123456';
    updated.settings.deliveryFeeCents = 375;
    updated.settings.minimumOrderCents = 1500;
    updated.products[0].available = false;
    const saved = await request(
      app,
      '/api/admin/config',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': login.body.csrfToken,
        },
        body: JSON.stringify(updated),
      },
      login.cookie,
    );
    assert.equal(saved.status, 200);
    assert.equal(
      saved.body.configuration.restaurant.name,
      'Updated Sample Kitchen',
    );
    assert.equal(saved.body.configuration.settings.deliveryFeeCents, 375);
    assert.equal(getCatalog(database).restaurant.brandColors.primary, '#123456');
    assert.equal(getCatalog(database).settings.minimumOrderCents, 1500);
    assert.equal(
      getCatalog(database).categories[0].products[0].available,
      false,
    );
    assert.equal(
      getRestaurantConfig(database).products[0].options[0].choices.length,
      2,
    );
  } finally {
    app.locals.adminSessionStore.close();
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
