#!/usr/bin/env python3
import argparse
import contextlib
import datetime
import fcntl
import hashlib
import html
import http.server
import json
import mimetypes
import os
import pathlib
import re
import sys
import time
import urllib.parse
import uuid

PLATFORM = pathlib.Path(__file__).resolve().parent
APP = PLATFORM / "app.html"
DEFAULT_PORT = 8765
TYPES = {"question", "request", "comment"}
INTERVALS = [1, 2, 4, 8, 16, 32]
BLOCK_TAG = re.compile(r'<(h2|h3|p|li|tr|div class="codewrap"|div class="math")(?=[\s>])([^>]*)>')
SERVABLE = {".pdf", ".py", ".sql", ".png", ".jpg", ".svg", ".csv", ".json", ".md", ".txt"}


def configure(root, port, state=None):
    global ROOT, STATE, PORT, CURRICULUM, TOPICS, QUIZZES, CARDS, TERMS, NOTES_MD, JOURNAL, NOTES, PROGRESS, LOCK, HEARTBEAT
    ROOT = pathlib.Path(root).expanduser().resolve()
    PORT = port
    default_state = pathlib.Path.home() / ".study-tree" / re.sub(r"[^a-z0-9]+", "-", ROOT.name.lower())
    STATE = pathlib.Path(state).expanduser().resolve() if state else default_state
    STATE.mkdir(parents=True, exist_ok=True)
    CURRICULUM = ROOT / "curriculum.json"
    TOPICS = ROOT / "topics"
    QUIZZES = ROOT / "quizzes"
    CARDS = ROOT / "cards"
    TERMS = ROOT / "terms"
    NOTES_MD = STATE / "notes"
    JOURNAL = STATE / "journal"
    NOTES = STATE / "notes.json"
    PROGRESS = STATE / "progress.json"
    LOCK = STATE / ".notes.lock"
    HEARTBEAT = STATE / ".watcher-heartbeat"
    if not CURRICULUM.exists():
        raise SystemExit(f"no curriculum.json in {ROOT}")


def config():
    return curriculum().get("config", {})


def xp_for(kind):
    return config().get("kinds", {}).get(kind, {}).get("xp", 0)


def display_path(path):
    home = pathlib.Path.home()
    try:
        return "~/" + str(pathlib.Path(path).relative_to(home))
    except ValueError:
        return str(path)


def platform_info():
    root = display_path(ROOT)
    state = display_path(STATE)
    server = display_path(PLATFORM / "server.py")
    return {
        "root": root,
        "state": state,
        "port": PORT,
        "key": re.sub(r"[^a-z0-9]+", "-", ROOT.name.lower()),
        "serve_cmd": f"python3 {server} --root {root} --state {state} --port {PORT} serve",
    }


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


