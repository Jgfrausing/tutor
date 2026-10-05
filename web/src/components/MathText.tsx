import { createElement, useLayoutEffect, useRef } from "react";
import { renderMath } from "../lib/dom";

interface Props {
  text: string;
  as?: string;
  className?: string;
  hidden?: boolean;
}

export function MathText({ text, as = "span", className, hidden }: Props) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const e = ref.current;
    if (!e) return;
    e.textContent = text;
    renderMath(e);
  }, [text]);
  return createElement(as, { ref, className, hidden });
}
