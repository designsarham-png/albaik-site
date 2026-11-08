import { useRef, useState } from 'react';

// Pointer-based swipe/drag (touch, pen and mouse). Vertical page scroll stays native via CSS touch-action: pan-y.
export default function useSwipe({ onPrev, onNext, onHold, onRelease, threshold = 48 }) {
  const start = useRef(null); // { x, active }
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);

  const finish = (e, commit) => {
    const s = start.current;
    if (!s) return;
    start.current = null;
    const dx = e.clientX - s.x;
    setDrag(0);
    setDragging(false);
    onRelease?.();
    if (commit && s.active) {
      if (dx <= -threshold) onNext();
      else if (dx >= threshold) onPrev();
    }
  };

  return {
    drag,
    dragging,
    handlers: {
      onPointerDown: (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        start.current = { x: e.clientX, active: false };
        onHold?.();
      },
      onPointerMove: (e) => {
        const s = start.current;
        if (!s) return;
        const dx = e.clientX - s.x;
        if (!s.active && Math.abs(dx) > 6) {
          // Capture only once a real drag begins, so plain clicks on inner buttons still work.
          s.active = true;
          setDragging(true);
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }
        if (s.active) setDrag(dx);
      },
      onPointerUp: (e) => finish(e, true),
      onPointerCancel: (e) => finish(e, false),
    },
  };
}
