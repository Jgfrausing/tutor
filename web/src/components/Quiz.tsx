import { useEffect, useRef, useState } from "react";
import { useApp } from "../context";
import { errMsg } from "../lib/api";
import { NODE, NODES, PASS_MARK, PASS_PCT, TOPIC, onServer, xpOf } from "../lib/boot";
import { choiceOrder, decode } from "../lib/dom";
import { nodeState, passed } from "../lib/progress";
import { confetti, playSound } from "../lib/sound";
import type { Question } from "../types";
import { MathText } from "./MathText";

interface Props {
  questions: Question[];
  review: boolean;
}

export function Quiz({ questions: qs, review }: Props) {
  const { progress, postProgress, showToast } = useApp();
  const saved = !review ? progress.quiz[TOPIC] : undefined;
  const restore = !!saved && Array.isArray(saved.answers) && saved.answers.length === qs.length;
  const [answers, setAnswers] = useState<(number | null)[]>(() => restore ? saved!.answers!.map(a => a == null ? null : a) : qs.map(() => null));
  const [graded, setGraded] = useState(false);
  const [result, setResult] = useState("");
  const saveTimer = useRef<number | undefined>(undefined);
  const best = progress.quiz[TOPIC];

  const saveAnswers = (list: (number | null)[]) => {
    if (review || !onServer) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { postProgress({ kind: "quiz_answers", topic: TOPIC, answers: list }).catch(() => {}); }, 300);
  };

  const grade = async (save: boolean) => {
    let right = 0, answered = 0;
    qs.forEach((q, qi) => {
      if (answers[qi] != null) answered++;
      if (answers[qi] === q.answer) right++;
    });
    setGraded(true);
    const pct = Math.round((right / qs.length) * 100);
    let text = `${right} of ${qs.length} right (${pct}%).` + (answered < qs.length ? ` ${qs.length - answered} unanswered.` : "");
    if (!save) {
      const q = progress.quiz[TOPIC];
      setResult(`Your last check${q && q.last ? " (" + new Date(q.last).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) + ")" : ""}: ` + text);
      return;
    }
    setResult(text);
    if (review) {
      try {
        const { gained } = await postProgress({ kind: "review", score: right, total: qs.length });
        text += ` +${gained} XP.`;
      } catch (err) { text += " (Progress not saved: " + errMsg(err) + ")"; }
      setResult(text);
      return;
    }
    try {
      const wasPassed = passed(progress, TOPIC);
      const { gained, progress: p } = await postProgress({ kind: "quiz", topic: TOPIC, score: right, total: qs.length, answers });
      const nowPassed = passed(p, TOPIC);
      if (!wasPassed && nowPassed) { confetti(); playSound("fanfare"); }
      else if (right / qs.length < PASS_MARK) playSound("wah");
      if (!wasPassed && nowPassed) {
        const unlocked = NODES.filter(k => k.id !== TOPIC && nodeState(p, k) === "available" && ((k.prereqs || []).includes(TOPIC) || (k.attached_to || []).includes(TOPIC)));
        text += ` Node completed, +${gained} XP.` + (unlocked.length ? " Unlocked: " + unlocked.map(k => k.title).join(", ") + "." : "");
        showToast(`Node completed: +${gained} XP`, () => { location.href = "/"; }, "xp");
      } else if (!nowPassed) {
        text += ` You need ${PASS_PCT} to complete the node.`;
      }
    } catch (err) {
      text += " (Progress not saved: " + errMsg(err) + ")";
    }
    setResult(text);
  };

  useEffect(() => {
    if (restore && saved!.checked) grade(false);
  }, []);

  const choose = (qi: number, ci: number) => {
    const next = answers.slice();
    next[qi] = ci;
    setAnswers(next);
    saveAnswers(next);
  };

  const retry = () => {
    if (review) { location.reload(); return; }
    const empty = qs.map(() => null);
    setAnswers(empty);
    setGraded(false);
    setResult("");
    saveAnswers(empty);
  };

  return (
    <section id="quiz">
      {!review ? (
        <>
          <h2 className="section-title">Quiz</h2>
          <p className="lede">{`${qs.length} questions. Score ${PASS_PCT} or more to complete this node${passed(progress, TOPIC) && best ? " (already completed, best " + best.best + "/" + best.total + ")" : " and earn " + xpOf(NODE[TOPIC].kind) + " XP"}.`}</p>
        </>
      ) : null}
      {qs.map((q, qi) => (
        <div className="quiz-q" key={qi}>
          <MathText as="p" className="q" text={`${qi + 1}. ${decode(q.q)}`} />
          {q.topic ? <p className="panel-sub">From <a href={"/t/" + q.topic}>{NODE[q.topic].title}</a></p> : null}
          {choiceOrder(q.choices.length, q.q).map(ci => (
            <label key={ci} className={graded ? (ci === q.answer ? "right" : answers[qi] === ci ? "wrong" : "") : ""}>
              <input type="radio" name={"q" + qi} value={String(ci)} checked={answers[qi] === ci} disabled={graded} onChange={() => choose(qi, ci)} />
              <MathText text={decode(q.choices[ci])} />
            </label>
          ))}
          <MathText as="p" className="explain" text={decode(q.explain || "")} hidden={!graded} />
        </div>
      ))}
      <div className="form-row">
        <button className="btn primary" type="button" hidden={graded} onClick={() => grade(true)}>Check answers</button>
        <button className="btn" type="button" hidden={!graded} onClick={retry}>Try again</button>
        <span className="quiz-result">{result}</span>
      </div>
    </section>
  );
}
