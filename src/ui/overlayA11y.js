// Overlay keyboard accessibility (story #35): Escape closes, Tab cycles inside
// the dialog, focus returns to the opener on unmount.
// useLayoutEffect on purpose: it runs synchronously after the DOM commit (refs
// are set, focus lands before paint) and does not depend on rAF-driven effect
// flushing — Preact defers useEffect via requestAnimationFrame, which throttled
// environments may starve.
import { useLayoutEffect, useRef } from 'preact/hooks';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function useOverlayA11y(onClose) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const opener = document.activeElement;
    const focusables = () => [...root.querySelectorAll(FOCUSABLE)].filter((e) => !e.disabled && e.offsetParent !== null);
    (focusables()[0] ?? root).focus();

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, []);
  return ref;
}
