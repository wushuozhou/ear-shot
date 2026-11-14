const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ConversationStore,
  buildSystemPrompt,
  conversationPreview,
  createSseParser,
  normalizeMessages,
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

test('each contact keeps its own history and settings survive clearing messages', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'earshot-agent-'));
  try {
    const store = new ConversationStore(directory);
    const alice = store.create('小满', { avatar: 'preset-2', number: '13800138000' });
    const bob = store.create('阿年', { avatar: 'preset-3' });
    store.append(alice.id, { role: 'user', content: '我是给小满的' });
    store.append(alice.id, { role: 'assistant', content: '收到' });
    store.append(bob.id, { role: 'user', content: '我是给阿年的' });

    // 两个联系人的记录互不污染。
    assert.deepEqual(store.load(alice.id).messages.map(item => item.content), ['我是给小满的', '收到']);
    assert.deepEqual(store.load(bob.id).messages.map(item => item.content), ['我是给阿年的']);

    const aliceMeta = store.list().find(item => item.id === alice.id);
    assert.equal(aliceMeta.messageCount, 2);
    assert.equal(aliceMeta.preview, '收到');
    assert.equal(aliceMeta.avatar, 'preset-2');

    const cleared = store.clearMessages(alice.id);
    assert.deepEqual(cleared.messages, []);
    assert.equal(cleared.settings.avatar, 'preset-2');
    assert.equal(cleared.settings.number, '13800138000');
    assert.equal(cleared.title, '小满');
    // 清空一个联系人不影响另一个。
    assert.equal(store.load(bob.id).messages.length, 1);
    assert.equal(store.list().find(item => item.id === alice.id).messageCount, 0);

    const result = store.clearAllMessages();
    assert.equal(result.cleared, 2);
    assert.equal(store.load(bob.id).messages.length, 0);
    assert.equal(store.list().every(item => item.messageCount === 0), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('store rejects unusable ids, repairs bad records, and reports readable errors', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'earshot-agent-'));
  try {
    const store = new ConversationStore(directory);
    assert.throws(() => store.load('../../etc/passwd'), /会话 id 无效/);
    assert.throws(() => store.delete('bad id'), /会话 id 无效/);
    assert.throws(() => store.load('aaaaaaaa-bbbb'), /找不到这个联系人的聊天记录/);

    const created = store.create('脏数据');
    const file = path.join(directory, `${created.id}.json`);
    fs.writeFileSync(file, JSON.stringify({
      ...created,
      messages: [null, { role: 'tool', content: '  ' }, { role: 'user', content: '保留我' }],
    }));
    assert.deepEqual(store.load(created.id).messages, [{ role: 'user', content: '保留我' }]);

    fs.writeFileSync(file, '{not json');
    assert.throws(() => store.load(created.id), /已损坏/);
    // 删除已损坏的会话仍然可用，不会卡住界面。
    store.delete(created.id);
    assert.deepEqual(store.list(), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('message normalization and preview stay safe for list rendering', () => {
  assert.deepEqual(normalizeMessages(undefined), []);
  assert.deepEqual(normalizeMessages([{ role: 'user', content: 123 }]), [{ role: 'user', content: '123' }]);
  assert.equal(conversationPreview([]), '');
  assert.equal(conversationPreview([{ role: 'user', content: '换行\n也要压平' }]), '我：换行 也要压平');
  assert.equal(conversationPreview([{ role: 'assistant', content: 'x'.repeat(60) }]).length, 41);
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
