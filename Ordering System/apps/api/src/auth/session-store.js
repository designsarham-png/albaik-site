import session from 'express-session';

const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export class SQLiteSessionStore extends session.Store {
  constructor(database, { cleanupIntervalMs = 15 * 60 * 1000 } = {}) {
    super();
    this.database = database;
    this.getStatement = database.prepare(`
      SELECT session_data AS sessionData, expires_at AS expiresAt
      FROM admin_sessions
      WHERE session_id = ?
    `);
    this.setStatement = database.prepare(`
      INSERT INTO admin_sessions (session_id, expires_at, session_data)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        expires_at = excluded.expires_at,
        session_data = excluded.session_data
    `);
    this.touchStatement = database.prepare(`
      UPDATE admin_sessions SET expires_at = ? WHERE session_id = ?
    `);
    this.destroyStatement = database.prepare(
      'DELETE FROM admin_sessions WHERE session_id = ?',
    );
    this.pruneStatement = database.prepare(
      'DELETE FROM admin_sessions WHERE expires_at <= ?',
    );
    this.pruneStatement.run(Date.now());
    this.cleanupTimer = setInterval(
      () => this.pruneStatement.run(Date.now()),
      cleanupIntervalMs,
    );
    this.cleanupTimer.unref();
  }

  get(sessionId, callback) {
    try {
      const row = this.getStatement.get(sessionId);
      if (!row) {
        return callback(null, null);
      }
      if (row.expiresAt <= Date.now()) {
        this.destroyStatement.run(sessionId);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.sessionData));
    } catch (error) {
      return callback(error);
    }
  }

  set(sessionId, value, callback = () => {}) {
    try {
      const expiresAt = value.cookie?.expires
        ? new Date(value.cookie.expires).getTime()
        : Date.now() + DEFAULT_SESSION_TTL_MS;
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        this.destroyStatement.run(sessionId);
        callback(null);
        return;
      }
      this.setStatement.run(sessionId, expiresAt, JSON.stringify(value));
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sessionId, value, callback = () => {}) {
    try {
      const expiresAt = value.cookie?.expires
        ? new Date(value.cookie.expires).getTime()
        : Date.now() + DEFAULT_SESSION_TTL_MS;
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        this.destroyStatement.run(sessionId);
        callback(null);
        return;
      }
      this.touchStatement.run(expiresAt, sessionId);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sessionId, callback = () => {}) {
    try {
      this.destroyStatement.run(sessionId);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  close() {
    clearInterval(this.cleanupTimer);
  }
}
