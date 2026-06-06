/**
 * example_usage.js
 * 
 * Setup:
 *   1. cp .env.example .env
 *   2. Edit .env and paste your OPENROUTER_API_KEY
 *   3. node server/server.js        (in one terminal)
 *   4. node example_usage.js        (in another terminal)
 *   5. Open http://localhost:4242   (dashboard)
 */

// Built-in .env loader (no npm install needed — Node 20+ has this natively)
// For older Node, install dotenv: npm install dotenv  then uncomment next line:
// require('dotenv').config();

const fs = require('fs');
const path = require('path');

// Simple .env loader (no dependencies)
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('\n  ERROR: .env file not found.');
    console.error('  Run:  cp .env.example .env');
    console.error('  Then: open .env and set your OPENROUTER_API_KEY\n');
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    process.env[key.trim()] = rest.join('=').trim();
  }
}

loadEnv();

const { OpenRouterClient } = require('./sdk/openrouter');

const client = new OpenRouterClient({
  apiKey: process.env.OPENROUTER_API_KEY,
  trackerUrl: `http://localhost:${process.env.TRACKER_PORT || 4242}`,
  appName: process.env.APP_NAME || 'my-app',
});

async function main() {
  console.log('Sending 3 test calls...\n');

  const r1 = await client.chat('openai/gpt-4o-mini', [
    { role: 'user', content: 'What is 2 + 2?' }
  ]);
  console.log('1:', r1.choices[0].message.content);
  console.log('   tokens:', r1.usage);

  const r2 = await client.chat('openai/gpt-4o-mini', [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Name 3 planets in our solar system.' }
  ]);
  console.log('2:', r2.choices[0].message.content);
  console.log('   tokens:', r2.usage);

  const r3 = await client.chat('meta-llama/llama-3.1-8b-instruct:free', [
    { role: 'user', content: 'Write a haiku about coding.' }
  ]);
  console.log('3:', r3.choices[0].message.content);
  console.log('   tokens:', r3.usage);

  console.log('\nAll done! Check http://localhost:4242');
}

main().catch(console.error);
