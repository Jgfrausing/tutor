import { useState, type RefObject } from "react";
import { useApp } from "../context";
import { api } from "../lib/api";
import { XP_PER_LEVEL, onServer } from "../lib/boot";
import { dueCards, levelOf } from "../lib/progress";
import { soundOn, toggleSound } from "../lib/sound";
import { threadOpen } from "../lib/notes";

function LevelChip() {
  const { progress } = useApp();
  const { level, into, rank } = levelOf(progress.xp);
  return (
    <a className="level-chip" href="/" id="level-chip" title={`${rank}. ${XP_PER_LEVEL - into} XP to level ${level + 1}.`}>
      {`Lv ${level}`}<span className="bar"><i style={{ width: `${(into / XP_PER_LEVEL) * 100}%` }} /></span>{`${progress.xp} XP`}
    </a>
  );
}

function SoundToggle() {
  const [on, setOn] = useState(soundOn());
  return <button className="btn" id="sound-toggle" type="button" title="Sound effects for quiz results" onClick={() => { toggleSound(); setOn(soundOn()); }}>{on ? "Sound on" : "Sound off"}</button>;
}

function WakeButton({ hidden }: { hidden: boolean }) {
  const { showToast } = useApp();
  const [busy, setBusy] = useState(false);
  const wake = async () => {
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; detail: string }>("/api/wake", {});
      showToast(r.ok ? "Asked Claude to start listening again." : "Could not wake Claude: " + r.detail);
    } catch { showToast("Could not reach the server."); }
    setTimeout(() => setBusy(false), 60000);
  };
  return <button className="btn" type="button" id="claude-wake" hidden={hidden} disabled={busy} onClick={wake}>{busy ? "Waking..." : "Wake Claude"}</button>;
}

function StatusChip() {
  const { notes, online, listening } = useApp();
  const working = notes.some(n => n.status === "working");
  let state = "offline", label = "Claude offline";
  if (!online) label = onServer ? "Server stopped" : "Not on server";
  else if (working) { state = "working"; label = "Claude answering"; }
  else if (listening) { state = "listening"; label = "Claude listening"; }
  return (
    <>
      <span className="status" id="claude-status" data-state={state}>{label}</span>
      <WakeButton hidden={!(online && onServer && state === "offline")} />
    </>
  );
}

interface Props {
  query: string;
  inputRef: RefObject<HTMLInputElement>;
  onQuery(value: string): void;
  onFocusSearch(): void;
}

export function Header({ query, inputRef, onQuery, onFocusSearch }: Props) {
  const { notes, progress, panel, setPanel, openGlossary } = useApp();
  const waiting = notes.filter(n => !n.parent && threadOpen(notes, n)).length;
  const roots = notes.filter(n => !n.parent).length;
  const due = dueCards(progress).length;
  return (
    <header className="top">
      <div className="top-inner">
        <a className="brand" href="/">Tutor</a>
        <label className="search">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
          <input id="gsearch" ref={inputRef} type="search" placeholder="Search the glossary" autoComplete="off" aria-label="Search the glossary"
            value={query} onChange={e => onQuery(e.target.value)} onFocus={onFocusSearch} />
          <kbd>/</kbd>
        </label>
        <div className="actions">
          <button className="btn" id="open-glossary" type="button" onClick={() => openGlossary(null, false)}>Glossary</button>
          <button className="btn" id="open-notes" type="button" onClick={() => setPanel(panel === "notes" ? null : "notes")}>
            Notes <span id="notes-count" className={waiting ? "count" : ""}>{roots ? `(${roots}${waiting ? `, ${waiting} waiting` : ""})` : ""}</span>
          </button>
          <a className="btn" id="open-cards" href="/cards">Cards <span id="cards-due" className={due ? "count" : ""}>{due ? `(${due} due)` : ""}</span></a>
          <a className="btn" href="/review">Review quiz</a>
          <LevelChip />
          <SoundToggle />
          <StatusChip />
        </div>
      </div>
    </header>
  );
}
