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

CREATE TABLE order_status_history (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX orders_status_created_idx ON orders (status, created_at);
CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_status_history_order_idx
  ON order_status_history (order_id, created_at);
