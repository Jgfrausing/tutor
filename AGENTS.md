# AGENTS.md

Instructions for an AI coding agent asked to run a tutor curriculum: start its server and answer the questions, edit requests and comments the reader posts on lesson paragraphs.

`README.md` describes the platform and `FORMAT_SPEC.md` the curriculum files. This file covers running a curriculum and listening to it.

## What you need from the user

- The curriculum folder (`--root`), for example `~/notes/my-subject`.
- The state folder (`--state`), for example `~/notes/study-state/my-subject`.
- The port. If the curriculum folder's own `README.md` gives a `serve` command, use its folders and port.

Pass the same `--root` and `--state` to every command below. That pair is the only link between the server, the page and you.

## Start the server

1. Install the binary if `tutor` is not on the PATH: `cargo install --path .` in this repository.
2. Check the port is free: `lsof -i :<port>`. If a `tutor ... serve` for the same root already runs there, use it and skip step 3.
3. Start the server in the background, from the state folder, with the longest background timeout your harness allows:

   ```sh
   cd <state> && tutor --root <root> --state <state> --port <port> serve
   ```

4. Check it answers: `curl -s -o /dev/null -w '%{http_code}' localhost:<port>/` prints 200.

If a `tutor ... serve` for the same `--root` already runs (`pgrep -fl "tutor --root <root>"`), for example under launchd, use it. Do not start a second server for the same curriculum.

## Listen

Run `wait` in the background, with the longest background timeout your harness allows:

```sh
tutor --root <root> --state <state> wait
```

While it runs, the page shows "Claude listening". `wait` exits in one of two ways:

- It prints `timed out with nothing pending`. Start `wait` again.
- It prints a JSON list of threads and marks them as being worked on. Answer every thread in the list, then start `wait` again.

Each thread has `reply_to`, `type` (`question`, `request` or `comment`), `topic`, `file` (the lesson), `section`, `context` (the paragraph the reader marked) and `thread` (every message so far; answer the last one).

For each thread:

1. Read the curriculum's `AUDIENCE.md` (who the reader is, house style, sections per kind) and the lesson in `file`.
2. Answer by type:
   - `question`: answer the last message, grounded in the lesson. Say so when the lesson does not cover it, and do not invent facts, numbers or sources.
   - `request` (an edit request): make the change in the lesson, quiz, cards or terms files as `FORMAT_SPEC.md` describes, then run `tutor --root <root> --state <state> build` and fix every problem it lists. Reply with what changed.
   - `comment`: reply briefly, or acknowledge it when it needs nothing.
3. Post the reply as markdown on stdin:

   ```sh
   tutor --root <root> --state <state> reply <reply_to> - <<'ANSWER'
   ...
   ANSWER
   ```

Every thread gets a reply, even when it only says what you could not do. A thread left without a reply stays marked as being worked on.

Replies can use markdown: bold, italics, lists, links, code and images from the curriculum (`![alt](/files/figures/<name>.svg)`).

## Keep listening

- When a background `wait` reaches its timeout, start it again. The page shows "Claude offline" until you do.
- When the server's background command stops, start the server again before the next `wait`.
- Run in tmux when you can. `wait` records its tmux pane in `<state>/.wake-pane`, and the page's "Claude offline: wake" button types a message into that pane asking you to start listening again. When that message arrives, start `wait` again.
- Keep going until the user tells you to stop. Then stop the server and `wait` processes you started, and only those.

## Do not

- Post test notes, visits or quiz results to a real state folder. Test against a copy of it (`cp -R <state> <scratch>`) on another port.
- Answer for the reader, or delete their notes.
- Restart or unload a launchd agent unless the user asks.
