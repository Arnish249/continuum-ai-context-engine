# Continuum: AI Context Continuity Engine

> *"The Conversation That Outlives Its Context"*

Continuum is an AI Context Continuity Engine designed for the challenge of preserving durable, structured context across long conversations, enabling compression without critical knowledge loss, detecting contradictions, and restoring context transparently.

---

## Hard Architectural Constraint: Gemma 4

Continuum is strictly architected around **Gemma 4** (`gemma-4-31b-it` / `gemma-4-26b-a4b-it`):
- **Model Choice:** `gemma-4-31b-it` (31B Dense Instruction-Tuned Model) via Google Generative Language API.
- **Application Boundary:** Gemma 4 provides semantic reasoning, classification, compression synthesis, and continuity evaluation. The application-side engine deterministically owns data structures, schema validation, importance rankings, conflict graphs, and storage.
- **No Gemini Substitutions:** The engine strictly enforces Gemma 4 model targets.
- **No Heavyweight Bloat:** No external vector DBs, no RAG frameworks, no multi-agent bloat.

---

## Context Types Supported

Continuum classifies and tracks durable conversation knowledge into 6 primary types:

1. **`FACT`**: Objective, empirical assertions stated during conversation.
2. **`GOAL`**: Target outcomes or objectives the user wants to achieve.
3. **`DECISION`**: Explicit architectural or design choices finalized.
4. **`CONSTRAINT`**: Hard boundaries, dependencies, resource limits, or technical restrictions.
5. **`PREFERENCE`**: Subjective choices, aesthetic leanings, or workflow styles.
6. **`OPEN_LOOP`**: Unresolved questions, pending tasks, or follow-ups.

---

## Getting Started

### 1. Setup Environment
Copy `.env.example` to `.env` and insert your Google AI Studio API key:
```bash
cp .env.example .env
```
Edit `.env`:
```ini
GEMINI_API_KEY=your_google_ai_studio_key_here
GEMMA_MODEL=gemma-4-31b-it
```

### 2. Run Tests
```bash
npm test
```

### 3. Start Foundation Server
```bash
npm start
```
Open [http://localhost:3000](http://localhost:3000) to view the foundation status dashboard.
