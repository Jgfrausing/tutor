# tutor

A local study site for any subject laid out as a skill tree. The site has lessons, quizzes, flip cards with spaced review, a mixed review quiz, a glossary with hover definitions, XP, levels and badges. You can post a question or edit request on any paragraph, and a Claude session answers it.

The platform holds no subject matter. Each curriculum is a folder with a `curriculum.json`, and `FORMAT_SPEC.md` describes the files it needs.

## Run

```sh
python3 server.py --root ~/notes/market-simulation --state ~/notes/study-state/market-simulation --port 8765 serve
```

`--root` is the curriculum folder. The server reads it and writes to it only when `build` assigns block ids. `--state` is where your notes, answers, journal and progress go, so the curriculum folder can be shared. The defaults are `$STUDY_ROOT` or the current directory for `--root`, `$STUDY_STATE` or `~/.tutor/<curriculum folder name>` for `--state`, and `$STUDY_PORT` or 8765 for `--port`. Each curriculum gets its own server on its own port. Pass the same `--root` and `--state` to `wait`, `reply` and `list`.

| Command | What it does |
|---|---|
| `serve` | Serves the tree at `/`, lessons at `/t/<id>`, flip cards at `/cards`, the mixed quiz at `/review` and curriculum files under `/files/` |
| `/api/tts?text=...&slow=0\|1&lang=ja\|en` | Spoken audio for say spans and the Read aloud player on lesson pages: `edge-tts` with the ja-JP Nanami or en-US Ava voice when installed (`uv tool install edge-tts`), otherwise macOS `say` (Kyoko or Samantha). Clips are cached in `<state>/.tts/` |
| `POST /api/wake` | The status chip, which turns into a "Claude offline: wake" button while no listener runs. `wait` records its tmux pane in `<state>/.wake-pane`, and this endpoint types a "start the listener again" message into that pane with `tmux send-keys`. It does nothing while a listener runs and ignores repeats within 60 seconds |
| `build` | Assigns stable `data-cid` block ids in `topics/*.html`, checks the JSON and lists missing files |
| `wait` | Blocks until a question or edit request is pending, prints it as JSON and marks it as being worked on |
| `reply <id> <text or ->` | Posts an answer as Claude and marks the thread answered |
| `list [--open]` | Prints every thread |

## Build the web UI

You only need this after changing `web/`. It needs Node and npm.

```sh
cd web
npm install
npm run build
```

`npm run build` type-checks with `tsc` and writes the bundle to `dist/` in the repository root. Commit `dist/` with the source change. KaTeX and highlight.js load from cdnjs through script tags in `web/index.html`, not from npm.

## Tests

```sh
python3 -m unittest discover tests
```

The tests start the server on a free port against a small temporary curriculum and state folder. They cover the pages, `/files/` and path traversal, quiz XP, card intervals and first-review dates, bad input, notes and `build`. They need no network and touch nothing outside the temporary folder.

## Making a curriculum

`skills/new-curriculum` is a Claude Code skill that builds a whole curriculum: it asks about the subject, reader and size, shows you the tree for approval, writes `curriculum.json`, `AUDIENCE.md` and `README.md`, has writer agents produce every lesson, quiz, card and terms file in parallel, and runs `build` until it is clean. It does not start a server. Link it into your skills folder once:

```sh
ln -s "$PWD/skills/new-curriculum" ~/.claude/skills/new-curriculum
```

Then ask Claude Code for "a new curriculum on <subject>".

## Files

| File | What it holds |
|---|---|
| `web/` | The web UI: React 18 and TypeScript, built with Vite. Components are in `web/src/components/` (tree, lesson, quiz, cards, glossary, notes threads, journal, read-aloud player), shared logic in `web/src/lib/` and the styles in `web/src/styles.css`. It reads kinds, ranks, badges and strings from the curriculum's `config` |
| `dist/` | The built UI, committed so that running the server needs only Python. `server.py` fills `dist/index.html` with the page's boot JSON (the lesson HTML travels in its `fragment` field) and serves `dist/assets/` under `/assets/` |
| `server.py` | HTTP server and CLI. It keeps state in the `--state` folder: `notes.json`, `notes/<id>.md`, `journal/<id>.md`, `progress.json`, the log and the listener heartbeat |
| `FORMAT_SPEC.md` | The contract for a curriculum folder |

## Installed curricula

| Curriculum | State | Port | launchd agent |
|---|---|---|---|
| `~/notes/market-simulation` | `~/notes/study-state/market-simulation` | 8765 | `~/Library/LaunchAgents/com.jfr.market-sim-notes.plist` |
| `~/notes/tokyo` | `~/notes/study-state/tokyo` | 8766 | none yet |
