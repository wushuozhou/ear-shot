const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
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

const DEFAULT_PORT = 8787;
const STARTUP_TIMEOUT_MS = 30_000;
const MAX_RESTARTS = 3;
const rootDir = path.resolve(__dirname, '..');
const serverScript = path.join(rootDir, 'server', 'index.js');

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
  mainWindow.loadFile(path.join(__dirname, 'loading.html'));
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
      await mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));
    }
  } catch (error) {
    writeLog(error.stack || error.message, 'startup-error');
    publish({ status: 'failed', message: `启动失败：${error.message}` });
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
  ipcMain.handle('profiles:list', () => ({
    profiles: config.profiles,
    activeProfileId: config.activeProfileId,
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
  ipcMain.handle('app:set-data-dir', (_event, dataDir) => {
    if (typeof dataDir !== 'string' || dataDir.length > 2000) throw new Error('数据目录路径无效');
    config = { ...config, dataDir: dataDir.trim() };
    writeConfig(app, config, safeStorage);
    return { dataDir: config.dataDir };
  });
}

async function bootstrap() {
  const logsDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  logFile = path.join(logsDir, 'desktop.log');
  writeLog(`桌面外壳启动，userData=${app.getPath('userData')}`);

  try {
    config = loadConfig(app, { safeStorage });
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

  app.whenReady().then(bootstrap);
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
