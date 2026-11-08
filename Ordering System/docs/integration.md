# Connect a restaurant website

The ordering API reads restaurant data from its own SQLite database. A website
does not contain product prices or restaurant identity; it fetches the catalog
from the API. This keeps the website's design independent from ordering data.

## Try the demo

From the project root:

1. Install dependencies with `npm install`.
2. Copy `apps/api/.env.example` to `apps/api/.env`.
3. Import the clearly labeled example restaurant configuration:

   ```sh
   npm run configure:demo
   ```

4. Start the API and storefront in separate terminals:

   ```sh
   npm run dev:api
   npm run dev:storefront
   ```

5. Open the Vite URL printed by the storefront. Its `/api` requests are proxied
   to the local API in development.

The example configuration is at
`packages/restaurant-configuration/examples/demo-restaurant.json`. It contains
sample menu data only; it is not order data. To use a client menu, create a
configuration JSON file following that structure and import it instead:

```sh
npm run configure --workspace=@restaurant/api -- path/to/client-config.json
```

Paths passed to this command are relative to `apps/api` (or can be absolute).
Importing a configuration updates that restaurant's catalog. The command
refuses to import a different restaurant into an already configured database.
Use a distinct `DATABASE_PATH` for each client.

## Catalog API

All amounts are integer minor units, such as cents. Prices must come from the
API, not from browser-supplied values.

- `GET /api/catalog` returns restaurant details, branding, currency, settings,
  active categories, their products, and product options.
- `GET /api/categories` returns active menu categories and products.
- `GET /api/products` returns products across active categories.
- `GET /api/products?categoryId=sandwiches` filters by category ID.

Products with `available: false` remain in the catalog so the website can show
them as unavailable. Inactive categories and their products are not public.
Unconfigured databases respond with `503 CATALOG_NOT_CONFIGURED`.

The demo website reads `/api/catalog`. For a separately hosted client website,
set `VITE_API_BASE_URL` to the deployed API base path, such as
`https://api.client.example/api`. Set the API's `CORS_ORIGINS` to the exact
website/admin origin(s), separated by commas. Admin session requests use
credentials, so never use wildcard origins with cookies.

For local development on a non-default API port, set `API_PROXY_TARGET` in
`apps/demo-storefront/.env` to the API origin, for example
`http://127.0.0.1:3195`. This controls the Vite development proxy only.

Every client should have its own API deployment, `DATABASE_PATH`, environment
configuration, and database backup schedule.

## Integrate a new React website

The demo storefront separates its design from the ordering API. A new React
website can use the same engine and API client while keeping its own logo,
fonts, colors, layout, and product presentation:

1. For a new website in this project, create an app folder under `apps/` (for
   example `apps/client-site`). The root npm workspace already includes
   `apps/*`.
2. Add the shared packages and React to that app's dependencies:

   ```json
   {
     "dependencies": {
       "@restaurant/frontend-components": "0.1.0",
       "@restaurant/ordering-engine": "0.1.0",
       "react": "^19.1.0",
       "react-dom": "^19.1.0"
     }
   }
   ```

   Run `npm install` from the project root to link workspace packages.
   `@restaurant/frontend-components` expects React 18 or newer as a peer
   dependency. Its API client itself is framework-independent; its optional
   hooks are available from `@restaurant/frontend-components/react`.
3. Configure the public API URL in that website's Vite environment, for
   example:

   ```dotenv
   VITE_API_BASE_URL=https://api.client.example/api
   ```

   This is a public URL, not a secret. Do not put database paths, passwords,
   session secrets, or admin credentials into `VITE_` variables.
4. Create one client configuration JSON file and import it into that client's
   API database. Deploy a separate API and `DATABASE_PATH` for each restaurant.
   The importer refuses to place a second restaurant into the same database.
5. Set the API's `CORS_ORIGINS` to the exact storefront and admin website
   origins. For session-authenticated admin access, use HTTPS and a same-origin
   reverse proxy for `/api`; never use wildcard CORS with cookies.
6. Provision that deployment's first admin using the documented server-side
   `admin:create` command, and keep a unique `SESSION_SECRET` private.

The API client exposes catalog loading, order submission, secure retry keys,
customer tracking, and live status updates:

