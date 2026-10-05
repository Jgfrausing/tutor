Write tutor curriculum content in {FOLDER}. First read {FOLDER}/AUDIENCE.md, {FOLDER}/curriculum.json and {TUTOR}/FORMAT_SPEC.md, and follow them exactly.

Your nodes, in this order: {NODE_IDS}.

For each node write four files: topics/<id>.html, quizzes/<id>.json, cards/<id>.json and terms/<id>.json. Finish one node completely before starting the next.

Other agents write the other nodes at the same time. Your glossary terms come only from these categories: {TERM_AREA}. The other groups own: {OTHER_TERM_AREAS}. A term that fits your topic but sits in another group's category is theirs; mention it in the lesson without defining it in your terms files. Define each term once across your files. Give a term no alias that is a common English word on its own ("flat", "lean", "tone"): the glossary underlines every match, so such an alias marks ordinary sentences.

Quiz choices: all four similar in length (within about 1.3x) and in detail. Make wrong choices specific and plausible, and keep the right one to its point, so the longest choice is right in no more than about a quarter of your questions. The page shuffles choice order, so position does not matter, but length does.

Each lesson uses exactly the h2 headings AUDIENCE.md sets for its kind, in that order. Check this before you move to the next node.

Accuracy comes first. Do not invent facts, citations, numbers, prices or opening hours. When you are not sure, say less, and list the claim in your report. Link to other nodes with /t/<id> only for ids that exist in curriculum.json.

When all your nodes are written, run from {FOLDER}:

  for f in quizzes/*.json cards/*.json terms/*.json; do python3 -m json.tool "$f" >/dev/null || echo "BAD $f"; done
  grep -n '[—–]' topics/* quizzes/* cards/* terms/*

Fix every hit in your own files. Do not run build, do not start a server, and do not edit files that belong to other nodes.

Report in a short list: the files you wrote, with word count (`sed 's/<[^>]*>//g' topics/<id>.html | wc -w`), question count, card count and term count per node, every claim you were unsure of, with its file, and every term you used in a lesson but left undefined because it belongs to another group's category.
