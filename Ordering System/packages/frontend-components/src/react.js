import { useCallback, useEffect, useState } from 'react';

export function useRestaurantCatalog(client) {
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  const reload = useCallback(() => {
    setReloadVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    client
      .getCatalog({ signal: controller.signal })
      .then(setCatalog)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') {
          setError(requestError);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [client, reloadVersion]);

  return { catalog, loading, error, reload };
}

export function useOrderTracking(client, reference) {
  const [tracking, setTracking] = useState(null);
  const [loading, setLoading] = useState(Boolean(reference));
  const [error, setError] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    if (!reference) {
      setTracking(null);
      setLoading(false);
      setError(null);
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    client
      .getOrderTracking(reference, { signal: controller.signal })
      .then(setTracking)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') {
          setError(requestError);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [client, reference, reloadVersion]);

  useEffect(() => {
    if (!reference) {
      setIsConnected(false);
      return undefined;
    }
    try {
      return client.subscribeToOrderUpdates(reference, {
        onUpdate: () => setReloadVersion((version) => version + 1),
        onOpen: () => setIsConnected(true),
        onError: () => setIsConnected(false),
      });
    } catch (subscriptionError) {
      setIsConnected(false);
      setError(subscriptionError);
      return undefined;
    }
  }, [client, reference]);

  const reload = useCallback(() => {
    setReloadVersion((version) => version + 1);
  }, []);

  return { tracking, loading, error, isConnected, reload };
}
