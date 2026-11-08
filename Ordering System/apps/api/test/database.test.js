import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/database/database.js';
import { applyMigrations } from '../src/database/migrations.js';

async function withDatabase(run) {
  const directory = await mkdtemp(join(tmpdir(), 'restaurant-database-'));
  const database = await openDatabase(join(directory, 'restaurant.sqlite'));
  try {
    await run(database);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test('initializes the restaurant catalog schema and applies migrations once', async () => {
  await withDatabase(async (database) => {
    await applyMigrations(database);

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map(({ name }) => name);

    for (const table of [
      'restaurants',
      'restaurant_settings',
      'categories',
      'products',
      'product_options',
      'product_option_choices',
      'orders',
      'order_status_history',
      'admin_users',
      'notification_events',
      'schema_migrations',
    ]) {
      assert.ok(tables.includes(table), `Expected ${table} table`);
    }

    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()
        .count,
      6,
    );
  });
});

test('database constraints prevent a product referencing another restaurant category', async () => {
  await withDatabase(async (database) => {
    const insertRestaurant = database.prepare(`
      INSERT INTO restaurants (
        id, slug, name, primary_color, secondary_color, contact_phone,
        contact_email, contact_address, currency, business_hours_json
      ) VALUES (?, ?, ?, '#112233', '#445566', '000', 'test@example.com',
        'Test address', 'USD', '{}')
    `);
    insertRestaurant.run('r1', 'restaurant-one', 'Restaurant One');
    insertRestaurant.run('r2', 'restaurant-two', 'Restaurant Two');
    database.prepare(`
      INSERT INTO categories (id, restaurant_id, name) VALUES ('food', 'r1', 'Food')
    `).run();

    assert.throws(() => {
      database.prepare(`
        INSERT INTO products (
          id, restaurant_id, category_id, name, price_cents
        ) VALUES ('item', 'r2', 'food', 'Item', 500)
      `).run();
    }, /FOREIGN KEY constraint failed/);
  });
});
