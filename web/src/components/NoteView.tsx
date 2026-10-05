import { useApp } from "../context";
import { api, errMsg } from "../lib/api";
import { TYPE_LABEL } from "../lib/boot";
import { fmt } from "../lib/dom";
import type { Note } from "../types";
import { Markdown } from "./Markdown";

function StateChip({ n }: { n: Note }) {
  const { listening } = useApp();
  if (n.status === "pending") return <span className="state pending">{listening ? "Waiting for Claude" : "Queued, Claude is offline"}</span>;
  if (n.status === "working") return <span className="state working">Claude is writing</span>;
  return null;
}

export function NoteView({ n, isReply }: { n: Note; isReply: boolean }) {
  const { refresh } = useApp();
  const who = n.author === "claude" ? "claude" : "you";
  const what = isReply ? "reply" : ({ question: "question", request: "edit request", comment: "comment" } as Record<string, string>)[n.type] || "note";
  const del = async () => {
    if (!confirm(isReply ? "Delete this reply?" : `Delete this ${what} and all its replies?`)) return;
    try { await api("/api/delete", { id: n.id }); await refresh(); } catch (err) { alert("Delete failed: " + errMsg(err)); }
  };
  return (
    <div className={`note ${who}${isReply ? " reply" : ""}`} data-id={n.id}>
      <div className="note-head">
        <span className={"who " + who}>{who === "claude" ? "Claude" : "You"}</span>
        {!isReply ? <span className={"type " + n.type}>{TYPE_LABEL[n.type] || n.type}</span> : null}
        <span>{fmt(n.created)}</span>
        <StateChip n={n} />
        {who === "you" ? (
          <span className="note-actions">
            <button className="btn-small" type="button" title={isReply ? "Delete this reply" : "Delete this " + what + " and every reply to it"} onClick={del}>{"Delete " + what}</button>
          </span>
        ) : null}
      </div>
      {who === "claude" ? <Markdown text={n.text} /> : <p className="note-text">{n.text}</p>}
    </div>
  );
}
