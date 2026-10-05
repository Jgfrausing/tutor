import datetime
import hashlib
import json
import os
import pathlib
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[1]
APP = REPO / "dist" / "index.html"

CURRICULUM = {
    "title": "Test & tree",
    "config": {"pass_mark": 0.7, "xp_per_level": 100, "kinds": {"concept": {"label": "Concept", "xp": 100, "color": "accent"}, "side": {"label": "Side", "xp": 75, "color": "accent-2"}}, "ranks": ["One", "Two"], "badges": [], "glossary_files": []},
    "nodes": [
        {"id": "first", "title": "First", "kind": "concept", "prereqs": [], "summary": "The first node."},
        {"id": "second", "title": "Second", "kind": "concept", "prereqs": ["first"], "summary": "The second node."},
        {"id": "third", "title": "Tredje æøå", "kind": "side", "prereqs": [], "summary": "日本語のノード"},
    ],
}


def tutor_cmd():
    cmd = os.environ.get("TUTOR_CMD")
    return shlex.split(cmd) if cmd else [sys.executable, str(REPO / "server.py")]


def make_curriculum(base, curriculum=CURRICULUM):
    root, state = base / "curriculum", base / "state"
    for d in ("topics", "quizzes", "cards", "terms", "figures"):
        (root / d).mkdir(parents=True)
    (root / "curriculum.json").write_text(json.dumps(curriculum))
    for n in curriculum["nodes"]:
        (root / "topics" / f"{n['id']}.html").write_text("<h2>Part</h2>\n<p>Some text.</p>\n")
        (root / "quizzes" / f"{n['id']}.json").write_text(json.dumps({"questions": [{"q": "Q?", "choices": ["a", "b", "c", "d"], "answer": 2, "explain": "c."}]}))
        (root / "cards" / f"{n['id']}.json").write_text(json.dumps({"cards": [{"id": f"{n['id']}-1", "front": "F", "back": "B"}]}))
        (root / "terms" / f"{n['id']}.json").write_text(json.dumps({"terms": []}))
    (root / "figures" / "pic.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
    return root.resolve(), state


def boot_of(page):
    m = re.search(r'<script id="boot" type="application/json">(.*?)</script>', page.decode(), re.S)
    return json.loads(m.group(1))


class Fixture(unittest.TestCase):
    curriculum = CURRICULUM

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root, cls.state = make_curriculum(pathlib.Path(cls.tmp.name), cls.curriculum)
        cls.prepare()
        cls.start()

    @classmethod
    def prepare(cls):
        pass

    @classmethod
    def start(cls):
        cls.proc = subprocess.Popen([*tutor_cmd(), "--root", str(cls.root), "--state", str(cls.state), "--port", "0", "serve"], cwd=REPO, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        cls.startup = cls.proc.stdout.readline()
        m = re.search(r"http://127\.0\.0\.1:(\d+)/", cls.startup)
        if not m:
            cls.stop()
            raise RuntimeError(f"no startup line from {tutor_cmd()}: {cls.startup!r}")
        cls.port = int(m.group(1))
        cls.base = f"http://127.0.0.1:{cls.port}"

    @classmethod
    def stop(cls):
        cls.proc.terminate()
        cls.proc.wait(10)
        cls.proc.stdout.close()

    @classmethod
    def tearDownClass(cls):
        cls.stop()
        cls.tmp.cleanup()

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path) as r:
                return r.status, r.read(), r.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers.get("Content-Type", "")

    def post(self, path, body):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def state_json(self, topic=None):
        status, body, _ = self.get("/api/state" + (f"?topic={topic}" if topic else ""))
        self.assertEqual(status, 200)
        self.assertEqual(body.decode(), json.dumps(json.loads(body)))
        return json.loads(body)

    def cli(self, *args, input=None, env=None):
        return subprocess.run([*tutor_cmd(), "--root", str(self.root), "--state", str(self.state), "--port", str(self.port), *args], cwd=REPO, capture_output=True, text=True, input=input, env=env, timeout=60)

    def assert_file_json(self, path):
        text = path.read_text()
        self.assertEqual(text, json.dumps(json.loads(text), indent=2, ensure_ascii=False))
        return json.loads(text)


class ServerTest(Fixture):
    def test_startup_line_names_the_real_port(self):
        self.assertNotEqual(self.port, 0)
        self.assertEqual(self.startup, f"serving {self.root} with state in {self.state.resolve()} on http://127.0.0.1:{self.port}/\n")

    def test_pages(self):
        self.assertEqual(self.get("/")[0], 200)
        status, body, ctype = self.get("/t/first")
        self.assertEqual(status, 200)
        self.assertIn("text/html", ctype)
        self.assertIn(b"Some text.", body)
        self.assertEqual(self.get("/t/missing")[0], 404)
        self.assertEqual(self.get("/t/first/")[0], 200)

    def test_page_titles_and_boot(self):
        _, body, _ = self.get("/")
        self.assertIn(b"<title>Test &amp; tree</title>", body)
        boot = boot_of(body)
        self.assertEqual(list(boot), ["page", "topic", "curriculum", "glossary", "cards", "quiz", "quizzes", "progress", "journal", "version", "platform", "fragment"])
        self.assertEqual((boot["page"], boot["topic"], boot["quiz"], boot["quizzes"], boot["journal"], boot["fragment"]), ("tree", None, None, {}, None, None))
        self.assertEqual(boot["curriculum"], CURRICULUM)
        self.assertEqual(sorted(boot["cards"]), ["first", "second", "third"])
        self.assertEqual(boot["platform"]["port"], self.port)
        self.assertEqual(boot["platform"]["key"], "curriculum")
        _, body, _ = self.get("/cards")
        self.assertIn(b"<title>Flip card review: Test &amp; tree</title>", body)
        _, body, _ = self.get("/review")
        self.assertIn(b"<title>Mixed review: Test &amp; tree</title>", body)
        self.assertEqual(sorted(boot_of(body)["quizzes"]), ["first", "second", "third"])
        _, body, _ = self.get("/t/third")
        self.assertIn("<title>Tredje æøå</title>".encode(), body)
        boot = boot_of(body)
        self.assertEqual((boot["page"], boot["topic"]), ("topic", "third"))
        self.assertEqual(boot["fragment"], '<h2 data-cid="b1">Part</h2>\n<p data-cid="b2">Some text.</p>\n')
        self.assertIn("日本語のノード".encode(), body)

    def test_files_and_traversal(self):
        status, _, ctype = self.get("/files/figures/pic.svg")
        self.assertEqual(status, 200)
        self.assertIn("svg", ctype)
        for path in ("/files/../curriculum.json", "/files/%2e%2e/%2e%2e/etc/passwd", "/files/figures/../../state/progress.json", "/files/figures", "/files/topics/first.html"):
            self.assertEqual(self.get(path)[0], 404, path)
        status, body, ctype = self.get("/files/curriculum.json")
        self.assertEqual((status, ctype), (200, "application/json"))
        self.assertEqual(json.loads(body), CURRICULUM)

    def test_assets(self):
        js = next((REPO / "dist" / "assets").glob("*.js"))
        status, body, ctype = self.get(f"/assets/{js.name}")
        self.assertEqual((status, ctype), (200, "text/javascript; charset=utf-8"))
        self.assertEqual(body, js.read_bytes())
        self.assertEqual(self.get("/assets/../index.html")[0], 404)
        self.assertEqual(self.get("/assets/nope.js")[0], 404)

    def test_unknown_paths(self):
        self.assertEqual(self.get("/nope"), (404, b'{"error":"not found"}', "application/json"))
        self.assertEqual(self.post("/api/nope", {}), (404, {"error": "not found"}))

    def test_quiz_pass_gives_xp_once(self):
        status, first = self.post("/api/progress", {"kind": "quiz", "topic": "first", "score": 1, "total": 1, "answers": [2]})
        self.assertEqual(status, 200)
        self.assertTrue(first["quiz"]["first"]["passed"])
        xp = first["xp"]
        _, again = self.post("/api/progress", {"kind": "quiz", "topic": "first", "score": 1, "total": 1, "answers": [2]})
        self.assertEqual(again["xp"], xp)

    def test_quiz_below_pass_mark(self):
        _, r = self.post("/api/progress", {"kind": "quiz", "topic": "second", "score": 0, "total": 1, "answers": [0]})
        self.assertFalse(r["quiz"]["second"]["passed"])

    def test_card_review_records_first_day_and_interval(self):
        today = datetime.date.today()
        _, r = self.post("/api/progress", {"kind": "card", "card": "first-1", "correct": True})
        c = r["cards"]["first-1"]
        self.assertEqual(c["first"], today.isoformat())
        self.assertEqual(c["box"], 1)
        self.assertGreater(c["due"], today.isoformat())
        _, r = self.post("/api/progress", {"kind": "card", "card": "first-1", "correct": False})
        c = r["cards"]["first-1"]
        self.assertEqual((c["box"], c["due"], c["first"]), (0, today.isoformat(), today.isoformat()))

    def test_bad_input_is_400_with_a_message(self):
        self.assertEqual(self.post("/api/progress", b"not json"), (400, {"error": "Expecting value: line 1 column 1 (char 0)"}))
        status, r = self.post("/api/progress", {"kind": "quiz", "topic": "nope", "score": 1, "total": 1})
        self.assertEqual(status, 400)
        self.assertEqual(r["error"], "missing or unknown value: nope")
        self.assertEqual(self.post("/api/progress", {"kind": "zzz"}), (400, {"error": "unknown progress kind"}))
        self.assertEqual(self.post("/api/progress", {"kind": "quiz", "topic": "first", "score": "x", "total": 1}), (400, {"error": "invalid literal for int() with base 10: 'x'"}))
        self.assertEqual(self.post("/api/notes", {"block": "first/b1"}), (400, {"error": "text and block are required"}))
        self.assertEqual(self.post("/api/notes", {"block": "first/b1", "text": "x", "type": "nope"}), (400, {"error": "type must be one of ['comment', 'question', 'request']"}))
        self.assertEqual(self.post("/api/notes", {"block": "first/b1", "text": "x", "parent": "nope"}), (400, {"error": ""}))
        self.assertEqual(self.post("/api/delete", {}), (400, {"error": "missing or unknown value: id"}))
        self.assertEqual(self.get("/")[0], 200)

    def test_note_is_stored_as_pending(self):
        status, _ = self.post("/api/notes", {"block": "first/b1", "topic": "first", "type": "question", "text": "<b>Why?</b>"})
        self.assertEqual(status, 200)
        notes = self.state_json()["notes"]
        mine = [n for n in notes if n["text"] == "<b>Why?</b>"]
        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]["status"], "pending")

    def test_wake_without_a_recorded_pane_does_nothing(self):
        status, r = self.post("/api/wake", {})
        self.assertEqual(status, 200)
        self.assertFalse(r["ok"])
        self.assertIn("no Claude session", r["detail"])

    def test_tts_serves_the_cache(self):
        if not (shutil.which("edge-tts") or os.access(pathlib.Path.home() / ".local/bin/edge-tts", os.X_OK) or shutil.which("say")):
            self.skipTest("no tts engine")
        self.assertEqual(self.get("/api/tts?text=%20")[0:2], (404, b'{"error":"no tts"}'))
        cache = self.state / ".tts"
        cache.mkdir(exist_ok=True)
        text = "こんにちは 1+1"
        for engine, suffix in (("edge", ".mp3"), ("say", ".wav")):
            key = hashlib.sha1(f"{engine}:True:False:{text}".encode()).hexdigest()
            (cache / (key + suffix)).write_bytes(engine.encode())
        status, body, ctype = self.get("/api/tts?text=" + urllib.parse.quote(text) + "&slow=1&lang=ja")
        self.assertEqual(status, 200)
        self.assertIn((body, ctype), [(b"edge", "audio/mpeg"), (b"say", "audio/wav")])

    def test_build_assigns_block_ids(self):
        out = self.cli("build")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn('data-cid="', (self.root / "topics" / "first.html").read_text())


