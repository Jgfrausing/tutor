import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { NODE, NODES, colorOf, isSide, kindOf, xpOf } from "../lib/boot";
import { nodeState, passed } from "../lib/progress";
import type { CNode, Progress } from "../types";

const W = 165, H = 100, NW = 152, NH = 58, STAGGER = NH + 16, MAX_FLAT = 6;
const parents = (n: CNode) => isSide(n) ? (n.attached_to || []) : (n.prereqs || []);

function layout() {
  const depth: Record<string, number> = {};
  const depthOf = (n: CNode): number => {
    if (depth[n.id] != null) return depth[n.id];
    const ps = parents(n).map(p => NODE[p]).filter(Boolean);
    depth[n.id] = ps.length ? Math.max(...ps.map(depthOf)) + 1 : 0;
    return depth[n.id];
  };
  NODES.forEach(depthOf);
  const up: Record<string, string[]> = {}, down: Record<string, string[]> = {};
  const link = (a: string, b: string) => { (down[a] = down[a] || []).push(b); (up[b] = up[b] || []).push(a); };
  const via: Record<string, string[]> = {};
  const layers: string[][] = [];
  const addTo = (d: number, id: string) => { (layers[d] = layers[d] || []).push(id); };
  NODES.forEach(n => addTo(depth[n.id], n.id));
  NODES.forEach(n => parents(n).filter(p => NODE[p]).forEach(p => {
    let prev = p;
    const hops: string[] = [];
    for (let d = depth[p] + 1; d < depth[n.id]; d++) {
      const id = `${p}>${n.id}@${d}`;
      depth[id] = d;
      addTo(d, id);
      link(prev, id);
      hops.push(id);
      prev = id;
    }
    link(prev, n.id);
    via[p + ">" + n.id] = hops;
  }));
  const isReal = (id: string) => !!NODE[id];
  const pos: Record<string, number> = {};
  const count = (layer: string[]) => layer.filter(isReal).length + layer.filter(id => !isReal(id)).length * 0.2;
  const spacing = (layer: string[]) => count(layer) > MAX_FLAT ? Math.max((NW + 12) / 2, W * (MAX_FLAT - 1) / (count(layer) - 1)) : W;
  const place = (layer: string[]) => {
    const step = spacing(layer);
    const widths = layer.map(id => isReal(id) ? step : step * 0.2);
    const total = widths.reduce((a, b) => a + b, 0) - (widths[0] + widths[widths.length - 1]) / 2;
    let x = -total / 2;
    layer.forEach((id, i) => { if (i) x += (widths[i - 1] + widths[i]) / 2; pos[id] = x; });
  };
  layers.forEach(place);
  const avgOf = (ids: string[], fallback: number) => {
    const xs = ids.filter(i => pos[i] != null).map(i => pos[i]);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback;
  };
  for (let pass = 0; pass < 16; pass++) {
    const goingDown = pass % 2 === 0;
    const order = goingDown ? layers : [...layers].reverse();
    for (const layer of order) {
      const key = (id: string) => goingDown ? avgOf(up[id] || [], pos[id]) : avgOf(down[id] || [], pos[id]);
      layer.sort((a, b) => key(a) - key(b));
      place(layer);
    }
  }
  for (const layer of layers) {
    layer.sort((a, b) => avgOf(up[a] || [], pos[a]) - avgOf(up[b] || [], pos[b]));
    place(layer);
  }
  const rowY: number[] = [];
  let yAcc = 24;
  layers.forEach((layer, d) => { rowY[d] = yAcc; yAcc += H + (layer.filter(isReal).length > MAX_FLAT ? STAGGER : 0); });
  const staggerOf: Record<string, number> = {};
  layers.forEach(layer => layer.filter(isReal).forEach((id, i, real) => { staggerOf[id] = real.length > MAX_FLAT && i % 2 ? STAGGER : 0; }));
  const span = Math.max(...Object.values(pos).map(Math.abs));
  const width = 2 * span + NW + 40, height = yAcc + 10;
  const at = (id: string) => ({ x: width / 2 + pos[id], y: rowY[depth[id]] + (staggerOf[id] || 0) });
  const xy = (n: CNode) => at(n.id);
  const route = (p: string, n: string) => {
    const a = at(p);
    let d = `M${a.x},${a.y + NH}`;
    let px = a.x, py = a.y + NH;
    for (const id of [...(via[p + ">" + n] || []), n]) {
      const q = at(id);
      d += ` C${px},${py + 30} ${q.x},${q.y - 30} ${q.x},${q.y}`;
      if (isReal(id)) break;
      d += ` L${q.x},${q.y + NH}`;
      px = q.x; py = q.y + NH;
    }
    return d;
  };
  return { width, height, xy, route };
}

