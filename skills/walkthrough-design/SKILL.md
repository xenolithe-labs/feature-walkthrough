---
name: walkthrough-design
description: Decide what a stepped, multi-view walkthrough should show, and how, before any config is written, and review a finished one. Load this first for any new walkthrough or step-by-step diagram, before the syntax skill. Covers the reader and goal, what to leave out, which two or three views carry the story, how to cut a flow into steps and calls, what each call says, how to make change visible, example values, accessibility, accuracy and testing on a reader. Not for config syntax, JSON, panel shapes or lint errors; use feature-walkthrough for those.
---

# walkthrough-design

How to decide what a stepped, multi-view explanation contains, so a reader finishes able to do or explain something specific. The design is made on paper (or in a text file); mechanics, including recording a real run, are in the `feature-walkthrough` skill. Use this skill twice: before writing anything, and again on a draft (the checklist at the end).

**Tags.** `[L2]` is a source id in [`sources.md`](sources.md), with its confidence. `[P]` is a working rule of thumb with no research behind it. An untagged rule is craft judgement, supported at most by general principles. Treat every rule as a hypothesis and let your reader test overrule it (section 10).

**Terms.** A _call_ is one thing that happens (a message sent, a value changed, a decision taken); the reader steps through calls one at a time. A _step_ is a named group of calls. A _view_ is one picture of the subject (a sequence of messages, a graph that builds up, a table of values, and so on). The _state so far_ is what the views show after all calls up to now.

## The procedure

Produce these artifacts in order and keep them in one design record (a text file in your working notes; it need not ship with the walkthrough) so a reviewer can check them.

1. **Reader record**: four lines (section 1).
2. **Scenario and data table**: one concrete run and its values (sections 2, 7).
3. **Cut list**: what is in, what is out, and why (section 2).
4. **Views**: two or three, each with the one question it answers (section 3).
5. **Storyboard**: one card per call, with name, text and a sketch of each view's state (sections 4 to 6).
6. **Fact check** with pointers (section 8).
7. **Reader test**, then revise (section 10).

If the tool cannot show something the design calls for (a key, a note, a kind of mark), put it in a call's text or drop it, and write the gap in the record. Do not bend the design around the tool without saying so.

If you cannot ask the requester for step 1, write your best guess, mark each line "assumed", and put the record where the requester will see it.

## 1. Reader and outcome

1. **Reader:** who, in one line ("a backend developer who has used OAuth but never read the spec").
2. **Knows / does not know:** the terms they know and the terms they do not. Define each unknown term once, or cut it. Where: in the call that first needs it; in the intro only if more than one step depends on it, and only if the reader is sure to see the intro (check the tool shows it in every layout). If many terms are unknown, the outcome is probably two outcomes: split the walkthrough.
3. **Afterwards they can:** one observable ability, with a verb you could test: predict, explain to someone else, spot the bug, choose between A and B. "Understand" is not a test.
4. **Test question:** the question that checks line 3, with its written answer. The walkthrough exists to make the reader able to give that answer.

Bad: "Explain how OAuth works." Good: "A developer can say why the verifier is sent only in the last request, and what an attacker holding the authorisation code still cannot do." [N4: an error about the task or reader cascades into every later decision]

Write for one reader. Novices need more calls, defined terms and a stated purpose per step; the same scaffolding slows experts. [L3] For both, write the novice path with step names an expert can skip to, or write two.

If the subject is a fixed structure with nothing that changes (a lookup table, a comparison of options), do not use a walkthrough; use one annotated static diagram or a table. A static diagram can teach as well as an animation when the idea is not change over time. [L2]

## 2. Scenario and cut

