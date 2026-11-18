const fs = require('fs');
const path = require('path');
const {
  getBuiltinProviders,
  getDefaultProfiles,
  updateProvider,
} = require('./providers.cjs');

const DEFAULT_CONFIG = {
  version: 3,
  port: 8787,
  env: {},
  dataDir: '',
  installDirHint: '',
  providers: [],
  profiles: [],
  activeProfileId: '',
  activeToneId: 'gentle-companion',
  toneText: '',
  memoryBaseUrl: '',
  memoryEnabled: false,
  providerKeys: {},
  envSecrets: {},
  onboardingDismissed: false,
  persona: {
    name: 'Earshot',
    self: '我',
    user: '你',
    personality: '认真、温和、可靠',
    style: '清楚、自然、简洁',
    taboo: '',
  },
  avatar: 'preset-1',
  userAvatar: 'preset-4',
  theme: 'mono-light',
  phoneStyle: true,
  waveform: true,
  aiVoiceReply: false,
  visionEnabled: false,
  chatBackground: '',
  callBackground: '',
  callBackdropHue: '',
  fluidCursor: true,
  backdropDensity: '',
  backdropPattern: '',
  backdropShape: '',
  fogColors: '',
  themeHue: '',
  appBackground: '',
};

// v3: 外观默认改为浅色；电话样式聊天与通话波形默认开启。
function finalizeConfig(source, value) {
  const next = { ...value };
  if (Number(source.version || 0) < 3 && next.theme === 'deep-space') next.theme = 'mono-light';
  next.version = 3;
  return next;
}

function configPath(app) {
  return path.join(app.getPath('userData'), 'config.json');
}

function getElectronSafeStorage() {
  try {
    return require('electron').safeStorage;
  } catch (_) {
    return null;
  }
}

function encryptSecret(value, safeStorage = getElectronSafeStorage()) {
  const text = String(value || '');
  if (safeStorage?.isEncryptionAvailable?.()) {
    return {
      encoding: 'safeStorage',
      value: safeStorage.encryptString(text).toString('base64'),
    };
  }
  return { encoding: 'plain', value: text };
}

function decryptSecret(record, safeStorage = getElectronSafeStorage()) {
  if (!record) return '';
  if (typeof record === 'string') return record;
  if (record.encoding === 'safeStorage' && safeStorage?.isEncryptionAvailable?.()) {
    try { return safeStorage.decryptString(Buffer.from(record.value, 'base64')); } catch (_) { return ''; }
  }
  return record.encoding === 'plain' ? String(record.value || '') : '';
}

