import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createApp } from '../src/app.js';
import {
  getCatalog,
  importRestaurantConfig,
} from '../src/database/catalog.js';
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

async function withCatalog(run) {
  const directory = await mkdtemp(join(tmpdir(), 'restaurant-catalog-'));
  const database = await openDatabase(join(directory, 'catalog.sqlite'));
  try {
    importRestaurantConfig(database, structuredClone(demoConfiguration));
    await run(database);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function request(app, path, init = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}${path}`,
      init,
    );
    return {
      status: response.status,
      body: await response.json(),
      headers: response.headers,
    };
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('imports configured restaurant catalog and product options', async () => {
  await withCatalog(async (database) => {
    const catalog = getCatalog(database);

    assert.equal(catalog.restaurant.name, 'Sample Kitchen');
    assert.equal(catalog.categories.length, 2);
    assert.equal(catalog.categories[0].products[0].name, 'Garden Sandwich');
    assert.equal(
      catalog.categories[0].products[0].options[0].choices[1].priceDeltaCents,
      50,
    );
  });
});

test('catalog endpoints return configured products and category filters', async () => {
  await withCatalog(async (database) => {
    const app = createApp(database, testAppOptions);
    const catalogResponse = await request(app, '/api/catalog');
    const productsResponse = await request(
      app,
      '/api/products?categoryId=sides',
    );
    const categoriesResponse = await request(app, '/api/categories');

    assert.equal(catalogResponse.status, 200);
    assert.equal(catalogResponse.body.restaurant.slug, 'sample-kitchen');
    assert.equal(productsResponse.status, 200);
    assert.deepEqual(
      productsResponse.body.products.map((product) => product.id),
      ['crispy-potatoes'],
    );
    assert.equal(productsResponse.body.products[0].category.name, 'Sides');
    assert.equal(categoriesResponse.body.categories.length, 2);
  });
});

test('catalog CORS headers are sent only to configured website origins', async () => {
  await withCatalog(async (database) => {
    const app = createApp(database, {
      ...testAppOptions,
      allowedOrigins: ['https://shop.example'],
    });
    const allowed = await request(app, '/api/catalog', {
      headers: { Origin: 'https://shop.example' },
    });
    const blocked = await request(app, '/api/catalog', {
      headers: { Origin: 'https://other.example' },
    });

    assert.equal(
      allowed.headers.get('access-control-allow-origin'),
      'https://shop.example',
    );
    assert.equal(blocked.headers.get('access-control-allow-origin'), null);
  });
});

test('catalog endpoints report unconfigured and invalid requests clearly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'restaurant-empty-catalog-'));
  const database = await openDatabase(join(directory, 'catalog.sqlite'));
  try {
    const app = createApp(database, testAppOptions);
    const unconfigured = await request(app, '/api/catalog');
    const invalidFilter = await request(
      app,
      '/api/products?categoryId=one&categoryId=two',
    );

    assert.equal(unconfigured.status, 503);
    assert.equal(unconfigured.body.error.code, 'CATALOG_NOT_CONFIGURED');
    assert.equal(invalidFilter.status, 400);
    assert.equal(invalidFilter.body.error.code, 'INVALID_CATEGORY_FILTER');
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('configuration import updates matching restaurant but refuses another tenant', async () => {
  await withCatalog(async (database) => {
    const updated = structuredClone(demoConfiguration);
    updated.restaurant.name = 'Updated Sample Kitchen';
    updated.products = updated.products.slice(0, 1);
    importRestaurantConfig(database, updated);

    assert.equal(getCatalog(database).restaurant.name, 'Updated Sample Kitchen');
    assert.equal(
      getCatalog(database).categories[1].products.length,
      0,
    );
    assert.throws(
      () =>
        importRestaurantConfig(database, {
          ...updated,
          restaurant: { ...updated.restaurant, slug: 'another-restaurant' },
        }),
      /separate database for each restaurant/,
    );
  });
});
