/**
 * example_usage.js — shows how to use the OpenRouter client in your app
 * 
 * 1. Start the tracker server:  node server/server.js
 * 2. Open http://localhost:4242 in your browser
 * 3. Run this file:             node example_usage.js
 * 4. Watch tokens appear in the dashboard in real time
 */

const { OpenRouterClient } = require('./sdk/openrouter');

const client = new OpenRouterClient({
  apiKey: 'sk-or-YOUR_KEY_HERE',
  trackerUrl: 'http://localhost:4242',
  appName: 'my-chatbot',          // shows up in the dashboard
});

async function main() {
  console.log('Sending 3 test calls...\n');

  // Call 1
  const r1 = await client.chat('openai/gpt-4o-mini', [
    { role: 'user', content: 'What is 2 + 2?' }
  ]);
  console.log('1:', r1.choices[0].message.content);
  console.log('   tokens:', r1.usage);

  // Call 2
  const r2 = await client.chat('openai/gpt-4o-mini', [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Name 3 planets in our solar system.' }
  ]);
  console.log('2:', r2.choices[0].message.content);
  console.log('   tokens:', r2.usage);

  // Call 3 — different model
  const r3 = await client.chat('meta-llama/llama-3.1-8b-instruct:free', [
    { role: 'user', content: 'Write a haiku about coding.' }
  ]);
  console.log('3:', r3.choices[0].message.content);
  console.log('   tokens:', r3.usage);

  console.log('\nAll calls sent! Check http://localhost:4242');
}

main().catch(console.error);
