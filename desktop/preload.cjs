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
    delete: id => {
      if (typeof id !== 'string') throw new TypeError('Provider id 必须是字符串');
      return ipcRenderer.invoke('providers:delete', id);
    },
    test: id => {
      if (typeof id !== 'string') throw new TypeError('Provider id 必须是字符串');
      return ipcRenderer.invoke('providers:test', id);
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
    setDataDir: dataDir => {
      if (typeof dataDir !== 'string') throw new TypeError('数据目录必须是字符串');
      return ipcRenderer.invoke('app:set-data-dir', dataDir);
    },
  },
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop:state', listener);
    return () => ipcRenderer.removeListener('desktop:state', listener);
  },
});
