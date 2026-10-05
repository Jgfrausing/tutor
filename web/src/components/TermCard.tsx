import { Fragment } from "react";
import { useApp } from "../context";
import { NODE } from "../lib/boot";
import { byName, terms } from "../lib/glossary";
import { MathText } from "./MathText";

export function TermCard({ idx, compact, className }: { idx: number; compact: boolean; className?: string }) {
  const { openGlossary } = useApp();
  const t = terms[idx];
  return (
    <div className={className}>
      {compact ? <div className="pop-head"><span className="pop-term">{t.term}</span><span className="chip">{t.category}</span></div> : null}
      <MathText as="p" className="pop-def" text={t.definition} />
      {t.aliases && t.aliases.length ? <MathText as="p" className="pop-meta" text={"Also called: " + t.aliases.join(", ")} /> : null}
      {t.see_also && t.see_also.length ? (
        <p className="pop-meta">See also: {t.see_also.map((s, k) => {
          const j = byName.get(s.toLowerCase());
          return (
            <Fragment key={k}>
              {k ? ", " : null}
              {j == null ? s : <button className="linkish" type="button" onClick={() => openGlossary(terms[j].term, true)}>{s}</button>}
            </Fragment>
          );
        })}</p>
      ) : null}
      {t.topic && NODE[t.topic] ? <p className="pop-meta">Introduced in <a href={"/t/" + t.topic}>{NODE[t.topic].title}</a></p> : null}
    </div>
  );
}