function ancestorsOf(id: string) {
  const out = new Set([id]);
  const walk = (x: string) => parents(NODE[x]).forEach(q => { if (NODE[q] && !out.has(q)) { out.add(q); walk(q); } });
  walk(id);
  return out;
}

function wrapTitle(title: string) {
  const lines: string[] = [];
  let line = "";
  for (const w of title.split(" ")) {
    if ((line + " " + w).trim().length > 21 && line) { lines.push(line); line = w; } else line = (line + " " + w).trim();
  }
  lines.push(line);
  return lines;
}

export function SkillTree({ progress }: { progress: Progress }) {
  const box = useRef<HTMLDivElement>(null);
  const { width, height, xy, route } = useMemo(layout, []);
  const [lit, setLit] = useState<Set<string> | null>(null);

  useLayoutEffect(() => {
    const b = box.current;
    const first = NODES.find(n => nodeState(progress, n) === "available");
    if (b && first && b.scrollWidth > b.clientWidth) b.scrollLeft = xy(first).x - b.clientWidth / 2;
  }, []);

  const go = (n: CNode) => { location.href = "/t/" + n.id; };
  return (
    <div className="tree-wrap" ref={box}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Skill tree" style={{ width: `${width}px`, maxWidth: "none", height: "auto" }}>
        {NODES.flatMap(n => parents(n).filter(p => NODE[p]).map(p => {
          const hit = !!lit && lit.has(n.id) && lit.has(p);
          return (
            <path key={p + ">" + n.id} d={route(p, n.id)}
              className={"edge" + (hit ? " lit" : lit ? " dim" : "")} data-from={p} data-to={n.id}
              stroke={passed(progress, p) ? colorOf(NODE[p].kind) : "var(--border)"} strokeDasharray={isSide(n) ? "5 4" : ""} />
          );
        }))}
        {NODES.map(n => {
          const { x, y } = xy(n);
          const st = nodeState(progress, n);
          const color = colorOf(n.kind);
          const shape = kindOf(n.kind).shape || (isSide(n) ? "hex" : "rounded");
          const fill = st === "completed" ? `color-mix(in srgb, ${color} 30%, var(--surface))` : "var(--surface)";
          const tip = `${n.title}\n${n.summary}\n${st === "locked" ? (isSide(n) ? "Side quest, opens with " + (n.attached_to || []).map(p => NODE[p].title).join(" or ") : "Locked: finish " + (n.prereqs || []).filter(p => !passed(progress, p)).map(p => NODE[p].title).join(", ")) : st === "completed" ? "Completed" : "Available, +" + xpOf(n.kind) + " XP"}`;
          const lines = wrapTitle(n.title);
          const c = 12;
          return (
            <g key={n.id} className={`node ${st}`} tabIndex={0} role="link" transform={`translate(${x - NW / 2},${y})`}
              onClick={() => go(n)} onKeyDown={e => { if (e.key === "Enter") go(n); }}
              onMouseEnter={() => setLit(ancestorsOf(n.id))} onMouseLeave={() => setLit(null)}
              onFocus={() => setLit(ancestorsOf(n.id))} onBlur={() => setLit(null)}>
              <title>{tip}</title>
              {shape === "hex"
                ? <polygon points={`${c},0 ${NW - c},0 ${NW},${NH / 2} ${NW - c},${NH} ${c},${NH} 0,${NH / 2}`} fill="var(--surface)" stroke="none" />
                : <rect width={NW} height={NH} rx={shape === "sharp" ? 4 : 12} fill="var(--surface)" stroke="none" />}
              <g opacity={st === "locked" ? "0.7" : "1"}>
              {shape === "hex"
                ? <polygon points={`${c},0 ${NW - c},0 ${NW},${NH / 2} ${NW - c},${NH} ${c},${NH} 0,${NH / 2}`} fill={fill} stroke={color} strokeDasharray={st === "completed" ? "" : "4 3"} />
                : <rect width={NW} height={NH} rx={shape === "sharp" ? 4 : 12} fill={fill} stroke={color} strokeWidth={kindOf(n.kind).emphasis ? 3 : 2} />}
              {lines.slice(0, 2).map((l, i) => (
                <text key={i} x={NW / 2} y={(lines.length > 1 ? 19 : 25) + i * 14} textAnchor="middle" fontWeight="600">{i === 1 && lines.length > 2 ? l + "..." : l}</text>
              ))}
              <text x={NW / 2} y={NH - 8} textAnchor="middle" className="sub">{(st === "completed" ? "Done  " : st === "locked" ? "Locked  " : "") + `${xpOf(n.kind)} XP`}</text>
              </g>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
