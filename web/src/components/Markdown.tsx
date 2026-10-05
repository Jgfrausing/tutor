import { useLayoutEffect, useMemo, useRef } from "react";
import { highlightCode, renderMath } from "../lib/dom";
import { glossarize } from "../lib/glossary";
import { mdToHtml } from "../lib/markdown";

export function Markdown({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => mdToHtml(text), [text]);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.innerHTML = html;
    renderMath(box);
    highlightCode(box);
    glossarize(box, true);
  }, [html]);
  return <div className="md" ref={ref} />;
}