function mergeConfig(value, safeStorage = getElectronSafeStorage()) {
  const source = value && typeof value === 'object' ? value : {};
  const providers = Array.isArray(source.providers) && source.providers.length
    ? source.providers
    : getBuiltinProviders();
  const profiles = Array.isArray(source.profiles) && source.profiles.length
    ? source.profiles
    : getDefaultProfiles();
  const activeProfileId = source.activeProfileId || profiles[0]?.id || '';
  const providerKeys = { ...(source.providerKeys && typeof source.providerKeys === 'object' ? source.providerKeys : {}) };
  const env = {
    ...DEFAULT_CONFIG.env,
    ...(source.env && typeof source.env === 'object' ? source.env : {}),
  };
  const envSecrets = {
    ...DEFAULT_CONFIG.envSecrets,
    ...(source.envSecrets && typeof source.envSecrets === 'object' ? source.envSecrets : {}),
  };

  // Migrate the original env-only desktop config without discarding values.
  if (!source.providers || !source.profiles || !source.providerKeys) {
    const secretEnvNames = Object.keys(env).filter(key => /(?:API_KEY|ACCESS_TOKEN|TOKEN|SECRET)/i.test(key));
    for (const key of secretEnvNames) {
      envSecrets[key] = envSecrets[key] || encryptSecret(env[key], safeStorage);
      delete env[key];
    }
    let migratedProviders = providers;
    const replace = (id, patch) => { migratedProviders = updateProvider(migratedProviders, id, patch); };
    if (source.env?.LLM_BASE_URL) replace('builtin-llm-openai', { baseUrl: source.env.LLM_BASE_URL, model: source.env.LLM_MODEL || 'gpt-4o-mini' });
    if (source.env?.STT_BASE_URL) replace('builtin-stt-openai', { baseUrl: source.env.STT_BASE_URL, model: source.env.STT_MODEL || 'whisper-1' });
    if (source.env?.TTS_PROVIDER === 'elevenlabs') {
      replace('builtin-tts-elevenlabs', { baseUrl: source.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io', model: source.env.ELEVENLABS_MODEL || 'eleven_v3', voice: source.env.ELEVENLABS_VOICE_ID || '' });
    } else if (source.env?.OPENAI_TTS_BASE_URL) {
      replace('builtin-tts-openai', { baseUrl: source.env.OPENAI_TTS_BASE_URL, model: source.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', voice: source.env.OPENAI_TTS_VOICE || 'alloy' });
    }
    const keyFor = name => envSecrets[name];
    if (keyFor('LLM_API_KEY')) providerKeys['builtin-llm-openai'] ||= keyFor('LLM_API_KEY');
    if (keyFor('STT_API_KEY')) providerKeys['builtin-stt-openai'] ||= keyFor('STT_API_KEY');
    if (source.env?.TTS_PROVIDER === 'elevenlabs' && keyFor('ELEVENLABS_API_KEY')) providerKeys['builtin-tts-elevenlabs'] ||= keyFor('ELEVENLABS_API_KEY');
    if (source.env?.TTS_PROVIDER !== 'elevenlabs' && keyFor('OPENAI_TTS_API_KEY')) providerKeys['builtin-tts-openai'] ||= keyFor('OPENAI_TTS_API_KEY');
    return finalizeConfig(source, {
      ...DEFAULT_CONFIG,
      ...source,
      version: 2,
      env,
      envSecrets,
      providers: migratedProviders,
      profiles,
      activeProfileId,
      providerKeys,
      onboardingDismissed: source.onboardingDismissed === true,
    });
  }

  return finalizeConfig(source, {
    ...DEFAULT_CONFIG,
    ...source,
    version: 2,
    env,
    envSecrets,
    providers,
    profiles,
    activeProfileId,
    providerKeys,
    onboardingDismissed: source.onboardingDismissed === true,
  });
}

function writeConfig(app, value, safeStorage = getElectronSafeStorage()) {
  const file = configPath(app);
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(mergeConfig(value, safeStorage), null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function loadConfig(app, { safeStorage = getElectronSafeStorage() } = {}) {
  const file = configPath(app);
  if (!fs.existsSync(file)) {
    const config = mergeConfig({}, safeStorage);
    writeConfig(app, config, safeStorage);
    return config;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`配置文件无法读取：${error.message}`);
  }
  const config = mergeConfig(parsed, safeStorage);
  if (JSON.stringify(config) !== JSON.stringify(parsed)) writeConfig(app, config, safeStorage);
  return config;
}

function readDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  const result = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trim().startsWith('#')) continue;
    let value = match[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

function launchEnvironment(app, config, rootDir, port, profileEnv = {}, safeStorage = getElectronSafeStorage()) {
  // Priority is config.json first, then the root .env file, then inherited process
  // variables for unrelated runtime settings. Secrets stay in the main process and
  // are passed only to the child service; they are never returned to the renderer.
  const dotenv = readDotEnv(path.join(rootDir, '.env'));
  const storedSecrets = Object.fromEntries(
    Object.entries(config.envSecrets || {}).map(([key, record]) => [key, decryptSecret(record, safeStorage)]),
  );
  const resolved = {
    ...process.env,
    ...dotenv,
    ...(config.env || {}),
    ...storedSecrets,
    ...profileEnv,
    PORT: String(port),
  };
  // 桌面版界面是中文，通话默认也用中文；需要英文时在环境变量里显式设置 REPLY_LANG=en。
  if (!resolved.REPLY_LANG) resolved.REPLY_LANG = 'zh';
  return resolved;
}

function saveProviders(app, providers, safeStorage) {
  const config = loadConfig(app, { safeStorage });
  const next = { ...config, providers };
  writeConfig(app, next, safeStorage);
  return mergeConfig(next, safeStorage);
}

function saveProfiles(app, profiles, safeStorage) {
  const config = loadConfig(app, { safeStorage });
  const next = { ...config, profiles };
  writeConfig(app, next, safeStorage);
  return mergeConfig(next, safeStorage);
}

function setActiveProfile(app, activeProfileId, safeStorage) {
  const config = loadConfig(app, { safeStorage });
  const next = { ...config, activeProfileId };
  writeConfig(app, next, safeStorage);
  return mergeConfig(next, safeStorage);
}

function setActiveTone(app, activeToneId, safeStorage) {
  const config = loadConfig(app, { safeStorage });
  const next = { ...config, activeToneId };
  writeConfig(app, next, safeStorage);
  return mergeConfig(next, safeStorage);
}

function setMemoryConfig(app, patch, safeStorage) {
  const config = loadConfig(app, { safeStorage });
  const next = {
    ...config,
    memoryBaseUrl: typeof patch?.memoryBaseUrl === 'string' ? patch.memoryBaseUrl : config.memoryBaseUrl,
    memoryEnabled: typeof patch?.memoryEnabled === 'boolean' ? patch.memoryEnabled : config.memoryEnabled,
  };
  writeConfig(app, next, safeStorage);
  return mergeConfig(next, safeStorage);
}

function setProviderKey(app, providerId, apiKey, safeStorage = getElectronSafeStorage()) {
  const config = loadConfig(app, { safeStorage });
  const providerKeys = { ...config.providerKeys, [providerId]: encryptSecret(apiKey, safeStorage) };
  const next = { ...config, providerKeys };
  writeConfig(app, next, safeStorage);
  return mergeConfig(next, safeStorage);
}

function setOnboardingDismissed(app, dismissed, safeStorage = getElectronSafeStorage()) {
  const config = loadConfig(app, { safeStorage });
  const next = { ...config, onboardingDismissed: dismissed === true };
  writeConfig(app, next, safeStorage);
  return mergeConfig(next, safeStorage);
}

function getProviderKey(config, providerId, safeStorage = getElectronSafeStorage()) {
  return decryptSecret(config?.providerKeys?.[providerId], safeStorage);
}

module.exports = {
  DEFAULT_CONFIG,
  configPath,
  encryptSecret,
  decryptSecret,
  loadConfig,
  writeConfig,
  launchEnvironment,
  saveProviders,
  saveProfiles,
  setActiveProfile,
  setActiveTone,
  setMemoryConfig,
  setProviderKey,
  setOnboardingDismissed,
  getProviderKey,
};
