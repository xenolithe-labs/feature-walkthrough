---
name: walkthrough-design
description: Decide what a stepped, multi-view walkthrough should show, and how, before any config is written, and review a finished one. Load this first for any new walkthrough or step-by-step diagram, before the syntax skill. Covers the reader and goal, what to leave out, which two or three views carry the story, how to cut a flow into steps and calls, what each call says, how to make change visible, example values, accessibility, accuracy and testing on a reader. Not for config syntax, JSON, panel shapes or lint errors; use feature-walkthrough for those.
---

# walkthrough-design

How to decide what a stepped, multi-view explanation contains, so a reader finishes able to do or explain something specific. The design is made on paper (or in a text file); mechanics, including recording a real run, are in the `feature-walkthrough` skill. Use this skill twice: before writing anything, and again on a draft (the checklist at the end).

Where these rules come from, and how strong the evidence is, is in [`sources.md`](sources.md); what three trials on real walkthroughs changed is in [`review.md`](review.md). Most of the research is from short lab lessons, so treat every rule as a hypothesis and let your reader test (section 9) overrule it.

**Terms.** A _call_ is one thing that happens (a message sent, a value changed, a decision taken); the reader steps through calls one at a time. A _step_ is a named group of calls. A _view_ is one picture of the subject (a sequence of messages, a graph that builds up, a table of values, and so on).

## The procedure

Produce these in order and keep them in one design record (a text file in your working notes; it need not ship) so a reviewer can check them.

1. **Reader record**: four lines (section 1).
2. **Scenario and data table**: one concrete run and its values (sections 2, 7).
3. **Cut list**: what is in, what is out, and why (section 2).
4. **Views**: two or three, each with the one question it answers (section 3).
5. **Storyboard**: one card per call, with name, text and a sketch of each view's state (sections 4 to 6).
6. **Fact check** with pointers (section 8).
7. **Reader test**, then revise (section 9).

If the tool cannot show something the design calls for (a key, a note, a kind of mark), put it in a call's text or drop it, and write the gap in the record. If you cannot ask the requester about the reader, write your best guess and mark each line "assumed".

## 1. Reader and outcome

1. **Reader:** who, in one line ("a backend developer who has used OAuth but never read the spec").
2. **Knows / does not know:** the terms they know and the terms they do not. Define each unknown term once, in the call that first needs it, or cut it. Use the intro for a definition only if several steps depend on it and the reader is sure to see the intro. If many terms are unknown, the outcome is probably two outcomes: split the walkthrough.
3. **Afterwards they can:** one observable ability, with a verb you could test: predict, explain to someone else, spot the bug, choose between A and B. "Understand" is not a test.
4. **Test question:** the question that checks line 3, with its written answer. The walkthrough exists to make the reader able to give that answer. Write the answer before anything else: it decides the data, the cut and the views.

Bad: "Explain how database transactions work." Good: "A developer can say which of two transfers waits, why, and what the waiting one sees when it resumes."

Write for one reader. Novices need more calls, defined terms and a stated purpose per step; the same scaffolding slows experts. If the subject is a fixed structure with nothing that changes (a lookup table, a comparison of options), do not use a walkthrough; use one annotated static diagram or a table.

## 2. Scenario and cut

1. **One concrete run: the one that carries the test question.** Usually that is the success case. If the question is about a failure or an absence (a deadlock, a refused request, a value that is not found), it is that run.
2. **List the nouns** (actors, stores, messages, values) **and the events** that happen to them.
3. **Cut.** Keep an item only if removing it would change the answer to the test question, or remove a fact that a kept call refers to. Everything else goes, however true or interesting.
4. **Say what you cut** in one line where the reader will see it ("Omitted: retries, TLS, token expiry"). What remains must not become false.
5. **Size the example:** the smallest instance that contains every phenomenon the written answer names, and no smaller. If the answer says "a cell reached twice is computed once", the example needs a cell reached twice.
6. If the reader must track more than about five actors or things at once, group them (show a service as one box now, open it later) or split the outcome. This does not apply when the things are the subject itself and are all alike (the cells of a sheet, the items of a list).

## 3. Views

Choose two or three views. A fourth needs a reason you can state in one sentence.