```js
import { createOrderingClient } from '@restaurant/frontend-components';
import {
  addCartItem,
  getCartSummary,
} from '@restaurant/ordering-engine';

const ordering = createOrderingClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
});
const catalog = await ordering.getCatalog();
const product = catalog.categories[0].products[0];
const selectedChoiceIds = product.options
  .filter((option) => option.required)
  .map((option) => option.choices.find((choice) => choice.available)?.id)
  .filter(Boolean);
let cart = addCartItem([], product, selectedChoiceIds);
cart = addCartItem(cart, product, selectedChoiceIds);
const summary = getCartSummary(cart);

// Build this object from your own checkout form; send item IDs/options, not prices.
const checkoutData = {
  customer: { fullName, phone },
  fulfillmentType: 'delivery',
  deliveryAddress,
  deliveryInstructions: '',
  paymentMethod: 'cash_on_delivery',
  items: cart.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    selectedChoiceIds: item.selectedOptions.flatMap((option) =>
      option.choices.map((choice) => choice.choiceId),
    ),
  })),
};

// Keep this key for this checkout attempt; reuse it if retrying the same data.
const idempotencyKey = ordering.createIdempotencyKey();
const order = await ordering.createOrder(checkoutData, { idempotencyKey });
const tracking = await ordering.getOrderTracking(order.orderReference);
const unsubscribe = ordering.subscribeToOrderUpdates(order.orderReference, {
  onUpdate: (event) => console.log('Order status:', event.status),
  onOpen: () => console.log('Tracking connected'),
  onError: () => console.log('Tracking reconnecting'),
});
```

In React components, optional hooks `useRestaurantCatalog(ordering)` and
`useOrderTracking(ordering, reference)` are available from the
`@restaurant/frontend-components/react` subpath. Create the client once outside
the component or with `useMemo` so the hooks do not reconnect on every render.
These helpers fetch data and expose loading/error/reload state; the client
website still owns all visual design and product-card behavior. The demo app
uses the same shared API client and ordering-engine package as a working
integration example.

The reusable packages are marked private and are not currently published to a
public npm registry. For websites kept in separate repositories, distribute
them through your own private npm registry or a versioned private Git
dependency; do not copy restaurant-specific code into the ordering engine.

## Reusable cart

The `@restaurant/ordering-engine` package exports `createCartItem`,
`addCartItem`, `removeCartItem`, `setCartItemQuantity`, and `getCartSummary`.
It accepts product information from the catalog API plus selected option-choice
IDs. It validates required choices and availability, calculates option prices
using integer cents, combines identical configurations into one cart line, and
returns item count and subtotal. The summary's total currently equals its
subtotal; the server remains responsible for checkout fees and final totals.

The demo storefront supplies its own option controls and cart presentation,
while importing calculations from the reusable package. A client can replace
those controls and styles without rewriting the cart calculations.

## Checkout and order creation

The demo submits `POST /api/orders` with customer name and phone,
`fulfillmentType` (`delivery` or `pickup`), delivery address when needed,
instructions, `paymentMethod` (`cash_on_delivery`), and item product IDs,
quantities, and selected option-choice IDs. It includes an `Idempotency-Key`
header for safe retries.

The API reloads each product, option, choice, availability flag, and price from
SQLite; browser prices and totals are ignored. It enforces valid selections,
minimum order amount, configured delivery fee, phone/address rules, and the
enabled Cash on Delivery method. Orders and item price snapshots are written
atomically with a pending status-history record. The public response includes a
random order reference and final price summary, but not the customer's private
contact information.

If a request is retried using the same idempotency key and same checkout data,
the original order response is returned. Reusing the key with different data
returns `409 IDEMPOTENCY_KEY_REUSED`. Create a new key when the customer edits
the order.

`POST /api/orders` currently supports only Cash on Delivery. Other payment
methods must not be presented as available until a real payment integration is
implemented.

## Admin authentication

The admin app uses session-authenticated endpoints:

- `GET /api/admin/csrf` creates or returns a session-bound CSRF token.
- `POST /api/admin/login` requires that token in `X-CSRF-Token` and accepts
  `email` and `password`.
- `GET /api/admin/me` returns the signed-in admin or `401`.
- `POST /api/admin/logout` requires an authenticated session and CSRF token.

The API stores bcrypt password hashes and sessions in the client database. The
session cookie is HTTP-only, SameSite Strict, and expires after eight hours of
inactivity. Production deployments use a Secure `__Host-` cookie. Login is
rate-limited and uses a generic invalid-credentials message. No customer-facing
route can register an admin; provision the initial account using the private
`npm run admin:create --workspace=@restaurant/api` command documented in
[setup](./setup.md).

