# Local setup

## Install prerequisites

Install Node.js 20.19 or newer and npm 10 or newer. From a terminal, confirm
availability with `node --version` and `npm --version`.

## Install and configure

Run `npm install` in the project root. Copy `apps/api/.env.example` to
`apps/api/.env`; keep the local `.env` file private and never commit it. The
API creates its SQLite database at `apps/api/data/restaurant.sqlite` by
default and applies pending schema migrations when it starts.
Before starting the API, replace `SESSION_SECRET` in `apps/api/.env` with a
random value. Generate one with:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

The API refuses to start while the example session secret is unchanged.
Import the demo menu with `npm run configure:demo`. If you change the API port,
set `API_PROXY_TARGET` in `apps/demo-storefront/.env` to the matching API
origin.

## Run the applications

Open a terminal for each process and run one of:

- `npm run dev:api` — starts the API at `http://localhost:3001`.
- `npm run dev:admin` — starts the Vite admin shell.
- `npm run dev:storefront` — starts the Vite demo storefront.

Check `http://localhost:3001/api/health` for the API's basic health response.

## Build and test

Run `npm run build` to build the frontend apps and `npm test` to execute
available workspace tests.

The database schema and restaurant configuration validation are in place.
Import the example menu using `npm run configure:demo`, or pass your own JSON
configuration to the API workspace's `configure` command. The demo storefront
loads its catalog over the API rather than embedding product data. You can
choose product options, add menu items to the cart, update quantities, and
remove items. Checkout creates orders with Cash on Delivery. The admin app
provides secure sign-in and an order dashboard backed by the restaurant
database.
See [the database guide](../database/README.md) for client isolation, backup,
and recovery instructions.
For a step-by-step guide to connecting another React site, see
[the integration guide](./integration.md).

## Restaurant configuration format

The reusable validator is exported as `validateRestaurantConfig` from the
`@restaurant/restaurant-configuration` workspace. It checks:

- Restaurant slug, name, optional logo URL, two hex brand colors, contact
  details, and a three-letter uppercase currency code.
- Delivery fee and minimum order as non-negative integer cents, seven explicit
  weekday entries (`null` when closed, otherwise `open` and `close` in `HH:mm`
  format), and one or more payment method identifiers.
- Categories with unique IDs, plus products that reference a configured
  category and have a name, description, image URL, integer-cent price, and
  availability flag.
- Optional product options, each with single/multiple selection rules and
  choices whose price adjustments are integer cents.

Use `npm run configure --workspace=@restaurant/api -- path/to/client-config.json`
to import a configuration. The path is relative to `apps/api` when run through
the workspace. Configuration import updates only the matching restaurant and
refuses a second restaurant in the same database. See
[the integration guide](./integration.md) for API details and deployment setup.

## Test the cart

1. Import the demo menu using `npm run configure:demo`.
2. Start the API and storefront in separate terminals:

   ```sh
   npm run dev:api
   npm run dev:storefront
   ```

3. Open the storefront, choose a product option, and add products to the cart.
   Try adding the same configuration twice, changing its quantity, and removing
   it. The item count, subtotal, and total should update. Try a product with
   required options and confirm it cannot be added until a valid option is
   selected.
4. Run `npm test` to test cart calculations, selections, and quantity changes.

## Test checkout

1. Make sure the demo configuration has been imported and both the API and
   storefront are running.
2. Add enough menu items to meet the configured minimum order.
3. Open the cart, continue to checkout, and enter a name, valid phone number,
   and delivery address. Choose delivery or self-pickup.
4. Confirm the summary shows the configured delivery fee for delivery and no
   delivery fee for pickup. Submit the order and note its order reference.
5. Try invalid phone/address values and an order below the minimum amount; the
   form should show an error instead of placing the order.
6. Run `npm test` to test API validation, idempotency, server-side prices, and
   reusable cart calculations.

The API recalculates the total from the database, even if a browser request
includes different price or total values. See
[the integration guide](./integration.md) for request and retry details.

## Create the initial admin account

There is no public registration page or API. Create the first admin account
from the API workspace in a PowerShell terminal. Enter a password of at least
12 characters when prompted; it is passed to the provisioning command through
temporary environment variables and is not stored in a frontend or committed
file:

```powershell
$env:ADMIN_EMAIL = Read-Host "Admin email"
$securePassword = Read-Host "Admin password" -AsSecureString
$env:ADMIN_PASSWORD = [System.Net.NetworkCredential]::new("", $securePassword).Password
npm run admin:create --workspace=@restaurant/api
Remove-Item Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD
```

The command hashes the password and refuses to create another initial admin if
an account already exists. If it reports an error, the shell environment
variables remain until you clear them with the last command.

Start the API and admin frontend in separate terminals, then open the Vite URL
printed by `npm run dev:admin`. Sign in with the account just created. The
dashboard shows order totals and status counts, and lets admins find orders,
review customer and item details, and update valid order statuses. To test it,
place an order from the demo storefront, then search for its order reference in
the dashboard. Status changes are saved in the database and added to the
order's status history. See [the integration guide](./integration.md) for the
admin API endpoints and supported status transitions.
The dashboard also checks for new order events while it remains open; use its
notification controls to opt into browser sound or desktop notifications.
After placing a demo order, keep the confirmation page open and update the order
in the dashboard to see the customer-facing live status update. The confirmation
also links to a tracking page at `/track/<order-reference>`; it displays the
order's items, totals, and status timeline without exposing contact or address
details. The order reference acts like a private tracking link, so share it
only with the customer.
Expand **Restaurant configuration** at the bottom of the dashboard to edit
restaurant branding and contact details, delivery and minimum order amounts,
business hours, category visibility, and existing product prices or
availability. Changes are validated and saved to the restaurant database.
To add or remove products, categories, or product options, update the client's
configuration JSON and import it as described in
[the integration guide](./integration.md).
