/**
 * Continuum - Core Context Types and Item Schema
 *
 * Provides standard definitions and validation for structured context items
 * extracted from conversations with Gemma 4.
 */

export const ContextType = Object.freeze({
  FACT: 'FACT',
  GOAL: 'GOAL',
  DECISION: 'DECISION',
  CONSTRAINT: 'CONSTRAINT',
  PREFERENCE: 'PREFERENCE',
  OPEN_LOOP: 'OPEN_LOOP'
});

export const ContextStatus = Object.freeze({
  ACTIVE: 'ACTIVE',
  STABLE: 'STABLE',
  STALE: 'STALE',
  ARCHIVED: 'ARCHIVED',
  // Legacy — kept for backward compatibility with existing stored sessions
  SUPERSEDED: 'SUPERSEDED',
  CONFLICTING: 'CONFLICTING',
  RESOLVED: 'RESOLVED'
});

/**
 * Validates a single context item against the Continuum schema.
 * @param {object} item
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateContextItem(item) {
  const errors = [];

  if (!item || typeof item !== 'object') {
    return { valid: false, errors: ['Context item must be an object'] };
  }

  if (!item.id || typeof item.id !== 'string') {
    errors.push('id is required and must be a string');
  }

  if (!item.type || !Object.values(ContextType).includes(item.type)) {
    errors.push(`type must be one of: ${Object.values(ContextType).join(', ')}`);
  }

  if (!item.content || typeof item.content !== 'string' || item.content.trim() === '') {
    errors.push('content is required and must be non-empty string');
  }

  if (typeof item.importance !== 'number' || item.importance < 1 || item.importance > 5) {
    errors.push('importance must be an integer between 1 and 5');
  }

  if (item.status && !Object.values(ContextStatus).includes(item.status)) {
    errors.push(`status must be one of: ${Object.values(ContextStatus).join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Factory to create a standardized context item.
 */
export function createContextItem({
  id = `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
  type,
  content,
  importance = 3,
  status = ContextStatus.ACTIVE,
  sourceMessage = '',
  reason = '',
  importanceBreakdown = null,
  pinned = false,
  createdAt = new Date().toISOString()
}) {
  const item = {
    id,
    type,
    content: (content || '').trim(),
    importance: Math.min(5, Math.max(1, Math.round(importance))),
    status,
    source_message: sourceMessage,
    reason: reason.trim(),
    importance_breakdown: importanceBreakdown || null,
    pinned: Boolean(pinned),
    created_at: createdAt
  };

  const validation = validateContextItem(item);
  if (!validation.valid) {
    throw new Error(`Invalid context item: ${validation.errors.join('; ')}`);
  }

  return item;
}

/**
 * Schema for a serializable Context Package.
 * A package is the compressed, persistable representation of retained context.
 */
export function createContextPackage({
  sessionId,
  items = [],
  rawTokenEstimate = 0
}) {
  if (!sessionId) throw new Error('sessionId is required for a context package');

  const activeItems = items.filter(i =>
    i.status === ContextStatus.ACTIVE ||
    i.status === ContextStatus.STABLE ||
    i.pinned
  );

  // Estimate tokens from durable context content, excluding internal JSON bookkeeping
  const durableText = activeItems
    .map(item => [item.type, item.content, item.reason || ""].join(" "))
    .join(" ");
  const packageTokenEstimate = Math.ceil(durableText.length / 4);
  const compressionRatio = rawTokenEstimate > 0
    ? Math.round((1 - packageTokenEstimate / rawTokenEstimate) * 100)
    : 0;

  return {
    package_id: `pkg_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 4)}`,
    format_version: '1.1.0',
    schema: 'continuum-context-package',
    target_model: 'gemma-4-31b-it',
    session_id: sessionId,
    created_at: new Date().toISOString(),
    compression_metadata: {
      raw_buffer_tokens: rawTokenEstimate,
      package_tokens: packageTokenEstimate,
      compression_ratio_pct: compressionRatio,
      items_total: items.length,
      items_retained: activeItems.length,
      items_excluded: items.length - activeItems.length
    },
    durable_context: activeItems.map(item => ({
      id: item.id,
      type: item.type,
      content: item.content,
      importance: item.importance,
      status: item.status,
      pinned: item.pinned,
      retention_reason: item.reason,
      importance_breakdown: item.importance_breakdown || null
    }))
  };
}
