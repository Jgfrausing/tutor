# tutor

A local study site for any subject laid out as a skill tree. The site has lessons, quizzes, flip cards with spaced review, a mixed review quiz, a glossary with hover definitions, XP, levels and badges. You can post a question or edit request on any paragraph, and a Claude session answers it.

The platform holds no subject matter. Each curriculum is a folder with a `curriculum.json`, and `FORMAT_SPEC.md` describes the files it needs.

## Build

The server is a Rust program. Build it once, and again after changing `src/`:

```sh
cargo build --release
```

This writes the binary `target/release/tutor`. It reads the web UI from the `dist/` folder next to `target/`, so run it from where it was built.

## Run

```sh
target/release/tutor --root ~/notes/market-simulation --state ~/notes/study-state/market-simulation --port 8765 serve
```

`--port 0` binds a free port; the startup line names the port it bound.

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
cargo build --release
python3 -m unittest discover tests
```

The tests run the server as a separate process, from the command in `$TUTOR_CMD` (default `target/release/tutor`), with `--port 0` against a small temporary curriculum and state folder, and read the bound port from the startup line. They cover the pages and boot JSON, `/files/`, `/assets/` and path traversal, quiz XP, card intervals, the other progress kinds, bad input, notes, replies and deletes, the markdown export, the journal, the wake guard, the TTS cache key, `wait`, `reply` and `list`, the content version, the glossary merge and `build` block ids. They need no network and touch nothing outside the temporary folder. Python 3 runs the tests only; the server does not need it.

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
| `dist/` | The built UI, committed so that running the server needs no Node. The server fills `dist/index.html` with the page's boot JSON (the lesson HTML travels in its `fragment` field) and serves `dist/assets/` under `/assets/` |
| `src/` | The HTTP server and CLI, in Rust (`Cargo.toml` at the root, binary `tutor`). `main.rs` parses the command line, `http.rs` serves HTTP/1.0 with `std::net`, `tutor.rs` holds the routes, notes, progress, export and `build`, and `json.rs` reads and writes JSON with the same key order, spacing, escapes, float digits and decode error messages as Python's `json` module, so state folders written by the earlier Python server load unchanged. It keeps state in the `--state` folder: `notes.json`, `notes/<id>.md`, `journal/<id>.md`, `progress.json`, the TTS cache and the listener heartbeat |
| `tests/` | Black-box tests that start the server as a subprocess |
| `FORMAT_SPEC.md` | The contract for a curriculum folder |

## Installed curricula

| Curriculum | State | Port | launchd agent |
|---|---|---|---|
| `~/notes/market-simulation` | `~/notes/study-state/market-simulation` | 8765 | `~/Library/LaunchAgents/com.jfr.market-sim-notes.plist` |
| `~/notes/tokyo` | `~/notes/study-state/tokyo` | 8766 | none yet |
