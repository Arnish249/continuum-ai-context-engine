/**
 * Continuum - Context Extractor
 *
 * Deterministic, rule-based extraction of structured context items from
 * raw conversation text. This module does NOT call any AI model — it uses
 * lexical and syntactic heuristics to identify probable context signals.
 *
 * AI-sourced extraction (Gemma 4) will supplement this when available.
 * The output of this module is always schema-validated before storage.
 */

import { ContextType } from './types.js';

// ---------------------------------------------------------------------------
// Signal dictionaries — curated, ordered by specificity
// ---------------------------------------------------------------------------

const GOAL_SIGNALS = [
  /\bbuilding\b.*\bsystem\b/i,
  /\bbuilding\b.*\bapp(?:lication)?\b/i,
  /\bcreating\b.*\bplatform\b/i,
  /\bdeveloping\b.*\bsolution\b/i,
  /\bwant to build\b/i,
  /\bgoal is to\b/i,
  /\baim(?:ing)? to\b/i,
  /\bproject is\b/i,
  /\bwe are building\b/i,
  /\bi(?:'m| am) building\b/i,
  /\bour product\b/i
];

const DECISION_SIGNALS = [
  /\busing\s+(?:flask|django|fastapi|express|spring|rails|laravel|next\.?js|nuxt|svelte|vue|react|angular)/i,
  /\busing\s+(?:postgresql|postgres|mysql|sqlite|mongodb|redis|cassandra|dynamodb|firebase|supabase|prisma)/i,
  /\busing\s+(?:docker|kubernetes|aws|gcp|azure|heroku|vercel|netlify|nginx|apache)/i,
  /\bbuilt\s+(?:with|in|on|using)\b/i,
  /\bchose\b/i,
  /\bdecided\s+(?:on|to)\b/i,
  /\bwill\s+use\b/i,
  /\bour\s+(?:stack|backend|frontend|database|db|api)\s+(?:is|will be|uses?)\b/i,
  /\b(?:backend|frontend|api|database|db)\s+(?:is|will be)\b/i,
  /\b(?:written|built|implemented)\s+in\b/i,
  /\barchitecture\s+(?:is|will be|uses?)\b/i
];

const CONSTRAINT_SIGNALS = [
  /\bmust\b/i,
  /\bhas to\b/i,
  /\brequired? to\b/i,
  /\bcannot\b/i,
  /\bmust not\b/i,
  /\bno .* allowed\b/i,
  /\blimited to\b/i,
  /\brestricted to\b/i,
  /\bnot allowed\b/i,
  /\bdeadline\b/i,
  /\bhardcoded\b/i,
  /\bcomply\b/i,
  /\bcompliance\b/i,
  /\bregulation\b/i,
  /\bsla\b/i,
  /\bthreshold\b/i,
  /\bmaximum\b/i,
  /\bminimum\b/i,
  /\bshould not\b/i,
  /\bshould never\b/i,
  /\bnotif(?:y|ication)\b/i
];

const PREFERENCE_SIGNALS = [
  /\bprefer\b/i,
  /\bi(?:'d| would)\s+like\b/i,
  /\bwould rather\b/i,
  /\bfavor(?:ite)?\b/i,
  /\bhope\s+(?:to|that)\b/i,
  /\bideal(?:ly)?\b/i,
  /\bif possible\b/i,
  /\bwhen possible\b/i,
  /\bwould be nice\b/i,
  /\boptionally\b/i,
  /\byou can\b/i,
  /\bstyle[ -](?:wise|guide)\b/i
];

const OPEN_LOOP_SIGNALS = [
  /\bnot\s+(?:sure|decided|sure\s+yet)\b/i,
  /\bstill\s+(?:figuring|deciding|working)\b/i,
  /\bopen\s+question\b/i,
  /\btodo\b/i,
  /\bpending\b/i,
  /\bhaven'?t\s+decided\b/i,
  /\bneed\s+to\s+(?:decide|figure|determine|choose)\b/i,
  /\bto\s+be\s+determined\b/i,
  /\btbd\b/i,
  /\bnot\s+yet\b/i,
  /\bopen\s+to\s+suggestions\b/i,
  /\bwhat\s+(?:should|would|do you)\b/i,
  /\bhow\s+(?:should|do you)\b/i,
  /\bwhich\s+(?:approach|option|should)\b/i
];

// ---------------------------------------------------------------------------
// Importance calculator — deterministic, every score is explainable
// ---------------------------------------------------------------------------

/**
 * Calculate importance score (1–5) for a context item with a full breakdown.
 * The scoring is purely rule-based. No AI confidence is involved.
 *
 * Scoring bands:
 *   5 = Critical — defines core product capability or hard constraint
 *   4 = High     — significant architectural or functional decision
 *   3 = Medium   — useful context, affects design but not blocking
 *   2 = Low      — supplementary preference or minor fact
 *   1 = Minimal  — incidental detail with limited impact
 *
 * @param {string} type   — ContextType value
 * @param {string} content — text content of the item
 * @param {string} reason  — retained reason
 * @returns {{ score: number, reasons: string[] }}
 */
export function calculateImportance(type, content, reason = '') {
  const reasons = [];
  let score = 2; // baseline

  const text = `${content} ${reason}`.toLowerCase();

  // --- Type-based baseline ---
  switch (type) {
    case ContextType.CONSTRAINT:
      score = 4;
      reasons.push('Constraints are binding — they restrict valid implementations (base: 4)');
      break;
    case ContextType.GOAL:
      score = 4;
      reasons.push('Goals define the primary success criterion of the project (base: 4)');
      break;
    case ContextType.DECISION:
      score = 3;
      reasons.push('Decisions lock in architectural direction (base: 3)');
      break;
    case ContextType.FACT:
      score = 2;
      reasons.push('Facts provide supporting context (base: 2)');
      break;
    case ContextType.PREFERENCE:
      score = 2;
      reasons.push('Preferences guide but do not bind design (base: 2)');
      break;
    case ContextType.OPEN_LOOP:
      score = 3;
      reasons.push('Open loops represent unresolved decisions that must be tracked (base: 3)');
      break;
  }

  // --- Content signal boosters (+1 each, max total 5) ---

  // Critical keywords in content
  if (/\b(?:must|required?|critical|essential|mandatory|compliance|security|auth(?:entication)?|privacy)\b/i.test(content)) {
    score = Math.min(5, score + 1);
    reasons.push('+1: Content contains a critical/mandatory keyword');
  }

  // Core data layer / irreversible decisions
  if (/\b(?:database|schema|migration|postgresql|mysql|mongodb|redis|storage|persistence)\b/i.test(content)) {
    score = Math.min(5, score + 1);
    reasons.push('+1: Involves data storage — schema decisions are difficult to reverse');
  }

  // User-facing / notification / deadline constraints
  if (/\b(?:notif(?:y|ication|ies)|expir(?:e|es|y|ation)|deadline|timeout|alert|remind)\b/i.test(content)) {
    score = Math.min(5, score + 1);
    reasons.push('+1: Time-sensitive or notification-critical logic');
  }

  // Financial or regulatory compliance
  if (/\b(?:payment|billing|gdpr|hipaa|pci|legal|regulation|audit|compli(?:ant|ance))\b/i.test(content)) {
    score = Math.min(5, score + 1);
    reasons.push('+1: Compliance or financial impact raises retention priority');
  }

  // Primary tech stack mentions (framework + DB combos amplify importance)
  const techMentions = (text.match(/\b(?:flask|django|fastapi|express|spring|postgresql|mysql|mongodb|redis|docker|kubernetes)\b/gi) || []).length;
  if (techMentions >= 2) {
    score = Math.min(5, score + 1);
    reasons.push('+1: Multiple technology stack components mentioned — high coupling impact');
  }

  // Depressors: preferences and open loops with soft language get capped
  if (type === ContextType.PREFERENCE) {
    score = Math.min(3, score);
    reasons.push('Capped at 3: Preferences are non-binding by definition');
  }

  if (type === ContextType.OPEN_LOOP && score > 4) {
    score = 4;
    reasons.push('Capped at 4: Open loops are unresolved — max importance before confirmed');
  }

  return {
    score: Math.min(5, Math.max(1, score)),
    reasons
  };
}

// ---------------------------------------------------------------------------
// Sentence classifier — assigns the best-matching ContextType to a sentence
// ---------------------------------------------------------------------------

/**
 * Given a sentence, return the most likely ContextType or null if unclear.
 * @param {string} sentence
 * @returns {string|null}
 */
function classifySentence(sentence) {
  const s = sentence.trim();
  if (!s || s.length < 10) return null;

  // Priority order: CONSTRAINT > GOAL > DECISION > OPEN_LOOP > PREFERENCE > FACT
  if (CONSTRAINT_SIGNALS.some(r => r.test(s))) return ContextType.CONSTRAINT;
  if (GOAL_SIGNALS.some(r => r.test(s))) return ContextType.GOAL;
  if (DECISION_SIGNALS.some(r => r.test(s))) return ContextType.DECISION;
  if (OPEN_LOOP_SIGNALS.some(r => r.test(s))) return ContextType.OPEN_LOOP;
  if (PREFERENCE_SIGNALS.some(r => r.test(s))) return ContextType.PREFERENCE;

  return null; // no clear signal — skip
}

// ---------------------------------------------------------------------------
// Reason generator — produces a one-sentence human-readable retention reason
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic retention reason for a context item.
 * @param {string} type
 * @param {string} content
 * @returns {string}
 */
function generateReason(type, content) {
  const c = content.toLowerCase();

  switch (type) {
    case ContextType.CONSTRAINT:
      if (/notif|expir|alert|remind/.test(c)) {
        return 'Hard operational boundary: drives background task scheduler design and user-facing alert logic.';
      }
      if (/must|required|mandatory/.test(c)) {
        return 'Mandatory requirement: restricts valid implementation paths and must survive all context reductions.';
      }
      return 'Binding constraint: limits the solution space and must be checked against all future decisions.';

    case ContextType.GOAL:
      return 'Primary project objective: defines scope, success criteria, and domain boundaries.';

    case ContextType.DECISION:
      if (/database|postgresql|mysql|mongo|redis/.test(c)) {
        return 'Data layer decision: determines schema design, query patterns, and ORM/driver compatibility.';
      }
      if (/flask|django|express|fastapi|spring/.test(c)) {
        return 'Framework decision: sets runtime, routing conventions, middleware choices, and deployment model.';
      }
      return 'Architectural decision: locks in a significant technical direction that downstream components depend on.';

    case ContextType.PREFERENCE:
      return 'Design preference: guides aesthetic and ergonomic choices without binding the implementation.';

    case ContextType.OPEN_LOOP:
      return 'Unresolved decision: requires future clarification before a dependent component can be finalized.';

    case ContextType.FACT:
      return 'Established fact: provides foundational context that other reasoning items may reference.';

    default:
      return 'Retained because it appears to carry decision-relevant information.';
  }
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

/**
 * Extract structured context items from a single user message.
 *
 * Splits the text into sentences, classifies each, calculates importance,
 * and returns an array of raw item data (not yet persisted).
 *
 * @param {string} messageText    — the raw user message
 * @param {string} sourceLabel    — human-readable turn reference (e.g. "Turn #2")
 * @returns {Array<object>}       — array of structured context item data
 */
export function extractContextFromMessage(messageText, sourceLabel = 'User message') {
  if (!messageText || typeof messageText !== 'string') return [];

  const text = messageText.trim();
  if (text.length < 10) return [];

  // Split into sentences on . ! ? or newlines, filter noise
  const sentences = text
    .split(/(?<=[.!?\n])\s+|(?<=\n)\s*/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length >= 10);

  const extracted = [];
  const seenContent = new Set(); // deduplicate within a single message

  for (const sentence of sentences) {
    const type = classifySentence(sentence);
    if (!type) continue;

    // Normalize content — strip trailing punctuation
    const content = sentence.replace(/[.!?]+$/, '').trim();
    const contentKey = content.toLowerCase().replace(/\s+/g, ' ');

    if (seenContent.has(contentKey)) continue;
    seenContent.add(contentKey);

    const { score, reasons } = calculateImportance(type, content);
    const reason = generateReason(type, content);

    extracted.push({
      type,
      content,
      importance: score,
      sourceMessage: sourceLabel,
      reason,
      importanceBreakdown: {
        score,
        reasons
      }
    });
  }

  return extracted;
}

/**
 * Extract context from the full message history for a session.
 * Only processes user messages. Skips assistant turns (they are responses, not specifications).
 *
 * @param {Array<{role: string, content: string, id?: string}>} messages
 * @returns {Array<object>} raw item data array
 */
export function extractContextFromHistory(messages) {
  if (!Array.isArray(messages)) return [];

  const results = [];
  let turnNumber = 0;

  for (const msg of messages) {
    if (msg.role === 'user') {
      turnNumber++;
      const items = extractContextFromMessage(msg.content, `Turn #${turnNumber}`);
      results.push(...items);
    }
  }

  return results;
}
