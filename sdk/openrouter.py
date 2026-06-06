"""
openrouter.py — drop-in OpenRouter client with automatic token tracking.

Usage:
    from openrouter import OpenRouterClient

    client = OpenRouterClient(api_key="sk-or-...", tracker_url="http://localhost:4242")
    reply = client.chat("openai/gpt-4o-mini", [{"role": "user", "content": "hello"}])
    print(reply["choices"][0]["message"]["content"])
"""

import time
import json
import requests
from datetime import datetime, timezone


class OpenRouterClient:
    def __init__(self, api_key: str, tracker_url: str = "http://localhost:4242", app_name: str = "my-app"):
        if not api_key:
            raise ValueError("api_key is required")
        self.api_key = api_key
        self.tracker_url = tracker_url
        self.app_name = app_name
        self.base_url = "https://openrouter.ai/api/v1"

    def chat(self, model: str, messages: list, **kwargs) -> dict:
        started_at = time.time()

        payload = {"model": model, "messages": messages, **kwargs}
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "HTTP-Referer": kwargs.pop("referer", "http://localhost"),
            "X-Title": self.app_name,
        }

        resp = requests.post(
            f"{self.base_url}/chat/completions",
            headers=headers,
            json=payload,
            timeout=60,
        )

        latency_ms = int((time.time() - started_at) * 1000)

        try:
            data = resp.json()
        except Exception:
            data = {}

        if not resp.ok:
            err = data.get("error", {}).get("message") or f"HTTP {resp.status_code}"
            self._report({"model": model, "error": err, "latency_ms": latency_ms})
            raise RuntimeError(f"OpenRouter error: {err}")

        usage = data.get("usage", {})
        last_msg = messages[-1].get("content", "") if messages else ""

        event = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "app": self.app_name,
            "model": model,
            "prompt_tokens": usage.get("prompt_tokens"),
            "completion_tokens": usage.get("completion_tokens"),
            "total_tokens": usage.get("total_tokens"),
            "latency_ms": latency_ms,
            "prompt_preview": str(last_msg)[:120],
            "finish_reason": (data.get("choices") or [{}])[0].get("finish_reason", "unknown"),
            "error": None,
        }

        self._report(event)
        return data

    def _report(self, event: dict):
        try:
            requests.post(
                f"{self.tracker_url}/track",
                json=event,
                timeout=2,
            )
        except Exception:
            pass  # tracker offline — don't crash your app
