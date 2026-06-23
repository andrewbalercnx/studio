#!/usr/bin/env node
/**
 * STT-accuracy spike: transcribe young-child speech with Gemini on Vertex AI (EU region) and
 * measure WER + name-error-rate, with and without cast-name biasing. Answers §2.3 / §11.4:
 * is voice-first viable for the youngest, and does name-biasing actually help?
 *
 * Run:
 *   node --env-file=spikes/.env spikes/stt/transcribe.mjs            # uses spikes/stt/manifest.json
 *   node --env-file=spikes/.env spikes/stt/transcribe.mjs --manifest path/to.json
 *
 * Prereqs: GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION (EU, e.g. europe-west2) and ADC
 * (`gcloud auth application-default login`) or GOOGLE_APPLICATION_CREDENTIALS. STT_MODEL optional.
 *
 * NOTE: verifies whether Gemini-on-Vertex accepts the name "biasing" via a context hint in the
 * prompt. If the biased run doesn't move name-error-rate, the fallback is Google Cloud
 * Speech-to-Text with speechContexts — flagged in the report.
 *
 * Throwaway. Not wired into the app.
 */
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/vertexai';
import { wer, nameErrorRate } from './wer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const manifestPath = argv.includes('--manifest')
  ? argv[argv.indexOf('--manifest') + 1]
  : join(__dirname, 'manifest.json');

const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID;
const location = process.env.GOOGLE_CLOUD_LOCATION;
const modelName = process.env.STT_MODEL || 'gemini-2.5-flash';

if (!project || !location) {
  console.error('✗ Set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION (an EU region, e.g. europe-west2) in spikes/.env');
  process.exit(1);
}
if (!/^europe|^eu-|^uk/.test(location)) {
  console.warn(`⚠ GOOGLE_CLOUD_LOCATION="${location}" does not look like an EU/UK region. Child voice must stay in-region (§11.4).`);
}

const MIME = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.webm': 'audio/webm', '.flac': 'audio/flac' };

const ai = genkit({ plugins: [vertexAI({ projectId: project, location })] });

async function transcribe(audioPath, { castNames } = {}) {
  const bytes = await readFile(audioPath);
  const mime = MIME[extname(audioPath).toLowerCase()] || 'audio/wav';
  const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;

  const hint = castNames?.length
    ? ` The speaker may mention these names; transcribe them exactly when you hear them: ${castNames.join(', ')}.`
    : '';
  const instruction =
    `Transcribe this audio of a young child speaking, verbatim. Output only the transcript text, ` +
    `no commentary, no punctuation guesses beyond what is clearly spoken.${hint}`;

  const t0 = Date.now();
  const { text } = await ai.generate({
    model: vertexAI.model(modelName),
    prompt: [{ media: { url: dataUrl, contentType: mime } }, { text: instruction }],
    config: { temperature: 0 },
  });
  return { text: (text || '').trim(), ms: Date.now() - t0 };
}

async function main() {
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch { console.error(`✗ Could not read manifest at ${manifestPath} (copy manifest.example.json → manifest.json)`); process.exit(1); }

  const rows = [];
  for (const clip of manifest.clips || []) {
    const audioPath = join(__dirname, 'clips', clip.file);
    process.stdout.write(`• ${clip.file} … `);
    try {
      const plain = await transcribe(audioPath, {});
      const biased = await transcribe(audioPath, { castNames: clip.castNames });
      const row = {
        file: clip.file,
        wer_plain: +wer(clip.reference, plain.text).toFixed(3),
        wer_biased: +wer(clip.reference, biased.text).toFixed(3),
        ner_plain: +nameErrorRate(clip.castNames, plain.text).rate.toFixed(3),
        ner_biased: +nameErrorRate(clip.castNames, biased.text).rate.toFixed(3),
        names_missed_biased: nameErrorRate(clip.castNames, biased.text).missed,
        ms_plain: plain.ms, ms_biased: biased.ms,
        hyp_plain: plain.text, hyp_biased: biased.text, reference: clip.reference,
      };
      rows.push(row);
      console.log(`WER ${row.wer_plain}→${row.wer_biased}  nameErr ${row.ner_plain}→${row.ner_biased}`);
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      rows.push({ file: clip.file, error: e.message });
    }
  }

  const ok = rows.filter(r => !r.error);
  const avg = (k) => ok.length ? +(ok.reduce((s, r) => s + r[k], 0) / ok.length).toFixed(3) : null;
  const summary = {
    model: modelName, location, clips: rows.length, ok: ok.length,
    avg_wer_plain: avg('wer_plain'), avg_wer_biased: avg('wer_biased'),
    avg_nameErr_plain: avg('ner_plain'), avg_nameErr_biased: avg('ner_biased'),
    biasing_helped_names: avg('ner_biased') !== null && avg('ner_biased') < avg('ner_plain'),
  };

  const out = join(__dirname, `report-${new Date().toISOString().slice(0, 10)}.json`);
  await (await import('node:fs/promises')).writeFile(out, JSON.stringify({ summary, rows }, null, 2));

  console.log('\n── Summary ───────────────────────────────');
  console.table([summary]);
  console.log(`Report → ${out}`);
  if (!summary.biasing_helped_names) {
    console.log('\n⚠ Cast-name biasing via prompt hint did not improve name recognition.');
    console.log('  Decision: consider dedicated STT (Google Cloud Speech-to-Text + speechContexts) per §2.3.');
  }
  console.log('\nInterpretation (rough): WER < 0.15 is workable; 0.15–0.30 leans on tap-to-disambiguate;');
  console.log('> 0.30 (esp. on names) means voice-first for the youngest needs rethinking (§2.3/§9.0).');
}

main().catch(e => { console.error(e); process.exit(1); });
