import { useState, type ReactNode } from "react";
import { useApp } from "../context";
import { score, terms } from "../lib/glossary";
import { TermCard } from "./TermCard";

function highlight(text: string, q: string): ReactNode {
  if (!q) return text;
  const out: ReactNode[] = [];
  const lower = text.toLowerCase();
  let i = 0, j: number;
  while ((j = lower.indexOf(q, i)) !== -1) { out.push(text.slice(i, j), <mark key={j}>{text.slice(j, j + q.length)}</mark>); i = j + q.length; }
  out.push(text.slice(i));
  return out;
}

const cats = ["all", ...[...new Set(terms.map(t => t.category))].sort()];

interface Props {
  query: string;
  exact: boolean;
  tick: number;
}

export function GlossaryPanel({ query, exact, tick }: Props) {
  const { panel, setPanel } = useApp();
  const [gCat, setGCat] = useState("all");
  const [catTick, setCatTick] = useState(0);
  const [catAt, setCatAt] = useState(-1);
  const openExact = exact && catAt !== tick;
  const q = query.trim().toLowerCase();
  const rows = terms.map((t, i) => ({ t, i, s: q ? score(t, q) : 0 })).filter(r => r.s >= 0 && (gCat === "all" || r.t.category === gCat))
    .sort((a, b) => a.s - b.s || (q ? a.t.term.localeCompare(b.t.term) : a.i - b.i));
  return (
    <aside className="panel" id="glossary-panel" hidden={panel !== "glossary"} aria-label="Glossary">
      <div className="panel-head"><h2>Glossary</h2><button className="btn" type="button" onClick={() => setPanel(null)}>Close</button></div>
      <div className="panel-body">
        <div className="seg tabs" id="g-cats">
          {cats.map(c => (
            <button key={c} type="button" aria-pressed={c === gCat} onClick={() => { setGCat(c); setCatTick(k => k + 1); setCatAt(tick); }}>
              {c === "all" ? "All" : c === "math" ? "math (notation)" : c}
            </button>
          ))}
        </div>
        <p className="panel-sub" id="g-summary">{q ? `${rows.length} of ${terms.length} terms match "${query.trim()}"` : `${terms.length} terms. Type in the search bar to filter.`}</p>
        <div id="g-results" key={tick + ":" + catTick}>
          {!rows.length ? <p className="empty">No term matches that search.</p> : null}
          {rows.map(({ t, i, s }, k) => (
            <details key={i} className="g-item" open={(openExact && s === 0) || (!!q && rows.length <= 3) || (!!q && k === 0 && s <= 1)}>
              <summary><span className="name">{highlight(t.term, q)}</span><span className="chip">{t.category}</span></summary>
              <TermCard idx={i} compact={false} className="body" />
            </details>
          ))}
        </div>
      </div>
    </aside>
  );
}
