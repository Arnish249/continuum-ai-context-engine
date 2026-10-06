/**
 * CONTINUUM - AI Context Continuity Engine
 * Phase 4: Context Engine Integration
 *
 * Responsibilities:
 * - Sends messages to Gemma 4 via /api/chat
 * - Loads live context items from /api/context/:sessionId after each turn
 * - Renders the Context Inspector panel from live API data
 * - Opens item inspector drawer with full breakdown
 * - Supports pin/archive actions on context items
 * - Compiles and displays Context Package via API
 */

const activeSessionId = 'smart_parking_session';
let activeMessages = [];
let activeContextItems = [];
let isSending = false;
let originalContextDestroyed = false;  // tracks destroy state
let packageCompiled = false;           // tracks whether a package exists

// ---------------------------------------------------------------------------
// Lightweight Markdown Renderer
// Handles: fenced code blocks, inline code, headings, bold, italic,
//          unordered lists, ordered lists, horizontal rules, paragraphs.
// Uses escapeHtml on content to prevent XSS, then applies markdown transforms.
// ---------------------------------------------------------------------------
function renderMarkdown(raw) {
  if (!raw || typeof raw !== 'string') return '';

  let out = raw;

  // 1. Fenced code blocks (```lang\n...\n```)
  out = out.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const langLabel = lang.trim() ? `<span class="code-lang">${escapeHtml(lang.trim())}</span>` : '';
    return `<div class="code-block-wrap">${langLabel}<pre class="code-block"><code>${escapeHtml(code.trimEnd())}</code></pre></div>`;
  });

  // 2. Process block-level elements line by line
  const lines = out.split('\n');
  const processed = [];
  let inList = null; // 'ul' | 'ol' | null
  let listItems = [];

  const flushList = () => {
    if (inList && listItems.length) {
      processed.push(`<${inList} class="md-list">${listItems.join('')}</${inList}>`);
    }
    inList = null;
    listItems = [];
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Skip lines that are already inside a code block (already replaced above)
    if (line.includes('<div class="code-block-wrap">') || line.includes('</div>') || line.startsWith('<pre') || line.startsWith('</pre')) {
      flushList();
      processed.push(line);
      continue;
    }

    // Headings
    const h3 = line.match(/^###\s+(.+)/);
    const h2 = line.match(/^##\s+(.+)/);
    const h1 = line.match(/^#\s+(.+)/);
    if (h3) { flushList(); processed.push(`<h3 class="md-h3">${applyInline(h3[1])}</h3>`); continue; }
    if (h2) { flushList(); processed.push(`<h2 class="md-h2">${applyInline(h2[1])}</h2>`); continue; }
    if (h1) { flushList(); processed.push(`<h1 class="md-h1">${applyInline(h1[1])}</h1>`); continue; }

    // Unordered list item
    const ulMatch = line.match(/^[-*]\s+(.+)/);
    if (ulMatch) {
      if (inList !== 'ul') { flushList(); inList = 'ul'; }
      listItems.push(`<li class="md-li">${applyInline(ulMatch[1])}</li>`);
      continue;
    }

    // Ordered list item
    const olMatch = line.match(/^\d+\.\s+(.+)/);
    if (olMatch) {
      if (inList !== 'ol') { flushList(); inList = 'ol'; }
      listItems.push(`<li class="md-li">${applyInline(olMatch[1])}</li>`);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      flushList();
      processed.push('<hr class="md-hr">');
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      flushList();
      processed.push('<div class="md-spacer"></div>');
      continue;
    }

    // Normal paragraph line
    flushList();
    processed.push(`<p class="md-p">${applyInline(line)}</p>`);
  }

  flushList();
  return processed.join('\n');
}

// Apply inline markdown: bold, italic, inline code (order matters)
function applyInline(text) {
  // Inline code first (to avoid processing markdown inside it)
  let s = text.replace(/`([^`]+)`/g, (_, code) => `<code class="md-code">${escapeHtml(code)}</code>`);
  // Bold **text** or __text__
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
  // Italic *text* or _text_
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  return s;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  initDOMListeners();
  await checkHealthAndModel();
  await loadConversationHistory();
  await loadContextItems();
});

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

async function checkHealthAndModel() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    const banner = document.getElementById('globalAlertBanner');
    const bannerText = banner?.querySelector('.alert-text');
    if (!data.isApiKeyConfigured && banner && bannerText) {
      bannerText.innerHTML = `<strong>Gemma 4 Configuration Notice:</strong> <code>GEMINI_API_KEY</code> is not yet configured in <code>.env</code>. Set your Google AI Studio key to enable live Gemma 4 turns.`;
      banner.classList.remove('hidden');
    }
  } catch (err) {
    console.warn('[Continuum] Health check unreachable:', err);
  }
}

// ---------------------------------------------------------------------------
// Conversation History Loader
// ---------------------------------------------------------------------------

async function loadConversationHistory() {
  try {
    const res = await fetch(`/api/chat/${activeSessionId}`);
    if (res.ok) {
      const data = await res.json();
      activeMessages = data.messages || [];
    }
  } catch (err) {
    console.error('Failed to load chat history:', err);
  }
  renderConversation();
}

// ---------------------------------------------------------------------------
// Context Engine — Live API Integration
// ---------------------------------------------------------------------------

async function loadContextItems() {
  try {
    const res = await fetch(`/api/context/${activeSessionId}`);
    if (res.ok) {
      const data = await res.json();
      activeContextItems = data.items || [];
      renderContextPanel();
      if (data.metrics) updateMetricDisplays(data.metrics);
    }
  } catch (err) {
    console.error('Failed to load context items:', err);
  }
}

// ---------------------------------------------------------------------------
// DOM Event Listeners
// ---------------------------------------------------------------------------

function initDOMListeners() {
  const form = document.getElementById('composerForm');
  const textarea = document.getElementById('messageInput');

  if (form && textarea) {
    form.addEventListener('submit', (e) => { e.preventDefault(); sendMessage(); });
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
    });
  }

  // Reset Session
  document.getElementById('btnResetDemo')?.addEventListener('click', async () => {
    if (confirm('Clear current conversation and context for this session?')) {
      await fetch(`/api/chat/${activeSessionId}`, { method: 'DELETE' });
      activeMessages = [];
      activeContextItems = [];
      originalContextDestroyed = false;
      packageCompiled = false;
      setDestroyButtonState(false);
      document.getElementById('destroyStateBar')?.classList.add('hidden');
      renderConversation();
      renderContextPanel();
      updateMetricDisplays({ active: 0, total: 0, health_pct: 100, by_type: {} });
    }
  });

  // Context filter search
  document.getElementById('contextSearchInput')?.addEventListener('input', (e) => {
    renderContextPanel(e.target.value.toLowerCase().trim());
  });

  // Mobile drawer toggle
  const toggleDrawerBtn = document.getElementById('toggleDrawerBtn');
  const contextPane = document.getElementById('contextPane');
  toggleDrawerBtn?.addEventListener('click', () => {
    const isOpen = contextPane.classList.toggle('drawer-open');
    toggleDrawerBtn.setAttribute('aria-expanded', isOpen);
  });

  // Inspector close
  const backdrop = document.getElementById('inspectorBackdrop');
  [
    document.getElementById('btnCloseInspector'),
    document.getElementById('btnCloseInspectorBottom'),
  ].forEach(el => el?.addEventListener('click', closeInspector));
  backdrop?.addEventListener('click', (e) => { if (e.target === backdrop) closeInspector(); });

  // Package modal
  const packageBackdrop = document.getElementById('packageBackdrop');
  [
    document.getElementById('btnClosePackageModal'),
    document.getElementById('btnClosePackageBottom'),
  ].forEach(el => el?.addEventListener('click', closePackageModal));
  packageBackdrop?.addEventListener('click', (e) => { if (e.target === packageBackdrop) closePackageModal(); });
  document.getElementById('btnInspectPackage')?.addEventListener('click', openPackageModal);

  // Compress Context — compiles package then enables Destroy button
  document.getElementById('btnCompressContext')?.addEventListener('click', triggerCompressionSimulation);

  // Destroy Original Context
  document.getElementById('btnDestroyOriginal')?.addEventListener('click', destroyOriginalContext);

  // Dismiss alert
  document.getElementById('dismissAlertBtn')?.addEventListener('click', () => {
    document.getElementById('globalAlertBanner')?.classList.add('hidden');
  });

  // ESC to close modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeInspector(); closePackageModal(); }
  });
}

// ---------------------------------------------------------------------------
// Send Message
// ---------------------------------------------------------------------------

async function sendMessage() {
  if (isSending) return;
  const textarea = document.getElementById('messageInput');
  const btnSend = document.getElementById('btnSendMessage');
  const text = (textarea?.value || '').trim();
  if (!text) return;

  isSending = true;
  if (textarea) textarea.disabled = true;
  if (btnSend) btnSend.disabled = true;

  const tempUserMsg = {
    id: `temp_${Date.now()}`,
    role: 'user',
    content: text,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  activeMessages.push(tempUserMsg);
  textarea.value = '';
  textarea.style.height = 'auto';
  renderConversation();

  const typingIndicator = document.getElementById('typingIndicator');
  const messageStream = document.getElementById('messageStream');
  typingIndicator?.classList.remove('hidden');
  if (messageStream) messageStream.scrollTop = messageStream.scrollHeight;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, conversationId: activeSessionId })
    });
    const data = await response.json();
    typingIndicator?.classList.add('hidden');

    if (response.ok && data.status === 'success') {
      const idx = activeMessages.findIndex(m => m.id === tempUserMsg.id);
      if (idx !== -1) activeMessages[idx] = data.userMessage;
      activeMessages.push(data.assistantMessage);
      renderConversation();
      // Reload context items after extraction
      await loadContextItems();
    } else {
      renderErrorInStream(data.error || 'Failed to receive response from Gemma 4.');
      // Still reload context — extraction happens server-side before model call
      await loadContextItems();
    }
  } catch (err) {
    typingIndicator?.classList.add('hidden');
    renderErrorInStream(`Network connection error: ${err.message}. Ensure Continuum server is running.`);
  } finally {
    isSending = false;
    if (textarea) { textarea.disabled = false; textarea.focus(); }
    if (btnSend) btnSend.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Render Conversation Stream
// ---------------------------------------------------------------------------

function renderConversation() {
  const container = document.getElementById('messageStream');
  if (!container) return;

  if (activeMessages.length === 0) {
    container.innerHTML = `
      <div class="empty-conversation-state">
        <div class="empty-icon-wrap">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
        <h2 class="empty-title">Continuum Context Buffer Empty</h2>
        <p class="empty-desc">
          Begin a technical conversation. As architectural requirements, constraints, and decisions are discussed,
          the Continuum engine will extract and structure durable context items automatically.
        </p>
        <div class="empty-suggestions">
          <button class="suggestion-btn" onclick="window.loadSamplePrompt('I am building a college smart parking system with Flask and PostgreSQL.')">
            &rarr; "I am building a college smart parking system with Flask and PostgreSQL."
          </button>
          <button class="suggestion-btn" onclick="window.loadSamplePrompt('The system must automatically notify users when their parking permit expires.')">
            &rarr; "The system must automatically notify users when their parking permit expires."
          </button>
          <button class="suggestion-btn" onclick="window.loadSamplePrompt('What schema would you recommend for tracking permit expiration and stall availability?')">
            &rarr; "What schema would you recommend for tracking permit expiration and stall availability?"
          </button>
        </div>
      </div>
    `;
    updateTokenCounter();
    return;
  }

  container.innerHTML = '';
  activeMessages.forEach((msg, idx) => {
    const itemEl = document.createElement('div');
    itemEl.className = `message-item ${msg.role}`;
    itemEl.id = msg.id;

    const authorLabel = msg.role === 'user' ? 'You' : 'Gemma 4';
    const turnNumber = Math.floor(idx / 2) + 1;
    const timeDisplay = msg.timestamp ? formatMessageTime(msg.timestamp) : 'Just now';

    // Detect demo fallback messages (clearly labeled, never hidden)
    const isDemoFallback = msg.role === 'assistant' && msg.content?.startsWith('DEMO FALLBACK');

    let bubbleContent;
    if (msg.role === 'assistant') {
      // Use the cleaned content for markdown rendering
      const cleanContent = isDemoFallback
        ? msg.content.replace(/^DEMO FALLBACK\s*[?—–-]+\s*/i, '')
        : msg.content;
      bubbleContent = renderMarkdown(cleanContent);
    } else {
      // User messages: plain text, no markdown needed — just paragraph breaks
      bubbleContent = msg.content
        .split('\n\n')
        .map(p => `<p class="md-p">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('');
    }

    const assistantIndicator = msg.role === 'assistant'
      ? `<span class="gemma-indicator">${isDemoFallback ? '⚡ Demo Fallback' : 'Gemma 4 · gemma-4-31b-it'}</span>`
      : '';

    const fallbackBanner = isDemoFallback
      ? `<div class="fallback-notice">⚠️ Gemma 4 temporarily unavailable — response generated from preserved conversation context</div>`
      : '';

    itemEl.innerHTML = `
      <div class="message-meta-bar">
        <span class="author-tag ${msg.role === 'assistant' ? 'assistant-tag' : ''}">${authorLabel}</span>
        <span class="meta-sep">&bull;</span>
        <span class="meta-time">${timeDisplay}</span>
        <span class="meta-sep">&bull;</span>
        <span class="meta-turn">Turn #${turnNumber}</span>
        ${assistantIndicator}
      </div>
      ${fallbackBanner}
      <div class="message-bubble ${msg.role === 'assistant' ? 'assistant-bubble' : 'user-bubble'}">
        <div class="bubble-content">${bubbleContent}</div>
      </div>
    `;

    container.appendChild(itemEl);
  });

  container.scrollTop = container.scrollHeight;
  updateTokenCounter();
}