Set a unique random `SESSION_SECRET` per client deployment. Keep it private,
rotate it if exposed, and configure `CORS_ORIGINS` to the exact admin frontend
origin when it is hosted separately. The development admin app proxies API
requests to the backend and sends credentials using HTTP-only cookies.
If the API is behind a trusted reverse proxy, set `TRUST_PROXY=true`; do this
only when the proxy is controlled by the deployment operator.

## Admin order dashboard

After signing in, the dashboard uses these administrator-only endpoints:

- `GET /api/admin/config` returns the complete validated restaurant
  configuration, including branding, settings, categories, products, and
  options. Responses are not cached.
- `PUT /api/admin/config` replaces the restaurant configuration. Send the full
  configuration document as JSON, with the session cookie and
  `X-CSRF-Token`. The API validates the complete document and writes changes
  transactionally. A database can contain only one restaurant; create separate
  deployments/databases for additional clients.
- `GET /api/admin/summary` returns order totals, today's order count, sales
  excluding cancelled/rejected orders, and counts by status.
- `GET /api/admin/orders` returns a page of orders. Optional query parameters
  are `status` (one status or `all`), `search` (order reference, customer name,
  or phone), `page` (starting at 1), and `pageSize` (1–100).
- `GET /api/admin/orders/:reference` returns customer details, item and option
  snapshots, and status history.
- `PATCH /api/admin/orders/:id/status` changes an order status. Send a JSON
  `status` and optional `note` (up to 500 characters), with the session cookie
  and `X-CSRF-Token` from the signed-in session.

The API validates every transition and records it in the order status history
within the same database transaction. A pending order can be accepted,
rejected, or cancelled; accepted orders can move to preparing or cancelled;
preparing orders can move to ready or cancelled; ready orders can be
dispatched for delivery or marked delivered for pickup; dispatched orders can
be marked delivered. Terminal statuses cannot be changed. The dashboard hides
actions that do not apply to the order's fulfillment type, and the API remains
the source of truth.

The admin app's Restaurant configuration panel edits the existing restaurant's
branding, contact details, currency, delivery fee, minimum order, business
hours, category visibility/names, and product names/prices/availability. Menu
configuration changes are applied to the shared catalog API, so every
connected website sees them. The initial import command remains the way to
create a new restaurant configuration and to add or remove menu entries
outside the dashboard. Product-option structures are preserved when saving the
dashboard form and can be authored in the client configuration JSON.

To try the dashboard locally, start the API and admin app, provision an admin
as described in [setup](./setup.md), create an order through the demo
storefront, and sign in to the admin app. Order lists, search, filters, item
details, status history, and status actions use the configured restaurant
database rather than sample dashboard data.

## Notifications

The API persists notification events as part of order creation and admin status
updates. Admin clients can use:

- `GET /api/admin/notifications/latest` to get the current event cursor.
- `GET /api/admin/notifications?afterId=<cursor>&limit=25` to retrieve new
  events. The optional limit must be from 1 to 100. These routes require an
  authenticated admin session.

The admin application checks for events every four seconds while the dashboard
is open. New orders show in its live alert list; administrators can opt into a
short in-browser sound and browser desktop notifications. Desktop notifications
require explicit permission and a supported browser. They are foreground
browser notifications, not background Web Push.

After checkout, the demo storefront opens an EventSource connection to
`GET /api/orders/:reference/events`. The reference is a random, high-entropy
capability; treat it like a private tracking link. The stream only returns
status and event timestamps, never customer contact or address data. Keep the
confirmation page open to see updates; reconnecting browsers resume using
Server-Sent Events' event ID. A client can build its own branded UI around this
endpoint.

For a complete customer-facing tracking page, the API also provides
`GET /api/orders/:reference`. It returns restaurant branding and currency,
order items and totals, current status, and a status timeline. It does not
include customer name, phone, address, delivery instructions, internal IDs, or
admin notes. Unknown references return `404 ORDER_NOT_FOUND`, and responses
are marked `Cache-Control: no-store`. The demo storefront links to
`/track/:reference` after checkout and shows this data with live status updates.

The checkout response and confirmation page provide the order confirmation.
There is no email, SMS, WhatsApp, or background push provider configured, so
the system does not claim those notifications were sent. Add a real provider
adapter and explicit delivery results before promising those channels. The
event log is an internal source for admin alerts and live customer status
updates, not proof of external delivery.
