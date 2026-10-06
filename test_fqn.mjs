import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
const MODEL = 'models/gemma-4-31b-it';

const ai = new GoogleGenAI({ apiKey });

console.log(`Testing with model: ${MODEL}`);

try {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: "Say hello in one sentence." }] }],
    config: { temperature: 0.7, maxOutputTokens: 100 }
  });
  console.log('HTTP Status: 200 OK');
  console.log('Response:', response.text);
} catch (err) {
  console.error('HTTP Status:', err.status || err.statusCode || 'N/A');
  console.error('Error:', err.message);
}
