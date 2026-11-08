import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';
import { applyMigrations } from '../src/database/migrations.js';

const currentMigrations = fileURLToPath(
  new URL('../../../database/migrations/', import.meta.url),
);

test('migrates existing order statuses and history to the three active steps', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'restaurant-status-migration-'));
  const oldMigrations = join(directory, 'old-migrations');
  const database = new Database(join(directory, 'orders.sqlite'));
  database.pragma('foreign_keys = ON');

  try {
    const oldMigrationFiles = (await readdir(currentMigrations))
      .filter((name) => /^00[1-5]_[a-z0-9_-]+\.sql$/i.test(name));
    await mkdir(oldMigrations);
    await Promise.all(oldMigrationFiles.map(async (name) => {
      let sql = await readFile(join(currentMigrations, name), 'utf8');
      if (['002_orders.sql', '005_notifications.sql'].includes(name)) {
        sql = sql.replaceAll(
          "('pending', 'packed', 'delivering')",
          "('pending', 'accepted', 'preparing', 'ready', 'dispatched', 'delivered', 'cancelled', 'rejected')",
        );
      }
      await writeFile(join(oldMigrations, name), sql);
    }));
    await applyMigrations(database, oldMigrations);

    const insertOrder = database.prepare(`
      INSERT INTO orders (
        id, order_reference, idempotency_key, request_hash,
        customer_full_name, customer_phone, fulfillment_type,
        delivery_address, payment_method, status, subtotal_cents,
        delivery_fee_cents, total_cents
      ) VALUES (?, ?, ?, ?, 'Legacy Customer', '0000000000', 'delivery',
        'Test address', 'cash_on_delivery', ?, 1000, 0, 1000)
    `);
    insertOrder.run('delivered-order', 'A'.repeat(32), 'legacy-delivered-key', 'hash', 'delivered');
    insertOrder.run('cancelled-order', 'B'.repeat(32), 'legacy-cancelled-key', 'hash', 'cancelled');

    database.prepare(`
      INSERT INTO order_items (
        id, order_id, product_id, product_name, unit_price_cents,
        quantity, line_total_cents, selected_options_json
      ) VALUES ('legacy-item', 'delivered-order', 'old-item', 'Legacy item',
        1000, 1, 1000, '[]')
    `).run();
    const insertHistory = database.prepare(`
      INSERT INTO order_status_history (id, order_id, status, note)
      VALUES (?, 'delivered-order', ?, '')
    `);
    ['pending', 'accepted', 'preparing', 'ready', 'dispatched', 'delivered']
      .forEach((status, index) => insertHistory.run(`history-${index}`, status));
    database.prepare(`
      INSERT INTO notification_events (order_id, event_type, status)
      VALUES ('delivered-order', 'order_status_changed', 'delivered')
    `).run();

    await applyMigrations(database, currentMigrations);

    assert.deepEqual(
      database.prepare('SELECT status FROM orders ORDER BY id').all(),
      [{ status: 'delivering' }, { status: 'delivering' }],
    );
    assert.deepEqual(
      database.prepare(`
        SELECT status FROM order_status_history
        WHERE order_id = 'delivered-order' ORDER BY rowid
      `).all(),
      [
        { status: 'pending' },
        { status: 'packed' },
        { status: 'packed' },
        { status: 'packed' },
        { status: 'delivering' },
        { status: 'delivering' },
      ],
    );
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM order_items').get().count,
      1,
    );
    assert.equal(
      database.prepare('SELECT status FROM notification_events').get().status,
      'delivering',
    );
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.throws(
      () => database.prepare(`
        UPDATE orders SET status = 'delivered' WHERE id = 'delivered-order'
      `).run(),
      /CHECK constraint failed/,
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
