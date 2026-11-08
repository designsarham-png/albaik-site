import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultMigrationsDirectory = fileURLToPath(
  new URL('../../../../database/migrations/', import.meta.url),
);

export async function applyMigrations(
  database,
  migrationsDirectory = defaultMigrationsDirectory,
) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();
  const hasMigration = database.prepare(
    'SELECT 1 FROM schema_migrations WHERE name = ?',
  );
  const recordMigration = database.prepare(
    'INSERT INTO schema_migrations (name) VALUES (?)',
  );

  for (const name of migrationFiles) {
    if (hasMigration.get(name)) {
      continue;
    }

    const sql = await readFile(join(migrationsDirectory, name), 'utf8');
    database.transaction(() => {
      database.exec(sql);
      recordMigration.run(name);
    })();
  }
}
