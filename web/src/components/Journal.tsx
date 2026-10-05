import { useEffect, useRef, useState, type RefObject } from "react";
import { useApp } from "../context";
import { api, errMsg } from "../lib/api";
import { BOOT, CFG, NODE, PLATFORM, TOPIC } from "../lib/boot";

export function Journal({ headRef }: { headRef: RefObject<HTMLHeadingElement> }) {
  const { serverJournal, serverTick, refresh, showToast } = useApp();
  const [value, setValue] = useState(BOOT.journal || "");
  const [status, setStatus] = useState("");
  const [asking, setAsking] = useState(false);
  const saved = useRef(BOOT.journal || "");
  const valueRef = useRef(value);
  const timer = useRef<number | undefined>(undefined);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = `${PLATFORM.state}/journal/${TOPIC}.md`;

  const save = async () => {
    const text = valueRef.current;
    try { await api("/api/journal", { topic: TOPIC, text }); saved.current = text; setStatus("Saved"); }
    catch (err) { setStatus("Not saved: " + errMsg(err)); }
  };

  useEffect(() => {
    if (serverJournal == null || serverJournal === saved.current) return;
    if (valueRef.current === saved.current && document.activeElement !== area.current) {
      valueRef.current = serverJournal;
      setValue(serverJournal);
      saved.current = serverJournal;
      setStatus("Updated by Claude");
    } else {
      setStatus("Claude changed this file on disk. Your unsaved edits will overwrite it.");
    }
  }, [serverJournal, serverTick]);

  const ask = async () => {
    setAsking(true);
    try {
      await api("/api/notes", {
        block: TOPIC + "/journal", topic: TOPIC, type: "request", section: "Your notes", excerpt: "Your notes", context: `Journal file ${file}`,
        text: (CFG.journal_prompt || "Write study notes for this lesson into my notes file ({journal}). Keep what I already wrote.").replaceAll("{journal}", file).replaceAll("{title}", NODE[TOPIC].title),
      });
      await refresh();
      showToast("Asked Claude for study notes. They will appear in the box below.");
    } catch (err) { alert("Could not send: " + errMsg(err)); }
    setAsking(false);
  };

  return (
    <section id="your-notes">
      <h2 className="section-title" data-cid="journal" ref={headRef}>Your notes</h2>
      <p className="lede">Markdown, saved on disk at <code>{file}</code>. Your question threads are also exported to <code>{`${PLATFORM.state}/notes/${TOPIC}.md`}</code>.</p>
      <textarea id="journal" ref={area} placeholder={`Your own notes for this lesson. They save to ${file} as you type.`}
        style={{ minHeight: "12rem", fontFamily: "ui-monospace, Menlo, monospace", fontSize: "0.88rem" }}
        value={value} onChange={e => {
          valueRef.current = e.target.value;
          setValue(e.target.value);
          setStatus("Unsaved");
          clearTimeout(timer.current);
          timer.current = window.setTimeout(save, 700);
        }} />
      <div className="form-row">
        <button className="btn" type="button" disabled={asking} onClick={ask}>Ask Claude to write study notes</button>
        <span className="hint">{status}</span>
      </div>
    </section>
  );
}
