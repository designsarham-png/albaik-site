import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importRestaurantConfig } from '../src/database/catalog.js';
import { openDatabase, resolveDatabasePath } from '../src/database/database.js';

const apiDirectory = fileURLToPath(new URL('../', import.meta.url));
const configurationPath = process.argv[2];

if (!configurationPath) {
  throw new Error(
    'Pass the restaurant configuration JSON path as the first argument.',
  );
}

const absoluteConfigurationPath = resolve(configurationPath);
const configuration = JSON.parse(
  await readFile(absoluteConfigurationPath, 'utf8'),
);
const databasePath = resolveDatabasePath(process.env.DATABASE_PATH, apiDirectory);
const database = await openDatabase(databasePath);

try {
  importRestaurantConfig(database, configuration);
  console.log(
    `Imported "${configuration.restaurant.name}" into ${databasePath}.`,
  );
} finally {
  database.close();
}