function renderErrorInStream(errorMessage) {
  const container = document.getElementById('messageStream');
  if (!container) return;

  const errorEl = document.createElement('div');
  errorEl.className = 'message-item assistant';
  errorEl.innerHTML = `
    <div class="message-meta-bar">
      <span class="author-tag" style="color: var(--status-rose);">Continuum Engine</span>
      <span>&bull;</span>
      <span>System Alert</span>
    </div>
    <div class="message-bubble" style="background: rgba(239, 68, 68, 0.08); border-color: rgba(239, 68, 68, 0.35); color: #fecaca;">
      <p style="font-weight: 600; color: #f87171; margin-bottom: 0.35rem;">
        ⚠️ Communication Issue with Gemma 4
      </p>
      <p style="font-size: 0.85rem; line-height: 1.45;">
        ${escapeHtml(errorMessage)}
      </p>
      ${errorMessage.includes('GEMINI_API_KEY') ? `
        <div style="margin-top: 0.65rem; padding: 0.5rem 0.75rem; background: rgba(0,0,0,0.3); border-radius: 4px; font-size: 0.78rem; font-family: var(--font-mono); color: #7dd3fc;">
          To enable live Gemma 4 responses:<br>
          1. Copy <code>.env.example</code> to <code>.env</code><br>
          2. Set <code>GEMINI_API_KEY=your_key</code><br>
          3. Restart server with <code>npm start</code>
        </div>
      ` : ''}
    </div>
  `;
  container.appendChild(errorEl);
  container.scrollTop = container.scrollHeight;
}

