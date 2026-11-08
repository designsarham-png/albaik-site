import express from 'express';
import {
  ConfigurationValidationError,
  validateRestaurantConfig,
} from '@restaurant/restaurant-configuration';
import { requireAdmin, requireCsrf } from '../auth/admin-auth.js';
import { importRestaurantConfig } from './catalog.js';

function getRestaurantConfig(database) {
  const restaurant = database
    .prepare(`
      SELECT id, slug, name, logo_url AS logoUrl,
        primary_color AS primaryColor, secondary_color AS secondaryColor,
        contact_phone AS phone, contact_email AS email,
        contact_address AS address, currency,
        business_hours_json AS businessHours
      FROM restaurants
      LIMIT 1
    `)
    .get();
  if (!restaurant) {
    return null;
  }
  const settings = database
    .prepare(`
      SELECT delivery_fee_cents AS deliveryFeeCents,
        minimum_order_cents AS minimumOrderCents,
        payment_methods_json AS paymentMethods
      FROM restaurant_settings
      WHERE restaurant_id = ?
    `)
    .get(restaurant.id);
  if (!settings) {
    throw new Error('Restaurant settings are missing from the database.');
  }

  const categories = database
    .prepare(`
      SELECT id, name, description, sort_order AS sortOrder, active
      FROM categories
      WHERE restaurant_id = ?
      ORDER BY sort_order, name
    `)
    .all(restaurant.id)
    .map((category) => ({
      ...category,
      active: Boolean(category.active),
    }));
  const products = database
    .prepare(`
      SELECT id, category_id AS categoryId, name, description,
        image_url AS imageUrl, price_cents AS priceCents, available,
        sort_order AS sortOrder
      FROM products
      WHERE restaurant_id = ?
      ORDER BY sort_order, name
    `)
    .all(restaurant.id)
    .map((product) => {
      const options = database
        .prepare(`
          SELECT id, name, selection_type AS selectionType, required,
            min_selections AS minSelections,
            max_selections AS maxSelections, sort_order AS sortOrder
          FROM product_options
          WHERE restaurant_id = ? AND product_id = ?
          ORDER BY sort_order, name
        `)
        .all(restaurant.id, product.id)
        .map((option) => ({
          ...option,
          required: Boolean(option.required),
          choices: database
            .prepare(`
              SELECT id, name, price_delta_cents AS priceDeltaCents,
                available, sort_order AS sortOrder
              FROM product_option_choices
              WHERE restaurant_id = ? AND option_id = ?
              ORDER BY sort_order, name
            `)
            .all(restaurant.id, option.id)
            .map((choice) => ({
              ...choice,
              available: Boolean(choice.available),
            })),
        }));
      return {
        ...product,
        available: Boolean(product.available),
        options,
      };
    });

  return {
    restaurant: {
      slug: restaurant.slug,
      name: restaurant.name,
      logoUrl: restaurant.logoUrl,
      brandColors: {
        primary: restaurant.primaryColor,
        secondary: restaurant.secondaryColor,
      },
      contact: {
        phone: restaurant.phone,
        email: restaurant.email,
        address: restaurant.address,
      },
      currency: restaurant.currency,
    },
    settings: {
      deliveryFeeCents: settings.deliveryFeeCents,
      minimumOrderCents: settings.minimumOrderCents,
      businessHours: JSON.parse(restaurant.businessHours),
      paymentMethods: JSON.parse(settings.paymentMethods),
    },
    categories,
    products,
  };
}

export function createAdminConfigurationRouter(database) {
  const router = express.Router();

  router.get('/config', requireAdmin, (request, response) => {
    response.set('Cache-Control', 'no-store');
    const configuration = getRestaurantConfig(database);
    if (!configuration) {
      return response.status(503).json({
        error: {
          code: 'RESTAURANT_NOT_CONFIGURED',
          message: 'Configure this restaurant before editing its settings.',
        },
      });
    }
    return response.json({ configuration });
  });

  router.put('/config', requireAdmin, requireCsrf, (request, response) => {
    try {
      validateRestaurantConfig(request.body);
    } catch (error) {
      if (error instanceof ConfigurationValidationError) {
        return response.status(400).json({
          error: {
            code: 'INVALID_RESTAURANT_CONFIGURATION',
            message: error.message,
            details: error.errors,
          },
        });
      }
      throw error;
    }

    importRestaurantConfig(database, request.body);
    response.set('Cache-Control', 'no-store');
    return response.json({
      configuration: getRestaurantConfig(database),
      message: 'Restaurant configuration saved.',
    });
  });

  return router;
}

export { getRestaurantConfig };
