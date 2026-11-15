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
    { id: 'builtin-llm-openai', name: 'OpenAI 示例', kind: 'llm', protocol: 'openai-compatible', baseUrl: 'https://api.example.com', model: 'gpt-4o-mini', enabled: true, maskedKey: '••••' },
    { id: 'builtin-stt-openai', name: 'Whisper 示例', kind: 'stt', protocol: 'openai-compatible', baseUrl: 'https://api.example.com', model: 'whisper-1', enabled: true, maskedKey: '••••' },
    { id: 'builtin-tts-openai', name: '声音示例', kind: 'tts', protocol: 'openai-compatible', baseUrl: 'https://api.example.com', model: 'voice-1', enabled: true, maskedKey: '••••' },
  ];
  const mockConversations = [
    { id: 'mock-1', title: '欢迎使用', settings: { number: '13800138000', avatar: 'preset-1', model: '', toneId: '', style: '' }, messages: [{ role: 'assistant', content: '你好，我在这里。' }] },
    { id: 'mock-2', title: '今日计划', settings: { number: '', avatar: 'preset-3', model: '', toneId: '', style: '多说重点' }, messages: [{ role: 'user', content: '帮我整理今天的计划。' }, { role: 'assistant', content: '当然可以。' }] },
    { id: 'mock-3', title: '灵感记录', settings: { number: '', avatar: 'preset-5', model: '', toneId: '', style: '' }, messages: [] },
  ];
  const memory = {
    providers: mockProviders.map(item => ({ ...item })),
    profiles: [{ id: 'mock-profile', name: '默认' }],
    activeProfileId: 'mock-profile',
    conversations: mockConversations.map(item => ({ ...item, settings: { ...item.settings }, messages: [...item.messages] })),
    persona: { ...defaultPersona },
    avatar: 'preset-1',
    userAvatar: 'preset-4',
    theme: 'mono-light',
    phoneStyle: true,
    waveform: true,
    toneId: 'gentle',
    aiVoiceReply: false,
    chatBackground: '',
    callBackground: '',
    favorites: [],
    callLog: [],
  };
  const real = window.electronAPI || window.desktop;
  const invoke = async (fn, fallback) => {
    if (!real) return fallback();
    try { return await fn(); } catch (error) { throw error; }
  };
  const settingsSnapshot = () => ({
    persona: memory.persona,
    avatar: memory.avatar,
    userAvatar: memory.userAvatar,
    theme: memory.theme,
    phoneStyle: memory.phoneStyle,
    waveform: memory.waveform,
    toneId: memory.toneId,
    aiVoiceReply: memory.aiVoiceReply,
    chatBackground: memory.chatBackground,
    callBackground: memory.callBackground,
  });
  const mock = {
    providers: {
      list: async () => ({ providers: memory.providers, profiles: memory.profiles, activeProfileId: memory.activeProfileId, onboardingDismissed: true }),
      save: async value => { const index = memory.providers.findIndex(item => item.id === value.id); if (index >= 0) memory.providers[index] = { ...memory.providers[index], ...value }; else memory.providers.push({ ...value, id: value.id || `mock-${Date.now()}` }); return { providers: memory.providers }; },
      delete: async id => { memory.providers = memory.providers.filter(item => item.id !== id); return { providers: memory.providers }; },
      test: async () => ({ ok: true, latencyMs: 42, message: '连接正常' }),
      quickConnect: async input => {
        const provider = {
          id: `mock-${Date.now()}`,
          name: 'preview.example.com',
          kind: 'llm',
          protocol: 'openai-compatible',
          baseUrl: input.baseUrl.replace(/\/+$/, '') + '/v1',
          model: input.model || 'preview-model',
          enabled: true,
          builtin: false,
          maskedKey: '••••',
        };
        memory.providers.push(provider);
        return { ok: true, provider };
      },
      onboarding: { setDismissed: async () => ({ onboardingDismissed: true }) },
    },
    profiles: {
      list: async () => ({ profiles: memory.profiles, activeProfileId: memory.activeProfileId, onboardingDismissed: true }),
      save: async profile => { const value = profile?.profile || profile; const index = memory.profiles.findIndex(item => item.id === value.id); if (index >= 0) memory.profiles[index] = { ...memory.profiles[index], ...value }; else memory.profiles.push(value); return { profiles: memory.profiles, activeProfileId: memory.activeProfileId }; },
      setActive: async id => { memory.activeProfileId = id; return { profiles: memory.profiles, activeProfileId: id }; },
    },
    app: {
      getMeta: async () => ({ version: '0.3.0-preview', port: null, dataDir: '', serviceStatus: 'ready' }),
      restartService: async () => ({}),
      openPath: async () => ({}),
      openExternal: async () => ({}),
      chooseDataDir: async () => ({ canceled: true }),
      settings: {
        get: async () => settingsSnapshot(),
        save: async patch => { Object.assign(memory, patch); return settingsSnapshot(); },
      },
    },
    getStatus: async () => ({ status: 'ready', message: '浏览器预览模式' }),
    onState: () => () => {},
    agent: {
      tones: async () => ({ tones: [{ id: 'gentle', name: '温和', systemPrompt: '使用自然、清楚的中文回答。' }], activeToneId: 'gentle' }),
      conversationList: async () => memory.conversations.map(item => ({
        ...item,
        messageCount: item.messages.length,
        preview: item.messages.length
          ? (item.messages[item.messages.length - 1].role === 'user' ? `我：${item.messages[item.messages.length - 1].content}` : item.messages[item.messages.length - 1].content)
          : '',
      })),
      conversationLoad: async id => memory.conversations.find(item => item.id === id) || memory.conversations[0],
      conversationNew: async title => { const item = { id: `mock-${Date.now()}`, title: title || '新对话', settings: { number: '', avatar: '', model: '', toneId: '', style: '' }, messages: [] }; memory.conversations.unshift(item); return item; },
      conversationDelete: async id => { memory.conversations = memory.conversations.filter(item => item.id !== id); return { ok: true }; },
      conversationClear: async id => { const item = memory.conversations.find(row => row.id === id); if (item) item.messages = []; return item; },
      conversationClearAll: async () => { memory.conversations.forEach(item => { item.messages = []; }); return { cleared: memory.conversations.length }; },
      conversationRename: async input => { const item = memory.conversations.find(row => row.id === input.id); if (item) item.title = input.title; return item; },
      conversationUpdate: async (id, patch) => {
        const item = memory.conversations.find(row => row.id === id);
        if (!item) return null;
        if (typeof patch.title === 'string' && patch.title.trim()) item.title = patch.title.trim();
        item.settings = { ...(item.settings || {}), ...patch };
        return item;
      },
      chatStart: async (id, text, message) => { const item = memory.conversations.find(row => row.id === id); if (item) { item.messages.push(message ? { ...message, role: 'user', id: `u-${Date.now()}` } : { role: 'user', kind: 'text', content: text, id: `u-${Date.now()}` }, { role: 'assistant', kind: 'text', content: `浏览器预览回复：${text || '[附件]'}`, id: `a-${Date.now()}` }); } return { ticketId: `mock-ticket-${Date.now()}` }; },
      transcribe: async () => ({ text: '浏览器预览模式没有真实转写' }),
      speak: async () => { throw new Error('浏览器预览模式不支持语音合成'); },
      chatAbort: async () => ({ ok: true }),
      onEvent: () => () => {},
      memoryGet: async () => ({ memoryBaseUrl: '', memoryEnabled: false }),
      memorySet: async () => ({}),
      memoryTest: async () => ({ ok: true, message: '浏览器预览模式' }),
    },
    settings: {
      get: async () => settingsSnapshot(),
      save: async patch => { Object.assign(memory, patch); return settingsSnapshot(); },
    },
    favorites: {
      list: async () => memory.favorites,
      add: async entry => { const item = { id: `f-${Date.now()}`, createdAt: new Date().toISOString(), source: entry.source || 'chat', title: entry.title || '', messages: entry.messages || [] }; memory.favorites.unshift(item); return item; },
      remove: async id => { memory.favorites = memory.favorites.filter(item => item.id !== id); return { ok: true }; },
      clear: async () => { const n = memory.favorites.length; memory.favorites = []; return { cleared: n }; },
    },
    calls: {
      list: async () => memory.callLog,
      add: async entry => { const item = { id: `c-${Date.now()}`, startedAt: new Date().toISOString(), ...entry }; memory.callLog.unshift(item); return item; },
      remove: async id => { memory.callLog = memory.callLog.filter(item => item.id !== id); return { ok: true }; },
      clear: async () => { const n = memory.callLog.length; memory.callLog = []; return { cleared: n }; },
    },
  };
  const desktop = real || mock;
  if (!real) window.desktop = mock;
  window.earshotBridge = {
    ...desktop,
    settings: {
      get: () => invoke(() => desktop.app?.settings?.get(), mock.settings.get),
      save: patch => invoke(() => desktop.app?.settings?.save(patch), () => mock.settings.save(patch)),
    },
    themeNames: themes,
    isMock: !real,
  };
})();
