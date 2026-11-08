CREATE TABLE notification_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('order_created', 'order_status_changed')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'packed', 'delivering')
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX notification_events_order_idx
  ON notification_events (order_id, id);
