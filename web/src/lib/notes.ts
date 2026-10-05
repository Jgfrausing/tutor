import type { Note } from "../types";

export const rootsFor = (notes: Note[], id: string) => notes.filter(n => n.block === id && !n.parent).sort((a, b) => a.created.localeCompare(b.created));
export const repliesFor = (notes: Note[], rootId: string) => notes.filter(n => n.parent === rootId).sort((a, b) => a.created.localeCompare(b.created));
export const threadOpen = (notes: Note[], root: Note) => [root, ...repliesFor(notes, root.id)].some(n => n.status === "pending" || n.status === "working");
