const { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const {
  configPath,
  getProviderKey,
  loadConfig,
  launchEnvironment,
  saveProfiles,
  saveProviders,
  setActiveProfile,
  setActiveTone,
  setMemoryConfig,
  setOnboardingDismissed,
  setProviderKey,
  writeConfig,
} = require('./config.cjs');
const {
  addProfile,
  addProvider,
  deleteProvider,
  resolveLaunchEnv,
  updateProfile,
  updateProvider,
} = require('./providers.cjs');
const { testProvider } = require('./provider-test.cjs');
const {
  ConversationStore,
  buildSystemPrompt,
  readTones,
  recallMemories,
  storeMemory,
  streamChat,
  testMemoryConnection,
} = require('./agent.cjs');

const DEFAULT_PORT = 8787;
const STARTUP_TIMEOUT_MS = 30_000;
const MAX_RESTARTS = 3;
const selfTestMode = process.argv.includes('--self-test');
const devRoot = path.resolve(__dirname, '..');
const packedRoot = path.join(process.resourcesPath, 'earshot');
// 不直接依赖 app.isPackaged，因为直接调 electron.exe 时它也可能为 true。
const rootDir = fs.existsSync(path.join(devRoot, 'server', 'index.js'))
  ? devRoot
  : fs.existsSync(path.join(packedRoot, 'server', 'index.js'))
    ? packedRoot
    : devRoot;
const serverScript = path.join(rootDir, 'server', 'index.js');
const dataDirPointer = path.join(app.getPath('appData'), 'Earshot', 'data-dir.txt');

function applyDataDirOverride() {
  if (!fs.existsSync(dataDirPointer)) return;
  const target = fs.readFileSync(dataDirPointer, 'utf8').trim();
  if (target && path.isAbsolute(target) && fs.existsSync(target)) app.setPath('userData', target);
}

applyDataDirOverride();

let mainWindow;
let service;
let servicePort;
let serviceStopping = false;
let restartCount = 0;
let launchTimer;
let isQuitting = false;
let shutdownStarted = false;
let state = {
  status: 'starting',
  message: '正在启动服务…',
  port: null,
  logPath: '',
};
let config;
let logFile;
let conversationStore;
let toneOptions = [];
const agentTickets = new Map();

function redact(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [已隐藏]')
    .replace(/\b(?:sk|rk|pk)[-_][A-Za-z0-9_-]{12,}\b/gi, '[已隐藏]')
    .replace(/(api[_-]?key|token|secret)(\s*[:=]\s*)["']?[^"',\s}]+/gi, '$1$2[已隐藏]');
}

function writeLog(message, source = 'desktop') {
  const line = `[${new Date().toISOString()}] [${source}] ${redact(message).trim()}\n`;
  try { fs.appendFileSync(logFile, line, 'utf8'); } catch (_) { /* startup logging must not stop launch */ }
}

function publish(next) {
  state = { ...state, ...next, logPath: logFile };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop:state', state);
}

function maskKey(value) {
  const key = String(value || '');
  if (!key) return '';
  if (key.length <= 4) return '••••';
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

function safeProviderList() {
  return config.providers.map(provider => ({
    ...provider,
    apiKey: undefined,
    maskedKey: maskKey(getProviderKey(config, provider.id, safeStorage)),
  })).map(provider => {
    const { apiKey, ...safeProvider } = provider;
    return safeProvider;
  });
}

function agentEvent(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agent:event', payload);
}

function activeLlmProvider(preferredId = '') {
  const profile = config.profiles.find(item => item.id === config.activeProfileId);
  const preferred = preferredId
    ? config.providers.find(item => item.id === preferredId && item.kind === 'llm')
    : null;
  // A per-conversation model only wins when it is a usable LLM provider with a key;
  // otherwise fall back to the active Profile so old conversations keep working.
  const provider = preferred && preferred.enabled !== false && preferred.baseUrl && getProviderKey(config, preferred.id, safeStorage)
    ? preferred
    : config.providers.find(item => item.id === profile?.llmId);
  if (!provider) throw new Error('当前 Profile 没有可用的大模型 Provider');
  return {
    ...provider,
    apiKey: getProviderKey(config, provider.id, safeStorage),
  };
}

function startAgentChat(conversationId, userText) {
  const ticketId = `ticket-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  agentTickets.set(ticketId, { controller, conversationId });
  (async () => {
    let assistantText = '';
    let failed = false;
    try {
      const conversation = conversationStore.append(conversationId, { role: 'user', content: userText });
      agentEvent({ type: 'started', conversationId, ticketId, message: userText });
      const conversationSettings = conversation.settings || {};
      const effectiveTone = conversationSettings.tone || config.toneText || '';
      const effectivePersona = conversationSettings.persona || config.persona;
      const tone = effectiveTone || toneOptions.find(item => item.id === (conversationSettings.toneId || config.activeToneId))
        || toneOptions.find(item => item.id === config.activeToneId)
        || toneOptions[0];
      let persona = effectivePersona && typeof effectivePersona === 'object'
        ? { ...effectivePersona }
        : effectivePersona;
      if (conversationSettings.style) {
        if (typeof persona === 'string') {
          persona = `${persona}\n说话风格：${conversationSettings.style}`;
        } else {
          persona.style = [persona.style, conversationSettings.style].filter(Boolean).join('；');
        }
      }
      const memories = await recallMemories({
        memoryBaseUrl: config.memoryBaseUrl,
        memoryEnabled: config.memoryEnabled,
        query: userText,
      });
      const messages = [
        { role: 'system', content: buildSystemPrompt({ persona, tone, memories }) },
        ...conversation.messages,
      ];
      const completed = await streamChat({
        provider: activeLlmProvider(conversationSettings.model),
        messages,
        signal: controller.signal,
        onDelta: delta => {
          assistantText += delta;
          agentEvent({ type: 'delta', conversationId, ticketId, delta });
        },
        onDone: () => {},
        onError: message => {
          failed = true;
          agentEvent({ type: 'error', conversationId, ticketId, message });
        },
      });
      if (completed && !failed && !assistantText) {
        agentEvent({ type: 'error', conversationId, ticketId, message: '响应格式异常：模型没有返回文字' });
        return;
      }
      if (completed && !failed && assistantText) {
        conversationStore.append(conversationId, { role: 'assistant', content: assistantText });
        await storeMemory({
          memoryBaseUrl: config.memoryBaseUrl,
          memoryEnabled: config.memoryEnabled,
          text: `用户：${userText}\n助手：${assistantText}`,
        });
        agentEvent({ type: 'done', conversationId, ticketId, content: assistantText });
      }
    } catch (error) {
      agentEvent({ type: 'error', conversationId, ticketId, message: error.message || '对话请求失败' });
    } finally {
      agentTickets.delete(ticketId);
    }
  })();
  return ticketId;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#111827',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!/^https?:\/\//i.test(url)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
  mainWindow.loadFile(path.join(app.getAppPath(), 'loading.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

function canBind(port) {
  return new Promise(resolve => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => tester.close(() => resolve(true)));
    tester.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(preferred) {
  const base = Number.isInteger(preferred) && preferred > 0 ? preferred : DEFAULT_PORT;
  for (let offset = 0; offset < 100; offset += 1) {
    const port = base + offset;
    if (await canBind(port)) return port;
  }
  throw new Error(`从 ${base} 开始没有找到可用端口`);
}

function tcpProbe(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = result => { socket.destroy(); resolve(result); };
    socket.setTimeout(800);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function httpProbe(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/info`, {
      signal: AbortSignal.timeout(800),
    });
    return response.ok;
  } catch (_) {
    return null;
  }
}

async function waitForReady(port) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const httpReady = await httpProbe(port);
    if (httpReady === true) return true;
    if (httpReady === null && await tcpProbe(port)) return true;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}

function killService() {
  if (!service || service.killed) return Promise.resolve();
  const child = service;
  service = null;
  return new Promise(resolve => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
          .once('exit', done)
          .once('error', done);
      } else {
        child.kill('SIGKILL');
        done();
      }
    }, 1500);
    child.once('exit', done);
    child.kill('SIGTERM');
  });
}

