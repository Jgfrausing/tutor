import { esc } from "./dom";

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*(?=\S)[^*\n]+?(?<=\S)\*|!\[[^\]]*\]\((?:https?:\/\/|\/files\/)[^)\s]*\)|\[[^\]]+\]\((?:https?:\/\/|\/)[^)\s]*\))/g;

function inline(s: string) {
  return s.split(INLINE).map((part, i) => {
    if (!(i % 2)) return esc(part);
    if (part.startsWith("![")) {
      const m = part.match(/^!\[([^\]]*)\]\((.+)\)$/)!;
      return `<img src="${esc(m[2])}" alt="${esc(m[1])}" loading="lazy">`;
    }
    if (part.startsWith("`")) return `<code>${esc(part.slice(1, -1))}</code>`;
    if (part.startsWith("**")) return `<strong>${esc(part.slice(2, -2))}</strong>`;
    if (part.startsWith("*")) return `<em>${esc(part.slice(1, -1))}</em>`;
    const m = part.match(/^\[([^\]]+)\]\((.+)\)$/)!;
    return `<a href="${esc(m[2])}"${m[2].startsWith("/") ? "" : ' target="_blank"'} rel="noopener">${esc(m[1])}</a>`;
  }).join("");
}

export function mdToHtml(text: string) {
  let out = "";
  text.split(/```[^\n]*\n([\s\S]*?)```/g).forEach((part, i) => {
    if (i % 2) { out += `<pre><code>${esc(part.replace(/\n$/, ""))}</code></pre>`; return; }
    for (const para of part.split(/\n\s*\n/)) {
      if (!para.trim()) continue;
      const lines = para.trim().split("\n");
      if (lines.every(l => /^\s*[-*] /.test(l))) out += `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`;
      else if (lines.every(l => /^\s*\d+\. /.test(l))) out += `<ol>${lines.map(l => `<li>${inline(l.replace(/^\s*\d+\. /, ""))}</li>`).join("")}</ol>`;
      else out += `<p>${lines.map(inline).join("<br>")}</p>`;
    }
  });
  return out;
}
