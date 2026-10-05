import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { morph } from "../lib/dom";
import type { TopicCard } from "../types";
import { FlipCard } from "./FlipCard";

interface Props {
  list: TopicCard[];
  start: number;
  sources: (HTMLButtonElement | null)[];
  onClose(): void;
}

export function CardModal({ list, start, sources, onClose }: Props) {
  const [idx, setIdx] = useState(start);
  const [flipped, setFlipped] = useState(false);
  const cardRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);

  useLayoutEffect(() => {
    const modal = modalRef.current;
    if (modal && modal.animate) modal.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    const src = sources[start];
    if (cardRef.current) morph(cardRef.current, src ? src.getBoundingClientRect() : null);
    if (closeRef.current) closeRef.current.focus();
  }, []);

  const go = (d: number) => {
    if (idx + d >= 0 && idx + d < list.length) { setIdx(idx + d); setFlipped(false); }
  };

  const done = async () => {
    if (closing.current) return;
    closing.current = true;
    const src = sources[idx];
    const modal = modalRef.current;
    if (modal && modal.animate) modal.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, fill: "forwards" });
    if (cardRef.current) await morph(cardRef.current, src ? src.getBoundingClientRect() : null, true);
    onClose();
    if (src) src.focus();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); done(); }
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " " || e.key === "Enter") { e.preventDefault(); setFlipped(f => !f); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });

  return createPortal(
    <div className="card-modal" role="dialog" aria-modal="true" aria-label="Flip card" ref={modalRef} onClick={e => { if (e.target === e.currentTarget) done(); }}>
      <div style={{ width: "min(42rem, 100%)", display: "flex", justifyContent: "center" }}>
        <FlipCard key={idx} ref={cardRef} card={list[idx]} big={false} flipped={flipped} onClick={() => setFlipped(f => !f)} />
      </div>
      <div className="card-modal-bar">
        <button className="btn" type="button" disabled={idx === 0} onClick={() => go(-1)}>Previous</button>
        <button className="btn primary" type="button" onClick={() => setFlipped(f => !f)}>Flip</button>
        <button className="btn" type="button" disabled={idx === list.length - 1} onClick={() => go(1)}>Next</button>
        <span className="panel-sub">{`${idx + 1} of ${list.length}. Click the card or press space to flip.`}</span>
        <button className="btn" type="button" ref={closeRef} onClick={done}>Close</button>
      </div>
    </div>,
    document.body,
  );
}

export function CardsGrid({ list, onOpen }: { list: TopicCard[]; onOpen(i: number, sources: (HTMLButtonElement | null)[]): void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="cards-grid">
      {list.map((c, i) => <FlipCard key={c.id} ref={el => { refs.current[i] = el; }} card={c} big={false} flipped={false} label="Open card" onClick={() => onOpen(i, refs.current)} />)}
    </div>
  );
}