class NotesTest(Fixture):
    def note(self, **body):
        status, note = self.post("/api/notes", body)
        self.assertEqual(status, 200, note)
        return note

    def test_note_fields_and_file_format(self):
        n = self.note(block="first/b2", topic="first", type="comment", text="  Hej 日本 \"q\"\n", section="S" * 300, excerpt="E", context="C")
        self.assertEqual(list(n), ["id", "block", "text", "author", "created", "topic", "type", "status", "section", "excerpt", "context"])
        self.assertRegex(n["id"], r"^[0-9a-f]{12}$")
        self.assertRegex(n["created"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$")
        self.assertEqual((n["text"], n["author"], n["status"], len(n["section"])), ('Hej 日本 "q"', "you", None, 200))
        stored = self.assert_file_json(self.state / "notes.json")
        self.assertIn(n, stored["notes"])
        reply = self.note(block="ignored", text="again", parent=n["id"])
        self.assertEqual(list(reply), ["id", "block", "text", "author", "created", "topic", "parent", "type", "status"])
        self.assertEqual((reply["block"], reply["topic"], reply["type"], reply["status"]), ("first/b2", "first", "reply", None))
        q = self.note(block="second/b1", type="request", text="Fix")
        self.assertEqual((q["topic"], q["status"]), ("second", "pending"))
        self.assertEqual(self.note(block="x", text="more", parent=q["id"])["status"], "pending")

    def test_delete_removes_the_thread(self):
        root = self.note(block="second/b9", type="question", text="Delete me")
        self.note(block="second/b9", text="reply", parent=root["id"])
        keep = self.note(block="second/b9", type="question", text="Keep me")
        self.assertEqual(self.post("/api/delete", {"id": root["id"]}), (200, {}))
        notes = self.state_json()["notes"]
        self.assertFalse([n for n in notes if root["id"] in (n["id"], n.get("parent"))])
        self.assertTrue([n for n in notes if n["id"] == keep["id"]])
        self.assertEqual(self.post("/api/delete", {"id": "unknown"}), (200, {}))

    def test_markdown_export(self):
        q = self.note(block="third/b1", type="question", text="Why?", section="Part A", excerpt="")
        c = self.note(block="third/b2", type="comment", text="  Hello  ", section="Part B", excerpt="Some text.")
        r = self.note(block="third/b1", text="More", parent=q["id"])
        stamp = lambda n: n["created"][:16].replace("T", " ")
        expected = (
            "# Tredje æøå: notes\n\n"
            f"Lesson: http://127.0.0.1:{self.port}/t/third\n\n"
            "## Part A\n\n"
            f"**You, question** ({stamp(q)} UTC)\n\nWhy?\n\n"
            f"**You** ({stamp(r)} UTC)\n\nMore\n\n"
            "---\n\n"
            "## Part B\n\n"
            "> Some text.\n\n"
            f"**You, comment** ({stamp(c)} UTC)\n\nHello\n\n"
            "---\n"
        )
        md = self.state / "notes" / "third.md"
        self.assertEqual(md.read_text(), expected)
        (self.state / "notes" / "stale.md").write_text("old")
        self.post("/api/delete", {"id": q["id"]})
        self.post("/api/delete", {"id": c["id"]})
        self.assertFalse(md.exists())
        self.assertFalse((self.state / "notes" / "stale.md").exists())


class JournalTest(Fixture):
    def test_journal_round_trip(self):
        text = "<b>Mine</b> 日本\n"
        self.assertEqual(self.post("/api/journal", {"topic": "first", "text": text}), (200, {}))
        self.assertEqual((self.state / "journal" / "first.md").read_text(), text)
        state = self.state_json("first")
        self.assertEqual(state["journal"], text)
        self.assertNotIn("journal", self.state_json())
        _, body, _ = self.get("/t/first")
        self.assertIn('"journal": "\\u003cb>Mine\\u003c/b> 日本\\n"'.encode(), body)
        self.assertEqual(boot_of(body)["journal"], text)
        self.assertEqual(boot_of(self.get("/t/second")[1])["journal"], "")
        self.assertEqual(self.post("/api/journal", {"topic": "nope", "text": "x"}), (400, {"error": "unknown topic"}))
        self.assertEqual(self.post("/api/journal", {"text": "x"}), (400, {"error": "missing or unknown value: topic"}))


class ProgressTest(Fixture):
    def progress(self, **body):
        status, p = self.post("/api/progress", body)
        self.assertEqual(status, 200, p)
        return p

    def test_progress_kinds(self):
        p = self.progress(kind="visit", topic="first")
        self.assertEqual(list(p), ["xp", "visited", "quiz", "cards", "events"])
        self.assertEqual((p["xp"], list(p["visited"])), (0, ["first"]))
        first_visit = p["visited"]["first"]
        p = self.progress(kind="review", score=4)
        self.assertEqual(p["xp"], 12)
        p = self.progress(kind="review", score=-3)
        self.assertEqual(p["xp"], 12)
        p = self.progress(kind="quiz_answers", topic="third", answers=[1, None])
        self.assertEqual(p["quiz"]["third"], {"best": 0, "total": 0, "attempts": 0, "passed": False, "answers": [1, None], "checked": False})
        self.assertEqual(len(p["events"]), 3)
        p = self.progress(kind="quiz", topic="third", score="3", total=4.9, answers=[1, 2])
        q = p["quiz"]["third"]
        self.assertEqual(list(q), ["best", "total", "attempts", "passed", "answers", "checked", "last", "passed_at"])
        self.assertEqual((q["best"], q["total"], q["attempts"], q["passed"], q["checked"]), (3, 4, 1, True, True))
        self.assertEqual(p["xp"], 87)
        p = self.progress(kind="visit", topic="first")
        self.assertEqual(p["visited"]["first"], first_visit)
        self.assertEqual([e["kind"] for e in p["events"]], ["visit", "review", "review", "quiz", "visit"])
        self.assertEqual(list(p["events"][0]), ["at", "kind", "topic", "card", "xp"])
        self.assertEqual([e["xp"] for e in p["events"]], [0, 12, 0, 75, 0])
        p = self.progress(kind="card", card=7, correct=1)
        self.assertEqual(list(p["cards"]["7"]), ["box", "due", "first", "reviews"])
        self.assertEqual(p["events"][-1]["card"], 7)
        self.assertEqual(p["xp"], 89)
        p = self.progress(kind="card", card=7, correct=True)
        self.assertEqual((p["cards"]["7"]["box"], p["cards"]["7"]["reviews"], p["xp"]), (2, 2, 89))
        self.assertEqual(p["cards"]["7"]["due"], (datetime.date.today() + datetime.timedelta(days=2)).isoformat())
        stored = self.assert_file_json(self.state / "progress.json")
        self.assertEqual(stored, p)
        self.assertEqual(boot_of(self.get("/")[1])["progress"], p)


class CliTest(Fixture):
    def test_wait_reply_list(self):
        _, q = self.post("/api/notes", {"block": "first/b1", "type": "question", "text": "It's \"x\"\nnext 日本", "section": "Part", "excerpt": "Some", "context": ""})
        _, c = self.post("/api/notes", {"block": "second/b2", "type": "comment", "text": "Just a comment"})
        _, r = self.post("/api/notes", {"block": "first/b1", "text": "Follow up", "parent": q["id"]})
        env = {**os.environ, "TMUX": "/nonexistent/tutor-test-socket,1,0", "TMUX_PANE": "%99"}
        out = self.cli("wait", "--max-seconds", "30", "--settle", "0", env=env)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout, json.dumps(json.loads(out.stdout), indent=2, ensure_ascii=False) + "\n")
        views = json.loads(out.stdout)
        self.assertEqual(views, [{
            "reply_to": q["id"], "type": "question", "topic": "first",
            "file": str(self.root / "topics" / "first.html"),
            "journal": str(self.state.resolve() / "journal" / "first.md"),
            "section": "Part", "block": "first/b1", "context": "Some",
            "thread": [{"id": q["id"], "author": "you", "text": q["text"]}, {"id": r["id"], "author": "you", "text": "Follow up"}],
        }])
        self.assertEqual((self.state / ".wake-pane").read_text(), '{"pane": "%99", "socket": "/nonexistent/tutor-test-socket"}')
        self.assertTrue(self.state_json()["listening"])
        self.assertEqual(self.post("/api/wake", {}), (200, {"ok": True, "detail": "already listening"}))
        statuses = {n["id"]: n["status"] for n in self.state_json()["notes"]}
        self.assertEqual(statuses, {q["id"]: "working", c["id"]: None, r["id"]: "working"})

        out = self.cli("list", "--open")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout, (
            f"{q['id']}  {'question':<8} {'first':<30} {'Part':<30}  2 msgs  working\n"
            f"       you: {q['text'][:100]!r}\n"
            f"       you: 'Follow up'\n"
        ))
        out = self.cli("reply", q["id"][:5], "-", input="  The answer.\n\n")
        self.assertEqual((out.returncode, out.stdout), (0, "replied\n"), out.stderr)
        notes = self.state_json()["notes"]
        answer = notes[-1]
        self.assertEqual(list(answer), ["id", "block", "text", "author", "created", "topic", "parent", "type", "status"])
        self.assertEqual((answer["text"], answer["author"], answer["parent"], answer["status"]), ("The answer.", "claude", q["id"], None))
        self.assertEqual({n["id"]: n["status"] for n in notes if n["author"] == "you"}, {q["id"]: "answered", c["id"]: None, r["id"]: "answered"})
        self.assertEqual(self.cli("list", "--open").stdout, "")
        out = self.cli("list")
        self.assertEqual(out.stdout.splitlines()[0], f"{q['id']}  {'question':<8} {'first':<30} {'Part':<30}  3 msgs  answered")
        self.assertEqual(out.stdout.splitlines()[3], "    claude: 'The answer.'")
        self.assertEqual(out.stdout.splitlines()[4], f"{c['id']}  {'comment':<8} {'second':<30} {'':<30}  1 msgs  ")
        out = self.cli("reply", r["id"], "Second answer")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(self.state_json()["notes"][-1]["parent"], q["id"])

        out = self.cli("reply", "zzzz", "x")
        self.assertEqual(out.returncode, 1)
        self.assertIn("no note with id zzzz", out.stderr)

        started = time.time()
        out = self.cli("wait", "--max-seconds", "1")
        self.assertEqual(out.stdout, "timed out with nothing pending\n")
        self.assertLess(time.time() - started, 10)

    def test_wake_finds_the_pane_gone(self):
        if not shutil.which("tmux"):
            self.skipTest("no tmux")
        (self.state / ".wake-pane").write_text('{"pane": "%99", "socket": "/nonexistent/tutor-test-socket"}')
        hb = self.state / ".watcher-heartbeat"
        hb.touch()
        os.utime(hb, (time.time() - 60, time.time() - 60))
        self.assertFalse(self.state_json()["listening"])
        self.assertEqual(self.post("/api/wake", {}), (200, {"ok": False, "detail": "the Claude session that last listened is gone"}))

    def test_missing_curriculum(self):
        out = subprocess.run([*tutor_cmd(), "--root", str(self.state), "--state", str(self.state), "list"], cwd=REPO, capture_output=True, text=True)
        self.assertEqual(out.returncode, 1)
        self.assertIn(f"no curriculum.json in {self.state.resolve()}", out.stderr)


