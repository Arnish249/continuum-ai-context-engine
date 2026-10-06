import test from 'node:test';
import assert from 'node:assert/strict';
import { GemmaService } from '../src/services/gemma.js';
import { store } from '../src/storage/store.js';

test('Chat Test: Missing API key throws clear 503 error', async () => {
  const service = new GemmaService({ apiKey: '', ollamaBaseUrl: null });
  
  await assert.rejects(
    async () => {
      await service.generate({ messages: [{ role: 'user', content: 'Hello' }] });
    },
    (err) => {
      assert.equal(err.statusCode, 503);
      assert.match(err.message, /GEMINI_API_KEY is not configured/);
      return true;
    }
  );
});

test('Chat Test: Empty message history is rejected with 400', async () => {
  const service = new GemmaService({ apiKey: 'fake_key_for_test' });

  await assert.rejects(
    async () => {
      await service.generate({ messages: [] });
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /Conversation history cannot be empty/);
      return true;
    }
  );
});

test('Chat Test: Alternating message roles and consecutive message merging', async () => {
  let capturedBody = null;

  const mockFetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: 'I am Gemma 4 acknowledging your requirements.' }]
            }
          }
        ]
      })
    };
  };

  const service = new GemmaService({
    apiKey: 'fake_test_key',
    model: 'gemma-4-31b-it',
    fetchImpl: mockFetch
  });

  // Supply consecutive user turns to test role combining
  const messages = [
    { role: 'user', content: 'Turn 1: Smart parking system.' },
    { role: 'user', content: 'Turn 1b: Backend uses Flask.' },
    { role: 'assistant', content: 'Understood. Flask is noted.' },
    { role: 'user', content: 'Turn 2: Notify users on expiry.' }
  ];

  const result = await service.generate({ messages });

  assert.equal(result.text, 'I am Gemma 4 acknowledging your requirements.');
  assert.ok(capturedBody);
  
  // Verify contents structure
  const contents = capturedBody.contents;
  assert.equal(contents.length, 3);
  
  // First item must be user with 2 combined parts
  assert.equal(contents[0].role, 'user');
  assert.equal(contents[0].parts.length, 2);
  assert.equal(contents[0].parts[0].text, 'Turn 1: Smart parking system.');
  assert.equal(contents[0].parts[1].text, 'Turn 1b: Backend uses Flask.');

  // Second item is model
  assert.equal(contents[1].role, 'model');
  assert.equal(contents[1].parts[0].text, 'Understood. Flask is noted.');

  // Third item is user
  assert.equal(contents[2].role, 'user');
  assert.equal(contents[2].parts[0].text, 'Turn 2: Notify users on expiry.');
});

test('Chat Test: Handles API HTTP error responses (401, 429, 500)', async () => {
  // Test 401 Unauthorized
  const mock401Fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: { message: 'API_KEY_INVALID' } })
  });

  const service401 = new GemmaService({ apiKey: 'bad_key', fetchImpl: mock401Fetch });
  await assert.rejects(
    async () => {
      await service401.generate({ messages: [{ role: 'user', content: 'Test' }] });
    },
    (err) => {
      assert.equal(err.statusCode, 401);
      assert.match(err.message, /API_KEY_INVALID/);
      return true;
    }
  );

  // Test 429 Rate Limit
  const mock429Fetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: { message: 'RESOURCE_EXHAUSTED' } })
  });

  const service429 = new GemmaService({ apiKey: 'quota_key', fetchImpl: mock429Fetch });
  await assert.rejects(
    async () => {
      await service429.generate({ messages: [{ role: 'user', content: 'Test' }] });
    },
    (err) => {
      assert.equal(err.statusCode, 429);
      assert.match(err.message, /RESOURCE_EXHAUSTED/);
      return true;
    }
  );
});

test('Chat Test: Conversation history persists across turns in storage', () => {
  const sessionId = `test_chat_session_${Date.now()}`;
  
  store.updateSession(sessionId, session => {
    session.messages.push({
      id: 'msg_u1',
      role: 'user',
      content: 'Hello Gemma',
      timestamp: new Date().toISOString()
    });
    session.messages.push({
      id: 'msg_a1',
      role: 'assistant',
      content: 'Hello! How can I assist with your project architecture?',
      timestamp: new Date().toISOString()
    });
  });

  const loaded = store.getSession(sessionId);
  assert.equal(loaded.messages.length, 2);
  assert.equal(loaded.messages[0].content, 'Hello Gemma');
  assert.equal(loaded.messages[1].role, 'assistant');
});
