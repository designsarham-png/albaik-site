import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './styles.css';

const ORDER_STATUSES = [
  'pending',
  'packed',
  'delivering',
];

const NEXT_STATUSES = {
  pending: ['packed'],
  packed: ['delivering'],
  delivering: [],
};

async function readJsonResponse(response) {
  const result = await response.json();
  if (!response.ok) {
    throw new Error(
      result.error?.message ?? 'The request could not be completed.',
    );
  }
  return result;
}

function formatCurrency(cents, currency) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

function formatStatus(status) {
  return status.replaceAll('_', ' ');
}

function AdminDashboard({
  admin,
  csrfToken,
  onLogout,
  isLoggingOut,
  logoutError,
}) {
  const [summary, setSummary] = useState(null);
  const [orders, setOrders] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [currency, setCurrency] = useState('USD');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedReference, setSelectedReference] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notificationError, setNotificationError] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const notificationCursor = useRef(0);
  const audioContext = useRef(null);
  const pollingNotifications = useRef(false);
  const soundEnabledRef = useRef(soundEnabled);
  const notificationsEnabledRef = useRef(notificationsEnabled);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    notificationsEnabledRef.current = notificationsEnabled;
  }, [notificationsEnabled]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadDashboard() {
      try {
        const [summaryResponse, ordersResponse, catalogResponse] =
          await Promise.all([
            fetch('/api/admin/summary', {
              credentials: 'include',
              signal: controller.signal,
            }),
            fetch(
              `/api/admin/orders?status=${encodeURIComponent(statusFilter)}&search=${encodeURIComponent(submittedSearch)}&page=${page}&pageSize=20`,
              {
                credentials: 'include',
                signal: controller.signal,
              },
            ),
            fetch('/api/catalog', {
              credentials: 'include',
              signal: controller.signal,
            }),
          ]);
        const [summaryResult, ordersResult, catalogResult] =
          await Promise.all([
            readJsonResponse(summaryResponse),
            readJsonResponse(ordersResponse),
            readJsonResponse(catalogResponse),
          ]);
        setSummary(summaryResult.summary);
        setOrders(ordersResult.orders);
        setPagination(ordersResult.pagination);
        setCurrency(catalogResult.restaurant.currency);
        setError('');
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setError(requestError.message || 'Could not load orders.');
        }
      }
    }

    loadDashboard();
    return () => controller.abort();
  }, [page, refreshKey, statusFilter, submittedSearch]);

  useEffect(() => {
    let active = true;
    let interval;

    async function pollNotifications() {
      if (!active || pollingNotifications.current) {
        return;
      }
      pollingNotifications.current = true;
      try {
        const response = await fetch(
          `/api/admin/notifications?afterId=${notificationCursor.current}&limit=50`,
          { credentials: 'include' },
        );
        const result = await readJsonResponse(response);
        if (!active) {
          return;
        }
        if (result.notifications.length > 0) {
          notificationCursor.current = result.latestId;
          setNotifications((current) =>
            [...result.notifications, ...current].slice(0, 8),
          );
          setRefreshKey((key) => key + 1);
          for (const notification of result.notifications) {
            if (notification.eventType === 'order_created') {
              playOrderAlert();
              showBrowserNotification(notification);
            }
          }
        }
        setNotificationError('');
      } catch (requestError) {
        if (active) {
          setNotificationError(
            requestError.message || 'Live order notifications are unavailable.',
          );
        }
      } finally {
        pollingNotifications.current = false;
      }
    }

    async function startNotifications() {
      try {
        const response = await fetch('/api/admin/notifications/latest', {
          credentials: 'include',
        });
        const result = await readJsonResponse(response);
        if (!active) {
          return;
        }
        notificationCursor.current = result.latestId;
        await pollNotifications();
        interval = window.setInterval(pollNotifications, 4000);
      } catch (requestError) {
        if (active) {
          setNotificationError(
            requestError.message || 'Live order notifications are unavailable.',
          );
        }
      }
    }

    function playOrderAlert() {
      if (!soundEnabledRef.current || !audioContext.current) {
        return;
      }
      const context = audioContext.current;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.14, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.3);
    }

    function showBrowserNotification(notification) {
      if (
        !notificationsEnabledRef.current ||
        typeof window.Notification !== 'function' ||
        window.Notification.permission !== 'granted'
      ) {
        return;
      }
      const browserNotification = new window.Notification('New restaurant order', {
        body: `${notification.customerFullName} · ${notification.orderReference}`,
        tag: `order-${notification.orderReference}`,
      });
      browserNotification.onclick = () => {
        window.focus();
        browserNotification.close();
      };
    }

    startNotifications();
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(
    () => () => {
      audioContext.current?.close();
      audioContext.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!selectedReference) {
      setSelectedOrder(null);
      return undefined;
    }
    const controller = new AbortController();
    async function loadOrder() {
      try {
        const response = await fetch(
          `/api/admin/orders/${encodeURIComponent(selectedReference)}`,
          { credentials: 'include', signal: controller.signal },
        );
        const result = await readJsonResponse(response);
        setSelectedOrder(result.order);
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setError(requestError.message || 'Could not load order details.');
        }
      }
    }
    loadOrder();
    return () => controller.abort();
  }, [refreshKey, selectedReference]);

  async function changeOrderStatus(order, status) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/admin/orders/${encodeURIComponent(order.id)}/status`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({ status }),
        },
      );
      await readJsonResponse(response);
      setRefreshKey((key) => key + 1);
    } catch (requestError) {
      setError(requestError.message || 'Could not update the order.');
    } finally {
      setBusy(false);
    }
  }

  async function enableOrderSound() {
    if (soundEnabled) {
      soundEnabledRef.current = false;
      setSoundEnabled(false);
      return;
    }
    try {
      const AudioContextConstructor =
        window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) {
        throw new Error('This browser does not support notification sounds.');
      }
      audioContext.current = new AudioContextConstructor();
      await audioContext.current.resume();
      soundEnabledRef.current = true;
      setSoundEnabled(true);
    } catch (requestError) {
      setNotificationError(
        requestError.message || 'Notification sound could not be enabled.',
      );
    }
  }

  async function enableBrowserNotifications() {
    if (typeof window.Notification !== 'function') {
      setNotificationError('This browser does not support desktop notifications.');
      return;
    }
    try {
      const permission =
        window.Notification.permission === 'default'
          ? await window.Notification.requestPermission()
          : window.Notification.permission;
      if (permission !== 'granted') {
        throw new Error('Desktop notification permission was not granted.');
      }
      notificationsEnabledRef.current = true;
      setNotificationsEnabled(true);
      setNotificationError('');
    } catch (requestError) {
      setNotificationError(
        requestError.message || 'Desktop notifications could not be enabled.',
      );
    }
  }

  const activeOrder = selectedOrder;
  const activeActions = activeOrder
    ? NEXT_STATUSES[activeOrder.status] ?? []
    : [];

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="dashboard-brand">
          <div className="admin-brand-mark">
            <img src="/albaik-logo.png" alt="Al-Baik" />
          </div>
          <div>
            <p className="eyebrow">AL-BAIK ORDERING</p>
            <h1>Order dashboard</h1>
          </div>
        </div>
        <div className="admin-account">
          <button
            className={`secondary-button notification-toggle${soundEnabled ? ' is-enabled' : ''}`}
            onClick={enableOrderSound}
            type="button"
          >
            {soundEnabled ? 'Sound on' : 'Enable sound'}
          </button>
          <button
            className={`secondary-button notification-toggle${notificationsEnabled ? ' is-enabled' : ''}`}
            onClick={enableBrowserNotifications}
            type="button"
            disabled={notificationsEnabled}
          >
            {notificationsEnabled ? 'Desktop alerts on' : 'Enable desktop alerts'}
          </button>
          <span>{admin.email}</span>
          <button
            className="secondary-button logout-button"
            disabled={isLoggingOut}
            onClick={onLogout}
            type="button"
          >
            {isLoggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </header>

      <div className="dashboard-content">
        <section className="notification-center" aria-label="Recent order notifications">
          <div className="notification-heading">
            <div>
              <h2>Live order alerts</h2>
              <p>New orders appear automatically while this dashboard is open.</p>
            </div>
            <span className="live-indicator">
              <span aria-hidden="true" />
              Live · 4 sec
            </span>
          </div>
          {notificationError && (
            <p className="notification-error" role="status">
              {notificationError}
            </p>
          )}
          {notifications.length > 0 ? (
            <ul className="notification-list">
              {notifications.slice(0, 5).map((notification) => (
                <li key={notification.id}>
                  <span className="notification-icon" aria-hidden="true">
                    {notification.eventType === 'order_created' ? '＋' : '↻'}
                  </span>
                  <div>
                    <strong>
                      {notification.eventType === 'order_created'
                        ? 'New order received'
                        : `Order ${formatStatus(notification.status)}`}
                    </strong>
                    <span>
                      {notification.customerFullName} · {notification.orderReference}
                    </span>
                  </div>
                  <time dateTime={notification.createdAt}>
                    {new Date(notification.createdAt).toLocaleTimeString()}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="notification-empty">No new alerts in this session.</p>
          )}
        </section>

        <section className="metrics-grid" aria-label="Order overview">
          <MetricCard label="All orders" value={summary?.totalOrders ?? '—'} />
          <MetricCard label="Today's orders" value={summary?.todayOrders ?? '—'} />
          <MetricCard
            label="Total sales"
            value={
              summary
                ? formatCurrency(summary.totalSalesCents, currency)
                : '—'
            }
          />
          <MetricCard
            label="Pending orders"
            value={summary?.ordersByStatus.pending ?? '—'}
            emphasis
          />
        </section>

        <section className="status-overview" aria-label="Orders by status">
          {ORDER_STATUSES.map((status) => (
            <button
              className="status-count"
              key={status}
              onClick={() => {
                setPage(1);
                setStatusFilter(status);
              }}
              type="button"
            >
              <span className={`status-badge status-${status}`}>
                {formatStatus(status)}
              </span>
              <strong>{summary?.ordersByStatus[status] ?? '—'}</strong>
            </button>
          ))}
        </section>

        <section className="dashboard-panel">
          <div className="orders-toolbar">
            <div>
              <h2>Orders</h2>
              <p>Review incoming orders and keep their status up to date.</p>
            </div>
            <button
              className="secondary-button refresh-button"
              onClick={() => setRefreshKey((key) => key + 1)}
              type="button"
            >
              Refresh
            </button>
          </div>

          <form
            className="order-filters"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSubmittedSearch(search.trim());
            }}
          >
            <label className="filter-field">
              <span>Status</span>
              <select
                value={statusFilter}
                onChange={(event) => {
                  setPage(1);
                  setStatusFilter(event.target.value);
                }}
              >
                <option value="all">All statuses</option>
                {ORDER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {formatStatus(status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field search-field">
              <span>Search reference, name or phone</span>
              <input
                value={search}
                maxLength={100}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button className="primary-button filter-button" type="submit">
              Search
            </button>
          </form>

          {error && (
            <p className="dashboard-error" role="alert">
              {error}
            </p>
          )}
          {logoutError && (
            <p className="dashboard-error" role="alert">
              {logoutError}
            </p>
          )}

          {activeOrder && (
            <section className="order-detail" aria-label="Order details">
              <div className="detail-heading">
                <div>
                  <p className="eyebrow">ORDER DETAILS</p>
                  <h3>{activeOrder.orderReference}</h3>
                </div>
                <button
                  className="text-button"
                  onClick={() => setSelectedReference('')}
                  type="button"
                >
                  Close details
                </button>
              </div>
              <div className="detail-columns">
                <div>
                  <h4>Customer</h4>
                  <p>{activeOrder.customerFullName}</p>
                  <p>
                    <a href={`tel:${activeOrder.customerPhone}`}>
                      {activeOrder.customerPhone}
                    </a>
                  </p>
                  <p>
                    {activeOrder.fulfillmentType === 'delivery'
                      ? activeOrder.deliveryAddress
                      : 'Self-pickup'}
                  </p>
                  {activeOrder.deliveryInstructions && (
                    <p className="muted">
                      Instructions: {activeOrder.deliveryInstructions}
                    </p>
                  )}
                  <p className="muted">
                    Payment: {formatStatus(activeOrder.paymentMethod)}
                  </p>
                </div>
                <div>
                  <h4>Items</h4>
                  <ul className="detail-items">
                    {activeOrder.items.map((item) => (
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
                        <strong>
                          {formatCurrency(item.lineTotalCents, currency)}
                        </strong>
                      </li>
                    ))}
                  </ul>
                  <p className="detail-total">
                    Total <strong>{formatCurrency(activeOrder.totalCents, currency)}</strong>
                  </p>
                </div>
                <div>
                  <h4>Status history</h4>
                  <ol className="status-history">
                    {activeOrder.statusHistory.map((entry, index) => (
                      <li key={`${entry.status}-${entry.createdAt}-${index}`}>
                        <strong>{formatStatus(entry.status)}</strong>
                        <time dateTime={entry.createdAt}>
                          {new Date(entry.createdAt).toLocaleString()}
                        </time>
                        {entry.note && <small>{entry.note}</small>}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
              {activeActions.length > 0 && (
                <div className="status-actions">
                  <span>Update status</span>
                  {activeActions.map((status) => (
                    <button
                      className="primary-button action-button"
                      disabled={busy}
                      key={status}
                      onClick={() => changeOrderStatus(activeOrder, status)}
                      type="button"
                    >
                      {busy ? 'Saving…' : formatStatus(status)}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          <div className="orders-table-wrap">
            <table className="orders-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Placed</th>
                  <th><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td data-label="Order">
                      <button
                        className="order-reference"
                        onClick={() => setSelectedReference(order.orderReference)}
                        type="button"
                      >
                        {order.orderReference}
                      </button>
                    </td>
                    <td data-label="Customer">
                      <strong>{order.customerFullName}</strong>
                      <small>{order.customerPhone}</small>
                    </td>
                    <td data-label="Type">{formatStatus(order.fulfillmentType)}</td>
                    <td data-label="Status">
                      <span className={`status-badge status-${order.status}`}>
                        {formatStatus(order.status)}
                      </span>
                    </td>
                    <td data-label="Total">
                      {formatCurrency(order.totalCents, currency)}
                    </td>
                    <td data-label="Placed">
                      {new Date(order.createdAt).toLocaleString()}
                    </td>
                    <td data-label="Action">
                      <button
                        className="text-button"
                        onClick={() => setSelectedReference(order.orderReference)}
                        type="button"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr>
                    <td className="empty-orders" colSpan="7">
                      {error ? 'Orders could not be loaded.' : 'No orders match these filters.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {pagination && (
            <div className="pagination">
              <span>
                {pagination.total} order{pagination.total === 1 ? '' : 's'}
                {pagination.totalPages > 0 &&
                  ` · Page ${pagination.page} of ${pagination.totalPages}`}
              </span>
              <div>
                <button
                  className="secondary-button page-button"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => current - 1)}
                  type="button"
                >
                  Previous
                </button>
                <button
                  className="secondary-button page-button"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage((current) => current + 1)}
                  type="button"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </section>

        <RestaurantConfigurationEditor
          csrfToken={csrfToken}
          onSaved={(configuration) => {
            setCurrency(configuration.restaurant.currency);
            setRefreshKey((key) => key + 1);
          }}
        />
      </div>
    </main>
  );
}

const WEEKDAYS = [
  ['monday', 'Monday'],
  ['tuesday', 'Tuesday'],
  ['wednesday', 'Wednesday'],
  ['thursday', 'Thursday'],
  ['friday', 'Friday'],
  ['saturday', 'Saturday'],
  ['sunday', 'Sunday'],
];

function RestaurantConfigurationEditor({ csrfToken, onSaved }) {
  const [configuration, setConfiguration] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function loadConfiguration() {
      try {
        const response = await fetch('/api/admin/config', {
          credentials: 'include',
          signal: controller.signal,
        });
        const result = await readJsonResponse(response);
        setConfiguration(result.configuration);
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setError(requestError.message || 'Restaurant settings could not be loaded.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }
    loadConfiguration();
    return () => controller.abort();
  }, []);

  function updateRestaurant(field, value) {
    setConfiguration((current) => ({
      ...current,
      restaurant: { ...current.restaurant, [field]: value },
    }));
  }

  function updateBrandColor(field, value) {
    setConfiguration((current) => ({
      ...current,
      restaurant: {
        ...current.restaurant,
        brandColors: { ...current.restaurant.brandColors, [field]: value },
      },
    }));
  }

  function updateContact(field, value) {
    setConfiguration((current) => ({
      ...current,
      restaurant: {
        ...current.restaurant,
        contact: { ...current.restaurant.contact, [field]: value },
      },
    }));
  }

  function updateSetting(field, value) {
    setConfiguration((current) => ({
      ...current,
      settings: { ...current.settings, [field]: value },
    }));
  }

  function updateCategory(categoryId, changes) {
    setConfiguration((current) => ({
      ...current,
      categories: current.categories.map((category) =>
        category.id === categoryId ? { ...category, ...changes } : category,
      ),
    }));
  }

  function updateProduct(productId, changes) {
    setConfiguration((current) => ({
      ...current,
      products: current.products.map((product) =>
        product.id === productId ? { ...product, ...changes } : product,
      ),
    }));
  }

  function updateBusinessHours(day, value) {
    updateSetting('businessHours', {
      ...configuration.settings.businessHours,
      [day]: value,
    });
  }

  async function saveConfiguration(event) {
    event.preventDefault();
    setIsSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch('/api/admin/config', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(configuration),
      });
      const result = await readJsonResponse(response);
      setConfiguration(result.configuration);
      setSuccess(result.message);
      onSaved(result.configuration);
    } catch (requestError) {
      setError(requestError.message || 'Restaurant settings could not be saved.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <details className="configuration-panel">
      <summary>
        <span>
          <strong>Restaurant configuration</strong>
          <small>Manage branding, operating settings, menu and availability.</small>
        </span>
        <span className="configuration-expand" aria-hidden="true">⌄</span>
      </summary>
      {isLoading ? (
        <p className="loading-message" role="status">Loading restaurant settings…</p>
      ) : error && !configuration ? (
        <p className="dashboard-error" role="alert">{error}</p>
      ) : configuration ? (
        <form className="configuration-form" onSubmit={saveConfiguration}>
          <section className="configuration-section">
            <div className="configuration-section-heading">
              <h2>Restaurant details and branding</h2>
              <p>These details are shared with each website connected to this restaurant.</p>
            </div>
            <div className="configuration-fields">
              <label className="settings-field">
                <span>Restaurant name</span>
                <input
                  required
                  maxLength={120}
                  value={configuration.restaurant.name}
                  onChange={(event) => updateRestaurant('name', event.target.value)}
                />
              </label>
              <label className="settings-field">
                <span>Logo image URL</span>
                <input
                  maxLength={1000}
                  type="url"
                  value={configuration.restaurant.logoUrl ?? ''}
                  onChange={(event) =>
                    updateRestaurant('logoUrl', event.target.value || null)
                  }
                />
              </label>
              <label className="settings-field">
                <span>Primary brand color</span>
                <input
                  type="color"
                  value={configuration.restaurant.brandColors.primary}
                  onChange={(event) => updateBrandColor('primary', event.target.value)}
                />
              </label>
              <label className="settings-field">
                <span>Secondary brand color</span>
                <input
                  type="color"
                  value={configuration.restaurant.brandColors.secondary}
                  onChange={(event) => updateBrandColor('secondary', event.target.value)}
                />
              </label>
              <label className="settings-field">
                <span>Phone</span>
                <input
                  required
                  maxLength={32}
                  value={configuration.restaurant.contact.phone}
                  onChange={(event) => updateContact('phone', event.target.value)}
                />
              </label>
              <label className="settings-field">
                <span>Email</span>
                <input
                  required
                  type="email"
                  maxLength={254}
                  value={configuration.restaurant.contact.email}
                  onChange={(event) => updateContact('email', event.target.value)}
                />
              </label>
              <label className="settings-field">
                <span>Address</span>
                <input
                  required
                  maxLength={500}
                  value={configuration.restaurant.contact.address}
                  onChange={(event) => updateContact('address', event.target.value)}
                />
              </label>
              <label className="settings-field">
                <span>Currency code</span>
                <input
                  required
                  minLength={3}
                  maxLength={3}
                  value={configuration.restaurant.currency}
                  onChange={(event) =>
                    updateRestaurant('currency', event.target.value.toUpperCase())
                  }
                />
              </label>
            </div>
          </section>

          <section className="configuration-section">
            <div className="configuration-section-heading">
              <h2>Ordering settings</h2>
              <p>Amounts are entered in the selected currency, to two decimal places.</p>
            </div>
            <div className="configuration-fields configuration-fields-compact">
              <label className="settings-field">
                <span>Delivery fee</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={(configuration.settings.deliveryFeeCents / 100).toFixed(2)}
                  onChange={(event) =>
                    updateSetting(
                      'deliveryFeeCents',
                      Math.round(Number(event.target.value) * 100),
                    )
                  }
                />
              </label>
              <label className="settings-field">
                <span>Minimum order</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={(configuration.settings.minimumOrderCents / 100).toFixed(2)}
                  onChange={(event) =>
                    updateSetting(
                      'minimumOrderCents',
                      Math.round(Number(event.target.value) * 100),
                    )
                  }
                />
              </label>
            </div>
            <fieldset className="business-hours">
              <legend>Business hours</legend>
              <div className="business-hours-grid">
                {WEEKDAYS.map(([day, label]) => {
                  const hours = configuration.settings.businessHours[day];
                  return (
                    <div className="business-hours-row" key={day}>
                      <strong>{label}</strong>
                      <label className="closed-toggle">
                        <input
                          checked={hours === null}
                          onChange={(event) =>
                            updateBusinessHours(
                              day,
                              event.target.checked
                                ? null
                                : { open: '09:00', close: '17:00' },
                            )
                          }
                          type="checkbox"
                        />
                        Closed
                      </label>
                      {hours ? (
                        <>
                          <label>
                            <span className="visually-hidden">{label} opening time</span>
                            <input
                              required
                              type="time"
                              value={hours.open}
                              onChange={(event) =>
                                updateBusinessHours(day, {
                                  ...hours,
                                  open: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            <span className="visually-hidden">{label} closing time</span>
                            <input
                              required
                              type="time"
                              value={hours.close}
                              onChange={(event) =>
                                updateBusinessHours(day, {
                                  ...hours,
                                  close: event.target.value,
                                })
                              }
                            />
                          </label>
                        </>
                      ) : (
                        <span className="closed-label">Closed all day</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
            <p className="configuration-note">
              Configured payment methods: {configuration.settings.paymentMethods.join(', ')}.
              Checkout currently processes Cash on Delivery only; enable additional methods
              only after integrating a real payment provider.
            </p>
          </section>

          <section className="configuration-section">
            <div className="configuration-section-heading">
              <h2>Menu categories</h2>
              <p>Existing categories can be renamed or hidden from the public menu.</p>
            </div>
            <div className="configuration-list">
              {configuration.categories.map((category) => (
                <article className="configuration-row" key={category.id}>
                  <div className="configuration-row-fields">
                    <label className="settings-field">
                      <span>Category name</span>
                      <input
                        required
                        value={category.name}
                        onChange={(event) =>
                          updateCategory(category.id, { name: event.target.value })
                        }
                      />
                    </label>
                    <label className="settings-field">
                      <span>Description</span>
                      <input
                        value={category.description}
                        onChange={(event) =>
                          updateCategory(category.id, {
                            description: event.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                  <label className="availability-toggle">
                    <input
                      checked={category.active}
                      onChange={(event) =>
                        updateCategory(category.id, {
                          active: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    Visible
                  </label>
                </article>
              ))}
            </div>
          </section>

          <section className="configuration-section">
            <div className="configuration-section-heading">
              <h2>Menu products</h2>
              <p>Update prices and availability. Product options stay as configured.</p>
            </div>
            <div className="configuration-list">
              {configuration.products.map((product) => (
                <article className="configuration-row product-config-row" key={product.id}>
                  <div className="configuration-row-fields product-fields">
                    <label className="settings-field">
                      <span>Product name</span>
                      <input
                        required
                        value={product.name}
                        onChange={(event) =>
                          updateProduct(product.id, { name: event.target.value })
                        }
                      />
                    </label>
                    <label className="settings-field">
                      <span>Price ({configuration.restaurant.currency})</span>
                      <input
                        required
                        min="0"
                        step="0.01"
                        type="number"
                        value={(product.priceCents / 100).toFixed(2)}
                        onChange={(event) =>
                          updateProduct(product.id, {
                            priceCents: Math.round(
                              Number(event.target.value) * 100,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="settings-field product-description-field">
                      <span>Description</span>
                      <input
                        value={product.description}
                        onChange={(event) =>
                          updateProduct(product.id, {
                            description: event.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                  <label className="availability-toggle">
                    <input
                      checked={product.available}
                      onChange={(event) =>
                        updateProduct(product.id, {
                          available: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    Available
                  </label>
                </article>
              ))}
            </div>
          </section>

          {error && <p className="dashboard-error" role="alert">{error}</p>}
          {success && <p className="configuration-success" role="status">{success}</p>}
          <div className="configuration-save-row">
            <p>Changes apply to this restaurant’s API database and every connected website.</p>
            <button className="primary-button configuration-save" disabled={isSaving} type="submit">
              {isSaving ? 'Saving configuration…' : 'Save restaurant configuration'}
            </button>
          </div>
        </form>
      ) : (
        <p className="dashboard-error" role="alert">Restaurant configuration is unavailable.</p>
      )}
    </details>
  );
}

function MetricCard({ label, value, emphasis = false }) {
  return (
    <article className={`metric-card${emphasis ? ' metric-card-emphasis' : ''}`}>
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

function AdminHome() {
  const [admin, setAdmin] = useState(null);
  const [csrfToken, setCsrfToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pageStatus, setPageStatus] = useState('loading');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function checkSession() {
      try {
        const tokenResponse = await fetch('/api/admin/csrf', {
          credentials: 'include',
          signal: controller.signal,
        });
        const tokenResult = await readJsonResponse(tokenResponse);
        setCsrfToken(tokenResult.csrfToken);

        const sessionResponse = await fetch('/api/admin/me', {
          credentials: 'include',
          signal: controller.signal,
        });
        if (sessionResponse.status === 401) {
          setPageStatus('signed-out');
          return;
        }
        const sessionResult = await readJsonResponse(sessionResponse);
        setAdmin(sessionResult.admin);
        setError('');
        setPageStatus('signed-in');
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setError(requestError.message || 'Could not connect to the admin API.');
          setPageStatus('error');
        }
      }
    }

    checkSession();
    return () => controller.abort();
  }, []);

  async function handleLogin(event) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ email, password }),
      });
      const result = await readJsonResponse(response);
      setAdmin(result.admin);
      setCsrfToken(result.csrfToken);
      setPassword('');
      setError('');
      setPageStatus('signed-in');
    } catch (requestError) {
      setError(requestError.message || 'Sign-in failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    setError('');
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/admin/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': csrfToken },
      });
      if (!response.ok) {
        await readJsonResponse(response);
      }
      setAdmin(null);
      setPassword('');
      setPageStatus('signed-out');
    } catch (requestError) {
      setError(requestError.message || 'Sign-out failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (pageStatus === 'signed-in' && admin) {
    return (
      <AdminDashboard
        admin={admin}
        csrfToken={csrfToken}
        logoutError={error}
        isLoggingOut={isSubmitting}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <main className="admin-shell">
      <section className="admin-card">
        <div className="admin-brand-mark">
          <img src="/albaik-logo.png" alt="Al-Baik" />
        </div>
        <p className="eyebrow">AL-BAIK ORDERING</p>
        {pageStatus === 'loading' ? (
          <p className="loading-message" role="status">
            Checking your secure session…
          </p>
        ) : (
          <>
            <h1>Admin sign in</h1>
            <p className="intro">
              Sign in with the administrator account configured for this
              restaurant.
            </p>
            <form className="login-form" onSubmit={handleLogin}>
              <label className="form-field">
                <span>Email address</span>
                <input
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  disabled={isSubmitting || !csrfToken}
                  name="email"
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Password</span>
                <input
                  autoComplete="current-password"
                  disabled={isSubmitting || !csrfToken}
                  name="password"
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {pageStatus === 'error' && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => window.location.reload()}
                >
                  Try connecting again
                </button>
              )}
              <button
                className="primary-button"
                disabled={isSubmitting || !csrfToken || pageStatus === 'error'}
                type="submit"
              >
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            <p className="security-note">
              Administrator accounts are created by the system operator.
              Public registration is disabled.
            </p>
          </>
        )}
      </section>
      <footer className="admin-footer">
        Secure restaurant administration
      </footer>
    </main>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AdminHome />} />
        <Route path="*" element={<AdminHome />} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