BUILD_INPUT = (
    "<h2>Intro</h2>\n"
    '<p class="lead">One</p>\n'
    "<pre><code>x &lt; y</code></pre>\n"
    '<div class="codewrap"><pre><code>y</code></pre></div>\n'
    '<li data-cid="b7">kept</li>\n'
    "<tr><td>t</td></tr>\n"
    '<div class="math">\\[x\\]</div>\n'
    '<figure class="fig"><img src="/files/f.svg" alt=""></figure>\n'
    "<p\nclass=x>multi</p>\n"
    '<path d="x"><param><h3>Sub</h3>\n'
    '<div class="callout"><p>Note</p></div>\n'
)
BUILD_OUTPUT = (
    '<h2 data-cid="b8">Intro</h2>\n'
    '<p data-cid="b9" class="lead">One</p>\n'
    "<pre><code>x &lt; y</code></pre>\n"
    '<div class="codewrap" data-cid="b10"><pre><code>y</code></pre></div>\n'
    '<li data-cid="b7">kept</li>\n'
    '<tr data-cid="b11"><td>t</td></tr>\n'
    '<div class="math" data-cid="b12">\\[x\\]</div>\n'
    '<figure data-cid="b13" class="fig"><img src="/files/f.svg" alt=""></figure>\n'
    '<p data-cid="b14"\nclass=x>multi</p>\n'
    '<path d="x"><param><h3 data-cid="b15">Sub</h3>\n'
    '<div class="callout"><p data-cid="b16">Note</p></div>\n'
)


