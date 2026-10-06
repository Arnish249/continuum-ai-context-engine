import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Allowed Gemma 4 model identifiers
const ALLOWED_GEMMA_MODELS = [
  'gemma-4-31b-it',
  'gemma-4-26b-a4b-it',
  'gemma-4-e4b-it',
  'gemma-4-e2b-it'
];

const selectedModel = process.env.GEMMA_MODEL || 'gemma-4-31b-it';

// Strict validation: enforce Gemma 4 constraint
if (!ALLOWED_GEMMA_MODELS.includes(selectedModel) && !process.env.ALLOW_CUSTOM_GEMMA_MODEL) {
  console.warn(`[Config Warning] Selected model "${selectedModel}" is not in standard Gemma 4 list: ${ALLOWED_GEMMA_MODELS.join(', ')}`);
}

export const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
  gemmaModel: selectedModel,
  allowedModels: ALLOWED_GEMMA_MODELS,
  apiBase: process.env.GEMMA_API_BASE || 'https://generativelanguage.googleapis.com/v1beta',
  rootDir,
  dataDir: path.join(rootDir, 'data'),
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || null,
  ollamaModel: process.env.OLLAMA_MODEL || 'gemma4:31b',
  isApiKeyConfigured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
};
