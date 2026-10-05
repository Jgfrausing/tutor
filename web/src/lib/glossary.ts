import type { Term } from "../types";
import { BOOT, CFG } from "./boot";

export const terms: Term[] = BOOT.glossary;
const CASE_SENSITIVE = new Set(CFG.case_sensitive_terms || []);
export const byName = new Map<string, number>();
terms.forEach((t, i) => byName.set(t.term.toLowerCase(), i));

function variantsOf(t: Term) {
  const out = new Set<string>();
  for (const name of [t.term, ...(t.aliases || [])]) {
    out.add(name);
    const m = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (m) {
      out.add(m[1]);
      if (/^[A-Za-z][A-Za-z0-9-]+$/.test(m[2])) out.add(m[2]);
    }
  }
  return [...out].filter(v => v.length >= 2 && /\p{L}/u.test(v) && !/[-_]$/.test(v));
}

const variantMap = new Map<string, { idx: number; v: string; cs: boolean }>();
terms.forEach((t, i) => {
  for (const v of variantsOf(t)) {
    const key = v.toLowerCase();
    if (!variantMap.has(key)) variantMap.set(key, { idx: i, v, cs: CASE_SENSITIVE.has(v) || /[A-Z]/.test(v.slice(1)) });
  }
});
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alternatives = [...variantMap.values()].map(e => e.v).sort((a, b) => b.length - a.length).map(escapeRe);
const termRe = alternatives.length ? new RegExp(`(?<![\\p{L}\\p{N}_])(${alternatives.join("|")})(?:e?s)?(?![\\p{L}\\p{N}_])`, "giu") : null;

export function glossarize(root: HTMLElement | null, inThread: boolean) {
  if (!root || !termRe) return;
  const skip = "pre, code, a, h1, h2, h3, button, textarea, .no-gloss, .g-term, .toc, .katex, .math, .flip, .quiz-q, svg, .say, .say-ctl, .say-out" + (inThread ? "" : ", .thread");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.parentElement && n.parentElement.closest(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const heads = inThread ? [] : [...root.querySelectorAll("h2")];
  let section = 0;
  let seen = new Set<number>();
  for (const node of nodes) {
    while (section < heads.length && heads[section].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
      section++;
      seen = new Set();
    }
    const text = node.nodeValue || "";
    termRe.lastIndex = 0;
    let m: RegExpExecArray | null, last = 0, frag: DocumentFragment | null = null;
    while ((m = termRe.exec(text))) {
      const entry = variantMap.get(m[1].toLowerCase());
      if (!entry || (entry.cs && m[1] !== entry.v)) { termRe.lastIndex = m.index + 1; continue; }
      if (!inThread && seen.has(entry.idx)) continue;
      seen.add(entry.idx);
      frag = frag || document.createDocumentFragment();
      frag.append(text.slice(last, m.index));
      const span = document.createElement("span");
      span.className = "g-term";
      span.tabIndex = 0;
      span.dataset.term = String(entry.idx);
      span.textContent = m[0];
      frag.append(span);
      last = m.index + m[0].length;
    }
    if (frag) { frag.append(text.slice(last)); node.replaceWith(frag); }
  }
}

export function score(t: Term, q: string) {
  const name = t.term.toLowerCase();
  const aliases = (t.aliases || []).map(a => a.toLowerCase());
  if (name === q || aliases.includes(q)) return 0;
  if (name.startsWith(q)) return 1;
  if (aliases.some(a => a.startsWith(q))) return 2;
  if (name.includes(q)) return 3;
  if (aliases.some(a => a.includes(q))) return 4;
  if ((t.category || "").includes(q)) return 5;
  if (t.definition.toLowerCase().includes(q)) return 6;
  return -1;
}