class BuildTest(Fixture):
    @classmethod
    def prepare(cls):
        (cls.root / "topics" / "first.html").write_text(BUILD_INPUT)
        (cls.root / "quizzes" / "second.json").write_text('{"questions": [1,]}')
        (cls.root / "cards" / "third.json").unlink()

    def test_build_ids_are_stable(self):
        _, page, _ = self.get("/t/first")
        self.assertEqual(boot_of(page)["fragment"], BUILD_OUTPUT)
        self.assertEqual((self.root / "topics" / "first.html").read_text(), BUILD_INPUT)
        before = self.state_json()["version"]
        out = self.cli("build")
        self.assertEqual(out.returncode, 0, out.stderr)
        version = self.state_json()["version"]
        self.assertEqual(out.stdout, f"built version {version}\n  quizzes/second.json: Expecting value: line 1 column 18 (char 17)\n  missing cards/third.json\n")
        self.assertEqual((self.root / "topics" / "first.html").read_text(), BUILD_OUTPUT)
        self.assertEqual((self.root / "topics" / "second.html").read_text(), '<h2 data-cid="b1">Part</h2>\n<p data-cid="b2">Some text.</p>\n')
        self.assertNotEqual(before, version)
        self.assertEqual(self.cli("build").returncode, 0)
        self.assertEqual((self.root / "topics" / "first.html").read_text(), BUILD_OUTPUT)
        self.assertTrue((self.state / "notes").is_dir())


