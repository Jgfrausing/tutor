import { useState } from "react";
import { useApp } from "../context";
import { errMsg } from "../lib/api";
import { NODE } from "../lib/boot";
import { allCards, dueCards, passed, shuffle } from "../lib/progress";
import { FlipCard } from "./FlipCard";

export function CardsPage() {
  const { progress, postProgress } = useApp();
  const [queue, setQueue] = useState(() => shuffle(dueCards(progress)));
  const [total] = useState(() => allCards().filter(c => passed(progress, c.topic)).length);
  const [turn, setTurn] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const c = queue[0];

  const answer = async (ok: boolean) => {
    setBusy(true);
    try { await postProgress({ kind: "card", card: c.id, correct: ok }); } catch (err) { alert("Could not save: " + errMsg(err)); }
    setQueue(q => { const [head, ...rest] = q; return ok ? rest : [...rest, head]; });
    setTurn(t => t + 1);
    setRevealed(false);
    setBusy(false);
  };

  return (
    <main id="main">
      <h1>Flip card review</h1>
      <p className="lede">{`Cards from lessons you have completed (${total} cards so far). "Got it" moves a card to a longer interval (1, 2, 4, 8, 16, 32 days); "Again" brings it back today. Each "Got it" on a due card is worth 2 XP.`}</p>
      <div className="review">
        {!c ? (
          <p className="empty">{total ? "Nothing due. Come back tomorrow, or complete another lesson to add its cards. " : "Complete a lesson (pass its quiz) to add its cards here. "}<a href="/">Go to the tree</a></p>
        ) : (
          <>
            <p className="panel-sub">{`${queue.length} left. From `}<a href={"/t/" + c.topic}>{NODE[c.topic].title}</a>.</p>
            <FlipCard key={turn} card={c} big onClick={() => setRevealed(true)} />
            <div className="review-actions">
              <button className="btn" type="button" disabled={!revealed || busy} onClick={() => answer(false)}>Again</button>
              <button className="btn primary" type="button" disabled={!revealed || busy} onClick={() => answer(true)}>Got it</button>
            </div>
            <p className="panel-sub" style={{ textAlign: "center" }}>{revealed ? "Did you remember it? Grade yourself." : "Click the card to see the answer."}</p>
          </>
        )}
      </div>
    </main>
  );
}