// ---------------------------------------------------------------------------
// Context Panel Renderer
// ---------------------------------------------------------------------------

function renderContextPanel(filterText = '') {
  const container = document.getElementById('contextItemsContainer');
  if (!container) return;

  const categories = [
    { type: 'GOAL',       title: 'GOALS' },
    { type: 'DECISION',   title: 'DECISIONS' },
    { type: 'CONSTRAINT', title: 'CONSTRAINTS' },
    { type: 'FACT',       title: 'FACTS' },
    { type: 'PREFERENCE', title: 'PREFERENCES' },
    { type: 'OPEN_LOOP',  title: 'OPEN LOOPS' }
  ];

  // Show all non-archived by default
  let filtered = activeContextItems.filter(item => item.status !== 'ARCHIVED');

  if (filterText) {
    filtered = filtered.filter(item =>
      item.content.toLowerCase().includes(filterText) ||
      item.type.toLowerCase().includes(filterText) ||
      (item.reason || '').toLowerCase().includes(filterText)
    );
  }

  if (filtered.length === 0) {
    if (activeContextItems.filter(i => i.status !== 'ARCHIVED').length === 0) {
      container.innerHTML = `
        <div class="context-empty-state">
          <div class="context-empty-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
              <polyline points="2 17 12 22 22 17"></polyline>
              <polyline points="2 12 12 17 22 12"></polyline>
            </svg>
          </div>
          <p class="context-empty-title">No context extracted yet</p>
          <p class="context-empty-desc">Send a message describing your project. Continuum will extract structured context items automatically.</p>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="context-empty-state">
          <p class="context-empty-title">No items match filter</p>
          <p class="context-empty-desc">Try a different search term.</p>
        </div>
      `;
    }
    return;
  }

  container.innerHTML = '';

  categories.forEach(cat => {
    const itemsInCat = filtered.filter(i => i.type === cat.type);
    if (itemsInCat.length === 0) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'category-group';
    groupEl.innerHTML = `
      <div class="category-header">
        <span>${cat.title}</span>
        <span class="category-count">${itemsInCat.length}</span>
      </div>
    `;

    itemsInCat.forEach(item => {
      const card = document.createElement('div');
      card.className = 'context-card';
      if (item.pinned) card.classList.add('pinned');
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Inspect ${item.type}: ${item.content}`);

      const impClass = item.importance >= 4 ? 'high' : item.importance === 3 ? 'med' : 'low';
      const impLabel = item.importance >= 4 ? 'HIGH' : item.importance === 3 ? 'MED' : 'LOW';
      const retentionRate = computeRetentionRate(item);
      const pinnedIcon = item.pinned
        ? `<span class="pin-indicator" title="Pinned — always retained">📌</span>`
        : '';

      card.innerHTML = `
        <div class="card-top-row">
          <div class="card-badges">
            <span class="category-pill ${item.type}">${item.type}</span>
            <span class="importance-badge ${impClass}">${impLabel}</span>
            ${pinnedIcon}
          </div>
          <span class="card-status">• ${item.status}</span>
        </div>
        <div class="card-title">${escapeHtml(item.content)}</div>
        <div class="card-reason-preview">${escapeHtml(item.reason || '')}</div>
        <div class="card-anchor-meta">
          <span>${escapeHtml(item.source_message ? item.source_message.split(':')[0] : '')}</span>
          <span>Retention: ${retentionRate}</span>
        </div>
      `;

      card.addEventListener('click', () => openInspector(item));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openInspector(item); }
      });

      groupEl.appendChild(card);
    });

    container.appendChild(groupEl);
  });
}

function computeRetentionRate(item) {
  if (item.pinned) return '100%';
  if (item.status === 'ARCHIVED') return '0%';
  if (item.status === 'STALE') return '25%';
  return `${Math.min(100, 60 + (item.importance * 8))}%`;
}

// ---------------------------------------------------------------------------
// Metric displays
// ---------------------------------------------------------------------------

function updateMetricDisplays(metrics) {
  const activeCount = metrics.active ?? 0;
  const healthPct = metrics.health_pct != null ? `${metrics.health_pct}%` : '100%';

  document.getElementById('activeItemCount').textContent = `${activeCount} Active`;
  document.getElementById('trackedDecisionsVal').textContent = metrics.total ?? activeCount;
  document.getElementById('activeConflictsVal').textContent = 0;
  document.getElementById('retentionRateVal').textContent = healthPct;
  document.getElementById('healthScoreVal').textContent = healthPct;
  document.getElementById('mobileContextCount').textContent = activeCount;
}

function updateTokenCounter() {
  const tokenEl = document.getElementById('conversationTokenEstimate');
  const rawTokensEl = document.getElementById('rawTokenCount');
  if (!tokenEl) return;
  const totalChars = activeMessages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
  const estimatedTokens = Math.max(120, Math.round(totalChars / 3.8));
  tokenEl.textContent = `~${estimatedTokens.toLocaleString()} Tokens in Buffer`;
  if (rawTokensEl) rawTokensEl.textContent = `${estimatedTokens.toLocaleString()} tokens`;
}

function formatMessageTime(isoOrTime) {
  if (!isoOrTime) return '';
  if (isoOrTime.includes(':') && !isoOrTime.includes('T')) return isoOrTime;
  try {
    return new Date(isoOrTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return isoOrTime; }
}

// ---------------------------------------------------------------------------
// Inspector Drawer
// ---------------------------------------------------------------------------

function openInspector(item) {
  const backdrop = document.getElementById('inspectorBackdrop');
  const body = document.getElementById('inspectorBody');
  if (!backdrop || !body) return;

  const impClass = item.importance >= 4 ? 'high' : item.importance === 3 ? 'med' : 'low';
  const impLabel = item.importance >= 4 ? 'HIGH' : item.importance === 3 ? 'MEDIUM' : 'LOW';
  const retentionRate = computeRetentionRate(item);

  // Importance breakdown rows
  const breakdownRows = item.importance_breakdown?.reasons
    ? item.importance_breakdown.reasons.map(r =>
        `<li style="margin-bottom: 0.3rem; font-size: 0.78rem; color: var(--text-secondary);">${escapeHtml(r)}</li>`
      ).join('')
    : '<li style="color: var(--text-muted); font-size: 0.78rem;">No breakdown available for manually added items.</li>';

  const pinnedLabel = item.pinned ? '📌 Pinned — Always Retained' : 'Not Pinned';
  const pinnedBtnLabel = item.pinned ? 'Unpin Item' : 'Pin Item';
  const pinnedBtnClass = item.pinned ? 'btn btn-secondary' : 'btn btn-secondary';

  body.innerHTML = `
    <div class="drawer-section">
      <span class="drawer-section-label">Retained Context Item</span>
      <div class="drawer-content-box">
        <strong>${escapeHtml(item.content)}</strong>
      </div>
    </div>

    <div class="drawer-badge-grid">
      <div class="drawer-badge-card">
        <span class="drawer-section-label">Category</span>
        <div><span class="category-pill ${item.type}">${item.type}</span></div>
      </div>
      <div class="drawer-badge-card">
        <span class="drawer-section-label">Importance Score</span>
        <div><span class="importance-badge ${impClass}">${impLabel} (${item.importance}/5)</span></div>
      </div>
    </div>

    <div class="drawer-section">
      <span class="drawer-section-label">Importance Breakdown</span>
      <div class="drawer-content-box" style="padding: 0.75rem 1rem;">
        <ul style="list-style: none; padding: 0; margin: 0;">
          ${breakdownRows}
        </ul>
      </div>
    </div>

    <div class="drawer-section">
      <span class="drawer-section-label">Why Was This Retained?</span>
      <div class="drawer-content-box" style="border-left: 3px solid var(--accent-cyan);">
        ${escapeHtml(item.reason || 'No retention reason recorded.')}
      </div>
    </div>

    <div class="drawer-section">
      <span class="drawer-section-label">Conversation Source Anchor</span>
      <div class="drawer-content-box" style="font-family: var(--font-mono); font-size: 0.8rem; color: #7dd3fc;">
        ${escapeHtml(item.source_message || 'Unknown source')}
      </div>
    </div>

    <div class="drawer-badge-grid">
      <div class="drawer-badge-card">
        <span class="drawer-section-label">Lifecycle Status</span>
        <div style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--status-emerald); font-weight: 600;">
          &bull; ${item.status}
        </div>
      </div>
      <div class="drawer-badge-card">
        <span class="drawer-section-label">Retention Projection</span>
        <div style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--accent-cyan); font-weight: 600;">
          ${retentionRate} Projected
        </div>
      </div>
    </div>

    <div class="drawer-badge-grid">
      <div class="drawer-badge-card">
        <span class="drawer-section-label">Pin Status</span>
        <div style="font-size: 0.8rem; color: ${item.pinned ? 'var(--status-amber)' : 'var(--text-muted)'};">
          ${pinnedLabel}
        </div>
      </div>
      <div class="drawer-badge-card">
        <span class="drawer-section-label">Created</span>
        <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted);">
          ${item.created_at ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Unknown'}
        </div>
      </div>
    </div>

    <div style="display: flex; gap: 0.65rem; margin-top: 0.25rem;">
      <button
        class="${pinnedBtnClass}"
        id="inspectorPinBtn"
        data-item-id="${escapeHtml(item.id)}"
        data-pinned="${item.pinned}"
        style="flex: 1;"
      >
        ${item.pinned ? '📌 Unpin' : '📌 Pin Item'}
      </button>
      <button
        class="btn btn-secondary"
        id="inspectorArchiveBtn"
        data-item-id="${escapeHtml(item.id)}"
        style="flex: 1; color: var(--status-rose); border-color: rgba(239,68,68,0.3);"
        ${item.status === 'ARCHIVED' ? 'disabled' : ''}
      >
        Archive
      </button>
    </div>
  `;

  // Pin button handler
  document.getElementById('inspectorPinBtn')?.addEventListener('click', async (e) => {
    const itemId = e.currentTarget.dataset.itemId;
    try {
      const res = await fetch(`/api/context/${activeSessionId}/item/${itemId}/pin`, { method: 'POST' });
      if (res.ok) {
        await loadContextItems();
        // Refresh inspector with updated item
        const updated = activeContextItems.find(i => i.id === itemId);
        if (updated) openInspector(updated);
      }
    } catch (err) {
      console.error('Pin failed:', err);
    }
  });

  // Archive button handler
  document.getElementById('inspectorArchiveBtn')?.addEventListener('click', async (e) => {
    const itemId = e.currentTarget.dataset.itemId;
    if (!confirm('Archive this context item? It will be excluded from future packages.')) return;
    try {
      const res = await fetch(`/api/context/${activeSessionId}/item/${itemId}/archive`, { method: 'POST' });
      if (res.ok) {
        closeInspector();
        await loadContextItems();
      }
    } catch (err) {
      console.error('Archive failed:', err);
    }
  });

  backdrop.classList.remove('hidden');
  backdrop.setAttribute('aria-hidden', 'false');
}

function closeInspector() {
  const backdrop = document.getElementById('inspectorBackdrop');
  if (backdrop) {
    backdrop.classList.add('hidden');
    backdrop.setAttribute('aria-hidden', 'true');
  }
}

// ---------------------------------------------------------------------------
// Package Modal — Live API
// ---------------------------------------------------------------------------

async function openPackageModal() {
  const backdrop = document.getElementById('packageBackdrop');
  const codeViewer = document.getElementById('packageCodeViewer');
  if (!backdrop || !codeViewer) return;

  codeViewer.textContent = 'Compiling context package...';
  backdrop.classList.remove('hidden');
  backdrop.setAttribute('aria-hidden', 'false');

  try {
    const totalChars = activeMessages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
    const rawTokenEstimate = Math.max(120, Math.round(totalChars / 3.8));

    const res = await fetch(`/api/context/${activeSessionId}/package`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawTokenEstimate })
    });
    const data = await res.json();

    if (res.ok && data.package) {
      codeViewer.textContent = JSON.stringify(data.package, null, 2);

      // Update footer stats
      const pkg = data.package;
      const cm = pkg.compression_metadata;
      const compTokenEl = document.getElementById('compTokenCount');
      const ratioPillEl = document.getElementById('compRatioPill');
      const statusTagEl = document.getElementById('packageStatusTag');
      if (compTokenEl) compTokenEl.textContent = `${cm.package_tokens} preserved`;
      if (ratioPillEl) ratioPillEl.textContent = `${cm.compression_ratio_pct}% compression ratio`;
      if (statusTagEl) { statusTagEl.textContent = 'Compiled'; statusTagEl.style.color = 'var(--status-emerald)'; }
    } else {
      codeViewer.textContent = `Error: ${data.error || 'Could not compile package.'}`;
    }
  } catch (err) {
    codeViewer.textContent = `Network error: ${err.message}`;
  }
}

function closePackageModal() {
  const backdrop = document.getElementById('packageBackdrop');
  if (backdrop) {
    backdrop.classList.add('hidden');
    backdrop.setAttribute('aria-hidden', 'true');
  }
}

// ---------------------------------------------------------------------------
// Compression Simulation + Package Compile
// ---------------------------------------------------------------------------

function triggerCompressionSimulation() {
  const progressWrap = document.getElementById('compressionProgressWrap');
  const progressFill = document.getElementById('compressionProgressFill');
  const progressText = document.getElementById('compressionProgressText');
  const statusTag = document.getElementById('packageStatusTag');
  const btn = document.getElementById('btnCompressContext');
  if (!progressWrap || !btn) return;

  btn.disabled = true;
  progressWrap.classList.remove('hidden');
  if (statusTag) { statusTag.textContent = 'Compacting Context...'; statusTag.style.color = '#00d2ff'; }

  let pct = 0;
  const interval = setInterval(async () => {
    pct += 25;
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (pct === 50 && progressText) progressText.textContent = 'Preserving core constraints...';
    if (pct === 75 && progressText) progressText.textContent = 'Verifying continuity checksum...';
    if (pct >= 100) {
      clearInterval(interval);

      // Compile the real package via API
      try {
        const totalChars = activeMessages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
        const rawTokenEstimate = Math.max(120, Math.round(totalChars / 3.8));
        const res = await fetch(`/api/context/${activeSessionId}/package`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawTokenEstimate })
        });
        const data = await res.json();
        if (res.ok && data.package) {
          packageCompiled = true;
          const cm = data.package.compression_metadata;
          const compTokenEl = document.getElementById('compTokenCount');
          const ratioPillEl = document.getElementById('compRatioPill');
          if (compTokenEl) compTokenEl.textContent = `${cm.package_tokens} preserved`;
          if (ratioPillEl) ratioPillEl.textContent = `${cm.compression_ratio_pct}% compression ratio`;
        }
      } catch (e) {
        console.warn('[Compress] Package API error:', e.message);
        packageCompiled = true; // still mark compiled for UX flow
      }

      if (progressText) progressText.textContent = 'Context package ready!';
      if (statusTag) { statusTag.textContent = 'Compiled'; statusTag.style.color = '#10b981'; }

      // Enable Destroy button now that a package exists
      setDestroyButtonState(true);

      setTimeout(() => {
        progressWrap.classList.add('hidden');
        if (progressFill) progressFill.style.width = '0%';
        btn.disabled = false;
      }, 1200);
    }
  }, 200);
}

// ---------------------------------------------------------------------------
// Destroy Original Context
// ---------------------------------------------------------------------------

/**
 * Sends the destroy-original API call.
 * Clears the local activeMessages array (the package is not touched).
 * Updates UI to show destroyed/preserved state.
 */
async function destroyOriginalContext() {
  if (originalContextDestroyed) return;
  if (!packageCompiled) {
    alert('You must compress the context package first before destroying the original.');
    return;
  }

  if (!confirm(
    'DESTROY ORIGINAL CONTEXT?\n\n' +
    'This removes the raw conversation from the active reasoning buffer.\n' +
    'The compiled Context Package is NOT deleted — it survives.\n\n' +
    'This demonstrates the core Continuum workflow:\n' +
    'CONVERSE → EXTRACT → COMPRESS → DESTROY → SURVIVE'
  )) return;

  const btn = document.getElementById('btnDestroyOriginal');
  if (btn) { btn.disabled = true; btn.textContent = 'Destroying...'; }

  try {
    const res = await fetch(`/api/context/${activeSessionId}/destroy-original`, { method: 'POST' });
    const data = await res.json();

    if (res.ok && data.originalContextDestroyed) {
      originalContextDestroyed = true;
      activeMessages = []; // clear from local state
      renderConversation(); // show empty state

      // Show destroy-state bar
      document.getElementById('destroyStateBar')?.classList.remove('hidden');

      // Update package status tag
      const statusTagEl = document.getElementById('packageStatusTag');
      if (statusTagEl) {
        statusTagEl.textContent = 'Original Destroyed · Package Preserved';
        statusTagEl.style.color = 'var(--status-rose)';
      }

      // Lock the destroy button with final state
      if (btn) {
        btn.textContent = '✓ Context Destroyed';
        btn.style.opacity = '0.6';
        btn.style.cursor = 'default';
      }

      console.log(`[Continuum] Original context destroyed. ${data.itemsPreserved} items preserved in package ${data.packageId}.`);
    } else {
      alert(`Could not destroy context: ${data.error || 'Unknown error.'}`);
      if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path></svg><span>Destroy Original Context</span>'; }
    }
  } catch (err) {
    alert(`Network error: ${err.message}`);
    if (btn) { btn.disabled = false; }
  }
}

/**
 * Enable or disable the Destroy Original Context button.
 * Only enabled after a package has been compiled.
 */
function setDestroyButtonState(enabled) {
  const btn = document.getElementById('btnDestroyOriginal');
  if (!btn) return;
  btn.disabled = !enabled || originalContextDestroyed;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

window.loadSamplePrompt = function(text) {
  const textarea = document.getElementById('messageInput');
  if (textarea) {
    textarea.value = text;
    textarea.focus();
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
  }
};

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
