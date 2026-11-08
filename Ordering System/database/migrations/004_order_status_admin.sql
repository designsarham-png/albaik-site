ALTER TABLE order_status_history
  ADD COLUMN admin_user_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL;
