declare global {
  interface Window {
    hljs?: {
      configure(opts: Record<string, unknown>): void;
      highlightElement(el: HTMLElement): void;
    };
    renderMathInElement?: (el: HTMLElement, opts: Record<string, unknown>) => void;
    webkitSpeechRecognition?: unknown;
    SpeechRecognition?: unknown;
    webkitAudioContext?: typeof AudioContext;
    _utt?: SpeechSynthesisUtterance;
  }
}

export const decode = (s: unknown) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function highlightCode(root: HTMLElement | null) {
  if (!window.hljs || !root) return;
  try {
    window.hljs.configure({ languages: ["python", "rust", "sql", "bash", "json", "plaintext"], ignoreUnescapedHTML: true });
    root.querySelectorAll<HTMLElement>("pre code").forEach(c => {
      if (!c.dataset.hl) { window.hljs!.highlightElement(c); c.dataset.hl = "1"; }
    });
  } catch {}
}

export function renderMath(root: HTMLElement | null) {
  if (!window.renderMathInElement || !root) return;
  try {
    window.renderMathInElement(root, {
      delimiters: [{ left: "\\[", right: "\\]", display: true }, { left: "\\(", right: "\\)", display: false }],
      throwOnError: false,
      ignoredClasses: ["c-add"],
    });
  } catch {}
}

export const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function morph(node: HTMLElement, fromRect: DOMRect | null | undefined, reverse?: boolean): Promise<void> {
  const r = node.getBoundingClientRect();
  if (!fromRect || !r.width || !node.animate) return Promise.resolve();
  const t = `translate(${fromRect.left - r.left}px, ${fromRect.top - r.top}px) scale(${fromRect.width / r.width}, ${fromRect.height / r.height})`;
  node.style.transformOrigin = "top left";
  const frames = reverse ? [{ transform: "none" }, { transform: t, opacity: 0.4 }] : [{ transform: t, opacity: 0.4 }, { transform: "none", opacity: 1 }];
  return node.animate(frames, { duration: 280, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" }).finished.then(() => {}, () => {});
}

export function choiceOrder(n: number, key: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const rand = () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
