#!/usr/bin/env node
/**
 * Wizard-of-Oz puppet server for the Child-Authored Stories usability spike.
 *
 * A human facilitator plays the scribe+coach agent. The CHILD screen (/child) shows the
 * characters + the growing story, and SPEAKS the agent's prompts aloud (browser SpeechSynthesis —
 * no API, no keys). The OPERATOR screen (/operator) is where the facilitator types prompts,
 * appends scribed segments, triggers recaps, and one-taps observations (stall / ramble / off-topic
 * / didn't-understand / disengaged / delight). Every action is timestamped to a JSONL session log
 * under spikes/woz/sessions/ for later analysis against findings-template.md.
 *
 * Zero dependencies. Run:  node spikes/woz/server.mjs   (then open the two URLs it prints)
 *
 * NOT production code. The child screen renders content typed by a human; nothing here is an AI.
 */
import { createServer } from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4321;
const SESSIONS_DIR = join(__dirname, 'sessions');
const sessionFile = join(SESSIONS_DIR, `woz-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);

// --- In-memory session state (single session at a time; this is a research tool) ---
let state = {
  childMeta: { ageBand: '', notes: '' },
  characters: [],          // [{ name, emoji }]
  storySoFar: [],          // [{ text, author: 'child'|'parent'|'shared' }]
  phase: 1,
  lastUtterance: null,     // { kind: 'prompt'|'recap'|'clarify', text } — what the child screen should speak
};

const sseClients = new Set();

function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) res.write(line);
}

async function logEvent(type, payload) {
  const entry = { t: new Date().toISOString(), ms: Date.now(), phase: state.phase, type, payload };
  try { await appendFile(sessionFile, JSON.stringify(entry) + '\n'); }
  catch (e) { console.error('[woz] log write failed:', e.message); }
}

function snapshot() {
  return { type: 'state', state };
}

// --- Operator actions ---
async function handleOp(action) {
  const { type, payload = {} } = action;
  switch (type) {
    case 'setMeta':
      state.childMeta = { ageBand: payload.ageBand || '', notes: payload.notes || '' };
      await logEvent('meta', state.childMeta);
      break;
    case 'setCharacters':
      state.characters = (payload.characters || []).filter(c => c && c.name);
      await logEvent('characters', { characters: state.characters });
      break;
    case 'prompt':            // agent asks an open question (spoken on child screen)
      state.lastUtterance = { kind: 'prompt', text: payload.text || '' };
      await logEvent('prompt', { text: payload.text });
      broadcast({ type: 'speak', kind: 'prompt', text: payload.text, state });
      return;                 // broadcast handled
    case 'clarify':           // a clarify question (which character / what happened)
      state.lastUtterance = { kind: 'clarify', text: payload.text || '' };
      await logEvent('clarify', { text: payload.text });
      broadcast({ type: 'speak', kind: 'clarify', text: payload.text, state });
      return;
    case 'scribe':            // facilitator writes the child's contribution into the story
      state.storySoFar.push({ text: payload.text || '', author: payload.author || 'child' });
      await logEvent('scribe', { text: payload.text, author: payload.author || 'child' });
      break;
    case 'recap': {           // re-read the current phase's text aloud
      const phaseText = state.storySoFar.map(s => s.text).join(' ');
      state.lastUtterance = { kind: 'recap', text: phaseText };
      await logEvent('recap', { phase: state.phase, text: phaseText });
      broadcast({ type: 'speak', kind: 'recap', text: phaseText, state });
      return;
    }
    case 'phaseBoundary':
      state.phase += 1;
      await logEvent('phase_boundary', { newPhase: state.phase });
      break;
    case 'observe':           // one-tap observation: stall/ramble/offtopic/didnt_understand/disengaged/delight
      await logEvent('observation', { signal: payload.signal, note: payload.note || '' });
      break;
    case 'reset':
      state = { childMeta: { ageBand: '', notes: '' }, characters: [], storySoFar: [], phase: 1, lastUtterance: null };
      await logEvent('reset', {});
      break;
    default:
      return { error: `unknown action ${type}` };
  }
  broadcast(snapshot());
  return { ok: true };
}

// --- HTTP ---
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

async function serveFile(res, name) {
  try {
    const buf = await readFile(join(__dirname, 'public', name));
    const ext = name.slice(name.lastIndexOf('.'));
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/' || url.pathname === '/child') return serveFile(res, 'child.html');
  if (url.pathname === '/operator') return serveFile(res, 'operator.html');

  if (url.pathname === '/events') {           // SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (url.pathname === '/api/op' && req.method === 'POST') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', async () => {
      try {
        const result = await handleOp(JSON.parse(body || '{}'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result || { ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end('not found');
});

await mkdir(SESSIONS_DIR, { recursive: true });
server.listen(PORT, () => {
  console.log(`\n  Wizard-of-Oz puppet running.`);
  console.log(`  CHILD screen     →  http://localhost:${PORT}/child      (give this to the child; it speaks aloud)`);
  console.log(`  OPERATOR screen  →  http://localhost:${PORT}/operator   (facilitator, keep hidden from the child)`);
  console.log(`  Session log      →  ${sessionFile}\n`);
});
