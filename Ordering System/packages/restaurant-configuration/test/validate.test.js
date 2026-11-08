import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConfigurationValidationError,
  validateRestaurantConfig,
} from '../src/index.js';

const validConfiguration = {
  restaurant: {
    slug: 'sample-restaurant',
    name: 'Sample Restaurant',
    logoUrl: null,
    brandColors: { primary: '#112233', secondary: '#445566' },
    contact: {
      phone: '+10000000000',
      email: 'hello@example.com',
      address: 'Example address',
    },
    currency: 'USD',
  },
  settings: {
    deliveryFeeCents: 250,
    minimumOrderCents: 1000,
    businessHours: {
      monday: null,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    },
    paymentMethods: ['cash_on_delivery'],
  },
  categories: [{ id: 'mains', name: 'Mains' }],
  products: [
    {
      id: 'house-meal',
      categoryId: 'mains',
      name: 'House Meal',
      description: '',
      imageUrl: null,
      priceCents: 1250,
      available: true,
      options: [
        {
          id: 'size',
          name: 'Size',
          selectionType: 'single',
          choices: [
            { id: 'regular', name: 'Regular', priceDeltaCents: 0 },
            { id: 'small', name: 'Small', priceDeltaCents: -100 },
          ],
        },
      ],
    },
  ],
};

test('accepts a valid restaurant configuration without changing it', () => {
  assert.equal(validateRestaurantConfig(validConfiguration), validConfiguration);
});

test('reports invalid prices and category references', () => {
  const configuration = structuredClone(validConfiguration);
  configuration.products[0].priceCents = 1.5;
  configuration.products[0].categoryId = 'missing';

  assert.throws(
    () => validateRestaurantConfig(configuration),
    (error) =>
      error instanceof ConfigurationValidationError &&
      error.errors.some((message) => message.includes('priceCents')) &&
      error.errors.some((message) => message.includes('configured category')),
  );
});
