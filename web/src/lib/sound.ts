const SOUND_KEY = "tutor-sound";

export const soundOn = () => { try { return localStorage.getItem(SOUND_KEY) !== "off"; } catch { return true; } };
export const toggleSound = () => { try { localStorage.setItem(SOUND_KEY, soundOn() ? "off" : "on"); } catch {} };

let audioCtx: AudioContext | null = null;

interface ToneOpts { type?: OscillatorType; gain?: number; vibrato?: number; slideTo?: number | null }

function tone(ctx: AudioContext, t: number, freq: number, dur: number, opts: ToneOpts = {}) {
  const { type = "sawtooth", gain = 0.12, vibrato = 0, slideTo = null } = opts;
  const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  f.type = "lowpass";
  f.frequency.value = 2400;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.03);
  g.gain.setValueAtTime(gain, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  if (vibrato) {
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = 6;
    depth.gain.value = vibrato;
    lfo.connect(depth).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur);
  }
  o.connect(f).connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export function playSound(kind: "fanfare" | "wah") {
  if (!soundOn()) return;
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    const ctx = audioCtx = audioCtx || new Ctor();
    const t = ctx.currentTime + 0.05;
    if (kind === "fanfare") {
      ([[523.25, 0, 0.13], [523.25, 0.15, 0.13], [523.25, 0.3, 0.13], [659.25, 0.45, 0.32], [587.33, 0.8, 0.13], [659.25, 0.95, 0.13], [783.99, 1.1, 0.7]] as const)
        .forEach(([f, d, l]) => { tone(ctx, t + d, f, l); tone(ctx, t + d, f / 2, l, { type: "square", gain: 0.035 }); });
    } else {
      ([[392, 0, 0.36], [369.99, 0.42, 0.36], [349.23, 0.84, 0.36], [329.63, 1.26, 1.2]] as const)
        .forEach(([f, d, l], i) => tone(ctx, t + d, f, l, { gain: 0.13, vibrato: i === 3 ? 8 : 0, slideTo: i === 3 ? 300 : null }));
    }
  } catch {}
}

export function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  canvas.className = "confetti";
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) { canvas.remove(); return; }
  const dpr = devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const colors = ["--accent", "--accent-2", "--ok", "--gold", "--danger", "--lab"].map(v => css.getPropertyValue(v).trim() || "#7aa2f7");
  const parts = Array.from({ length: 200 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.3, y: innerHeight * 0.4,
    vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 15 - 5,
    w: Math.random() * 7 + 5, a: Math.random() * 6.28, va: (Math.random() - 0.5) * 0.35,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  const frame = (now: number) => {
    const t = now - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = Math.max(0, 1 - t / 3500);
    for (const p of parts) {
      p.vy += 0.33;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.a += p.va;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2);
      ctx.restore();
    }
    if (t < 3500) requestAnimationFrame(frame); else canvas.remove();
  };
  requestAnimationFrame(frame);
}
