import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { drafts, useApp } from "../context";
import { api, errMsg } from "../lib/api";
import { PLATFORM, TOPIC, TYPE_LABEL } from "../lib/boot";
import { repliesFor, rootsFor } from "../lib/notes";
import type { Block } from "../types";
import { NoteView } from "./NoteView";

type Payload = Record<string, unknown> & { text: string };

function useSend() {
  const { online, refresh } = useApp();
  return async (payload: Payload, key: string, setBusy: (b: boolean) => void) => {
    if (!payload.text.trim()) return false;
    if (!online) { alert("The notes server is not running. Start it with: " + PLATFORM.serve_cmd); return false; }
    setBusy(true);
    try { await api("/api/notes", payload); drafts.delete(key); await refresh(); return true; }
    catch (err) { alert("Could not save: " + errMsg(err)); return false; }
    finally { setBusy(false); }
  };
}

function useDraft(key: string) {
  const [text, setText] = useState(drafts.get(key) || "");
  const change = (v: string) => { drafts.set(key, v); setText(v); };
  return [text, change, setText] as const;
}

const submitKeys = (submit: () => void) => (e: KeyboardEvent) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
};

const PLACEHOLDERS: Record<string, string> = {
  question: "Ask Claude about this part",
  request: "Tell Claude how to change the text here, or anywhere in the curriculum",
  comment: "A note for yourself. Claude does not answer comments",
};

function NewForm({ block, onClose }: { block: Block; onClose(): void }) {
  const key = "new:" + block.id;
  const [type, setType] = useState("question");
  const [text, change, setText] = useDraft(key);
  const [busy, setBusy] = useState(false);
  const send = useSend();
  const submit = () => send({ block: block.id, topic: TOPIC, type, text, section: block.section, excerpt: excerptOf(block), context: block.text }, key, setBusy).then(ok => { if (ok) setText(""); });
  return (
    <div className="form">
      <div className="form-title">New</div>
      <textarea placeholder={PLACEHOLDERS[type]} data-draft={key} value={text} onChange={e => change(e.target.value)}
        onKeyDown={e => {
          submitKeys(submit)(e);
          if (e.key === "Escape") { e.stopPropagation(); onClose(); }
        }} />
      <div className="form-row">
        <div className="seg" role="group" aria-label="Type">
          {Object.entries(TYPE_LABEL).map(([k, label]) => <button key={k} type="button" aria-pressed={k === type} onClick={() => setType(k)}>{label}</button>)}
        </div>
        <button className="btn primary" type="button" disabled={busy} onClick={submit}>Send</button>
        <button className="btn" type="button" onClick={onClose}>Close</button>
        <span className="hint">Cmd/Ctrl + Enter sends</span>
      </div>
    </div>
  );
}

function ReplyBox({ rootId, block, placeholder, onDone }: { rootId: string; block: string; placeholder: string; onDone(): void }) {
  const key = "reply:" + rootId;
  const [text, change] = useDraft(key);
  const [busy, setBusy] = useState(false);
  const send = useSend();
  const submit = () => send({ block, topic: TOPIC, parent: rootId, text }, key, setBusy).then(ok => { if (ok) onDone(); });
  return (
    <div className="reply-box">
      <textarea placeholder={placeholder} data-draft={key} value={text} autoFocus onChange={e => change(e.target.value)} onKeyDown={submitKeys(submit)} />
      <div className="form-row">
        <button className="btn primary" type="button" disabled={busy} onClick={submit}>Send reply</button>
        <button className="btn" type="button" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

export const excerptOf = (b: Block) => b.text.length > 110 ? b.text.slice(0, 107) + "..." : b.text;

interface Props {
  block: Block;
  visible: boolean;
  active: boolean;
  after: HTMLElement | null;
  onClose(): void;
  relayout(): void;
}

export function Thread({ block, visible, active, after, onClose, relayout }: Props) {
  const { notes } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const [openReplies, setOpenReplies] = useState<Set<string>>(() => new Set());
  const roots = rootsFor(notes, block.id);
  const [composing, setComposing] = useState(roots.length === 0);
  const seen = useRef(roots.length);
  useEffect(() => {
    if (roots.length > seen.current) setComposing(false);
    seen.current = roots.length;
  }, [roots.length]);
  useLayoutEffect(() => {
    const t = ref.current;
    if (t && after && after.nextSibling !== t) after.after(t);
    relayout();
  });
  const setReply = (id: string, on: boolean) => setOpenReplies(s => {
    const next = new Set(s);
    if (on) next.add(id); else next.delete(id);
    return next;
  });
  return (
    <div className={"thread" + (active ? " active" : "")} hidden={!visible} data-bid={block.id} ref={ref}
      onMouseEnter={() => block.el.classList.add("linked")} onMouseLeave={() => block.el.classList.remove("linked")}>
      <div className="thread-list">
        {roots.map(root => (
          <Fragment key={root.id}>
            <NoteView n={root} isReply={false} />
            {repliesFor(notes, root.id).map(r => <NoteView key={r.id} n={r} isReply />)}
            {openReplies.has(root.id)
              ? <ReplyBox rootId={root.id} block={root.block} placeholder={root.type === "comment" ? "Reply" : "Follow up with Claude"} onDone={() => setReply(root.id, false)} />
              : <div className="thread-foot"><button className="linkish" type="button" onClick={() => setReply(root.id, true)}>Reply</button></div>}
          </Fragment>
        ))}
      </div>
      {composing || roots.length === 0
        ? <NewForm block={block} onClose={onClose} />
        : <div className="thread-foot"><button className="linkish" type="button" onClick={() => setComposing(true)}>New question or comment</button><button className="linkish" type="button" onClick={onClose}>Close</button></div>}
    </div>
  );
}
