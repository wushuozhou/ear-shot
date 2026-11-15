const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  retry: () => ipcRenderer.invoke('desktop:retry'),
  getStatus: () => ipcRenderer.invoke('desktop:get-status'),
  openLogsDir: () => ipcRenderer.invoke('desktop:open-logs-dir'),
  providers: {
    list: () => ipcRenderer.invoke('providers:list'),
    save: provider => {
      const value = provider?.provider || provider;
      if (!value || typeof value.id !== 'string' || typeof value.kind !== 'string') throw new TypeError('Provider 参数不完整');
      if (!['llm', 'stt', 'tts'].includes(value.kind)) throw new TypeError('Provider kind 无效');
      return ipcRenderer.invoke('providers:save', provider);
    },
    onboarding: {
      setDismissed: dismissed => {
        if (typeof dismissed !== 'boolean') throw new TypeError('向导状态必须是布尔值');
        return ipcRenderer.invoke('onboarding:set-dismissed', dismissed);
      },
    },
    delete: id => {
      if (typeof id !== 'string') throw new TypeError('Provider id 必须是字符串');
      return ipcRenderer.invoke('providers:delete', id);
    },
    test: id => {
      if (typeof id !== 'string') throw new TypeError('Provider id 必须是字符串');
      return ipcRenderer.invoke('providers:test', id);
    },
    quickConnect: input => {
      if (!input || typeof input.baseUrl !== 'string' || typeof input.apiKey !== 'string' || typeof input.model !== 'string') {
        throw new TypeError('快速连接参数无效');
      }
      return ipcRenderer.invoke('providers:quick-connect', input);
    },
    setKey: (id, key) => {
      if (typeof id !== 'string' || typeof key !== 'string') throw new TypeError('Provider 密钥参数无效');
      return ipcRenderer.invoke('providers:set-key', { id, key });
    },
  },
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    save: profile => ipcRenderer.invoke('profiles:save', profile),
    setActive: id => {
      if (typeof id !== 'string') throw new TypeError('Profile id 必须是字符串');
      return ipcRenderer.invoke('profiles:set-active', id);
    },
  },
  app: {
    getMeta: () => ipcRenderer.invoke('app:get-meta'),
    restartService: () => ipcRenderer.invoke('app:restart-service'),
    openPath: target => {
      if (target !== 'config' && target !== 'logs') throw new TypeError('只能打开配置目录或日志目录');
      return ipcRenderer.invoke('app:open-path', target);
    },
    openExternal: url => {
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new TypeError('只允许打开 http 或 https 链接');
      return ipcRenderer.invoke('app:open-external', url);
    },
    chooseDataDir: () => ipcRenderer.invoke('app:choose-data-dir'),
    settings: {
      get: () => ipcRenderer.invoke('settings:get'),
      save: patch => ipcRenderer.invoke('settings:save', patch),
    },
    setDataDir: dataDir => {
      if (typeof dataDir !== 'string') throw new TypeError('数据目录必须是字符串');
      return ipcRenderer.invoke('app:set-data-dir', dataDir);
    },
  },
  agent: {
    tones: () => ipcRenderer.invoke('agent:tones'),
    setTone: id => {
      if (typeof id !== 'string') throw new TypeError('语气 id 必须是字符串');
      return ipcRenderer.invoke('agent:tone-set', id);
    },
    chatStart: (conversationId, text, message) => {
      if (typeof conversationId !== 'string' || typeof text !== 'string') throw new TypeError('对话参数无效');
      if (message !== undefined && (message === null || typeof message !== 'object')) throw new TypeError('消息参数无效');
      return ipcRenderer.invoke('agent:chat-start', { conversationId, text, message });
    },
    transcribe: dataUrl => {
      if (typeof dataUrl !== 'string') throw new TypeError('音频数据必须是字符串');
      return ipcRenderer.invoke('agent:transcribe', dataUrl);
    },
    speak: text => {
      if (typeof text !== 'string') throw new TypeError('朗读文字必须是字符串');
      return ipcRenderer.invoke('agent:speak', text);
    },
    chatAbort: ticketId => {
      if (typeof ticketId !== 'string') throw new TypeError('ticket id 必须是字符串');
      return ipcRenderer.invoke('agent:chat-abort', ticketId);
    },
    conversationList: () => ipcRenderer.invoke('agent:conversation-list'),
    conversationLoad: id => {
      if (typeof id !== 'string') throw new TypeError('会话 id 必须是字符串');
      return ipcRenderer.invoke('agent:conversation-load', id);
    },
    conversationNew: title => {
      if (title !== undefined && typeof title !== 'string') throw new TypeError('会话标题必须是字符串');
      return ipcRenderer.invoke('agent:conversation-new', title);
    },
    conversationDelete: id => {
      if (typeof id !== 'string') throw new TypeError('会话 id 必须是字符串');
      return ipcRenderer.invoke('agent:conversation-delete', id);
    },
    conversationClear: id => {
      if (typeof id !== 'string') throw new TypeError('会话 id 必须是字符串');
      return ipcRenderer.invoke('agent:conversation-clear', id);
    },
    conversationClearAll: () => ipcRenderer.invoke('agent:conversation-clear-all'),
    conversationRename: (id, title) => {
      if (typeof id !== 'string' || typeof title !== 'string') throw new TypeError('重命名参数无效');
      return ipcRenderer.invoke('agent:conversation-rename', { id, title });
    },
    conversationUpdate: (id, patch) => {
      if (typeof id !== 'string' || !patch || typeof patch !== 'object') throw new TypeError('会话设置参数无效');
      return ipcRenderer.invoke('agent:conversation-update', { id, patch });
    },
    memoryGet: () => ipcRenderer.invoke('agent:memory-get'),
    memorySet: (memoryBaseUrl, memoryEnabled) => {
      if (typeof memoryBaseUrl !== 'string' || typeof memoryEnabled !== 'boolean') throw new TypeError('记忆配置无效');
      return ipcRenderer.invoke('agent:memory-set', { memoryBaseUrl, memoryEnabled });
    },
    memoryTest: baseUrl => {
      if (typeof baseUrl !== 'string') throw new TypeError('记忆服务地址必须是字符串');
      return ipcRenderer.invoke('agent:memory-test', baseUrl);
    },
    onEvent: callback => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('agent:event', listener);
      return () => ipcRenderer.removeListener('agent:event', listener);
    },
  },
  favorites: {
    list: () => ipcRenderer.invoke('favorites:list'),
    add: entry => {
      if (!entry || typeof entry !== 'object') throw new TypeError('收藏参数无效');
      return ipcRenderer.invoke('favorites:add', entry);
    },
    remove: id => {
      if (typeof id !== 'string') throw new TypeError('收藏 id 必须是字符串');
      return ipcRenderer.invoke('favorites:remove', id);
    },
    clear: () => ipcRenderer.invoke('favorites:clear'),
  },
  calls: {
    list: () => ipcRenderer.invoke('calls:list'),
    add: entry => {
      if (!entry || typeof entry !== 'object') throw new TypeError('通话记录参数无效');
      return ipcRenderer.invoke('calls:add', entry);
    },
    remove: id => {
      if (typeof id !== 'string') throw new TypeError('通话记录 id 必须是字符串');
      return ipcRenderer.invoke('calls:remove', id);
    },
    clear: () => ipcRenderer.invoke('calls:clear'),
  },
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop:state', listener);
    return () => ipcRenderer.removeListener('desktop:state', listener);
  },
});