@contextlib.contextmanager
def locked():
    with open(LOCK, "w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        yield


def read_json(path, default):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return default
    except json.JSONDecodeError as e:
        print(f"bad json in {path}: {e}", file=sys.stderr)
        return default


def write_json(path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    os.replace(tmp, path)


def load():
    return read_json(NOTES, {"notes": []})["notes"]


def curriculum():
    return read_json(CURRICULUM, {"nodes": []})


def mutate(fn):
    with locked():
        notes = load()
        result = fn(notes)
        write_json(NOTES, {"notes": notes})
        export_markdown(notes)
        return result


def assign_ids(fragment):
    used = [int(n) for n in re.findall(r'data-cid="b(\d+)"', fragment)]
    counter = iter(range(max(used, default=0) + 1, 10**9))

    def add(m):
        if "data-cid=" in m.group(2):
            return m.group(0)
        return f'<{m.group(1)} data-cid="b{next(counter)}"{m.group(2)}>'

    return BLOCK_TAG.sub(add, fragment)


def topic_fragment(topic_id, write=False):
    path = TOPICS / f"{topic_id}.html"
    if not path.exists():
        return ""
    raw = path.read_text()
    with_ids = assign_ids(raw)
    if write and with_ids != raw:
        path.write_text(with_ids)
    return with_ids


def merged_glossary():
    base = []
    for name in config().get("glossary_files", []):
        base += read_json(ROOT / name, {"terms": []}).get("terms", [])
    seen = set()
    base = [t for t in base if not (t["term"].lower() in seen or seen.add(t["term"].lower()))]
    extra = []
    for node in curriculum()["nodes"]:
        for t in read_json(TERMS / f"{node['id']}.json", {"terms": []}).get("terms", []):
            if not isinstance(t, dict) or not t.get("term") or t["term"].lower() in seen:
                continue
            seen.add(t["term"].lower())
            extra.append({**t, "topic": node["id"]})
    return base + extra


def content_version():
    h = hashlib.sha1()
    paths = [APP, CURRICULUM] + [ROOT / name for name in config().get("glossary_files", [])]
    for d in (TOPICS, QUIZZES, CARDS, TERMS):
        paths += sorted(d.glob("*"))
    for p in paths:
        if p.is_file():
            h.update(p.name.encode())
            h.update(p.read_bytes())
    return h.hexdigest()[:12]


def load_progress():
    p = read_json(PROGRESS, {})
    p.setdefault("xp", 0)
    p.setdefault("visited", {})
    p.setdefault("quiz", {})
    p.setdefault("cards", {})
    p.setdefault("events", [])
    return p


def render(page, topic=None):
    cur = curriculum()
    nodes = {n["id"]: n for n in cur["nodes"]}
    cards = {n["id"]: read_json(CARDS / f"{n['id']}.json", {}).get("cards") for n in cur["nodes"]}
    boot = {
        "page": page,
        "topic": topic,
        "curriculum": cur,
        "glossary": merged_glossary(),
        "cards": {k: v for k, v in cards.items() if v},
        "quiz": read_json(QUIZZES / f"{topic}.json", None) if topic else None,
        "quizzes": {n["id"]: q for n in cur["nodes"] if (q := read_json(QUIZZES / f"{n['id']}.json", None))} if page == "review" else {},
        "progress": load_progress(),
        "journal": journal_text(topic) if topic else None,
        "version": content_version(),
        "platform": platform_info(),
    }
    blob = json.dumps(boot, ensure_ascii=False).replace("</", "<\\/")
    if page == "topic":
        content = f'<article id="doc">\n{topic_fragment(topic)}\n</article>'
        title = nodes[topic]["title"]
    elif page == "cards":
        content, title = "", "Flip card review"
    elif page == "review":
        content, title = "", "Mixed review"
    else:
        content, title = "", cur.get("title", "Skill tree")
    if page != "topic":
        title = f"{title}: {cur.get('title', 'Skill tree')}" if page in ("cards", "review") else title
    return (APP.read_text()
            .replace("__TITLE__", html.escape(title))
            .replace("__BOOT_JSON__", blob)
            .replace("__CONTENT__", content))


def journal_text(topic):
    path = JOURNAL / f"{topic}.md"
    return path.read_text() if path.exists() else ""


def listening():
    try:
        return time.time() - HEARTBEAT.stat().st_mtime < 15
    except FileNotFoundError:
        return False


def thread_of(notes, root_id):
    return [n for n in notes if n["id"] == root_id or n.get("parent") == root_id]


def find(notes, note_id):
    for n in notes:
        if n["id"] == note_id or n["id"].startswith(note_id):
            return n
    raise SystemExit(f"no note with id {note_id}")


def new_note(block, text, author, **extra):
    return {"id": uuid.uuid4().hex[:12], "block": block, "text": text, "author": author, "created": now(), **extra}


def topic_of(note):
    return note.get("topic") or note["block"].split("/")[0]


def export_markdown(notes):
    NOTES_MD.mkdir(exist_ok=True)
    titles = {n["id"]: n["title"] for n in curriculum()["nodes"]}
    by_topic = {}
    for n in notes:
        if not n.get("parent"):
            by_topic.setdefault(topic_of(n), []).append(n)
    for topic, roots in by_topic.items():
        lines = [f"# {titles.get(topic, topic)}: notes", "", f"Lesson: http://127.0.0.1:{PORT}/t/{topic}", ""]
        section = None
        for root in sorted(roots, key=lambda r: (r.get("section") or "", r["created"])):
            if root.get("section") != section:
                section = root.get("section")
                lines += [f"## {section or 'Other'}", ""]
            label = {"question": "Question", "request": "Edit request", "comment": "Comment"}.get(root["type"], root["type"])
            if root.get("excerpt"):
                lines += [f"> {root['excerpt']}", ""]
            for m in thread_of(notes, root["id"]):
                who = "Claude" if m["author"] == "claude" else "You"
                tag = f"{who}, {label.lower()}" if m is root else who
                lines += [f"**{tag}** ({m['created'][:16].replace('T', ' ')} UTC)", "", m["text"].strip(), ""]
            lines += ["---", ""]
        (NOTES_MD / f"{topic}.md").write_text("\n".join(lines))
    for stale in NOTES_MD.glob("*.md"):
        if stale.stem not in by_topic:
            stale.unlink()


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, code, body, ctype="application/json"):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urllib.parse.unquote(self.path.split("?")[0])
        ids = {n["id"] for n in curriculum()["nodes"]}
        if path in ("/", "/index.html"):
            self.send(200, render("tree"), "text/html; charset=utf-8")
        elif path in ("/cards", "/review"):
            self.send(200, render(path[1:]), "text/html; charset=utf-8")
        elif path.startswith("/t/") and path[3:].strip("/") in ids:
            self.send(200, render("topic", path[3:].strip("/")), "text/html; charset=utf-8")
        elif path.startswith("/files/"):
            target = (ROOT / path[len("/files/"):]).resolve()
            if ROOT in target.parents and target.is_file() and target.suffix in SERVABLE:
                self.send(200, target.read_bytes(), mimetypes.guess_type(target.name)[0] or "application/octet-stream")
            else:
                self.send(404, '{"error":"not found"}')
        elif path == "/api/state":
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            topic = (query.get("topic") or [None])[0]
            state = {"notes": load(), "version": content_version(), "listening": listening()}
            if topic in ids:
                state["journal"] = journal_text(topic)
            self.send(200, json.dumps(state))
        else:
            self.send(404, '{"error":"not found"}')

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            path = self.path.split("?")[0]
            if path == "/api/notes":
                self.send(200, json.dumps(mutate(lambda notes: add_from_page(notes, body))))
            elif path == "/api/delete":
                mutate(lambda notes: delete(notes, body["id"]))
                self.send(200, "{}")
            elif path == "/api/journal":
                topic = body["topic"]
                if topic not in {n["id"] for n in curriculum()["nodes"]}:
                    raise ValueError("unknown topic")
                JOURNAL.mkdir(exist_ok=True)
                (JOURNAL / f"{topic}.md").write_text(str(body.get("text", "")))
                self.send(200, "{}")
            elif path == "/api/progress":
                self.send(200, json.dumps(update_progress(body)))
            else:
                self.send(404, '{"error":"not found"}')
        except (ValueError, KeyError, StopIteration) as e:
            self.send(400, json.dumps({"error": str(e)}))


def update_progress(body):
    nodes = {n["id"]: n for n in curriculum()["nodes"]}
    with locked():
        p = load_progress()
        kind = body.get("kind")
        gained = 0
        if kind == "visit":
            p["visited"].setdefault(body["topic"], now())
        elif kind == "quiz":
            topic = body["topic"]
            score, total = int(body["score"]), int(body["total"])
            q = p["quiz"].setdefault(topic, {"best": 0, "total": total, "attempts": 0, "passed": False})
            q["attempts"] += 1
            q["best"] = max(q["best"], score)
            q["total"] = total
            q["last"] = now()
            if not q["passed"] and total and score / total >= config().get("pass_mark", 0.7):
                q["passed"] = True
                q["passed_at"] = now()
                gained = xp_for(nodes[topic]["kind"])
        elif kind == "card":
            card = str(body["card"])
            today = datetime.date.today()
            c = p["cards"].setdefault(card, {"box": 0, "due": today.isoformat()})
            was_due = c["due"] <= today.isoformat()
            if body.get("correct"):
                c["box"] = min(c["box"] + 1, len(INTERVALS))
                c["due"] = (today + datetime.timedelta(days=INTERVALS[c["box"] - 1])).isoformat()
                gained = 2 if was_due else 0
            else:
                c["box"] = 0
                c["due"] = today.isoformat()
            c["reviews"] = c.get("reviews", 0) + 1
        elif kind == "review":
            gained = 3 * max(0, int(body["score"]))
        else:
            raise ValueError("unknown progress kind")
        p["xp"] += gained
        p["events"].append({"at": now(), "kind": kind, "topic": body.get("topic"), "card": body.get("card"), "xp": gained})
        p["events"] = p["events"][-2000:]
        write_json(PROGRESS, p)
        return p


def add_from_page(notes, body):
    text = str(body.get("text", "")).strip()
    block = str(body.get("block", ""))
    if not text or not block:
        raise ValueError("text and block are required")
    topic = str(body.get("topic") or block.split("/")[0])
    parent = body.get("parent")
    if parent:
        root = next(n for n in notes if n["id"] == parent)
        claude_in_thread = any(n["author"] == "claude" for n in thread_of(notes, parent))
        status = "pending" if root["type"] != "comment" or claude_in_thread else None
        note = new_note(root["block"], text, "you", topic=topic_of(root), parent=parent, type="reply", status=status)
    else:
        kind = body.get("type")
        if kind not in TYPES:
            raise ValueError(f"type must be one of {sorted(TYPES)}")
        note = new_note(
            block, text, "you", topic=topic, type=kind,
            status="pending" if kind != "comment" else None,
            section=str(body.get("section", ""))[:200],
            excerpt=str(body.get("excerpt", ""))[:200],
            context=str(body.get("context", ""))[:4000],
        )
    notes.append(note)
    return note


def delete(notes, note_id):
    notes[:] = [n for n in notes if n["id"] != note_id and n.get("parent") != note_id]


def pending(notes):
    return [n for n in notes if n.get("author") == "you" and n.get("status") == "pending"]


def view(notes, n):
    root = next((r for r in notes if r["id"] == (n.get("parent") or n["id"])), n)
    return {
        "reply_to": root["id"],
        "type": root["type"],
        "topic": topic_of(root),
        "file": display_path(TOPICS / f"{topic_of(root)}.html"),
        "journal": display_path(JOURNAL / f"{topic_of(root)}.md"),
        "section": root.get("section"),
        "block": root["block"],
        "context": root.get("context") or root.get("excerpt"),
        "thread": [{"id": m["id"], "author": m["author"], "text": m["text"]} for m in thread_of(notes, root["id"])],
    }


def cmd_serve(args):
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"serving {ROOT} with state in {STATE} on http://127.0.0.1:{PORT}/", flush=True)
    server.serve_forever()


