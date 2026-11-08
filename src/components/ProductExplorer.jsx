import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImagePlus } from 'lucide-react';
import { categories as productCategories, products as defaultProducts } from '../data/products';
import useSwipe from '../hooks/useSwipe';

const pad = (n) => String(n).padStart(2, '0');
const DEFAULT_FIT = 0.8;
const ROWS = Array.from({ length: 7 });
const UNITS = Array.from({ length: 2 });

function BgText({ label }) {
  const multiWord = label.trim().includes(' ');
  const words = label.trim().split(/\s+/);
  return (
    <div className="bgtext" aria-hidden="true" style={{ '--len': label.length }}>
      {ROWS.map((_, row) => (
        <div className="row" key={row}>
          {UNITS.map((__, unit) => (
            <span className={(multiWord ? row : row + unit) % 2 ? 'gold' : 'light'} key={unit}>
              {words.length === 2 && row % 2 ? `${words[1]} ${words[0]}` : label}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function measure(img, focus) {
  const scale = 160 / Math.max(img.naturalWidth, img.naturalHeight);
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(img, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const points = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] > 128) points.push([x, y]);
    }
  }
  if (points.length < 20) return null;

  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const bleeds = points.filter(([x, y]) => x === 0 || y === 0 || x === width - 1 || y === height - 1).length > 6;
  let center;
  let radius;
  if (focus) {
    center = [focus[0] * width, focus[1] * height];
    radius = Math.max(...points.map((point) => distance(point, center)));
  } else if (bleeds) {
    center = [
      points.reduce((total, point) => total + point[0], 0) / points.length,
      points.reduce((total, point) => total + point[1], 0) / points.length,
    ];
    const distances = points.map((point) => distance(point, center)).sort((a, b) => a - b);
    radius = distances[Math.floor(distances.length * 0.85)];
  } else {
    const farthest = (point) => points.reduce(
      (best, candidate) => distance(candidate, point) > distance(best, point) ? candidate : best,
    );
    const first = farthest(points[0]);
    const second = farthest(first);
    center = [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
    radius = distance(first, second) / 2;
    for (const point of points) {
      const currentDistance = distance(point, center);
      if (currentDistance > radius) {
        const nextRadius = (radius + currentDistance) / 2;
        const t = (currentDistance - nextRadius) / currentDistance;
        center = [
          center[0] + (point[0] - center[0]) * t,
          center[1] + (point[1] - center[1]) * t,
        ];
        radius = nextRadius;
      }
    }
  }
  const longestSide = Math.max(width, height);
  return {
    cx: center[0] / longestSide,
    cy: center[1] / longestSide,
    r: radius / longestSide,
    wu: width / longestSide,
    hu: height / longestSide,
  };
}

function place(measurement, fit) {
  if (!measurement) {
    return {
      left: `${50 - fit * 50}%`,
      top: `${50 - fit * 50}%`,
      width: `${fit * 100}%`,
      height: `${fit * 100}%`,
      objectFit: 'contain',
    };
  }
  const scale = fit / (2 * measurement.r);
  return {
    left: `${(0.5 - measurement.cx * scale) * 100}%`,
    top: `${(0.5 - measurement.cy * scale) * 100}%`,
    width: `${measurement.wu * scale * 100}%`,
    height: `${measurement.hu * scale * 100}%`,
  };
}

function ProductImage({ product }) {
  const [failed, setFailed] = useState(false);
  const [style, setStyle] = useState(null);
  const imageRef = useRef(null);
  const fit = product.fit ?? DEFAULT_FIT;

  const onLoad = useCallback((event) => {
    let imageMeasure = null;
    try {
      imageMeasure = measure(event.currentTarget, product.focus);
    } catch {
      imageMeasure = null;
    }
    setStyle(place(imageMeasure, fit));
  }, [fit, product.focus]);

  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth) onLoad({ currentTarget: image });
  }, [onLoad]);

  if (failed) {
    return (
      <div className="ph" role="img" aria-label={`${product.name} photo placeholder`}>
        <ImagePlus size={36} />
        <strong>Photo placeholder</strong>
        <code>public/assets/products/{product.id}.png</code>
      </div>
    );
  }
  return (
    <img
      ref={imageRef}
      className={`pimg${product.category === 'pizza' ? ' pizza' : ''}${product.category === 'burgers' ? ' burger' : ''}`}
      src={product.image}
      alt={product.name}
      loading="lazy"
      decoding="async"
      draggable="false"
      style={style ?? { opacity: 0 }}
      onLoad={onLoad}
      onError={() => setFailed(true)}
    />
  );
}

function formatPrice(product, currency) {
  if (!Number.isSafeInteger(product.priceCents)) return 'Price unavailable';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).format(product.priceCents / 100);
}

function AddToCartButton({ product, currency, onAddToCart }) {
  const unavailable = !product.available || !Number.isSafeInteger(product.priceCents);
  return (
    <button
      className="btn"
      type="button"
      onClick={() => onAddToCart(product)}
      disabled={unavailable}
      title={unavailable ? 'This item is currently unavailable.' : `Add ${product.name} to cart`}
    >
      {!product.catalogLoaded ? 'Loading…' : unavailable ? 'Unavailable' : 'Add to Cart'}
    </button>
  );
}

export default function ProductExplorer({
  products = defaultProducts,
  currency = 'PKR',
  onAddToCart,
  catalogLoading = false,
  catalogError = '',
}) {
  const [index, setIndex] = useState(0);
  const [jump, setJump] = useState(false);
  const navRef = useRef(null);
  const tabRefs = useRef({});
  const count = products.length;
  const wrap = (value) => (value + count) % count;
  const current = products[index] ?? products[0];
  const group = productCategories.find((category) => category.id === current?.category);
  const position = group?.items.findIndex((product) => product.id === current.id) ?? 0;

  const go = useCallback((nextIndex, isJump = false) => {
    if (count === 0) return;
    setJump(isJump);
    setIndex(wrap(nextIndex));
  }, [count]);
  const goCategory = useCallback((id) => {
    const nextIndex = products.findIndex((product) => product.category === id);
    if (nextIndex >= 0) go(nextIndex, true);
  }, [go, products]);
  const prev = () => go(index - 1);
  const next = () => go(index + 1);
  const swipe = useSwipe({ onPrev: prev, onNext: next });

  useEffect(() => {
    if (index >= count) setIndex(Math.max(0, count - 1));
  }, [count, index]);

  useEffect(() => {
    const handler = (event) => goCategory(event.detail);
    window.addEventListener('albaik:category', handler);
    return () => window.removeEventListener('albaik:category', handler);
  }, [goCategory]);

  useEffect(() => {
    const nav = navRef.current;
    const element = tabRefs.current[current?.category];
    if (nav && element) {
      nav.scrollTo({
        left: element.offsetLeft - (nav.clientWidth - element.offsetWidth) / 2,
        behavior: 'smooth',
      });
    }
  }, [current?.category]);

  if (!current || !group) {
    return (
      <section className="menu" id="menu" aria-labelledby="menu-title">
        <div className="wrap">
          <h2 className="title" id="menu-title">Explore<span>Our Menu</span></h2>
          <p className="catalog-error" role="alert">{catalogError || 'The menu is currently unavailable.'}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="menu" id="menu" aria-labelledby="menu-title">
      <div className="wrap">
        <h2 className="title" id="menu-title">Explore<span>Our Menu</span></h2>
        {catalogLoading && <p className="catalog-note" role="status">Loading current prices and availability…</p>}
        {catalogError && <p className="catalog-error" role="alert">{catalogError}</p>}

        <nav className="cats" ref={navRef} aria-label="Menu categories">
          {productCategories.map((category) => (
            <button
              key={category.id}
              ref={(element) => { tabRefs.current[category.id] = element; }}
              className={`cat${category.id === current.category ? ' on' : ''}`}
              aria-current={category.id === current.category}
              onClick={() => goCategory(category.id)}
            >
              {category.label}
            </button>
          ))}
        </nav>

        <div
          className={`stage${jump ? ' jump' : ''}${swipe.dragging ? ' dragging' : ''}`}
          tabIndex={0}
          role="group"
          aria-roledescription="carousel"
          aria-label="Menu items. Swipe, drag or use the arrow keys."
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') next();
            if (event.key === 'ArrowLeft') prev();
          }}
          {...swipe.handlers}
        >
          {[-1, 0, 1].map((delta) => {
            const product = products[wrap(index + delta)];
            const reveal = swipe.drag * delta < 0 ? Math.min(Math.abs(swipe.drag) / 240, 1) : 0;
            return (
              <article
                key={product.id}
                className={`slide${delta === 0 ? ' on' : ''}`}
                aria-hidden={delta !== 0}
                inert={delta !== 0 ? '' : undefined}
                style={{
                  transform: `translateX(calc(${delta * 100}% + ${swipe.drag}px)) scale(${delta === 0 ? 1 : 0.92})`,
                  opacity: delta === 0 ? 1 : reveal,
                }}
              >
                <div className="media">
                  <div className="disc">
                    <BgText label={product.backgroundText} />
                    <ProductImage product={product} />
                  </div>
                </div>
                <div className="info">
                  <h3 className="name">{product.name}</h3>
                  <p className="desc">{product.description}</p>
                  <div className="buy">
                    <span className={`price${!product.available ? ' price-unavailable' : ''}`}>
                      {!product.catalogLoaded ? 'Loading…' : product.available ? formatPrice(product, currency) : 'Sold Out'}
                    </span>
                    <AddToCartButton product={product} currency={currency} onAddToCart={onAddToCart} />
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <div className="ctrl">
          <button className="round" onClick={prev} aria-label="Previous product"><ChevronLeft /></button>
          <div className="pos">
            <b>{pad(position + 1)}<span> / {pad(group.items.length)}</span></b>
            <div className="pips" aria-hidden="true">
              {group.items.map((product) => <i key={product.id} className={product.id === current.id ? 'on' : ''} />)}
            </div>
          </div>
          <button className="round" onClick={next} aria-label="Next product"><ChevronRight /></button>
        </div>
        <p className="sr-only" aria-live="polite">
          {current.name}, {current.categoryLabel}, item {index + 1} of {count}
        </p>
      </div>
    </section>
  );
}
