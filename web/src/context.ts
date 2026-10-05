import { createContext, useContext, type MutableRefObject } from "react";
import type { Note, Progress } from "./types";

export type Panel = "glossary" | "notes" | null;

export interface LessonApi {
  has(bid: string): boolean;
  excerptOf(bid: string): string;
  sectionOf(bid: string): string | undefined;
  jumpTo(bid: string): void;
}

export interface ProgressResult {
  gained: number;
  progress: Progress;
}

export interface AppCtx {
  progress: Progress;
  postProgress(body: Record<string, unknown>): Promise<ProgressResult>;
  notes: Note[];
  listening: boolean;
  online: boolean;
  serverTick: number;
  serverJournal: string | undefined;
  refresh(): Promise<void>;
  showToast(text: string, onShow?: (() => void) | null, kind?: string): void;
  openGlossary(term: string | null, exact: boolean): void;
  panel: Panel;
  setPanel(p: Panel): void;
  hidePop(): void;
  lesson: MutableRefObject<LessonApi | null>;
}

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("no app context");
  return c;
}

export const drafts = new Map<string, string>();
