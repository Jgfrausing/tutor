---
name: new-curriculum
description: >-
  Create a complete tutor curriculum on any subject: interview the user, design
  the skill tree, write curriculum.json, AUDIENCE.md and README.md, then have
  writer agents produce every lesson, quiz, flip card and glossary file in
  parallel, and validate it with the tutor build. Use when the user says "make a
  new curriculum", "create a study tree on X", "new tutor course on X", "I want
  to learn X with the tutor", or asks for a skill tree or course for the tutor
  platform.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion
---

# new-curriculum

A tutor curriculum is a folder that `server.py` serves: `curriculum.json`, `AUDIENCE.md`, and per node `topics/<id>.html`, `quizzes/<id>.json`, `cards/<id>.json` and `terms/<id>.json`. `FORMAT_SPEC.md` in the tutor repo is the contract for every one of those files. Read it before anything else.

The tutor repo is two directories above this skill's real path (`skills/new-curriculum/` inside the repo). Resolve symlinks to find it, and call it `TUTOR` below. `TUTOR/server.py` and `TUTOR/FORMAT_SPEC.md` must exist; stop and say so if they do not.

This skill writes the whole curriculum in one run. It never starts a server.

## 1. Interview

Ask everything in one AskUserQuestion call, and skip any question the request already answers:

- Subject and goal: what the reader should be able to do at the end.
- Reader: who they are, what they already know, what they are uncomfortable with.
- Size: small (6 to 8 nodes), medium (12 to 16), large (20 or more).
- Special material, multi-select: a spoken language, maps or figures, math, code, papers to read.
- Folder: default `~/notes/<slug>` for the curriculum and `~/notes/study-state/<slug>` for the state. Refuse a folder that already holds a `curriculum.json` unless the user says to overwrite it.

## 2. Design the tree

- 3 to 6 kinds. Each has `label`, `xp` (50 for an intro, 75 to 150 for normal nodes, 250 to 400 for a capstone) and `color` from the palette tokens FORMAT_SPEC lists. Use `side_quest` with `attached_to` only for optional detours. Give the intro kind `legend: false`.
- Nodes: one intro with no prereqs, branches that fan out from it, and a capstone whose prereqs are the last node of each branch. Every summary is one sentence. Ids are lowercase kebab-case. Prefix them by branch when a branch has two or more nodes (`phrases-greetings`, `place-asakusa`). A single-node branch, the intro and the capstone get a plain id with no prefix (`danish-manners`, `how-danish-sounds`, `a-day-in-copenhagen`).
- 6 to 10 ranks that fit the subject, and 5 or 6 badges using only the rule types FORMAT_SPEC lists.
- `config` values: `pass_mark: 0.7`. Set `xp_per_level` to the total node XP divided by the number of ranks, rounded down to a multiple of 25, so the last rank is reachable. `glossary_files: []` (every term comes from the per-node terms files). Add `case_sensitive_terms` only for terms that are also common English words in another case. `journal_prompt`: "Write study notes into {journal}. Keep what I already wrote."

Show the outline before writing any file: the kinds, then each branch as a list of node titles with summaries, then the capstone. Ask for the user's OK, and apply their changes until they approve.

## 3. Write the skeleton

1. `curriculum.json` in the FORMAT_SPEC shape. Check it with `python3 -m json.tool`.
2. `AUDIENCE.md` with these sections:
   - Reader.
   - Markup, only for the special material that was chosen (see "Special material" below).
   - House style: no em or en dashes, sentence case headings, no emoji, straight quotes, no bold-label lists, no filler or sales words, active voice. Add the user's own writing rules when an AGENTS.md or CLAUDE.md with writing rules is loaded.
   - Accuracy: never invent facts, citations, numbers, prices or opening hours. When unsure, say less and list the claim in the report.
   - Length per kind, in words.
   - Sections per kind: the `h2` headings each kind's lesson has, in order.
   - Counts: 6 to 8 quiz questions, 8 to 14 cards and 3 to 8 terms per node.
   - Glossary categories: 3 to 6 named categories. Writer groups own terms by category (step 4), so pick categories that split cleanly.
3. `README.md` for the curriculum: one paragraph on what it covers, the `serve` command with this folder's `--root` and `--state` and a free port (8765 plus the number of curricula already in the tutor README's "Installed curricula" table, or check with `lsof -i :<port>`), and the `wait` command for answering questions. `~/notes/market-simulation/README.md` is a good model when it exists.
4. Create the empty `topics/`, `quizzes/`, `cards/` and `terms/` folders, plus `figures/` when figures were chosen, and the state folder.

## 4. Fan out to writer agents

