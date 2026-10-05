import { useState } from "react";
import { useApp } from "../context";
import { BOOT, NODES } from "../lib/boot";
import { shuffle } from "../lib/progress";
import { Quiz } from "./Quiz";

export function ReviewPage() {
  const { progress } = useApp();
  const [{ pool, picked }] = useState(() => {
    const pool = NODES.filter(n => progress.visited[n.id] && BOOT.quizzes[n.id]).flatMap(n => BOOT.quizzes[n.id].questions.map(q => ({ ...q, topic: n.id })));
    return { pool, picked: shuffle(pool.slice()).slice(0, 10) };
  });
  return (
    <main id="main">
      <h1>Mixed review</h1>
      <p className="lede">{`Ten random questions from the ${new Set(pool.map(q => q.topic)).size} lessons you have opened. Each right answer is worth 3 XP. "Try again" draws a new set.`}</p>
      {picked.length ? <Quiz questions={picked} review /> : <p className="empty">Open a lesson from the skill tree first.</p>}
    </main>
  );
}
