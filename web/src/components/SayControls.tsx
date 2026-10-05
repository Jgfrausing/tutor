import { useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { listen, playClip, speak, type ListenResult } from "../lib/speech";

const ICON_PLAY = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>';
const ICON_MIC = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" fill="currentColor"/><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>';

function press(fn: () => void) {
  const go = (e: SyntheticEvent) => { e.preventDefault(); e.stopPropagation(); fn(); };
  return {
    onClick: go,
    onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") go(e); },
    onPointerDown: (e: SyntheticEvent) => e.stopPropagation(),
  };
}

function SayLink({ label, fn }: { label: string; fn: () => void }) {
  return <span className="say-link" role="button" tabIndex={0} {...press(fn)}>{label}</span>;
}

interface Props {
  text: string;
  romaji?: string;
  showRomaji: boolean;
}

export function SayControls({ text, romaji, showRomaji }: Props) {
  const [live, setLive] = useState(false);
  const [out, setOut] = useState<ListenResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const btn = (cls: string, label: string, icon: string, fn: () => void) => (
    <span className={"say-btn " + cls + (cls === "mic" && live ? " live" : "") + (busy === cls ? " busy" : "")} aria-busy={busy === cls} role="button" tabIndex={0} aria-label={label} title={label}
      dangerouslySetInnerHTML={{ __html: icon }} {...press(fn)} />
  );
  const play = () => { setBusy("play"); speak(text, 0.9).then(ok => {
    setBusy(null);
    if (!ok) setOut({ cls: "", note: "No speech output: the server could not run say and this browser has no Japanese voice." });
  }); };
  const slow = () => { setBusy("slow"); speak(text, 0.55).then(() => setBusy(null)); };
  return (
    <>
      <span className="say-ctl no-gloss">
        {showRomaji && romaji ? <span className="romaji">{romaji}</span> : null}
        {btn("play", "Play", ICON_PLAY, play)}
        {btn("slow", "Play slowly", "½", slow)}
        {btn("mic", "Say it", ICON_MIC, () => listen(text, romaji, setLive, setOut))}
      </span>
      <span className={"say-out" + (out && out.cls ? " " + out.cls : "")} hidden={!out}>
        {out && out.note ? out.note : null}
        {out && out.label ? <span>{out.label}</span> : null}
        {out && out.heard ? <span className="heard" lang="ja">{"Heard " + out.heard}</span> : null}
        {out && out.url ? (
          <>
            <SayLink label="Hear yourself" fn={() => { playClip(out.url!); }} />
            <SayLink label="Compare" fn={async () => {
              await speak(text, 0.9);
              await new Promise(res => setTimeout(res, 300));
              playClip(out.url!);
            }} />
          </>
        ) : null}
      </span>
    </>
  );
}

export function SayPhrase({ text }: { text: string }) {
  return (
    <>
      <span className="say say-jp" lang="ja">{text}</span>
      <SayControls text={text} showRomaji={false} />
    </>
  );
}
