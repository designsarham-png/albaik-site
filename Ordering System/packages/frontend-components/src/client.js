function normalizeBaseUrl(baseUrl) {
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    throw new TypeError('An ordering API base URL is required.');
  }
  return baseUrl.trim().replace(/\/+$/, '');
}

function createRequestError(result, response) {
  const error = new Error(
    result?.error?.message ?? `The ordering API returned HTTP ${response.status}.`,
  );
  error.name = 'OrderingApiError';
  error.status = response.status;
  error.code = result?.error?.code ?? 'ORDERING_API_ERROR';
  error.details = result?.error?.details;
  return error;
}

function createOrderKey() {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID !== 'function') {
    throw new Error(
      'Secure order submission is unavailable in this browser. Use a modern browser.',
    );
  }
  return randomUUID.call(globalThis.crypto);
}

export function createOrderingClient({
  baseUrl = '/api',
  fetchImplementation = globalThis.fetch,
  eventSourceConstructor = globalThis.EventSource,
} = {}) {
  const apiBaseUrl = normalizeBaseUrl(baseUrl);
  if (typeof fetchImplementation !== 'function') {
    throw new TypeError('A Fetch API implementation is required.');
  }

  async function request(path, { signal, ...options } = {}) {
    const response = await fetchImplementation(`${apiBaseUrl}${path}`, {
      ...options,
      signal,
    });
    let result;
    try {
      result = await response.json();
    } catch (error) {
      throw new Error('The ordering API returned an invalid response.', {
        cause: error,
      });
    }
    if (!response.ok) {
      throw createRequestError(result, response);
    }
    return result;
  }

  return Object.freeze({
    createIdempotencyKey() {
      return createOrderKey();
    },

    async getCatalog({ signal } = {}) {
      const result = await request('/catalog', { signal });
      if (!result || typeof result !== 'object' || !result.restaurant) {
        throw new Error('The ordering API returned an invalid restaurant catalog.');
      }
      return result;
    },

    async createOrder(order, { idempotencyKey, signal } = {}) {
      const key = idempotencyKey ?? createOrderKey();
      if (typeof key !== 'string' || key.trim().length < 8 || key.length > 128) {
        throw new TypeError('An idempotency key between 8 and 128 characters is required.');
      }
      const result = await request('/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify(order),
        signal,
      });
      if (!result || typeof result !== 'object' || !result.order) {
        throw new Error('The ordering API returned an invalid order response.');
      }
      return result.order;
    },

    async getOrderTracking(reference, { signal } = {}) {
      if (typeof reference !== 'string' || reference.trim().length === 0) {
        throw new TypeError('An order tracking reference is required.');
      }
      const result = await request(
        `/orders/${encodeURIComponent(reference.trim())}`,
        { signal, cache: 'no-store' },
      );
      if (!result || typeof result !== 'object' || !result.order) {
        throw new Error('The ordering API returned invalid tracking information.');
      }
      return result;
    },

    subscribeToOrderUpdates(reference, { onUpdate, onOpen, onError } = {}) {
      if (typeof reference !== 'string' || reference.trim().length === 0) {
        throw new TypeError('An order tracking reference is required.');
      }
      if (typeof eventSourceConstructor !== 'function') {
        throw new Error('Live order updates are not supported in this browser.');
      }
      if (typeof onUpdate !== 'function') {
        throw new TypeError('An order update callback is required.');
      }

      const stream = new eventSourceConstructor(
        `${apiBaseUrl}/orders/${encodeURIComponent(reference.trim())}/events`,
      );
      const handleUpdate = (event) => {
        try {
          onUpdate(JSON.parse(event.data));
        } catch (error) {
          onError?.(error);
        }
      };
      stream.addEventListener('order_update', handleUpdate);
      if (onOpen) {
        stream.addEventListener('open', onOpen);
      }
      if (onError) {
        stream.addEventListener('error', onError);
      }
      return () => {
        stream.removeEventListener('order_update', handleUpdate);
        if (onOpen) {
          stream.removeEventListener('open', onOpen);
        }
        if (onError) {
          stream.removeEventListener('error', onError);
        }
        stream.close();
      };
    },
  });
}
