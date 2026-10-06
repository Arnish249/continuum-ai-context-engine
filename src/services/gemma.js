import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

/**
 * Gemma 4 API Service
 *
 * Provides direct interaction with Gemma 4 via the official @google/genai SDK,
 * strictly targeting Gemma 4 models.
 */
export class GemmaService {
  constructor(options = {}) {
    this.apiKey = options.apiKey !== undefined ? options.apiKey : config.geminiApiKey;
    this.model = options.model || config.gemmaModel;
    this.apiBase = options.apiBase || config.apiBase;
    this.ollamaBaseUrl = options.ollamaBaseUrl !== undefined ? options.ollamaBaseUrl : config.ollamaBaseUrl;
    this.ollamaModel = options.ollamaModel || config.ollamaModel;
    this.fetchImpl = options.fetchImpl || fetch;

    // Initialise SDK client (used for all Google GenAI calls)
    if (this.apiKey) {
      this._ai = new GoogleGenAI({ apiKey: this.apiKey });
    }
  }

  /**
   * Health check to verify Gemma 4 model accessibility and key configuration.
   */
  async ping() {
    if (!this.apiKey && !this.ollamaBaseUrl) {
      return {
        ok: false,
        model: this.model,
        provider: 'none',
        error: 'GEMINI_API_KEY is not configured in environment (.env). Please set your API key to interact with Gemma 4.'
      };
    }

    if (this.ollamaBaseUrl && !this.apiKey) {
      try {
        const res = await this.fetchImpl(`${this.ollamaBaseUrl}/api/tags`, {
          signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) throw new Error(`Ollama returned status ${res.status}`);
        const data = await res.json();
        const hasModel = data.models?.some(m => m.name.includes('gemma4'));
        return {
          ok: true,
          provider: 'ollama',
          model: this.ollamaModel,
          hasLocalModel: hasModel
        };
      } catch (err) {
        return {
          ok: false,
          provider: 'ollama',
          error: `Ollama connection failed: ${err.message}`
        };
      }
    }

    // Ping Google Generative Language API
    try {
      const url = `${this.apiBase}/models/${encodeURIComponent(this.model)}?key=${this.apiKey}`;
      const response = await this.fetchImpl(url, {
        signal: AbortSignal.timeout(10000)
      });
      const data = await response.json();

      if (!response.ok) {
        return {
          ok: false,
          provider: 'google-genai',
          model: this.model,
          status: response.status,
          error: data.error?.message || `HTTP ${response.status} from Google API`
        };
      }

      return {
        ok: true,
        provider: 'google-genai',
        model: this.model,
        displayName: data.displayName || this.model,
        description: data.description || 'Gemma 4 open model',
        inputTokenLimit: data.inputTokenLimit,
        outputTokenLimit: data.outputTokenLimit
      };
    } catch (err) {
      return {
        ok: false,
        provider: 'google-genai',
        model: this.model,
        error: err.message
      };
    }
  }

  /**
   * Send a prompt or conversation history to Gemma 4.
   * @param {Array<{ role: string, content: string }>} messages
   * @param {object} options
   * @returns {Promise<{ text: string, raw: object }>}
   */
  async generate({ messages = [], systemInstruction = '', jsonMode = false, temperature = 0.7 }) {
    if (!this.apiKey && !this.ollamaBaseUrl) {
      const err = new Error('GEMINI_API_KEY is not configured in .env. Please set your Google AI Studio API key to communicate with Gemma 4.');
      err.statusCode = 503;
      err.userFriendlyMessage = err.message;
      throw err;
    }

    if (!messages || messages.length === 0) {
      const err = new Error('Conversation history cannot be empty.');
      err.statusCode = 400;
      err.userFriendlyMessage = err.message;
      throw err;
    }

    // Format conversation messages according to Google Generative Language API rules:
    // 1. Roles are 'user' and 'model'
    // 2. Multiturn turns must alternate between user and model
    // 3. First turn must be 'user'
    const formattedContents = [];
    for (const msg of messages) {
      const role = msg.role === 'assistant' || msg.role === 'model' ? 'model' : 'user';
      const text = (msg.content || '').trim();
      if (!text) continue;

      const last = formattedContents[formattedContents.length - 1];
      if (last && last.role === role) {
        // Merge consecutive messages from same role into parts
        last.parts.push({ text });
      } else {
        formattedContents.push({
          role,
          parts: [{ text }]
        });
      }
    }

    // Ensure at least one turn exists and starts with 'user'
    if (formattedContents.length === 0) {
      const err = new Error('No valid text content found in conversation history.');
      err.statusCode = 400;
      err.userFriendlyMessage = err.message;
      throw err;
    }

    if (formattedContents[0].role !== 'user') {
      formattedContents.unshift({
        role: 'user',
        parts: [{ text: 'Hello' }]
      });
    }

    // Build SDK request config
    const requestConfig = {
      model: this.model,
      contents: formattedContents,
      config: {
        temperature,
        maxOutputTokens: 2048
      }
    };

    if (systemInstruction) {
      requestConfig.config.systemInstruction = systemInstruction;
    }

    if (jsonMode) {
      requestConfig.config.responseMimeType = 'application/json';
    }

    // Call Gemma 4 via official @google/genai SDK
    let response;
    try {
      if (true) {
        const url =
          this.apiBase +
          "/models/" +
          encodeURIComponent(this.model) +
          ":generateContent?key=" +
          encodeURIComponent(this.apiKey);

        const httpResponse = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: formattedContents
          })
        });

