import type { CSSProperties } from "react";
import { colorOf, kindOf } from "../lib/boot";

export function KindChip({ kind }: { kind: string }) {
  return <span className="kind" style={{ "--kind-color": colorOf(kind) } as CSSProperties}>{kindOf(kind).label}</span>;
}
