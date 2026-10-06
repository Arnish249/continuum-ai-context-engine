import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const apiKey = process.env.GEMINI_API_KEY;
const apiBase = 'https://generativelanguage.googleapis.com/v1beta';

// Test each Gemma 4 model individually
const models = ['gemma-4-31b-it', 'gemma-4-26b-a4b-it'];

const body = JSON.stringify({
  contents: [{ role: 'user', parts: [{ text: 'Say hello.' }] }],
  generationConfig: { temperature: 0.7, maxOutputTokens: 50 }
});

for (const model of models) {
  const url = `${apiBase}/models/${model}:generateContent?key=${apiKey}`;
  console.log(`\nTesting model: ${model}`);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(25000)
    });
    const data = await res.json();
    console.log(`  HTTP Status: ${res.status}`);
    if (!res.ok) {
      console.log(`  Error status: ${data.error?.status}`);
      console.log(`  Error message: ${data.error?.message}`);
    } else {
      console.log(`  SUCCESS: ${data.candidates?.[0]?.content?.parts?.[0]?.text}`);
    }
  } catch (err) {
    console.log(`  Network error: ${err.message}`);
  }
}
