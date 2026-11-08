import { useCallback, useEffect, useMemo, useState } from 'react';
import Header from './components/Header';
import HeroCarousel from './components/HeroCarousel';
import ProductExplorer from './components/ProductExplorer';
import CartCheckout from './components/CartCheckout';
import DealStrip from './components/DealStrip';
import About from './components/About';
import Footer from './components/Footer';
import { products as menuProducts } from './data/products';

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);

  const refreshCatalog = useCallback(async () => {
    try {
      const response = await fetch('/api/catalog', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error?.message ?? 'The menu could not be loaded.');
      }
      if (!result.restaurant || !Array.isArray(result.categories)) {
        throw new Error('The ordering service returned an invalid menu.');
      }
      setCatalog({
        ...result,
        products: result.categories.flatMap((category) => category.products ?? []),
      });
      setCatalogError('');
    } catch (error) {
      setCatalogError(error.message || 'The ordering service is unavailable.');
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshCatalog();
    const interval = window.setInterval(refreshCatalog, 30000);
    window.addEventListener('focus', refreshCatalog);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshCatalog);
    };
  }, [refreshCatalog]);

  const products = useMemo(() => {
    const apiProducts = new Map((catalog?.products ?? []).map((product) => [product.id, product]));
    return menuProducts.map((product) => {
      const apiProduct = apiProducts.get(product.id);
      return {
        ...product,
        name: apiProduct?.name ?? product.name,
        description: apiProduct?.description ?? product.description,
        priceCents: apiProduct?.priceCents,
        available: Boolean(apiProduct?.available && catalog),
        catalogLoaded: Boolean(catalog),
      };
    });
  }, [catalog]);

  const cartItems = useMemo(() => cart
    .map(({ productId, quantity }) => ({
      product: products.find((product) => product.id === productId),
      quantity,
    }))
    .filter(({ product }) => product), [cart, products]);
  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);

  function addToCart(product) {
    if (!product.available || !Number.isSafeInteger(product.priceCents)) return;
    setCart((current) => {
      const existing = current.find((item) => item.productId === product.id);
      if (existing?.quantity >= 50) return current;
      if (existing) {
        return current.map((item) => item.productId === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item);
      }
      return [...current, { productId: product.id, quantity: 1 }];
    });
  }

  function changeQuantity(productId, quantity) {
    if (quantity < 1) {
      setCart((current) => current.filter((item) => item.productId !== productId));
      return;
    }
    setCart((current) => current.map((item) => item.productId === productId
      ? { ...item, quantity: Math.min(quantity, 50) }
      : item));
  }

  return (
    <>
      <Header cartCount={cartCount} onOpenCart={() => setCartOpen(true)} />
      <main>
        <HeroCarousel />
        <ProductExplorer
          products={products}
          currency={catalog?.restaurant?.currency ?? 'PKR'}
          onAddToCart={addToCart}
          catalogLoading={catalogLoading}
          catalogError={catalogError}
        />
        <DealStrip />
        <About />
      </main>
      <Footer />
      <CartCheckout
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        items={cartItems}
        catalog={catalog}
        onChangeQuantity={changeQuantity}
        onRemove={(productId) => setCart((current) => current.filter((item) => item.productId !== productId))}
        onOrderPlaced={() => setCart([])}
      />
    </>
  );
}
