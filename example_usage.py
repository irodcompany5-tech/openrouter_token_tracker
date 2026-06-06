"""
example_usage.py

Setup:
  1. cp .env.example .env
  2. Edit .env and paste your OPENROUTER_API_KEY
  3. node server/server.js        (in one terminal)
  4. python example_usage.py      (in another terminal)
  5. Open http://localhost:4242   (dashboard)
"""

import os
import sys
from pathlib import Path

def load_env():
    env_path = Path(__file__).parent / '.env'
    if not env_path.exists():
        print('\n  ERROR: .env file not found.')
        print('  Run:  cp .env.example .env')
        print('  Then: open .env and set your OPENROUTER_API_KEY\n')
        sys.exit(1)
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        key, _, value = line.partition('=')
        os.environ.setdefault(key.strip(), value.strip())

load_env()

from sdk.openrouter import OpenRouterClient

client = OpenRouterClient(
    api_key=os.environ['OPENROUTER_API_KEY'],
    tracker_url=f"http://localhost:{os.environ.get('TRACKER_PORT', '4242')}",
    app_name=os.environ.get('APP_NAME', 'my-app'),
)

def main():
    print("Sending 3 test calls...\n")

    r1 = client.chat("openai/gpt-4o-mini", [
        {"role": "user", "content": "What is 2 + 2?"}
    ])
    print("1:", r1["choices"][0]["message"]["content"])
    print("   tokens:", r1.get("usage"))

    r2 = client.chat("openai/gpt-4o-mini", [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Name 3 planets in our solar system."}
    ])
    print("2:", r2["choices"][0]["message"]["content"])
    print("   tokens:", r2.get("usage"))

    r3 = client.chat("meta-llama/llama-3.1-8b-instruct:free", [
        {"role": "user", "content": "Write a haiku about coding."}
    ])
    print("3:", r3["choices"][0]["message"]["content"])
    print("   tokens:", r3.get("usage"))

    print("\nAll done! Check http://localhost:4242")

if __name__ == "__main__":
    main()
