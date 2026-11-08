const identifierPattern = /^[a-z0-9][a-z0-9_-]*$/;
const colorPattern = /^#[\da-f]{6}$/i;
const currencyPattern = /^[A-Z]{3}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ConfigurationValidationError extends Error {
  constructor(errors) {
    super(`Invalid restaurant configuration: ${errors.join('; ')}`);
    this.name = 'ConfigurationValidationError';
    this.errors = errors;
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value, path, errors) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  return true;
}

function requireText(value, path, errors, { allowEmpty = false } = {}) {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.trim().length === 0)
  ) {
    errors.push(`${path} must be a non-empty string`);
    return false;
  }
  return true;
}

function requireIdentifier(value, path, errors) {
  if (!requireText(value, path, errors)) {
    return false;
  }
  if (!identifierPattern.test(value)) {
    errors.push(`${path} may contain lowercase letters, numbers, "_" and "-"`);
    return false;
  }
  return true;
}

function requireNonNegativeInteger(value, path, errors) {
  if (!Number.isSafeInteger(value) || value < 0) {
    errors.push(`${path} must be a non-negative safe integer`);
    return false;
  }
  return true;
}

function requireInteger(value, path, errors) {
  if (!Number.isSafeInteger(value)) {
    errors.push(`${path} must be a safe integer`);
    return false;
  }
  return true;
}

function validateSortOrder(record, path, errors) {
  if (
    record.sortOrder !== undefined &&
    (!Number.isSafeInteger(record.sortOrder) || record.sortOrder < 0)
  ) {
    errors.push(`${path}.sortOrder must be a non-negative safe integer`);
  }
}

function validateRestaurant(restaurant, errors) {
  if (!requireRecord(restaurant, 'restaurant', errors)) {
    return;
  }
  requireIdentifier(restaurant.slug, 'restaurant.slug', errors);
  requireText(restaurant.name, 'restaurant.name', errors);
  if (restaurant.logoUrl !== null && restaurant.logoUrl !== undefined) {
    requireText(restaurant.logoUrl, 'restaurant.logoUrl', errors);
  }
  if (requireRecord(restaurant.brandColors, 'restaurant.brandColors', errors)) {
    for (const key of ['primary', 'secondary']) {
      if (
        typeof restaurant.brandColors[key] !== 'string' ||
        !colorPattern.test(restaurant.brandColors[key])
      ) {
        errors.push(`restaurant.brandColors.${key} must be a hex color such as #112233`);
      }
    }
  }
  if (requireRecord(restaurant.contact, 'restaurant.contact', errors)) {
    for (const key of ['phone', 'email', 'address']) {
      requireText(restaurant.contact[key], `restaurant.contact.${key}`, errors);
    }
    if (
      typeof restaurant.contact.email === 'string' &&
      !emailPattern.test(restaurant.contact.email)
    ) {
      errors.push('restaurant.contact.email must be a valid email address');
    }
  }
  if (
    typeof restaurant.currency !== 'string' ||
    !currencyPattern.test(restaurant.currency)
  ) {
    errors.push('restaurant.currency must be a three-letter uppercase currency code');
  }
}

function validateSettings(settings, errors) {
  if (!requireRecord(settings, 'settings', errors)) {
    return;
  }
  requireNonNegativeInteger(
    settings.deliveryFeeCents,
    'settings.deliveryFeeCents',
    errors,
  );
  requireNonNegativeInteger(
    settings.minimumOrderCents,
    'settings.minimumOrderCents',
    errors,
  );
  const weekdays = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ];
  if (!isRecord(settings.businessHours)) {
    errors.push('settings.businessHours must be an object');
  } else {
    for (const day of weekdays) {
      const hours = settings.businessHours[day];
      if (hours === null) {
        continue;
      }
      if (
        !isRecord(hours) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(hours.open ?? '') ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(hours.close ?? '')
      ) {
        errors.push(
          `settings.businessHours.${day} must be null or contain open and close times in HH:mm format`,
        );
      }
    }
  }
  if (
    !Array.isArray(settings.paymentMethods) ||
    settings.paymentMethods.length === 0 ||
    settings.paymentMethods.some(
      (method) => typeof method !== 'string' || method.trim().length === 0,
    )
  ) {
    errors.push('settings.paymentMethods must be a non-empty array of names');
  }
}

function validateCategories(categories, errors) {
  if (!Array.isArray(categories)) {
    errors.push('categories must be an array');
    return new Set();
  }
  const ids = new Set();
  categories.forEach((category, index) => {
    const path = `categories[${index}]`;
    if (!requireRecord(category, path, errors)) {
      return;
    }
    if (requireIdentifier(category.id, `${path}.id`, errors)) {
      if (ids.has(category.id)) {
        errors.push(`${path}.id must be unique`);
      }
      ids.add(category.id);
    }
    requireText(category.name, `${path}.name`, errors);
    validateSortOrder(category, path, errors);
    if (category.active !== undefined && typeof category.active !== 'boolean') {
      errors.push(`${path}.active must be a boolean`);
    }
    if (
      category.description !== undefined &&
      typeof category.description !== 'string'
    ) {
      errors.push(`${path}.description must be a string`);
    }
  });
  return ids;
}

