import { forwardRef, Fragment, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../context";
import { rootsFor, threadOpen } from "../lib/notes";
import type { Block, Note } from "../types";
import { Thread } from "./Thread";

interface ThreadState {
  visible: boolean;
  active: boolean;
}

export interface ThreadsApi {
  toggle(bid: string, force?: boolean): void;
}

function AddButton({ block, notes, onToggle }: { block: Block; notes: Note[]; onToggle(): void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const b = ref.current;
    const p = b && b.parentElement;
    if (b && p && p.firstChild !== b) p.prepend(b);
  });
  const roots = rootsFor(notes, block.id);
  const open = roots.some(r => threadOpen(notes, r));
  const answered = !open && notes.some(n => n.block === block.id && n.author === "claude");
  const cls = "c-add" + (block.el.tagName === "TR" ? " inline" : "") + (roots.length ? " has-notes" : "") + (open ? " has-q" : "") + (answered ? " has-answer" : "");
  return (
    <button ref={ref} className={cls} type="button" title="Ask a question, request an edit or comment" aria-label="Comments and questions"
      onClick={e => { e.stopPropagation(); onToggle(); }}>
      {roots.length ? String(roots.length) : "+"}
    </button>
  );
}

interface Props {
  blocks: Block[];
  sideEl: HTMLElement | null;
  mainEl: HTMLElement | null;
  sideMode: boolean;
}

export const LessonThreads = forwardRef<ThreadsApi, Props>(function LessonThreads({ blocks, sideEl, mainEl, sideMode }, ref) {
  const { notes, listening } = useApp();
  const [threads, setThreads] = useState<Record<string, ThreadState>>({});
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const sideRef = useRef(sideMode);
  sideRef.current = sideMode;
  const blockMap = useRef(new Map<string, Block>());
  blockMap.current = new Map(blocks.map(b => [b.id, b]));
  const rows = useRef(new Map<string, HTMLTableRowElement>());
  const sigs = useRef(new Map<string, string>());
  const pendingFocus = useRef<string | null>(null);

  const layoutSide = useCallback(() => {
    if (!sideRef.current || !sideEl || !mainEl) return;
    const base = mainEl.getBoundingClientRect().top;
    const items = [...sideEl.children]
      .filter((t): t is HTMLElement => t instanceof HTMLElement && t.classList.contains("thread") && !t.hidden)
      .map(t => {
        const b = blockMap.current.get(t.dataset.bid || "");
        return { t, top: (b ? b.el.getBoundingClientRect().top : 0) - base };
      })
      .sort((a, b) => a.top - b.top);
    let floor = 0;
    for (const it of items) {
      const top = Math.max(it.top, floor);
      it.t.style.top = top + "px";
      floor = top + it.t.offsetHeight + 12;
    }
  }, [sideEl, mainEl]);

  const close = (bid: string) => {
    const cur = threadsRef.current[bid];
    if (!cur) return;
    const keep = sideRef.current && rootsFor(notesRef.current, bid).length > 0;
    setThreads(s => ({ ...s, [bid]: { ...cur, active: false, visible: keep ? cur.visible : false } }));
  };

  const toggle = (bid: string, force?: boolean) => {
    const cur = threadsRef.current[bid] || { visible: false, active: false };
    const side = sideRef.current;
    const open = force || !cur.visible || (side && !cur.active);
    if (!open) { close(bid); return; }
    if (side || !rootsFor(notesRef.current, bid).length) pendingFocus.current = bid;
    setThreads(s => ({ ...s, [bid]: { visible: true, active: true } }));
  };

  useImperativeHandle(ref, () => ({ toggle }));

  useEffect(() => {
    let next = threadsRef.current, changed = false;
    for (const b of blocks) {
      const sig = JSON.stringify(notes.filter(n => n.block === b.id).map(n => [n.id, n.status, n.text])) + listening;
      if (sigs.current.get(b.id) === sig) continue;
      sigs.current.set(b.id, sig);
      const has = rootsFor(notes, b.id).length > 0;
      const cur = next[b.id];
      if (sideMode && has) {
        if (!cur || !cur.visible) { next = { ...next, [b.id]: { visible: true, active: cur ? cur.active : false } }; changed = true; }
      } else if (cur && cur.visible && sideMode && !has && !cur.active) {
        next = { ...next, [b.id]: { ...cur, visible: false } };
        changed = true;
      }
    }
    if (changed) setThreads(next);
  }, [notes, listening, blocks]);

  useEffect(() => {
    if (!sideMode) return;
    let next = threadsRef.current, changed = false;
    for (const b of blocks) {
      if (!rootsFor(notesRef.current, b.id).length) continue;
      const cur = next[b.id];
      if (cur && cur.visible) continue;
      next = { ...next, [b.id]: { visible: true, active: cur ? cur.active : false } };
      changed = true;
    }
    if (changed) setThreads(next);
  }, [sideMode]);

  useLayoutEffect(() => {
    for (const b of blocks) {
      const t = threads[b.id];
      b.el.classList.toggle("open", !!t && t.visible && (!sideMode || t.active));
      const row = rows.current.get(b.id);
      if (row) row.hidden = sideMode || !t || !t.visible;
    }
    layoutSide();
    const bid = pendingFocus.current;
    if (bid) {
      pendingFocus.current = null;
      const area = document.querySelector<HTMLTextAreaElement>(`textarea[data-draft="${CSS.escape("new:" + bid)}"]`);
      if (area) area.focus({ preventScroll: true });
    }
  });

  useEffect(() => {
    const onResize = () => layoutSide();
    addEventListener("resize", onResize);
    const ro = window.ResizeObserver && mainEl ? new ResizeObserver(onResize) : null;
    if (ro && mainEl) ro.observe(mainEl);
    return () => { removeEventListener("resize", onResize); if (ro) ro.disconnect(); };
  }, [layoutSide, mainEl]);

  const rowFor = (b: Block) => {
    let row = rows.current.get(b.id);
    if (!row) {
      row = document.createElement("tr");
      row.className = "thread-row";
      const td = document.createElement("td");
      td.colSpan = b.el.children.length;
      row.append(td);
      b.el.after(row);
      rows.current.set(b.id, row);
    }
    return row.firstElementChild as HTMLElement;
  };

  return (
    <>
      {blocks.map(b => {
        const t = threads[b.id];
        const btnHost = b.el.tagName === "TR" ? b.el.lastElementChild : b.el;
        let container: Element | null = null, after: HTMLElement | null = null;
        if (t) {
          if (sideMode) container = sideEl;
          else if (b.el.tagName === "TR") container = rowFor(b);
          else if (b.el.tagName === "LI") container = b.el;
          else { container = b.el.parentElement; after = b.el; }
        }
        return (
          <Fragment key={b.id}>
            {btnHost ? createPortal(<AddButton block={b} notes={notes} onToggle={() => toggle(b.id)} />, btnHost) : null}
            {t && container ? createPortal(
              <Thread block={b} visible={t.visible} active={t.active} after={after} onClose={() => close(b.id)} relayout={layoutSide} />,
              container,
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
});
