/**
 * proxy.js — OpenRouter transparent proxy
 *
 * Your openai SDK thinks it's talking to OpenRouter.
 * This proxy sits in the middle, captures token usage from every response,
 * and silently reports it to the tracker dashboard.
 *
 * HOW IT WORKS:
 *   Your app  →  proxy (port 4243)  →  openrouter.ai  →  proxy  →  your app
 *                                           ↓
 *                                    tracker (port 4242)
 *
 * SETUP:
 *   1. node proxy.js               (keep running alongside server.js)
 *   2. In your app, change the baseURL to http://localhost:4243/api/v1
 *
 * EXAMPLE (openai SDK):
 *   const openai = new OpenAI({
 *     apiKey: process.env.OPENROUTER_API_KEY,
 *     baseURL: 'http://localhost:4243/api/v1',   // ← only change this line
 *   });
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [k, ...v] = t.split('=');
    process.env[k.trim()] = v.join('=').trim();
  }
}

const PROXY_PORT   = parseInt(process.env.PROXY_PORT   || '4243');
const TRACKER_PORT = parseInt(process.env.TRACKER_PORT || '4242');
const UPSTREAM     = 'openrouter.ai';

// ── report usage to tracker ────────────────────────────────────────────────
function report(event) {
  const body = JSON.stringify(event);
  const req = http.request({
    hostname: 'localhost',
    port: TRACKER_PORT,
    path: '/track',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  });
  req.on('error', () => {}); // silent if tracker is down
  req.write(body);
  req.end();
}

// ── main proxy handler ─────────────────────────────────────────────────────
const server = http.createServer((clientReq, clientRes) => {
  const startedAt = Date.now();

  // Collect the incoming request body
  const chunks = [];
  clientReq.on('data', c => chunks.push(c));
  clientReq.on('end', () => {
    const reqBody = Buffer.concat(chunks);

    // Parse request for metadata (best-effort)
    let model = 'unknown';
    let promptPreview = '';
    let appName = clientReq.headers['x-title'] || 'openai-sdk';
    try {
      const parsed = JSON.parse(reqBody.toString());
      model = parsed.model || 'unknown';
      const msgs = parsed.messages || [];
      const last = msgs.filter(m => m.role === 'user').at(-1);
      if (last?.content) {
        promptPreview = (typeof last.content === 'string' ? last.content : JSON.stringify(last.content)).slice(0, 120);
      }
    } catch {}

    // Build upstream request headers — forward everything except host
    const upstreamHeaders = { ...clientReq.headers };
    upstreamHeaders['host'] = UPSTREAM;
    // Ensure content-length is correct (body already buffered)
    if (reqBody.length > 0) upstreamHeaders['content-length'] = reqBody.length;

    // Forward to OpenRouter
    const upstreamReq = https.request({
      hostname: UPSTREAM,
      path: clientReq.url,
      method: clientReq.method,
      headers: upstreamHeaders,
    }, (upstreamRes) => {

      // Stream response body while collecting it for usage parsing
      const resChunks = [];
      clientRes.writeHead(upstreamRes.statusCode, upstreamRes.headers);

      upstreamRes.on('data', chunk => {
        resChunks.push(chunk);
        clientRes.write(chunk);
      });

      upstreamRes.on('end', () => {
        clientRes.end();

        // Only parse chat completions (not embeddings, models list, etc.)
        const isChatPath = clientReq.url?.includes('/chat/completions');
        if (!isChatPath) return;

        const isStream = upstreamRes.headers['content-type']?.includes('text/event-stream');
        const latency = Date.now() - startedAt;
        const isError = upstreamRes.statusCode >= 400;

        if (isStream) {
          // Parse SSE chunks to find usage data
          // OpenRouter sends usage in the last data chunk before [DONE]
          // Format: "data: {..., usage: {prompt_tokens, completion_tokens, total_tokens}}"
          let usage = {};
          let finalModel = model;
          let finishReason = 'unknown';

          const rawBody = Buffer.concat(resChunks).toString();
          const lines = rawBody.split('\n');

          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const chunk = JSON.parse(payload);
              // Track model from first chunk
              if (chunk.model) finalModel = chunk.model;
              // Usage appears in the last chunk (OpenRouter includes it there)
              if (chunk.usage) usage = chunk.usage;
              // Track finish reason
              const fr = chunk.choices?.[0]?.finish_reason;
              if (fr && fr !== null) finishReason = fr;
            } catch {}
          }

          report({
            ts: new Date().toISOString(),
            app: appName,
            model: finalModel,
            prompt_tokens: usage.prompt_tokens ?? null,
            completion_tokens: usage.completion_tokens ?? null,
            total_tokens: usage.total_tokens ?? null,
            latency_ms: latency,
            prompt_preview: promptPreview,
            finish_reason: finishReason,
            error: isError ? `HTTP ${upstreamRes.statusCode}` : null,
          });
          return;
        }

        // Non-streaming JSON response
        try {
          const rawBody = Buffer.concat(resChunks).toString();
          const data = JSON.parse(rawBody);
          const usage = data.usage || {};

          report({
            ts: new Date().toISOString(),
            app: appName,
            model: data.model || model,
            prompt_tokens: usage.prompt_tokens ?? null,
            completion_tokens: usage.completion_tokens ?? null,
            total_tokens: usage.total_tokens ?? null,
            latency_ms: latency,
            prompt_preview: promptPreview,
            finish_reason: data.choices?.[0]?.finish_reason ?? 'unknown',
            error: isError ? (data.error?.message || `HTTP ${upstreamRes.statusCode}`) : null,
          });
        } catch {
          // Response wasn't JSON — ignore
        }
      });
    });

    upstreamReq.on('error', (err) => {
      clientRes.writeHead(502);
      clientRes.end(JSON.stringify({ error: 'proxy upstream error', detail: err.message }));
    });

    if (reqBody.length > 0) upstreamReq.write(reqBody);
    upstreamReq.end();
  });
});

server.listen(PROXY_PORT, () => {
  console.log(`\n  ┌─────────────────────────────────────────────────┐`);
  console.log(`  │  OpenRouter proxy running on port ${PROXY_PORT}          │`);
  console.log(`  │                                                 │`);
  console.log(`  │  In your app, set baseURL to:                   │`);
  console.log(`  │  http://localhost:${PROXY_PORT}/api/v1              │`);
  console.log(`  │                                                 │`);
  console.log(`  │  Dashboard → http://localhost:${TRACKER_PORT}            │`);
  console.log(`  └─────────────────────────────────────────────────┘\n`);
});
