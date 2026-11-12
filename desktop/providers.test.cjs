const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  addProfile,
  addProvider,
  deleteProvider,
  getBuiltinProviders,
  getDefaultProfiles,
  resolveLaunchEnv,
  setActiveProfile,
  sortProviders,
  updateProvider,
} = require('./providers.cjs');
const {
  loadConfig,
  setProviderKey,
} = require('./config.cjs');

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: value => String(value).replace(/^encrypted:/, ''),
};

test('built-in providers and profiles are complete', () => {
  const providers = getBuiltinProviders();
  const profiles = getDefaultProfiles();
  assert.ok(providers.some(item => item.name === 'OpenAI' && item.kind === 'llm'));
  assert.ok(providers.some(item => item.name.includes('DeepSeek') && item.kind === 'llm'));
  assert.ok(providers.some(item => item.name.includes('硅基流动') && item.kind === 'llm'));
  assert.ok(providers.some(item => item.name.includes('OpenRouter') && item.kind === 'llm'));
  assert.ok(providers.some(item => item.name.includes('Groq') && item.kind === 'llm'));
  assert.ok(providers.some(item => item.name.includes('Ollama') && item.kind === 'llm'));
  assert.ok(providers.some(item => item.protocol === 'elevenlabs' && item.kind === 'tts'));
  assert.equal(profiles.length, 3);
  assert.ok(profiles.every(item => item.llmId && item.sttId && item.ttsId));
});

test('custom providers can be added, updated, sorted, and deleted immutably', () => {
  const original = getBuiltinProviders();
  const custom = {
    id: 'custom-llm-example',
    name: '我的第三方模型',
    kind: 'llm',
    baseUrl: 'https://example.test/v1',
    model: 'example-chat',
    extraHeaders: { 'X-Tenant': 'demo' },
  };
  const added = addProvider(original, custom);
  assert.equal(original.length + 1, added.length);
  assert.equal(original.some(item => item.id === custom.id), false);
  const updated = updateProvider(added, custom.id, { model: 'example-chat-2' });
  assert.equal(updated.find(item => item.id === custom.id).model, 'example-chat-2');
  const sorted = sortProviders(updated, [custom.id]);
  assert.equal(sorted[0].id, custom.id);
  const deleted = deleteProvider(updated, custom.id);
  assert.equal(deleted.some(item => item.id === custom.id), false);
  assert.throws(() => deleteProvider(original, original[0].id), /内置 Provider/);
});

test('profiles bind three providers and switch active profile immutably', () => {
  const original = getDefaultProfiles();
  const custom = addProfile(original, {
    id: 'profile-custom',
    name: '我的组合',
    llmId: 'builtin-llm-openai',
    sttId: 'builtin-stt-openai',
    ttsId: 'builtin-tts-openai',
  });
  assert.equal(original.length, 3);
  assert.equal(setActiveProfile(custom, 'profile-custom'), 'profile-custom');
});

test('resolveLaunchEnv maps a profile to Earshot variables', () => {
  const providers = getBuiltinProviders();
  const profile = getDefaultProfiles()[2];
  const runtime = providers.map(item => item.id === profile.ttsId ? { ...item, voice: 'voice-123', apiKey: 'tts-secret' } : item);
  const env = resolveLaunchEnv(profile, runtime);
  assert.equal(env.LLM_BASE_URL, 'https://api.openai.com/v1');
  assert.equal(env.LLM_MODEL, 'gpt-4o-mini');
  assert.equal(env.STT_MODEL, 'whisper-1');
  assert.equal(env.TTS_PROVIDER, 'elevenlabs');
  assert.equal(env.ELEVENLABS_VOICE_ID, 'voice-123');
  assert.equal(env.ELEVENLABS_API_KEY, 'tts-secret');
});

test('provider keys are encrypted and never written in plaintext', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'earshot-provider-config-'));
  const app = { getPath: () => dir };
  try {
    const config = loadConfig(app, { safeStorage: fakeSafeStorage });
    setProviderKey(app, 'builtin-llm-openai', 'secret-value', fakeSafeStorage);
    const file = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
    assert.doesNotMatch(file, /secret-value/);
    assert.equal(config.providerKeys['builtin-llm-openai'], undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('old env-only config migrates to providers and encrypted secret storage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'earshot-old-config-'));
  const app = { getPath: () => dir };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    version: 1,
    port: 9000,
    env: {
      LLM_BASE_URL: 'https://old.example/v1',
      LLM_API_KEY: 'old-secret',
      LLM_MODEL: 'old-model',
    },
    dataDir: '',
    installDirHint: '',
  }));
  try {
    const config = loadConfig(app, { safeStorage: fakeSafeStorage });
    assert.equal(config.port, 9000);
    assert.equal(config.providers.find(item => item.id === 'builtin-llm-openai').baseUrl, 'https://old.example/v1');
    assert.equal(config.env.LLM_BASE_URL, 'https://old.example/v1');
    assert.equal(config.env.LLM_API_KEY, undefined);
    assert.equal(config.providerKeys['builtin-llm-openai'].encoding, 'safeStorage');
    assert.equal(config.profiles.length, 3);
    assert.equal(config.activeProfileId, 'builtin-profile-openai');
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'), /old-secret/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
