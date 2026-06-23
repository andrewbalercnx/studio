# WoZ facilitator script

You are playing the **scribe + coach** agent by hand. Your job is *not* to invent the story — it's
to **draw the child's story out of them and write it down**. The whole spike is measuring whether a
child this age can author with this kind of help, so stay in role even when it's tempting to help too
much.

> **The one rule that makes or breaks the spike:** ask **open questions**, never multiple choice.
> "What happens next?" ✅  ·  "Does the dragon fly or swim?" ❌ (that's *you* inventing).
> When you write the child's words into the story (the **scribe** step), fix grammar/spelling and
> keep their words — **add no event, character, or detail they didn't say.**

Use the operator screen: **prompt** = speak a question to the child · **scribe** = write what they
said into the story · **recap** = re-read the phase aloud · **clarify** = ask a targeted question ·
**observe** = one-tap a behaviour (do this *as it happens*, it's the data).

---

## 0 · Before you start (all ages)
- Set the age band and add 2–3 characters on the operator screen (let the child help pick them).
- Frame it, warmly: *"You're going to tell me a story, and I'll write it down for you. You're the
  author! I'll ask questions, but the story is all yours. Ready?"*
- Start the timer.

---

## A · Little Author (≈4–6)
Short, concrete, lots of warmth. **Max 1–2 phases. No conflict/arc prompts. At most ONE clarify per
phase** — everything else you let go (tap `observe`→ the relevant signal instead of asking). Recap
**just the new bit**, not the whole story.

**Open the story**
- *"Our story starts… what is [character] doing?"*
- *"Where are they? What can you see there?"*

**Keep it going (continuation — still open, still content-free)**
- *"Ooh! And then what happens?"*
- *"What does [character] do next?"*
- *"Who's with them?"*

**If they stall (silent):** offer a *question*, never a plot —
- *"Hmm… do they go somewhere new? Where do you think?"*
- *"What could they find?"*
If still stuck after one nudge → tap `observe: stall`, and either accept a 1-phase story or gently
move to the ending. **Don't push.**

**If they ramble / go off-topic / repeat you:** let a little ramble run (it's theirs), scribe the
story-relevant bits, tap `observe: ramble`/`offtopic`. Don't correct them.

**Clarify (only if you genuinely can't tell who did what — and only once):**
- *"When you said they climbed the tree — was that Rex, or Luna?"*  (use the actual names)
If they don't answer or look confused → tap `observe: didnt_understand`, pick the most likely, move
on. **Never ask the same thing twice.**

**Recap (just the new bit):**
- *"Listen — here's your story so far: ‘[the new sentence]’. Is that right?"*
Watch their face: engaged = good; squirmy/bored = tap `observe: disengaged` and shorten.

**End it (offer early — a 1-phase book is a win at this age):**
- *"Is that the end of your story, or does something else happen?"*

---

## B · Big Author (≈7–9)
Fuller loop. **3–5 phases. Arc-aware prompts allowed. Up to 2–3 clarifies per phase recap.** Recap
the **whole phase**.

**Open the story**
- *"How does your story begin? Where are we, and who's there?"*
- *"Tell me about [character] — what are they like?"*

**Continuation (arc-aware — still open, you supply the *shape*, never the *content*):**
- Setup → *"What are they doing? What's it like there?"*
- Toward the middle → *"Uh oh… does something go wrong? What happens?"*
- Turning point → *"What do they decide to do about it?"*
- Toward the end → *"How do they sort it out?"*

**If they stall:** an open scaffold, never a sentence of plot —
- *"Maybe something changes… what could happen?"*
- *"Is there someone who could help, or make it harder?"*

**Clarify at the phase boundary (batch 2–3, in child language):**
- *Which character:* *"When ‘he climbed up’ — did you mean Rex or Tom?"*
- *Action:* *"Did they run away, or hide?"*
- *Element (only if it matters for a picture):* *"What does the [new thing] look like?"*
Keep it light and quick — if it starts feeling like a quiz, stop (tap `observe: disengaged`).

**Recap (whole phase):**
- *"Okay — here's what's happened so far: ‘[read the phase].’ Did I get it right? Anything to change?"*
If they amend, scribe the change.

**Phase boundary:** when a scene feels done (problem set up, or solved, or they say "and then the
next day…"), tap `phase boundary` and open the next with a fresh prompt.

**End it:**
- *"Is that how your story ends, or is there more?"*

---

## Handling the awkward bits (all ages)
| What the child does | What you do | Tap |
|---|---|---|
| Goes silent | One open scaffold; then accept/move on | `stall` |
| Talks forever | Let some run; scribe the story bits | `ramble` |
| Off-topic ("I had cereal") | Gently: *"Ooh — and in our story?"* once | `offtopic` |
| Doesn't get the question | Rephrase **simpler once**, then drop it | `didnt_understand` |
| Loses interest | Shorten, offer the ending | `disengaged` |
| Lights up / proud | (nothing — just enjoy it) | `delight` |

**Provenance (matters for the spike's authorship question):** when you scribe, set the **author**
dropdown. If *you or a parent* supplied the idea (not the child), mark it `parent`/`shared` and tap
`observe`. That's how we learn whether the *child* actually authored it.

## Parent-Assist sessions
- **Scaffolding mode (default):** the grown-up may encourage or re-word your question, but the
  **child supplies the content** — keep `author: child`.
- **"Help me tell it together" (co-author):** the parent may add content — mark those turns
  `author: parent`/`shared`. Note in the findings that this was a co-authored session; we do **not**
  count it as child-authored.

## After each session
Fill in `findings-template.md` (one per child), then **delete the recording and the
`sessions/*.jsonl` log**. Keep only the anonymised findings.
