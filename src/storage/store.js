import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

/**
 * Simple file-backed JSON store for sessions, conversations, and context items.
 */
class LocalStore {
  constructor(filePath = path.join(config.dataDir, 'continuum_store.json')) {
    this.filePath = filePath;
    this.state = {
      sessions: {}, // sessionId -> { id, createdAt, updatedAt, messages: [], contextItems: [], packages: [] }
    };
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;

    try {
      if (!fs.existsSync(config.dataDir)) {
        fs.mkdirSync(config.dataDir, { recursive: true });
      }

      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.state = JSON.parse(raw);
      } else {
        this.persist();
      }
    } catch (err) {
      console.warn(`[Store] Could not load ${this.filePath}, initializing fresh store:`, err.message);
      this.state = { sessions: {} };
    }

    this.initialized = true;
  }

  persist() {
    try {
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.state, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      console.error('[Store] Failed to persist data:', err);
    }
  }

  getSession(sessionId) {
    this.init();
    if (!this.state.sessions[sessionId]) {
      const now = new Date().toISOString();
      this.state.sessions[sessionId] = {
        id: sessionId,
        createdAt: now,
        updatedAt: now,
        messages: [],
        contextItems: [],
        packages: []
      };
      this.persist();
    }
    return this.state.sessions[sessionId];
  }

  updateSession(sessionId, updater) {
    const session = this.getSession(sessionId);
    updater(session);
    session.updatedAt = new Date().toISOString();
    this.persist();
    return session;
  }

  listSessions() {
    this.init();
    return Object.values(this.state.sessions).map(s => ({
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messages.length,
      contextCount: s.contextItems.length
    }));
  }
}

export const store = new LocalStore();
