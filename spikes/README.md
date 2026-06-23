# Sprint CA — De-risking spikes

Throwaway experiments that gate the Child-Authored Stories sprint (`docs/sprints/SPRINT-CA-CHILD-AUTHORED.md`, §9.0).
**Not wired into the app. Not production code.** Each answers one question that, if it comes back
badly, reshapes the plan — so run these *before* writing the spike-dependent specs.

| Spike | Question it answers | Needs creds? | Decides |
|-------|--------------------|--------------|---------|
| [`woz/`](./woz) | Can a real 4/6/9-yr-old sustain a scribe+coach dialog? | **No** | age bands · recap cadence · question budget · age-4 floor |
| [`stt/`](./stt) | Is Gemini STT accurate on young-child speech (esp. cast names)? | Vertex-EU | voice-first viability · dedicated-STT vs Gemini · name-biasing value |
| [`latency/`](./latency) | Does record→STT→scribe→TTS→play hit p50 < 4 s? | Vertex-EU + ElevenLabs | voice-first interaction model · what to stream/optimise |

**Suggested order:** WoZ first (no creds, biggest signal, and it generates the audio corpus for the
STT spike) → then STT + latency once the Vertex-EU project exists.

## Prerequisites

1. **Vertex AI project pinned to an EU/UK region** + Application Default Credentials
   (`gcloud auth application-default login`, or a service-account key). Spikes 2 & 3 only.
   This is also the production STT path (owner decision §11.4), so it is not throwaway.
2. **ElevenLabs API key**. Spike 3 only.
3. **Recruited children + written parental consent to record.** Spike 1 (and the audio it feeds to 2).

Copy `.env.example` → `.env` and fill in. All scripts load it via `--env-file=.env` (Node ≥ 20.6)
or you can `export` the vars.

```bash
cp spikes/.env.example spikes/.env
# edit spikes/.env
```

## Ethics / data handling (these involve children)

This is research, separate from the product consent gate — but treat it just as carefully:

- **Written parental consent** before recording any child; explain what's recorded and why.
- Store recordings/transcripts under `spikes/**/clips/` and `spikes/woz/sessions/` only — **all
  gitignored** (see `.gitignore` below). Never commit a child's voice, face, or transcript.
- **Delete recordings after analysis.** Keep only the anonymised, aggregated findings
  (`woz/findings-template.md` filled in, the STT WER numbers) — those carry no child content.
- Use obviously-fake names where you can; don't capture surnames, school, address.

A `.gitignore` in this folder excludes `clips/`, `sessions/`, `*.wav`, `*.mp3`, `*.webm`, `.env`,
and `report*.json/csv`. Verify before committing.

## What feeds back into the plan

When you have results, hand them back and the next spec batch gets written against real numbers:
WoZ → §2.7 age bands / question budget; STT WER → §2.3 voice viability; latency → §2.3 budget +
whether streaming TTS / partial-transcript is mandatory.
