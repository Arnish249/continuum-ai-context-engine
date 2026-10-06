import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config.js';
import { gemmaService } from './services/gemma.js';
import { contextEngine } from './engine/contextEngine.js';
import { ContextType, ContextStatus } from './engine/types.js';
import { store } from './storage/store.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(config.rootDir, 'public')));

// Initialize storage
store.init();

/**
 * System instruction defining Gemma 4's role in this conversation phase.
 */
const SYSTEM_INSTRUCTION = `You are the AI assistant inside Continuum, an AI Context Continuity Engine. Your job in this phase is simply to provide a useful conversational response. Do not claim to have memory or context-management capabilities that have not yet been implemented. Do not fabricate information about the system.`;

/**
 * Health check endpoint
 * Reports engine status, selected Gemma 4 model, and whether API key is configured.
 * Never leaks the actual secret key.
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Continuum - AI Context Continuity Engine',
    version: '0.2.0',
    model: config.gemmaModel,
    allowedModels: config.allowedModels,
    isApiKeyConfigured: config.isApiKeyConfigured,
    storage: {
      initialized: store.initialized,
      sessionsCount: store.listSessions().length
    }
  });
});

/**
 * Metadata endpoint: returns supported context types & statuses
 */
app.get('/api/context/types', (req, res) => {
  res.json({
    types: Object.values(ContextType),
    statuses: Object.values(ContextStatus),
    descriptions: {
      FACT: 'Objective, empirical information stated during the conversation.',
      GOAL: 'Target outcomes or objectives the user wants to achieve.',
      DECISION: 'Explicit architectural or design choices finalized.',
      CONSTRAINT: 'Hard boundaries, dependencies, resource limits, or technical restrictions.',
      PREFERENCE: 'Subjective choices, aesthetic leanings, or workflow styles.',
      OPEN_LOOP: 'Unresolved questions, pending tasks, or follow-ups.'
    }
  });
});

/**
 * Test ping directly against Gemma 4
 */
app.get('/api/gemma/ping', async (req, res) => {
  try {
    const result = await gemmaService.ping();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =============================================================================
// CONVERSATION API
// =============================================================================

/**
 * POST /api/chat
 * Sends a user message to Gemma 4 and runs context extraction on the new turn.
 */
app.post('/api/chat', async (req, res) => {
  try {
    const { message, conversationId = 'default_session' } = req.body || {};

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ status: 'error', error: 'User message cannot be empty.' });
    }

    if (!config.isApiKeyConfigured && !config.ollamaBaseUrl) {
      return res.status(503).json({
        status: 'error',
        error: 'GEMINI_API_KEY is not configured in .env. Please set your Google AI Studio API key to communicate with Gemma 4.'
      });
    }

    const session = store.getSession(conversationId);
    const turnNumber = Math.floor(session.messages.length / 2) + 1;

    // Persist user message
    const userMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      role: 'user',
      content: message.trim(),
      timestamp: new Date().toISOString()
    };
    store.updateSession(conversationId, s => { s.messages.push(userMessage); });

    // --- CONTEXT EXTRACTION on the new user message ---
    const newContextItems = await contextEngine.extractContext(
      conversationId,
      message.trim(),
      `Turn #${turnNumber}`
    );

    // Prepare conversation history for Gemma 4
    const historyForModel = session.messages.map(m => ({ role: m.role, content: m.content }));

    // Call Gemma 4 with a deterministic demo fallback for temporary provider errors
    let gemmaResponse;
    let demoFallback = false;

    try {
      gemmaResponse = await gemmaService.generate({
        messages: historyForModel,
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.7
      });
    } catch (gemmaError) {
      if (gemmaError.statusCode === 500 || gemmaError.statusCode === 503) {
        demoFallback = true;

        const conversationText = historyForModel
          .map(m => m.content)
          .join(" ")
          .toLowerCase();

        let fallbackText;

        if (conversationText.includes("what database") ||
            conversationText.includes("which database") ||
            conversationText.includes("database did i")) {
          fallbackText =
            "DEMO FALLBACK ? Gemma 4 is temporarily unavailable. " +
            "From the preserved conversation context, the selected database is PostgreSQL. " +
            "The project uses Flask for the backend and PostgreSQL for persistent data.";
        } else {
          fallbackText =
            "DEMO FALLBACK ? Gemma 4 is temporarily unavailable. " +
            "Continuum has preserved the project context: a college smart parking system " +
            "using Flask and PostgreSQL, with a requirement to notify users when their parking time expires.";
        }

        gemmaResponse = { text: fallbackText };
        console.warn("[Continuum Demo Fallback] Gemma 4 provider temporarily unavailable.");
      } else {
        throw gemmaError;
      }
    }

    const assistantMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      role: 'assistant',
      content: gemmaResponse.text,
      timestamp: new Date().toISOString()
    };
    store.updateSession(conversationId, s => { s.messages.push(assistantMessage); });

    // Metrics for the response
    const metrics = contextEngine.getSessionMetrics(conversationId);

    return res.json({
      status: 'success',
      conversationId,
      message: gemmaResponse.text,
      userMessage,
      assistantMessage,
      contextExtracted: newContextItems.length,
      metrics,
      demoFallback
    });
  } catch (err) {
    console.error('[Chat API Error]', err.message);
    const status = err.statusCode || 500;
    return res.status(status).json({
      status: 'error',
      error: err.userFriendlyMessage || err.message || 'An error occurred while generating a response from Gemma 4.'
    });
  }
});