| The reader must see...                                     | Use a view of                           |
| ---------------------------------------------------------- | --------------------------------------- |
| who talks to whom, and in what order                       | a sequence of messages                  |
| things being created and linked                            | a graph that builds up                  |
| a decision and which way it went                           | a flow chart                            |
| values changing, row by row                                | a table                                 |
| exactly what a message or stored object contains           | a payload shown field by field          |
| which lines of code run                                    | code, beside the state the lines change |
| positions moving over a row of items (search, sort, queue) | a row of cells with pointers and ranges |
| containment (module in module, frame in frame)             | nested boxes                            |
| the shape of the data, as opposed to its rows              | a schema                                |
| how long things take, what times out                       | a timeline                              |
| events queued, consumed, retried                           | an event bus or queue view              |

- **Each view answers a different question** ("who is talking?", "what does the store hold now?"). Name the question per view. If two views answer the same one, drop one.
- **Pair what happens with what it changes, when the subject has both.** Most subjects need one view of the events (messages, code lines, a decision path) and one of the state they change (a table, a graph, a row of cells). If the subject has no messages or code (a recalculation, a layout pass), two views of the state are enough and the list of calls is the events view: do not add a flow chart only to have one.
- **For a protocol, what the messages change is usually who knows what:** a table with a row per value and a column per actor. A cell that stays empty is state too; mark it when a call relies on the absence (the attacker has no verifier).
- **A third view** is for something the first two cannot hold (exact bytes, or a second kind of state such as who has run as against what is stored), and only if all three can be seen at once, without scrolling, on an ordinary laptop screen in the layout readers get by default: build it and look. If they cannot, fold the third view's few items into the state view as rows, or move its content to the text.
- **A view is wrong when:** it never changes across the whole walkthrough; it holds one or two elements (put them in the call text); the reader must scroll or zoom to read it; the reader must work out which row matches which node.
- **Same thing, same name, same value** in every view that shows it. Draw what the idea needs and no more.

## 4. Steps and calls

**A call is one idea.** Say what happens in one sentence with a single verb. Split when the sentence needs "and then", or when the reader could plausibly be wrong about the order. Do **not** split an atomic event with several consequences (a transfer that debits and credits, a commit that changes two things): splitting shows a state that never existed. Each message in a sequence is its own call.

**In code, a call is one idea, not one line.** A guard that passes belongs with the statement it guards; the same guard failing is its own call. Two tests of one value are one comparison. Lay out the shown source so the lines a call is about are next to each other.

**A step is a phase the reader can name.** Typically 3 to 7 steps of 1 to 5 calls; when the calls do not fit, keep the phases the reader would name and let a step run longer. Name it with a noun or short phrase in the reader's words ("Exchange the code", not "Phase 3"). Put a boundary where the reader's question changes, where control passes to another actor, or where a stable state is reached. Give a step a one-sentence purpose. A recap of where things stand belongs in the step's last call, not in text the reader sees when the step begins.

**Opening.** Start with the first real call, preceded by a sentence of context, or with a named opening call. If the run starts from state that already exists (a sheet, a table, a cluster), show that state from the first call and mark only the part each opening call talks about. Build a view up only when the things are created during the run. Never trade a still layout for a late entrance.

**Closing.** End on the last real event, with a final state that lets the reader read the answer off the views (what changed, what was left alone), and say once why the mechanism matters. The closing is that event's call, not an extra one; if the last event has no content of its own (an implicit return), a short recap call may stand in for it.

**A call that changes nothing** (a check that declines, a wait) is still a call when the reader needs to see it happen; say what was looked at and what the outcome was.

**Merge or split?** Merge consecutive calls that change the same thing in the same way with no decision between them. Do not merge calls that carry the idea to save clicks: reader-paced steps are what helps.

**Loops.** If iterations are alike (retry, polling), show the first, the second (what carries over), and the one that differs (the last, or the one where something breaks), and state how many were skipped: "failures 3 to 5 double again: 4, 8 and 16 seconds". If each iteration changes different state (a sort, a graph search), do not skip: group iterations into steps and show all. Under four iterations, show all.

**Recursion.** Size the example so the deepest path is about three calls. Show a call that returns at once as one call, at the line that makes it. Give the return of a call that did work its own call, because the reader must see the caller resume. Show waiting calls where the reader can see them at every call: as marks on the state they own (a bracket over their cells) before a separate stack view. A variable that each invocation holds separately must be in a view, or restated when control returns.

**Branches and errors.** Walk the run that carries the test question uninterrupted (section 2); it may be the failing one. Mark the divergence in the text ("here the server can refuse"). Choose the other path's data so it shares as much as possible, and put it in a later step that starts where the two part, on the same views and values. Before fixing the order, check the later path is still true after the earlier one in views that accumulate: if one path uses something up (a single-use code, a consumed message), show first the path that leaves the shared state as it was, and present the two as alternatives. Make a second walkthrough only when the paths share little; then say in its intro which calls repeat the first. Do not interleave two paths in one run of calls.

