import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { posters } from '../data/site';
import useSwipe from '../hooks/useSwipe';

const n = posters.length;
// Position of slide i relative to the current one, wrapped into [-n/2, n/2] so the loop always slides the short way.
const offset = (i, cur) => {
  const d = (i - cur + n) % n;
  return d > n / 2 ? d - n : d;
};
const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function HeroCarousel() {
  const [index, setIndex] = useState(0);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [hold, setHold] = useState(false);
  const prevIndex = useRef(0);
  const paused = hover || focus || hold;

  const go = (i) => setIndex((i + n) % n);
  const swipe = useSwipe({
    onPrev: () => go(index - 1),
    onNext: () => go(index + 1),
    onHold: () => setHold(true),
    onRelease: () => setHold(false),
  });

  useEffect(() => { prevIndex.current = index; }, [index]);

  // Autoplay: a fresh 5s countdown after every slide change or resume.
  useEffect(() => {
    if (paused || reduceMotion) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % n), 5000);
    return () => clearTimeout(t);
  }, [index, paused]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowLeft') go(index - 1);
    if (e.key === 'ArrowRight') go(index + 1);
  };

  return (
    <section className="hero wrap" aria-roledescription="carousel" aria-label="Promotions" onKeyDown={onKeyDown}>
      <div
        className={`car${swipe.dragging ? ' drag' : ''}`}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
        onPointerLeave={() => setHover(false)}
        onFocus={(e) => e.target.matches(':focus-visible') && setFocus(true)}
        onBlur={() => setFocus(false)}
        {...swipe.handlers}
      >
        {posters.map((p, i) => {
          const o = offset(i, index);
          // A slide that wraps from one far side to the other repositions instantly while off-screen.
          const jumped = Math.abs(o - offset(i, prevIndex.current)) > 1;
          return (
            <div
              key={p.src}
              className="sl"
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${n}`}
              aria-hidden={o !== 0}
              style={{ transform: `translateX(calc(${o * 100}% + ${swipe.drag}px))`, transition: jumped ? 'none' : undefined }}
            >
              <img src={p.src} alt={p.alt} width="1376" height="768" decoding="async" draggable="false" />
            </div>
          );
        })}
        <button className="arrow l" onClick={() => go(index - 1)} aria-label="Previous slide"><ChevronLeft /></button>
        <button className="arrow r" onClick={() => go(index + 1)} aria-label="Next slide"><ChevronRight /></button>
        <div className="dots">
          {posters.map((p, i) => (
            <button key={p.src} onClick={() => go(i)} aria-label={`Go to slide ${i + 1}`} aria-current={i === index} />
          ))}
        </div>
      </div>
    </section>
  );
}
