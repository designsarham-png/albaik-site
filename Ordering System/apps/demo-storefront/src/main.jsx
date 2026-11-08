import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useParams } from 'react-router-dom';
import {
  addCartItem,
  createCartItem,
  getCartSummary,
  removeCartItem,
  setCartItemQuantity,
} from '@restaurant/ordering-engine';
import { createOrderingClient } from '@restaurant/frontend-components';
import './styles.css';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
const orderingClient = createOrderingClient({ baseUrl: apiBaseUrl });

function formatPrice(priceCents, currency) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).format(priceCents / 100);
}

function getInitialChoiceIds(product) {
  return (product.options ?? []).flatMap((option) => {
    const minSelections =
      option.minSelections ?? (option.required ? 1 : 0);
    return (option.choices ?? [])
      .filter((choice) => choice.available !== false)
      .slice(0, minSelections)
      .map((choice) => choice.id);
  });
}

function ProductCard({ product, currency, onAdd }) {
  const [selectedChoiceIds, setSelectedChoiceIds] = useState(() =>
    getInitialChoiceIds(product),
  );
  const [addError, setAddError] = useState('');
  const options = product.options ?? [];
  const unmetOptions = options.filter((option) => {
    const selectedCount = option.choices.filter(
      (choice) =>
        selectedChoiceIds.includes(choice.id) && choice.available !== false,
    ).length;
    const minSelections =
      option.minSelections ?? (option.required ? 1 : 0);
    return (
      selectedCount < minSelections ||
      selectedCount > (option.maxSelections ?? 1)
    );
  });
  const canAdd = product.available && unmetOptions.length === 0;

  function setOptionChoices(option, choiceIds) {
    const optionChoiceIds = new Set(option.choices.map((choice) => choice.id));
    setSelectedChoiceIds((current) => [
      ...current.filter((id) => !optionChoiceIds.has(id)),
      ...choiceIds,
    ]);
  }

  function handleAdd() {
    try {
      createCartItem(product, selectedChoiceIds);
      onAdd(product, selectedChoiceIds);
      setAddError('');
    } catch (error) {
      setAddError(error.message || 'This item could not be added.');
    }
  }

  return (
    <article className={`product-card${product.available ? '' : ' is-unavailable'}`}>
      {product.imageUrl ? (
        <img className="product-image" src={product.imageUrl} alt="" />
      ) : (
        <div className="product-image-placeholder" aria-hidden="true">
          {product.name.slice(0, 1)}
        </div>
      )}
      <div className="product-copy">
        <div className="product-heading">
          <h3>{product.name}</h3>
          <span className="product-price">
            {formatPrice(product.priceCents, currency)}
          </span>
        </div>
        <p>{product.description}</p>
        {options.length > 0 && (
          <div className="product-option-list">
            {options.map((option) => {
              const selectedForOption = selectedChoiceIds.filter((id) =>
                option.choices.some((choice) => choice.id === id),
              );
              const selectedCount = selectedForOption.length;
              const minSelections =
                option.minSelections ?? (option.required ? 1 : 0);
              const maxSelections = option.maxSelections ?? 1;
              const isSingle = option.selectionType === 'single';

              return (
                <fieldset className="option-group" key={option.id}>
                  <legend>
                    {option.name}
                    {option.required ? ' · required' : ''}
                  </legend>
                  {isSingle ? (
                    <select
                      aria-label={option.name}
                      value={selectedForOption[0] ?? ''}
                      onChange={(event) =>
                        setOptionChoices(
                          option,
                          event.target.value ? [event.target.value] : [],
                        )
                      }
                      disabled={!product.available}
                    >
                      <option value="">Choose an option</option>
                      {option.choices.map((choice) => (
                        <option
                          key={choice.id}
                          value={choice.id}
                          disabled={choice.available === false}
                        >
                          {choice.name}
                          {choice.priceDeltaCents
                            ? ` (${choice.priceDeltaCents > 0 ? '+' : ''}${formatPrice(choice.priceDeltaCents, currency)})`
                            : ''}
                          {choice.available === false ? ' — unavailable' : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="option-choices">
                      {option.choices.map((choice) => {
                        const checked = selectedForOption.includes(choice.id);
                        const atLimit =
                          selectedCount >= maxSelections && !checked;
                        return (
                          <label
                            className="option-choice"
                            key={choice.id}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={
                                !product.available ||
                                choice.available === false ||
                                atLimit
                              }
                              onChange={(event) => {
                                const nextSelection = event.target.checked
                                  ? [...selectedForOption, choice.id]
                                  : selectedForOption.filter(
                                      (id) => id !== choice.id,
                                    );
                                setOptionChoices(option, nextSelection);
                              }}
                            />
                            <span>{choice.name}</span>
                            {choice.priceDeltaCents !== 0 && (
                              <span className="choice-price">
                                {choice.priceDeltaCents > 0 ? '+' : ''}
                                {formatPrice(choice.priceDeltaCents, currency)}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {minSelections > 0 && selectedCount < minSelections && (
                    <span className="option-hint">
                      Choose at least {minSelections}.
                    </span>
                  )}
                  {option.selectionType === 'multiple' && (
                    <span className="option-hint">
                      Choose up to {maxSelections}.
                    </span>
                  )}
                </fieldset>
              );
            })}
          </div>
        )}
        {!product.available && (
          <span className="availability">Currently unavailable</span>
        )}
        {addError && (
          <p className="add-error" role="alert">
            {addError}
          </p>
        )}
        <button
          className="add-to-cart"
          type="button"
          disabled={!canAdd}
          onClick={handleAdd}
        >
          {!product.available
            ? 'Unavailable'
            : unmetOptions.length > 0
              ? 'Choose required options'
              : 'Add to cart'}
        </button>
      </div>
    </article>
  );
}

function CheckoutForm({
  cart,
  currency,
  settings,
  onBack,
  onOrderComplete,
}) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [fulfillmentType, setFulfillmentType] = useState('delivery');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryInstructions, setDeliveryInstructions] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completedOrder, setCompletedOrder] = useState(null);
  const [liveStatus, setLiveStatus] = useState(null);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const attemptRef = useRef(null);
  const summary = getCartSummary(cart);
  const deliveryFeeCents =
    fulfillmentType === 'delivery' ? settings.deliveryFeeCents : 0;
  const estimatedTotalCents = summary.subtotalCents + deliveryFeeCents;
  const cashOnDeliveryAvailable =
    settings.paymentMethods.includes('cash_on_delivery');

  useEffect(() => {
    if (!completedOrder) {
      setLiveStatus(null);
      setIsLiveConnected(false);
      return undefined;
    }

    try {
      return orderingClient.subscribeToOrderUpdates(
        completedOrder.orderReference,
        {
          onUpdate: (update) => {
            setLiveStatus(update.status);
            setIsLiveConnected(true);
          },
          onOpen: () => setIsLiveConnected(true),
          onError: () => setIsLiveConnected(false),
        },
      );
    } catch {
      setIsLiveConnected(false);
      return undefined;
    }
  }, [completedOrder]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (cart.length === 0) {
      setError('Your cart is empty.');
      return;
    }
    if (!cashOnDeliveryAvailable) {
      setError('Cash on Delivery is not currently available.');
      return;
    }
    if (summary.subtotalCents < settings.minimumOrderCents) {
      setError(
        `The minimum order is ${formatPrice(settings.minimumOrderCents, currency)}.`,
      );
      return;
    }

    const requestBody = {
      customer: { fullName, phone },
      fulfillmentType,
      deliveryAddress:
        fulfillmentType === 'delivery' ? deliveryAddress : null,
      deliveryInstructions,
      paymentMethod: 'cash_on_delivery',
      items: cart.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        selectedChoiceIds: item.selectedOptions.flatMap((option) =>
          option.choices.map((choice) => choice.choiceId),
        ),
      })),
    };
    const payloadFingerprint = JSON.stringify(requestBody);
    if (attemptRef.current?.payload !== payloadFingerprint) {
      let key;
      try {
        key = orderingClient.createIdempotencyKey();
      } catch (requestError) {
        setError(requestError.message);
        return;
      }
      attemptRef.current = {
        payload: payloadFingerprint,
        key,
      };
    }

    setIsSubmitting(true);
    try {
      const order = await orderingClient.createOrder(requestBody, {
        idempotencyKey: attemptRef.current.key,
      });
      setCompletedOrder(order);
      setLiveStatus(order.status);
      onOrderComplete(order);
      attemptRef.current = null;
    } catch (requestError) {
      setError(
        requestError.message ||
          'We could not confirm your order. Please try again with the same details.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (completedOrder) {
    return (
      <section className="order-confirmation" role="status">
        <span className="confirmation-mark" aria-hidden="true">✓</span>
        <p className="eyebrow">ORDER RECEIVED</p>
        <h3>Thank you, {fullName.trim()}.</h3>
        <p>Your order has been placed with Cash on Delivery.</p>
        <div className="customer-order-update" role="status" aria-live="polite">
          <strong>Current status: {(liveStatus ?? completedOrder.status).replaceAll('_', ' ')}</strong>
          <span>
            {isLiveConnected
              ? 'This page will show status updates as they happen.'
              : 'Live updates are reconnecting. Keep this page open for status changes.'}
          </span>
        </div>
        <div className="confirmation-reference">
          <span>Order reference</span>
          <strong>{completedOrder.orderReference}</strong>
        </div>
        <Link
          className="tracking-link"
          to={`/track/${encodeURIComponent(completedOrder.orderReference)}`}
        >
          View order tracking
        </Link>
        <div className="confirmation-total">
          <span>Order total</span>
          <strong>{formatPrice(completedOrder.totalCents, currency)}</strong>
        </div>
        <button className="continue-shopping" type="button" onClick={onBack}>
          Back to menu
        </button>
      </section>
    );
  }

  return (
    <form className="checkout-form" onSubmit={handleSubmit}>
      <button className="back-to-cart" type="button" onClick={onBack}>
        ← Back to cart
      </button>
      <p className="eyebrow">CHECKOUT</p>
      <h3>Your details</h3>
      <label className="form-field">
        <span>Full name</span>
        <input
          autoComplete="name"
          maxLength={120}
          minLength={2}
          name="fullName"
          required
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
        />
      </label>
      <label className="form-field">
        <span>Phone number</span>
        <input
          autoComplete="tel"
          inputMode="tel"
          maxLength={32}
          name="phone"
          required
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
      </label>

      <fieldset className="fulfillment-options">
        <legend>How would you like your order?</legend>
        <label>
          <input
            checked={fulfillmentType === 'delivery'}
            name="fulfillmentType"
            onChange={() => setFulfillmentType('delivery')}
            type="radio"
          />
          <span>Delivery</span>
        </label>
        <label>
          <input
            checked={fulfillmentType === 'pickup'}
            name="fulfillmentType"
            onChange={() => setFulfillmentType('pickup')}
            type="radio"
          />
          <span>Self-pickup</span>
        </label>
      </fieldset>

      {fulfillmentType === 'delivery' && (
        <>
          <label className="form-field">
            <span>Delivery address</span>
            <textarea
              autoComplete="street-address"
              maxLength={500}
              minLength={8}
              name="deliveryAddress"
              required
              rows={3}
              value={deliveryAddress}
              onChange={(event) => setDeliveryAddress(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>Delivery instructions <span className="optional-label">Optional</span></span>
            <textarea
              maxLength={500}
              name="deliveryInstructions"
              rows={2}
              value={deliveryInstructions}
              onChange={(event) => setDeliveryInstructions(event.target.value)}
            />
          </label>
        </>
      )}

      <fieldset className="payment-choice">
        <legend>Payment method</legend>
        <label>
          <input
            checked={cashOnDeliveryAvailable}
            disabled
            readOnly
            type="radio"
          />
          <span>
            Cash on Delivery
            <small>Pay when your order arrives</small>
          </span>
        </label>
      </fieldset>

      <div className="checkout-summary">
        <div>
          <span>Subtotal</span>
          <strong>{formatPrice(summary.subtotalCents, currency)}</strong>
        </div>
        <div>
          <span>
            {fulfillmentType === 'delivery' ? 'Delivery fee' : 'Pickup'}
          </span>
          <strong>
            {deliveryFeeCents === 0 && fulfillmentType === 'pickup'
              ? 'Free'
              : formatPrice(deliveryFeeCents, currency)}
          </strong>
        </div>
        <div className="cart-total">
          <span>Total</span>
          <strong>{formatPrice(estimatedTotalCents, currency)}</strong>
        </div>
        {settings.minimumOrderCents > 0 && (
          <p>
            Minimum order: {formatPrice(settings.minimumOrderCents, currency)}
          </p>
        )}
      </div>

      {error && (
        <p className="checkout-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="continue-shopping"
        disabled={isSubmitting || !cashOnDeliveryAvailable}
        type="submit"
      >
        {isSubmitting
          ? 'Placing order…'
          : `Place order · ${formatPrice(estimatedTotalCents, currency)}`}
      </button>
      {!cashOnDeliveryAvailable && (
        <p className="checkout-error">
          This restaurant has not enabled Cash on Delivery.
        </p>
      )}
    </form>
  );
}

function CartPanel({
  cart,
  currency,
  settings,
  isOpen,
  onClose,
  onRemove,
  onQuantityChange,
  onOrderComplete,
}) {
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const summary = getCartSummary(cart);

  return (
    <div
      className="cart-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <aside
        className="cart-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-title"
      >
        <header className="cart-header">
          <div>
            <p className="eyebrow">YOUR ORDER</p>
            <h2 id="cart-title">Shopping cart</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close shopping cart"
            onClick={onClose}
            autoFocus
          >
            ×
          </button>
        </header>

        {isCheckingOut ? (
          <CheckoutForm
            cart={cart}
            currency={currency}
            settings={settings}
            onBack={() => setIsCheckingOut(false)}
            onOrderComplete={onOrderComplete}
          />
        ) : cart.length === 0 ? (
          <div className="cart-empty">
            <span className="empty-cart-icon" aria-hidden="true">＋</span>
            <h3>Your cart is empty</h3>
            <p>Add a menu item to get started.</p>
            <button type="button" className="continue-shopping" onClick={onClose}>
              Browse menu
            </button>
          </div>
        ) : (
          <>
            <div className="cart-items">
              {cart.map((item) => (
                <article className="cart-item" key={item.key}>
                  <div className="cart-item-heading">
                    <div>
                      <h3>{item.name}</h3>
                      {item.selectedOptions.map((option) => (
                        <p className="cart-item-option" key={option.optionId}>
                          {option.name}: {option.choices.map((choice) => choice.name).join(', ')}
                        </p>
                      ))}
                    </div>
                    <strong>
                      {formatPrice(item.unitPriceCents * item.quantity, currency)}
                    </strong>
                  </div>
                  <div className="cart-item-actions">
                    <div className="quantity-control" aria-label={`Quantity for ${item.name}`}>
                      <button
                        type="button"
                        aria-label={`Decrease ${item.name} quantity`}
                        onClick={() =>
                          onQuantityChange(item.key, item.quantity - 1)
                        }
                      >
                        −
                      </button>
                      <span aria-live="polite">{item.quantity}</span>
                      <button
                        type="button"
                        aria-label={`Increase ${item.name} quantity`}
                        disabled={item.quantity >= 50}
                        onClick={() =>
                          onQuantityChange(item.key, item.quantity + 1)
                        }
                      >
                        +
                      </button>
                    </div>
                    <button
                      className="remove-item"
                      type="button"
                      onClick={() => onRemove(item.key)}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <div className="cart-totals">
              <div>
                <span>Subtotal</span>
                <strong>{formatPrice(summary.subtotalCents, currency)}</strong>
              </div>
              <div className="cart-total">
                <span>Total</span>
                <strong>{formatPrice(summary.totalCents, currency)}</strong>
              </div>
              <p>Delivery charges, if applicable, are calculated at checkout.</p>
            </div>
            <button
              className="continue-shopping"
              type="button"
              onClick={() => setIsCheckingOut(true)}
            >
              Continue to checkout
            </button>
          </>
        )}
      </aside>
    </div>
  );
}

function StorefrontHome() {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('all');
  const [retryCount, setRetryCount] = useState(0);
  const [cart, setCart] = useState([]);
  const [cartIsOpen, setCartIsOpen] = useState(false);
  const cartSummary = getCartSummary(cart);

  function handleAddToCart(product, selectedChoiceIds) {
    setCart((currentCart) =>
      addCartItem(currentCart, product, selectedChoiceIds),
    );
  }

  function handleQuantityChange(key, quantity) {
    setCart((currentCart) =>
      setCartItemQuantity(currentCart, key, quantity),
    );
  }

  useEffect(() => {
    const controller = new AbortController();

    async function loadCatalog() {
      setLoading(true);
      setError('');

      try {
        const result = await orderingClient.getCatalog({
          signal: controller.signal,
        });
        setCatalog(result);
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setError(requestError.message || 'Could not load the restaurant menu.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadCatalog();
    return () => controller.abort();
  }, [retryCount]);

  const categories = catalog?.categories ?? [];
  const displayedCategories =
    activeCategory === 'all'
      ? categories
      : categories.filter((category) => category.id === activeCategory);

  return (
    <div
      className="storefront"
      style={
        catalog
          ? {
              '--brand-primary': catalog.restaurant.brandColors.primary,
              '--brand-secondary': catalog.restaurant.brandColors.secondary,
            }
          : undefined
      }
    >
      <header className="site-header">
        <a className="brand" href="/" aria-label={catalog?.restaurant.name ?? 'Restaurant home'}>
          {catalog?.restaurant.logoUrl && (
            <img src={catalog.restaurant.logoUrl} alt="" />
          )}
          <span>{catalog?.restaurant.name ?? 'Restaurant menu'}</span>
        </a>
        <div className="header-actions">
          <p className="header-note">Order directly from our kitchen</p>
          <button
            className="cart-toggle"
            type="button"
            aria-label={`Open cart, ${cartSummary.itemCount} items`}
            onClick={() => setCartIsOpen(true)}
          >
            <span aria-hidden="true">Bag</span>
            <span className="cart-count">{cartSummary.itemCount}</span>
          </button>
        </div>
      </header>

      <main>
        <section className="hero">
          <p className="eyebrow">MADE FRESH FOR YOU</p>
          <h1>{catalog?.restaurant.name ?? 'Our menu'}</h1>
          <p>Browse the menu and choose something you’ll love.</p>
        </section>

        {loading && (
          <p className="status-message" role="status">
            Loading menu…
          </p>
        )}

        {!loading && error && (
          <section className="status-panel" role="alert">
            <h2>Menu unavailable</h2>
            <p>{error}</p>
            <button type="button" onClick={() => setRetryCount((count) => count + 1)}>
              Try again
            </button>
            <p className="setup-hint">
              Make sure the API is running and a restaurant configuration has been imported.
            </p>
          </section>
        )}

        {!loading && !error && catalog && (
          <section className="menu" aria-label="Restaurant menu">
            {categories.length > 0 ? (
              <>
                <nav className="category-nav" aria-label="Menu categories">
                  <button
                    className={activeCategory === 'all' ? 'is-active' : ''}
                    type="button"
                    aria-pressed={activeCategory === 'all'}
                    onClick={() => setActiveCategory('all')}
                  >
                    All items
                  </button>
                  {categories.map((category) => (
                    <button
                      className={activeCategory === category.id ? 'is-active' : ''}
                      type="button"
                      aria-pressed={activeCategory === category.id}
                      key={category.id}
                      onClick={() => setActiveCategory(category.id)}
                    >
                      {category.name}
                    </button>
                  ))}
                </nav>
                {displayedCategories.map((category) => (
                  <section className="category-section" key={category.id}>
                    <div className="section-heading">
                      <div>
                        <h2>{category.name}</h2>
                        {category.description && <p>{category.description}</p>}
                      </div>
                      <span>
                        {category.products.length}{' '}
                        {category.products.length === 1 ? 'item' : 'items'}
                      </span>
                    </div>
                    {category.products.length > 0 ? (
                      <div className="product-grid">
                        {category.products.map((product) => (
                          <ProductCard
                            key={product.id}
                            product={product}
                            currency={catalog.restaurant.currency}
                            onAdd={handleAddToCart}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="empty-category">No products in this category yet.</p>
                    )}
                  </section>
                ))}
              </>
            ) : (
              <p className="status-message">The menu is being prepared. Please check back soon.</p>
            )}
          </section>
        )}
      </main>

      {catalog && (
        <footer className="site-footer">
          <span>{catalog.restaurant.contact.address}</span>
          <a href={`tel:${catalog.restaurant.contact.phone}`}>
            {catalog.restaurant.contact.phone}
          </a>
        </footer>
      )}
      <CartPanel
        cart={cart}
        currency={catalog?.restaurant.currency ?? 'USD'}
        settings={
          catalog?.settings ?? {
            deliveryFeeCents: 0,
            minimumOrderCents: 0,
            paymentMethods: [],
          }
        }
        isOpen={cartIsOpen}
        onClose={() => setCartIsOpen(false)}
        onRemove={(key) =>
          setCart((currentCart) => removeCartItem(currentCart, key))
        }
        onQuantityChange={handleQuantityChange}
        onOrderComplete={() => setCart([])}
      />
    </div>
  );
}

const TRACKING_STATUSES = [
  'pending',
  'accepted',
  'preparing',
  'ready',
  'dispatched',
  'delivered',
];

const TERMINAL_STATUSES = ['cancelled', 'rejected'];

function formatStatus(status) {
  return status.replaceAll('_', ' ');
}

function formatTrackingTime(value) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function OrderTrackingPage() {
  const { reference = '' } = useParams();
  const [tracking, setTracking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function loadTracking() {
      setLoading(true);
      setError('');
      try {
        const result = await orderingClient.getOrderTracking(reference, {
          signal: controller.signal,
        });
        setTracking(result);
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setError(
            requestError.message || 'Order tracking could not be loaded.',
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadTracking();
    return () => controller.abort();
  }, [reference, refreshKey]);

  useEffect(() => {
    if (!tracking) {
      return undefined;
    }
    try {
      return orderingClient.subscribeToOrderUpdates(reference, {
        onUpdate: () => setRefreshKey((key) => key + 1),
        onOpen: () => setIsConnected(true),
        onError: () => setIsConnected(false),
      });
    } catch {
      setIsConnected(false);
      return undefined;
    }
  }, [reference, tracking?.order.orderReference]);

  if (loading && !tracking) {
    return (
      <main className="tracking-shell">
        <p className="status-message" role="status">Loading order tracking…</p>
      </main>
    );
  }

  if (error && !tracking) {
    return (
      <main className="tracking-shell">
        <section className="tracking-error" role="alert">
          <p className="eyebrow">ORDER TRACKING</p>
          <h1>We couldn’t find that order</h1>
          <p>
            Check the private tracking link or order reference and try again.
            Order references are case-sensitive.
          </p>
          <Link className="tracking-back-link" to="/">Back to menu</Link>
        </section>
      </main>
    );
  }

  if (!tracking) {
    return null;
  }

  const { order, restaurant } = tracking;
  const failed = TERMINAL_STATUSES.includes(order.status);
  const timeline = failed
    ? order.statusHistory
    : order.statusHistory.filter((entry) =>
        TRACKING_STATUSES.includes(entry.status),
      );
  const statusIndex = TRACKING_STATUSES.indexOf(order.status);
  const trackingStyles = {
    '--brand-primary': restaurant.brandColors.primary,
    '--brand-secondary': restaurant.brandColors.secondary,
  };
  const price = (cents) => formatPrice(cents, restaurant.currency);

  return (
    <div className="storefront tracking-page" style={trackingStyles}>
      <header className="site-header tracking-header">
        <Link className="brand" to="/" aria-label={`${restaurant.name} menu`}>
          <span>{restaurant.name}</span>
        </Link>
        <Link className="tracking-back-link" to="/">Back to menu</Link>
      </header>
      <main className="tracking-shell">
        <section className="tracking-card">
          <p className="eyebrow">ORDER TRACKING</p>
          <h1>{restaurant.name}</h1>
          <p className="tracking-reference">
            Reference <strong>{order.orderReference}</strong>
          </p>
          <div className={`tracking-current${failed ? ' is-failed' : ''}`}>
            <span className="tracking-current-label">Current status</span>
            <strong>{formatStatus(order.status)}</strong>
            <span>
              {isConnected
                ? 'Live updates are on.'
                : 'Reconnecting for live updates…'}
            </span>
          </div>

          <section className="tracking-timeline" aria-label="Order status timeline">
            <h2>Status timeline</h2>
            <ol>
              {timeline.map((entry, index) => {
                const active = !failed && entry.status === order.status;
                const isFailureStatus = TERMINAL_STATUSES.includes(entry.status);
                const complete =
                  !isFailureStatus &&
                  (TRACKING_STATUSES.indexOf(entry.status) < statusIndex ||
                    failed);
                return (
                  <li
                    className={[
                      active ? 'is-current' : '',
                      complete ? 'is-complete' : '',
                      isFailureStatus ? 'is-failed' : '',
                    ].filter(Boolean).join(' ')}
                    key={`${entry.status}-${entry.createdAt}-${index}`}
                  >
                    <span className="timeline-marker" aria-hidden="true">
                      {complete ? '✓' : ''}
                    </span>
                    <div className="timeline-content">
                      <strong>{formatStatus(entry.status)}</strong>
                      <time dateTime={entry.createdAt}>
                        {formatTrackingTime(entry.createdAt)}
                      </time>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="tracking-summary" aria-label="Order summary">
            <h2>Order summary</h2>
            <ul>
              {order.items.map((item) => (
                <li key={item.id}>
                  <span>
                    {item.quantity} × {item.productName}
                    {item.selectedOptions.length > 0 && (
                      <small>
                        {item.selectedOptions
                          .flatMap((option) =>
                            option.choices.map((choice) => choice.name),
                          )
                          .join(', ')}
                      </small>
                    )}
                  </span>
                  <strong>{price(item.lineTotalCents)}</strong>
                </li>
              ))}
            </ul>
            <div className="tracking-totals">
              <p><span>Subtotal</span><strong>{price(order.subtotalCents)}</strong></p>
              <p>
                <span>Delivery fee</span>
                <strong>
                  {order.fulfillmentType === 'pickup'
                    ? 'Free'
                    : price(order.deliveryFeeCents)}
                </strong>
              </p>
              <p className="tracking-grand-total">
                <span>Total</span><strong>{price(order.totalCents)}</strong>
              </p>
            </div>
          </section>
          <p className="tracking-privacy">
            This private tracking page shows order status and items only. It
            does not display customer contact or delivery address details.
          </p>
        </section>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StorefrontHome />} />
        <Route path="/track/:reference" element={<OrderTrackingPage />} />
        <Route path="*" element={<StorefrontHome />} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
