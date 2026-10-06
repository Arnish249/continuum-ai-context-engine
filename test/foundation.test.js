import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextType, ContextStatus, validateContextItem, createContextItem } from '../src/engine/types.js';
import { config } from '../src/config.js';
import { store } from '../src/storage/store.js';
import { contextEngine } from '../src/engine/contextEngine.js';

test('Context Types: all 6 required types are present', () => {
  const expectedTypes = ['FACT', 'GOAL', 'DECISION', 'CONSTRAINT', 'PREFERENCE', 'OPEN_LOOP'];
  for (const type of expectedTypes) {
    assert.ok(ContextType[type], `ContextType.${type} should exist`);
    assert.equal(ContextType[type], type);
  }
});

test('Context Item Validation: valid item passes validation', () => {
  const item = {
    id: 'test_123',
    type: ContextType.FACT,
    content: 'User requires offline data storage.',
    importance: 4,
    status: ContextStatus.ACTIVE,
    source_message: 'I need all data stored locally on disk.',
    reason: 'Hard privacy constraint',
    created_at: new Date().toISOString()
  };

  const result = validateContextItem(item);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('Context Item Validation: rejects invalid type or empty content', () => {
  const invalidTypeItem = {
    id: 'test_124',
    type: 'INVALID_TYPE',
    content: 'Some content',
    importance: 3
  };
  const result1 = validateContextItem(invalidTypeItem);
  assert.equal(result1.valid, false);

  const emptyContentItem = {
    id: 'test_125',
    type: ContextType.GOAL,
    content: '   ',
    importance: 3
  };
  const result2 = validateContextItem(emptyContentItem);
  assert.equal(result2.valid, false);
});

test('Gemma 4 Configuration: strictly targets Gemma 4 model', () => {
  assert.ok(config.gemmaModel.startsWith('gemma-4'), `Model must start with gemma-4, got: ${config.gemmaModel}`);
  assert.ok(config.allowedModels.includes(config.gemmaModel));
});

test('Persistence & ContextEngine: adds and retrieves context items', () => {
  const testSessionId = `test_session_${Date.now()}`;
  
  const created = contextEngine.addContextItem(testSessionId, {
    type: ContextType.DECISION,
    content: 'Gemma 4 is the sole AI engine for Continuum',
    importance: 5,
    reason: 'Hard architectural requirement',
    sourceMessage: 'Prompt constraint'
  });

  assert.ok(created.id);
  assert.equal(created.type, ContextType.DECISION);
  assert.equal(created.importance, 5);

  const items = contextEngine.getContextItems(testSessionId);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, created.id);
  assert.equal(items[0].content, 'Gemma 4 is the sole AI engine for Continuum');
});
