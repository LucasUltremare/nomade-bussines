import { useState, useEffect, useLayoutEffect, useRef } from "react";

/* ══════════════════════════════════════════════════════════
   useFloating — posiciona elemento em portal (position:fixed)
   relativo a um anchor, escapando de stacking contexts.

   Uso:
     const { anchorRef, floatingRef, pos, isOpen, open, close, toggle } = useFloating({ align: "right" });
     <button ref={anchorRef} onClick={toggle}>...</button>
     {isOpen && createPortal(
       <div ref={floatingRef} style={{ position:'fixed', top: pos.top, left: pos.left, right: pos.right }}>
         ...
       </div>,
       document.body
     )}
   ══════════════════════════════════════════════════════════ */

export function useFloating({ align = "right", offset = 6 } = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, right: 0 });
  const anchorRef = useRef(null);
  const floatingRef = useRef(null);

  const reposition = () => {
    if (!anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    if (align === "right") {
      setPos({
        top: r.bottom + offset,
        left: "auto",
        right: Math.max(8, window.innerWidth - r.right),
      });
    } else {
      setPos({
        top: r.bottom + offset,
        left: Math.max(8, r.left),
        right: "auto",
      });
    }
  };

  useLayoutEffect(() => {
    if (isOpen) reposition();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onOut = (e) => {
      if (anchorRef.current?.contains(e.target)) return;
      if (floatingRef.current?.contains(e.target)) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", onOut);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onOut);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [isOpen]);

  return {
    anchorRef,
    floatingRef,
    pos,
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen(v => !v),
  };
}