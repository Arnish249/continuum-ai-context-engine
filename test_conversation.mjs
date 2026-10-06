import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
const MODEL = 'gemma-4-31b-it';

const ai = new GoogleGenAI({ apiKey });

// Accumulated conversation history for multi-turn
const history = [];

async function chat(userMessage) {
  history.push({ role: 'user', parts: [{ text: userMessage }] });

  let response;
  try {
    response = await ai.models.generateContent({
      model: MODEL,
      contents: history,
      config: {
        temperature: 0.7,
        maxOutputTokens: 2048,
        systemInstruction: 'You are the AI assistant inside Continuum, an AI Context Continuity Engine.'
      }
    });
  } catch (err) {
    console.error('==================== [GEMMA API DIAGNOSTIC] ====================');
    console.error('HTTP Status:', err.status || err.statusCode || 'N/A');
    console.error('Error Status:', err.errorDetails?.[0]?.reason || err.code || 'UNKNOWN');
    console.error('Error Message:', err.message);
    console.error('Model:', MODEL);
    console.error('================================================================');
    process.exit(1);
  }

  const text = response.text || '';
  // Push model response into history for next turn
  history.push({ role: 'model', parts: [{ text }] });
  return text;
}

// --- TEST 1 ---
console.log('\n=== TEST 1 ===');
console.log('User: "I\'m building a college smart parking system using Flask and PostgreSQL."');
const reply1 = await chat("I'm building a college smart parking system using Flask and PostgreSQL.");
console.log('\nGemma 4 Response:');
console.log(reply1);

// --- TEST 2 ---
console.log('\n=== TEST 2 ===');
console.log('User: "What database did I say I\'m using?"');
const reply2 = await chat("What database did I say I'm using?");
console.log('\nGemma 4 Response:');
console.log(reply2);

console.log('\n=== CONFIRMATION ===');
console.log(`Model used: ${MODEL}`);
