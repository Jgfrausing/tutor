import { memo, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { TermCard } from "./TermCard";

export const GlossaryPopup = memo(function GlossaryPopup({ hideRef }: { hideRef: MutableRefObject<() => void> }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const show = (a: HTMLElement) => {
      clearTimeout(hideTimer.current);
      if (anchorRef.current === a) return;
      anchorRef.current = a;
      setAnchor(a);
    };
    const hide = () => { anchorRef.current = null; setAnchor(null); };
    const hideSoon = () => { clearTimeout(hideTimer.current); hideTimer.current = window.setTimeout(hide, 220); };
    hideRef.current = hide;
    const target = (e: Event) => e.target instanceof Element ? e.target : null;
    const onOver = (e: MouseEvent) => {
      const el = target(e);
      if (!el) return;
      const t = el.closest<HTMLElement>(".g-term");
      if (t) show(t); else if (el.closest("#pop")) clearTimeout(hideTimer.current);
    };
    const onOut = (e: MouseEvent) => { const el = target(e); if (el && el.closest(".g-term, #pop")) hideSoon(); };
    const onFocusIn = (e: FocusEvent) => { const el = target(e); const t = el && el.closest<HTMLElement>(".g-term"); if (t) show(t); };
    const onFocusOut = (e: FocusEvent) => { const el = target(e); if (el && el.closest(".g-term")) hideSoon(); };
    const onClick = (e: MouseEvent) => {
      const el = target(e);
      const t = el && el.closest<HTMLElement>(".g-term");
      if (t) { show(t); return; }
      if (!el || !el.closest("#pop")) hide();
    };
    const onScroll = () => { if (anchorRef.current) hide(); };
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("click", onClick);
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("click", onClick);
      removeEventListener("scroll", onScroll);
    };
  }, [hideRef]);

  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(16, Math.min(r.left, innerWidth - w - 16)) + "px";
    let top = r.bottom + 8;
    if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 8);
    pop.style.top = top + "px";
  }, [anchor]);

  const idx = anchor ? Number(anchor.dataset.term) : -1;
  return (
    <div id="pop" role="tooltip" ref={popRef} hidden={!anchor}>
      {anchor ? <TermCard key={idx} idx={idx} compact /> : null}
    </div>
  );
});