        const data = await httpResponse.json();

        if (!httpResponse.ok) {
          const apiMessage =
            data.error?.message ||
            "HTTP " + httpResponse.status + " from Google API";

          const apiErr = new Error(apiMessage);
          apiErr.statusCode = httpResponse.status;
          apiErr.userFriendlyMessage = apiMessage;
          throw apiErr;
        }

        response = {
          text:
            data.candidates?.[0]?.content?.parts
              ?.map(part => part.text || "")
              .join("") || "",
          candidates: data.candidates,
          raw: data
        };
      } else {
        response = await this._ai.models.generateContent(requestConfig);
      }
    } catch (sdkErr) {
      // Extract safe error details from SDK error
      const httpStatus = sdkErr.status || sdkErr.statusCode || 500;
      const apiStatus = sdkErr.errorDetails?.[0]?.reason || sdkErr.code || 'UNKNOWN';
      const apiMessage = sdkErr.message || `SDK error calling Gemma 4`;

      console.error('\n==================== [GEMMA API DIAGNOSTIC] ====================');
      console.error(`HTTP Status Code: ${httpStatus}`);
      console.error(`API Error Status: ${apiStatus}`);
      console.error(`API Error Message: ${apiMessage}`);
      console.error(`Requested Model:  ${this.model}`);
      if (sdkErr.errorDetails) {
        console.error(`Error Details:    ${JSON.stringify(sdkErr.errorDetails, null, 2)}`);
      }
      console.error('================================================================\n');

      const userMsg = `[Google API Error ${httpStatus} ${apiStatus}] ${apiMessage}`;
      const apiErr = new Error(userMsg);
      apiErr.statusCode = httpStatus >= 400 && httpStatus < 600 ? httpStatus : 500;
      apiErr.userFriendlyMessage = userMsg;
      apiErr.apiStatus = apiStatus;
      throw apiErr;
    }

    const text = response.text || '';

    if (!text) {
      const candidate = response.candidates?.[0];
      if (candidate?.finishReason === 'SAFETY') {
        const safetyErr = new Error('Gemma 4 response was flagged and blocked by safety policies.');
        safetyErr.statusCode = 400;
        safetyErr.userFriendlyMessage = safetyErr.message;
        throw safetyErr;
      }
    }

    return {
      text,
      raw: response
    };
  }
}

export const gemmaService = new GemmaService();