GLOSSARY_CURRICULUM = {**CURRICULUM, "config": {**CURRICULUM["config"], "glossary_files": ["glossary.json", "more.json", "absent.json"]}}


class VersionTest(Fixture):
    curriculum = GLOSSARY_CURRICULUM

    @classmethod
    def prepare(cls):
        (cls.root / "glossary.json").write_text(json.dumps({"terms": [{"term": "Alpha", "definition": "a"}, {"term": "alpha", "definition": "dup"}]}))
        (cls.root / "more.json").write_text(json.dumps({"terms": [{"term": "Beta", "definition": "b"}]}))
        (cls.root / "terms" / "first.json").write_text(json.dumps({"terms": [{"term": "BETA", "definition": "dup"}, {"term": "Gamma", "definition": "g", "topic": "x"}, "junk", {"term": ""}]}))
        (cls.root / "terms" / "second.json").write_text(json.dumps({"terms": [{"term": "gamma"}, {"term": "Delta"}]}))
        (cls.root / "terms" / ".hidden").write_text("hidden")
        (cls.root / "cards" / "sub").mkdir()
        (cls.root / "cards" / "sub" / "x.json").write_text("{}")
        (cls.root / "quizzes" / "notes.txt").write_text("extra")

    def expected_version(self):
        h = hashlib.sha1()
        paths = [APP, self.root / "curriculum.json"] + [self.root / n for n in GLOSSARY_CURRICULUM["config"]["glossary_files"]]
        for d in ("topics", "quizzes", "cards", "terms"):
            paths += sorted((self.root / d).iterdir())
        for p in paths:
            if p.is_file():
                h.update(p.name.encode())
                h.update(p.read_bytes())
        return h.hexdigest()[:12]

    def test_content_version(self):
        version = self.state_json()["version"]
        self.assertRegex(version, r"^[0-9a-f]{12}$")
        self.assertEqual(version, self.expected_version())
        self.assertEqual(boot_of(self.get("/")[1])["version"], version)
        (self.root / "quizzes" / "notes.txt").write_text("changed")
        self.assertEqual(self.state_json()["version"], self.expected_version())
        self.assertNotEqual(self.state_json()["version"], version)

    def test_glossary_merge(self):
        glossary = boot_of(self.get("/")[1])["glossary"]
        self.assertEqual(glossary, [
            {"term": "Alpha", "definition": "a"},
            {"term": "Beta", "definition": "b"},
            {"term": "Gamma", "definition": "g", "topic": "first"},
            {"term": "Delta", "topic": "second"},
        ])


if __name__ == "__main__":
    unittest.main()
