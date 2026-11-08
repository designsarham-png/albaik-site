import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations } from './migrations.js';

export async function openDatabase(databasePath) {
  if (!databasePath || typeof databasePath !== 'string') {
    throw new TypeError('A database file path is required.');
  }

  const absolutePath = resolve(databasePath);
  mkdirSync(dirname(absolutePath), { recursive: true });

  const database = new Database(absolutePath);
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  database.pragma('journal_mode = WAL');

  try {
    await applyMigrations(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function resolveDatabasePath(configuredPath, apiDirectory) {
  const path = configuredPath || 'data/restaurant.sqlite';
  return isAbsolute(path) ? path : resolve(apiDirectory, path);
}
