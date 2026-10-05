import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../context";
import { BOOT, NODE, NODES, TOPIC, isSide, onServer, xpOf } from "../lib/boot";
import { highlightCode, linkFigures, renderMath } from "../lib/dom";
import { glossarize } from "../lib/glossary";
import { nodeState, passed } from "../lib/progress";
import type { Block, TopicCard } from "../types";
import { CardModal, CardsGrid } from "./CardModal";
import { Journal } from "./Journal";
import { KindChip } from "./KindChip";
import { LessonThreads, type ThreadsApi } from "./LessonThreads";
import { MathText } from "./MathText";
import { Quiz } from "./Quiz";
import { Reader } from "./Reader";
import { SayControls } from "./SayControls";
import { excerptOf } from "./Thread";

interface SayHost {
  host: HTMLElement;
  text: string;
  romaji?: string;
  showRomaji: boolean;
}

function setupBlocks(doc: HTMLElement): Block[] {
  const out: Block[] = [];
  let section = "";
  doc.querySelectorAll<HTMLElement>("h2, h3, p, li, .codewrap, .math, figure, tbody tr").forEach(b => {
    if (b.closest(".toc, .thread") || (b.parentElement && b.parentElement.closest("li, .codewrap, .math, figure"))) return;
    const text = (b.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || !b.dataset.cid) return;
    if (b.tagName === "H2") section = text;
    out.push(registerBlock(b, text, section));
  });
  return out;
}

function registerBlock(el: HTMLElement, text: string, section: string): Block {
  const id = TOPIC + "/" + el.dataset.cid;
  el.dataset.bid = id;
  el.classList.add("c-block");
  return { id, el, text, section };
}

function enhanceSay(root: HTMLElement): SayHost[] {
  const out: SayHost[] = [];
  root.querySelectorAll<HTMLElement>(".say").forEach(s => {
    if (s.dataset.sayReady) return;
    s.dataset.sayReady = "1";
    const tip = [s.dataset.romaji, s.dataset.en].filter(Boolean).join(": ");
    if (tip) s.title = tip;
    const host = document.createElement("span");
    host.className = "say-host";
    s.after(host);
    out.push({ host, text: s.dataset.say || (s.textContent || "").trim(), romaji: s.dataset.romaji, showRomaji: !s.closest(".face") });
  });
  return out;
}

function Paper() {
  const p = NODE[TOPIC].paper;
  if (!p) return null;
  const links = p.url || p.local;
  return (
    <div className="paper-box">
      <p><strong>{p.title}</strong></p>
      <p>{`${p.authors}. ${p.venue}, ${p.year}.`}</p>
      {links ? (
        <p>
          {p.url ? <a href={p.url} target="_blank" rel="noopener">Paper online</a> : null}
          {p.url && p.local ? "  ·  " : null}
          {p.local ? <a href={"/files/" + p.local} target="_blank">Local PDF</a> : null}
        </p>
      ) : null}
    </div>
  );
}