1. **One concrete run, the one that carries the test question.** For a protocol or algorithm that is a success case. For a problem subject (a deadlock, an attack, a failure) it is the failing run; if a working contrast helps, make it a short first step on the same data. Branches and loops come in section 4.
2. **List the nouns** (actors, stores, messages, values) **and the events** that happen to them.
3. **Cut.** Keep an item only if removing it would change the answer to the test question, or remove a fact that a kept call refers to. Everything else goes, however true or interesting. [L1 coherence, medium confidence in this setting]
4. **Say what you cut** in one line of the intro ("Omitted: retries, TLS, token expiry"). What remains must not become false.
5. If you must track more than about five actors or things at once, group them (show a service as one box now, open it later) or split the outcome. This does not apply when the things are the subject itself and are all alike (the cells of a sheet, the items of a list): keep them, and keep the instance small. [P]
6. **Size the example:** the smallest instance that contains every phenomenon the written answer names, and no smaller. If the answer says "a cell reached twice is computed once", the example needs a cell reached twice.

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

Rules:

- **Each view answers a different question** ("who is talking?", "what does the store hold now?"). Name the question per view. If two views answer the same one, drop one.
- **Pair what happens with what it changes, when the subject has both.** Most subjects need one view of the events (messages, code lines, a decision path) and one of the state they change (a table, a graph, an array). If the subject has no messages or code (a recalculation, a layout pass), two views of the state are enough and the list of calls is the events view: do not add a flow chart only to have one. Add a third view only for something the first two cannot hold (exact bytes, the exact line, or a second kind of state such as who has run as against what is stored), and only if all three can be seen at once, without scrolling, on an ordinary laptop screen in the layout readers get by default: build it and look. If they cannot, first try folding the third view's few items into the state view as rows; only then move its content to the text. [N3: concrete step plus whole-state view]
- **A view is wrong when:** it never changes across the whole walkthrough (make it static context or cut it); it holds one or two elements (put them in the call text); the reader must scroll or zoom to read it (split the subject); the reader must work out which row matches which node (give the thing one name and one value everywhere).
- **Same thing, same name, same value** in every view that shows it.
- **Schematic beats realistic.** Draw what the idea needs and no more. [L2]
- **Decoration:** omit by default. Evidence on decoration is mixed (it may aid memorability); accuracy, not memorability, is the goal. [G4]
- **Where an amount matters** (a size, a count), show it in a place where it can be compared by position or length (a cell, a bar), not by colour or area. [G1, medium]

## 4. Steps and calls

**A call is one idea.** Say what happens in one sentence with a single verb. Split when the sentence needs "and then", or when the reader could plausibly be wrong about the order. Do **not** split an atomic event with several consequences (a transfer that debits and credits, a rollback that releases locks and wakes a waiter): splitting shows a state that never existed. Split only when the consequences have different causes. Each message in a sequence is its own call.

**A step is a phase the reader can name.** Typically 3 to 7 steps of 1 to 5 calls. [P] Name it with a noun or short phrase in the reader's words ("Exchange the code", not "Phase 3"). Put a boundary where the reader's question changes, where control passes to another actor, or where a stable state is reached that the reader can take in before moving on. Give a step a one-sentence purpose and, if state changed, a closing sentence on where things stand. [N1: orientation, summaries] If the tool does not show a step's own text to the reader, the purpose belongs in the step's first call and the recap in its last; check before relying on it.

**Opening.** Start with the first real call, preceded by a sentence of context, or with a named opening call. If the run starts from state that already exists (a sheet, a table, a cluster), show that state from the first call and mark only the part each opening call talks about. Build a view up only when the things are created during the run. Never trade a still layout for a late entrance.

**Closing.** End on the last real event, with a final state that lets the reader read the answer off the views (what changed, what was left alone), and say once why the mechanism matters. The closing is that event's call, not an extra one.

**A call that changes nothing** (a check that declines, a wait) is still a call when the reader needs to see it happen; say what was looked at and what the outcome was.

**Merge or split?** Merge consecutive calls that change the same thing in the same way with no decision between them, unless each is a separate message or line of code that the reader must see on its own. Do not merge calls that carry the idea to save clicks: reader-paced steps are what helps. [L1 segmenting, L2]

**Loops.** If iterations are alike (retry, polling), show the first, the second (what carries over), and the one that differs (the last, or the one where something breaks), and state how many were skipped. If each iteration changes different state (quicksort, a graph search, a merge), do not skip: group iterations into steps and show all. Under four iterations, show all.

