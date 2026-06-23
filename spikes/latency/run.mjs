#!/usr/bin/env node
/**
 * End-to-end latency harness for the authoring turn loop (§2.3 / §9.0).
 * Measures each server-side stage and the two numbers that matter:
 *   • time-to-first-feedback  = STT + scribe   (child sees the scribed text — DON'T block on audio)
 *   • time-to-first-audio     = + streaming TTS first chunk (agent's next prompt starts speaking)
 * Target: p50 time-to-first-feedback < 4 s (a young child's patience). Reports p50/p95 over N runs.
 *
 * Run:
 *   node --env-file=spikes/.env spikes/latency/run.mjs --text "rex ran into the forest" --runs 5
 *   node --env-file=spikes/.env spikes/latency/run.mjs --audio clips/child-01.wav --runs 5
 *
 * Prereqs: GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION (EU) + ADC; ELEVENLABS_API_KEY.
 * Throwaway; the "scribe" here is a stub Flash call, not the real grounding pipeline (§12.1).
 */
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/vertexai';
import { getClient, measureStreaming } from './tts-stream.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const text = arg('--text', null);
const audio = arg('--audio', null);
const runs = parseInt(arg('--runs', '5'), 10);

const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID;
const location = process.env.GOOGLE_CLOUD_LOCATION;
if (!project || !location) { console.error('✗ Set GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION (EU) in spikes/.env'); process.exit(1); }
if (!text && !audio) { console.error('✗ Pass --text "…" or --audio clips/<file>'); process.exit(1); }

const STT_MODEL = process.env.STT_MODEL || 'gemini-2.5-flash';
const SCRIBE_MODEL = process.env.SCRIBE_MODEL || 'gemini-2.5-flash';
const MIME = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.webm': 'audio/webm' };
const ai = genkit({ plugins: [vertexAI({ projectId: project, location })] });
const ttsClient = getClient();

async function stt() {
  if (!audio) return { text, ms: 0, skipped: true };
  const path = join(__dirname, 'clips', audio.replace(/^clips\//, ''));
  const bytes = await readFile(path);
  const mime = MIME[extname(path).toLowerCase()] || 'audio/wav';
  const t0 = Date.now();
  const { text: tx } = await ai.generate({
    model: vertexAI.model(STT_MODEL),
    prompt: [{ media: { url: `data:${mime};base64,${bytes.toString('base64')}`, contentType: mime } },
             { text: 'Transcribe this young child speaking, verbatim. Output only the transcript.' }],
    config: { temperature: 0 },
  });
  return { text: (tx || '').trim(), ms: Date.now() - t0 };
}

async function scribe(childText) {
  const t0 = Date.now();
  const { text: seg } = await ai.generate({
    model: vertexAI.model(SCRIBE_MODEL),
    prompt: `Rewrite this young child's words as one tidy story sentence. Fix grammar/spelling only. ` +
            `Add nothing. Child said: "${childText}"`,
    config: { temperature: 0.1 },
  });
  // a stub "next open prompt" the agent would speak
  const nextPrompt = 'Ooh — what happens next?';
  return { segment: (seg || '').trim(), nextPrompt, ms: Date.now() - t0 };
}

const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };

async function oneRun() {
  const s = await stt();
  const sc = await scribe(s.text);
  const tts = await measureStreaming(sc.nextPrompt, ttsClient);
  const firstFeedback = s.ms + sc.ms;               // text shown to child
  const firstAudio = firstFeedback + tts.firstAudioMs;
  return { stt: s.ms, scribe: sc.ms, ttsFirst: tts.firstAudioMs, firstFeedback, firstAudio };
}

console.log(`Measuring ${runs} runs (STT:${audio ? STT_MODEL : 'skipped'}  scribe:${SCRIBE_MODEL}  region:${location})…\n`);
const results = [];
for (let i = 0; i < runs; i++) {
  process.stdout.write(`  run ${i + 1}/${runs} … `);
  try { const r = await oneRun(); results.push(r);
    console.log(`feedback ${r.firstFeedback}ms · audio ${r.firstAudio}ms`); }
  catch (e) { console.log(`ERROR ${e.message}`); }
}

if (results.length) {
  const col = k => results.map(r => r[k]);
  const stat = k => ({ stage: k, p50: pct(col(k), 50), p95: pct(col(k), 95), max: Math.max(...col(k)) });
  console.log('\n── Latency (ms) ──────────────────────────');
  console.table(['stt', 'scribe', 'ttsFirst', 'firstFeedback', 'firstAudio'].map(stat));
  const p50ff = pct(col('firstFeedback'), 50);
  console.log(p50ff < 4000
    ? `\n✓ p50 time-to-first-feedback = ${p50ff}ms — within the < 4s budget.`
    : `\n✗ p50 time-to-first-feedback = ${p50ff}ms — OVER the 4s budget. See bottleneck above (§2.3: stream, partial transcript, or cheaper model).`);
  const out = join(__dirname, `report-${new Date().toISOString().slice(0, 10)}.json`);
  await (await import('node:fs/promises')).writeFile(out, JSON.stringify({ runs: results }, null, 2));
  console.log(`Report → ${out}`);
}