Split the nodes except the capstone into 2 to 4 groups, one per branch or pair of small branches. The intro goes to the first group. Give each group whole glossary categories from AUDIENCE.md to own, and name them in its prompt, so no term can be defined twice. A term that could fit two groups belongs to the category it is listed under, never to a topic.

Fill in `agent-prompt.md` (next to this file) once per group and launch every group in one message with the Agent tool, `subagent_type: general-purpose`, `run_in_background: true`. Do not touch their files while they run, and wait for every group's completion notification before going on.

Then write the capstone as a second wave: one agent with the same prompt, the capstone id, every remaining category it needs, and this extra line: "Read the finished lessons of every prereq node first, and only repeat facts, phrases and spellings they use." 

## 5. Integrate and validate

When every agent has reported, run these from the curriculum folder and fix every hit, editing the files yourself:

```sh
for f in quizzes/*.json cards/*.json terms/*.json; do python3 -m json.tool "$f" >/dev/null || echo "BAD $f"; done
grep -n '[—–]' topics/* quizzes/* cards/* terms/* AUDIENCE.md README.md
python3 -c "import json,glob,collections; c=collections.Counter(t['term'].lower() for f in glob.glob('terms/*.json') for t in json.load(open(f))['terms']); print([t for t,n in c.items() if n>1])"
python3 -c "import json,os; [print('MISSING', d, n['id']) for n in json.load(open('curriculum.json'))['nodes'] for d,e in [('topics','html'),('quizzes','json'),('cards','json'),('terms','json')] if not os.path.exists(f'{d}/{n[\"id\"]}.{e}')]"
python3 -c "import json,glob; r=t=0
for f in glob.glob('quizzes/*.json'):
  for q in json.load(open(f))['questions']: t+=1; r+=max(range(len(q['choices'])),key=lambda i:len(q['choices'][i]))==q['answer']
print('longest choice is right in',r,'of',t)"
python3 "$TUTOR/server.py" --root . --state <state folder> build
```

If the longest choice is right in more than about 30% of questions, a reader can pass by picking the longest. Rewrite those questions' choices to even out length and detail before going on.

Collect the terms each writer reported as "left to another category" and check that each one is defined in some terms file. Add any that are missing to the terms file of the node that teaches them most, in the right category.

`build` assigns block ids and lists problems; run it again until it lists none. Always pass `--state`: without it, `server.py` creates a stray state folder under `~/.tutor`.

For a spoken language other than Japanese, collect every `<em lang="..">word</em> (RESPELLING, ...)` pair across the lessons and cards, and make each word use one respelling everywhere:

```sh
grep -rhoE '<em lang="[a-z]+">[^<]+</em> \([^,)]+' topics | sort | uniq
```

Two lines with the same word and different respellings need one of them fixed, in the lessons and in the cards.

When figures were chosen, generate them from one script in `figures/` (SVG, with `prefers-color-scheme: dark` styles inside the SVG) and look at each one as a headless Chrome screenshot of the SVG file itself:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --window-size=900,900 --screenshot=<scratch>/fig.png "file://$PWD/figures/<name>.svg"
```

Insert them with the `<figure class="fig">` markup from FORMAT_SPEC and run `build` again.

## 6. Report

Tell the user:
- the folder and the node count per kind;
- every claim an agent or you flagged as uncertain, with the file it is in;
- the command to run, which you do not run yourself:

```sh
python3 <TUTOR>/server.py --root <folder> --state <state folder> --port <free port> serve
```

## Special material

- Spoken Japanese: every word or phrase the reader might say is `<span class="say" lang="ja" data-romaji="..." data-en="...">日本語</span>`, and phrase cards carry a `"say"` field. The page adds play, slow play and mic buttons.
- Any other spoken language: `/api/tts` and the mic are fixed to Japanese today, so use no say spans. Write each phrase as `<em lang="da">tak</em> (TAHK, "thanks")`: the word in its own spelling, then an English-reader respelling with the stressed syllable in capitals (no IPA), then a short gloss. Phrase tables have three columns: phrase with respelling, meaning, when to use it. Tell the user that audio is not available for that language yet.
- Maps and figures: draw them from coordinates or data in a script, never by guessing positions. Say "approximate" in the caption when the data is from memory.
- Math: KaTeX with `\( \)` and `\[ \]` as FORMAT_SPEC describes. Each formula gets a sentence saying in words what it computes.
- Code: `div.codewrap` blocks. Code the agents show must have been run, or the text says it was not.
- Papers: a node can carry `paper` metadata. Writers check abstracts online when the PDF is not local, and never guess what a paper says.
