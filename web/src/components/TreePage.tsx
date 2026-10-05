import { useApp } from "../context";
import { BOOT, CFG, KINDS, NODES, PASS_PCT, XP_PER_LEVEL, colorOf, xpOf } from "../lib/boot";
import { badges, dueCards, levelOf, nodeState, passed, streak } from "../lib/progress";
import { KindChip } from "./KindChip";
import { SkillTree } from "./SkillTree";

export function TreePage() {
  const { progress } = useApp();
  const done = NODES.filter(n => passed(progress, n.id)).length;
  const { level, into, rank } = levelOf(progress.xp);
  const maxXp = NODES.reduce((s, n) => s + xpOf(n.kind), 0);
  const days = streak(progress);
  const list = badges(progress);
  const earned = list.filter(b => b.earned).length;
  const available = NODES.filter(n => nodeState(progress, n) === "available");
  return (
    <main id="main" className="wide">
      <h1>{BOOT.curriculum.title}</h1>
      {CFG.lede ? <p className="lede">{CFG.lede + ` Complete a node by passing its quiz at ${PASS_PCT}.`}</p> : null}
      <div className="hero">
        <div className="stat"><div className="v">{`Level ${level}`}</div><div className="l">{rank}</div><div className="bar"><i style={{ width: `${(into / XP_PER_LEVEL) * 100}%` }} /></div></div>
        <div className="stat"><div className="v">{`${progress.xp} XP`}</div><div className="l">{`of ${maxXp} from lessons, plus card reviews`}</div></div>
        <div className="stat"><div className="v">{`${done} / ${NODES.length}`}</div><div className="l">{`nodes completed (pass the quiz at ${PASS_PCT})`}</div></div>
        <div className="stat"><div className="v">{String(dueCards(progress).length)}</div><div className="l"><a href="/cards">flip cards due today</a></div></div>
        <div className="stat"><div className="v">{`${days} day${days === 1 ? "" : "s"}`}</div><div className="l">study streak (any quiz, card or lesson visit)</div></div>
      </div>
      <p className="panel-sub">{`Badges: ${earned} of ${list.length}. Hover a badge to see how to earn it.`}</p>
      <div className="badges">
        {list.map((b, i) => <span key={i} className={"badge" + (b.earned ? " earned" : "")} title={b.desc}>{b.name}</span>)}
      </div>
      <SkillTree progress={progress} />
      <div className="legend">
        {Object.entries(KINDS).filter(([, k]) => k.legend !== false).map(([id, k]) => <span key={id}><i style={{ borderColor: colorOf(id) }} />{k.label}</span>)}
        <span>Filled: completed. Pulsing: available. Faded: locked, but you can still read it.</span>
      </div>
      <h2 className="section-title">Available now</h2>
      {available.length ? (
        <div className="next-list">
          {available.map(n => (
            <a key={n.id} className="next-card" href={"/t/" + n.id}>
              <KindChip kind={n.kind} /><span className="t">{n.title}</span><span className="s">{`${n.summary} +${xpOf(n.kind)} XP`}</span>
            </a>
          ))}
        </div>
      ) : <p className="empty">Everything is completed.</p>}
    </main>
  );
}
