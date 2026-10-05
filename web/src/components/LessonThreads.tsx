import { forwardRef, Fragment, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../context";
import { rootsFor, threadOpen } from "../lib/notes";
import type { Block, Note } from "../types";
import { Thread } from "./Thread";

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

export const LessonThreads = forwardRef<ThreadsApi, { blocks: Block[] }>(function LessonThreads({ blocks }, ref) {
  const { notes } = useApp();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const openRef = useRef(open);
  openRef.current = open;
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const rows = useRef(new Map<string, HTMLTableRowElement>());
  const pendingFocus = useRef<string | null>(null);

  const close = (bid: string) => setOpen(s => ({ ...s, [bid]: false }));

  const toggle = (bid: string, force?: boolean) => {
    if (!force && openRef.current[bid]) { close(bid); return; }
    if (!rootsFor(notesRef.current, bid).length) pendingFocus.current = bid;
    setOpen(s => ({ ...s, [bid]: true }));
  };

  useImperativeHandle(ref, () => ({ toggle }));

  useLayoutEffect(() => {
    for (const b of blocks) {
      b.el.classList.toggle("open", !!open[b.id]);
      const row = rows.current.get(b.id);
      if (row) row.hidden = !open[b.id];
    }
    const bid = pendingFocus.current;
    if (bid) {
      pendingFocus.current = null;
      const area = document.querySelector<HTMLTextAreaElement>(`textarea[data-draft="${CSS.escape("new:" + bid)}"]`);
      if (area) area.focus({ preventScroll: true });
    }
  });

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
        const seen = b.id in open;
        const btnHost = b.el.tagName === "TR" ? b.el.lastElementChild : b.el;
        let container: Element | null = null, after: HTMLElement | null = null;
        if (seen) {
          if (b.el.tagName === "TR") container = rowFor(b);
          else if (b.el.tagName === "LI") container = b.el;
          else { container = b.el.parentElement; after = b.el; }
        }
        return (
          <Fragment key={b.id}>
            {btnHost ? createPortal(<AddButton block={b} notes={notes} onToggle={() => toggle(b.id)} />, btnHost) : null}
            {seen && container ? createPortal(
              <Thread block={b} visible={open[b.id]} after={after} onClose={() => close(b.id)} />,
              container,
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
});
