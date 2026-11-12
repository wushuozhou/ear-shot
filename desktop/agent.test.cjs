const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ConversationStore,
  buildSystemPrompt,
  createSseParser,
  recallMemories,
} = require('./agent.cjs');

test('SSE parser handles split chunks, multiple events, and DONE', () => {
  const events = [];
  const parser = createSseParser(value => events.push(value));
  parser.push('data: {"a":1}\n\ndata: {"b":');
  parser.push('2}\n\ndata: [DO');
  parser.push('NE]\n\n');
  parser.finish();
  assert.deepEqual(events, ['{"a":1}', '{"b":2}', '[DONE]']);
});

test('system prompt follows persona, tone, memory, and constraints order', () => {
  const prompt = buildSystemPrompt({
    persona: 'PERSONA',
    tone: { systemPrompt: 'TONE' },
    memories: [{ text: 'MEMORY' }],
  });
  assert.ok(prompt.indexOf('PERSONA') < prompt.indexOf('TONE'));
  assert.ok(prompt.indexOf('TONE') < prompt.indexOf('MEMORY'));
  assert.ok(prompt.indexOf('MEMORY') < prompt.indexOf('【对话约束】'));
});

test('conversation store supports create, append, load, rename, list, and delete', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'earshot-agent-'));
  try {
    const store = new ConversationStore(directory);
    const created = store.create('测试会话');
    store.append(created.id, { role: 'user', content: '你好' });
    const renamed = store.rename(created.id, '改名');
    assert.equal(renamed.title, '改名');
    assert.equal(store.load(created.id).messages[0].content, '你好');
    assert.equal(store.list()[0].title, '改名');
    store.delete(created.id);
    assert.deepEqual(store.list(), []);
    assert.throws(() => store.load(created.id));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('disabled memory performs no requests', async () => {
  let calls = 0;
  const memories = await recallMemories({
    memoryBaseUrl: 'http://127.0.0.1:8765',
    memoryEnabled: false,
    query: 'hello',
    fetchImpl: async () => {
      calls += 1;
      throw new Error('must not be called');
    },
  });
  assert.deepEqual(memories, []);
  assert.equal(calls, 0);
});
