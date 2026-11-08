import express from 'express';
import cors from 'cors';
import { getCategories, getCatalog, getProducts } from './database/catalog.js';
import { createOrder, OrderRequestError } from './database/orders.js';
import {
  createAdminAuthRouter,
  createAdminSessionMiddleware,
} from './auth/admin-auth.js';
import { createAdminOrdersRouter } from './database/admin-orders.js';
import {
  createAdminNotificationsRouter,
  createCustomerNotificationHandler,
} from './notifications/notifications.js';
import { createCustomerTrackingRouter } from './database/customer-tracking.js';
import { createAdminConfigurationRouter } from './database/admin-configuration.js';

export function createApp(
  database = null,
  appOptions = {},
) {
  const options = Array.isArray(appOptions)
    ? { allowedOrigins: appOptions }
    : appOptions;
  const allowedOrigins =
    options.allowedOrigins ??
    (process.env.CORS_ORIGINS ??
      'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://localhost:5174')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  const app = express();

  if (database && !options.sessionSecret) {
    throw new Error(
      'A session secret is required when the API database is enabled.',
    );
  }

  app.disable('x-powered-by');
  if (options.trustProxy) {
    app.set('trust proxy', 1);
  }
  app.use(
    cors({
      methods: ['GET', 'POST', 'PATCH', 'PUT'],
      credentials: true,
      origin(origin, callback) {
        callback(null, !origin || allowedOrigins.includes(origin));
      },
    }),
  );
  app.use(express.json({ limit: '64kb' }));

  if (database && options.sessionSecret) {
    const adminSession = createAdminSessionMiddleware(database, {
      sessionSecret: options.sessionSecret,
      secureCookies: options.secureCookies ?? false,
      trustProxy: options.trustProxy ?? false,
    });
    app.locals.adminSessionStore = adminSession.store;
    app.use(adminSession.middleware);
    app.use(
      '/api/admin',
      createAdminAuthRouter(database, {
        cookieName: adminSession.cookieName,
        cookieOptions: adminSession.cookieOptions,
      }),
    );
    app.use('/api/admin', createAdminOrdersRouter(database));
    app.use('/api/admin', createAdminConfigurationRouter(database));
    app.use(
      '/api/admin',
      createAdminNotificationsRouter(database),
    );
    app.get(
      '/api/orders/:reference/events',
      createCustomerNotificationHandler(database),
    );
    app.use('/api', createCustomerTrackingRouter(database));
  }

  app.get('/api/health', (request, response) => {
    response.json({ status: 'ok' });
  });

  app.get('/api/catalog', (request, response) => {
    if (!database) {
      return response.status(503).json({
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'The catalog database is not available.',
        },
      });
    }
    const catalog = getCatalog(database);
    if (!catalog) {
      return response.status(503).json({
        error: {
          code: 'CATALOG_NOT_CONFIGURED',
          message: 'This restaurant catalog has not been configured yet.',
        },
      });
    }
    return response.json(catalog);
  });

  app.get('/api/categories', (request, response) => {
    if (!database) {
      return response.status(503).json({
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'The catalog database is not available.',
        },
      });
    }
    const categories = getCategories(database);
    if (!categories) {
      return response.status(503).json({
        error: {
          code: 'CATALOG_NOT_CONFIGURED',
          message: 'This restaurant catalog has not been configured yet.',
        },
      });
    }
    return response.json({ categories });
  });

  app.get('/api/products', (request, response) => {
    if (!database) {
      return response.status(503).json({
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'The catalog database is not available.',
        },
      });
    }
    const { categoryId } = request.query;
    if (categoryId !== undefined && typeof categoryId !== 'string') {
      return response.status(400).json({
        error: {
          code: 'INVALID_CATEGORY_FILTER',
          message: 'categoryId must be a single category identifier.',
        },
      });
    }

    const products = getProducts(database, categoryId);
    if (!products) {
      return response.status(503).json({
        error: {
          code: 'CATALOG_NOT_CONFIGURED',
          message: 'This restaurant catalog has not been configured yet.',
        },
      });
    }
    return response.json({ products });
  });

  app.post('/api/orders', (request, response, next) => {
    if (!database) {
      return response.status(503).json({
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'The order database is not available.',
        },
      });
    }

    try {
      const order = createOrder(
        database,
        request.body,
        request.get('Idempotency-Key'),
      );
      return response.status(order.replayed ? 200 : 201).json({ order });
    } catch (error) {
      if (error instanceof OrderRequestError) {
        return response.status(error.status).json({
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }
      return next(error);
    }
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) {
      return next(error);
    }
    if (error instanceof SyntaxError && 'body' in error) {
      return response.status(400).json({
        error: {
          code: 'INVALID_JSON',
          message: 'Request body must contain valid JSON.',
        },
      });
    }
    if (error.status === 413) {
      return response.status(413).json({
        error: {
          code: 'REQUEST_TOO_LARGE',
          message: 'Request body is too large.',
        },
      });
    }
    console.error('Unhandled API error:', error);
    return response.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected server error occurred.',
      },
    });
  });

  return app;
}

export default createApp();
