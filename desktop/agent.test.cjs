const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CallLogStore,
  ConversationStore,
  FavoriteStore,
  buildSystemPrompt,
  conversationPreview,
  createSseParser,
  messageSummary,
  normalizeMessage,
  normalizeMessages,
  recallMemories,
  storeMemory,
  streamChat,
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
    const kept = store.load(created.id).messages;
    assert.equal(kept.length, 1);
    assert.equal(kept[0].role, 'user');
    assert.equal(kept[0].content, '保留我');

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
  const one = normalizeMessages([{ role: 'user', content: 123 }]);
  assert.equal(one.length, 1);
  assert.equal(one[0].content, '123');
  assert.equal(one[0].kind, 'text');
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

test('messages carry voice, image and file attachments with size limits', () => {
  const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const voice = normalizeMessage({ role: 'user', kind: 'voice', content: '转写出来的话', attachment: { name: '语音', mime: 'audio/webm', size: 2048, durationMs: 3200, dataUrl: tiny } });
  assert.equal(voice.kind, 'voice');
  assert.equal(voice.attachment.durationMs, 3200);
  assert.ok(voice.id);

  const image = normalizeMessage({ role: 'user', kind: 'image', content: '', attachment: { name: 'a.png', mime: 'image/png', size: 10, dataUrl: tiny } });
  assert.equal(image.kind, 'image');

  // 附件坏掉但有文字时退回文字，没有文字则整条丢弃，避免出现点不开的空气泡。
  assert.equal(normalizeMessage({ role: 'user', kind: 'image', content: '还有文字', attachment: { dataUrl: 'not-a-data-url' } }).kind, 'text');
  assert.equal(normalizeMessage({ role: 'user', kind: 'image', content: '', attachment: { dataUrl: 'nope' } }), null);

  // 超过 20MB 的附件不接收。
  const huge = `data:image/png;base64,${'A'.repeat(21 * 1024 * 1024 * 4 / 3)}`;
  assert.equal(normalizeMessage({ role: 'user', kind: 'image', content: '', attachment: { dataUrl: huge } }), null);
});

test('conversation preview uses placeholders for non-text messages', () => {
  assert.equal(messageSummary({ kind: 'voice', content: 'x' }), '[语音]');
  assert.equal(messageSummary({ kind: 'image' }), '[图片]');
  assert.equal(messageSummary({ kind: 'video' }), '[视频]');
  assert.equal(messageSummary({ kind: 'file', attachment: { name: 'r.pdf' } }), '[文件] r.pdf');
  const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  assert.equal(conversationPreview([{ role: 'user', kind: 'image', attachment: { dataUrl: tiny } }]), '我：[图片]');
});

test('favorites keep single and multi message entries, and can be removed', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'earshot-fav-'));
  try {
    const store = new FavoriteStore(path.join(directory, 'favorites.json'));
    assert.deepEqual(store.list(), []);
    const one = store.add({ source: 'chat', title: '小满', messages: [{ role: 'assistant', content: '一句话' }] });
    const many = store.add({ source: 'call', title: '阿年', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] });
    assert.equal(store.list().length, 2);
    assert.equal(store.list()[0].id, many.id, '最新的收藏排在前面');
    assert.equal(many.messages.length, 2);
    assert.equal(many.source, 'call');
    assert.throws(() => store.add({ messages: [] }), /没有可收藏的内容/);
    store.remove(one.id);
    assert.equal(store.list().length, 1);
    assert.equal(store.clear().cleared, 1);
    assert.deepEqual(store.list(), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('call log records direction, duration and keeps newest first', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'earshot-call-'));
  try {
    const store = new CallLogStore(path.join(directory, 'call-log.json'));
    store.add({ conversationId: 'c1', title: '小满', number: '13800138000', avatar: 'preset-2', direction: 'outgoing', durationMs: 65000 });
    const second = store.add({ conversationId: 'c2', title: '阿年', direction: 'incoming', missed: true });
    const list = store.list();
    assert.equal(list.length, 2);
    assert.equal(list[0].id, second.id);
    assert.equal(list[0].missed, true);
    assert.equal(list[1].number, '13800138000');
    assert.equal(list[1].durationMs, 65000);
    store.remove(second.id);
    assert.equal(store.list().length, 1);
    assert.equal(store.clear().cleared, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('vision messages reach the provider and unsupported models get an actionable error', async () => {
  const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const fake = (captured, ok = true, status = 200) => async (url, options) => {
    captured.body = JSON.parse(options.body);
    if (!ok) return { ok: false, status };
    return { ok: true, body: (async function* () { yield Buffer.from('data: [DONE]\n\n'); })() };
  };

  // 图片以 OpenAI vision 的分段格式原样发给模型。
  const captured = {};
  await streamChat({
    provider: { baseUrl: 'https://x/v1', model: 'gpt-4o', apiKey: 'k' },
    messages: [{ role: 'user', content: [{ type: 'text', text: '这是什么' }, { type: 'image_url', image_url: { url: tiny } }] }],
    fetchImpl: fake(captured),
  });
  assert.equal(captured.body.messages[0].content[1].image_url.url, tiny);

  // 带图片的 400 要提示换支持视觉的模型，而不是笼统报错。
  let withImage = '';
  await streamChat({
    provider: { baseUrl: 'https://x/v1', model: 'no-vision', apiKey: 'k' },
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: tiny } }] }],
    onError: message => { withImage = message; },
    fetchImpl: fake({}, false, 400),
  });
  assert.match(withImage, /不支持图片输入/);

  // 没带图片的 400 不能误报成视觉问题。
  let plain = '';
  await streamChat({
    provider: { baseUrl: 'https://x/v1', model: 'm', apiKey: 'k' },
    messages: [{ role: 'user', content: 'hi' }],
    onError: message => { plain = message; },
    fetchImpl: fake({}, false, 400),
  });
  assert.ok(!/不支持图片输入/.test(plain));
});

test('removeMessage drops one message and keeps the rest', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'earshot-msg-'));
  try {
    const store = new ConversationStore(directory);
    const created = store.create('小满');
    store.append(created.id, { role: 'user', content: '第一句' });
    store.append(created.id, { role: 'assistant', content: '第二句' });
    store.append(created.id, { role: 'user', content: '第三句' });
    const all = store.load(created.id).messages;
    assert.equal(all.length, 3);
    const after = store.removeMessage(created.id, all[1].id);
    assert.deepEqual(after.messages.map(item => item.content), ['第一句', '第三句']);
    // 删不存在的 id 不应改动记录。
    assert.equal(store.removeMessage(created.id, 'no-such-id').messages.length, 2);
    assert.equal(store.list()[0].messageCount, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('list preview hides the quote prefix and keeps the reply body', () => {
  const quoted = [{ role: 'user', kind: 'text', content: '> 对方：好啊，七点老地方见\n\n引用回复一下' }];
  assert.equal(conversationPreview(quoted), '我：引用回复一下');
  assert.equal(conversationPreview([{ role: 'assistant', kind: 'text', content: '普通一句话' }]), '普通一句话');
});
