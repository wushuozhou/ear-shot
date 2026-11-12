const PROVIDER_KINDS = ['llm', 'stt', 'tts'];
const PROTOCOLS = ['openai-compatible', 'elevenlabs', 'custom'];

// Built-in defaults follow the public provider documentation:
// OpenAI: https://platform.openai.com/docs/api-reference
// DeepSeek: https://api-docs.deepseek.com/
// SiliconFlow: https://docs.siliconflow.cn/
// OpenRouter: https://openrouter.ai/docs/api-reference
// Groq: https://console.groq.com/docs/openai
// Ollama: https://github.com/ollama/ollama/blob/main/docs/openai.md
// ElevenLabs: https://elevenlabs.io/docs/api-reference
const BUILTIN_PROVIDERS = [
  provider({ id: 'builtin-llm-openai', name: 'OpenAI', kind: 'llm', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', capabilities: ['llm.streaming'] }),
  provider({ id: 'builtin-llm-deepseek', name: 'DeepSeek', kind: 'llm', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', capabilities: ['llm.streaming'] }),
  provider({ id: 'builtin-llm-siliconflow', name: '硅基流动 SiliconFlow', kind: 'llm', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3', capabilities: ['llm.streaming'] }),
  provider({ id: 'builtin-llm-openrouter', name: 'OpenRouter', kind: 'llm', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', capabilities: ['llm.streaming'] }),
  provider({ id: 'builtin-llm-groq', name: 'Groq', kind: 'llm', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', capabilities: ['llm.streaming'] }),
  provider({ id: 'builtin-llm-ollama', name: 'Ollama（本地）', kind: 'llm', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.2', capabilities: ['llm.streaming'] }),
  provider({ id: 'builtin-llm-custom', name: '自定义 LLM（OpenAI 兼容）', kind: 'llm', baseUrl: '', model: '', capabilities: ['llm.streaming'] }),
  provider({ id: 'builtin-stt-openai', name: 'OpenAI Whisper', kind: 'stt', baseUrl: 'https://api.openai.com/v1', model: 'whisper-1', capabilities: ['stt.transcription'] }),
  provider({ id: 'builtin-stt-siliconflow', name: '硅基流动 SenseVoice', kind: 'stt', baseUrl: 'https://api.siliconflow.cn/v1', model: 'FunAudioLLM/SenseVoiceSmall', capabilities: ['stt.transcription'] }),
  provider({ id: 'builtin-stt-custom', name: '自定义 STT（OpenAI 兼容）', kind: 'stt', baseUrl: '', model: '', capabilities: ['stt.transcription'] }),
  provider({ id: 'builtin-tts-openai', name: 'OpenAI TTS', kind: 'tts', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', voice: 'alloy', capabilities: ['tts.audio'] }),
  provider({ id: 'builtin-tts-siliconflow', name: '硅基流动 CosyVoice', kind: 'tts', baseUrl: 'https://api.siliconflow.cn/v1', model: 'FunAudioLLM/CosyVoice2-0.5B', voice: 'FunAudioLLM/CosyVoice2-0.5B:alex', capabilities: ['tts.audio'] }),
  provider({ id: 'builtin-tts-elevenlabs', name: 'ElevenLabs', kind: 'tts', protocol: 'elevenlabs', baseUrl: 'https://api.elevenlabs.io', model: 'eleven_v3', voice: '', capabilities: ['tts.audio', 'tts.tags'] }),
  provider({ id: 'builtin-tts-custom', name: '自定义 TTS（OpenAI 兼容）', kind: 'tts', baseUrl: '', model: '', voice: '', capabilities: ['tts.audio'] }),
].map(item => ({ ...item, builtin: true }));

const DEFAULT_PROFILES = [
  profile({ id: 'builtin-profile-openai', name: '一把钥匙（全 OpenAI）', llmId: 'builtin-llm-openai', sttId: 'builtin-stt-openai', ttsId: 'builtin-tts-openai', builtin: true }),
  profile({ id: 'builtin-profile-china', name: '国内推荐', llmId: 'builtin-llm-deepseek', sttId: 'builtin-stt-siliconflow', ttsId: 'builtin-tts-siliconflow', builtin: true }),
  profile({ id: 'builtin-profile-expressive', name: '声音最有感情', llmId: 'builtin-llm-openai', sttId: 'builtin-stt-openai', ttsId: 'builtin-tts-elevenlabs', builtin: true }),
];

function provider(value) {
  const source = value || {};
  return {
    id: String(source.id || ''),
    name: String(source.name || ''),
    kind: PROVIDER_KINDS.includes(source.kind) ? source.kind : 'llm',
    protocol: PROTOCOLS.includes(source.protocol) ? source.protocol : 'openai-compatible',
    baseUrl: String(source.baseUrl || ''),
    apiKey: '',
    model: String(source.model || ''),
    voice: String(source.voice || ''),
    extraHeaders: cloneHeaders(source.extraHeaders),
    timeoutMs: Number(source.timeoutMs) > 0 ? Number(source.timeoutMs) : 8000,
    enabled: source.enabled !== false,
    builtin: source.builtin === true,
    capabilities: Array.isArray(source.capabilities) ? [...source.capabilities] : [],
  };
}

function profile(value) {
  const source = value || {};
  return {
    id: String(source.id || ''),
    name: String(source.name || ''),
    llmId: String(source.llmId || ''),
    sttId: String(source.sttId || ''),
    ttsId: String(source.ttsId || ''),
    builtin: source.builtin === true,
  };
}

function cloneHeaders(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [String(key), String(value)]));
}

function cloneProvider(value) {
  return provider(value);
}

function cloneProfile(value) {
  return profile(value);
}

function getBuiltinProviders() {
  return BUILTIN_PROVIDERS.map(cloneProvider);
}

function getDefaultProfiles() {
  return DEFAULT_PROFILES.map(cloneProfile);
}

function addProvider(providers, value) {
  const next = (providers || []).map(cloneProvider);
  const item = cloneProvider(value);
  if (!item.id || !item.name) throw new Error('Provider 需要填写 id 和名称');
  if (next.some(existing => existing.id === item.id)) throw new Error(`Provider 已存在：${item.id}`);
  return [...next, item];
}

function updateProvider(providers, id, patch) {
  return (providers || []).map(item => {
    if (item.id !== id) return cloneProvider(item);
    if (item.builtin && patch?.builtin === false) throw new Error('内置 Provider 不允许取消内置标记');
    return cloneProvider({ ...item, ...patch, id: item.id, builtin: item.builtin });
  });
}

function deleteProvider(providers, id) {
  const item = (providers || []).find(providerItem => providerItem.id === id);
  if (!item) return (providers || []).map(cloneProvider);
  if (item.builtin) throw new Error('内置 Provider 不允许删除');
  return (providers || []).filter(providerItem => providerItem.id !== id).map(cloneProvider);
}

function setProviderEnabled(providers, id, enabled) {
  return updateProvider(providers, id, { enabled: enabled !== false });
}

function sortProviders(providers, orderedIds) {
  const rank = new Map((orderedIds || []).map((id, index) => [id, index]));
  return (providers || []).map(cloneProvider).sort((a, b) => {
    const ar = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
    const br = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
    return ar - br;
  });
}

function addProfile(profiles, value) {
  const next = (profiles || []).map(cloneProfile);
  const item = cloneProfile(value);
  if (!item.id || !item.name) throw new Error('Profile 需要填写 id 和名称');
  if (next.some(existing => existing.id === item.id)) throw new Error(`Profile 已存在：${item.id}`);
  return [...next, item];
}

function updateProfile(profiles, id, patch) {
  return (profiles || []).map(item => item.id === id
    ? cloneProfile({ ...item, ...patch, id: item.id, builtin: item.builtin })
    : cloneProfile(item));
}

function deleteProfile(profiles, id, activeProfileId) {
  const item = (profiles || []).find(profileItem => profileItem.id === id);
  if (item?.builtin) throw new Error('内置 Profile 不允许删除');
  const next = (profiles || []).filter(profileItem => profileItem.id !== id).map(cloneProfile);
  if (next.length === 0) throw new Error('至少需要保留一个 Profile');
  if (id === activeProfileId) throw new Error('不能删除当前正在使用的 Profile');
  return next;
}

function setActiveProfile(profiles, id) {
  if (!(profiles || []).some(item => item.id === id)) throw new Error(`找不到 Profile：${id}`);
  return id;
}

function resolveLaunchEnv(activeProfile, providers, providerKeys = {}) {
  const list = providers || [];
  const find = id => list.find(item => item.id === id);
  const keyOf = item => {
    const stored = providerKeys[item.id];
    if (typeof stored === 'string') return stored;
    if (stored && stored.encoding === 'plain') return String(stored.value || '');
    if (typeof item.apiKey === 'string') return item.apiKey;
    return '';
  };
  const llm = find(activeProfile?.llmId);
  const stt = find(activeProfile?.sttId);
  const tts = find(activeProfile?.ttsId);
  if (!llm || !stt || !tts) throw new Error('Profile 引用的 Provider 不完整');
  const result = {
    LLM_BASE_URL: llm.baseUrl,
    LLM_API_KEY: keyOf(llm),
    LLM_MODEL: llm.model,
    STT_BASE_URL: stt.baseUrl,
    STT_API_KEY: keyOf(stt),
    STT_MODEL: stt.model,
    TTS_PROVIDER: tts.protocol === 'elevenlabs' ? 'elevenlabs' : 'openai',
    TTS_CONCURRENCY: String(tts.extraHeaders.TTS_CONCURRENCY || 2),
  };
  if (tts.protocol === 'elevenlabs') {
    result.ELEVENLABS_BASE_URL = tts.baseUrl;
    result.ELEVENLABS_API_KEY = keyOf(tts);
    result.ELEVENLABS_MODEL = tts.model;
    result.ELEVENLABS_VOICE_ID = tts.voice;
  } else {
    result.OPENAI_TTS_BASE_URL = tts.baseUrl;
    result.OPENAI_TTS_API_KEY = keyOf(tts);
    result.OPENAI_TTS_MODEL = tts.model;
    result.OPENAI_TTS_VOICE = tts.voice || 'alloy';
  }
  if (Object.keys(llm.extraHeaders).length) result.LLM_EXTRA_HEADERS = JSON.stringify(llm.extraHeaders);
  if (Object.keys(stt.extraHeaders).length) result.STT_EXTRA_HEADERS = JSON.stringify(stt.extraHeaders);
  if (Object.keys(tts.extraHeaders).length) result.TTS_EXTRA_HEADERS = JSON.stringify(tts.extraHeaders);
  return result;
}

module.exports = {
  PROVIDER_KINDS,
  PROTOCOLS,
  getBuiltinProviders,
  getDefaultProfiles,
  addProvider,
  updateProvider,
  deleteProvider,
  setProviderEnabled,
  sortProviders,
  addProfile,
  updateProfile,
  deleteProfile,
  setActiveProfile,
  resolveLaunchEnv,
};
