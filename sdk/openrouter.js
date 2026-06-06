/**
 * openrouter.js — drop-in OpenRouter client with automatic token tracking.
 * 
 * Usage:
 *   const { OpenRouterClient } = require('./openrouter');
 *   const client = new OpenRouterClient({ apiKey: 'sk-or-...', trackerUrl: 'http://localhost:4242' });
 *   const reply = await client.chat('openai/gpt-4o-mini', [{ role: 'user', content: 'hello' }]);
 */

class OpenRouterClient {
  constructor({ apiKey, trackerUrl = 'http://localhost:4242', appName = 'my-app' }) {
    if (!apiKey) throw new Error('apiKey is required');
    this.apiKey = apiKey;
    this.trackerUrl = trackerUrl;
    this.appName = appName;
    this.baseUrl = 'https://openrouter.ai/api/v1';
  }

  async chat(model, messages, options = {}) {
    const startedAt = Date.now();

    const body = { model, messages, ...options };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': options.referer || 'http://localhost',
        'X-Title': this.appName,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      const err = data?.error?.message || `HTTP ${res.status}`;
      await this._report({ model, error: err, latency_ms: Date.now() - startedAt });
      throw new Error(`OpenRouter error: ${err}`);
    }

    const usage = data.usage || {};
    const event = {
      ts: new Date().toISOString(),
      app: this.appName,
      model,
      prompt_tokens: usage.prompt_tokens ?? null,
      completion_tokens: usage.completion_tokens ?? null,
      total_tokens: usage.total_tokens ?? null,
      latency_ms: Date.now() - startedAt,
      prompt_preview: messages.at(-1)?.content?.slice(0, 120) ?? '',
      finish_reason: data.choices?.[0]?.finish_reason ?? 'unknown',
      error: null,
    };

    await this._report(event);
    return data;
  }

  async _report(event) {
    try {
      await fetch(`${this.trackerUrl}/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
    } catch {
      // tracker offline — don't crash your app
    }
  }
}

// Also export a convenience wrapper that mirrors the OpenAI SDK style
class OpenRouterChat {
  constructor(clientOptions) {
    this.client = new OpenRouterClient(clientOptions);
  }

  get completions() {
    return {
      create: ({ model, messages, ...opts }) =>
        this.client.chat(model, messages, opts),
    };
  }
}

module.exports = { OpenRouterClient, OpenRouterChat };
