/**
 * server.js — token tracking backend
 * 
 * - Receives POST /track events from your app's SDK
 * - Stores them in memory (or SQLite if you want persistence)
 * - Streams live updates to the dashboard via SSE (GET /events)
 * - Serves the dashboard HTML at GET /
 * 
 * Run: node server.js
 * Then open http://localhost:4242 in your browser
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4242;

// In-memory store
const log = [];
const stats = {
  total_calls: 0,
  total_prompt_tokens: 0,
  total_completion_tokens: 0,
  total_tokens: 0,
  errors: 0,
  by_model: {},
  by_app: {},
};

// SSE clients
const clients = new Set();

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch { clients.delete(res); }
  }
}

function updateStats(event) {
  stats.total_calls++;
  if (event.error) { stats.errors++; return; }

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

function handleTrack(req, res) {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    // Allow CORS from any origin (your app might be on a different port)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    try {
      const event = JSON.parse(body);
      event.id = log.length + 1;
      log.unshift(event); // newest first
      if (log.length > 500) log.pop(); // keep last 500

      updateStats(event);
      broadcast({ type: 'event', event, stats });

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

  // Send current state immediately on connect
  res.write(`data: ${JSON.stringify({ type: 'init', log: log.slice(0, 100), stats })}\n\n`);

  clients.add(res);
  req.on('close', () => clients.delete(res));
}

function handleDashboard(req, res) {
  const dashPath = path.join(__dirname, 'dashboard.html');
  fs.readFile(dashPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('dashboard.html not found — run server.js from the same folder as dashboard.html');
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'POST' && url.pathname === '/track') return handleTrack(req, res);
  if (req.method === 'GET' && url.pathname === '/events') return handleSSE(req, res);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) return handleDashboard(req, res);

  // Stats JSON endpoint (useful for curl)
  if (req.method === 'GET' && url.pathname === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ stats, recent: log.slice(0, 20) }, null, 2));
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`\n  token tracker running at http://localhost:${PORT}`);
  console.log(`  open http://localhost:${PORT} in your browser for the dashboard`);
  console.log(`  POST http://localhost:${PORT}/track to log a call`);
  console.log(`  GET  http://localhost:${PORT}/stats for JSON summary\n`);
});
