# study-tree

A local study site for any subject laid out as a skill tree. The site has lessons, quizzes, flip cards with spaced review, a mixed review quiz, a glossary with hover definitions, XP, levels and badges. You can post a question or edit request on any paragraph, and a Claude session answers it.

The platform holds no subject matter. Each curriculum is a folder with a `curriculum.json`, and `FORMAT_SPEC.md` describes the files it needs.

## Run

```sh
python3 server.py --root ~/notes/market-simulation --port 8765 serve
```

`--root` defaults to `$STUDY_ROOT` or the current directory, and `--port` to `$STUDY_PORT` or 8765. Each curriculum gets its own server on its own port.

| Command | What it does |
|---|---|
| `serve` | Serves the tree at `/`, lessons at `/t/<id>`, flip cards at `/cards`, the mixed quiz at `/review` and curriculum files under `/files/` |
| `build` | Assigns stable `data-cid` block ids in `topics/*.html`, checks the JSON and lists missing files |
| `wait` | Blocks until a question or edit request is pending, prints it as JSON and marks it as being worked on |
| `reply <id> <text or ->` | Posts an answer as Claude and marks the thread answered |
| `list [--open]` | Prints every thread |

## Files

| File | What it holds |
|---|---|
| `app.html` | The page shell: tree, lessons, quiz, cards, glossary, notes. It reads kinds, ranks, badges and strings from the curriculum's `config` |
| `server.py` | HTTP server and CLI. It stores state in the curriculum folder: `notes.json`, `notes/<id>.md`, `journal/<id>.md` and `progress.json` |
| `FORMAT_SPEC.md` | The contract for a curriculum folder |

## Installed curricula

| Curriculum | Port | launchd agent |
|---|---|---|
| `~/notes/market-simulation` | 8765 | `~/Library/LaunchAgents/com.jfr.market-sim-notes.plist` |
