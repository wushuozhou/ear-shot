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
  storeMemory,
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

test('memory recall uses GET query parameters and normalizes base URLs and response shapes', async () => {
  const cases = [
    { baseUrl: 'http://127.0.0.1:8765/', response: ['direct text'] },
    { baseUrl: 'http://127.0.0.1:8765/api', response: { items: [{ text: 'item text' }] } },
    { baseUrl: 'http://127.0.0.1:8765/api/', response: { results: [{ content: 'result text' }] } },
  ];
  for (const item of cases) {
    let request;
    const memories = await recallMemories({
      memoryBaseUrl: item.baseUrl,
      memoryEnabled: true,
      query: '下雨天喝什么',
      fetchImpl: async (url, options) => {
        request = { url: String(url), options };
        return { ok: true, json: async () => item.response };
      },
    });
    const parsed = new URL(request.url);
    assert.equal(parsed.pathname, '/api/recall');
    assert.equal(request.options.method, 'GET');
    assert.equal(request.options.body, undefined);
    assert.equal(parsed.searchParams.get('query'), '下雨天喝什么');
    assert.equal(parsed.searchParams.get('budget'), '3');
    assert.equal(parsed.searchParams.get('policy'), 'conversation');
    assert.deepEqual(memories.map(memory => typeof memory === 'string' ? memory : memory.text), [
      typeof item.response === 'object' && !Array.isArray(item.response)
        ? (item.response.items?.[0]?.text || item.response.results?.[0]?.content)
        : item.response[0],
    ]);
  }
});

test('memory store remains POST with text and tag body', async () => {
  let request;
  const ok = await storeMemory({
    memoryBaseUrl: 'http://127.0.0.1:8765/',
    memoryEnabled: true,
    text: '本轮摘要',
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return { ok: true, json: async () => ({}) };
    },
  });
  assert.equal(ok, true);
  assert.equal(request.url, 'http://127.0.0.1:8765/api/store');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), { text: '本轮摘要', tag: 'conversation' });
});