def cmd_build(args):
    problems = []
    for node in curriculum()["nodes"]:
        nid = node["id"]
        topic_fragment(nid, write=True)
        for d in (QUIZZES, CARDS, TERMS):
            f = d / f"{nid}.json"
            if f.exists():
                try:
                    json.loads(f.read_text())
                except json.JSONDecodeError as e:
                    problems.append(f"{f.relative_to(ROOT)}: {e}")
        for f in [TOPICS / f"{nid}.html", QUIZZES / f"{nid}.json", CARDS / f"{nid}.json"]:
            if not f.exists():
                problems.append(f"missing {f.relative_to(ROOT)}")
    with locked():
        export_markdown(load())
    print(f"built version {content_version()}")
    for p in problems:
        print("  " + p)


def cmd_wait(args):
    deadline = time.time() + args.max_seconds
    while time.time() < deadline:
        HEARTBEAT.touch()
        if pending(load()):
            time.sleep(args.settle)
            HEARTBEAT.touch()

            def claim(notes):
                found = pending(notes)
                for n in found:
                    n["status"] = "working"
                roots = {}
                for n in found:
                    v = view(notes, n)
                    roots[v["reply_to"]] = v
                return list(roots.values())

            print(json.dumps(mutate(claim), indent=2, ensure_ascii=False))
            return
        time.sleep(2)
    print("timed out with nothing pending")


