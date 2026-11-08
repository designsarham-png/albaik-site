import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDatabase, resolveDatabasePath } from './database/database.js';

const port = Number(process.env.PORT ?? 3001);
const apiDirectory = fileURLToPath(new URL('../', import.meta.url));

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const databasePath = resolveDatabasePath(process.env.DATABASE_PATH, apiDirectory);
const database = await openDatabase(databasePath);
const sessionSecret = process.env.SESSION_SECRET;
if (
  !sessionSecret ||
  sessionSecret.length < 32 ||
  sessionSecret.startsWith('replace-this-with-')
) {
  database.close();
  throw new Error(
    'Replace the SESSION_SECRET example with a random secret of at least 32 characters in apps/api/.env.',
  );
}
const app = createApp(database, {
  sessionSecret,
  secureCookies: process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === 'true',
});

app.listen(port, () => {
  console.log(`API listening at http://localhost:${port}; database initialized.`);
});

function shutdown() {
  app.locals.adminSessionStore?.close();
  database.close();
  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown();
});

process.on('SIGTERM', () => {
  shutdown();
});
