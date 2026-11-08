CREATE TEMP TABLE migration_orders AS SELECT * FROM orders;
CREATE TEMP TABLE migration_order_items AS SELECT * FROM order_items;
CREATE TEMP TABLE migration_order_status_history AS
  SELECT * FROM order_status_history;
CREATE TEMP TABLE migration_notification_events AS
  SELECT * FROM notification_events;

DROP TABLE notification_events;
DROP TABLE order_status_history;
DROP TABLE order_items;
DROP TABLE orders;

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  order_reference TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  customer_full_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('delivery', 'pickup')),
  delivery_address TEXT,
  delivery_instructions TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'packed', 'delivering')),
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  delivery_fee_cents INTEGER NOT NULL CHECK (delivery_fee_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (total_cents = subtotal_cents + delivery_fee_cents),
  CHECK (
    (fulfillment_type = 'delivery' AND delivery_address IS NOT NULL)
    OR (fulfillment_type = 'pickup' AND delivery_address IS NULL)
  )
);

INSERT INTO orders (
  id, order_reference, idempotency_key, request_hash,
  customer_full_name, customer_phone, fulfillment_type,
  delivery_address, delivery_instructions, payment_method, status,
  subtotal_cents, delivery_fee_cents, total_cents, created_at
)
SELECT
  id, order_reference, idempotency_key, request_hash,
  customer_full_name, customer_phone, fulfillment_type,
  delivery_address, delivery_instructions, payment_method,
  CASE
    WHEN status IN ('pending', 'packed', 'delivering') THEN status
    WHEN status IN ('accepted', 'preparing', 'ready') THEN 'packed'
    WHEN status IN ('dispatched', 'delivered', 'cancelled', 'rejected') THEN 'delivering'
    ELSE 'pending'
  END,
  subtotal_cents, delivery_fee_cents, total_cents, created_at
FROM migration_orders;

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  selected_options_json TEXT NOT NULL CHECK (json_valid(selected_options_json)),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

INSERT INTO order_items
SELECT * FROM migration_order_items;

CREATE TABLE order_status_history (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'packed', 'delivering')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

INSERT INTO order_status_history (
  id, order_id, status, note, created_at, admin_user_id
)
SELECT
  id,
  order_id,
  CASE
    WHEN status IN ('pending', 'packed', 'delivering') THEN status
    WHEN status IN ('accepted', 'preparing', 'ready') THEN 'packed'
    WHEN status IN ('dispatched', 'delivered', 'cancelled', 'rejected') THEN 'delivering'
    ELSE 'pending'
  END,
  note,
  created_at,
  admin_user_id
FROM migration_order_status_history;

CREATE TABLE notification_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('order_created', 'order_status_changed')
  ),
  status TEXT NOT NULL CHECK (status IN ('pending', 'packed', 'delivering')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

INSERT INTO notification_events (id, order_id, event_type, status, created_at)
SELECT
  id,
  order_id,
  event_type,
  CASE
    WHEN status IN ('pending', 'packed', 'delivering') THEN status
    WHEN status IN ('accepted', 'preparing', 'ready') THEN 'packed'
    WHEN status IN ('dispatched', 'delivered', 'cancelled', 'rejected') THEN 'delivering'
    ELSE 'pending'
  END,
  created_at
FROM migration_notification_events;

CREATE INDEX orders_status_created_idx ON orders (status, created_at);
CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_status_history_order_idx
  ON order_status_history (order_id, created_at);
CREATE INDEX notification_events_order_idx
  ON notification_events (order_id, id);

DROP TABLE migration_notification_events;
DROP TABLE migration_order_status_history;
DROP TABLE migration_order_items;
DROP TABLE migration_orders;