function LessonCards() {
  const list: TopicCard[] = (BOOT.cards[TOPIC] || []).map(c => ({ ...c, topic: TOPIC }));
  const [open, setOpen] = useState<{ start: number; sources: (HTMLButtonElement | null)[] } | null>(null);
  return (
    <>
      <h2 className="section-title" id="cards">Flip cards</h2>
      <p className="lede">Click a card to open it, then click or press space to flip it. Arrow keys move between cards. These cards join your daily review on the Cards page once you complete this lesson.</p>
      <CardsGrid list={list} onOpen={(start, sources) => setOpen({ start, sources })} />
      {open ? <CardModal list={list} start={open.start} sources={open.sources} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

export function LessonPage() {
  const { progress, postProgress, lesson, setPanel } = useApp();
  const n = NODE[TOPIC];
  const docRef = useRef<HTMLElement>(null);
  const journalRef = useRef<HTMLHeadingElement>(null);
  const threadsRef = useRef<ThreadsApi>(null);
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null);
  const [sideEl, setSideEl] = useState<HTMLElement | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [sayHosts, setSayHosts] = useState<SayHost[]>([]);

  const { html, toc } = useMemo(() => {
    const raw = BOOT.fragment || "";
    const tpl = document.createElement("template");
    tpl.innerHTML = raw;
    const h2s = [...tpl.content.querySelectorAll("h2")];
    const toc = h2s.map((h, i) => ({ id: h.id || "s" + (i + 1), label: (h.textContent || "").trim() }));
    const html = "\n" + raw + "\n" + (tpl.content.children.length ? "" : '<p class="empty">This lesson is still being written.</p>');
    return { html, toc };
  }, []);

  const st = nodeState(progress, n);
  const status = st === "completed" ? "Completed" : st === "locked"
    ? (isSide(n) ? "Side quest, opens with " + (n.attached_to || []).map(p => NODE[p].title).join(" or ") : "Locked: " + (n.prereqs || []).filter(p => !passed(progress, p)).map(p => NODE[p].title).join(", ") + " first")
    : `Available, +${xpOf(n.kind)} XP`;
  const kids = NODES.filter(k => (k.prereqs || []).includes(TOPIC) || (k.attached_to || []).includes(TOPIC));

  useLayoutEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    const list = setupBlocks(doc);
    if (journalRef.current) list.push(registerBlock(journalRef.current, "Your notes", "Your notes"));
    doc.querySelectorAll("h2").forEach((h, i) => { if (!h.id) h.id = "s" + (i + 1); });
    renderMath(doc);
    highlightCode(doc);
    linkFigures(doc);
    glossarize(doc, false);
    setSayHosts(enhanceSay(doc));
    setBlocks(list);
  }, []);

  useEffect(() => {
    const map = new Map(blocks.map(b => [b.id, b]));
    const jumpTo = (bid: string) => {
      const b = map.get(bid);
      if (!b) return;
      if (innerWidth < 900) setPanel(null);
      if (threadsRef.current) threadsRef.current.toggle(bid, true);
      b.el.scrollIntoView({ behavior: "smooth", block: "center" });
      b.el.classList.add("flash");
      setTimeout(() => b.el.classList.remove("flash"), 1400);
    };
    lesson.current = {
      has: bid => map.has(bid),
      excerptOf: bid => { const b = map.get(bid); return b ? excerptOf(b) : ""; },
      sectionOf: bid => { const b = map.get(bid); return b ? b.section : undefined; },
      jumpTo,
    };
    if (!blocks.length) return;
    const hashId = location.hash.slice(1);
    if (hashId && map.has(TOPIC + "/" + hashId)) {
      const timer = setTimeout(() => jumpTo(TOPIC + "/" + hashId), 300);
      return () => clearTimeout(timer);
    }
  }, [blocks]);

  useEffect(() => {
    if (onServer && !progress.visited[TOPIC]) postProgress({ kind: "visit", topic: TOPIC }).catch(() => {});
  }, []);

  return (
    <>
      <main id="main" ref={setMainEl}>
        <div className="crumbs"><a href="/">{BOOT.curriculum.title}</a>/<KindChip kind={n.kind} /><span>{status}</span></div>
        <h1><MathText text={n.title} /></h1>
        <MathText as="p" className="lede" text={n.summary} />
        <Paper />
        <ul className="toc">
          {toc.map(t => <li key={t.id}><a href={"#" + t.id}><MathText text={t.label} /></a></li>)}
          {BOOT.cards[TOPIC] ? <li><a href="#cards">Flip cards</a></li> : null}
          {BOOT.quiz ? <li><a href="#quiz">Quiz</a></li> : null}
          {onServer ? <li id="toc-reader" /> : null}
        </ul>
        <article id="doc" ref={docRef} dangerouslySetInnerHTML={{ __html: html }} />
        <div id="extras">
          {BOOT.cards[TOPIC] ? <LessonCards /> : null}
          {BOOT.quiz ? <Quiz questions={BOOT.quiz.questions} review={false} /> : null}
          <Journal headRef={journalRef} />
          {kids.length ? (
            <>
              <h2 className="section-title">Unlocks</h2>
              <div className="next-list">
                {kids.map(k => (
                  <a key={k.id} className="next-card" href={"/t/" + k.id}>
                    <KindChip kind={k.kind} /><MathText className="t" text={k.title} /><MathText className="s" text={k.summary} />
                  </a>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <div id="side" aria-label="Comments and questions" ref={setSideEl} />
      </main>
      <LessonThreads ref={threadsRef} blocks={blocks} sideEl={sideEl} mainEl={mainEl} sideMode={false} />
      {sayHosts.map((s, i) => createPortal(<SayControls text={s.text} romaji={s.romaji} showRomaji={s.showRomaji} />, s.host, "say" + i))}
      {onServer ? <Reader docRef={docRef} /> : null}
    </>
  );
}