**Branches and errors.** Walk the main path uninterrupted. Mark the divergence in the text ("here the server can refuse"). Put each alternative path in its own later step, reusing the same views and values so the reader compares like with like. Do not interleave two paths in one run of calls. [L5, by analogy: interdependent steps make readers go back and forth] If two paths are equally long and important, make two walkthroughs.

**Any order the system does not fix** (concurrent work, an unordered set, a scheduler's choice). Choose one valid order, say it is one of several, and say why you chose it (usually: it exposes the problem).

**Size.** Decide the total from the reader's session, not from the subject: for example 15 to 25 calls for a five-minute read at about 15 seconds a call. [P] Over budget means cut (section 2), not squeeze.

## 5. What each call says

Each call has a name and a text.

- **Name = what happens**, in a short verb phrase with the real command, message or value where it fits (`POST /token`, "Mark A3 dirty"). If the real thing is long (an SQL statement), shorten it and keep its distinguishing part.
- **Text = what changed, why, and what to notice.** State the change with names and values, old and new ("balance 40 becomes 25": after the call the old value is gone from the view). Say what it means, not where it is on screen. Use as few words as state the change: many calls need under 20. About 40 words in three sentences is the ceiling, not the size to aim for; a colon or semicolon that joins two statements counts as a sentence break. If most of your calls are near the ceiling, the calls are carrying two ideas or the views are not carrying the values: fix that instead of trimming. When the demands below do not all fit, keep the change and its values first, then why, and drop the rest. A prediction question (section 6) does not count toward the limit. [P]
- **Stand alone.** A reader who jumps to any call should be able to follow it, given only the intro's definitions. So the text names things by their own names or values ("the row for order 17"), not by position, colour, "this" or "above". [W1, A3]
- **Do not narrate the layout** ("an arrow goes from the client to the server"). Exceptions to "tie text to something highlighted": a step's purpose and recap sentences, and a prediction prompt.
- **One new term per call,** defined in the call that first needs it (section 1 says when the intro is the better place), in the reader's words. No forward references ("as we will see"). [L6]
- **Words belong with what they describe:** keep each call's text with the call that highlights the thing, not in a distant note. [L1 contiguity; the studies placed words in or beside one graphic, so this is an extrapolation]
- **Later in a long walkthrough** you may leave routine moves unexplained so the reader predicts them [L3, L4: fading, strongest evidence is for maths and programming], but still state every change of value.
- **For a how-to** (the reader will do these things), write each call as one imperative action with the goal first ("To revoke the token, send...") [W1]. For an explanation, write what the system does.
- **Support claims** with a pointer: spec section, file and line, or the command that produced the value.

## 6. Making change visible

- **Highlight everything the call changes, and nothing else.** If everything is marked, nothing is. [L1 signaling: cues work best used sparingly]
- **Distinguish kinds of touch:** something appears, changes, disappears, is relied on without changing, or is refused or blocked. "Relied on" is often the insight (the cache is read, the key is compared), so mark it. This list is not exhaustive; if the viewer cannot show a kind, say it in the text.
- **Keep the state the reader needs visible.** If call 9 depends on something set in call 2, a view holding it must be on screen at call 9, and the call should mark it as relied on. So a call touches every view whose state it depends on, and no view it does not. [L6 recognition over recall]
- **Keep layout still** between calls, so a change is the only thing that moved. [L2]
- **Ask for a prediction** at a decision point ("What does the cursor hold after this?") in the previous call's text, and answer it in the next. Weak evidence: one reviewed study found watching algorithm animations helped no more than predicting from static graphics. [L2, indirect]
- **Colour only where the meaning is stable** and also carried by text or a mark (section 9).

## 7. Values, names, labels

- **Choose the data first,** as one table of entities and values, and use the same entities from first call to last.
- **Make values tell things apart:** 14 and 9, not 10 and 10. Pick values that make the edge case visible when you reach it.
- **Realistic, not real people.** Plausible names, ids and timestamps; reserved example domains; no real secrets or customers. Prefer real output when it exists (an actual hash, a recorded run). If real output uses names the reader does not know (pids, transaction ids), relabel with the reader's names and say once that you did.
- **One name per thing,** from the reader's domain. Abbreviations are defined at first use. Each view's title says what it shows ("Orders table", not "State").
- **Label every relation with what it carries** ("POST /token with code and verifier"), not "uses". Each arrow goes one way. If every arrow in a view means the same thing, say what it means once, in the first call that uses one, and leave the arrows bare. [D1]
- **Give a key** for any encoding that is not obvious (what the dashed line, the amber mark, the badge mean). [D1]
- **Allocation:** what changes goes in the highlight; why goes in the text; exact bytes go in a payload view; background goes in the intro.

## 8. Accuracy

- **Check every fact** against a primary source (spec, code, a real run) and put the pointer in the call. A clear and wrong walkthrough does harm.
- **Run what can be run.** For code, record a real run rather than hand-tracing it, and check the final state equals the real result (the syntax skill explains how).
- **When unsure,** cut the claim or say so in the text ("the spec leaves this open"). Never present an invented number as a measurement; label illustrative values as illustrative.
- **Simplify honestly.** A simplification may omit things; it may not be false. Mark it ("simplified: one retry"). When engines or versions differ, pick one, name it and its version.
- **Date it:** the version described and when you checked.

## 9. Load and accessibility

- **Introduce late:** a view, an actor or a term appears when the first call that needs it does. [L5]
- **Pre-teach** only the terms that several steps depend on, in the intro; define the rest where they are first needed (section 1). Evidence is good for novices and in fast-paced lessons, weaker when the learner controls the pace, which is the case here, and it can burden experts. [L1 pre-training, L3]
- **At most two levels of detail** (a call, and the detail behind it). [P; L5 says this of interface features]
- **Never colour alone.** Every meaning carried by colour is also carried by text, a mark or a position. Check by looking at it in greyscale. Keep to three or four colour meanings, used the same way throughout. [A1, A2]
- **The text path tells the whole story.** Read only the call texts, in order, to someone who cannot see the views: every change is stated and every term defined. [A3]
- **Order is story order** wherever order carries meaning, in the text and in any list. [A4]
- **Do not depend on hover or motion** for meaning; whatever a hover shows must also be in the text. How the viewer handles keyboard and screen readers is a mechanics matter: check it in the viewer.

## 10. Test it

0. **Two rounds.** Test the storyboard first, because changes are cheap there; test again on the built walkthrough, because views change what the text needs to say.
1. **Storyboard on paper:** one card per call with name, text and a sketch of each view's state. Fix on paper.
2. **Test on three to five people from the intended audience** (separately for clearly different audiences). Ask the test question before and after. Watch them step through, asking them to think aloud; do not explain or hint. Note where they stall, go back, misread or say "wait". Revise, then test on new readers: several small rounds find more than one large one. [W2, W3]
3. **If no reader is available, run a cold read of the texts.** Give another person or a fresh agent only the intro and the call names and texts, in order, no views. Ask it to (a) answer the test question, (b) list every term or value it could not derive from the text, treating as unknown anything the text does not define, except the terms on the reader record's "knows" line, which you hand over as a list, (c) list every state change the text does not state, (d) list every sentence it had to read twice. "The intro" is the title and opening lines the reader sees before the first call. Give the step names along with the call names. Give the test question only after the read, so it does not steer the reading. Act on (c) and (d) first: they find more than (b). This tests only the text path, and a model's prior knowledge hides gaps, so report it as a weaker test.
4. **Evidence caveat.** Most of the research behind these rules is from short lab lessons, not interactive multi-view explanations. The reader test is the authority.

## Worked examples

**A. A login session.**
_Weak:_ "show how login works". Five views (sequence, a graph of every component, a table of cookies, handler code, a user schema); 22 calls including TLS, DNS and password reset; the cookie value and the session id are the same string `abc`, and the browser table calls it "cookie" while the server table calls it "token". Everything is shown, nothing is the point.
_Better:_ reader is a front-end developer; outcome "can say why the session id is replaced at login and what an attacker with the old id can do". Cut TLS, DNS and reset, and say so. Two views: a sequence of messages (browser, server, attacker) and a table of server sessions (id, user). Ten calls in four steps: visit, log in, use the site, replay the old id. Ids are distinct and realistic (`s_7f3a`, `s_c91d`) and named identically in both views. At login the old row disappears and a new one appears, and the text gives both ids. The replay is a separate step, on the same table, that ends in a refusal.
_Why:_ the cut follows the outcome; events are paired with the state they change; the change is visible; one name per thing; the failure path is separate.

**B. Retry with backoff.**
_Weak:_ twelve calls, one per attempt, each saying "wait, then try again"; a flow chart that never changes; the point (the wait doubles, up to a cap) is buried.
_Better:_ outcome "can say what the wait is after the sixth failure and what the cap is for". Two views: a timeline (attempts and waits in time) and a table (failure count, wait by the doubling rule, wait applied). Show failures 1 and 2 in full (waits 1 s and 2 s), then jump to failure 6, where the rule gives 32 s but the table shows 30 s applied because of the cap. The text says "failures 3 to 5 double again: 4, 8 and 16 seconds".
_Why:_ the iterations are alike, so the first two plus the one that differs are shown and the skip is stated; the two views answer different questions (when, and by what rule).

**C. Binary search (a subject with no messages).**
_Weak:_ a table of variables and a paragraph per iteration describing the comparison in words.
_Better:_ outcome "can say why the search never looks left of the middle after the first comparison". Views: code (the line running) and a row of cells holding `3, 8, 14, 21, 27, 35, 42` with pointers for the low end, the high end and the middle, and a shaded range for what is still possible. Look for 35. Each iteration changes different state (the range shrinks), so show every one: the middle cell 21 is compared, is too small, the low pointer moves to index 4; the next middle is 35, found. The code plus the cells stand in for "events plus state". The values come from a recorded run.
_Why:_ the pointers carry the argument, the values differ so a reader can tell value from index, and the whole run is shown because every iteration teaches something.

## Review checklist

Run it on the draft and the design record. Answer yes or no. Any "no" is a finding, except items marked (n/a if none), which you may skip if the subject has none.

**Purpose**

1. Is the reader named in one line, with what they know?
2. Is the outcome stated as a verb you could test (not "understand")?
3. Are the test question and its answer written down, and does the walkthrough's final state show that answer?
4. Can the answer be read from the final state and the final call text?
5. Does the intro list at least one thing left out?
6. Is each term the reader does not know defined once, before its first use?

**Views**

7. Are there two or three views, and for any fourth is its reason written in one sentence?
8. Is the question each view answers written down, and are all the questions different?
9. Does every view change or get relied on in at least one call?
10. At every call, does each item shown in two views have the same name and the same value in both?
11. Is every colour, shape or mark that carries meaning explained in a key?
12. Is every colour meaning also carried by text, a mark or a position?

**Flow**

13. Does the walkthrough open with context or a first real call showing only what that call needs?
14. Can each call be said in one sentence with one verb, without splitting an atomic event?
15. Does each call touch every view whose state it depends on, and no other?
16. Does each step name use only words the reader knows or that the step's first call defines?
17. Are alike loop iterations cut to first, second and the different one, with the skipped count stated; and are unlike iterations all shown? (n/a if no loops)
18. Is each alternative or error path in its own step after the main path, with the divergence marked? (n/a if none)

**Text**

19. Does each call name say what happens, using the real command, message or value where short enough?
20. Is each call's text about 40 words or fewer, in at most three sentences?
21. Does each sentence say what changed, why, or what to notice, rather than where something is on screen?
22. When a value changes, does the text give the old and the new one?
23. Does reading only the call texts in order state every change?

**Values and facts**

24. Are the values realistic?
25. Are the values identical wherever the same item appears, from the first call to the last?
26. Do values that must be told apart differ?
27. Do five claims you choose at random each have a pointer or an "assumed" mark?
28. Does it name the version or date it describes?

**Before you ship**

29. Has someone from the intended audience gone through it while thinking aloud? If not, has a cold read of the texts been done and reported as the weaker test?
30. Could they, or the cold reader, answer the test question afterwards?
