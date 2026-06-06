/**
 * server.js (v5) — token tracking backend + dashboard host
 *
 *  - POST /track    receive a usage event (from proxy.js or the SDK)
 *  - GET  /events   SSE stream for the live dashboard
 *  - GET  /         serve dashboard.html
 *  - GET  /stats    JSON summary
 *  - POST /reset    clear all stats
 *
 * Persists to data.json so stats survive a restart.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [k, ...v] = t.split('=');
    process.env[k.trim()] = v.join('=').trim();
  }
}

const PORT = parseInt(process.env.TRACKER_PORT || '4242');
const DATA_FILE = path.join(__dirname, 'data.json');

let log = [];
let stats = freshStats();

function freshStats() {
  return {
    total_calls: 0,
    total_prompt_tokens: 0,
    total_completion_tokens: 0,
    total_tokens: 0,
    errors: 0,
    estimated_calls: 0,
    by_model: {},
    by_app: {},
  };
}

function save() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify({ log: log.slice(0, 500), stats })); }
  catch (e) { console.error('[SAVE ERROR]', e.message); }
}
function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      log = d.log || [];
      stats = { ...freshStats(), ...(d.stats || {}) };
      console.log(`  loaded ${log.length} past events from data.json`);
    }
  } catch (e) { console.error('[LOAD ERROR]', e.message); }
}

const clients = new Set();
function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(msg); } catch { clients.delete(res); } }
}

function updateStats(event) {
  stats.total_calls++;
  if (event.error) stats.errors++;
  if (event.estimated) stats.estimated_calls++;

  const pt = event.prompt_tokens || 0;
  const ct = event.completion_tokens || 0;
  const tt = event.total_tokens || (pt + ct);

  stats.total_prompt_tokens += pt;
  stats.total_completion_tokens += ct;
  stats.total_tokens += tt;

  const m = event.model || 'unknown';
  if (!stats.by_model[m]) stats.by_model[m] = { calls: 0, tokens: 0 };
  stats.by_model[m].calls++;
  stats.by_model[m].tokens += tt;

  const a = event.app || 'unknown';
  if (!stats.by_app[a]) stats.by_app[a] = { calls: 0, tokens: 0 };
  stats.by_app[a].calls++;
  stats.by_app[a].tokens += tt;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
}

function handleTrack(req, res) {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    cors(res);
    try {
      const event = JSON.parse(body);
      event.id = (log[0]?.id || 0) + 1;
      log.unshift(event);
      if (log.length > 500) log.pop();
      updateStats(event);
      broadcast({ type: 'event', event, stats });
      save();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'invalid json' }));
    }
  });
}

function handleSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(`data: ${JSON.stringify({ type: 'init', log: log.slice(0, 100), stats })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

function handleDashboard(req, res) {
  fs.readFile(path.join(__dirname, 'dashboard.html'), (err, data) => {
    if (err) { res.writeHead(404); return res.end('dashboard.html not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
  if (req.method === 'POST' && url.pathname === '/track') return handleTrack(req, res);
  if (req.method === 'GET'  && url.pathname === '/events') return handleSSE(req, res);
  if (req.method === 'GET'  && (url.pathname === '/' || url.pathname === '/dashboard')) return handleDashboard(req, res);

  if (req.method === 'POST' && url.pathname === '/reset') {
    cors(res);
    log = []; stats = freshStats(); save();
    broadcast({ type: 'init', log: [], stats });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, message: 'stats cleared' }));
  }

  if (req.method === 'GET' && url.pathname === '/stats') {
    cors(res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ stats, recent: log.slice(0, 20) }, null, 2));
  }

  res.writeHead(404);
  res.end('not found');
});

load();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Token tracker (v5) running at http://localhost:${PORT}`);
  console.log(`  dashboard → http://localhost:${PORT}`);
  console.log(`  stats     → http://localhost:${PORT}/stats`);
  console.log(`  reset     → curl -X POST http://localhost:${PORT}/reset\n`);
});
