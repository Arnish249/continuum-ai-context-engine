import { ContextType, ContextStatus, validateContextItem, createContextItem, createContextPackage } from './types.js';
import { extractContextFromMessage, extractContextFromHistory, calculateImportance } from './extractor.js';
import { store } from '../storage/store.js';

/**
 * ContextEngine — Phase 4 Core
 *
 * Manages the full lifecycle of structured context items:
 *   1. Extraction (deterministic, rule-based via extractor.js)
 *   2. Classification  (assigned at extraction time)
 *   3. Importance scoring (deterministic, explainable)
 *   4. Storage (JSON file via store.js — existing approach retained)
 *   5. Package compilation (serializable snapshot of retained context)
 *   6. Inspector data (structured view of any context item)
 *
 * AI model communication is intentionally isolated — this engine has
 * NO dependency on GemmaService or any model API.
 */
export class ContextEngine {
  constructor() {
    this.store = store;
  }

  // ---------------------------------------------------------------------------
  // READ — context item retrieval
  // ---------------------------------------------------------------------------

  /**
   * Retrieve all context items for a session (all statuses).
   * @param {string} sessionId
   * @returns {Array<object>}
   */
  getContextItems(sessionId) {
    const session = this.store.getSession(sessionId);
    return session.contextItems || [];
  }

  /**
   * Retrieve only items in ACTIVE or STABLE status (or pinned).
   * @param {string} sessionId
   * @returns {Array<object>}
   */
  getActiveContextItems(sessionId) {
    return this.getContextItems(sessionId).filter(
      item => item.status === ContextStatus.ACTIVE ||
              item.status === ContextStatus.STABLE ||
              item.pinned
    );
  }

  /**
   * Get a single context item by id.
   * @param {string} sessionId
   * @param {string} itemId
   * @returns {object|null}
   */
  getContextItem(sessionId, itemId) {
    const items = this.getContextItems(sessionId);
    return items.find(i => i.id === itemId) || null;
  }

  // ---------------------------------------------------------------------------
  // WRITE — add / update / pin / archive
  // ---------------------------------------------------------------------------

  /**
   * Add a single validated context item to a session.
   * Accepts raw item data; importance is recalculated if not explicitly provided.
   * @param {string} sessionId
   * @param {object} itemData
   * @returns {object} The created and stored context item
   */
  addContextItem(sessionId, itemData) {
    // If no explicit importance, calculate it deterministically
    if (typeof itemData.importance !== 'number') {
      const { score, reasons } = calculateImportance(
        itemData.type,
        itemData.content || '',
        itemData.reason || ''
      );
      itemData.importance = score;
      itemData.importanceBreakdown = { score, reasons };
    }

    const item = createContextItem(itemData);

    this.store.updateSession(sessionId, session => {
      session.contextItems.push(item);
    });

    return item;
  }

  /**
   * Update an existing context item — only safe fields: status, pinned, reason, content.
   * type and id are immutable once created.
   * @param {string} sessionId
   * @param {string} itemId
   * @param {object} updates  — allowed: { status, pinned, reason, content }
   * @returns {object} Updated item
   */
  updateContextItem(sessionId, itemId, updates) {
    const ALLOWED = new Set(['status', 'pinned', 'reason', 'content', 'importance']);
    const sanitized = {};
    for (const [k, v] of Object.entries(updates)) {
      if (ALLOWED.has(k)) sanitized[k] = v;
    }

    let updatedItem = null;
    this.store.updateSession(sessionId, session => {
      const idx = session.contextItems.findIndex(i => i.id === itemId);
      if (idx !== -1) {
        session.contextItems[idx] = {
          ...session.contextItems[idx],
          ...sanitized
        };
        const validation = validateContextItem(session.contextItems[idx]);
        if (!validation.valid) {
          throw new Error(`Validation failed after update: ${validation.errors.join(', ')}`);
        }
        updatedItem = session.contextItems[idx];
      }
    });

    if (!updatedItem) {
      throw new Error(`Context item ${itemId} not found in session ${sessionId}`);
    }

    return updatedItem;
  }

