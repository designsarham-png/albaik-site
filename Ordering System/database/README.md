# Database setup, backup, and recovery

The API uses SQLite through the database module in `apps/api/src/database`.
Versioned SQL migrations are stored in `database/migrations` and are applied
when the API starts. The migration runner records applied files in
`schema_migrations`; rerunning it does not reapply completed migrations.

The initial schema stores restaurant identity and branding, restaurant
settings, categories, products, product options, and option choices. Monetary
values are integer minor units (for example, cents), not floating-point values.
Restaurant IDs are part of catalog keys and foreign-key relationships, which
prevents a product from referencing another restaurant's category.
The next migration adds `orders`, `order_items`, and `order_status_history`.
Order records contain customer details and must be treated as private data;
backup access should be restricted accordingly.
The admin-auth migration adds hashed admin credentials and server-side
sessions. Database backups therefore contain both customer information and
authentication data and must be protected as sensitive files.

## Database location and isolation

Each client deployment must use a separate database file and its own
environment configuration. By default, the API creates
`apps/api/data/restaurant.sqlite`. Set `DATABASE_PATH` in `apps/api/.env` to
choose another path; relative paths are resolved from `apps/api`. Do not point
two client deployments at the same database file.

SQLite creates `-wal` and `-shm` files while the API is running. Do not copy
only the main database file as a live backup.

## Backup

Install the SQLite command-line tools on the machine that runs backups. The
SQLite `.backup` command creates a consistent backup even while the API is
running. From the project root in PowerShell, for the default database path:

```powershell
New-Item -ItemType Directory -Force .\backups | Out-Null
sqlite3 .\apps\api\data\restaurant.sqlite ".backup '.\backups\restaurant.sqlite'"
```

Keep backups in protected storage, restrict access because they contain
customer data, and periodically test a restore. For deployments
with a custom `DATABASE_PATH`, back up that configured file instead.

## Recovery

1. Stop the API process.
2. Keep a copy of the current database file for investigation.
3. Check the backup before restoring:

   ```powershell
   sqlite3 .\backups\restaurant.sqlite "PRAGMA integrity_check;"
   ```

   A healthy database reports `ok`.
4. Copy the verified backup to the configured database path.
5. Start the API and check `http://localhost:3001/api/health`.
6. Keep the pre-restore copy until the recovered database has been verified.

Never edit a live SQLite database by copying over its file. Stop the API first
for restoration. Schema changes must be delivered as a new numbered migration;
do not edit a migration that has already been applied in a deployed database.
