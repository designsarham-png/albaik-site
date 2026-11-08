CREATE TABLE restaurants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  logo_url TEXT,
  primary_color TEXT NOT NULL,
  secondary_color TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_address TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  business_hours_json TEXT NOT NULL CHECK (json_valid(business_hours_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE restaurant_settings (
  restaurant_id TEXT PRIMARY KEY,
  delivery_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  minimum_order_cents INTEGER NOT NULL DEFAULT 0 CHECK (minimum_order_cents >= 0),
  payment_methods_json TEXT NOT NULL DEFAULT '["cash_on_delivery"]'
    CHECK (json_valid(payment_methods_json)),
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);

CREATE TABLE categories (
  id TEXT NOT NULL,
  restaurant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  PRIMARY KEY (restaurant_id, id),
  UNIQUE (restaurant_id, name),
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);

CREATE TABLE products (
  id TEXT NOT NULL,
  restaurant_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (restaurant_id, id),
  FOREIGN KEY (restaurant_id, category_id)
    REFERENCES categories(restaurant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);

CREATE TABLE product_options (
  id TEXT NOT NULL,
  restaurant_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  selection_type TEXT NOT NULL CHECK (selection_type IN ('single', 'multiple')),
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  min_selections INTEGER NOT NULL DEFAULT 0 CHECK (min_selections >= 0),
  max_selections INTEGER NOT NULL DEFAULT 1 CHECK (max_selections >= 1),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (restaurant_id, id),
  CHECK (min_selections <= max_selections),
  CHECK (required = 0 OR min_selections >= 1),
  CHECK (selection_type != 'single' OR max_selections = 1),
  FOREIGN KEY (restaurant_id, product_id)
    REFERENCES products(restaurant_id, id) ON DELETE CASCADE
);

CREATE TABLE product_option_choices (
  id TEXT NOT NULL,
  restaurant_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price_delta_cents INTEGER NOT NULL DEFAULT 0,
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (restaurant_id, id),
  FOREIGN KEY (restaurant_id, option_id)
    REFERENCES product_options(restaurant_id, id) ON DELETE CASCADE
);

CREATE INDEX products_catalog_idx
  ON products (restaurant_id, category_id, available, sort_order);
