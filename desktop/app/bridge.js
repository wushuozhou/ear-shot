(function () {
  const defaultPersona = {
    name: 'Earshot',
    self: '我',
    user: '你',
    personality: '认真、温和、可靠',
    style: '清楚、自然、简洁',
    taboo: '',
  };
  const themes = ['deep-space', 'mono-light', 'warm-night', 'contrast'];
  const mockProviders = [
    { id: 'mock-openai', name: 'OpenAI 示例', kind: 'llm', protocol: 'openai-compatible', baseUrl: 'https://api.example.com', model: 'gpt-4o-mini', enabled: true, maskedKey: '••••' },
    { id: 'mock-whisper', name: 'Whisper 示例', kind: 'stt', protocol: 'openai-compatible', baseUrl: 'https://api.example.com', model: 'whisper-1', enabled: true, maskedKey: '••••' },
    { id: 'mock-voice', name: '声音示例', kind: 'tts', protocol: 'openai-compatible', baseUrl: 'https://api.example.com', model: 'voice-1', enabled: true, maskedKey: '••••' },
  ];
  const mockConversations = [
    { id: 'mock-1', title: '欢迎使用', messages: [{ role: 'assistant', content: '你好，我在这里。' }] },
    { id: 'mock-2', title: '今日计划', messages: [{ role: 'user', content: '帮我整理今天的计划。' }, { role: 'assistant', content: '当然可以。' }] },
    { id: 'mock-3', title: '灵感记录', messages: [] },
  ];
  const memory = { providers: mockProviders.map(item => ({ ...item })), conversations: mockConversations.map(item => ({ ...item, messages: [...item.messages] })), persona: { ...defaultPersona }, avatar: 'preset-1', theme: localStorage.getItem('earshot:theme') || 'deep-space' };
  const real = window.electronAPI || window.desktop;
  const invoke = async (fn, fallback) => {
    if (!real) return fallback();
    try { return await fn(); } catch (error) { throw error; }
  };
  const mock = {
    providers: {
      list: async () => ({ providers: memory.providers, profiles: [{ id: 'mock-profile', name: '默认' }], activeProfileId: 'mock-profile', onboardingDismissed: true }),
      save: async value => { const index = memory.providers.findIndex(item => item.id === value.id); if (index >= 0) memory.providers[index] = { ...memory.providers[index], ...value }; else memory.providers.push({ ...value, id: value.id || `mock-${Date.now()}` }); return { providers: memory.providers }; },
      delete: async id => { memory.providers = memory.providers.filter(item => item.id !== id); return { providers: memory.providers }; },
      test: async () => ({ ok: true, latencyMs: 42, message: '连接正常' }),
    },
    app: { getMeta: async () => ({ port: null, dataDir: '', serviceStatus: 'ready' }), restartService: async () => ({}), openPath: async () => ({}) },
    getStatus: async () => ({ status: 'ready', message: '浏览器预览模式' }),
    onState: () => () => {},
    agent: {
      tones: async () => ({ tones: [{ id: 'gentle', name: '温和', systemPrompt: '使用自然、清楚的中文回答。' }], activeToneId: 'gentle' }),
      conversationList: async () => memory.conversations,
      conversationLoad: async id => memory.conversations.find(item => item.id === id) || memory.conversations[0],
      conversationNew: async title => { const item = { id: `mock-${Date.now()}`, title: title || '新对话', messages: [] }; memory.conversations.unshift(item); return item; },
      conversationDelete: async id => { memory.conversations = memory.conversations.filter(item => item.id !== id); return { ok: true }; },
      conversationRename: async input => { const item = memory.conversations.find(row => row.id === input.id); if (item) item.title = input.title; return item; },
      chatStart: async (id, text) => { const item = memory.conversations.find(row => row.id === id); item?.messages.push({ role: 'assistant', content: `浏览器预览回复：${text}` }); return { ticketId: `mock-ticket-${Date.now()}` }; },
      chatAbort: async () => ({ ok: true }),
      onEvent: () => () => {},
      memoryGet: async () => ({ memoryBaseUrl: '', memoryEnabled: false }),
      memorySet: async () => ({}),
    },
    settings: {
      get: async () => ({ persona: memory.persona, avatar: memory.avatar, theme: memory.theme }),
      save: async patch => { Object.assign(memory, patch); return { ...patch }; },
    },
  };
  const desktop = real || mock;
  window.earshotBridge = {
    ...desktop,
    settings: {
      get: () => invoke(() => desktop.settings?.get(), mock.settings.get),
      save: patch => invoke(() => desktop.settings?.save(patch), () => mock.settings.save(patch)),
    },
    themeNames: themes,
    isMock: !real,
  };
})();
