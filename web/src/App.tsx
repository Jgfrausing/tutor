import { useCallback, useEffect, useRef, useState } from "react";
import { Ctx, type AppCtx, type LessonApi, type Panel } from "./context";
import { api } from "./lib/api";
import { BOOT, NODE, PAGE, PLATFORM, TOPIC, onServer } from "./lib/boot";
import { levelOf } from "./lib/progress";
import type { Note, Progress, ServerState } from "./types";
import { Header } from "./components/Header";
import { Toast, type ToastState } from "./components/Toast";
import { GlossaryPanel } from "./components/GlossaryPanel";
import { GlossaryPopup } from "./components/GlossaryPopup";
import { NotesPanel } from "./components/NotesPanel";
import { TreePage } from "./components/TreePage";
import { LessonPage } from "./components/LessonPage";
import { CardsPage } from "./components/CardsPage";
import { ReviewPage } from "./components/ReviewPage";

function reloadPage() {
  try { sessionStorage.setItem(PLATFORM.key + "-reload", JSON.stringify({ y: scrollY, path: location.pathname })); } catch {}
  location.reload();
}

export function App() {
  const [progress, setProgress] = useState<Progress>(BOOT.progress);
  const progressRef = useRef<Progress>(BOOT.progress);
  const [notes, setNotes] = useState<Note[]>([]);
  const [online, setOnline] = useState(false);
  const [listening, setListening] = useState(false);
  const [serverJournal, setServerJournal] = useState<string | undefined>(undefined);
  const [serverTick, setServerTick] = useState(0);
  const [serverDown, setServerDown] = useState(false);
  const [updateBanner, setUpdateBanner] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [query, setQuery] = useState("");
  const [gExact, setGExact] = useState(false);
  const [gTick, setGTick] = useState(0);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const hidePopRef = useRef<() => void>(() => {});
  const lesson = useRef<LessonApi | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const knownIds = useRef(new Set<string>());
  const loaded = useRef(false);

  const showToast = useCallback((text: string, onShow?: (() => void) | null, kind?: string) => {
    setToast({ text, onShow, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 12000);
  }, []);

  const postProgress = useCallback(async (body: Record<string, unknown>) => {
    const before = progressRef.current;
    const p = await api<Progress>("/api/progress", body);
    progressRef.current = p;
    setProgress(p);
    if (levelOf(p.xp).level > levelOf(before.xp).level) showToast(`Level up: level ${levelOf(p.xp).level}, ${levelOf(p.xp).rank}.`, null, "xp");
    return { gained: p.xp - before.xp, progress: p };
  }, [showToast]);

  const refresh = useCallback(async () => {
    let state: ServerState;
    try { state = await api<ServerState>("/api/state" + (TOPIC ? "?topic=" + encodeURIComponent(TOPIC) : "")); }
    catch {
      setOnline(false);
      setServerDown(true);
      return;
    }
    const firstLoad = !loaded.current;
    loaded.current = true;
    setOnline(true);
    setServerDown(false);
    setListening(state.listening);
    setNotes(state.notes);
    for (const n of state.notes) {
      if (knownIds.current.has(n.id)) continue;
      if (!firstLoad && n.author === "claude") {
        const api = lesson.current;
        const here = !!api && api.has(n.block);
        const topic = n.topic || n.block.split("/")[0];
        const section = api ? api.sectionOf(n.block) : undefined;
        showToast(`Claude replied in "${NODE[topic] ? NODE[topic].title : topic}"${section ? `, ${section}` : ""}.`,
          here ? () => api!.jumpTo(n.block) : () => { location.href = `/t/${topic}#${n.block.split("/")[1]}`; });
      }
      knownIds.current.add(n.id);
    }
    if (PAGE === "topic") setServerJournal(state.journal);
    setServerTick(t => t + 1);
    if (state.version !== BOOT.version) {
      const typing = [...document.querySelectorAll("textarea")].some(t => t.value.trim()) || document.querySelector(".quiz-q input:checked") || PAGE === "cards";
      if (typing) setUpdateBanner(true); else reloadPage();
    }
  }, [showToast]);

  const openGlossary = useCallback((term: string | null, exact: boolean) => {
    if (term != null) setQuery(term);
    setGExact(exact);
    setGTick(t => t + 1);
    setPanel("glossary");
    hidePopRef.current();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const typing = !!target && !!target.closest("input, textarea");
      const input = inputRef.current;
      if (e.key === "/" && !typing && input) { e.preventDefault(); input.focus(); input.select(); }
      if (e.key === "Escape") {
        hidePopRef.current();
        if (!typing || target === input) setPanel(null);
        if (target === input && input) input.blur();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    try {
      const r = JSON.parse(sessionStorage.getItem(PLATFORM.key + "-reload") || "null");
      if (r && r.path === location.pathname) {
        sessionStorage.removeItem(PLATFORM.key + "-reload");
        scrollTo(0, r.y);
        showToast("Claude updated the curriculum.");
      }
    } catch {}
    if (!onServer) return;
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [refresh, showToast]);

  const ctx: AppCtx = {
    progress, postProgress, notes, listening, online, serverTick, serverJournal, refresh, showToast, openGlossary,
    panel, setPanel, hidePop: () => hidePopRef.current(), lesson,
  };

  return (
    <Ctx.Provider value={ctx}>
      <Header query={query} inputRef={inputRef} onQuery={v => { setQuery(v); openGlossary(null, false); }} onFocusSearch={() => { if (query) openGlossary(null, false); }} />
      {!onServer ? (
        <p className="banner" id="server-banner">This page needs the notes server. Open <a href={`http://127.0.0.1:${PLATFORM.port}/`}>{`http://127.0.0.1:${PLATFORM.port}/`}</a> instead.</p>
      ) : (
        <p className="banner" id="server-banner" hidden={!serverDown}>{"The notes server is not running, so notes and progress cannot be saved. Start it with: " + PLATFORM.serve_cmd}</p>
      )}
      <p className="banner" id="update-banner" hidden={!updateBanner}>Claude changed the text on this page. <button className="btn" type="button" id="reload-now" onClick={reloadPage}>Reload</button></p>
      {PAGE === "tree" ? <TreePage /> : PAGE === "cards" ? <CardsPage /> : PAGE === "review" ? <ReviewPage /> : <LessonPage />}
      <GlossaryPopup hideRef={hidePopRef} />
      <Toast toast={toast} onHide={() => setToast(null)} />
      <GlossaryPanel query={query} exact={gExact} tick={gTick} />
      <NotesPanel />
    </Ctx.Provider>
  );
}