function handleUnexpectedExit(code, signal) {
  service = null;
  if (serviceStopping || isQuitting) return;
  writeLog(`服务进程退出，code=${code}, signal=${signal || 'none'}`, 'service');
  if (restartCount < MAX_RESTARTS) {
    restartCount += 1;
    publish({
      status: 'restarting',
      message: `服务意外退出，正在自动重启（第 ${restartCount}/${MAX_RESTARTS} 次）…`,
    });
    clearTimeout(launchTimer);
    launchTimer = setTimeout(() => startService(), 500);
  } else {
    publish({
      status: 'failed',
      message: '服务多次意外退出，已停止自动重启。请查看日志后点击“重试”。',
    });
  }
}

async function startService({ resetRestarts = false } = {}) {
  if (resetRestarts) restartCount = 0;
  if (service) await killService();
  serviceStopping = false;
  publish({ status: 'starting', message: '正在启动服务…', port: null });
  writeLog(`开始启动服务，配置文件：${configPath(app)}`);

  try {
    if (!fs.existsSync(serverScript)) {
      throw new Error('找不到内置服务文件，安装可能不完整，请重新安装');
    }
    servicePort = await findAvailablePort(Number(config.port) || DEFAULT_PORT);
    const activeProfile = config.profiles.find(item => item.id === config.activeProfileId);
    const runtimeProviders = config.providers.map(provider => ({
      ...provider,
      apiKey: getProviderKey(config, provider.id, safeStorage),
    }));
    // Launch priority: resolved Profile values > config.json env > root .env
    // > inherited environment. Provider secrets are decrypted only in this process.
    const profileEnv = activeProfile
      ? resolveLaunchEnv(activeProfile, runtimeProviders)
      : {};
    const env = launchEnvironment(app, config, rootDir, servicePort, profileEnv, safeStorage);
    service = spawn(process.execPath, [serverScript], {
      cwd: rootDir,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    publish({ port: servicePort, message: `正在启动服务（端口 ${servicePort}）…` });
    writeLog(`服务进程已启动，pid=${service.pid}，端口=${servicePort}`);
    service.stdout.on('data', data => writeLog(data, 'service'));
    service.stderr.on('data', data => writeLog(data, 'service-error'));
    service.once('error', error => {
      writeLog(error.stack || error.message, 'service-error');
      publish({ status: 'failed', message: `服务进程无法启动：${error.message}` });
    });
    service.once('exit', handleUnexpectedExit);

    if (!await waitForReady(servicePort)) {
      serviceStopping = true;
      await killService();
      throw new Error(`服务在 30 秒内没有通过 /api/info 探活（端口 ${servicePort}）`);
    }

    publish({ status: 'ready', message: `服务已启动，正在打开 Earshot（端口 ${servicePort}）…` });
    writeLog(`服务探活成功：http://127.0.0.1:${servicePort}/api/info`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadFile(path.join(app.getAppPath(), 'app', 'index.html'));
    }
    if (selfTestMode) {
      console.log(`SELF_TEST_OK port=${servicePort}`);
      setTimeout(() => {
        process.exitCode = 0;
        app.quit();
      }, 3000);
    }
  } catch (error) {
    writeLog(error.stack || error.message, 'startup-error');
    publish({ status: 'failed', message: `启动失败：${error.message}` });
    if (selfTestMode) {
      console.error(`SELF_TEST_FAIL ${error.message}`);
      process.exitCode = 1;
      app.quit();
    }
  }
}

async function stopService() {
  serviceStopping = true;
  clearTimeout(launchTimer);
  await killService();
}

function registerIpc() {
  ipcMain.handle('desktop:retry', () => startService({ resetRestarts: true }));
  ipcMain.handle('desktop:get-status', () => state);
  ipcMain.handle('desktop:open-logs-dir', () => shell.openPath(path.dirname(logFile)));
  ipcMain.handle('providers:list', () => ({
    providers: safeProviderList(),
    profiles: config.profiles,
    activeProfileId: config.activeProfileId,
    onboardingDismissed: config.onboardingDismissed,
  }));
  ipcMain.handle('providers:save', (_event, input) => {
    const value = input?.provider || input;
    if (!value || typeof value.id !== 'string' || typeof value.kind !== 'string') throw new Error('Provider 参数不完整');
    if (!['llm', 'stt', 'tts'].includes(value.kind)) throw new Error('Provider kind 无效');
    const apiKey = typeof value.apiKey === 'string' ? value.apiKey : '';
    const providerValue = { ...value };
    delete providerValue.apiKey;
    delete providerValue.maskedKey;
    const exists = config.providers.some(provider => provider.id === value.id);
    config = exists
      ? saveProviders(app, updateProvider(config.providers, value.id, providerValue), safeStorage)
      : saveProviders(app, addProvider(config.providers, providerValue), safeStorage);
    if (apiKey) config = setProviderKey(app, value.id, apiKey, safeStorage);
    return { providers: safeProviderList() };
  });
  ipcMain.handle('providers:delete', (_event, id) => {
    if (typeof id !== 'string') throw new Error('Provider id 必须是字符串');
    const providers = deleteProvider(config.providers, id);
    const providerKeys = { ...config.providerKeys };
    delete providerKeys[id];
    writeConfig(app, { ...config, providers, providerKeys }, safeStorage);
    config = loadConfig(app, { safeStorage });
    return { providers: safeProviderList() };
  });
  ipcMain.handle('providers:set-key', (_event, input) => {
    if (!input || typeof input.id !== 'string' || typeof input.key !== 'string') throw new Error('Provider 密钥参数无效');
    config = setProviderKey(app, input.id, input.key, safeStorage);
    return { ok: true };
  });
  ipcMain.handle('providers:test', async (_event, id) => {
    if (typeof id !== 'string') throw new Error('Provider id 必须是字符串');
    const provider = config.providers.find(item => item.id === id);
    if (!provider) throw new Error(`找不到 Provider：${id}`);
    return testProvider({ ...provider, apiKey: getProviderKey(config, id, safeStorage) });
  });
  ipcMain.handle('providers:quick-connect', async (_event, input) => {
    if (!input || typeof input.baseUrl !== 'string' || typeof input.apiKey !== 'string') {
      throw new Error('Base URL 和 API Key 必填');
    }
    const baseUrl = input.baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
    const apiKey = input.apiKey.trim();
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error('Base URL 必须以 http:// 或 https:// 开头');
    if (!apiKey) throw new Error('API Key 必填');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let response;
    try {
      response = await fetch(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(error.name === 'AbortError' ? '验证超时（10 秒）' : `验证失败：${error.message}`);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`验证失败（HTTP ${response.status}）`);
    let payload;
    try {
      payload = await response.json();
    } catch (_) {
      throw new Error('验证失败：响应不是有效 JSON');
    }
    const models = Array.isArray(payload?.data) ? payload.data : [];
    const firstModel = models.find(item => typeof item?.id === 'string')?.id || '';
    const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : firstModel;
    if (!model) throw new Error('验证成功，但没有可用模型');
    const hostname = new URL(baseUrl).hostname || '自定义供应商';
    const provider = {
      id: `custom-llm-${Date.now().toString(36)}`,
      name: hostname,
      kind: 'llm',
      protocol: 'openai-compatible',
      baseUrl: `${baseUrl}/v1`,
      model,
      enabled: true,
      builtin: false,
    };
    config = saveProviders(app, addProvider(config.providers, provider), safeStorage);
    config = setProviderKey(app, provider.id, apiKey, safeStorage);
    return { ok: true, provider: { ...provider, maskedKey: '••••' } };
  });
  ipcMain.handle('onboarding:set-dismissed', (_event, dismissed) => {
    if (typeof dismissed !== 'boolean') throw new Error('向导状态无效');
    config = setOnboardingDismissed(app, dismissed, safeStorage);
    return { onboardingDismissed: config.onboardingDismissed };
  });
  ipcMain.handle('profiles:list', () => ({
    profiles: config.profiles,
    activeProfileId: config.activeProfileId,
    onboardingDismissed: config.onboardingDismissed,
  }));
  ipcMain.handle('profiles:save', (_event, input) => {
    const value = input?.profile || input;
    if (!value || typeof value.id !== 'string') throw new Error('Profile id 必须是字符串');
    const exists = config.profiles.some(profile => profile.id === value.id);
    const profiles = exists
      ? updateProfile(config.profiles, value.id, value)
      : addProfile(config.profiles, value);
    config = saveProfiles(app, profiles, safeStorage);
    return { profiles: config.profiles, activeProfileId: config.activeProfileId };
  });
  ipcMain.handle('profiles:set-active', (_event, id) => {
    if (typeof id !== 'string') throw new Error('Profile id 必须是字符串');
    config = setActiveProfile(app, id, safeStorage);
    return { profiles: config.profiles, activeProfileId: config.activeProfileId };
  });
  ipcMain.handle('app:get-meta', () => ({
    version: app.getVersion(),
    port: servicePort,
    configPath: configPath(app),
    logPath: logFile,
    dataDir: config.dataDir,
    serviceStatus: state.status,
    activeProfileId: config.activeProfileId,
    storage: safeStorage.isEncryptionAvailable() ? 'safeStorage 加密' : '明文（系统不支持安全存储）',
  }));
  ipcMain.handle('app:restart-service', () => startService({ resetRestarts: true }));
  ipcMain.handle('app:open-path', (_event, target) => {
    if (target === 'config') return shell.openPath(path.dirname(configPath(app)));
    if (target === 'logs') return shell.openPath(path.dirname(logFile));
    throw new Error('只能打开配置目录或日志目录');
  });
  ipcMain.handle('app:open-external', (_event, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('只允许打开 http 或 https 链接');
    return shell.openExternal(url);
  });
  ipcMain.handle('app:choose-data-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const target = path.resolve(result.filePaths[0]);
    const current = path.resolve(app.getPath('userData'));
    fs.mkdirSync(target, { recursive: true });
    if (target !== current) {
      const configFile = path.join(current, 'config.json');
      const logsDirectory = path.join(current, 'logs');
      if (fs.existsSync(configFile)) fs.copyFileSync(configFile, path.join(target, 'config.json'));
      if (fs.existsSync(logsDirectory)) fs.cpSync(logsDirectory, path.join(target, 'logs'), { recursive: true });
    }
    fs.mkdirSync(path.dirname(dataDirPointer), { recursive: true });
    fs.writeFileSync(dataDirPointer, `${target}\n`, { mode: 0o600 });
    return { dataDir: target, restartRequired: true };
  });
  ipcMain.handle('app:set-data-dir', (_event, dataDir) => {
    if (typeof dataDir !== 'string' || dataDir.length > 2000) throw new Error('数据目录路径无效');
    config = { ...config, dataDir: dataDir.trim() };
    writeConfig(app, config, safeStorage);
    return { dataDir: config.dataDir };
  });
  ipcMain.handle('settings:get', () => ({
    persona: config.persona,
    avatar: config.avatar || 'preset-1',
    userAvatar: config.userAvatar || 'preset-4',
    theme: config.theme || 'mono-light',
    phoneStyle: config.phoneStyle !== false,
    waveform: config.waveform !== false,
    toneId: config.activeToneId || '',
    toneText: config.toneText || '',
  }));
  ipcMain.handle('settings:save', (_event, patch) => {
    if (!patch || typeof patch !== 'object') throw new Error('设置参数无效');
    const next = { ...config };
    if (patch.persona && typeof patch.persona === 'object') next.persona = { ...config.persona, ...patch.persona };
    if (typeof patch.avatar === 'string') next.avatar = patch.avatar;
    if (typeof patch.userAvatar === 'string') next.userAvatar = patch.userAvatar;
    if (typeof patch.theme === 'string' && ['deep-space', 'mono-light', 'warm-night', 'contrast'].includes(patch.theme)) next.theme = patch.theme;
    if (typeof patch.phoneStyle === 'boolean') next.phoneStyle = patch.phoneStyle;
    if (typeof patch.waveform === 'boolean') next.waveform = patch.waveform;
    if (patch.toneText !== undefined) {
      if (typeof patch.toneText !== 'string' || patch.toneText.length > 2000) throw new Error('全局语气需要是 2000 字以内的文本');
      next.toneText = patch.toneText;
    }
    if (typeof patch.toneId === 'string' && toneOptions.some(item => item.id === patch.toneId)) next.activeToneId = patch.toneId;
    config = next;
    writeConfig(app, config, safeStorage);
    return {
      persona: config.persona,
      avatar: config.avatar,
      userAvatar: config.userAvatar,
      theme: config.theme,
      phoneStyle: config.phoneStyle !== false,
      waveform: config.waveform !== false,
      toneId: config.activeToneId || '',
      toneText: config.toneText || '',
    };
  });
  ipcMain.handle('agent:tones', () => ({ tones: toneOptions, activeToneId: config.activeToneId }));
  ipcMain.handle('agent:tone-set', (_event, id) => {
    if (typeof id !== 'string' || !toneOptions.some(item => item.id === id)) throw new Error('语气 id 无效');
    config = setActiveTone(app, id, safeStorage);
    return { activeToneId: config.activeToneId };
  });
  ipcMain.handle('agent:chat-start', (_event, input) => {
    if (!input || typeof input.conversationId !== 'string' || typeof input.text !== 'string') {
      throw new Error('对话参数无效');
    }
    const text = input.text.trim();
    if (!text) throw new Error('消息不能为空');
    if (!conversationStore) throw new Error('会话存储尚未准备好');
    return { ticketId: startAgentChat(input.conversationId, text) };
  });
  ipcMain.handle('agent:chat-abort', (_event, ticketId) => {
    if (typeof ticketId !== 'string') throw new Error('ticket id 无效');
    agentTickets.get(ticketId)?.controller.abort();
    return { ok: true };
  });
  ipcMain.handle('agent:conversation-list', () => conversationStore.list());
  ipcMain.handle('agent:conversation-load', (_event, id) => conversationStore.load(id));
  ipcMain.handle('agent:conversation-new', (_event, title) => conversationStore.create(typeof title === 'string' ? title : '新对话'));
  ipcMain.handle('agent:conversation-delete', (_event, id) => {
    if (typeof id !== 'string') throw new Error('会话 id 无效');
    conversationStore.delete(id);
    return { ok: true };
  });
  ipcMain.handle('agent:conversation-rename', (_event, input) => {
    if (!input || typeof input.id !== 'string' || typeof input.title !== 'string') throw new Error('重命名参数无效');
    return conversationStore.rename(input.id, input.title);
  });
  ipcMain.handle('agent:conversation-update', (_event, input) => {
    if (!input || typeof input.id !== 'string' || !input.patch || typeof input.patch !== 'object') {
      throw new Error('会话设置参数无效');
    }
    const patch = input.patch;
    if (patch.title !== undefined && (typeof patch.title !== 'string' || !patch.title.trim())) {
      throw new Error('联系人名称不能为空');
    }
    if (patch.number !== undefined) {
      const digits = String(patch.number).replace(/\D/g, '');
      if (digits && !/^\d{5,12}$/.test(digits)) throw new Error('号码需要 5–12 位数字');
      patch.number = digits;
    }
    if (patch.model !== undefined && patch.model !== '' && !config.providers.some(item => item.kind === 'llm' && item.id === patch.model)) {
      throw new Error('选择的模型不可用');
    }
    if (patch.toneId !== undefined && patch.toneId !== '' && !toneOptions.some(item => item.id === patch.toneId)) {
      throw new Error('选择的语气不可用');
    }
    if (patch.avatar !== undefined && patch.avatar !== ''
      && !/^(?:preset-[1-6]|data:image\/[a-z+]+;base64,)/i.test(String(patch.avatar))) {
      throw new Error('头像格式无效');
    }
    for (const key of ['persona', 'tone']) {
      if (patch[key] !== undefined && (typeof patch[key] !== 'string' || patch[key].length > 2000)) {
        throw new Error(`${key === 'persona' ? '人设' : '语气'}需要是 2000 字以内的文本`);
      }
    }
    return conversationStore.update(input.id, patch);
  });
  ipcMain.handle('agent:memory-get', () => ({
    memoryBaseUrl: config.memoryBaseUrl,
    memoryEnabled: config.memoryEnabled,
  }));
  ipcMain.handle('agent:memory-set', (_event, input) => {
    if (!input || typeof input.memoryBaseUrl !== 'string' || typeof input.memoryEnabled !== 'boolean') {
      throw new Error('记忆配置无效');
    }
    if (input.memoryBaseUrl && !/^https?:\/\//i.test(input.memoryBaseUrl)) throw new Error('记忆服务地址必须以 http:// 或 https:// 开头');
    config = setMemoryConfig(app, {
      memoryBaseUrl: input.memoryBaseUrl.trim(),
      memoryEnabled: input.memoryEnabled,
    }, safeStorage);
    return { memoryBaseUrl: config.memoryBaseUrl, memoryEnabled: config.memoryEnabled };
  });
  ipcMain.handle('agent:memory-test', async (_event, baseUrl) => {
    if (typeof baseUrl !== 'string') throw new Error('记忆服务地址无效');
    return testMemoryConnection({ memoryBaseUrl: baseUrl });
  });
}

async function bootstrap() {
  const logsDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  logFile = path.join(logsDir, 'desktop.log');
  writeLog(`桌面外壳启动，userData=${app.getPath('userData')}`);

  try {
    config = loadConfig(app, { safeStorage });
    toneOptions = readTones();
    conversationStore = new ConversationStore(path.join(app.getPath('userData'), 'conversations'));
  } catch (error) {
    publish({ status: 'failed', message: error.message });
  }
  registerIpc();
  createWindow();
  if (config) await startService();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    return bootstrap();
  });
  app.on('before-quit', event => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    event.preventDefault();
    isQuitting = true;
    serviceStopping = true;
    void stopService().finally(() => app.quit());
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      isQuitting = true;
      app.quit();
    });
  }
}