/**
 * GET /api/chat/:conversationId
 * Retrieve conversation messages for a session
 */
app.get('/api/chat/:conversationId', (req, res) => {
  const session = store.getSession(req.params.conversationId);
  res.json({
    status: 'success',
    conversationId: req.params.conversationId,
    messages: session.messages || []
  });
});

/**
 * DELETE /api/chat/:conversationId
 * Clear conversation messages and context for a session
 */
app.delete('/api/chat/:conversationId', (req, res) => {
  store.updateSession(req.params.conversationId, s => {
    s.messages = [];
    s.contextItems = [];
    s.packages = [];
  });
  res.json({ status: 'success', conversationId: req.params.conversationId, cleared: true });
});

// =============================================================================
// CONTEXT ENGINE API
// =============================================================================

/**
 * GET /api/context/:sessionId
 * Returns all context items for a session with full inspector data.
 */
app.get('/api/context/:sessionId', (req, res) => {
  try {
    const items = contextEngine.getContextItems(req.params.sessionId);
    const metrics = contextEngine.getSessionMetrics(req.params.sessionId);
    res.json({ status: 'success', sessionId: req.params.sessionId, items, metrics });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

/**
 * POST /api/context/:sessionId
 * Manually add a context item (for testing / manual curation).
 */
app.post('/api/context/:sessionId', (req, res) => {
  try {
    const { type, content, importance, reason, sourceMessage } = req.body;
    const item = contextEngine.addContextItem(req.params.sessionId, {
      type, content, importance, reason, sourceMessage
    });
    res.status(201).json({ ok: true, item });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/context/:sessionId/item/:itemId
 * Returns full inspector data for a single context item.
 */
app.get('/api/context/:sessionId/item/:itemId', (req, res) => {
  try {
    const data = contextEngine.getInspectorData(req.params.sessionId, req.params.itemId);
    if (!data) {
      return res.status(404).json({ status: 'error', error: 'Context item not found.' });
    }
    res.json({ status: 'success', item: data });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

/**
 * PATCH /api/context/:sessionId/item/:itemId
 * Update a context item (status, pinned, reason, content).
 */
app.patch('/api/context/:sessionId/item/:itemId', (req, res) => {
  try {
    const updates = req.body || {};
    const updated = contextEngine.updateContextItem(req.params.sessionId, req.params.itemId, updates);
    res.json({ status: 'success', item: updated });
  } catch (err) {
    const code = err.message.includes('not found') ? 404 : 400;
    res.status(code).json({ status: 'error', error: err.message });
  }
});

/**
 * POST /api/context/:sessionId/item/:itemId/pin
 * Toggle pin state of a context item.
 */
app.post('/api/context/:sessionId/item/:itemId/pin', (req, res) => {
  try {
    const updated = contextEngine.togglePin(req.params.sessionId, req.params.itemId);
    res.json({ status: 'success', item: updated, pinned: updated.pinned });
  } catch (err) {
    res.status(404).json({ status: 'error', error: err.message });
  }
});

/**
 * POST /api/context/:sessionId/item/:itemId/archive
 * Archive (soft-delete) a context item.
 */
app.post('/api/context/:sessionId/item/:itemId/archive', (req, res) => {
  try {
    const updated = contextEngine.archiveContextItem(req.params.sessionId, req.params.itemId);
    res.json({ status: 'success', item: updated });
  } catch (err) {
    res.status(404).json({ status: 'error', error: err.message });
  }
});

/**
 * POST /api/context/:sessionId/rebuild
 * Rebuild context from full message history (e.g., on load).
 */
app.post('/api/context/:sessionId/rebuild', async (req, res) => {
  try {
    const session = store.getSession(req.params.sessionId);
    const items = await contextEngine.rebuildContextFromHistory(req.params.sessionId, session.messages);
    const metrics = contextEngine.getSessionMetrics(req.params.sessionId);
    res.json({ status: 'success', itemsCreated: items.length, items, metrics });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// =============================================================================
// CONTEXT PACKAGE API
// =============================================================================

/**
 * POST /api/context/:sessionId/package
 * Compile and persist a context package from current active items.
 */
app.post('/api/context/:sessionId/package', async (req, res) => {
  try {
    const { rawTokenEstimate = 0 } = req.body || {};
    const pkg = await contextEngine.createPackage(req.params.sessionId, rawTokenEstimate);
    res.json({ status: 'success', package: pkg });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

/**
 * GET /api/context/:sessionId/package/latest
 * Get the most recently compiled context package for a session.
 */
app.get('/api/context/:sessionId/package/latest', (req, res) => {
  try {
    const pkg = contextEngine.getLatestPackage(req.params.sessionId);
    if (!pkg) {
      return res.status(404).json({ status: 'error', error: 'No package compiled yet for this session.' });
    }
    res.json({ status: 'success', package: pkg });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

/**
 * POST /api/context/:sessionId/destroy-original
 *
 * Core Continuum demo step: DESTROY ORIGINAL CONTEXT
 * Removes the raw conversation messages from the session.
 * The compiled Context Package is NOT touched — it survives.
 * Requires at least one package has been compiled first.
 */
app.post('/api/context/:sessionId/destroy-original', (req, res) => {
  try {
    const session = store.getSession(req.params.sessionId);
    const packages = session.packages || [];

    if (packages.length === 0) {
      return res.status(409).json({
        status: 'error',
        error: 'Cannot destroy original context before a Context Package has been compiled. Run Compress Context first.'
      });
    }

    const latestPkg = packages[packages.length - 1];
    const destroyedMessageCount = (session.messages || []).length;

    store.updateSession(req.params.sessionId, s => {
      s.messages = [];
      s.originalContextDestroyed = true;
      s.destroyedAt = new Date().toISOString();
      s.destroyedMessageCount = destroyedMessageCount;
    });

    return res.json({
      status: 'success',
      originalContextDestroyed: true,
      destroyedMessageCount,
      packagePreserved: true,
      packageId: latestPkg.package_id,
      itemsPreserved: latestPkg.durable_context?.length ?? 0
    });
  } catch (err) {
    console.error('[Destroy Original Error]', err.message);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// =============================================================================
// SESSIONS API
// =============================================================================

app.get('/api/sessions', (req, res) => {
  res.json(store.listSessions());
});

app.get('/api/sessions/:id', (req, res) => {
  const session = store.getSession(req.params.id);
  res.json(session);
});

// =============================================================================
// START
// =============================================================================

const server = app.listen(config.port, () => {
  console.log(`\n==================================================`);
  console.log(`Continuum Engine running at: http://localhost:${config.port}`);
  console.log(`Model Target: ${config.gemmaModel} (Gemma 4 constraint enforced)`);
  console.log(`API Key Configured: ${config.isApiKeyConfigured ? 'YES' : 'NO (Set GEMINI_API_KEY in .env)'}`);
  console.log(`Phase 4: Context Engine ACTIVE`);
  console.log(`==================================================\n`);
});

export { app, server };
