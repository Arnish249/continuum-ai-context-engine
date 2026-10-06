import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const apiKey = process.env.GEMINI_API_KEY;
const apiBase = 'https://generativelanguage.googleapis.com/v1beta';

// List all available models to see what this key can actually access
console.log('Listing available models...\n');

const res = await fetch(`${apiBase}/models?key=${apiKey}`, {
  signal: AbortSignal.timeout(15000)
});
const data = await res.json();

if (!res.ok) {
  console.log('HTTP Status:', res.status);
  console.log('Error:', data.error?.message);
  console.log('Status:', data.error?.status);
} else {
  const models = data.models || [];
  console.log(`Total models available: ${models.length}`);
  console.log('\nGemma models:');
  models.filter(m => m.name.toLowerCase().includes('gemma')).forEach(m => {
    console.log(`  - ${m.name}  |  supportedMethods: ${m.supportedGenerationMethods?.join(', ')}`);
  });
  console.log('\nAll model names:');
  models.forEach(m => console.log(`  ${m.name}`));
}
