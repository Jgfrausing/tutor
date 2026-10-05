import type { CNode, Progress, TopicCard } from "../types";
import { BOOT, CFG, NEW_PER_DAY, NODE, NODES, RANKS, XP_PER_LEVEL, isSide } from "./boot";

export type NodeState = "completed" | "available" | "locked";

export const today = () => new Date().toISOString().slice(0, 10);
export const passed = (p: Progress, id: string) => !!(p.quiz[id] && p.quiz[id].passed);

export function nodeState(p: Progress, n: CNode): NodeState {
  if (passed(p, n.id)) return "completed";
  if (isSide(n)) {
    const anchors = n.attached_to || [];
    return anchors.some(a => NODE[a] && nodeState(p, NODE[a]) !== "locked") ? "available" : "locked";
  }
  return (n.prereqs || []).every(id => passed(p, id)) ? "available" : "locked";
}

export function levelOf(xp: number) {
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  return { level, into: xp % XP_PER_LEVEL, rank: RANKS[Math.min(level - 1, RANKS.length - 1)] };
}

export function allCards(): TopicCard[] {
  return NODES.flatMap(n => (BOOT.cards[n.id] || []).map(c => ({ ...c, topic: n.id })));
}

export function dueCards(p: Progress): TopicCard[] {
  const open = allCards().filter(c => passed(p, c.topic));
  const seen = open.filter(c => p.cards[c.id] && p.cards[c.id].due <= today());
  const newToday = Object.values(p.cards).filter(c => c.first === today()).length;
  const fresh = open.filter(c => !p.cards[c.id]).slice(0, Math.max(0, NEW_PER_DAY - newToday));
  return [...seen, ...fresh];
}

export function newCardsWaiting(p: Progress): number {
  return allCards().filter(c => passed(p, c.topic) && !p.cards[c.id]).length;
}

const reviewsDone = (p: Progress) => Object.values(p.cards).reduce((sum, c) => sum + (c.reviews || 0), 0);
const ofKind = (kind?: string) => NODES.filter(n => !kind || n.kind === kind);
const perfect = (p: Progress, id: string) => {
  const q = p.quiz[id];
  return !!q && q.attempts > 0 && q.total > 0 && q.best === q.total;
};

export function badges(p: Progress) {
  return (CFG.badges || []).map(b => {
    const r = b.rule;
    let earned = false;
    if (r) {
      switch (r.type) {
        case "passed": earned = passed(p, r.node || ""); break;
        case "all_passed": earned = (r.nodes || []).every(id => passed(p, id)); break;
        case "count_passed": earned = ofKind(r.kind).filter(n => passed(p, n.id)).length >= (r.n || 1); break;
        case "all_of_kind": earned = ofKind(r.kind).length > 0 && ofKind(r.kind).every(n => passed(p, n.id)); break;
        case "cards_reviewed": earned = reviewsDone(p) >= (r.n || 1); break;
        case "perfect_quiz": earned = ofKind(r.kind).some(n => perfect(p, n.id)); break;
      }
    }
    return { name: b.name, desc: b.desc, earned };
  });
}

export function streak(p: Progress) {
  const days = new Set(p.events.map(e => e.at.slice(0, 10)));
  const d = new Date();
  if (!days.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1);
  let n = 0;
  while (days.has(d.toISOString().slice(0, 10))) { n++; d.setUTCDate(d.getUTCDate() - 1); }
  return n;
}

export const shuffle = <T,>(list: T[]) => list.sort(() => Math.random() - 0.5);
