"""
example_usage.py — shows how to use the OpenRouter client in your Python app

1. Start the tracker server:  node server/server.js
2. Open http://localhost:4242 in your browser
3. Run this file:             python example_usage.py
4. Watch tokens appear in the dashboard in real time
"""

from sdk.openrouter import OpenRouterClient

client = OpenRouterClient(
    api_key="sk-or-YOUR_KEY_HERE",
    tracker_url="http://localhost:4242",
    app_name="my-python-app",    # shows up in the dashboard
)


def main():
    print("Sending 3 test calls...\n")

    # Call 1
    r1 = client.chat("openai/gpt-4o-mini", [
        {"role": "user", "content": "What is 2 + 2?"}
    ])
    print("1:", r1["choices"][0]["message"]["content"])
    print("   tokens:", r1.get("usage"))

    # Call 2
    r2 = client.chat("openai/gpt-4o-mini", [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Name 3 planets in our solar system."}
    ])
    print("2:", r2["choices"][0]["message"]["content"])
    print("   tokens:", r2.get("usage"))

    # Call 3 — different model
    r3 = client.chat("meta-llama/llama-3.1-8b-instruct:free", [
        {"role": "user", "content": "Write a haiku about coding."}
    ])
    print("3:", r3["choices"][0]["message"]["content"])
    print("   tokens:", r3.get("usage"))

    print("\nAll calls sent! Check http://localhost:4242")


if __name__ == "__main__":
    main()