  /**
   * Toggle the pinned state of a context item.
   * Pinned items are always retained in packages regardless of status.
   * @param {string} sessionId
   * @param {string} itemId
   * @returns {object} Updated item
   */
  togglePin(sessionId, itemId) {
    const item = this.getContextItem(sessionId, itemId);
    if (!item) throw new Error(`Context item ${itemId} not found`);
    return this.updateContextItem(sessionId, itemId, { pinned: !item.pinned });
  }

  /**
   * Archive a context item (soft-delete equivalent).
   * @param {string} sessionId
   * @param {string} itemId
   * @returns {object} Updated item
   */
  archiveContextItem(sessionId, itemId) {
    return this.updateContextItem(sessionId, itemId, { status: ContextStatus.ARCHIVED });
  }

  // ---------------------------------------------------------------------------
  // EXTRACTION — deterministic pipeline
  // ---------------------------------------------------------------------------

  /**
   * Extract context from a single new user message and persist any found items.
   * This is called after each user turn.
   *
   * Does NOT call Gemma/any AI. Pure rule-based.
   *
   * @param {string} sessionId
   * @param {string} messageText  — the user's message content
   * @param {string} turnLabel    — e.g. "Turn #3"
   * @returns {Array<object>}     — newly created context items (may be empty)
   */
  async extractContext(sessionId, messageText, turnLabel = 'User message') {
    const rawItems = extractContextFromMessage(messageText, turnLabel);
    const created = [];

    for (const raw of rawItems) {
      // Avoid near-duplicate content within a session
      if (this._isDuplicate(sessionId, raw.content)) continue;
      try {
        const item = this.addContextItem(sessionId, raw);
        created.push(item);
      } catch (err) {
        console.warn('[ContextEngine] Skipped invalid extraction:', err.message);
      }
    }

    return created;
  }

  /**
   * Re-extract context from the full message history of a session.
   * Useful on session load or after a reset.
   * Clears existing context items first.
   *
   * @param {string} sessionId
   * @param {Array<object>} messages
   * @returns {Array<object>} All newly created context items
   */
  async rebuildContextFromHistory(sessionId, messages) {
    // Clear existing items
    this.store.updateSession(sessionId, session => {
      session.contextItems = [];
    });

    const rawItems = extractContextFromHistory(messages);
    const created = [];

    for (const raw of rawItems) {
      if (this._isDuplicate(sessionId, raw.content)) continue;
      try {
        const item = this.addContextItem(sessionId, raw);
        created.push(item);
      } catch (err) {
        console.warn('[ContextEngine] Skipped invalid extraction:', err.message);
      }
    }

    return created;
  }

  // ---------------------------------------------------------------------------
  // PACKAGE — compile a context package
  // ---------------------------------------------------------------------------

  /**
   * Compile the current active context into a serializable Context Package.
   * The package contains only retained (ACTIVE/STABLE/pinned) items.
   *
   * @param {string} sessionId
   * @param {number} rawTokenEstimate — estimated token count of the raw conversation
   * @returns {object}  A Context Package (safe to JSON.stringify and persist)
   */
  async createPackage(sessionId, rawTokenEstimate = 0) {
    const allItems = this.getContextItems(sessionId);
    const pkg = createContextPackage({ sessionId, items: allItems, rawTokenEstimate });

    // Persist the package in the session
    this.store.updateSession(sessionId, session => {
      if (!session.packages) session.packages = [];
      session.packages.push(pkg);
      // Keep only last 10 packages to avoid unbounded growth
      if (session.packages.length > 10) {
        session.packages = session.packages.slice(-10);
      }
    });

    return pkg;
  }

