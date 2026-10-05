import { Fragment, useState } from "react";
import { useApp } from "../context";
import { NODE, NODES, PLATFORM, TOPIC } from "../lib/boot";
import { threadOpen, repliesFor } from "../lib/notes";
import type { Note } from "../types";
import { NoteView } from "./NoteView";

const FILTERS: [string, string][] = [["waiting", "Waiting on Claude"], ["question", "Questions"], ["request", "Edit requests"], ["comment", "Comments"], ["all", "Everything"]];
const topicOf = (n: Note) => n.topic || n.block.split("/")[0];

export function NotesPanel() {
  const { notes, panel, setPanel, lesson } = useApp();
  const [filter, setFilter] = useState("waiting");
  const order = NODES.map(n => n.id);
  const roots = notes.filter(n => !n.parent).filter(n => filter === "all" || (filter === "waiting" ? threadOpen(notes, n) : n.type === filter))
    .sort((a, b) => order.indexOf(topicOf(a)) - order.indexOf(topicOf(b)) || a.created.localeCompare(b.created));
  let lastTopic: string | null = null;
  return (
    <aside className="panel" id="notes-panel" hidden={panel !== "notes"} aria-label="Notes">
      <div className="panel-head"><h2>Comments and questions</h2><button className="btn" type="button" onClick={() => setPanel(null)}>Close</button></div>
      <div className="panel-body">
        <p className="panel-sub" id="notes-sub">Blue is you, purple is Claude. Every thread is also saved as markdown in <code>{`${PLATFORM.state}/notes/<topic>.md`}</code>.</p>
        <div className="tabs seg" id="n-tabs">
          {FILTERS.map(([k, label]) => <button key={k} type="button" data-filter={k} aria-pressed={k === filter} onClick={() => setFilter(k)}>{label}</button>)}
        </div>
        <div id="n-results">
          {panel !== "notes" ? null : !roots.length ? <p className="empty">{notes.length ? "Nothing in this view." : "No notes yet. Hover a paragraph, list item or table row in a lesson and click + to add one."}</p> : null}
          {panel !== "notes" ? null : roots.map(root => {
            const topic = topicOf(root);
            const head = topic !== lastTopic ? <div className="n-topic">{NODE[topic] ? NODE[topic].title : topic}</div> : null;
            lastTopic = topic;
            const api = lesson.current;
            const here = !!api && api.has(root.block);
            const label = here ? api!.excerptOf(root.block) : (root.excerpt || "");
            const excerpt = here
              ? <button className="linkish excerpt" type="button" onClick={() => api!.jumpTo(root.block)}>{label}</button>
              : topic !== TOPIC && NODE[topic] ? <a className="excerpt" href={`/t/${topic}#${root.block.split("/")[1]}`}>{label || "Open"}</a>
              : <span className="excerpt">{"(this text was removed) " + label}</span>;
            return (
              <Fragment key={root.id}>
                {head}
                <div className="n-item">
                  {excerpt}
                  <NoteView n={root} isReply={false} />
                  {repliesFor(notes, root.id).map(r => <NoteView key={r.id} n={r} isReply />)}
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
