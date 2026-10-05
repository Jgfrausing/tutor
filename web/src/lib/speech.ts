import { onServer } from "./boot";

interface RecognitionAlt { transcript: string }
interface RecognitionEvent { results: Iterable<Iterable<RecognitionAlt>> }
interface Recognizer {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognizer;

export const Recognition = (window.SpeechRecognition || window.webkitSpeechRecognition) as RecognitionCtor | undefined;

let jaVoice: SpeechSynthesisVoice | null = null;
function pickVoice() {
  if (!window.speechSynthesis) return;
  const vs = speechSynthesis.getVoices().filter(v => /^ja/i.test(v.lang));
  jaVoice = vs.find(v => /premium|enhanced|o-ren|kyoko/i.test(v.name)) || vs.find(v => v.localService) || vs[0] || null;
}
if (window.speechSynthesis) { pickVoice(); speechSynthesis.addEventListener("voiceschanged", pickVoice); }

let currentAudio: HTMLAudioElement | null = null;

function speakBrowser(text: string, rate: number): Promise<boolean> {
  return new Promise(res => {
    if (!window.speechSynthesis) return res(false);
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    if (jaVoice) u.voice = jaVoice;
    u.rate = rate;
    u.onend = u.onerror = () => res(true);
    window._utt = u;
    setTimeout(() => speechSynthesis.speak(u), 60);
  });
}

export function speak(text: string, rate: number): Promise<boolean> {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if (!onServer) return speakBrowser(text, rate);
  return new Promise(res => {
    const a = new Audio("/api/tts?" + new URLSearchParams({ text, slow: rate < 0.8 ? "1" : "0" }));
    currentAudio = a;
    a.onended = () => res(true);
    a.onerror = () => { speakBrowser(text, rate).then(res); };
    a.play().catch(() => speakBrowser(text, rate).then(res));
  });
}

const toHira = (s: string) => s.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const normJa = (s: string) => toHira(String(s).normalize("NFKC").toLowerCase()).replace(/[\s\p{P}\p{S}ー〜~]/gu, "");

function similarity(x: string, y: string) {
  const a = [...normJa(x)], b = [...normJa(y)];
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

const KANA = "あa,いi,うu,えe,おo,かka,きki,くku,けke,こko,がga,ぎgi,ぐgu,げge,ごgo,さsa,しshi,すsu,せse,そso,ざza,じji,ずzu,ぜze,ぞzo,たta,ちchi,つtsu,てte,とto,だda,ぢji,づzu,でde,どdo,なna,にni,ぬnu,ねne,のno,はha,ひhi,ふfu,へhe,ほho,ばba,びbi,ぶbu,べbe,ぼbo,ぱpa,ぴpi,ぷpu,ぺpe,ぽpo,まma,みmi,むmu,めme,もmo,やya,ゆyu,よyo,らra,りri,るru,れre,ろro,わwa,をo,んn,ぁa,ぃi,ぅu,ぇe,ぉo,ゔvu";
const KANA_MAP: Record<string, string> = Object.fromEntries(KANA.split(",").map(p => [p[0], p.slice(1)]));

function kanaToRomaji(input: string) {
  const s = normJa(input);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i], nx = s[i + 1];
    if (ch === "っ") { const r = KANA_MAP[nx]; if (r) out += r[0] === "c" ? "t" : r[0]; continue; }
    if (nx && "ゃゅょ".includes(nx) && KANA_MAP[ch]) {
      const base = KANA_MAP[ch], y = ({ "ゃ": "a", "ゅ": "u", "ょ": "o" } as Record<string, string>)[nx];
      out += /^(shi|chi|ji)$/.test(base) ? base.slice(0, -1) + y : base.slice(0, -1) + "y" + y;
      i++; continue;
    }
    out += KANA_MAP[ch] != null ? KANA_MAP[ch] : ch;
  }
  return out;
}

const normRomaji = (s: string) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "").replace(/ou/g, "o").replace(/([aeiou])\1/g, "$1").replace(/m(?=[bmp])/g, "n");
const matchScore = (heard: string, target: string, romaji?: string) => Math.max(similarity(heard, target), romaji && !/[一-鿿]/.test(heard) ? similarity(normRomaji(kanaToRomaji(heard)), normRomaji(romaji)) : 0);

async function startRecorder() {
  if (!navigator.mediaDevices || !window.MediaRecorder) return null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream), chunks: Blob[] = [];
    rec.ondataavailable = e => chunks.push(e.data);
    const done = new Promise<Blob>(res => { rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); res(new Blob(chunks, { type: rec.mimeType })); }; });
    rec.start();
    return { stop: () => { if (rec.state !== "inactive") rec.stop(); return done; } };
  } catch { return null; }
}

export interface ListenResult {
  cls: string;
  label?: string;
  heard?: string;
  url?: string;
  note?: string;
}

let activeListen: (() => void) | null = null;

export function listen(target: string, romaji: string | undefined, setLive: (on: boolean) => void, setOut: (r: ListenResult) => void) {
  if (activeListen) { activeListen(); return; }
  setLive(true);
  setOut({ cls: "", note: "Listening, say it now" });
  let recorder: { stop: () => Promise<Blob> } | null = null, recognizer: Recognizer | null = null, finished = false;
  const heard: string[] = [];
  const finish = async () => {
    if (finished) return;
    finished = true;
    activeListen = null;
    setLive(false);
    try { if (recognizer) recognizer.stop(); } catch {}
    const blob = recorder ? await recorder.stop() : null;
    const out: ListenResult = { cls: "" };
    if (heard.length) {
      const best = heard.map(h => ({ h, s: matchScore(h, target, romaji) })).sort((x, y) => y.s - x.s)[0];
      const pct = Math.round(best.s * 100);
      out.cls = pct >= 85 ? "good" : pct >= 60 ? "close" : "off";
      out.label = `${pct >= 85 ? "Good" : pct >= 60 ? "Close" : "Try again"}: ${pct}%`;
      out.heard = best.h;
    } else if (Recognition) {
      out.cls = "off";
      out.label = "Did not catch that";
    }
    if (blob && blob.size) out.url = URL.createObjectURL(blob);
    if (!out.label && !out.url) out.note = "This browser cannot use the microphone here. Try Chrome or Safari.";
    setOut(out);
  };
  activeListen = finish;
  startRecorder().then(r => {
    recorder = r;
    if (finished && r) r.stop();
    if (!Recognition) setTimeout(finish, 4000);
  });
  if (Recognition) {
    try {
      recognizer = new Recognition();
      recognizer.lang = "ja-JP";
      recognizer.interimResults = false;
      recognizer.maxAlternatives = 5;
      recognizer.onresult = e => { for (const r of e.results) for (const alt of r) heard.push(alt.transcript); };
      recognizer.onerror = () => {};
      recognizer.onend = () => { setTimeout(finish, 150); };
      recognizer.start();
    } catch { setTimeout(finish, 4000); }
  }
  setTimeout(finish, 9000);
}

export function playClip(url: string): Promise<void> {
  return new Promise(res => {
    const a = new Audio(url);
    a.onended = () => res();
    a.onerror = () => res();
    a.play().catch(() => res());
  });
}
