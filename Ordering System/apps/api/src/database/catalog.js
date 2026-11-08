import { validateRestaurantConfig } from '@restaurant/restaurant-configuration';

function isConstraintError(error) {
  return error && error.code?.startsWith('SQLITE_CONSTRAINT');
}

export function importRestaurantConfig(database, configuration) {
  validateRestaurantConfig(configuration);

  const { restaurant, settings, categories, products } = configuration;
  const restaurantId = restaurant.slug;
  const existingRestaurant = database
    .prepare('SELECT id FROM restaurants LIMIT 1')
    .get();

  if (existingRestaurant && existingRestaurant.id !== restaurantId) {
    throw new Error(
      'This database is already configured for another restaurant. Use a separate database for each restaurant.',
    );
  }

  const upsertRestaurant = database.prepare(`
    INSERT INTO restaurants (
      id, slug, name, logo_url, primary_color, secondary_color, contact_phone,
      contact_email, contact_address, currency, business_hours_json
    ) VALUES (
      @id, @slug, @name, @logoUrl, @primaryColor, @secondaryColor, @phone,
      @email, @address, @currency, @businessHours
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      logo_url = excluded.logo_url,
      primary_color = excluded.primary_color,
      secondary_color = excluded.secondary_color,
      contact_phone = excluded.contact_phone,
      contact_email = excluded.contact_email,
      contact_address = excluded.contact_address,
      currency = excluded.currency,
      business_hours_json = excluded.business_hours_json
  `);
  const upsertSettings = database.prepare(`
    INSERT INTO restaurant_settings (
      restaurant_id, delivery_fee_cents, minimum_order_cents, payment_methods_json
    ) VALUES (@restaurantId, @deliveryFeeCents, @minimumOrderCents, @paymentMethods)
    ON CONFLICT(restaurant_id) DO UPDATE SET
      delivery_fee_cents = excluded.delivery_fee_cents,
      minimum_order_cents = excluded.minimum_order_cents,
      payment_methods_json = excluded.payment_methods_json
  `);
  const upsertCategory = database.prepare(`
    INSERT INTO categories (
      id, restaurant_id, name, description, sort_order, active
    ) VALUES (@id, @restaurantId, @name, @description, @sortOrder, @active)
    ON CONFLICT(restaurant_id, id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      sort_order = excluded.sort_order,
      active = excluded.active
  `);
  const upsertProduct = database.prepare(`
    INSERT INTO products (
      id, restaurant_id, category_id, name, description, image_url, price_cents,
      available, sort_order
    ) VALUES (
      @id, @restaurantId, @categoryId, @name, @description, @imageUrl,
      @priceCents, @available, @sortOrder
    )
    ON CONFLICT(restaurant_id, id) DO UPDATE SET
      category_id = excluded.category_id,
      name = excluded.name,
      description = excluded.description,
      image_url = excluded.image_url,
      price_cents = excluded.price_cents,
      available = excluded.available,
      sort_order = excluded.sort_order
  `);
  const upsertOption = database.prepare(`
    INSERT INTO product_options (
      id, restaurant_id, product_id, name, selection_type, required,
      min_selections, max_selections, sort_order
    ) VALUES (
      @id, @restaurantId, @productId, @name, @selectionType, @required,
      @minSelections, @maxSelections, @sortOrder
    )
    ON CONFLICT(restaurant_id, id) DO UPDATE SET
      product_id = excluded.product_id,
      name = excluded.name,
      selection_type = excluded.selection_type,
      required = excluded.required,
      min_selections = excluded.min_selections,
      max_selections = excluded.max_selections,
      sort_order = excluded.sort_order
  `);
  const upsertChoice = database.prepare(`
    INSERT INTO product_option_choices (
      id, restaurant_id, option_id, name, price_delta_cents, available, sort_order
    ) VALUES (
      @id, @restaurantId, @optionId, @name, @priceDeltaCents, @available,
      @sortOrder
    )
    ON CONFLICT(restaurant_id, id) DO UPDATE SET
      option_id = excluded.option_id,
      name = excluded.name,
      price_delta_cents = excluded.price_delta_cents,
      available = excluded.available,
      sort_order = excluded.sort_order
  `);
  const deleteUnconfiguredChoices = database.prepare(`
    DELETE FROM product_option_choices
    WHERE restaurant_id = ? AND option_id = ?
  `);
  const deleteUnconfiguredProducts = database.prepare(`
    DELETE FROM products
    WHERE restaurant_id = ?
      AND id NOT IN (SELECT value FROM json_each(?))
  `);
  const deleteUnconfiguredCategories = database.prepare(`
    DELETE FROM categories
    WHERE restaurant_id = ?
      AND id NOT IN (SELECT value FROM json_each(?))
  `);

  const persistConfiguration = database.transaction(() => {
    upsertRestaurant.run({
      id: restaurantId,
      slug: restaurant.slug,
      name: restaurant.name,
      logoUrl: restaurant.logoUrl ?? null,
      primaryColor: restaurant.brandColors.primary,
      secondaryColor: restaurant.brandColors.secondary,
      phone: restaurant.contact.phone,
      email: restaurant.contact.email,
      address: restaurant.contact.address,
      currency: restaurant.currency,
      businessHours: JSON.stringify(settings.businessHours),
    });
    upsertSettings.run({
      restaurantId,
      deliveryFeeCents: settings.deliveryFeeCents,
      minimumOrderCents: settings.minimumOrderCents,
      paymentMethods: JSON.stringify(settings.paymentMethods),
    });

    categories.forEach((category, index) => {
      upsertCategory.run({
        id: category.id,
        restaurantId,
        name: category.name,
        description: category.description ?? '',
        sortOrder: category.sortOrder ?? index,
        active: category.active === false ? 0 : 1,
      });
    });

    products.forEach((product, index) => {
      upsertProduct.run({
        id: product.id,
        restaurantId,
        categoryId: product.categoryId,
        name: product.name,
        description: product.description,
        imageUrl: product.imageUrl ?? null,
        priceCents: product.priceCents,
        available: product.available ? 1 : 0,
        sortOrder: product.sortOrder ?? index,
      });

      const currentOptions = product.options ?? [];
      currentOptions.forEach((option, optionIndex) => {
        const minSelections =
          option.minSelections ?? (option.required ? 1 : 0);
        const maxSelections = option.maxSelections ?? 1;
        upsertOption.run({
          id: option.id,
          restaurantId,
          productId: product.id,
          name: option.name,
          selectionType: option.selectionType,
          required: option.required ? 1 : 0,
          minSelections,
          maxSelections,
          sortOrder: option.sortOrder ?? optionIndex,
        });

        deleteUnconfiguredChoices.run(restaurantId, option.id);
        option.choices.forEach((choice, choiceIndex) => {
          upsertChoice.run({
            id: choice.id,
            restaurantId,
            optionId: option.id,
            name: choice.name,
            priceDeltaCents: choice.priceDeltaCents,
            available: choice.available === false ? 0 : 1,
            sortOrder: choice.sortOrder ?? choiceIndex,
          });
        });
      });
      if (currentOptions.length > 0) {
        const optionIds = currentOptions.map((option) => option.id);
        database
          .prepare(
            `DELETE FROM product_options
             WHERE restaurant_id = ? AND product_id = ?
               AND id NOT IN (SELECT value FROM json_each(?))`,
          )
          .run(restaurantId, product.id, JSON.stringify(optionIds));
      } else {
        database
          .prepare(
            'DELETE FROM product_options WHERE restaurant_id = ? AND product_id = ?',
          )
          .run(restaurantId, product.id);
      }
    });

    deleteUnconfiguredProducts.run(
      restaurantId,
      JSON.stringify(products.map((product) => product.id)),
    );
    deleteUnconfiguredCategories.run(
      restaurantId,
      JSON.stringify(categories.map((category) => category.id)),
    );
  });

  try {
    persistConfiguration();
  } catch (error) {
    if (isConstraintError(error)) {
      throw new Error(
        'The configuration conflicts with existing catalog records. Check for duplicate category names and globally unique option or choice IDs.',
        { cause: error },
      );
    }
    throw error;
  }
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Stored ${label} is invalid JSON.`, { cause: error });
  }
}

function getCatalogCategories(database, restaurantId) {
  const categories = database
    .prepare(`
      SELECT id, name, description, sort_order AS sortOrder
      FROM categories
      WHERE restaurant_id = ? AND active = 1
      ORDER BY sort_order, name
    `)
    .all(restaurantId);
  const productsByCategory = new Map(
    categories.map((category) => [category.id, []]),
  );
  const products = database
    .prepare(`
      SELECT id, category_id AS categoryId, name, description, image_url AS imageUrl,
        price_cents AS priceCents, available, sort_order AS sortOrder
      FROM products
      WHERE restaurant_id = ?
        AND category_id IN (
          SELECT id FROM categories WHERE restaurant_id = ? AND active = 1
        )
      ORDER BY sort_order, name
    `)
    .all(restaurantId, restaurantId);
  const productOptions = database.prepare(`
    SELECT id, name, selection_type AS selectionType, required,
      min_selections AS minSelections, max_selections AS maxSelections,
      sort_order AS sortOrder
    FROM product_options
    WHERE restaurant_id = ? AND product_id = ?
    ORDER BY sort_order, name
  `);
  const optionChoices = database.prepare(`
    SELECT id, name, price_delta_cents AS priceDeltaCents,
      available, sort_order AS sortOrder
    FROM product_option_choices
    WHERE restaurant_id = ? AND option_id = ?
    ORDER BY sort_order, name
  `);

  for (const product of products) {
    const options = productOptions.all(restaurantId, product.id).map((option) => ({
      ...option,
      required: Boolean(option.required),
      choices: optionChoices
        .all(restaurantId, option.id)
        .map((choice) => ({
          ...choice,
          available: Boolean(choice.available),
        })),
    }));
    productsByCategory.get(product.categoryId).push({
      ...product,
      available: Boolean(product.available),
      options,
    });
  }

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    description: category.description,
    products: productsByCategory.get(category.id),
  }));
}

export function getCatalog(database) {
  const restaurant = database
    .prepare(`
      SELECT id, slug, name, logo_url AS logoUrl, primary_color AS primaryColor,
        secondary_color AS secondaryColor, contact_phone AS phone,
        contact_email AS email, contact_address AS address, currency,
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
      paymentMethods: parseJson(settings.paymentMethods, 'payment methods'),
      businessHours: parseJson(restaurant.businessHours, 'business hours'),
    },
    categories: getCatalogCategories(database, restaurant.id),
  };
}

export function getCategories(database) {
  const catalog = getCatalog(database);
  return catalog?.categories ?? null;
}

export function getProducts(database, categoryId) {
  const categories = getCategories(database);
  if (!categories) {
    return null;
  }
  const filteredCategories = categoryId
    ? categories.filter((category) => category.id === categoryId)
    : categories;
  return filteredCategories.flatMap((category) =>
    category.products.map((product) => ({
      ...product,
      category: { id: category.id, name: category.name },
    })),
  );
}
