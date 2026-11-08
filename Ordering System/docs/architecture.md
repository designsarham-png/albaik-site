# Architecture overview

The project is an npm-workspaces monorepo. The apps provide runnable entry
points; packages are intended for reusable engine and integration code.
Restaurant-specific branding and product configuration must remain outside
the core ordering logic.

## Workspace map

| Path | Responsibility |
| --- | --- |
| `apps/api` | Express API entry point and server-side features |
| `apps/admin` | Restaurant administration web application |
| `apps/demo-storefront` | Example customer-facing React integration |
| `packages/ordering-engine` | Shared cart, checkout, and tracking behavior |
| `packages/frontend-components` | Framework-independent API client and optional React hooks |
| `packages/shared-utilities` | Shared validation and formatting helpers |
| `packages/restaurant-configuration` | Restaurant settings and configuration format |
| `apps/api/src/notifications` | Transaction-backed notification events and delivery endpoints |
| `database` | Database migrations and operational guidance |
| `docs` | Setup, architecture, integration, and deployment guides |

Each client should be deployed independently with its own API configuration
and database. The API opens SQLite through `apps/api/src/database` and applies
the versioned migrations under `database/migrations` at startup. The migrations
create the restaurant catalog, orders and status history, admin authentication,
and notification-event tables. Notification events are written in the same
transaction as their order or status change, so the notification feed cannot
report a change that was not saved.

The admin dashboard polls its protected event feed while open. A customer who
has the high-entropy order reference can keep the confirmation page open to
receive status updates over Server-Sent Events. Browser notifications and
sound are opt-in. This does not yet send email, SMS, WhatsApp, or background
Web Push; those require a configured delivery provider and must report provider
success/failure explicitly.

Restaurant websites integrate through the `@restaurant/frontend-components`
API client and `@restaurant/ordering-engine` cart operations. They choose their
own components and styles. The shared frontend package provides data access
and optional state hooks, not mandatory branded UI.
