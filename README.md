# OpenRouter Token Tracker v5

Track token usage from your app — even when you use the `openai` SDK, LangChain, or
anything else pointed at OpenRouter — and watch it live in a dashboard.

## What v5 fixes

- **Streaming usage**: injects `stream_options:{include_usage:true}` into streaming
  requests so OpenRouter actually returns token counts (LangChain/openai SDK omit this,
  which is why earlier versions showed zero).
- **Estimate fallback**: if a model returns no usage at all, tokens are estimated from
  text length and flagged `est` in the dashboard.
- **Binds to 0.0.0.0**: containers can reach the proxy via the host LAN IP.
- **Persistence**: stats survive a restart (saved to `server/data.json`).
- **Reset button** + `POST /reset` endpoint.
- **Built-in logging**: every request/response logged; set `DEBUG=0` in `.env` to silence.

## Architecture

```
Your app (openai SDK / LangChain)
   │  baseURL → http://<host-ip>:4243/api/v1
   ▼
proxy.js  (port 4243)  ──forwards──►  openrouter.ai
   │  reports usage
   ▼
server.js (port 4242)  ──SSE──►  dashboard.html (browser)
```

## Setup

```bash
cp .env.example .env
nano .env                 # paste OPENROUTER_API_KEY

chmod +x start.sh
./start.sh                # runs tracker + proxy together
```

Open the dashboard: `http://localhost:4242`

## Point your app at the proxy

Change only the base URL. Keep using your real OpenRouter API key — the proxy
forwards it untouched.

### openai SDK (Node)
```js
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'http://localhost:4243/api/v1',
});
```

### LangChain (Python)
```python
ChatOpenAI(
    model="z-ai/glm-5.1",
    openai_api_key=os.environ["OPENROUTER_API_KEY"],
    openai_api_base="http://localhost:4243/api/v1",
)
```

### Running in Docker?

`localhost` inside a container is the container itself — not your host. Use the host's
LAN IP instead:

```
OPENROUTER_BASE_URL=http://192.168.30.163:4243/api/v1
```

(replace with your host IP). The proxy binds to `0.0.0.0`, so the container can reach it.
Verify from inside the container:

```bash
docker exec -it <container> curl http://192.168.30.163:4243/api/v1/models
```

A JSON response means the tunnel works.

## Verify tracking

```bash
curl http://localhost:4242/stats

# Manually test the tracker:
curl -X POST http://localhost:4242/track \
  -H "Content-Type: application/json" \
  -d '{"model":"test","app":"test","prompt_tokens":10,"completion_tokens":20,"total_tokens":30}'
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| stats stay 0, answers work | app bypasses proxy | confirm base URL points to proxy, and the container env actually has it (`docker exec … env \| grep -i base`) |
| stats 0 but proxy logs show requests | tracker not running | start `server.js` |
| tokens show `est` | model didn't return usage | estimate used — counts approximate |
| container can't reach proxy | `localhost` inside container | use host LAN IP |
| wrong base URL but answers still generate | another `.env` overriding yours | Docker Compose auto-loads `.env`; check which wins |

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | /track | log a usage event |
| GET | /events | SSE live stream |
| GET | /stats | JSON summary |
| POST | /reset | clear all stats |
| GET | / | dashboard |
