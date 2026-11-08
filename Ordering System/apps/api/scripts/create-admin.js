import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import {
  createAdminUser,
} from '../src/auth/admin-auth.js';
import { hashAdminPassword } from '../src/auth/passwords.js';
import { openDatabase, resolveDatabasePath } from '../src/database/database.js';

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
delete process.env.ADMIN_PASSWORD;

if (
  !process.env.SESSION_SECRET ||
  process.env.SESSION_SECRET.length < 32 ||
  process.env.SESSION_SECRET.startsWith('replace-this-with-')
) {
  throw new Error(
    'Replace SESSION_SECRET in apps/api/.env before creating an admin account.',
  );
}
if (!email || !password) {
  throw new Error(
    'Set ADMIN_EMAIL and ADMIN_PASSWORD for this command only. Do not commit credentials to .env files.',
  );
}

const apiDirectory = fileURLToPath(new URL('../', import.meta.url));
const databasePath = resolveDatabasePath(process.env.DATABASE_PATH, apiDirectory);
const database = await openDatabase(databasePath);

try {
  const admin = await createAdminUser(
    database,
    email,
    password,
    hashAdminPassword,
  );
  console.log(`Created the initial administrator account for ${admin.email}.`);
} finally {
  database.close();
}
