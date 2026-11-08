const identifierKey = (identifier) => `${typeof identifier}:${identifier}`;

function assertSafeInteger(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be a safe integer.`);
  }
}

function normalizeSelections(product, selectedChoiceIds) {
  if (!Array.isArray(selectedChoiceIds)) {
    throw new TypeError('Selected option choices must be an array.');
  }

  const selectedIds = new Set(selectedChoiceIds);
  if (selectedIds.size !== selectedChoiceIds.length) {
    throw new Error('An option choice cannot be selected more than once.');
  }

  const options = product.options ?? [];
  const knownChoices = new Map();
  const selections = [];

  for (const option of options) {
    const optionChoices = option.choices ?? [];
    for (const choice of optionChoices) {
      if (knownChoices.has(choice.id)) {
        throw new Error(`Duplicate option choice identifier "${choice.id}".`);
      }
      knownChoices.set(choice.id, { option, choice });
    }

    const choices = optionChoices.filter((choice) =>
      selectedIds.has(choice.id),
    );
    for (const choice of choices) {
      if (choice.available === false) {
        throw new Error(`Option choice "${choice.id}" is unavailable.`);
      }
      assertSafeInteger(choice.priceDeltaCents, 'Option price adjustment');
    }
    const minSelections =
      option.minSelections ?? (option.required ? 1 : 0);
    const maxSelections = option.maxSelections ?? 1;
    if (choices.length < minSelections || choices.length > maxSelections) {
      throw new Error(
        `Choose between ${minSelections} and ${maxSelections} options for ${option.name}.`,
      );
    }
    if (option.selectionType === 'single' && choices.length > 1) {
      throw new Error(`Choose only one option for ${option.name}.`);
    }
    if (
      choices.length > 0 ||
      option.required ||
      minSelections > 0
    ) {
      selections.push({
        optionId: option.id,
        name: option.name,
        choices: choices.map((choice) => ({
          choiceId: choice.id,
          name: choice.name,
          priceDeltaCents: choice.priceDeltaCents,
        })),
      });
    }
  }

  for (const choiceId of selectedIds) {
    if (!knownChoices.has(choiceId)) {
      throw new Error(`Unknown option choice "${choiceId}".`);
    }
  }

  return selections;
}

function calculateUnitPrice(product, selections) {
  assertSafeInteger(product.priceCents, 'Product price');
  if (product.priceCents < 0) {
    throw new RangeError('Product price cannot be negative.');
  }

  const unitPriceCents = selections.reduce(
    (total, selection) =>
      selection.choices.reduce(
        (optionTotal, choice) =>
          optionTotal + choice.priceDeltaCents,
        total,
      ),
    product.priceCents,
  );
  assertSafeInteger(unitPriceCents, 'Configured product price');
  if (unitPriceCents < 0) {
    throw new RangeError('Configured product price cannot be negative.');
  }
  return unitPriceCents;
}

export function createCartItem(product, selectedChoiceIds = []) {
  if (!product || typeof product !== 'object') {
    throw new TypeError('A product is required.');
  }
  if (product.available === false) {
    throw new Error('This product is unavailable.');
  }
  if (typeof product.id !== 'string' || product.id.length === 0) {
    throw new TypeError('Product must have an identifier.');
  }
  if (typeof product.name !== 'string' || product.name.length === 0) {
    throw new TypeError('Product must have a name.');
  }

  const selections = normalizeSelections(product, selectedChoiceIds);
  const unitPriceCents = calculateUnitPrice(product, selections);
  const selectionKey = selections
    .map(
      (selection) =>
        `${identifierKey(selection.optionId)}=${selection.choices
          .map((choice) => identifierKey(choice.choiceId))
          .sort()
          .join(',')}`,
    )
    .sort()
    .join('|');

  return {
    key: `${identifierKey(product.id)}|${selectionKey}`,
    productId: product.id,
    name: product.name,
    description: product.description ?? '',
    imageUrl: product.imageUrl ?? null,
    unitPriceCents,
    quantity: 1,
    selectedOptions: selections,
  };
}

export function addCartItem(cart, product, selectedChoiceIds = []) {
  if (!Array.isArray(cart)) {
    throw new TypeError('Cart must be an array.');
  }
  const item = createCartItem(product, selectedChoiceIds);
  const existingIndex = cart.findIndex((entry) => entry.key === item.key);
  if (existingIndex < 0) {
    return [...cart, item];
  }

  const existing = cart[existingIndex];
  assertSafeInteger(existing.quantity, 'Cart item quantity');
  const quantity = existing.quantity + 1;
  assertSafeInteger(quantity, 'Cart item quantity');
  return cart.map((entry, index) =>
    index === existingIndex ? { ...existing, quantity } : entry,
  );
}

export function removeCartItem(cart, key) {
  if (!Array.isArray(cart)) {
    throw new TypeError('Cart must be an array.');
  }
  return cart.filter((item) => item.key !== key);
}

export function setCartItemQuantity(cart, key, quantity) {
  if (!Array.isArray(cart)) {
    throw new TypeError('Cart must be an array.');
  }
  assertSafeInteger(quantity, 'Cart item quantity');
  if (quantity < 0) {
    throw new RangeError('Cart item quantity cannot be negative.');
  }
  if (quantity === 0) {
    return removeCartItem(cart, key);
  }
  return cart.map((item) =>
    item.key === key ? { ...item, quantity } : item,
  );
}

export function getCartSummary(cart) {
  if (!Array.isArray(cart)) {
    throw new TypeError('Cart must be an array.');
  }

  const summary = cart.reduce(
    (total, item) => {
      assertSafeInteger(item.quantity, 'Cart item quantity');
      assertSafeInteger(item.unitPriceCents, 'Cart item price');
      if (item.quantity < 1 || item.unitPriceCents < 0) {
        throw new RangeError('Cart items need a positive quantity and price.');
      }
      const lineTotal = item.unitPriceCents * item.quantity;
      assertSafeInteger(lineTotal, 'Cart line total');
      total.subtotalCents += lineTotal;
      total.itemCount += item.quantity;
      assertSafeInteger(total.subtotalCents, 'Cart subtotal');
      assertSafeInteger(total.itemCount, 'Cart item count');
      return total;
    },
    { itemCount: 0, subtotalCents: 0 },
  );

  return {
    ...summary,
    totalCents: summary.subtotalCents,
  };
}
