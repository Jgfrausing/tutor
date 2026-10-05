export interface Kind {
  label: string;
  xp?: number;
  color?: string;
  shape?: string;
  emphasis?: boolean;
  legend?: boolean;
  side_quest?: boolean;
}

export interface Paper {
  authors?: string;
  year?: string | number;
  venue?: string;
  title?: string;
  url?: string;
  local?: string;
}

export interface CNode {
  id: string;
  title: string;
  kind: string;
  prereqs?: string[];
  attached_to?: string[];
  summary: string;
  paper?: Paper;
}

export interface BadgeRule {
  type: string;
  node?: string;
  nodes?: string[];
  kind?: string;
  n?: number;
}

export interface BadgeDef {
  name: string;
  desc: string;
  rule?: BadgeRule;
}

export interface Config {
  lede?: string;
  pass_mark?: number;
  xp_per_level?: number;
  kinds?: Record<string, Kind>;
  ranks?: string[];
  badges?: BadgeDef[];
  glossary_files?: string[];
  case_sensitive_terms?: string[];
  journal_prompt?: string;
}

export interface Curriculum {
  title: string;
  config?: Config;
  nodes: CNode[];
}

export interface Term {
  term: string;
  aliases?: string[];
  category: string;
  definition: string;
  see_also?: string[];
  topic?: string;
}

export interface Card {
  id: string;
  front: string;
  back: string;
  say?: string;
}

export interface TopicCard extends Card {
  topic: string;
}

export interface Question {
  q: string;
  choices: string[];
  answer: number;
  explain?: string;
  topic?: string;
}

export interface Quiz {
  questions: Question[];
}

export interface QuizProgress {
  best: number;
  total: number;
  attempts: number;
  passed: boolean;
  last?: string;
  passed_at?: string;
  answers?: (number | null)[];
  checked?: boolean;
}

export interface CardProgress {
  box: number;
  due: string;
  reviews?: number;
}

export interface ProgressEvent {
  at: string;
  kind: string;
  topic?: string | null;
  card?: string | null;
  xp: number;
}

export interface Progress {
  xp: number;
  visited: Record<string, string>;
  quiz: Record<string, QuizProgress>;
  cards: Record<string, CardProgress>;
  events: ProgressEvent[];
}

export interface Platform {
  root: string;
  state: string;
  port: number;
  key: string;
  serve_cmd: string;
}

export type Page = "tree" | "topic" | "cards" | "review";

export interface Boot {
  page: Page;
  topic: string | null;
  curriculum: Curriculum;
  glossary: Term[];
  cards: Record<string, Card[]>;
  quiz: Quiz | null;
  quizzes: Record<string, Quiz>;
  progress: Progress;
  journal: string | null;
  version: string;
  platform: Platform;
  fragment?: string | null;
}

export interface Note {
  id: string;
  block: string;
  text: string;
  author: "you" | "claude";
  created: string;
  topic?: string;
  parent?: string;
  type: string;
  status?: string | null;
  section?: string;
  excerpt?: string;
  context?: string;
}

export interface ServerState {
  notes: Note[];
  version: string;
  listening: boolean;
  journal?: string;
}

export interface Block {
  id: string;
  el: HTMLElement;
  text: string;
  section: string;
}
