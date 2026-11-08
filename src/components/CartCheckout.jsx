import { useEffect, useState } from 'react';
import { Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';

function formatCurrency(cents, currency) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

function formatStatus(status) {
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Pending';
}

function getIdempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  throw new Error('Secure order submission is unavailable in this browser. Use a modern browser over HTTPS.');
}

export default function CartCheckout({
  open,
  onClose,
  items,
  catalog,
  onChangeQuantity,
  onRemove,
  onOrderPlaced,
}) {
  const [step, setStep] = useState('cart');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [tracking, setTracking] = useState(null);
  const [trackingError, setTrackingError] = useState('');
  const [customer, setCustomer] = useState({ fullName: '', phone: '', deliveryAddress: '' });
  const currency = catalog?.restaurant?.currency ?? 'PKR';
  const subtotalCents = items.reduce(
    (total, { product, quantity }) => total + (product.priceCents ?? 0) * quantity,
    0,
  );
  const deliveryFeeCents = catalog?.settings?.deliveryFeeCents ?? 0;
  const totalCents = subtotalCents + deliveryFeeCents;
  const canCheckout = items.length > 0 && items.every(
    ({ product }) => product.available && Number.isSafeInteger(product.priceCents),
  );

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, submitting]);

  useEffect(() => {
    if (!open || step !== 'confirmation' || !success?.orderReference) return undefined;
    let active = true;
    let requestPending = false;
    const loadTracking = async () => {
      if (requestPending || !active) return;
      requestPending = true;
      try {
        const response = await fetch(`/api/orders/${encodeURIComponent(success.orderReference)}`, {
          cache: 'no-store',
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message ?? 'Order tracking is unavailable.');
        if (active) {
          setTracking(result);
          setTrackingError('');
        }
      } catch (requestError) {
        if (active) setTrackingError(requestError.message || 'Order tracking is unavailable.');
      } finally {
        requestPending = false;
      }
    };
    loadTracking();
    const interval = window.setInterval(loadTracking, 4000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [open, step, success?.orderReference]);

  if (!open) return null;

  async function placeOrder(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': getIdempotencyKey(),
        },
        body: JSON.stringify({
          customer: {
            fullName: customer.fullName,
            phone: customer.phone,
          },
          fulfillmentType: 'delivery',
          deliveryAddress: customer.deliveryAddress,
          paymentMethod: 'cash_on_delivery',
          items: items.map(({ product, quantity }) => ({
            productId: product.id,
            quantity,
            selectedChoiceIds: [],
          })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? 'Your order could not be placed.');
      setSuccess(result.order);
      setTracking(null);
      setStep('confirmation');
      onOrderPlaced();
    } catch (requestError) {
      setError(requestError.message || 'Your order could not be placed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function closeDrawer() {
    if (submitting) return;
    onClose();
  }

  return (
    <div className="cart-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeDrawer();
    }}>
      <section className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title">
        <header className="cart-header">
          <div>
            <p className="cart-eyebrow">AL-BAIK</p>
            <h2 id="cart-title">
              {step === 'checkout' ? 'Checkout' : step === 'confirmation' ? 'Order placed' : 'Your Cart'}
            </h2>
          </div>
          <button className="cart-close" type="button" onClick={closeDrawer} aria-label="Close cart">
            <X size={22} />
          </button>
        </header>

        {step === 'cart' && (
          <>
            <div className="cart-body">
              {items.length ? (
                <ul className="cart-items">
                  {items.map(({ product, quantity }) => (
                    <li className="cart-item" key={product.id}>
                      <img src={product.image} alt="" />
                      <div className="cart-item-details">
                        <strong>{product.name}</strong>
                        <span>{formatCurrency(product.priceCents ?? 0, currency)} each</span>
                        {!product.available && <small className="cart-unavailable">Currently unavailable</small>}
                        <div className="quantity-control" aria-label={`${product.name} quantity`}>
                          <button
                            type="button"
                            onClick={() => onChangeQuantity(product.id, quantity - 1)}
                            aria-label={`Decrease ${product.name} quantity`}
                          >
                            <Minus size={15} />
                          </button>
                          <span>{quantity}</span>
                          <button
                            type="button"
                            disabled={quantity >= 50 || !product.available}
                            onClick={() => onChangeQuantity(product.id, quantity + 1)}
                            aria-label={`Increase ${product.name} quantity`}
                          >
                            <Plus size={15} />
                          </button>
                        </div>
                      </div>
                      <div className="cart-item-end">
                        <strong>{formatCurrency((product.priceCents ?? 0) * quantity, currency)}</strong>
                        <button
                          className="cart-remove"
                          type="button"
                          onClick={() => onRemove(product.id)}
                          aria-label={`Remove ${product.name} from cart`}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="cart-empty">
                  <ShoppingBag size={38} />
                  <strong>Your cart is empty</strong>
                  <p>Add your favourites from the menu to get started.</p>
                </div>
              )}
            </div>
            <footer className="cart-footer">
              <div className="cart-total-row"><span>Subtotal</span><strong>{formatCurrency(subtotalCents, currency)}</strong></div>
              <div className="cart-total-row"><span>Delivery</span><strong>{formatCurrency(deliveryFeeCents, currency)}</strong></div>
              <div className="cart-total-row cart-grand-total"><span>Total</span><strong>{formatCurrency(totalCents, currency)}</strong></div>
              <button
                className="btn cart-primary"
                type="button"
                disabled={!canCheckout}
                onClick={() => {
                  setError('');
                  setStep('checkout');
                }}
              >
                Proceed to Checkout
              </button>
            </footer>
          </>
        )}

        {step === 'checkout' && (
          <form className="checkout-form" onSubmit={placeOrder}>
            <button className="cart-back-link" type="button" onClick={() => setStep('cart')}>← Back to cart</button>
            <label>
              Customer name
              <input
                autoComplete="name"
                maxLength={120}
                required
                value={customer.fullName}
                onChange={(event) => setCustomer({ ...customer, fullName: event.target.value })}
              />
            </label>
            <label>
              Phone number
              <input
                autoComplete="tel"
                type="tel"
                maxLength={32}
                required
                value={customer.phone}
                onChange={(event) => setCustomer({ ...customer, phone: event.target.value })}
              />
            </label>
            <label>
              Delivery address
              <textarea
                autoComplete="street-address"
                minLength={8}
                maxLength={500}
                required
                rows={3}
                value={customer.deliveryAddress}
                onChange={(event) => setCustomer({ ...customer, deliveryAddress: event.target.value })}
              />
            </label>
            <div className="payment-choice">
              <span>Payment method</span>
              <strong>Cash on Delivery</strong>
            </div>
            <div className="checkout-total">
              <span>Total</span>
              <strong>{formatCurrency(totalCents, currency)}</strong>
            </div>
            {error && <p className="checkout-error" role="alert">{error}</p>}
            <button className="btn cart-primary" type="submit" disabled={submitting || !canCheckout}>
              {submitting ? 'Placing order…' : 'Place Order'}
            </button>
          </form>
        )}

        {step === 'confirmation' && success && (
          <div className="order-confirmation" aria-live="polite">
            <div className="order-success-mark" aria-hidden="true">✓</div>
            <h3>Thank you, {customer.fullName}!</h3>
            <p>Your order has been sent to Al-Baik.</p>
            <div className="order-reference-card">
              <span>Order reference</span>
              <strong>{success.orderReference}</strong>
              <span>Server-calculated total</span>
              <strong>{formatCurrency(success.totalCents, currency)}</strong>
            </div>
            <section className="tracking-panel" aria-label="Order tracking">
              <h4>Order status</h4>
              {trackingError ? (
                <p className="checkout-error" role="status">{trackingError}</p>
              ) : (
                <ol className="tracking-steps">
                  {['pending', 'packed', 'delivering'].map((status) => {
                    const activeStatus = tracking?.order.status ?? success.status;
                    const stages = ['pending', 'packed', 'delivering'];
                    const activeIndex = stages.indexOf(activeStatus);
                    return (
                      <li className={stages.indexOf(status) <= activeIndex ? 'is-current' : ''} key={status}>
                        <span aria-hidden="true">{stages.indexOf(status) < activeIndex ? '✓' : stages.indexOf(status) + 1}</span>
                        {formatStatus(status)}
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
            <button className="btn cart-primary" type="button" onClick={closeDrawer}>Continue browsing</button>
          </div>
        )}
      </section>
    </div>
  );
}
