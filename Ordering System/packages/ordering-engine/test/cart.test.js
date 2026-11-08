import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addCartItem,
  createCartItem,
  getCartSummary,
  removeCartItem,
  setCartItemQuantity,
} from '../src/index.js';

const product = {
  id: 'sandwich',
  name: 'Garden Sandwich',
  description: 'Grilled vegetables',
  priceCents: 850,
  available: true,
  options: [
    {
      id: 'bread',
      name: 'Bread',
      selectionType: 'single',
      required: true,
      minSelections: 1,
      maxSelections: 1,
      choices: [
        { id: 'white', name: 'White', priceDeltaCents: 0 },
        { id: 'wholegrain', name: 'Whole grain', priceDeltaCents: 50 },
      ],
    },
    {
      id: 'extras',
      name: 'Extras',
      selectionType: 'multiple',
      required: false,
      minSelections: 0,
      maxSelections: 2,
      choices: [
        { id: 'avocado', name: 'Avocado', priceDeltaCents: 125 },
        { id: 'cheese', name: 'Cheese', priceDeltaCents: 75 },
        { id: 'tomato', name: 'Tomato', priceDeltaCents: 0 },
      ],
    },
  ],
};

test('creates a configured cart item with server catalog option prices', () => {
  const item = createCartItem(product, ['wholegrain', 'avocado']);

  assert.equal(item.unitPriceCents, 1025);
  assert.equal(item.quantity, 1);
  assert.equal(item.selectedOptions[0].choices[0].choiceId, 'wholegrain');
});

test('requires valid selections and rejects unavailable products or choices', () => {
  assert.throws(() => createCartItem(product), /Choose between 1 and 1/);
  assert.throws(
    () => createCartItem(product, ['white', 'wholegrain']),
    /Choose between 1 and 1/,
  );
  assert.throws(() => createCartItem(product, ['white', 'unknown']), /Unknown option choice/);
  assert.throws(
    () =>
      createCartItem(
        {
          ...product,
          options: [
            {
              id: 'drink',
              name: 'Drink',
              selectionType: 'single',
              choices: [
                {
                  id: 'cola',
                  name: 'Cola',
                  priceDeltaCents: 0,
                  available: false,
                },
              ],
            },
          ],
        },
        ['cola'],
      ),
    /unavailable/,
  );
  assert.throws(
    () => createCartItem({ ...product, available: false }, ['white']),
    /unavailable/,
  );
});

test('merges identical selections but keeps different options separate', () => {
  const withWhite = addCartItem([], product, ['white']);
  const merged = addCartItem(withWhite, product, ['white']);
  const separate = addCartItem(merged, product, ['wholegrain']);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].quantity, 2);
  assert.equal(separate.length, 2);
});

test('updates quantities, removes zero-quantity items, and summarizes totals', () => {
  const cart = addCartItem([], product, ['wholegrain', 'cheese']);
  const doubled = setCartItemQuantity(cart, cart[0].key, 2);

  assert.deepEqual(getCartSummary(doubled), {
    itemCount: 2,
    subtotalCents: 1950,
    totalCents: 1950,
  });
  assert.deepEqual(setCartItemQuantity(doubled, cart[0].key, 0), []);
  assert.deepEqual(removeCartItem(doubled, cart[0].key), []);
  assert.deepEqual(getCartSummary([]), {
    itemCount: 0,
    subtotalCents: 0,
    totalCents: 0,
  });
});