function validateOptions(options, path, errors, optionIds, choiceIds) {
  if (options === undefined) {
    return;
  }
  if (!Array.isArray(options)) {
    errors.push(`${path} must be an array`);
    return;
  }
  options.forEach((option, index) => {
    const optionPath = `${path}[${index}]`;
    if (!requireRecord(option, optionPath, errors)) {
      return;
    }
    if (requireIdentifier(option.id, `${optionPath}.id`, errors)) {
      if (optionIds.has(option.id)) {
        errors.push(`${optionPath}.id must be unique across the restaurant`);
      }
      optionIds.add(option.id);
    }
    requireText(option.name, `${optionPath}.name`, errors);
    validateSortOrder(option, optionPath, errors);
    if (!['single', 'multiple'].includes(option.selectionType)) {
      errors.push(`${optionPath}.selectionType must be "single" or "multiple"`);
    }
    if (option.required !== undefined && typeof option.required !== 'boolean') {
      errors.push(`${optionPath}.required must be a boolean`);
    }
    const minSelections = option.minSelections ?? (option.required ? 1 : 0);
    const maxSelections = option.maxSelections ?? 1;
    if (
      !Number.isSafeInteger(minSelections) ||
      minSelections < 0 ||
      !Number.isSafeInteger(maxSelections) ||
      maxSelections < 1 ||
      minSelections > maxSelections ||
      (option.required === true && minSelections < 1) ||
      (option.selectionType === 'single' && maxSelections !== 1)
    ) {
      errors.push(`${optionPath} must have valid minSelections and maxSelections`);
    }
    if (!Array.isArray(option.choices) || option.choices.length === 0) {
      errors.push(`${optionPath}.choices must be a non-empty array`);
      return;
    }
    option.choices.forEach((choice, choiceIndex) => {
      const choicePath = `${optionPath}.choices[${choiceIndex}]`;
      if (!requireRecord(choice, choicePath, errors)) {
        return;
      }
      if (requireIdentifier(choice.id, `${choicePath}.id`, errors)) {
        if (choiceIds.has(choice.id)) {
          errors.push(`${choicePath}.id must be unique across the restaurant`);
        }
        choiceIds.add(choice.id);
      }
      requireText(choice.name, `${choicePath}.name`, errors);
      validateSortOrder(choice, choicePath, errors);
      if (
        choice.available !== undefined &&
        typeof choice.available !== 'boolean'
      ) {
        errors.push(`${choicePath}.available must be a boolean`);
      }
      requireInteger(
        choice.priceDeltaCents,
        `${choicePath}.priceDeltaCents`,
        errors,
      );
    });
    if (
      Array.isArray(option.choices) &&
      Number.isSafeInteger(maxSelections) &&
      maxSelections > option.choices.length
    ) {
      errors.push(`${optionPath}.maxSelections cannot exceed the number of choices`);
    }
  });
}

function validateProducts(products, categoryIds, errors) {
  if (!Array.isArray(products)) {
    errors.push('products must be an array');
    return;
  }
  const ids = new Set();
  const optionIds = new Set();
  const choiceIds = new Set();
  products.forEach((product, index) => {
    const path = `products[${index}]`;
    if (!requireRecord(product, path, errors)) {
      return;
    }
    if (requireIdentifier(product.id, `${path}.id`, errors)) {
      if (ids.has(product.id)) {
        errors.push(`${path}.id must be unique`);
      }
      validateSortOrder(product, path, errors);
      ids.add(product.id);
    }
    requireIdentifier(product.categoryId, `${path}.categoryId`, errors);
    if (
      typeof product.categoryId === 'string' &&
      !categoryIds.has(product.categoryId)
    ) {
      errors.push(`${path}.categoryId must reference a configured category`);
    }
    requireText(product.name, `${path}.name`, errors);
    requireText(product.description, `${path}.description`, errors, {
      allowEmpty: true,
    });
    if (product.imageUrl !== null && product.imageUrl !== undefined) {
      requireText(product.imageUrl, `${path}.imageUrl`, errors);
    }
    requireNonNegativeInteger(product.priceCents, `${path}.priceCents`, errors);
    if (typeof product.available !== 'boolean') {
      errors.push(`${path}.available must be a boolean`);
    }
    validateOptions(product.options, `${path}.options`, errors, optionIds, choiceIds);
  });
}

export function validateRestaurantConfig(configuration) {
  const errors = [];
  if (!requireRecord(configuration, 'configuration', errors)) {
    throw new ConfigurationValidationError(errors);
  }
  validateRestaurant(configuration.restaurant, errors);
  validateSettings(configuration.settings, errors);
  const categoryIds = validateCategories(configuration.categories, errors);
  validateProducts(configuration.products, categoryIds, errors);

  if (errors.length > 0) {
    throw new ConfigurationValidationError(errors);
  }
  return configuration;
}
