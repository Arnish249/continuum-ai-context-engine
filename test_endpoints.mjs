import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const apiKey = process.env.GEMINI_API_KEY;
const apiBase = 'https://generativelanguage.googleapis.com/v1beta';

// Try v1 endpoint instead of v1beta
const endpoints = [
  `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent`,
  `https://generativelanguage.googleapis.com/v1/models/gemma-4-31b-it:generateContent`,
];

const body = JSON.stringify({
  contents: [{ role: 'user', parts: [{ text: 'Hello, say hi back.' }] }],
  generationConfig: { temperature: 0.7, maxOutputTokens: 100 }
});

for (const url of endpoints) {
  console.log(`\nTesting: ${url.replace(apiKey, '[KEY]')}`);
  try {
    const res = await fetch(`${url}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(20000)
    });
    const data = await res.json();
    console.log(`HTTP Status: ${res.status}`);
    if (!res.ok) {
      console.log('Error status:', data.error?.status);
      console.log('Error message:', data.error?.message);
    } else {
      console.log('SUCCESS:', data.candidates?.[0]?.content?.parts?.[0]?.text);
    }
  } catch (err) {
    console.log('Network error:', err.message);
  }
}