  /**
   * Get the most recently compiled package for a session, or null.
   * @param {string} sessionId
   * @returns {object|null}
   */
  getLatestPackage(sessionId) {
    const session = this.store.getSession(sessionId);
    const packages = session.packages || [];
    return packages.length > 0 ? packages[packages.length - 1] : null;
  }

  // ---------------------------------------------------------------------------
  // INSPECTOR — structured view for UI
  // ---------------------------------------------------------------------------

  /**
   * Get the full inspector data object for a context item.
   * This is the data model the Context Inspector UI renders.
   *
   * @param {string} sessionId
   * @param {string} itemId
   * @returns {object|null}
   */
  getInspectorData(sessionId, itemId) {
    const item = this.getContextItem(sessionId, itemId);
    if (!item) return null;

    const impClass = item.importance >= 4 ? 'high' : item.importance === 3 ? 'med' : 'low';
    const impLabel = item.importance >= 4 ? 'HIGH' : item.importance === 3 ? 'MEDIUM' : 'LOW';

    // Compute retention rate based on importance + status
    const retentionRate = this._computeRetentionRate(item);

    return {
      id: item.id,
      type: item.type,
      content: item.content,
      importance: item.importance,
      importance_label: impLabel,
      importance_class: impClass,
      importance_breakdown: item.importance_breakdown || null,
      status: item.status,
      pinned: item.pinned,
      source_message: item.source_message,
      reason: item.reason,
      retention_rate: retentionRate,
      created_at: item.created_at
    };
  }

  /**
   * Compute metrics across all active items for display in the panel header.
   * @param {string} sessionId
   * @returns {object}
   */
  getSessionMetrics(sessionId) {
    const items = this.getContextItems(sessionId);
    const active = items.filter(i => i.status === ContextStatus.ACTIVE || i.status === ContextStatus.STABLE || i.pinned);
    const archived = items.filter(i => i.status === ContextStatus.ARCHIVED);

    // Weighted retention health: avg importance of active items / 5 * 100
    const avgImportance = active.length > 0
      ? active.reduce((sum, i) => sum + i.importance, 0) / active.length
      : 0;
    const healthPct = active.length > 0 ? Math.round((avgImportance / 5) * 100) : 100;

    const byType = {};
    for (const type of Object.values(ContextType)) {
      byType[type] = active.filter(i => i.type === type).length;
    }

    return {
      total: items.length,
      active: active.length,
      archived: archived.length,
      pinned: active.filter(i => i.pinned).length,
      health_pct: healthPct,
      by_type: byType
    };
  }

  // ---------------------------------------------------------------------------
  // CONTINUITY / CONFLICT HOOKS (later phases)
  // ---------------------------------------------------------------------------

  /**
   * [Phase 5 Hook] Continuity Verification
   */
  async verifyContinuity(_sessionId, _contextPackage) {
    throw new Error('Continuity testing will be implemented in Phase 5.');
  }

  /**
   * [Phase 6 Hook] Conflict Detection
   */
  async detectConflicts(_sessionId, _newInformation) {
    throw new Error('Conflict detection will be implemented in Phase 6.');
  }

  // ---------------------------------------------------------------------------
  // PRIVATE helpers
  // ---------------------------------------------------------------------------

  /**
   * Check if a content string is a near-duplicate of an existing item in the session.
   * Uses normalized lowercase comparison.
   */
  _isDuplicate(sessionId, content) {
    const existing = this.getContextItems(sessionId);
    const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const target = norm(content);
    return existing.some(item => norm(item.content) === target);
  }

  /**
   * Compute a projected retention rate % for display.
   * Based on importance (higher = higher retention) and status.
   */
  _computeRetentionRate(item) {
    if (item.pinned) return '100%';
    if (item.status === ContextStatus.ARCHIVED) return '0%';
    if (item.status === ContextStatus.STALE) return '25%';
    // Base: 60% + 8% per importance point
    const base = 60 + (item.importance * 8);
    return `${Math.min(100, base)}%`;
  }
}

export const contextEngine = new ContextEngine();
