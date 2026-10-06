import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const apiKey = process.env.GEMINI_API_KEY;
const model = 'gemma-4-31b-it';
const apiBase = 'https://generativelanguage.googleapis.com/v1beta';

const url = `${apiBase}/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

const body = {
  contents: [{ role: 'user', parts: [{ text: 'Say hello in one sentence.' }] }],
  generationConfig: { temperature: 0.7, maxOutputTokens: 100 }
};

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35000)
  });
  const data = await res.json();
  console.log('HTTP Status:', res.status);
  if (!res.ok) {
    console.log('Error status:', data.error?.status);
    console.log('Error message:', data.error?.message);
    console.log('Error code:', data.error?.code);
    if (data.error?.details) {
      console.log('Error details:', JSON.stringify(data.error.details, null, 2));
    }
  } else {
    console.log('SUCCESS');
    console.log('Response:', data.candidates?.[0]?.content?.parts?.map(p => p.text).join(''));
  }
} catch (err) {
  console.log('Network error:', err.name, err.message);
}
