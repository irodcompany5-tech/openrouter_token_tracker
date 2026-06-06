/**
 * proxy.js (v5) — OpenRouter transparent proxy with reliable token tracking
 *
 *   Your app → proxy (4243) → openrouter.ai → proxy → your app
 *                                  ↓
 *                           tracker (4242) → dashboard
 *
 * KEY FIXES IN V5:
 *  1. Injects `stream_options:{include_usage:true}` into streaming requests so
 *     OpenRouter actually returns token usage (LangChain/openai SDK omit this).
 *  2. Parses SSE chunks to extract usage.
 *  3. Falls back to a token *estimate* when the model returns no usage at all.
 *  4. Binds to 0.0.0.0 so Docker containers can reach it via the host IP.
 *  5. Built-in logging (set DEBUG=0 in .env to silence).
 */

const http = require('http');
const https = require('https');
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

const PROXY_PORT   = parseInt(process.env.PROXY_PORT   || '4243');
const TRACKER_PORT = parseInt(process.env.TRACKER_PORT || '4242');
const DEBUG        = process.env.DEBUG !== '0';
const UPSTREAM     = 'openrouter.ai';

const log = (...a) => DEBUG && console.log(...a);

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function report(event) {
  const body = JSON.stringify(event);
  log(`[TRACK] ${event.model} → p:${event.prompt_tokens} c:${event.completion_tokens} t:${event.total_tokens}${event.estimated ? ' (estimated)' : ''}`);
  const req = http.request({
    hostname: 'localhost',
    port: TRACKER_PORT,
    path: '/track',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  });
  req.on('error', (e) => console.error('[TRACK ERROR] tracker unreachable:', e.message));
  req.write(body);
  req.end();
}

const server = http.createServer((clientReq, clientRes) => {
  const startedAt = Date.now();
  const chunks = [];
  clientReq.on('data', c => chunks.push(c));
  clientReq.on('end', () => {
    let reqBody = Buffer.concat(chunks);

    let model = 'unknown';
    let promptText = '';
    let promptPreview = '';
    let appName = clientReq.headers['x-title'] || 'openai-sdk';
    let isStreamRequest = false;

    const isChatPath = clientReq.url?.includes('/chat/completions');

    if (isChatPath && reqBody.length > 0) {
      try {
        const parsed = JSON.parse(reqBody.toString());
        model = parsed.model || 'unknown';
        isStreamRequest = parsed.stream === true;

        const msgs = parsed.messages || [];
        promptText = msgs.map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join(' ');
        const last = msgs.filter(m => m.role === 'user').at(-1);
        if (last?.content) {
          promptPreview = (typeof last.content === 'string' ? last.content : JSON.stringify(last.content)).slice(0, 120);
        }

        if (isStreamRequest) {
          parsed.stream_options = { ...(parsed.stream_options || {}), include_usage: true };
          reqBody = Buffer.from(JSON.stringify(parsed));
        }

        log(`[REQ] ${model} stream=${isStreamRequest}`);
      } catch (e) {
        log('[REQ] body parse failed:', e.message);
      }
    }

    const upstreamHeaders = { ...clientReq.headers };
    upstreamHeaders['host'] = UPSTREAM;
    if (reqBody.length > 0) upstreamHeaders['content-length'] = Buffer.byteLength(reqBody);

    const upstreamReq = https.request({
      hostname: UPSTREAM,
      path: clientReq.url,
      method: clientReq.method,
      headers: upstreamHeaders,
    }, (upstreamRes) => {
      const resChunks = [];
      clientRes.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.on('data', chunk => { resChunks.push(chunk); clientRes.write(chunk); });
      upstreamRes.on('end', () => {
        clientRes.end();
        if (!isChatPath) return;

        const latency = Date.now() - startedAt;
        const isStream = upstreamRes.headers['content-type']?.includes('text/event-stream');
        const isError  = upstreamRes.statusCode >= 400;
        const rawBody  = Buffer.concat(resChunks).toString();

        let usage = {};
        let finalModel = model;
        let finishReason = 'unknown';
        let completionText = '';

        if (isStream) {
          for (const line of rawBody.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const c = JSON.parse(payload);
              if (c.model) finalModel = c.model;
              if (c.usage) usage = c.usage;
              const delta = c.choices?.[0]?.delta?.content;
              if (delta) completionText += delta;
              const fr = c.choices?.[0]?.finish_reason;
              if (fr) finishReason = fr;
            } catch {}
          }
        } else {
          try {
            const data = JSON.parse(rawBody);
            usage = data.usage || {};
            finalModel = data.model || model;
            finishReason = data.choices?.[0]?.finish_reason ?? 'unknown';
            completionText = data.choices?.[0]?.message?.content || '';
          } catch (e) {
            log('[RES] json parse failed:', e.message);
          }
        }

        let estimated = false;
        let pt = usage.prompt_tokens;
        let ct = usage.completion_tokens;
        let tt = usage.total_tokens;
        if (pt == null && ct == null && tt == null && !isError) {
          pt = estimateTokens(promptText);
          ct = estimateTokens(completionText);
          tt = pt + ct;
          estimated = true;
          log('[RES] no usage returned — using estimate');
        }

        report({
          ts: new Date().toISOString(),
          app: appName,
          model: finalModel,
          prompt_tokens: pt ?? null,
          completion_tokens: ct ?? null,
          total_tokens: tt ?? (pt != null && ct != null ? pt + ct : null),
          latency_ms: latency,
          prompt_preview: promptPreview,
          finish_reason: finishReason,
          error: isError ? `HTTP ${upstreamRes.statusCode}` : null,
          estimated,
        });
      });
    });

    upstreamReq.on('error', (err) => {
      console.error('[UPSTREAM ERROR]', err.message);
      try { clientRes.writeHead(502); clientRes.end(JSON.stringify({ error: 'proxy upstream error', detail: err.message })); } catch {}
    });

    if (reqBody.length > 0) upstreamReq.write(reqBody);
    upstreamReq.end();
  });
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`\n  OpenRouter proxy (v5) listening on 0.0.0.0:${PROXY_PORT}`);
  console.log(`  → forwarding to https://${UPSTREAM}`);
  console.log(`  → reporting to tracker on port ${TRACKER_PORT}`);
  console.log(`  → dashboard at http://localhost:${TRACKER_PORT}`);
  console.log(`  → debug logging ${DEBUG ? 'ON' : 'OFF'} (set DEBUG=0 in .env to silence)\n`);
});
