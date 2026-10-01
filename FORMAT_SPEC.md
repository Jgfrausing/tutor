# Curriculum format spec

The platform serves any curriculum folder that holds a `curriculum.json`. The folder's own `AUDIENCE.md` says who the lessons are for, which house style applies and which sections each node kind has. This file covers what the platform needs: file formats, allowed HTML, math and validation.

## `curriculum.json`

```json
{
  "title": "Skill tree title",
  "config": {
    "lede": "One sentence shown under the title.",
    "pass_mark": 0.7,
    "xp_per_level": 250,
    "kinds": {"concept": {"label": "Concept", "xp": 100, "color": "accent"}, "math": {"label": "Side quest", "xp": 75, "color": "accent-2", "side_quest": true}},
    "ranks": ["Level 1 title", "Level 2 title"],
    "badges": [{"name": "First steps", "desc": "Complete any node", "rule": {"type": "count_passed", "n": 1}}],
    "glossary_files": ["glossary.json"],
    "case_sensitive_terms": ["Long"],
    "journal_prompt": "Write study notes into {journal}. Keep what I already wrote."
  },
  "nodes": [{"id": "intro", "title": "Intro", "kind": "concept", "prereqs": [], "summary": "One sentence."}]
}
```

- Kind fields: `label`, `xp`, `color` (a palette token from `app.html`: `accent`, `accent-2`, `ok`, `gold`, `lab`, `danger`, `question`, `comment`), optional `shape` (`rounded`, `sharp`, `hex`), `emphasis` (thicker border), `legend: false` (hide from the tree legend) and `side_quest` (optional node that opens when any node in its `attached_to` list opens).
- Badge rule types: `passed` (`node`), `all_passed` (`nodes`), `count_passed` (`kind` optional, `n`), `all_of_kind` (`kind`), `cards_reviewed` (`n`), `perfect_quiz` (`kind` optional).
- A node can carry `paper: {authors, year, venue, title, url, local}`; the lesson page then shows a paper box. `local` is a path inside the curriculum folder, served under `/files/`.

## Files per node

| File | What it holds |
|---|---|
| `topics/<id>.html` | The lesson, as an HTML fragment (no `<html>`, `<head>`, `<body>` or `<h1>`; the shell renders the title and summary from `curriculum.json`) |
| `quizzes/<id>.json` | Multiple-choice questions |
| `cards/<id>.json` | Flip cards |
| `terms/<id>.json` | New glossary terms this lesson introduces |

## HTML fragment rules

Allowed elements: `h2`, `h3`, `p`, `ul`, `ol`, `li`, `table` with `thead`/`tbody`/`tr`/`th`/`td` (wrap tables in `<div class="tablewrap">`), `code`, `strong`, `em`, `a`, and these blocks:

```html
<div class="codewrap"><pre><code>...escaped code...</code></pre></div>
<div class="math">\[ \lambda(t) = \mu + \sum_{t_i < t} \alpha e^{-\beta (t - t_i)} \]</div>
<div class="callout"><p>Takeaway or pointer.</p></div>
<div class="callout notation"><p>Notation side quest: this paper uses \( \mathbb{E}[\cdot] \). See <a href="/t/&lt;side-quest-id&gt;">its side quest</a>.</p></div>
```

- Figures: `<figure class="fig"><img src="/files/figures/<name>.svg" alt="What the figure shows"><figcaption>One or two sentences.</figcaption></figure>`. Put the image and the script that generates it in the curriculum's `figures/` folder. SVG is preferred; give it its own `prefers-color-scheme: dark` styles, since an SVG loaded as an image cannot read the page's colours. Answers to questions can show a figure with markdown image syntax, `![alt](/files/figures/<name>.svg)`.
- Math is rendered with KaTeX. Inline math uses `\( ... \)`, display math uses `\[ ... \]` inside `<div class="math">`. Never use `$` as a math delimiter. Escape `<`, `>` and `&` in HTML text and code as `&lt;`, `&gt;`, `&amp;` (inside `\( \)` too: write `t_i &lt; t`).
- Link to other nodes with `<a href="/t/<node-id>">Title</a>`. Link to external papers with full URLs.
- Put commentable content in block elements (p, li, tr, div.math, div.codewrap). Keep paragraphs short (2 to 5 sentences).
- Do not add `data-cid` attributes; the build assigns them.


## Quiz file

```json
{"questions": [
  {"q": "Question text, may contain \\( math \\)", "choices": ["A", "B", "C", "D"], "answer": 1, "explain": "Why B is right and the tempting wrong answer is wrong."}
]}
```

`answer` is the zero-based index. Mix recall with application questions ("the algo lifts 5 MW, what does model X predict happens next"). Make wrong choices plausible.


## Cards file

```json
{"cards": [
  {"id": "<node-id>-1", "front": "Short prompt", "back": "One to three sentences."}
]}
```


## Terms file

```json
{"terms": [
  {"term": "Term", "aliases": ["Other name"], "category": "category", "definition": "Plain one to three sentence definition.", "see_also": ["Related term"]}
]}
```

Do not repeat terms that already exist in the curriculum's `glossary_files` or in another node's terms file; check them first. Reuse existing categories where they fit. The glossary panel filters by category.


## Validation before you finish

```sh
cd <curriculum folder>
for f in quizzes/<id>.json cards/<id>.json terms/<id>.json; do python3 -m json.tool "$f" >/dev/null || echo "BAD $f"; done
grep -n '[—–]' topics/<id>.html quizzes/<id>.json cards/<id>.json terms/<id>.json
python3 ~/code/study-tree/server.py --root . build
```

`build` assigns stable `data-cid` block ids (notes attach to them), checks the JSON and lists missing files.
