import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

interface Seg {
  lang: "en" | "ja";
  text: string;
  node?: HTMLElement;
}

interface Item {
  block: HTMLElement;
  segs: Seg[];
}

function readerSegments(doc: HTMLElement): Item[] {
  const skip = ".say-ctl, .say-out, .c-add, button, .thread, .katex-mathml, figure img, script, style";
  const leaves = [...doc.querySelectorAll<HTMLElement>(".c-block")].filter(b => !b.closest(".thread") && !b.querySelector(".c-block"));
  const head = [document.querySelector<HTMLElement>("main h1"), document.querySelector<HTMLElement>("main .lede")].filter((x): x is HTMLElement => !!x);
  const out: Item[] = [];
  for (const block of [...head, ...leaves]) {
    const segs: Seg[] = [];
    const push = (lang: "en" | "ja", raw: string, node?: HTMLElement) => {
      const text = raw.replace(/\s+/g, " ");
      const last = segs[segs.length - 1];
      if (lang === "en" && last && last.lang === "en") last.text += text;
      else if (text.trim()) segs.push({ lang, text, node });
    };
    const walk = (n: Node) => {
      if (n.nodeType === 3) return push("en", n.textContent || "");
      if (!(n instanceof Element) || n.matches(skip)) return;
      if (n instanceof HTMLElement && n.matches(".say")) return push("ja", n.dataset.say || (n.textContent || "").trim(), n);
      const blockish = /^(TD|TH|LI|P|DIV|H2|H3|FIGCAPTION)$/.test(n.tagName);
      [...n.childNodes].forEach(walk);
      if (blockish) push("en", ". ");
    };
    walk(block);
    segs.forEach(sg => { if (sg.lang === "en") sg.text = sg.text.replace(/(\s*\.\s*){2,}/g, ". ").replace(/^[\s.,;:]+/, "").trim(); });
    const kept = segs.filter(sg => sg.lang === "ja" || /[\p{L}\p{N}]/u.test(sg.text));
    if (kept.length) out.push({ block, segs: kept });
  }
  return out;
}

const urlOf = (sg: Seg) => "/api/tts?" + new URLSearchParams({ text: sg.text, lang: sg.lang, slow: "0" });

export function Reader({ docRef }: { docRef: RefObject<HTMLElement> }) {
  const [running, setRunning] = useState(false);
  const [pauseLabel, setPauseLabel] = useState("Pause");
  const [pos, setPos] = useState("");
  const st = useRef({ items: [] as Item[], bi: 0, si: 0, playing: false, audio: null as HTMLAudioElement | null, token: 0, cache: new Map<string, HTMLAudioElement>() });

  const fetchSeg = (sg: Seg) => {
    const s = st.current, u = urlOf(sg);
    if (!s.cache.has(u)) { const a = new Audio(u); a.preload = "auto"; s.cache.set(u, a); }
    return s.cache.get(u)!;
  };
  const clearMarks = () => document.querySelectorAll(".reading, .reading-ja").forEach(n => n.classList.remove("reading", "reading-ja"));
  const mark = () => {
    const s = st.current;
    clearMarks();
    const it = s.items[s.bi];
    if (!it) return;
    it.block.classList.add("reading");
    const sg = it.segs[s.si];
    if (sg && sg.node) sg.node.classList.add("reading-ja");
    setPos(`${s.bi + 1} / ${s.items.length}`);
  };
  const prefetch = () => {
    const s = st.current;
    let b = s.bi, s2 = s.si;
    for (let k = 0; k < 3; k++) {
      s2++;
      if (!s.items[b] || s2 >= s.items[b].segs.length) { b++; s2 = 0; }
      if (!s.items[b]) return;
      fetchSeg(s.items[b].segs[s2]);
    }
  };
  const end = () => {
    const s = st.current;
    s.token++; s.playing = false;
    if (s.audio) s.audio.pause();
    s.audio = null; s.cache.clear();
    clearMarks();
    setRunning(false);
  };
  const advance = () => {
    const s = st.current;
    s.si++;
    if (s.si >= s.items[s.bi].segs.length) { s.bi++; s.si = 0; }
    if (s.bi >= s.items.length) return end();
    if (s.playing) setTimeout(() => { if (s.playing) playCurrent(); }, s.si === 0 ? 350 : 120);
  };
  const playCurrent = () => {
    const s = st.current;
    const my = ++s.token;
    const it = s.items[s.bi];
    if (!it) return end();
    const sg = it.segs[s.si];
    mark();
    if (s.si === 0) it.block.scrollIntoView({ behavior: "smooth", block: "center" });
    if (s.audio) s.audio.pause();
    const audio = s.audio = fetchSeg(sg);
    audio.currentTime = 0;
    audio.onended = () => { if (my !== s.token) return; s.cache.delete(urlOf(sg)); advance(); };
    audio.onerror = () => { if (my !== s.token) return; advance(); };
    audio.play().catch(() => { if (my === s.token) { s.playing = false; setPauseLabel("Resume"); } });
    prefetch();
  };
  const begin = () => {
    const s = st.current;
    if (!docRef.current) return;
    s.items = readerSegments(docRef.current);
    if (!s.items.length) return;
    const top = s.items.findIndex(it => it.block.getBoundingClientRect().bottom > 80);
    s.bi = window.scrollY < 200 || top < 0 ? 0 : top;
    s.si = 0; s.playing = true;
    setRunning(true);
    setPauseLabel("Pause");
    playCurrent();
  };
  const toggle = () => {
    const s = st.current;
    if (!s.audio) return;
    if (s.playing) { s.playing = false; s.audio.pause(); setPauseLabel("Resume"); }
    else { s.playing = true; setPauseLabel("Pause"); s.audio.play().catch(() => playCurrent()); }
  };
  const jump = (i: number) => {
    const s = st.current;
    if (i < 0 || i >= s.items.length) return;
    s.bi = i; s.si = 0; s.playing = true;
    setPauseLabel("Pause");
    playCurrent();
  };

  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") end(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [running]);

  const btn = (label: string, title: string, fn: () => void, cls: string, hidden: boolean) => (
    <button type="button" title={title} aria-label={title} className={cls} onClick={fn} hidden={hidden}>{label}</button>
  );
  const [tocHost, setTocHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setTocHost(document.getElementById("toc-reader")); }, []);
  if (tocHost && !running) {
    return createPortal(<button type="button" className="toc-read" title="Read this page aloud, from the block at the top of the screen" onClick={begin}>Read aloud</button>, tocHost);
  }
  return (
    <div id="reader">
      {btn("Read aloud", "Read this page aloud, from the block at the top of the screen", begin, "main", running)}
      {btn("‹", "Previous block", () => jump(st.current.bi - 1), "rd-ctl", !running)}
      {btn(pauseLabel, "Pause or resume", toggle, "main rd-ctl", !running)}
      {btn("›", "Next block", () => jump(st.current.bi + 1), "rd-ctl", !running)}
      {btn("Stop", "Stop reading", end, "rd-ctl", !running)}
      <span className="rd-pos" hidden={!running}>{pos}</span>
    </div>
  );
}