**Any order the system does not fix** (concurrent work, an unordered set, a scheduler's choice). Choose one valid order, say it is one of several, and say why you chose it (usually: it exposes the problem).

## 5. What each call says

Each call has a name and a text.

- **Name = what happens**, in a short verb phrase with the real command, message or value where it fits (`POST /token`, "Mark A3 dirty").
- **Text = what changed, why, and what to notice.** State the change with names and values. Give the old value as well as the new one when the old value meant something ("balance 40 becomes 25"), since after the call it is gone from the view; skip it for a value that is simply recomputed.
- **Length.** Use as few words as state the change. A call that changes one thing and defines nothing needs under 12 words ("46 stays in cell 2."). A call that defines a term or gives the reason for the whole mechanism may reach about 40 words in three sentences; expect three or four of those in a walkthrough, not most. That is the ceiling, not the size to aim for (a colon or semicolon that joins two statements counts as a sentence break). If most of your calls are near the ceiling, the calls are carrying two ideas or the views are not carrying the values: fix that instead of trimming. When not everything fits, keep the change and its values first, then why, and drop the rest. A prediction question (section 6) does not count toward the limit. A step's own text is read on every call of the step: keep it under 15 words.
- **Stand alone.** A reader who jumps to any call should be able to follow it. So the text names things by their own names or values ("the row for order 17"), not by position, colour, "this" or "above". Do not narrate the layout ("an arrow goes from the client to the server").
- **One new term per call,** in the reader's words. No forward references ("as we will see").
- **Mark identifiers as code** where the tool allows it, so `like` the function is not read as the word.
- **Support claims** with a pointer: spec section, file and line, or the command that produced the value.

## 6. Making change visible

- **Highlight everything the call changes, and nothing else.** If everything is marked, nothing is.
- **Distinguish kinds of touch:** something appears, changes, disappears, is relied on without changing, or is refused. "Relied on" is often the insight (the cache is read, the key is compared), so mark it.
- **Keep the state the reader needs visible.** If call 9 depends on something set in call 2, a view holding it must be on screen at call 9, and the call should mark it as relied on. A call touches every view whose state it depends on, and no view it does not.
- **Keep layout still** between calls, so a change is the only thing that moved.
- **Ask for a prediction** at a decision point ("Which side will the search keep?"), as the last sentence of the call before it, set apart from the narration, and answer it in the next call.
- **Never colour alone.** Every meaning carried by colour is also carried by text, a mark or a position, and explained in a key the reader can see. Keep to three or four colour meanings, used the same way throughout. Do not depend on hover or motion for meaning.

## 7. Values, names, labels

- **Choose the data first,** as one table of entities and values, and use the same entities from first call to last.
- **Make values tell things apart:** 14 and 9, not 10 and 10; values that cannot be mistaken for positions. Pick values that make the edge case visible when you reach it.
- **Realistic, not real people.** Plausible names, ids and timestamps; reserved example domains; no real secrets or customers. Prefer real output when it exists (an actual hash, a recorded run).
- **One name per thing,** from the reader's domain. Each view's title says what it shows ("Orders table", not "State").
- **Label a relation with what it carries** ("POST /token with code and verifier"), not "uses". If every arrow in a view means the same thing, say what it means once and leave the arrows bare.

## 8. Accuracy

- **Check every fact** against a primary source (spec, documentation, code, a real run) and put the pointer in the call. This is the rule that has paid most in practice: in two of three trials it found a stage the earlier version showed that the cited documentation does not describe. A clear and wrong walkthrough does harm.
- **Run what can be run.** For code, record a real run rather than hand-tracing it, and check the final state equals the real result (the syntax skill explains how).
- **When sources disagree or you are unsure,** cut the claim or say so in the text ("after a click this may come before the paint"). Never present an invented number as a measurement; label illustrative values as illustrative.
- **Simplify honestly.** A simplification may omit things; it may not be false. When engines or versions differ, pick one, and name it and the date you checked where the reader will see it.

## 9. Test it

1. **Two rounds.** Test the storyboard first, because changes are cheap there; test again on the built walkthrough, because views change what the text needs to say.
2. **Test on three to five people from the intended audience.** Ask the test question before and after. Watch them step through while thinking aloud; do not explain or hint. Note where they stall, go back, misread or say "wait". Revise, then test on new readers.
3. **If no reader is available, run a cold read of the texts.** Give another person or a fresh agent: the intro; the step names and step texts; the call names and texts, in order; the list of terms the reader record says the reader knows; and one line on what the views show before the first call (the names in the code, the starting values). Withhold everything else. Ask it to (a) list every state change the text does not state, (b) list every sentence it had to read twice, (c) list every term it could not derive. Only then give it the test question and ask for the answer. Act on (a) and (b) first; they find the most. This tests only the text, and a model's prior knowledge hides gaps, so report it as the weaker test.
4. **Expect the cold read to push text longer.** Sort each "unstated change" before acting: if a view shows it, mark it there and add no words; if no view shows it but one could (a variable, a waiting call), add it to a view; only if neither, add words, and then cut as many elsewhere in that card. If it is on the cut list, or would not change the written answer, add nothing; if both rounds ask for it, name it in the omitted line. Expect the next cold reader to list again what you left to a view: do not add it back. Count the mean words per card before and after each round, and report both.

## Worked examples

**A. A login session (messages).**
_Weak:_ "show how login works". Five views; 22 calls including TLS, DNS and password reset; the browser table calls a value "cookie" and the server table calls the same value "token".
_Better:_ reader is a front-end developer; outcome "can say why the session id is replaced at login and what an attacker with the old id can do". Two views: a sequence of messages (browser, server, attacker) and a table of server sessions. Ten calls in four steps: visit, log in, use the site, replay the old id. The ids are distinct (`s_7f3a`, `s_c91d`) and named identically in both views. At login the old row disappears and a new one appears, and the text gives both ids. The replay is a later step on the same table, and ends in a refusal. (Had the old id been usable only once, the refused run would have to come first: see Branches.)

**B. Binary search (code and a loop).**
_Weak:_ one call per line of code, each with the same generic sentence; ten cells whose values could be mistaken for positions; a third view of variables below the fold.
_Better:_ outcome "can predict which cells are read and say how the search knows a value is absent". Two views: the code, and six cells `12, 19, 23, 31, 46, 58` with pointers for the low end, the high end and the middle. Look for 31: the middle is 23, too small, and the low end moves from 0 to 3; the next middle is 46, too big, and the high end moves from 5 to 3; the middle is 31, found. Three calls a round (find the middle, compare, move), each stating the values. The absent case looks for 40, which shares the first two rounds, so it is a later step that starts at the third read.

## Review checklist

Run it on the draft and the design record. Answer yes or no. Any "no" is a finding, except items marked (n/a if none).

**Purpose**

1. Is the design record complete: the reader and what they know, an outcome with a verb you could test, the test question with its written answer, and a question for each view?
2. Can the answer be read from the final state and the final call's text?
3. Does the reader see at least one thing that was left out, and the version or date described?
4. Is each term the reader does not know defined once, before or at its first use?

**Views**

5. Are there two or three views, all visible at once in the default layout on a laptop screen?
6. Does every view change or get relied on in at least one call?
7. At every call, does each item shown in two views have the same name and the same value in both?
8. Is every colour, shape or mark that carries meaning explained where the reader can see it, and also carried by text, a mark or a position?

**Flow**

9. Is existing state shown from the first call, with only what each opening call discusses marked?
10. Can each call be said in one sentence with one verb, without splitting an atomic event?
11. Does each call touch every view whose state it depends on?
12. Does each step name use only words the reader knows or that the step's first call defines?
13. Are alike loop iterations cut to first, second and the different one, with the skipped count stated; and are unlike iterations all shown? (n/a if no loops)
14. Is each alternative or error path after the main path, starting where they part, with the divergence marked? (n/a if none)

**Text**

15. Does each call name say what happens, using the real command, message or value where short enough?
16. Is every call's text within about 40 words and three sentences, with no more than a handful near that ceiling, and is each step's own text under 15 words?
17. Does each sentence say what changed, why, or what to notice, rather than where something is on screen?
18. When a value that mattered changes, does the text give the old and the new one?

**Values and facts**

19. Do values that must be told apart differ, and can no value be mistaken for a position?
20. Do five claims you choose at random each have a pointer to a primary source, or an "assumed" mark?
21. Does code come from a real run, and is every computed value (a hash, a signature, a total) checked by a test?

**Before you ship**

22. Has someone from the intended audience gone through it while thinking aloud? If not, has a cold read been done and reported as the weaker test?
23. Could they, or the cold reader, answer the test question afterwards?
