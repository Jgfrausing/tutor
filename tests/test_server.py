import datetime
import http.server
import json
import pathlib
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
import server

CURRICULUM = {
    "title": "Test tree",
    "config": {"pass_mark": 0.7, "xp_per_level": 100, "kinds": {"concept": {"label": "Concept", "xp": 100, "color": "accent"}}, "ranks": ["One", "Two"], "badges": [], "glossary_files": []},
    "nodes": [
        {"id": "first", "title": "First", "kind": "concept", "prereqs": [], "summary": "The first node."},
        {"id": "second", "title": "Second", "kind": "concept", "prereqs": ["first"], "summary": "The second node."},
    ],
}


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        base = pathlib.Path(cls.tmp.name)
        cls.root, cls.state = base / "curriculum", base / "state"
        for d in ("topics", "quizzes", "cards", "terms", "figures"):
            (cls.root / d).mkdir(parents=True)
        (cls.root / "curriculum.json").write_text(json.dumps(CURRICULUM))
        for n in CURRICULUM["nodes"]:
            (cls.root / "topics" / f"{n['id']}.html").write_text("<h2>Part</h2>\n<p>Some text.</p>\n")
            (cls.root / "quizzes" / f"{n['id']}.json").write_text(json.dumps({"questions": [{"q": "Q?", "choices": ["a", "b", "c", "d"], "answer": 2, "explain": "c."}]}))
            (cls.root / "cards" / f"{n['id']}.json").write_text(json.dumps({"cards": [{"id": f"{n['id']}-1", "front": "F", "back": "B"}]}))
            (cls.root / "terms" / f"{n['id']}.json").write_text(json.dumps({"terms": []}))
        (cls.root / "figures" / "pic.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
        server.configure(str(cls.root), 0, str(cls.state))
        cls.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
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

    def test_pages(self):
        self.assertEqual(self.get("/")[0], 200)
        status, body, ctype = self.get("/t/first")
        self.assertEqual(status, 200)
        self.assertIn("text/html", ctype)
        self.assertIn(b"Some text.", body)
        self.assertEqual(self.get("/t/missing")[0], 404)

    def test_files_and_traversal(self):
        status, _, ctype = self.get("/files/figures/pic.svg")
        self.assertEqual(status, 200)
        self.assertIn("svg", ctype)
        for path in ("/files/../curriculum.json", "/files/%2e%2e/%2e%2e/etc/passwd", "/files/figures/../../state/progress.json"):
            self.assertEqual(self.get(path)[0], 404, path)

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
        self.assertEqual(self.post("/api/progress", b"not json")[0], 400)
        status, r = self.post("/api/progress", {"kind": "quiz", "topic": "nope", "score": 1, "total": 1})
        self.assertEqual(status, 400)
        self.assertEqual(r["error"], "missing or unknown value: nope")
        self.assertEqual(self.post("/api/progress", {"kind": "zzz"})[0], 400)
        self.assertEqual(self.post("/api/notes", {"block": "first/b1"})[0], 400)
        self.assertEqual(self.get("/")[0], 200)

    def test_note_is_stored_as_pending(self):
        status, _ = self.post("/api/notes", {"block": "first/b1", "topic": "first", "type": "question", "text": "<b>Why?</b>"})
        self.assertEqual(status, 200)
        _, body, _ = self.get("/api/state")
        notes = json.loads(body)["notes"]
        mine = [n for n in notes if n["text"] == "<b>Why?</b>"]
        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]["status"], "pending")

    def test_wake_without_a_recorded_pane_does_nothing(self):
        status, r = self.post("/api/wake", {})
        self.assertEqual(status, 200)
        self.assertFalse(r["ok"])
        self.assertIn("no Claude session", r["detail"])

    def test_build_assigns_block_ids(self):
        out = subprocess.run([sys.executable, str(REPO / "server.py"), "--root", str(self.root), "--state", str(self.state), "build"], capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn('data-cid="', (self.root / "topics" / "first.html").read_text())


if __name__ == "__main__":
    unittest.main()
