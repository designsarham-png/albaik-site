# Al-Baik Ordering System

A reusable restaurant ordering engine designed to run independently from each
client's website branding and presentation.

## Project status

The system includes a SQLite-backed catalog and order API, an authenticated
admin dashboard, server-calculated checkout totals, and idempotent order
submissions. The Al-Baik website remains the customer storefront; its menu
prices, availability, cart, checkout and order tracking use this API.

## Requirements

- Node.js 20.19 or newer (Node.js 22 LTS or newer recommended)
- npm 10 or newer

## Getting started

1. Install dependencies from the project root:

   ```sh
   npm install
   ```

2. Copy `apps/api/.env.example` to `apps/api/.env`.
   The default SQLite file is created automatically at
   `apps/api/data/restaurant.sqlite`.
3. Import the demo restaurant menu:

   ```sh
   npm run configure:demo
   ```

   For the Al-Baik website integration, import its matching catalog instead:

   ```sh
   npm run configure:albaik
   ```

4. Start the API, admin shell, or demo storefront in separate terminals:

   ```sh
   npm run dev:api
   npm run dev:admin
   npm run dev:storefront
   ```

5. Visit the Vite URL printed by either frontend. The API health check is
   available at `http://localhost:3001/api/health`.

## Useful commands

- `npm run build` builds the frontend applications.
- `npm test` runs available workspace tests.

See [docs/setup.md](./docs/setup.md) for a beginner-friendly setup guide and
[docs/architecture.md](./docs/architecture.md) for the module boundaries.
For SQLite backup and recovery instructions, see
[database/README.md](./database/README.md). For client configuration and API
integration, see [docs/integration.md](./docs/integration.md).