def cmd_reply(args):
    text = sys.stdin.read().strip() if args.text == "-" else args.text

    def do(notes):
        target = find(notes, args.id)
        root = find(notes, target.get("parent") or target["id"])
        notes.append(new_note(root["block"], text, "claude", topic=topic_of(root), parent=root["id"], type="reply", status=None))
        for n in thread_of(notes, root["id"]):
            if n["author"] == "you" and n.get("status") in ("pending", "working"):
                n["status"] = "answered"

    mutate(do)
    HEARTBEAT.touch()
    print("replied")


def cmd_list(args):
    notes = load()
    for n in notes:
        if n.get("parent"):
            continue
        thread = thread_of(notes, n["id"])
        states = {m.get("status") for m in thread}
        if args.open and not states & {"pending", "working"}:
            continue
        print(f"{n['id']}  {n['type']:<8} {topic_of(n)[:30]:<30} {(n.get('section') or '')[:30]:<30}  {len(thread)} msgs  {'/'.join(sorted(s for s in states if s))}")
        for m in thread:
            print(f"    {m['author']:>6}: {m['text'][:100]!r}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", default=os.environ.get("STUDY_ROOT", "."), help="curriculum directory (default: $STUDY_ROOT or the current directory)")
    p.add_argument("--state", default=os.environ.get("STUDY_STATE"), help="directory for your notes, journal and progress (default: $STUDY_STATE or ~/.study-tree/<curriculum>)")
    p.add_argument("--port", type=int, default=int(os.environ.get("STUDY_PORT", DEFAULT_PORT)))
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("serve").set_defaults(fn=cmd_serve)
    sub.add_parser("build").set_defaults(fn=cmd_build)
    w = sub.add_parser("wait")
    w.add_argument("--max-seconds", type=int, default=6900)
    w.add_argument("--settle", type=float, default=4)
    w.set_defaults(fn=cmd_wait)
    r = sub.add_parser("reply")
    r.add_argument("id")
    r.add_argument("text")
    r.set_defaults(fn=cmd_reply)
    ls = sub.add_parser("list")
    ls.add_argument("--open", action="store_true")
    ls.set_defaults(fn=cmd_list)
    args = p.parse_args()
    configure(args.root, args.port, args.state)
    args.fn(args)


if __name__ == "__main__":
    main()
