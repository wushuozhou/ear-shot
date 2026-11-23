const state = {
  providers: [],
  profiles: [],
  activeProfileId: '',
  onboardingDismissed: false,
  testedProviders: new Set(),
  meta: null,
  service: { status: 'starting', message: '正在启动服务…' },
  conversations: [],
  currentConversation: null,
  tones: [],
  activeToneId: '',
  memoryBaseUrl: '',
  memoryEnabled: false,
  agentBusy: false,
  agentTicketId: '',
  streamingText: '',
  draft: '',
  chat: { waveform: true },
  avatars: { ai: 'preset-1', user: 'preset-4' },
  selectMode: false,
  selected: new Set(),
  recording: null,
  recordingPending: false,
  quote: null,
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
  favorites: [],
  callLog: [],
  callTab: 'recents',
  dialNumber: '',
  conversationSearch: '',
  mobileChat: false,
  scrollToLatest: false,
};
const conversationDrafts = new Map();

const ACTIVE_CONVERSATION_KEY = 'earshot:active-conversation';
const AVATAR_PRESETS = ['preset-1', 'preset-2', 'preset-3', 'preset-4', 'preset-5', 'preset-6'];
const PHONE_THEME = ['deep-space', 'mono-light', 'warm-night', 'contrast'];

const $ = selector => document.querySelector(selector);
const content = $('#content');

document.addEventListener('pointerdown', event => {
  if (event.target.closest('.conversation-item-row')) return;
  document.querySelectorAll('.conversation-item-row.expanded').forEach(item => item.classList.remove('expanded'));
});

function rememberActiveConversation(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
    else localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
  } catch (_) {
    // localStorage 不可用时不影响会话切换。
  }
}

function rememberedConversationId() {
  try {
    return localStorage.getItem(ACTIVE_CONVERSATION_KEY) || '';
  } catch (_) {
    return '';
  }
}

// 切换联系人：加载该联系人自己的聊天记录，并中断上一轮的流式状态。
async function selectConversation(id) {
  if (!id) return;
  if (state.recording || state.recordingPending) throw new Error('请等待语音发送完成再切换联系人');
  const conversation = await window.desktop.agent.conversationLoad(id);
  if (state.currentConversation) conversationDrafts.set(state.currentConversation.id, { text: state.draft, quote: state.quote });
  if (state.agentTicketId) await window.desktop.agent.chatAbort(state.agentTicketId);
  state.currentConversation = conversation;
  state.agentBusy = false;
  state.agentTicketId = '';
  state.streamingText = '';
  const draft = conversationDrafts.get(id);
  state.draft = draft?.text || '';
  state.quote = draft?.quote || null;
  state.selectMode = false;
  state.selected.clear();
  state.scrollToLatest = true;
  rememberActiveConversation(conversation.id);
  return conversation;
}

async function reloadConversations() {
  state.conversations = (await window.desktop.agent.conversationList()) || [];
  return state.conversations;
}

function activeProfileProviders() {
  const profile = currentProfile();
  return [profile?.llmId, profile?.sttId, profile?.ttsId]
    .map(id => state.providers.find(provider => provider.id === id))
    .filter(Boolean);
}

function missingProfileProviders() {
  return activeProfileProviders().filter(provider => !provider.maskedKey);
}

function onboardingNeeded() {
  return missingProfileProviders().length > 0;
}

function onboardingComplete() {
  const providers = activeProfileProviders();
  return providers.length === 3
    && providers.every(provider => provider.maskedKey && state.testedProviders.has(provider.id));
}

function focusProviderCard(provider) {
  const target = document.getElementById(`provider-card-${provider.id}`);
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target?.classList.add('provider-highlight');
  setTimeout(() => target?.classList.remove('provider-highlight'), 2000);
  openProviderForm(provider);
}

function statusLabel(status) {
  if (status === 'ready') return '运行中';
  if (status === 'failed') return '已停止';
  return '启动中';
}

function renderOnboardingCard() {
  const card = document.createElement('section');
  card.className = 'onboarding-card';
  const title = document.createElement('h2');
  title.textContent = '三步就能用';
  const intro = document.createElement('p');
  intro.textContent = '选一个适合你的套餐，填好 Key，再测试连接。';
  card.append(title, intro);

  const stepOne = document.createElement('div');
  stepOne.className = 'onboarding-step';
  stepOne.innerHTML = '<strong>第 1 步：选一个套餐</strong>';
  const profiles = document.createElement('div');
  profiles.className = 'onboarding-profiles';
  [
    ['builtin-profile-openai', '一把钥匙全用 OpenAI'],
    ['builtin-profile-china', '国内推荐 DeepSeek+硅基流动'],
    ['builtin-profile-expressive', '声音最有感情 OpenAI+ElevenLabs'],
  ].forEach(([id, label]) => {
    const item = button(label, `onboarding-profile${id === state.activeProfileId ? ' selected' : ''}`);
    item.addEventListener('click', async () => {
      try {
        await window.desktop.profiles.setActive(id);
        state.testedProviders.clear();
        await window.desktop.app.restartService();
        await refresh();
      } catch (error) {
        showError(error.message);
      }
    });
    profiles.append(item);
  });
  stepOne.append(profiles);
  card.append(stepOne);

  const stepTwo = document.createElement('div');
  stepTwo.className = 'onboarding-step';
  stepTwo.innerHTML = '<strong>第 2 步：给还缺 Key 的供应商填 Key</strong>';
  const missing = missingProfileProviders();
  if (missing.length) {
    const missingList = document.createElement('div');
    missingList.className = 'onboarding-missing';
    missing.forEach(provider => {
      const item = document.createElement('div');
      item.className = 'onboarding-missing-item';
      item.textContent = provider.name;
      const fill = button('去填 Key', 'button button-quiet button-small');
      fill.addEventListener('click', () => focusProviderCard(provider));
      item.append(fill);
      missingList.append(item);
    });
    stepTwo.append(missingList);
  } else {
    stepTwo.append(document.createTextNode('三个供应商都已填写 Key。'));
  }
  card.append(stepTwo);

  const stepThree = document.createElement('div');
  stepThree.className = 'onboarding-step';
  stepThree.innerHTML = '<strong>第 3 步：逐个点「测试连接」，全都绿了就能用</strong>';
  card.append(stepThree);
  const footer = document.createElement('div');
  footer.className = 'onboarding-footer';
  footer.textContent = 'Key 只存在你这台电脑上，不会上传';
  if (onboardingComplete()) {
    const close = button('关闭向导', 'button button-quiet button-small');
    close.addEventListener('click', async () => {
      try {
        await window.desktop.onboarding.setDismissed(true);
        state.onboardingDismissed = true;
        renderProviders();
      } catch (error) {
        showError(error.message);
      }
    });
    footer.append(close);
  }
  card.append(footer);
  content.append(card);
}

function currentProfile() {
  return state.profiles.find(profile => profile.id === state.activeProfileId);
}

function currentModel() {
  const profile = currentProfile();
  return state.providers.find(provider => provider.id === profile?.llmId)?.model || '未配置模型';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMarkdown(value) {
  const blocks = [];
  let html = escapeHtml(value);
  html = html.replace(/```([\s\S]*?)```/g, (_match, code) => {
    const token = `@@CODE_${blocks.length}@@`;
    blocks.push(`<pre><code>${code.trim()}</code></pre>`);
    return token;
  });
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .split('\n').map(line => {
      if (/^\s*[-*]\s+/.test(line)) return `<ul><li>${line.replace(/^\s*[-*]\s+/, '')}</li></ul>`;
      return line;
    }).join('<br>');
  blocks.forEach((block, index) => {
    html = html.replace(`@@CODE_${index}@@`, block);
  });
  return html;
}

function stripStageDirections(value) {
  return String(value ?? '').replace(/\[[a-z][a-z ,'-]{0,40}\]\s?/gi, '');
}

function renderTop() {
  const status = statusLabel(state.service.status);
  // 顶栏已移除，服务状态只在侧边栏底部显示。
  const sidebarStatus = $('#sidebar-status');
  if (sidebarStatus) sidebarStatus.textContent = status;
  const dot = $('#sidebar-dot');
  if (dot) dot.className = state.service.status === 'ready' ? 'ready' : state.service.status === 'failed' ? 'failed' : '';
  const notice = $('#notice');
  if (!notice) return;
  notice.textContent = state.service.status === 'failed' ? state.service.message || '服务启动失败' : '';
  notice.classList.toggle('hidden', state.service.status !== 'failed');
}

function setActiveNav(route) {
  document.querySelectorAll('.nav a').forEach(link => {
    const active = link.dataset.route === route;
    link.classList.toggle('active', active);
    if (active) {
      link.setAttribute('aria-current', 'page');
      const lens = $('.nav-current');
      if (lens) lens.style.transform = matchMedia('(max-width: 600px)').matches
        ? `translateX(${link.offsetLeft}px)` : `translateY(${link.offsetTop}px)`;
    } else link.removeAttribute('aria-current');
  });
}

function button(text, className = 'button button-quiet') {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = className;
  item.textContent = text;
  return item;
}

function iconButton(title, path, className = 'icon-button') {
  const item = button('', className);
  item.title = title;
  item.setAttribute('aria-label', title);
  item.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${path}</svg>`;
  return item;
}

function isImageAvatar(value) {
  return String(value || '').startsWith('data:image/');
}

function paintAvatar(node, value, fallback = 'preset-1') {
  const target = String(value || '');
  node.classList.remove(...AVATAR_PRESETS);
  node.style.backgroundImage = '';
  if (isImageAvatar(target)) {
    node.style.backgroundImage = `url("${target}")`;
    return;
  }
  node.classList.add(AVATAR_PRESETS.includes(target) ? target : fallback);
}

function avatarNode(value, className = '') {
  const node = document.createElement('span');
  node.className = `avatar ${className}`.trim();
  paintAvatar(node, value);
  return node;
}

function avatarPicker(initial, onChange, fallback = 'preset-1') {
  let value = initial || fallback;
  const wrap = document.createElement('div');
  wrap.className = 'avatar-picker';
  const preview = avatarNode(value, 'avatar-picker-preview');
  const grid = document.createElement('div');
  grid.className = 'avatar-picker-grid';
  const refresh = () => {
    paintAvatar(preview, value, fallback);
    grid.querySelectorAll('.avatar-preset').forEach(item => item.classList.toggle('selected', item.dataset.value === value));
  };
  AVATAR_PRESETS.forEach(preset => {
    const option = button('', `avatar-preset ${preset}`);
    option.dataset.value = preset;
    option.title = `预设 ${preset.slice(-1)}`;
    option.addEventListener('click', () => {
      value = preset;
      refresh();
      onChange(value);
    });
    grid.append(option);
  });
  const upload = document.createElement('label');
  upload.className = 'avatar-preset avatar-upload-mini';
  upload.title = '上传图片';
  upload.textContent = '+';
  const file = document.createElement('input');
  file.type = 'file';
  file.hidden = true;
  file.accept = 'image/*';
  file.addEventListener('change', () => {
    const image = file.files?.[0];
    if (!image) return;
    if (!image.type.startsWith('image/')) return;
    if (image.size > 2 * 1024 * 1024) {
      showError('图片超过 2MB，请先压缩');
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      value = String(reader.result);
      refresh();
      onChange(value);
    });
    reader.readAsDataURL(image);
  });
  upload.append(file);
  grid.append(upload);
  wrap.append(preview, grid);
  refresh();
  return wrap;
}

function formatNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11) return `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
  // 不足 8 位时整段显示，避免输入过程中出现 "1380 0" 这种奇怪断字。
  if (digits.length < 8) return digits;
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function conversationSettings(item) {
  if (!item) return {};
  if (item.settings) return item.settings;
  // 会话列表的 meta 把设置平铺在顶层，这里统一成同一形状。
  return {
    number: item.number || '',
    model: item.model || '',
    toneId: item.toneId || '',
    tone: item.tone || '',
    persona: item.persona || '',
    avatar: item.avatar || '',
    style: item.style || '',
  };
}

function conversationAvatar(item) {
  return conversationSettings(item).avatar || state.avatars.ai || 'preset-1';
}

function conversationModel(item) {
  const id = conversationSettings(item).model;
  return state.providers.find(provider => provider.id === id && provider.kind === 'llm') || null;
}

function conversationModelName(item) {
  return conversationModel(item)?.model || currentModel();
}

// 大模型分组只保留 OpenAI、DeepSeek、硅基流动与自定义 LLM。
function visibleLlmProviders() {
  const allowed = new Set(['builtin-llm-openai', 'builtin-llm-deepseek', 'builtin-llm-siliconflow', 'builtin-llm-custom']);
  return state.providers.filter(provider => provider.kind === 'llm' && (!provider.builtin || allowed.has(provider.id)));
}

function selectableLlmProviders() {
  return visibleLlmProviders().filter(provider => provider.enabled !== false && provider.id);
}

function providerCard(provider) {
  const card = document.createElement('article');
  card.className = 'provider-card';
  card.id = `provider-card-${provider.id}`;
  const head = document.createElement('div');
  head.className = 'provider-card-head';
  const title = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'provider-name';
  name.textContent = provider.name;
  const id = document.createElement('div');
  id.className = 'provider-id';
  id.textContent = provider.id;
  title.append(name, id);
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = provider.protocol;
  const providerWebsites = {
    'builtin-llm-openai': 'https://platform.openai.com',
    'builtin-stt-openai': 'https://platform.openai.com',
    'builtin-tts-openai': 'https://platform.openai.com',
    'builtin-llm-deepseek': 'https://platform.deepseek.com',
    'builtin-llm-siliconflow': 'https://cloud.siliconflow.cn',
    'builtin-stt-siliconflow': 'https://cloud.siliconflow.cn',
    'builtin-tts-siliconflow': 'https://cloud.siliconflow.cn',
    'builtin-tts-elevenlabs': 'https://elevenlabs.io',
    'builtin-llm-openrouter': 'https://openrouter.ai',
    'builtin-llm-groq': 'https://console.groq.com',
    'builtin-llm-ollama': 'https://ollama.com',
  };
  const website = providerWebsites[provider.id];
  const headActions = document.createElement('div');
  headActions.className = 'provider-card-head-actions';
  headActions.append(tag);
  if (website) {
    const external = button('', 'provider-external');
    external.title = `打开 ${provider.name} 官网`;
    external.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8"/><path d="M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5"/></svg>';
    external.addEventListener('click', () => {
      window.desktop.app.openExternal(website).catch(error => showError(error.message));
    });
    headActions.append(external);
  }
  head.append(title, headActions);
  card.append(head);

  const meta = document.createElement('div');
  meta.className = 'provider-meta';
  const url = document.createElement('div');
  url.title = provider.baseUrl;
  url.textContent = provider.baseUrl || '还没有填写 Base URL';
  const model = document.createElement('div');
  model.textContent = `模型：${provider.model || '未填写'}`;
  const key = document.createElement('div');
  key.className = provider.maskedKey ? 'key-ok' : 'key-empty';
  key.textContent = provider.maskedKey ? `密钥：已配置（${provider.maskedKey}）` : '密钥：未配置';
  meta.append(url, model, key);
  card.append(meta);

  const actions = document.createElement('div');
  actions.className = 'provider-actions';
  const enabled = document.createElement('label');
  enabled.className = 'switch';
  enabled.title = provider.enabled ? '已启用' : '已禁用';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = provider.enabled;
  checkbox.addEventListener('change', async () => {
    checkbox.disabled = true;
    try {
      await window.desktop.providers.save({ ...provider, enabled: checkbox.checked });
      await refresh();
    } catch (error) {
      checkbox.checked = provider.enabled;
      showError(error.message);
    } finally {
      checkbox.disabled = false;
    }
  });
  const slider = document.createElement('span');
  slider.className = 'slider';
  enabled.append(checkbox, slider);
  actions.append(enabled);
  const edit = button('编辑', 'button button-quiet button-small');
  edit.addEventListener('click', () => openProviderForm(provider));
  const test = button('测试连接', 'button button-quiet button-small');
  test.addEventListener('click', async () => {
    test.disabled = true;
    test.textContent = '测试中…';
    const result = card.querySelector('.test-result');
    result.textContent = '';
    result.className = 'test-result';
    try {
      const response = await window.desktop.providers.test(provider.id);
      if (response.ok) state.testedProviders.add(provider.id);
      result.textContent = response.ok ? `成功，延迟 ${response.latencyMs} ms` : `失败：${response.message}`;
      result.className = `test-result ${response.ok ? 'ok' : 'fail'}`;
      if (response.ok) renderProviders();
    } catch (error) {
      result.textContent = `失败：${error.message}`;
      result.className = 'test-result fail';
    } finally {
      test.disabled = false;
      test.textContent = '测试连接';
    }
  });
  actions.append(edit, test);
  if (onboardingNeeded() && !provider.maskedKey) {
    const fill = button('去填 Key', 'button button-small');
    fill.addEventListener('click', () => focusProviderCard(provider));
    actions.append(fill);
  }
  if (!provider.builtin) {
    const remove = button('删除', 'button button-danger button-small');
    remove.addEventListener('click', async () => {
      if (!window.confirm(`确定删除“${provider.name}”吗？`)) return;
      try {
        await window.desktop.providers.delete(provider.id);
        await refresh();
      } catch (error) {
        showError(error.message);
      }
    });
    actions.append(remove);
  }
  card.append(actions);
  const result = document.createElement('div');
  result.className = 'test-result';
  card.append(result);
  return card;
}

function openQuickConnectForm() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('form');
  modal.className = 'modal quick-connect-modal';
  modal.innerHTML = '<h2>快速连接</h2>';
  const fields = [
    ['baseUrl', 'Base URL', 'url', true],
    ['apiKey', 'API Key', 'password', true],
    ['model', '模型名', 'text', false],
  ];
  fields.forEach(([name, label, type, required]) => {
    const row = document.createElement('div');
    row.className = 'form-field';
    const fieldLabel = document.createElement('label');
    fieldLabel.textContent = label;
    const input = document.createElement('input');
    input.name = name;
    input.type = type;
    input.required = required;
    row.append(fieldLabel, input);
    modal.append(row);
  });
  const error = document.createElement('div');
  error.className = 'quick-connect-error';
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const cancel = button('取消', 'button button-quiet');
  cancel.addEventListener('click', () => backdrop.remove());
  const save = button('验证并保存', 'button');
  actions.append(cancel, save);
  modal.append(error, actions);
  backdrop.append(modal);
  document.body.append(backdrop);
  modal.addEventListener('submit', async event => {
    event.preventDefault();
    error.textContent = '';
    save.disabled = true;
    try {
      await window.desktop.providers.quickConnect(Object.fromEntries(new FormData(modal)));
      backdrop.remove();
      await refresh();
    } catch (requestError) {
      error.textContent = requestError.message;
    } finally {
      save.disabled = false;
    }
  });
}

function formatBytes(value) {
  const size = Number(value) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(ms) {
  const total = Math.round((Number(ms) || 0) / 1000);
  const minute = Math.floor(total / 60);
  const second = total % 60;
  return minute ? `${minute}:${String(second).padStart(2, '0')}` : `${second}"`;
}

// 语音条：点一下播放，宽度随时长变化，和微信一致。
function voiceBubble(message) {
  const wrap = document.createElement('button');
  wrap.type = 'button';
  wrap.className = 'voice-bubble';
  const seconds = Math.max(1, Math.round((message.attachment?.durationMs || 0) / 1000));
  wrap.style.minWidth = `${Math.min(190, 72 + seconds * 6)}px`;
  const icon = document.createElement('span');
  icon.className = 'voice-icon';
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>';
  const label = document.createElement('span');
  label.textContent = formatDuration(message.attachment?.durationMs || 0);
  wrap.append(icon, label);
  let audio = null;
  wrap.addEventListener('click', event => {
    event.stopPropagation();
    if (audio && !audio.paused) {
      audio.pause();
      wrap.classList.remove('playing');
      return;
    }
    audio = new Audio(message.attachment?.dataUrl || '');
    wrap.classList.add('playing');
    audio.addEventListener('ended', () => wrap.classList.remove('playing'));
    audio.addEventListener('error', () => {
      wrap.classList.remove('playing');
      showError('这段语音播放失败');
    });
    audio.play().catch(() => wrap.classList.remove('playing'));
  });
  // 语音下面附上转写出来的文字，方便回看。
  if (String(message.content || '').trim()) {
    const box = document.createElement('div');
    box.className = 'voice-wrap';
    const text = document.createElement('div');
    text.className = 'voice-text';
    text.textContent = message.content;
    box.append(wrap, text);
    return box;
  }
  return wrap;
}

function attachmentBubble(message) {
  const attachment = message.attachment || {};
  if (message.kind === 'voice') return voiceBubble(message);
  if (message.kind === 'image') {
    const box = document.createElement('div');
    box.className = 'message-image-box';
    const image = document.createElement('img');
    image.className = 'message-image';
    image.src = attachment.dataUrl;
    image.alt = attachment.name || '图片';
    image.loading = 'lazy';
    // 图片坏掉时给个明确占位，不要留一块空白灰块。
    image.addEventListener('error', () => {
      box.classList.add('broken');
      box.textContent = `图片打不开：${attachment.name || '未命名'}`;
    });
    box.append(image);
    return box;
  }
  if (message.kind === 'video') {
    const video = document.createElement('video');
    video.className = 'message-video';
    video.src = attachment.dataUrl;
    video.controls = true;
    video.preload = 'metadata';
    return video;
  }
  const file = document.createElement('div');
  file.className = 'message-file';
  const icon = document.createElement('span');
  icon.className = 'message-file-icon';
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 3v5h5"/><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z"/></svg>';
  const text = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = attachment.name || '文件';
  const size = document.createElement('span');
  size.textContent = formatBytes(attachment.size);
  text.append(name, size);
  file.append(icon, text);
  return file;
}

function renderConversationMessages(streamingOnly = false) {
  const stream = $('#message-stream');
  if (!stream) return;
  const previous = { top: stream.scrollTop, height: stream.scrollHeight, viewport: stream.clientHeight };
  const streamingRow = stream.querySelector('[data-streaming]');
  if (streamingOnly && streamingRow) {
    streamingRow.querySelector('.message-bubble').innerHTML = renderMarkdown(stripStageDirections(state.streamingText));
    stream.scrollTop = chatUi.scrollTarget(previous, stream.scrollHeight);
    return;
  }
  stream.replaceChildren();
  const messages = state.currentConversation?.messages || [];
  if (onboardingNeeded()) {
    const empty = document.createElement('div');
    empty.className = 'message-empty';
    empty.innerHTML = '<div><strong>连接模型后开始聊天</strong><a href="#/providers">前往连接设置</a></div>';
    stream.append(empty);
    return;
  }
  const assistantAvatar = conversationAvatar(state.currentConversation);
  const rowFor = (message, streaming = false) => {
    const role = message.role;
    const row = document.createElement('div');
    row.className = `message-row ${role === 'user' ? 'user' : 'assistant'}`;
    const bubble = document.createElement('div');
    bubble.className = `message-bubble${message.kind && message.kind !== 'text' ? ' message-bubble-media' : ''}`;
    if (!message.kind || message.kind === 'text') {
      // 开头的 "> 引用" 单独渲染成引用块，正文另起，和微信的引用回复一致。
      const raw = String(message.content || '');
      const quoted = /^>\s?(.+?)\n\n([\s\S]*)$/.exec(raw);
      if (quoted) {
        const quoteBlock = document.createElement('div');
        quoteBlock.className = 'bubble-quote';
        quoteBlock.textContent = quoted[1];
        const body = document.createElement('div');
        body.innerHTML = renderMarkdown(stripStageDirections(quoted[2]));
        bubble.append(quoteBlock, body);
      } else {
        bubble.innerHTML = renderMarkdown(stripStageDirections(raw));
      }
    } else {
      bubble.append(attachmentBubble(message));
    }
    const avatar = avatarNode(role === 'user' ? state.avatars.user : assistantAvatar, 'message-avatar');
    if (role === 'user') row.append(bubble, avatar);
    else row.append(avatar, bubble);
    if (streaming) {
      row.dataset.streaming = 'true';
      if (!message.content) bubble.innerHTML = '<span class="typing-dots" aria-label="正在回复"><i></i><i></i><i></i></span>';
      return row;
    }
    if (!message.id) return row;
    // 多选时整行可勾选；非多选时左键/右键都弹出微信式操作菜单。
    if (state.selectMode) {
      row.classList.add('selectable');
      const checked = state.selected.has(message.id);
      row.classList.toggle('selected', checked);
      const mark = document.createElement('span');
      mark.className = 'message-check';
      mark.textContent = checked ? '✓' : '';
      row.prepend(mark);
      row.addEventListener('click', () => {
        if (state.selected.has(message.id)) state.selected.delete(message.id);
        else state.selected.add(message.id);
        renderConversation();
      });
      return row;
    }
    const openMenu = event => {
      event.preventDefault();
      event.stopPropagation();
      openMessageMenu(message, event.clientX, event.clientY, bubble.getBoundingClientRect());
    };
    bubble.tabIndex = 0;
    bubble.setAttribute('aria-label', `${role === 'user' ? '我' : '对方'}的消息，按菜单键查看操作`);
    bubble.addEventListener('keydown', event => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        const rect = bubble.getBoundingClientRect();
        event.preventDefault();
        openMessageMenu(message, rect.left + rect.width / 2, rect.top, rect);
        $('.message-menu button')?.focus();
      }
    });
    bubble.addEventListener('click', event => {
      if (event.target.closest('a, button, video, audio') || window.getSelection()?.toString()) return;
      openMenu(event);
    });
    row.addEventListener('contextmenu', openMenu);
    return row;
  };
  if (!messages.length && !state.streamingText && !state.agentBusy) {
    const empty = document.createElement('div');
    empty.className = 'message-empty';
    empty.innerHTML = state.currentConversation
      ? '<div><strong>开始聊天</strong></div>'
      : '<div><strong>选择一个联系人</strong></div>';
    stream.append(empty);
  } else {
    let lastTime = '';
    messages.forEach(message => {
      if (chatUi.startsTimeGroup(message.createdAt, lastTime)) {
        const time = document.createElement('time');
        time.className = 'message-time';
        time.dateTime = message.createdAt;
        time.textContent = chatUi.timeLabel(message.createdAt);
        stream.append(time);
      }
      if (message.createdAt) lastTime = message.createdAt;
      stream.append(rowFor(message));
    });
    if (state.agentBusy || state.streamingText) stream.append(rowFor({ role: 'assistant', kind: 'text', content: state.streamingText }, true));
  }
  stream.scrollTop = chatUi.scrollTarget(previous, stream.scrollHeight, state.scrollToLatest);
  state.scrollToLatest = false;
}

// 微信式气泡菜单：复制 / 收藏 / 引用 / 多选 / 删除。
function closeMessageMenu() {
  document.querySelectorAll('.message-menu, .conversation-menu').forEach(node => node.remove());
  document.querySelectorAll('[aria-controls="conversation-menu"]').forEach(node => node.setAttribute('aria-expanded', 'false'));
}

function openConversationMenu(trigger) {
  const wasOpen = !!$('#conversation-menu');
  closeMessageMenu();
  if (wasOpen) return;
  const menu = document.createElement('div');
  menu.id = 'conversation-menu';
  menu.className = 'conversation-menu';
  menu.setAttribute('aria-label', '聊天操作');
  const edit = button('联系人设置');
  const clear = button('清空聊天记录', 'danger');
  clear.disabled = !(state.currentConversation?.messages || []).length;
  edit.addEventListener('click', () => { closeMessageMenu(); openConversationEditor(state.currentConversation); });
  clear.addEventListener('click', () => { closeMessageMenu(); openClearConfirm(state.currentConversation); });
  menu.append(edit, clear);
  document.body.append(menu);
  const rect = trigger.getBoundingClientRect();
  menu.style.top = `${Math.min(rect.bottom + 8, innerHeight - menu.offsetHeight - 8)}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
  trigger.setAttribute('aria-expanded', 'true');
  edit.focus();
}

function openMessageMenu(message, x, y, bubbleRect = null) {
  closeMessageMenu();
  const menu = document.createElement('div');
  menu.className = 'message-menu';
  const items = [];
  const plainText = (!message.kind || message.kind === 'text')
    ? String(message.content || '')
    : String(message.content || '').trim();
  if (plainText) {
    items.push(['复制', '<path d="M9 9h10v10H9z"/><path d="M15 9V5H5v10h4"/>', async () => {
      try {
        await navigator.clipboard.writeText(plainText);
        showMessage('已复制');
      } catch (_) {
        showError('复制失败，剪贴板不可用');
      }
    }]);
  }
  items.push(['收藏', '<path d="M12 4.5 14.3 9l5 .7-3.6 3.5.9 5-4.6-2.4L7.4 18l.9-5L4.7 9.7l5-.7z"/>', () => favoriteMessages([message])]);
  if (plainText) {
    items.push(['引用', '<path d="M7 7h4v6H9a2 2 0 0 1-2-2zM15 7h4v6h-2a2 2 0 0 1-2-2z"/>', () => {
      state.quote = { id: message.id, role: message.role, text: plainText.slice(0, 200) };
      renderConversation();
    }]);
  }
  items.push(['多选', '<path d="m5 12 4 4L19 6"/><path d="M4 19h16"/>', () => {
    state.selectMode = true;
    state.selected = new Set([message.id]);
    renderConversation();
  }]);
  items.push(['删除', '<path d="M4 7h16M9 7V5h6v2"/><path d="M7 7v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7"/>', () => deleteSingleMessage(message), 'danger']);

  items.forEach(([label, icon, onPick, variant]) => {
    const item = button('', `message-menu-item${variant === 'danger' ? ' danger' : ''}`);
    item.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg><span>${label}</span>`;
    item.addEventListener('click', event => {
      event.stopPropagation();
      closeMessageMenu();
      onPick();
    });
    menu.append(item);
  });
  // 先挂上再量尺寸：菜单不压住被点的气泡，也不越出聊天区左右边界。
  menu.style.visibility = 'hidden';
  document.body.append(menu);
  const box = menu.getBoundingClientRect();
  const stream = $('#message-stream')?.getBoundingClientRect();
  const minLeft = Math.max(8, (stream?.left ?? 0) + 4);
  const maxLeft = Math.min(window.innerWidth - box.width - 8, (stream?.right ?? window.innerWidth) - box.width - 4);
  const left = Math.min(Math.max(minLeft, x - box.width / 2), Math.max(minLeft, maxLeft));
  // 默认放在气泡上方，贴着它；上方不够再放到下方。
  const anchor = bubbleRect || { top: y, bottom: y };
  let top = anchor.top - box.height - 8;
  if (top < 8) top = Math.min(anchor.bottom + 8, window.innerHeight - box.height - 8);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(Math.max(8, top))}px`;
  menu.style.visibility = '';
}

document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.message-menu, .conversation-menu, [aria-controls="conversation-menu"]')) closeMessageMenu();
}, true);
document.addEventListener('scroll', closeMessageMenu, true);
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    const trigger = $('[aria-controls="conversation-menu"][aria-expanded="true"]');
    closeMessageMenu();
    trigger?.focus();
  }
});

async function deleteSingleMessage(message) {
  if (!state.currentConversation || !message?.id) return;
  if (!window.confirm('删除这条消息？删除后无法恢复。')) return;
  try {
    const updated = await window.desktop.agent.messageDelete(state.currentConversation.id, message.id);
    state.currentConversation = updated;
    await reloadConversations();
    renderConversation();
    showMessage('已删除这条消息');
  } catch (error) {
    showError(error.message);
  }
}

async function favoriteMessages(messages) {
  const list = (messages || []).filter(Boolean);
  if (!list.length) {
    showError('请先选择要收藏的内容');
    return;
  }
  try {
    await window.desktop.favorites.add({
      source: 'chat',
      conversationId: state.currentConversation?.id || '',
      title: state.currentConversation?.title || '',
      messages: list,
    });
    // 收藏页读的是内存里的 state.favorites，写盘后必须回读，否则切过去看不到新收藏。
    state.favorites = await window.desktop.favorites.list();
    state.selectMode = false;
    state.selected.clear();
    renderConversation();
    showMessage(list.length > 1 ? `已收藏 ${list.length} 条` : '已收藏');
  } catch (error) {
    showError(error.message);
  }
}

function renderConversation() {
  const oldStream = $('#message-stream');
  const oldScroll = oldStream && oldStream.dataset.conversation === state.currentConversation?.id
    ? { top: oldStream.scrollTop, height: oldStream.scrollHeight, viewport: oldStream.clientHeight } : null;
  const hadFocus = document.activeElement?.matches('.message-form textarea');
  const caret = hadFocus ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  closeMessageMenu();
  content.classList.add('chat-content');
  content.replaceChildren();
  const layout = document.createElement('div');
  layout.className = `conversation-layout${state.mobileChat ? ' mobile-chat' : ''}`;
  const list = document.createElement('aside');
  list.className = 'conversation-list';
  const listHead = document.createElement('div');
  listHead.className = 'conversation-list-head';
  const listTitle = document.createElement('strong');
  listTitle.textContent = '聊天';
  const newConversation = iconButton('新建联系人', '<path d="M12 5v14M5 12h14"/>');
  newConversation.addEventListener('click', async () => {
    try {
      const created = await window.desktop.agent.conversationNew('新对话');
      await reloadConversations();
      await selectConversation(created.id);
      state.mobileChat = true;
      renderConversation();
      openConversationEditor(state.currentConversation);
    } catch (error) {
      showError(error.message);
    }
  });
  listHead.append(listTitle, newConversation);
  list.append(listHead);
  const search = document.createElement('label');
  search.className = 'conversation-search';
  search.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = '搜索';
  searchInput.setAttribute('aria-label', '搜索联系人姓名或号码');
  searchInput.value = state.conversationSearch;
  search.append(searchInput);
  list.append(search);
  const items = document.createElement('div');
  items.className = 'conversation-items';
  if (!state.conversations.length) {
    const empty = document.createElement('div');
    empty.className = 'conversation-empty';
    empty.textContent = '点击右上角 + 添加联系人';
    items.append(empty);
  }
  state.conversations.forEach(item => {
    const itemRow = document.createElement('div');
    itemRow.className = 'conversation-item-row';
    const active = item.id === state.currentConversation?.id;
    const row = button('', `conversation-item${active ? ' active' : ''}`);
    row.setAttribute('aria-current', active ? 'true' : 'false');
    row.title = item.title || '新对话';
    row.append(avatarNode(conversationAvatar(item), 'conversation-avatar'));
    const body = document.createElement('span');
    body.className = 'conversation-item-body';
    const name = document.createElement('span');
    name.className = 'conversation-item-name';
    name.textContent = item.title || '新对话';
    const sub = document.createElement('span');
    sub.className = 'conversation-item-sub';
    sub.textContent = item.preview || '';
    const line = document.createElement('span');
    line.className = 'conversation-item-line';
    const time = document.createElement('time');
    time.className = 'conversation-item-time';
    time.textContent = chatUi.timeLabel(item.updatedAt).replace(/^(昨天) .*/, '$1');
    line.append(name, time);
    body.append(line, sub);
    row.append(body);
    row.addEventListener('click', async () => {
      if (itemRow.classList.contains('expanded')) {
        itemRow.classList.remove('expanded');
        return;
      }
      if (item.id === state.currentConversation?.id) {
        state.mobileChat = true;
        layout.classList.add('mobile-chat');
        return;
      }
      try {
        await selectConversation(item.id);
        state.mobileChat = true;
        renderConversation();
      } catch (error) {
        showError(error.message);
      }
    });
    const actions = document.createElement('div');
    actions.className = 'conversation-item-actions';
    // 侧栏很窄，按钮用图标 + 短字，保证滑开后头像和名字仍然看得见。
    const swipeAction = (label, title, icon, className) => {
      const action = button('', className);
      action.title = title;
      action.setAttribute('aria-label', title);
      action.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg><span>${label}</span>`;
      return action;
    };
    const clear = swipeAction('清空', '清空聊天记录',
      '<path d="M4 7h16M9 7V5h6v2"/><path d="M7 7v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7"/>',
      'conversation-item-action');
    clear.addEventListener('click', event => {
      event.stopPropagation();
      itemRow.classList.remove('expanded');
      openClearConfirm(item);
    });
    const remove = swipeAction('删除', '删除联系人',
      '<path d="M18 6 6 18M6 6l12 12"/>',
      'conversation-item-action conversation-item-delete');
    remove.addEventListener('click', event => {
      event.stopPropagation();
      itemRow.classList.remove('expanded');
      openDeleteConfirm(item);
    });
    actions.append(clear, remove);
    itemRow.append(row, actions);
    attachSwipe(itemRow, items);
    itemRow.dataset.contactId = item.id;
    itemRow.classList.toggle('hidden', !chatUi.matchesConversation(item, state.conversationSearch));
    items.append(itemRow);
  });
  const noResults = document.createElement('div');
  noResults.className = 'conversation-empty';
  noResults.textContent = '没有找到联系人';
  const filterContacts = () => {
    state.conversationSearch = searchInput.value;
    let visible = 0;
    items.querySelectorAll('[data-contact-id]').forEach(row => {
      const contact = state.conversations.find(item => item.id === row.dataset.contactId);
      const match = chatUi.matchesConversation(contact, state.conversationSearch);
      row.classList.toggle('hidden', !match);
      if (match) visible++;
    });
    noResults.classList.toggle('hidden', visible > 0 || !state.conversations.length);
  };
  items.append(noResults);
  filterContacts();
  searchInput.addEventListener('input', filterContacts);
  list.append(items);

  const main = document.createElement('section');
  main.className = 'conversation-main';
  const toolbar = document.createElement('div');
  toolbar.className = 'conversation-toolbar';
  const identity = document.createElement('div');
  identity.className = 'conversation-identity';
  const back = iconButton('返回聊天列表', '<path d="m14 6-6 6 6 6"/>', 'icon-button conversation-back');
  back.addEventListener('click', () => { state.mobileChat = false; layout.classList.remove('mobile-chat'); });
  toolbar.append(back);
  identity.append(avatarNode(conversationAvatar(state.currentConversation), 'conversation-main-avatar'));
  const identityText = document.createElement('div');
  const heading = document.createElement('h1');
  heading.textContent = state.currentConversation?.title || '对话';
  identityText.append(heading);
  if (state.currentConversation) {
    const subtitle = document.createElement('span');
    subtitle.className = 'model-label';
    subtitle.textContent = conversationModelName(state.currentConversation);
    identityText.append(subtitle);
  }
  identity.append(identityText);
  const tools = document.createElement('div');
  tools.className = 'conversation-tools';
  if (state.currentConversation) {
    if (state.selectMode) {
      const count = state.selected.size;
      const favorite = button(count ? `收藏 ${count} 条` : '收藏所选', 'button button-small');
      favorite.disabled = !count;
      favorite.addEventListener('click', () => {
        const picked = (state.currentConversation.messages || []).filter(item => state.selected.has(item.id));
        favoriteMessages(picked);
      });
      const cancel = button('取消', 'button button-quiet button-small');
      cancel.addEventListener('click', () => {
        state.selectMode = false;
        state.selected.clear();
        renderConversation();
      });
      tools.append(favorite, cancel);
    } else {
      const call = iconButton('语音通话', '<path d="M8 3H4v3c0 8 6 14 14 14h3v-5l-5-1-2 2a14 14 0 0 1-6-6l2-2-2-5Z"/>');
      call.addEventListener('click', () => { location.hash = '#/call'; });
      const more = iconButton('更多聊天操作', '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>');
      more.setAttribute('aria-controls', 'conversation-menu');
      more.setAttribute('aria-expanded', 'false');
      more.addEventListener('click', () => openConversationMenu(more));
      tools.append(call, more);
    }
  }
  toolbar.append(identity, tools);
  main.append(toolbar);
  const stream = document.createElement('div');
  stream.id = 'message-stream';
  stream.className = 'message-stream';
  stream.dataset.conversation = state.currentConversation?.id || '';
  stream.setAttribute('aria-label', '聊天消息');
  stream.tabIndex = 0;
  // 自定义聊天背景。
  if (state.chatBackground) {
    if (state.chatBackground.startsWith('data:image/')) {
      stream.style.backgroundImage = `url("${state.chatBackground}")`;
      stream.style.backgroundSize = 'cover';
      stream.style.backgroundPosition = 'center';
    } else {
      stream.style.background = state.chatBackground;
    }
  }
  main.append(stream);
  const form = document.createElement('form');
  form.className = 'message-form';
  const disabled = state.agentBusy || state.recordingPending || onboardingNeeded() || !state.currentConversation;

  // 左侧工具：语音、图片/视频、文件，以及 AI 语音回复开关。
  const actionsBar = document.createElement('div');
  actionsBar.className = 'compose-actions';
  const micButton = button('', `compose-icon${state.recording ? ' recording' : ''}`);
  micButton.title = state.recording ? '结束录音并发送' : '录制语音';
  micButton.setAttribute('aria-label', micButton.title);
  micButton.disabled = disabled;
  micButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  micButton.addEventListener('click', () => toggleRecording());
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.hidden = true;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) sendAttachment(file);
  });
  const fileButton = button('', 'compose-icon');
  fileButton.title = '发送文件';
  fileButton.setAttribute('aria-label', '发送图片、视频或文件');
  fileButton.disabled = disabled;
  fileButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 3v5h5"/><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z"/></svg>';
  fileButton.addEventListener('click', () => fileInput.click());
  const voiceToggle = document.createElement('label');
  voiceToggle.className = `compose-voice-toggle${state.aiVoiceReply ? ' on' : ''}`;
  voiceToggle.title = '让 AI 发语音回复';
  const voiceCheck = document.createElement('input');
  voiceCheck.type = 'checkbox';
  voiceCheck.setAttribute('aria-label', 'AI 使用语音回复');
  voiceCheck.checked = state.aiVoiceReply;
  voiceCheck.addEventListener('change', async () => {
    try {
      await window.desktop.app.settings.save({ aiVoiceReply: voiceCheck.checked });
      state.aiVoiceReply = voiceCheck.checked;
      voiceToggle.classList.toggle('on', state.aiVoiceReply);
      showMessage(state.aiVoiceReply ? 'AI 将用语音回复' : 'AI 将用文字回复');
    } catch (error) {
      voiceCheck.checked = !voiceCheck.checked;
      showError(error.message);
    }
  });
  const voiceLabel = document.createElement('span');
  voiceLabel.setAttribute('aria-hidden', 'true');
  voiceLabel.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m11 4-6 5H2v6h3l6 5V4Z"/><path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
  voiceToggle.append(voiceCheck, voiceLabel);
  const replyStatus = document.createElement('span');
  replyStatus.className = 'compose-status';
  replyStatus.setAttribute('role', 'status');
  replyStatus.textContent = state.recordingPending ? '正在处理语音…' : state.agentBusy ? '正在回复…' : '';
  actionsBar.append(replyStatus);
  if (state.recording) {
    const tip = document.createElement('span');
    tip.className = 'recording-tip';
    tip.textContent = '正在录音…';
    actionsBar.append(tip);
  }

  const inputRow = document.createElement('div');
  inputRow.className = 'compose-row';
  let quoteBar = null;
  // 引用栏：选了「引用」后显示在输入框上方，发送时并进这一条。
  if (state.quote) {
    const quote = document.createElement('div');
    quote.className = 'compose-quote';
    const text = document.createElement('div');
    text.className = 'compose-quote-text';
    text.textContent = `${state.quote.role === 'user' ? '我' : '对方'}：${state.quote.text}`;
    const drop = button('', 'compose-quote-close');
    drop.title = '取消引用';
    drop.setAttribute('aria-label', '取消引用');
    drop.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    drop.addEventListener('click', () => {
      state.quote = null;
      renderConversation();
    });
    quote.append(text, drop);
    quoteBar = quote;
  }
  const input = document.createElement('textarea');
  input.disabled = onboardingNeeded() || !state.currentConversation;
  input.placeholder = state.currentConversation ? '发消息…' : '选择联系人';
  input.setAttribute('aria-label', '消息，Enter 发送，Shift+Enter 换行');
  input.value = state.draft || '';
  const resizeInput = () => { input.style.height = '44px'; input.style.height = `${Math.min(140, Math.max(44, input.scrollHeight))}px`; };
  input.addEventListener('input', () => {
    state.draft = input.value;
    if (!state.agentBusy) send.disabled = disabled || !input.value.trim();
    resizeInput();
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !state.agentBusy) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  // 直接粘贴图片或视频就发出去，不用再点选择按钮。
  input.addEventListener('paste', event => {
    const items = [...(event.clipboardData?.items || [])];
    const media = items.find(item => item.kind === 'file' && /^(image|video)\//.test(item.type));
    if (!media) return;
    const file = media.getAsFile();
    if (!file) return;
    event.preventDefault();
    sendAttachment(file);
  });
  // 拖进来也当作发送。
  const stopDefault = event => { event.preventDefault(); event.stopPropagation(); };
  ['dragenter', 'dragover'].forEach(name => form.addEventListener(name, event => {
    stopDefault(event);
    form.classList.add('dropping');
  }));
  ['dragleave', 'dragend'].forEach(name => form.addEventListener(name, event => {
    stopDefault(event);
    if (name === 'dragleave' && form.contains(event.relatedTarget)) return;
    form.classList.remove('dropping');
  }));
  form.addEventListener('drop', event => {
    stopDefault(event);
    form.classList.remove('dropping');
    const file = event.dataTransfer?.files?.[0];
    if (file) sendAttachment(file);
  });
  const send = button(state.agentBusy ? '停止' : '发送', `button${state.agentBusy ? ' stop-button' : ''}`);
  send.type = state.agentBusy ? 'button' : 'submit';
  send.setAttribute('aria-label', state.agentBusy ? '停止生成回复' : '发送消息');
  send.disabled = state.agentBusy ? !state.agentTicketId : disabled || !input.value.trim();
  if (state.agentBusy) send.addEventListener('click', async () => {
    send.disabled = true;
    try { await window.desktop.agent.chatAbort(state.agentTicketId); }
    catch (error) { showError(error.message); send.disabled = false; }
  });
  inputRow.append(micButton, input, voiceToggle, fileButton, send, fileInput);
  if (state.agentBusy || state.recordingPending || state.recording) form.append(actionsBar);
  if (quoteBar) form.append(quoteBar);
  form.append(inputRow);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const value = input.value;
    if (!value.trim() || state.agentBusy || disabled) return;
    input.value = '';
    state.draft = '';
    startAgentChat(value);
  });
  main.append(form);
  layout.append(list, main);
  content.append(layout);
  const forceScroll = state.scrollToLatest;
  renderConversationMessages();
  if (oldScroll && !forceScroll) stream.scrollTop = chatUi.scrollTarget(oldScroll, stream.scrollHeight);
  resizeInput();
  if (hadFocus && !input.disabled) {
    input.focus({ preventScroll: true });
    if (caret) input.setSelectionRange(...caret);
  }
}

// iOS 风格侧滑：操作按钮垫在行下层，靠前景行左移"揭开"。
// 不用 setPointerCapture——指针捕获会把后续 click 重定向到容器，让行内按钮点不动。
function attachSwipe(itemRow, items) {
  const actions = itemRow.querySelector('.conversation-item-actions');
  let startX = 0;
  let startY = 0;
  let offsetX = 0;
  let dragging = false;
  let swiped = false;
  const maxSwipe = () => actions?.offsetWidth || 88;
  const collapseOthers = () => {
    items.querySelectorAll('.conversation-item-row.expanded').forEach(other => {
      if (other !== itemRow) other.classList.remove('expanded');
    });
  };
  const reset = () => {
    dragging = false;
    itemRow.classList.remove('swiping');
    itemRow.style.removeProperty('--swipe-x');
  };
  itemRow.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.target.closest('.conversation-item-action')) return;
    collapseOthers();
    startX = event.clientX;
    startY = event.clientY;
    offsetX = itemRow.classList.contains('expanded') ? -maxSwipe() : 0;
    dragging = true;
    swiped = false;
  });
  itemRow.addEventListener('pointermove', event => {
    if (!dragging) return;
    const dx = event.clientX - startX;
    // 纵向滑动优先交给列表滚动，不抢手势。
    if (!swiped && Math.abs(event.clientY - startY) > Math.abs(dx)) return;
    const base = itemRow.classList.contains('expanded') ? -maxSwipe() : 0;
    // 超出上限后阻尼，手感接近 iOS。
    let next = base + dx;
    if (next > 0) next *= 0.3;
    if (next < -maxSwipe()) next = -maxSwipe() + (next + maxSwipe()) * 0.3;
    offsetX = next;
    if (Math.abs(dx) > 6) {
      swiped = true;
      itemRow.classList.add('swiping');
    }
    if (swiped) itemRow.style.setProperty('--swipe-x', `${-offsetX}px`);
  });
  const finish = () => {
    if (!dragging) return;
    const limit = maxSwipe();
    const shouldOpen = offsetX < -limit / 2;
    reset();
    if (!swiped) return;
    // 展开宽度以按钮实际宽度为准，避免 CSS 写死值与按钮宽度不一致。
    itemRow.style.setProperty('--swipe-open', `${limit}px`);
    itemRow.classList.toggle('expanded', shouldOpen);
    if (shouldOpen) collapseOthers();
  };
  itemRow.addEventListener('pointerup', finish);
  itemRow.addEventListener('pointerleave', finish);
  itemRow.addEventListener('pointercancel', () => {
    reset();
    swiped = false;
  });
  // 只有真正拖动过才吞掉这次点击，普通点击要能正常切换联系人。
  // 捕获阶段先放行按钮，避免上一次滑动的残留状态吞掉按钮点击。
  itemRow.addEventListener('click', event => {
    if (event.target.closest('.conversation-item-action')) {
      swiped = false;
      return;
    }
    if (!swiped) return;
    swiped = false;
    event.stopPropagation();
    event.preventDefault();
  }, true);
}

function openConversationEditor(item) {
  if (!item) return;
  const settings = conversationSettings(item);
  let pendingAvatar = settings.avatar || state.avatars.ai || 'preset-1';
  let pendingModel = settings.model || '';
  let pendingTone = settings.toneId || '';
  let pendingPersona = settings.persona || '';
  let pendingToneText = settings.tone || '';

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('form');
  modal.className = 'modal conversation-editor';
  modal.innerHTML = '<h2>联系人设置</h2>';

  const preview = document.createElement('div');
  preview.className = 'editor-contact';
  const previewAvatar = avatarNode(pendingAvatar, 'editor-avatar');
  const previewText = document.createElement('div');
  const previewName = document.createElement('strong');
  previewName.textContent = item.title || '新对话';
  const previewNumber = document.createElement('span');
  previewNumber.className = 'editor-number';
  previewNumber.textContent = settings.number ? formatNumber(settings.number) : '未设置号码';
  previewText.append(previewName, previewNumber);
  preview.append(previewAvatar, previewText);
  modal.append(preview);

  const fieldWrap = (label, control, hint) => {
    const wrap = document.createElement('label');
    wrap.className = 'editor-field';
    const title = document.createElement('span');
    title.textContent = label;
    wrap.append(title, control);
    if (hint) {
      const note = document.createElement('small');
      note.textContent = hint;
      wrap.append(note);
    }
    return wrap;
  };

  const nameInput = document.createElement('input');
  nameInput.value = item.title || '';
  nameInput.maxLength = 40;
  nameInput.placeholder = '例如：小满';
  nameInput.addEventListener('input', () => {
    previewName.textContent = nameInput.value.trim() || '新对话';
  });

  const avatarField = document.createElement('div');
  avatarField.className = 'editor-field';
  const avatarTitle = document.createElement('span');
  avatarTitle.textContent = 'AI 头像';
  avatarField.append(avatarTitle, avatarPicker(pendingAvatar, value => {
    pendingAvatar = value;
    paintAvatar(previewAvatar, value);
  }));

  const modelSelect = document.createElement('select');
  const follow = document.createElement('option');
  follow.value = '';
  follow.textContent = `跟随当前套餐（${currentModel()}）`;
  modelSelect.append(follow);
  selectableLlmProviders().forEach(provider => {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = `${provider.name} · ${provider.model || '未填模型'}`;
    option.selected = provider.id === pendingModel;
    modelSelect.append(option);
  });

  const personaInput = document.createElement('textarea');
  personaInput.value = pendingPersona || (settings.style ? `说话风格：${settings.style}` : '');
  personaInput.maxLength = 2000;
  personaInput.rows = 4;
  const toneInput = document.createElement('textarea');
  toneInput.value = pendingToneText;
  toneInput.maxLength = 2000;
  toneInput.rows = 4;

  const numberInput = document.createElement('input');
  numberInput.inputMode = 'numeric';
  numberInput.value = settings.number || '';
  numberInput.placeholder = '5–12 位数字，可留空';
  numberInput.addEventListener('input', () => {
    const digits = numberInput.value.replace(/\D/g, '').slice(0, 12);
    numberInput.value = digits;
    previewNumber.textContent = digits ? formatNumber(digits) : '未设置号码';
  });

  modal.append(
    fieldWrap('联系人名称', nameInput),
    avatarField,
    fieldWrap('使用的模型', modelSelect),
    fieldWrap('人设', personaInput, '自由描述这个联系人的身份、性格和回应方式。'),
    fieldWrap('语气', toneInput, '留空时使用设置页的全局默认语气。'),
    fieldWrap('电话号码', numberInput),
  );

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const cancel = button('取消', 'button button-quiet');
  cancel.addEventListener('click', () => backdrop.remove());
  const save = button('保存', 'button');
  save.type = 'submit';
  actions.append(cancel, save);
  modal.append(actions);
  backdrop.append(modal);
  document.body.append(backdrop);
  nameInput.focus();

  modal.addEventListener('submit', async event => {
    event.preventDefault();
    const title = nameInput.value.trim();
    if (!title) {
      showError('联系人名称不能为空');
      return;
    }
    const digits = numberInput.value.replace(/\D/g, '');
    if (digits && !/^\d{5,12}$/.test(digits)) {
      showError('号码需要 5–12 位数字');
      return;
    }
    save.disabled = true;
    try {
      const updated = await window.desktop.agent.conversationUpdate(item.id, {
        title,
        avatar: pendingAvatar,
        model: modelSelect.value,
        toneId: pendingTone,
        persona: personaInput.value.trim(),
        tone: toneInput.value.trim(),
        number: digits,
      });
      if (state.currentConversation?.id === item.id) {
        state.currentConversation = { ...updated, messages: state.currentConversation.messages || updated.messages || [] };
      }
      await reloadConversations();
      backdrop.remove();
      renderRoute();
      showMessage('联系人设置已保存');
    } catch (error) {
      save.disabled = false;
      showError(error.message);
    }

  });
}

function openClearAllConfirm() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal delete-confirm-modal';
  modal.innerHTML = '<h2>清空全部聊天记录</h2><p>所有联系人的聊天内容都会被删除，联系人本身会保留。此操作不可撤销。</p>';
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const cancel = button('取消', 'button button-quiet');
  const confirm = button('全部清空', 'button button-danger');
  cancel.addEventListener('click', () => backdrop.remove());
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      const result = await window.desktop.agent.conversationClearAll();
      await reloadConversations();
      if (state.currentConversation) await selectConversation(state.currentConversation.id);
      backdrop.remove();
      renderRoute();
      showMessage(`已清空 ${result?.cleared ?? state.conversations.length} 个联系人的聊天记录`);
    } catch (error) {
      confirm.disabled = false;
      showError(error.message);
    }
  });
  actions.append(cancel, confirm);
  modal.append(actions);
  backdrop.append(modal);
  document.body.append(backdrop);
}

function openClearConfirm(item) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal delete-confirm-modal';
  modal.innerHTML = `<h2>清空聊天记录</h2><p>确定清空“${escapeHtml(item.title || '新对话')}”的聊天记录吗？联系人本身、头像和人设会保留。</p>`;
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const cancel = button('取消', 'button button-quiet');
  const confirm = button('清空', 'button button-danger');
  cancel.addEventListener('click', () => backdrop.remove());
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      await window.desktop.agent.conversationClear(item.id);
      await reloadConversations();
      if (state.currentConversation?.id === item.id) await selectConversation(item.id);
      backdrop.remove();
      renderRoute();
      showMessage('聊天记录已清空');
    } catch (error) {
      confirm.disabled = false;
      showError(error.message);
    }
  });
  actions.append(cancel, confirm);
  modal.append(actions);
  backdrop.append(modal);
  document.body.append(backdrop);
}

function openDeleteConfirm(item) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal delete-confirm-modal';
  modal.innerHTML = `<h2>删除联系人</h2><p>确定删除“${escapeHtml(item.title || '新对话')}”吗？聊天记录也会被删除。</p>`;
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const cancel = button('取消', 'button button-quiet');
  const confirm = button('删除', 'button button-danger');
  cancel.addEventListener('click', () => backdrop.remove());
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      await window.desktop.agent.conversationDelete(item.id);
      await reloadConversations();
      if (state.currentConversation?.id === item.id) {
        if (state.conversations.length) {
          await selectConversation(state.conversations[0].id);
        } else {
          state.currentConversation = null;
          state.streamingText = '';
          state.agentBusy = false;
          rememberActiveConversation('');
        }
      }
      backdrop.remove();
      renderRoute();
      showMessage('联系人已删除');
    } catch (error) {
      confirm.disabled = false;
      showError(error.message);
    }
  });
  actions.append(cancel, confirm);
  modal.append(actions);
  backdrop.append(modal);
  document.body.append(backdrop);
}

// 读文件为 data URL，交给主进程落盘保存。
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(new Error('读取文件失败')));
    reader.readAsDataURL(file);
  });
}

function attachmentKindOf(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return 'file';
}

async function sendAttachment(file) {
  if (!state.currentConversation) {
    showError('请先选择一个联系人');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showError('文件超过 20MB，发不出去');
    return;
  }
  try {
    const dataUrl = await readFileAsDataUrl(file);
    await sendMessage('', {
      kind: attachmentKindOf(file),
      content: '',
      attachment: { name: file.name, mime: file.type || 'application/octet-stream', size: file.size, dataUrl },
    });
  } catch (error) {
    showError(error.message);
  }
}

// 录语音：录完先转写成文字，再作为语音消息发出去。
async function toggleRecording() {
  if (state.recordingPending) return;
  if (state.recording) {
    const recorder = state.recording;
    state.recordingPending = true;
    state.recording = null;
    recorder.stop();
    return;
  }
  if (!state.currentConversation) {
    showError('请先选择一个联系人');
    return;
  }
  const recordingConversationId = state.currentConversation.id;
  state.recordingPending = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    const startedAt = Date.now();
    recorder.addEventListener('dataavailable', event => {
      if (event.data?.size) chunks.push(event.data);
    });
    recorder.addEventListener('stop', async () => {
      stream.getTracks().forEach(track => track.stop());
      state.recording = null;
      state.recordingPending = true;
      renderConversation();
      try {
        if (!chunks.length) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const durationMs = Date.now() - startedAt;
        const dataUrl = await readFileAsDataUrl(blob);
        let text = '';
        // 转写失败不拦截发送，语音条照样留在记录里。
        try {
          const result = await window.desktop.agent.transcribe(dataUrl);
          text = result?.text || '';
        } catch (error) {
          showError(`语音转文字失败：${error.message}`);
        }
        if (state.currentConversation?.id !== recordingConversationId) throw new Error('联系人已切换，语音未发送');
        await sendMessage(text, {
          kind: 'voice',
          content: text,
          attachment: { name: '语音', mime: blob.type || 'audio/webm', size: blob.size, durationMs, dataUrl },
        });
      } catch (error) {
        showError(error.message);
      } finally {
        state.recordingPending = false;
        renderConversation();
      }
    });
    recorder.start();
    state.recording = recorder;
    state.recordingPending = false;
    renderConversation();
  } catch (_) {
    state.recordingPending = false;
    showError('打不开麦克风，请检查系统录音权限');
  }
}

async function sendMessage(text, message = null) {
  const value = String(text || '').trim();
  if (!value && !message) return;
  if (state.agentBusy) return;
  // 引用会作为一段前缀并进这条消息，和微信「引用并回复」的效果一致。
  const quote = state.quote;
  const quoted = quote && value
    ? `> ${quote.role === 'user' ? '我' : '对方'}：${quote.text.replace(/\n/g, ' ')}\n\n${value}`
    : value;
  try {
    if (!state.currentConversation) {
      const created = await window.desktop.agent.conversationNew('新对话');
      await reloadConversations();
      await selectConversation(created.id);
    }
    const conversationId = state.currentConversation.id;
    state.currentConversation = {
      ...state.currentConversation,
      messages: [
        ...(state.currentConversation.messages || []),
        message ? { ...message, role: 'user', id: `pending-${Date.now()}` } : { role: 'user', kind: 'text', content: quoted, id: `pending-${Date.now()}` },
      ],
    };
    state.agentBusy = true;
    state.streamingText = '';
    state.scrollToLatest = true;
    renderConversation();
    state.quote = null;
    const result = await window.desktop.agent.chatStart(conversationId, quoted, message || undefined);
    state.agentTicketId = result.ticketId;
    try {
      const saved = await window.desktop.agent.conversationLoad(conversationId);
      if (state.currentConversation?.id === conversationId) state.currentConversation = saved;
      await reloadConversations();
      if (location.hash.startsWith('#/conversation')) renderConversation();
    } catch (_) {
      // 刷新失败不影响当前这轮对话。
    }
  } catch (error) {
    state.agentBusy = false;
    showError(error.message);
    renderConversation();
  }
}

// 纯文字发送仍沿用这个入口，内部统一走 sendMessage。
async function startAgentChat(text) {
  return sendMessage(text);
}

async function handleAgentEvent(event) {
  if (!event || event.conversationId !== state.currentConversation?.id) return;
  if (event.ticketId && state.agentTicketId && event.ticketId !== state.agentTicketId) return;
  if (event.type === 'delta') {
    state.streamingText += event.delta || '';
    renderConversationMessages(true);
    return;
  }
  if (event.type !== 'done' && event.type !== 'error') return;
  state.agentBusy = false;
  state.agentTicketId = '';
  state.streamingText = '';
  if (event.type === 'error') showError(event.message || '对话请求失败');
  try {
    // 消息只以主进程落盘的记录为准，避免界面与文件不一致。
    const conversation = await window.desktop.agent.conversationLoad(event.conversationId);
    if (state.currentConversation?.id === conversation.id) state.currentConversation = conversation;
    await reloadConversations();
  } catch (error) {
    showError(error.message);
  }
  renderRoute();
}

async function loadAgentState() {
  const [toneData, memory, conversations] = await Promise.all([
    window.desktop.agent.tones(),
    window.desktop.agent.memoryGet(),
    window.desktop.agent.conversationList(),
  ]);
  state.tones = toneData.tones || [];
  state.activeToneId = toneData.activeToneId || state.tones[0]?.id || '';
  state.memoryBaseUrl = memory.memoryBaseUrl || '';
  state.memoryEnabled = memory.memoryEnabled === true;
  state.conversations = conversations || [];
  // 重启后回到上次打开的联系人，而不是永远落在列表第一个。
  const remembered = rememberedConversationId();
  const target = state.conversations.find(item => item.id === remembered) || state.conversations[0];
  if (target) {
    try {
      await selectConversation(target.id);
    } catch (_) {
      state.currentConversation = null;
    }
  } else {
    state.currentConversation = null;
    rememberActiveConversation('');
  }
  renderRoute();
}

function renderProviders() {
  content.replaceChildren();
  const heading = document.createElement('div');
  heading.className = 'page-heading';
  heading.innerHTML = '<div><h1>供应商</h1><p>管理模型、转文字和声音服务。密钥只保存在你的电脑上。</p></div>';
  const backToSettings = button('返回设置', 'button button-quiet');
  backToSettings.addEventListener('click', () => { location.hash = '#/settings'; });
  const add = button('添加供应商', 'button');
  add.addEventListener('click', () => openProviderForm());
  const quickConnect = button('快速连接', 'button button-quiet');
  quickConnect.addEventListener('click', openQuickConnectForm);
  const headingActions = document.createElement('div');
  headingActions.className = 'page-heading-actions';
  headingActions.append(backToSettings, add, quickConnect);
  heading.append(headingActions);
  content.append(heading);
  if (!state.onboardingDismissed && onboardingNeeded()) {
    renderOnboardingCard();
  }
  const groups = [
    ['llm', '大模型', '负责理解和生成回答'],
    ['stt', '转文字', '把你说的话变成文字'],
    ['tts', '声音', '把回答念出来'],
  ];
  groups.forEach(([kind, title, description]) => {
    const group = document.createElement('section');
    group.className = 'provider-group';
    group.dataset.kind = kind;
    const groupHeading = document.createElement('div');
    groupHeading.className = 'group-heading';
    groupHeading.innerHTML = `<h2>${title}</h2><span>${description}</span>`;
    group.append(groupHeading);
    const grid = document.createElement('div');
    grid.className = 'provider-grid';
    const visible = kind === 'llm' ? visibleLlmProviders() : state.providers.filter(provider => provider.kind === kind);
    visible.forEach(provider => grid.append(providerCard(provider)));
    if (!grid.children.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-card';
      empty.textContent = '还没有供应商，点击右上角添加一个。';
      grid.append(empty);
    }
    group.append(grid);
    content.append(group);
  });
  buildSectionWorkspace('providers');
}

function callServiceBlocked(shell) {
  if (window.earshotBridge?.isMock) return false;
  if (state.service.status === 'ready' && state.meta?.port) return false;
  const empty = document.createElement('div');
  empty.className = 'settings-card call-empty';
  const inner = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = state.service.status === 'failed' ? '服务没有启动' : '服务正在启动';
  const message = document.createElement('p');
  message.textContent = state.service.message || '请稍候…';
  inner.append(title, message);
  const restart = button('重新启动服务', 'button');
  restart.addEventListener('click', async () => {
    restart.disabled = true;
    try { await window.desktop.app.restartService(); } catch (error) { showError(error.message); }
    finally { restart.disabled = false; }
  });
  inner.append(restart);
  empty.append(inner);
  shell.append(empty);
  content.append(shell);
  return true;
}

function callTimeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (sameDay) return time;
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

// 通话页按 iOS 电话的做法分成最近通话、联系人、拨号键盘三个标签。
function renderCall() {
  const candidate = content.querySelector('.call-shell:not(.call-active)');
  const existingShell = candidate?.querySelector('.call-list-pane') && candidate?.querySelector('.call-preview') ? candidate : null;
  if (!existingShell) content.replaceChildren();
  content.classList.remove('chat-content');
  const shell = existingShell || document.createElement('div');
  shell.className = 'call-shell';
  const heading = document.createElement('div');
  heading.className = 'page-heading';
  heading.innerHTML = '<h1>通话</h1>';
  if (state.service.status !== 'ready' && !window.earshotBridge?.isMock) {
    content.replaceChildren(); shell.replaceChildren(heading);
    if (callServiceBlocked(shell)) return;
  }

  const tabs = document.createElement('div');
  tabs.className = 'call-tabs';
  [['recents', '通话记录'], ['contacts', '联系人'], ['keypad', '拨号键盘']].forEach(([id, label]) => {
    const tab = button(label, `call-tab${state.callTab === id ? ' active' : ''}`);
    tab.addEventListener('click', () => {
      state.callTab = id;
      renderCall();
    });
    tabs.append(tab);
  });

  const body = document.createElement('div');
  body.className = 'call-body';
  if (state.callTab === 'recents') renderCallRecents(body, shell);
  else if (state.callTab === 'keypad') renderCallKeypad(body, shell);
  else renderCallContacts(body, shell);
  const listPane=document.createElement('section');listPane.className='call-list-pane glass-surface';
  listPane.append(heading,tabs,body);
  if (existingShell) shell.querySelector('.call-list-pane')?.replaceWith(listPane);
  else { shell.append(listPane,mountCallPreview(shell)); content.append(shell); }
}

function renderCallRecents(body, shell) {
  const head = document.createElement('div');
  head.className = 'call-list-head';
  const title = document.createElement('strong');
  title.textContent = '最近通话';
  head.append(title);
  if (state.callLog.length) {
    const clear = button('清空', 'button button-quiet button-small');
    clear.addEventListener('click', async () => {
      if (!window.confirm('清空所有通话记录？删除后无法恢复，联系人会保留。')) return;
      try {
        await window.desktop.calls.clear();
        state.callLog = await window.desktop.calls.list();
        renderCall();
      } catch (error) {
        showError(error.message);
      }
    });
    head.append(clear);
  }
  body.append(head);
  if (!state.callLog.length) {
    const empty = document.createElement('div');
    empty.className = 'conversation-empty';
    empty.textContent = '还没有通话记录。去「联系人」里拨一个吧。';
    body.append(empty);
    return;
  }
  const list = document.createElement('div');
  list.className = 'call-log-list';
  state.callLog.forEach(item => {
    const row = document.createElement('div');
    row.className = 'call-log-row';
    row.append(avatarNode(item.avatar || state.avatars.ai, 'call-avatar-small'));
    const text = document.createElement('div');
    text.className = 'call-log-text';
    const name = document.createElement('strong');
    name.textContent = item.title || '未知联系人';
    if (item.missed) name.classList.add('missed');
    const meta = document.createElement('span');
    const parts = [item.direction === 'incoming' ? '来电' : '去电'];
    if (item.durationMs) parts.push(formatDuration(item.durationMs));
    parts.push(callTimeLabel(item.startedAt));
    meta.textContent = parts.join(' · ');
    text.append(name, meta);
    const dial = iconButton('再次呼叫', '<path d="M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z"/>', 'call-dial');
    dial.addEventListener('click', () => {
      const target = state.conversations.find(row2 => row2.id === item.conversationId);
      if (target) openCallView(shell, target);
      else showError('这个联系人已经删除了');
    });
    row.append(text, dial);
    list.append(row);
  });
  body.append(list);
}

function renderCallContacts(body, shell) {
  if (!state.conversations.length) {
    const empty = document.createElement('div');
    empty.className = 'settings-card call-empty';
    const inner = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = '还没有联系人';
    const message = document.createElement('p');
    message.textContent = '先在「聊天」里新建一个联系人，设置头像和号码后会出现在这里。';
    const go = button('去新建联系人', 'button');
    go.addEventListener('click', () => { location.hash = '#/conversation'; });
    inner.append(title, message, go);
    empty.append(inner);
    body.append(empty);
    return;
  }
  const contacts = document.createElement('div');
  contacts.className = 'call-contacts';
  state.conversations.forEach(item => {
    const contact = button('', 'call-contact');
    contact.append(avatarNode(conversationAvatar(item), 'call-avatar'));
    const info = document.createElement('div');
    info.className = 'call-contact-info';
    const name = document.createElement('strong');
    name.textContent = item.title || '新对话';
    const meta = document.createElement('span');
    const contactNumber = item.number || conversationSettings(item).number;
    meta.textContent = contactNumber ? formatNumber(contactNumber) : conversationModelName(item);
    info.append(name, meta);
    const dial = iconButton('呼叫', '<path d="M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z"/>', 'call-dial');
    contact.append(info, dial);
    contact.addEventListener('click', () => openCallView(shell, item));
    contacts.append(contact);
  });
  body.append(contacts);
}

// 拨号盘：号码区 → 键盘 → 操作区三段式。
// 数字用等宽（tabular-nums），号码不会随输入左右跳动。
function renderCallKeypad(body, shell) {
  const pad = document.createElement('div');
  pad.className = 'keypad';

  const matched = state.conversations.find(item => (item.number || conversationSettings(item).number) === state.dialNumber);

  // 号码区：有号码时显示大号数字，空态给一行提示，高度固定避免布局跳动
  const head = document.createElement('div');
  head.className = 'keypad-head';
  const display = document.createElement('div');
  display.className = `keypad-display${state.dialNumber ? '' : ' empty'}`;
  display.textContent = state.dialNumber ? formatNumber(state.dialNumber) : '输入号码';
  const hint = document.createElement('div');
  hint.className = `keypad-hint${matched ? ' matched' : ''}`;
  if (state.dialNumber) {
    hint.textContent = matched ? matched.title : '没有匹配的联系人';
  } else {
    hint.textContent = '拨号给已保存的联系人';
  }
  head.append(display, hint);
  pad.append(head);

  const grid = document.createElement('div');
  grid.className = 'keypad-grid';
  [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
    ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']].forEach(([digit, letters]) => {
    const key = button('', 'keypad-key');
    key.setAttribute('aria-label', letters ? `${digit} ${letters}` : digit);
    key.innerHTML = `<strong>${digit}</strong>${letters ? `<span>${letters}</span>` : ''}`;
    key.addEventListener('click', () => {
      if (!/\d/.test(digit)) return;
      state.dialNumber = `${state.dialNumber}${digit}`.slice(0, 12);
      renderCall();
    });
    grid.append(key);
  });
  pad.append(grid);

  // 操作区：拨号键居中，退格在右。没有号码时退格整体隐藏，不留灰按钮占位。
  const actions = document.createElement('div');
  actions.className = 'keypad-actions';
  const dial = button('', 'keypad-dial');
  dial.title = matched ? `呼叫 ${matched.title}` : '呼叫';
  dial.setAttribute('aria-label', dial.title);
  dial.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z"/></svg>';
  dial.disabled = !matched;
  dial.addEventListener('click', () => {
    if (matched) openCallView(shell, matched);
  });
  const back = button('', 'keypad-back');
  back.title = '删除';
  back.setAttribute('aria-label', '删除一位');
  back.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9L4 12z"/><path d="m13 10 4 4m0-4-4 4"/></svg>';
  back.hidden = !state.dialNumber;
  back.addEventListener('click', () => {
    state.dialNumber = state.dialNumber.slice(0, -1);
    renderCall();
  });
  // 左列留空保持拨号键真正居中
  const spacer = document.createElement('span');
  spacer.className = 'keypad-spacer';
  actions.append(spacer, dial, back);
  pad.append(actions);
  body.append(pad);
}

function openCallView(shell, item) {
  if (!state.meta?.port) return;
  const conversation = state.conversations.find(row => row.id === item.id) || item;
  const settings = conversationSettings(conversation);
  const provider = conversationModel(conversation);
  const profile = currentProfile();
  // 通话服务只认当前套餐的供应商；只有同一个供应商时才把会话模型名传过去，避免 base/key 不匹配。
  const sameProvider = provider && provider.id === profile?.llmId;
  const payload = {
    name: conversation.title || 'Earshot',
    number: settings.number || '',
    avatar: settings.avatar || state.avatars.ai || 'preset-1',
    model: sameProvider ? provider.model : '',
    style: settings.style || '',
    persona: settings.persona || '',
    tone: settings.tone || '',
    wave: state.chat.waveform !== false,
    background: state.callBackground || '',
    backdropHue: state.callBackdropHue ?? '',
    fluidCursor: state.fluidCursor !== false,
    backdropDensity: state.backdropDensity ?? '',
    backdropPattern: state.backdropPattern || '',
    backdropShape: state.backdropShape || '',
    fogColors: state.fogColors || '',
  };
  const startedAt = Date.now();
  shell.replaceChildren();
  shell.classList.add('call-active');
  const bar = document.createElement('div');
  bar.className = 'call-stage-bar';
  const label = document.createElement('div');
  label.className = 'call-stage-label';
  label.append(avatarNode(payload.avatar, 'call-avatar-small'));
  const text = document.createElement('span');
  text.textContent = `正在呼叫 ${payload.name}`;
  label.append(text);
  const back = button('挂断并返回', 'button button-danger');
  bar.append(label, back);
  const view = document.createElement('webview');
  view.id = 'call-view';
  view.setAttribute('partition', 'persist:earshot-call');
  view.src = `http://127.0.0.1:${state.meta.port}/`;
  const inject = () => {
    // 把联系人信息交给通话页：名字、号码、头像、模型、说话风格、波形与背景。
    const literal = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    view.executeJavaScript(`window.dispatchEvent(new CustomEvent('earshot:contact', { detail: ${literal} }))`).catch(() => {});
  };
  view.addEventListener('dom-ready', inject);
  view.addEventListener('did-finish-load', inject);
  back.addEventListener('click', async () => {
    view.executeJavaScript('window.earshotHangup && window.earshotHangup()').catch(() => {});
    // 挂断后写一条通话记录。
    try {
      await window.desktop.calls.add({
        conversationId: conversation.id,
        title: payload.name,
        number: payload.number,
        avatar: settings.avatar || '',
        direction: 'outgoing',
        durationMs: Date.now() - startedAt,
        startedAt: new Date(startedAt).toISOString(),
      });
      state.callLog = await window.desktop.calls.list();
    } catch (_) {
      // 记录失败不影响挂断。
    }
    state.callTab = 'recents';
    setTimeout(() => { renderCall(); }, 120);
  });
  shell.append(bar, view);
}

// 收藏页：聊天里收的一句话、一段语音，或一次收的几条。
function renderFavorites() {
  content.replaceChildren();
  const heading = document.createElement('div');
  heading.className = 'page-heading';
  heading.innerHTML = '<div><h1>收藏</h1></div>';
  if (state.favorites.length) {
    const clear = button('清空收藏', 'button button-danger');
    clear.addEventListener('click', async () => {
      if (!window.confirm('清空全部收藏？删除后无法恢复，聊天记录会保留。')) return;
      try {
        await window.desktop.favorites.clear();
        state.favorites = await window.desktop.favorites.list();
        renderFavorites();
        showMessage('收藏已清空');
      } catch (error) {
        showError(error.message);
      }
    });
    const actions = document.createElement('div');
    actions.className = 'page-heading-actions';
    actions.append(clear);
    heading.append(actions);
  }
  content.append(heading);

  const groups = [
    ['chat', '来自聊天'],
    ['call', '来自通话'],
  ];
  if (!state.favorites.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-card';
    empty.textContent = '还没有收藏。在聊天里右键一条消息就能收进来。';
    content.append(empty);
    buildSectionWorkspace('favorites');
    return;
  }
  groups.forEach(([source, title]) => {
    const items = state.favorites.filter(item => (item.source || 'chat') === source);
    const group = document.createElement('section');
    group.className = 'provider-group';
    const groupHeading = document.createElement('div');
    groupHeading.className = 'group-heading';
    groupHeading.innerHTML = `<h2>${title}</h2><span>${items.length} 条</span>`;
    group.append(groupHeading);
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'conversation-empty';
      empty.textContent = source === 'call' ? '通话里还没有收藏内容。' : '聊天里还没有收藏内容。';
      group.append(empty);
    }
    items.forEach(item => {
      const card = document.createElement('article');
      card.className = 'favorite-card';
      const head = document.createElement('div');
      head.className = 'favorite-head';
      const title2 = document.createElement('strong');
      title2.textContent = item.title || '未命名联系人';
      const time = document.createElement('span');
      time.textContent = callTimeLabel(item.createdAt);
      const remove = button('删除', 'button button-quiet button-small');
      remove.addEventListener('click', async () => {
        try {
          await window.desktop.favorites.remove(item.id);
          state.favorites = await window.desktop.favorites.list();
          renderFavorites();
        } catch (error) {
          showError(error.message);
        }
      });
      head.append(title2, time, remove);
      card.append(head);
      const list = document.createElement('div');
      list.className = 'favorite-messages';
      (item.messages || []).forEach(message => {
        const line = document.createElement('div');
        line.className = `favorite-line ${message.role === 'user' ? 'user' : 'assistant'}`;
        const who = document.createElement('span');
        who.className = 'favorite-who';
        who.textContent = message.role === 'user' ? '我' : '对方';
        line.append(who);
        if (!message.kind || message.kind === 'text') {
          const text = document.createElement('div');
          text.className = 'favorite-text';
          text.textContent = message.content;
          line.append(text);
        } else {
          line.append(attachmentBubble(message));
        }
        list.append(line);
      });
      card.append(list);
      group.append(card);
    });
    content.append(group);
  });
  buildSectionWorkspace('favorites');
}

// 色环：默认收起，点「自定义」展开。
// 弹层以触发按钮为 transform-origin（锚定到来源），消失也回到同一路径。
// 1:1 跟手（Pointer Events + setPointerCapture），松手即落定，不等 click。
function hueRing(current, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'hue-ring-field';
  const bar = document.createElement('div');
  bar.className = 'hue-ring-bar';
  // 收起态只显示当前色与一个入口
  const chip = document.createElement('span');
  chip.className = 'hue-chip';
  const readout = document.createElement('span');
  readout.className = 'hue-readout';
  const toggle = button('自定义', 'button button-quiet button-small');
  toggle.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div');
  panel.className = 'hue-panel';
  panel.hidden = true;

  const ring = document.createElement('div');
  ring.className = 'hue-ring';
  ring.setAttribute('role', 'slider');
  ring.setAttribute('aria-label', '色相');
  ring.setAttribute('aria-valuemin', '0');
  ring.setAttribute('aria-valuemax', '360');
  ring.tabIndex = 0;
  const knob = document.createElement('span');
  knob.className = 'hue-knob';
  ring.append(knob);

  let hue = current === '' || current === null || current === undefined ? null : Number(current);
  const paint = () => {
    const shown = hue === null ? 210 : hue;
    const angle = (shown - 90) * Math.PI / 180;
    knob.style.left = `${50 + Math.cos(angle) * 38}%`;
    knob.style.top = `${50 + Math.sin(angle) * 38}%`;
    knob.style.background = `hsl(${shown} 70% 55%)`;
    ring.setAttribute('aria-valuenow', String(shown));
    ring.setAttribute('aria-valuetext', hue === null ? '跟随主题' : `${shown} 度`);
    readout.textContent = hue === null ? '跟随主题' : `${shown}°`;
    chip.style.background = hue === null ? 'var(--panel-2)' : `hsl(${shown} 70% 55%)`;
    chip.textContent = hue === null ? '默认' : '';
  };
  paint();

  const hueAt = event => {
    const rect = ring.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    return Math.round((Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360);
  };
  let dragging = false;
  // 按下即反馈，不等 release；拖动过程中连续更新预览，松手才落盘。
  ring.addEventListener('pointerdown', event => {
    dragging = true;
    // 捕获失败不该影响取色（例如合成事件、无真实指针时）
    try { ring.setPointerCapture(event.pointerId); } catch (_) { /* 继续按坐标取色 */ }
    hue = hueAt(event);
    paint();
    onChange(hue, false);
  });
  ring.addEventListener('pointermove', event => {
    if (!dragging) return;
    hue = hueAt(event);
    paint();
    onChange(hue, false);
  });
  const finish = () => {
    if (!dragging) return;
    dragging = false;
    onChange(hue, true);
  };
  ring.addEventListener('pointerup', finish);
  ring.addEventListener('pointercancel', finish);
  // 键盘也能调色：方向键 ±1，Shift 加速
  ring.addEventListener('keydown', event => {
    const step = event.shiftKey ? 10 : 1;
    let next = hue === null ? 210 : hue;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += step;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= step;
    else return;
    event.preventDefault();
    hue = ((next % 360) + 360) % 360;
    paint();
    onChange(hue, true);
  });

  const reset = button('跟随主题', 'button button-quiet button-small');
  reset.addEventListener('click', () => { hue = null; paint(); onChange('', true); });
  panel.append(ring, reset);

  const setOpen = open => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? '收起' : '自定义';
    if (open) {
      panel.hidden = false;
      // 展开：从按钮一侧放大浮现，材质与位移一起动，读起来是"面板到场"
      void panel.offsetHeight;
      panel.classList.add('open');
      ring.focus({ preventScroll: true });
    } else {
      panel.classList.remove('open');
      // 收起沿同一路径退场，动画结束才移出布局
      setTimeout(() => { if (!panel.classList.contains('open')) panel.hidden = true; }, 220);
    }
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  // Esc 收起，焦点交还按钮，不把用户困在弹层里
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    setOpen(false);
    toggle.focus();
  });

  bar.append(chip, readout, toggle);
  wrap.append(bar, panel);
  return wrap;
}

// 主题强调色：用户色环只覆盖强调色档位，背景与文字档位保持主题原样，
// 这样对比度不会被自定义颜色破坏。
function applyThemeHue(hue) {
  const root = document.documentElement;
  if (hue === '' || hue === null || hue === undefined) {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--focus');
    root.style.removeProperty('--accent-text');
    return;
  }
  const h = ((Number(hue) % 360) + 360) % 360;
  const light = root.dataset.theme === 'mono-light';
  root.style.setProperty('--accent', `hsl(${h} ${light ? 68 : 62}% ${light ? 42 : 56}%)`);
  root.style.setProperty('--focus', `hsl(${h} ${light ? 72 : 66}% ${light ? 48 : 64}%)`);
  // 强调色上的文字按亮度选黑白，保证可读
  root.style.setProperty('--accent-text', light ? '#FFFFFF' : (h > 40 && h < 200 ? '#101418' : '#FFFFFF'));
}

// 应用背景图：铺在 body 底层，面板转为半透明材质（材质层次 = 层级）
function applyAppBackground(value) {
  const root = document.documentElement;
  if (!value) {
    document.body.style.backgroundImage = '';
    document.body.style.backgroundColor = '';
    root.classList.remove('has-app-background');
    return;
  }
  if (value.startsWith('data:image/')) {
    document.body.style.backgroundImage = `url("${value}")`;
    root.classList.add('has-app-background');
    return;
  }
  document.body.style.backgroundImage = '';
  document.body.style.backgroundColor = value;
  root.classList.add('has-app-background');
}

// 光雾配色：三组预设 + 三个取色器，落盘为逗号分隔的 #rrggbb
function fogColorPicker(current, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'fog-field';
  const presets = [
    ['', '场景默认'],
    ['#8040C1,#7FD3CF', '青紫'],
    ['#3D7FD6,#AFEEFF', '冰蓝'],
    ['#C8452D,#E0A458', '暖橙'],
    ['#203D27,#496F85', '深林'],
  ];
  const row = document.createElement('div');
  row.className = 'background-scenes';
  const parse = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
  let picked = parse(current);
  const apply = async value => {
    try {
      await onChange(value);
      picked = parse(value);
      paint();
      showMessage(value ? '光雾配色已更新' : '光雾恢复场景配色');
    } catch (error) {
      showError(error.message);
    }
  };
  presets.forEach(([value, name]) => {
    const chip = button(name, `scene-chip${(current || '') === value ? ' active' : ''}`);
    if (value) {
      const list = parse(value);
      chip.style.borderColor = list[0];
      chip.style.background = `linear-gradient(135deg, ${list.map(c => `${c}33`).join(', ')})`;
    }
    chip.addEventListener('click', () => apply(value));
    row.append(chip);
  });
  // 自选两色
  const customRow = document.createElement('div');
  customRow.className = 'fog-custom';
  const inputs = [];
  const paint = () => {
    inputs.forEach((input, i) => { input.value = picked[i] || (i === 0 ? '#8040C1' : '#7FD3CF'); });
  };
  for (let i = 0; i < 2; i++) {
    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'fog-swatch';
    input.setAttribute('aria-label', `光束颜色 ${i + 1}`);
    inputs.push(input);
  }
  paint();
  const useCustom = button('用这两色', 'button button-quiet button-small');
  useCustom.addEventListener('click', () => apply(inputs.map(n => n.value).join(',')));
  customRow.append(...inputs, useCustom);
  wrap.append(row, customRow);
  return wrap;
}

// 自绘图案：一块小画板，用户画出的笔迹会被点云采样成形状。
// 1:1 跟手（Pointer Events），按下即落笔，不等 click。
function patternPad(current, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'pattern-field';
  const bar = document.createElement('div');
  bar.className = 'pattern-bar';
  const thumb = document.createElement('span');
  thumb.className = 'pattern-thumb';
  const status = document.createElement('span');
  status.className = 'hue-readout';
  const toggle = button('绘制图案', 'button button-quiet button-small');
  toggle.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div');
  panel.className = 'pattern-panel';
  panel.hidden = true;

  const canvas = document.createElement('canvas');
  canvas.className = 'pattern-canvas';
  canvas.width = 256; canvas.height = 256;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '点云图案画板');
  const ctx = canvas.getContext('2d');
  const resetCanvas = () => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 256, 256);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#FFFFFF';
  };
  resetCanvas();
  const paintThumb = value => {
    if (value) {
      thumb.style.backgroundImage = `url("${value}")`;
      thumb.textContent = '';
      status.textContent = '已设置图案';
    } else {
      thumb.style.backgroundImage = '';
      thumb.textContent = '无';
      status.textContent = '点云自然起伏';
    }
  };
  paintThumb(current);
  // 已有图案时先铺回画板，便于继续改
  if (current) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, 256, 256);
    img.src = current;
  }

  let drawing = false;
  const at = event => {
    const r = canvas.getBoundingClientRect();
    return [(event.clientX - r.left) / r.width * 256, (event.clientY - r.top) / r.height * 256];
  };
  canvas.addEventListener('pointerdown', event => {
    drawing = true;
    try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* 合成事件无真实指针 */ }
    const [x, y] = at(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // 按下即留痕，不必等移动
    ctx.lineTo(x + 0.01, y);
    ctx.stroke();
  });
  canvas.addEventListener('pointermove', event => {
    if (!drawing) return;
    const [x, y] = at(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  });
  const stop = () => { drawing = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  const actions = document.createElement('div');
  actions.className = 'pattern-actions';
  const apply = button('用这个图案', 'button button-small');
  apply.addEventListener('click', async () => {
    const value = canvas.toDataURL('image/png');
    try {
      await onChange(value);
      paintThumb(value);
      showMessage('点云图案已更新');
    } catch (error) {
      showError(error.message);
    }
  });
  const clear = button('清空画板', 'button button-quiet button-small');
  clear.addEventListener('click', () => resetCanvas());
  const remove = button('不用图案', 'button button-quiet button-small');
  remove.addEventListener('click', async () => {
    try {
      await onChange('');
      resetCanvas();
      paintThumb('');
      showMessage('点云恢复自然起伏');
    } catch (error) {
      showError(error.message);
    }
  });
  actions.append(apply, clear, remove);
  // 导入图片作为图案：直接复用同一条采样链路，点云按图片明暗汇聚
  const importFile = document.createElement('input');
  importFile.type = 'file';
  importFile.accept = 'image/*';
  importFile.hidden = true;
  importFile.addEventListener('change', async () => {
    const picked = importFile.files?.[0];
    importFile.value = '';
    if (!picked) return;
    if (picked.size > 4 * 1024 * 1024) { showError('图片超过 4MB，请先压缩'); return; }
    try {
      const url = await readFileAsDataUrl(picked);
      // 画到画板上，用户还能在图片基础上继续涂改
      const bmp = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('图片无法解析'));
        im.src = url;
      });
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 256, 256);
      const s = Math.min(256 / bmp.width, 256 / bmp.height);
      const dw = bmp.width * s, dh = bmp.height * s;
      ctx.drawImage(bmp, (256 - dw) / 2, (256 - dh) / 2, dw, dh);
      ctx.strokeStyle = '#FFFFFF';
      const value = canvas.toDataURL('image/png');
      await onChange(value);
      paintThumb(value);
      showMessage('已用这张图片作为点云图案');
    } catch (error) {
      showError(error.message);
    }
  });
  const importBtn = button('导入图片…', 'button button-quiet button-small');
  importBtn.addEventListener('click', () => importFile.click());
  actions.append(importBtn, importFile);
  const tip = document.createElement('p');
  tip.className = 'settings-note';
  tip.textContent = '在黑底上画白色笔迹，或导入一张图片；点云会按明暗分布汇聚成该形状，并带上倒影。';
  panel.append(canvas, tip, actions);

  const setOpen = open => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? '收起' : '绘制图案';
    if (open) {
      panel.hidden = false;
      void panel.offsetHeight;
      panel.classList.add('open');
    } else {
      panel.classList.remove('open');
      setTimeout(() => { if (!panel.classList.contains('open')) panel.hidden = true; }, 220);
    }
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    setOpen(false);
    toggle.focus();
  });

  bar.append(thumb, status, toggle);
  wrap.append(bar, panel);
  return wrap;
}

// 密度滑杆：拖动即时预览，松手落盘
function densitySlider(current, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'density-field';
  const row = document.createElement('div');
  row.className = 'density-row';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0.2'; input.max = '2.2'; input.step = '0.1';
  input.value = String(current === '' || current === null || current === undefined ? 1 : current);
  input.setAttribute('aria-label', '粒子密度');
  const readout = document.createElement('span');
  readout.className = 'hue-readout';
  const paint = () => { readout.textContent = `${Number(input.value).toFixed(1)}×`; };
  paint();
  input.addEventListener('input', paint);
  input.addEventListener('change', () => onChange(Number(input.value)));
  const reset = button('标准', 'button button-quiet button-small');
  reset.addEventListener('click', () => { input.value = '1'; paint(); onChange(1); });
  row.append(input, readout, reset);
  wrap.append(row);
  return wrap;
}

// 背景选择：纯色预设 + 内置动效场景 + 自定义图片/视频/HTML，通话背景默认纯黑。
function backgroundPicker(label, current, onChange, options = {}) {
  const { scenes = false, media = false, html = false } = options;
  const wrap = document.createElement('div');
  wrap.className = 'background-field';
  const title = document.createElement('span');
  title.className = 'background-title';
  title.textContent = label;
  const row = document.createElement('div');
  row.className = 'background-row';
  const preview = document.createElement('span');
  preview.className = 'background-preview';
  const paint = value => {
    preview.style.backgroundImage = '';
    preview.style.background = '';
    preview.textContent = '';
    if (value && value.startsWith('data:image/')) {
      preview.style.backgroundImage = `url("${value}")`;
      preview.style.backgroundSize = 'cover';
      preview.style.backgroundPosition = 'center';
    } else if (value && value.startsWith('data:video/')) {
      preview.style.background = '#101418';
      preview.textContent = '视频';
    } else if (value && value.startsWith('html:')) {
      preview.style.background = '#101418';
      preview.textContent = 'HTML';
    } else if (value && value.startsWith('scene:')) {
      preview.style.background = 'linear-gradient(135deg,#203D27,#496F85 55%,#C478DB)';
      preview.textContent = '动效';
    } else {
      preview.style.background = value || 'var(--bg)';
      preview.textContent = value ? '' : '默认';
    }
  };
  paint(current);
  const apply = async value => {
    try {
      await onChange(value);
      paint(value);
      showMessage('背景已保存');
      renderRoute();
    } catch (error) {
      showError(error.message);
    }
  };
  const swatches = document.createElement('div');
  swatches.className = 'background-swatches';
  [['', '默认'], ['#000000', '纯黑'], ['#101418', '深灰'], ['#1B2430', '夜蓝'], ['#F3EFE7', '米白']].forEach(([value, name]) => {
    const swatch = button('', 'background-swatch');
    swatch.title = name;
    if (value) swatch.style.background = value;
    else swatch.textContent = '默认';
    swatch.addEventListener('click', () => apply(value));
    swatches.append(swatch);
  });
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = media ? 'image/*,video/*' : 'image/*';
  file.hidden = true;
  file.addEventListener('change', async () => {
    const picked = file.files?.[0];
    file.value = '';
    if (!picked) return;
    const isVideo = picked.type.startsWith('video/');
    const limit = isVideo ? 24 * 1024 * 1024 : 4 * 1024 * 1024;
    if (picked.size > limit) {
      showError(isVideo ? '背景视频超过 24MB，请先压缩' : '背景图片超过 4MB，请先压缩');
      return;
    }
    try {
      apply(await readFileAsDataUrl(picked));
    } catch (error) {
      showError(error.message);
    }
  });
  const upload = button(media ? '选图片 / 视频…' : '选图片…', 'button button-quiet button-small');
  upload.addEventListener('click', () => file.click());
  row.append(preview, swatches, upload, file);
  if (scenes) {
    const sceneRow = document.createElement('div');
    sceneRow.className = 'background-scenes';
    [['scene:spring-garden', '春日森林'], ['scene:particle-rain', '粒子雨'], ['scene:point-cloud', '点云倒影'], ['scene:aurora-fog', '体积光雾']].forEach(([value, name]) => {
      const chip = button(name, `scene-chip${current === value ? ' active' : ''}`);
      chip.addEventListener('click', () => apply(value));
      sceneRow.append(chip);
    });
    row.append(sceneRow);
  }
  if (html) {
    const htmlFile = document.createElement('input');
    htmlFile.type = 'file';
    htmlFile.accept = '.html,.htm,text/html';
    htmlFile.hidden = true;
    htmlFile.addEventListener('change', async () => {
      const picked = htmlFile.files?.[0];
      htmlFile.value = '';
      if (!picked) return;
      if (picked.size > 512 * 1024) {
        showError('自定义 HTML 背景超过 512KB，请精简');
        return;
      }
      try {
        apply('html:' + await picked.text());
      } catch (error) {
        showError(error.message);
      }
    });
    const htmlBtn = button('选 HTML…', 'button button-quiet button-small');
    htmlBtn.addEventListener('click', () => htmlFile.click());
    row.append(htmlBtn, htmlFile);
  }
  wrap.append(title, row);
  return wrap;
}

// 通话高级设置：原先浮在通话界面上的那些开关，挪到这里。
function openCallSettingsDialog() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = '<h2>通话高级设置</h2><p class="settings-note">这些选项作用于通话页面，保存后重新发起通话生效。</p>';
  const store = (key, fallback) => {
    try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; }
  };
  const tokenField = document.createElement('label');
  tokenField.className = 'editor-field';
  tokenField.innerHTML = '<span>访问令牌</span>';
  const token = document.createElement('input');
  token.type = 'password';
  token.placeholder = '仅当服务设置了 ACCESS_TOKEN 时填写';
  token.value = store('earshot:token', '');
  tokenField.append(token);
  const dictationRow = document.createElement('label');
  dictationRow.className = 'pref-row';
  const dictation = document.createElement('input');
  dictation.type = 'checkbox';
  dictation.checked = store('earshot:dictation', '') === '1';
  dictationRow.innerHTML = '<div><strong>使用浏览器自带听写</strong><p>Chrome / Edge 免费，中国大陆可能不可用</p></div>';
  dictationRow.append(dictation);
  const bargeRow = document.createElement('label');
  bargeRow.className = 'pref-row';
  const barge = document.createElement('input');
  barge.type = 'checkbox';
  barge.checked = store('earshot:barge', '') === '1';
  bargeRow.innerHTML = '<div><strong>说话时直接打断</strong><p>戴耳机效果最好；点波形线也可以打断</p></div>';
  bargeRow.append(barge);
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const cancel = button('取消', 'button button-quiet');
  cancel.addEventListener('click', () => backdrop.remove());
  const save = button('保存', 'button');
  save.addEventListener('click', () => {
    try {
      localStorage.setItem('earshot:token', token.value.trim());
      localStorage.setItem('earshot:dictation', dictation.checked ? '1' : '');
      localStorage.setItem('earshot:barge', barge.checked ? '1' : '');
      backdrop.remove();
      showMessage('通话设置已保存');
    } catch (_) {
      showError('保存失败，浏览器存储不可用');
    }
  });
  actions.append(cancel, save);
  modal.append(tokenField, dictationRow, bargeRow, actions);
  backdrop.append(modal);
  document.body.append(backdrop);
}

async function renderSettings() {
  const routeAtStart = location.hash;
  const settings = await window.desktop.app.settings.get();
  if (location.hash !== routeAtStart) return;
  const savedAvatar = settings.avatar || 'preset-1';
  const savedUserAvatar = settings.userAvatar || 'preset-4';
  state.avatars = { ai: savedAvatar, user: savedUserAvatar };
  state.chat = {
    waveform: settings.waveform !== false,
  };
  const prefRow = (labelText, hint, checked, onToggle) => {
    const row = document.createElement('div');
    row.className = 'pref-row';
    const text = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = labelText;
    text.className = 'pref-label';
    text.append(title);
    if (hint) text.append(info(hint));
    const toggle = document.createElement('label');
    toggle.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', labelText);
    input.checked = checked;
    const slider = document.createElement('span');
    slider.className = 'slider';
    toggle.append(input, slider);
    input.addEventListener('change', async () => {
      input.disabled = true;
      try {
        await onToggle(input.checked);
      } catch (error) {
        input.checked = !input.checked;
        showError(error.message);
      } finally {
        input.disabled = false;
      }
    });
    row.append(text, toggle);
    return row;
  };
  const info = (message) => {
    const node = document.createElement('span');
    node.className = 'setting-info';
    node.title = message;
    node.tabIndex = 0;
    node.setAttribute('role', 'note');
    node.setAttribute('aria-label', message);
    node.dataset.tooltip = message;
    node.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/></svg>';
    return node;
  };
  content.replaceChildren();
  const heading = document.createElement('div');
  heading.className = 'page-heading';
  heading.innerHTML = '<div><h1>设置</h1></div>';
  content.append(heading);
  const appearance = document.createElement('section');
  appearance.className = 'settings-card settings-section';
  appearance.innerHTML = '<h2>外观</h2>';
  const themeOptions = document.createElement('div');
  themeOptions.className = 'theme-options';
  [['deep-space', '深空'], ['mono-light', '浅色'], ['warm-night', '暖夜'], ['contrast', '高对比']].forEach(([theme, label]) => {
    const option = button('', 'theme-option');
    option.dataset.theme = theme;
    option.classList.toggle('selected', document.documentElement.dataset.theme === theme);
    option.innerHTML = `<span class="theme-swatch"></span><strong>${label}</strong>${option.classList.contains('selected') ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>' : ''}`;
    option.addEventListener('click', async () => {
      document.documentElement.dataset.theme = theme;
      applyThemeHue(state.themeHue);
      localStorage.setItem('earshot:theme', theme);
      await window.desktop.app.settings.save({ theme });
      renderSettings();
    });
    themeOptions.append(option);
  });
  appearance.append(themeOptions);
  // 主题强调色：色环自定义，覆盖所选主题的 --accent / --focus
  const themeHueField = document.createElement('div');
  themeHueField.className = 'background-field';
  const themeHueTitle = document.createElement('span');
  themeHueTitle.className = 'background-title';
  themeHueTitle.textContent = '主题强调色';
  const themeHueNote = document.createElement('p');
  themeHueNote.className = 'settings-note';
  themeHueNote.textContent = '拖动色环换一个强调色，留空则用主题自带的颜色。';
  let themeHueTimer = 0;
  themeHueField.append(themeHueTitle, themeHueNote, hueRing(state.themeHue, (hue, commit) => {
    state.themeHue = hue;
    applyThemeHue(hue);
    if (!commit) return;
    clearTimeout(themeHueTimer);
    themeHueTimer = setTimeout(() => {
      window.desktop.app.settings.save({ themeHue: hue }).catch(error => showError(error.message));
    }, 120);
  }));
  appearance.append(themeHueField);
  // 应用背景图：铺在整个窗口底层，面板自动转为半透明材质
  appearance.append(backgroundPicker('应用背景', state.appBackground, value => {
    state.appBackground = value;
    applyAppBackground(value);
    return window.desktop.app.settings.save({ appBackground: value });
  }));
  content.append(appearance);

  const avatarCard = document.createElement('section');
  avatarCard.className = 'settings-card settings-section';
  avatarCard.innerHTML = '<h2>头像</h2>';
  let pendingAi = savedAvatar;
  let pendingUser = savedUserAvatar;
  const avatarGrid = document.createElement('div');
  avatarGrid.className = 'avatar-duo';
  const avatarBlock = (title, initial, fallback, onChange) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'avatar-block';
    const label = document.createElement('div');
    label.className = 'avatar-block-title';
    label.textContent = title;
    wrapper.append(label, avatarPicker(initial, onChange, fallback));
    return wrapper;
  };
  avatarGrid.append(
    avatarBlock('AI 头像', pendingAi, 'preset-1', value => { pendingAi = value; }),
    avatarBlock('我的头像', pendingUser, 'preset-4', value => { pendingUser = value; }),
  );
  const avatarActions = document.createElement('div');
  avatarActions.className = 'settings-actions';
  const avatarSave = button('保存');
  const avatarReset = button('恢复默认', 'button button-quiet');
  avatarSave.addEventListener('click', async () => {
    await window.desktop.app.settings.save({ avatar: pendingAi, userAvatar: pendingUser });
    state.avatars = { ai: pendingAi, user: pendingUser };
    avatarSave.textContent = '已保存';
    setTimeout(() => { avatarSave.textContent = '保存'; }, 1200);
  });
  avatarReset.addEventListener('click', () => {
    pendingAi = 'preset-1';
    pendingUser = 'preset-4';
    renderSettings();
  });
  avatarActions.append(avatarSave, avatarReset);
  avatarCard.append(avatarGrid, avatarActions);
  content.append(avatarCard);

  const toneCard = document.createElement('section');
  toneCard.className = 'settings-card settings-section';
  toneCard.innerHTML = '<h2>语气</h2>';
  const toneHint = document.createElement('p');
  toneHint.className = 'settings-note';
  toneHint.textContent = '默认语气用于没有单独设置语气的联系人。';
  const toneInput = document.createElement('textarea');
  toneInput.rows = 5;
  toneInput.maxLength = 2000;
  toneInput.value = settings.toneText || '';
  toneInput.placeholder = '例如：自然、口语化，像熟人聊天一样回答。';
  toneInput.setAttribute('aria-label', '默认语气');
  const toneSave = button('保存');
  toneSave.addEventListener('click', async () => {
    try {
      await window.desktop.app.settings.save({ toneText: toneInput.value });
      toneSave.textContent = '已保存';
      setTimeout(() => { toneSave.textContent = '保存'; }, 1200);
    } catch (error) {
      showError(error.message);
    }
  });
  const toneActions = document.createElement('div');
  toneActions.className = 'settings-actions';
  toneActions.append(toneSave);
  toneCard.append(toneHint, toneInput, toneActions);
  content.append(toneCard);

  const callCard = document.createElement('section');
  callCard.className = 'settings-card settings-section';
  callCard.innerHTML = '<h2>通话与聊天</h2>';
  const callPrefs = document.createElement('div');
  callPrefs.className = 'pref-list';
  callPrefs.append(
    prefRow('通话中显示波形线', '关闭后通话页只保留状态与按钮', state.chat.waveform, async checked => {
      await window.desktop.app.settings.save({ waveform: checked });
      state.chat.waveform = checked;
    }),
    prefRow('AI 用语音回复', '开启后 AI 的回答会合成语音，聊天里以语音条显示', state.aiVoiceReply, async checked => {
      await window.desktop.app.settings.save({ aiVoiceReply: checked });
      state.aiVoiceReply = checked;
    }),
    prefRow('让 AI 看图片', '开启后发出的图片会一起交给模型，需要模型支持视觉输入（如 gpt-4o）；不支持时会提示换模型', state.visionEnabled, async checked => {
      await window.desktop.app.settings.save({ visionEnabled: checked });
      state.visionEnabled = checked;
    }),
  );
  callCard.append(callPrefs);
  // 通话里的访问令牌、听写与打断设置都收在这里，通话界面不再出现设置入口。
  const callNote = document.createElement('p');
  callNote.className = 'settings-note';
  callNote.textContent = '通话中的听写、打断与访问令牌设置已经收进这里，通话界面只保留通话本身。';
  const callAdvanced = document.createElement('div');
  callAdvanced.className = 'settings-actions';
  const openCallSettings = button('通话高级设置…', 'button button-quiet');
  openCallSettings.addEventListener('click', () => openCallSettingsDialog());
  callAdvanced.append(openCallSettings);
  callCard.append(callAdvanced);
  content.append(callCard);

  // 聊天背景与通话背景。
  const backgroundCard = document.createElement('section');
  backgroundCard.className = 'settings-card settings-section';
  backgroundCard.innerHTML = '<h2>背景</h2>';
  const backgroundNote = document.createElement('p');
  backgroundNote.className = 'settings-note';
  backgroundNote.textContent = '聊天背景支持纯色与图片。通话背景还可以用内置动效场景，或自己的图片、视频、HTML 页面。';
  backgroundCard.append(backgroundNote);
  backgroundCard.append(
    backgroundPicker('聊天背景', state.chatBackground, value => {
      state.chatBackground = value;
      return window.desktop.app.settings.save({ chatBackground: value });
    }),
    backgroundPicker('通话背景', state.callBackground, value => {
      state.callBackground = value;
      return window.desktop.app.settings.save({ callBackground: value });
    }, { scenes: true, media: true, html: true }),
  );
  // ── 动效场景的专属选项：只在选中对应风格时才出现 ──
  // 当前通话背景是不是内置动效场景、是哪一种，决定下面显示哪些控件。
  const activeScene = /^scene:/.test(state.callBackground || '') ? state.callBackground.slice(6) : '';
  const isCloud = activeScene === 'point-cloud' || activeScene === 'spring-garden';
  const isParticle = activeScene === 'particle-rain' || isCloud || activeScene === 'aurora-fog';

  if (activeScene) {
    // 动效配色（所有内置场景都适用）
    const hueField = document.createElement('div');
    hueField.className = 'background-field';
    const hueTitle = document.createElement('span');
    hueTitle.className = 'background-title';
    hueTitle.textContent = '动效配色';
    const hueNote = document.createElement('p');
    hueNote.className = 'settings-note';
    hueNote.textContent = '拖动色环给当前动效场景换一套同色系配色，留空则用场景自带配色。';
    let hueTimer = 0;
    hueField.append(hueTitle, hueNote, hueRing(state.callBackdropHue, (hue, commit) => {
      state.callBackdropHue = hue;
      if (!commit) return;
      clearTimeout(hueTimer);
      hueTimer = setTimeout(() => {
        window.desktop.app.settings.save({ callBackdropHue: hue }).catch(error => showError(error.message));
      }, 120);
    }));
    backgroundCard.append(hueField);
  }

  if (isParticle) {
    // 粒子密度：粒子雨与点云都按这个倍率
    const densityField = document.createElement('div');
    densityField.className = 'background-field';
    const densityTitle = document.createElement('span');
    densityTitle.className = 'background-title';
    densityTitle.textContent = '粒子密度';
    const densityNote = document.createElement('p');
    densityNote.className = 'settings-note';
    densityNote.textContent = '调整粒子的疏密，低端设备会在此基础上自动降档。';
    densityField.append(densityTitle, densityNote, densitySlider(state.backdropDensity, value => {
      state.backdropDensity = value;
      window.desktop.app.settings.save({ backdropDensity: value }).catch(error => showError(error.message));
    }));
    backgroundCard.append(densityField);
  }

  if (isCloud) {
    // 点云形态：内置树状 / 极光，或自定义图案
    const shapeField = document.createElement('div');
    shapeField.className = 'background-field';
    const shapeTitle = document.createElement('span');
    shapeTitle.className = 'background-title';
    shapeTitle.textContent = '点云形态';
    const shapeNote = document.createElement('p');
    shapeNote.className = 'settings-note';
    shapeNote.textContent = '让点云汇聚成指定形体；选了自定义图案时以图案为准。';
    const shapeRow = document.createElement('div');
    shapeRow.className = 'background-scenes';
    [['', '自然起伏'], ['tree', '树状'], ['aurora', '极光']].forEach(([value, name]) => {
      const chip = button(name, `scene-chip${(state.backdropShape || '') === value ? ' active' : ''}`);
      chip.addEventListener('click', async () => {
        try {
          await window.desktop.app.settings.save({ backdropShape: value });
          state.backdropShape = value;
          showMessage(value ? `点云已切换为${name}` : '点云恢复自然起伏');
          renderSettings();
        } catch (error) {
          showError(error.message);
        }
      });
      shapeRow.append(chip);
    });
    shapeField.append(shapeTitle, shapeNote, shapeRow);
    backgroundCard.append(shapeField);

    // 自定义图案：手绘或导入图片
    const patternField = document.createElement('div');
    patternField.className = 'background-field';
    const patternTitle = document.createElement('span');
    patternTitle.className = 'background-title';
    patternTitle.textContent = '自定义图案';
    patternField.append(patternTitle, patternPad(state.backdropPattern, async value => {
      state.backdropPattern = value;
      await window.desktop.app.settings.save({ backdropPattern: value });
    }));
    backgroundCard.append(patternField);
  }

  if (activeScene === 'aurora-fog') {
    // 体积光雾专属：光束配色自定义
    const fogField = document.createElement('div');
    fogField.className = 'background-field';
    const fogTitle = document.createElement('span');
    fogTitle.className = 'background-title';
    fogTitle.textContent = '光雾配色';
    const fogNote = document.createElement('p');
    fogNote.className = 'settings-note';
    fogNote.textContent = '挑一组光束颜色，或自己选色；留空用场景自带的青绿与粉紫。';
    fogField.append(fogTitle, fogNote, fogColorPicker(state.fogColors, async value => {
      state.fogColors = value;
      await window.desktop.app.settings.save({ fogColors: value });
    }));
    backgroundCard.append(fogField);
  }

  if (activeScene) {
    // 流体光标扰动开关
    backgroundCard.append(prefRow(
      '流体光标扰动',
      '鼠标掠过时把背景粒子柔和推开，停下后缓慢回流。',
      state.fluidCursor !== false,
      async next => {
        state.fluidCursor = next;
        await window.desktop.app.settings.save({ fluidCursor: next });
      },
    ));
  }
  content.append(backgroundCard);

  // 供应商并入设置，这里只留一个入口。
  const providerCardEntry = document.createElement('section');
  providerCardEntry.className = 'settings-card settings-section';
  providerCardEntry.innerHTML = '<h2>供应商</h2>';
  const providerNote = document.createElement('p');
  providerNote.className = 'settings-note';
  const missing = missingProfileProviders().length;
  providerNote.textContent = missing
    ? `还有 ${missing} 个供应商没有填写 Key，填好才能开始聊天。`
    : '模型、转文字和声音服务都已配置好。';
  const providerActions = document.createElement('div');
  providerActions.className = 'settings-actions';
  const openProviders = button('管理供应商…', 'button');
  openProviders.addEventListener('click', () => { location.hash = '#/providers'; });
  providerActions.append(openProviders);
  providerCardEntry.append(providerNote, providerActions);
  content.append(providerCardEntry);

  const contactCard = document.createElement('section');
  contactCard.className = 'settings-card settings-section';
  contactCard.innerHTML = '<h2>联系人</h2>';
  const contactNote = document.createElement('p');
  contactNote.className = 'settings-note';
  contactNote.textContent = '每个联系人可以有自己的头像、模型、人设、语气与号码。';
  const contactList = document.createElement('div');
  contactList.className = 'settings-contacts';
  if (!state.conversations.length) {
    const empty = document.createElement('div');
    empty.className = 'conversation-empty';
    empty.textContent = '还没有联系人，去「对话」页新建一个。';
    contactList.append(empty);
  }
  state.conversations.forEach(item => {
    const row = document.createElement('div');
    row.className = 'settings-contact-row';
    row.append(avatarNode(conversationAvatar(item), 'conversation-avatar'));
    const text = document.createElement('div');
    text.className = 'settings-contact-text';
    const name = document.createElement('strong');
    name.textContent = item.title || '新对话';
    const sub = document.createElement('span');
    const itemNumber = item.number || conversationSettings(item).number;
    const counter = item.messageCount ? `${item.messageCount} 条消息` : '暂无聊天记录';
    sub.textContent = `${itemNumber ? formatNumber(itemNumber) : conversationModelName(item)} · ${counter}`;
    text.append(name, sub);
    const rowActions = document.createElement('div');
    rowActions.className = 'settings-contact-actions';
    const edit = button('编辑', 'button button-quiet button-small');
    edit.addEventListener('click', () => openConversationEditor(item));
    const clear = button('清空记录', 'button button-quiet button-small');
    clear.disabled = !item.messageCount;
    clear.addEventListener('click', () => openClearConfirm(item));
    const remove = button('删除', 'button button-danger button-small');
    remove.addEventListener('click', () => openDeleteConfirm(item));
    rowActions.append(edit, clear, remove);
    row.append(text, rowActions);
    contactList.append(row);
  });
  contactCard.append(contactNote, contactList);

  const chatDataActions = document.createElement('div');
  chatDataActions.className = 'settings-actions';
  const clearAll = button('清空全部聊天记录', 'button button-danger');
  clearAll.disabled = !state.conversations.some(item => item.messageCount);
  clearAll.addEventListener('click', () => openClearAllConfirm());
  chatDataActions.append(clearAll);
  const chatDataNote = document.createElement('p');
  chatDataNote.className = 'settings-note';
  chatDataNote.textContent = '清空只会删除聊天内容，联系人、头像、人设与号码都会保留。';
  contactCard.append(chatDataNote, chatDataActions);
  content.append(contactCard);

  const storageCard = document.createElement('section');
  storageCard.className = 'settings-card settings-section';
  storageCard.innerHTML = '<h2>存储</h2>';
  [['配置文件路径', state.meta?.configPath || ''], ['日志目录', state.meta?.logPath || ''], ['当前端口', state.meta?.port || '未启动'], ['密钥存储方式', state.meta?.storage || '']].forEach(([label, value]) => storageCard.append(settingRow(label, value)));
  const dataRow = settingRow('数据目录', state.meta?.dataDir || '');
  const changeDataDir = button('更改…', 'button button-quiet button-small');
  changeDataDir.addEventListener('click', async () => {
    try {
      const result = await window.desktop.app.chooseDataDir();
      if (!result.canceled) showMessage('已迁移，重启应用后生效');
    } catch (error) {
      showError(error.message);
    }
  });
  dataRow.replaceChild(changeDataDir, dataRow.lastElementChild);
  storageCard.append(dataRow);
  const storageActions = document.createElement('div');
  storageActions.className = 'settings-actions';
  const config = button('打开配置目录', 'button button-quiet');
  config.addEventListener('click', () => window.desktop.app.openPath('config'));
  const logs = button('打开日志目录', 'button button-quiet');
  logs.addEventListener('click', () => window.desktop.app.openPath('logs'));
  const restart = button('重启服务', 'button');
  restart.title = '重启服务会中断当前通话';
  restart.addEventListener('click', async () => {
    if (!window.confirm('重启服务会中断当前通话，是否继续？')) return;
    restart.disabled = true;
    try { await window.desktop.app.restartService(); } catch (error) { showError(error.message); }
    finally { restart.disabled = false; }
  });
  storageActions.append(config, logs, restart);
  storageCard.append(storageActions, info('安装目录由安装程序选择；修改供应商或路径后，请重启服务使设置生效。'));
  content.append(storageCard);

  const memoryCard = document.createElement('section');
  memoryCard.className = 'settings-card settings-section settings-grid';
  const memoryTitle = document.createElement('h2');
  memoryTitle.textContent = '记忆';
  memoryCard.append(memoryTitle);
  const memoryRow = document.createElement('div');
  memoryRow.className = 'setting-row';
  const memoryLabel = document.createElement('div');
  memoryLabel.className = 'setting-label';
  memoryLabel.textContent = '启用记忆';
  const memoryInput = document.createElement('input');
  memoryInput.type = 'checkbox';
  memoryInput.setAttribute('aria-label', '启用记忆');
  memoryInput.checked = state.memoryEnabled;
  const memorySave = button('保存开关', 'button button-quiet button-small');
  memorySave.addEventListener('click', async () => {
    try {
      await window.desktop.agent.memorySet(memoryUrl.value, memoryInput.checked);
      state.memoryEnabled = memoryInput.checked;
      state.memoryBaseUrl = memoryUrl.value.trim();
      showMessage('记忆设置已保存。');
    } catch (error) {
      showError(error.message);
    }
  });
  memoryRow.append(memoryLabel, memoryInput, memorySave);
  memoryCard.append(memoryRow);
  const memoryUrlRow = document.createElement('div');
  memoryUrlRow.className = 'setting-row';
  const memoryUrlLabel = document.createElement('div');
  memoryUrlLabel.className = 'setting-label';
  memoryUrlLabel.textContent = '服务地址';
  const memoryUrl = document.createElement('input');
  memoryUrl.value = state.memoryBaseUrl;
  memoryUrl.placeholder = '例如 http://127.0.0.1:8765';
  memoryUrl.setAttribute('aria-label', '记忆服务地址');
  const testMemory = button('测试连接', 'button button-quiet button-small');
  const testResult = document.createElement('div');
  testResult.className = 'memory-test-result';
  testMemory.addEventListener('click', async () => {
    testMemory.disabled = true;
    testResult.textContent = '测试中…';
    try {
      const result = await window.desktop.agent.memoryTest(memoryUrl.value);
      testResult.textContent = result.message;
      testResult.className = `memory-test-result ${result.ok ? 'ok' : 'fail'}`;
    } catch (error) {
      testResult.textContent = error.message;
      testResult.className = 'memory-test-result fail';
    } finally {
      testMemory.disabled = false;
    }
  });
  memoryUrlRow.append(memoryUrlLabel, memoryUrl, testMemory);
  memoryCard.append(memoryUrlRow, testResult);
  memoryCard.append(info('关闭时不会请求记忆服务。开启后，每轮对话前召回相关内容，结束后保存本轮摘要；记忆服务默认使用本机 8765 端口。'));
  content.append(memoryCard);

  const about = document.createElement('section');
  about.className = 'settings-card settings-section about-settings';
  about.innerHTML = `<h2>关于</h2><div class="about-row"><span>版本</span><strong>${state.meta?.version || ''}</strong></div><div class="about-row"><span>GitHub 仓库</span><a href="https://github.com/wushuozhou/ear-shot">打开链接</a></div><div class="about-row"><span>许可证</span><a href="https://github.com/wushuozhou/ear-shot/blob/main/LICENSE">查看许可证</a></div>`;
  about.querySelectorAll('a[href]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      window.desktop.app.openExternal(link.href).catch(error => showError(error.message));
    });
  });
  content.append(about);
  const explanations = new Map();
  content.querySelectorAll('.settings-note').forEach(note => {
    if (note === chatDataNote) return;
    const title = note.parentElement.querySelector(':scope > .background-title, :scope > h2') || note.closest('.settings-section')?.querySelector('h2');
    if (!title) return;
    explanations.set(title, [explanations.get(title), note.textContent].filter(Boolean).join('\n'));
    note.remove();
  });
  explanations.forEach((message, title) => title.append(info(message)));
  buildSectionWorkspace('settings');
}

function settingRow(label, value) {
  const row = document.createElement('div');
  row.className = 'setting-row';
  const title = document.createElement('div');
  title.className = 'setting-label';
  title.textContent = label;
  const text = document.createElement('div');
  text.className = 'setting-value';
  text.title = value;
  text.textContent = value;
  row.append(title, text, document.createElement('span'));
  return row;
}

function showError(message) {
  const notice = $('#notice');
  notice.textContent = message;
  notice.classList.remove('notice-success');
  notice.classList.remove('hidden');
  setTimeout(() => {
    if (state.service.status !== 'failed') notice.classList.add('hidden');
  }, 4000);
}

function showMessage(message) {
  const notice = $('#notice');
  notice.textContent = message;
  notice.classList.remove('hidden');
  notice.classList.add('notice-success');
  setTimeout(() => {
    notice.classList.add('hidden');
    notice.classList.remove('notice-success');
  }, 3000);
}

function field(label, name, value, type = 'text', full = false) {
  const wrapper = document.createElement('div');
  wrapper.className = `form-field${full ? ' full' : ''}`;
  const title = document.createElement('label');
  title.textContent = label;
  title.htmlFor = `provider-${name}`;
  const input = document.createElement('input');
  input.id = title.htmlFor;
  input.name = name;
  input.type = type;
  input.value = value || '';
  wrapper.append(title, input);
  const error = document.createElement('div');
  error.className = 'field-error';
  wrapper.append(error);
  return wrapper;
}

function openProviderForm(existing) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  const title = document.createElement('h2');
  title.textContent = existing ? '编辑供应商' : '添加供应商';
  modal.append(title);
  const form = document.createElement('form');
  const grid = document.createElement('div');
  grid.className = 'form-grid';
  const name = field('名称', 'name', existing?.name);
  const kind = field('类型', 'kind', '');
  kind.querySelector('input').remove();
  const kindSelect = document.createElement('select');
  kindSelect.name = 'kind';
  [['llm', '大模型（LLM）'], ['stt', '转文字（STT）'], ['tts', '声音（TTS）']].forEach(([value, text]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    option.selected = value === existing?.kind;
    kindSelect.append(option);
  });
  kind.querySelector('label').after(kindSelect);
  const protocol = field('协议', 'protocol', '');
  protocol.querySelector('input').remove();
  const protocolSelect = document.createElement('select');
  protocolSelect.name = 'protocol';
  [['openai-compatible', 'OpenAI 兼容'], ['elevenlabs', 'ElevenLabs'], ['custom', '自定义协议']].forEach(([value, text]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    option.selected = value === (existing?.protocol || 'openai-compatible');
    protocolSelect.append(option);
  });
  protocol.querySelector('label').after(protocolSelect);
  const baseUrl = field('Base URL', 'baseUrl', existing?.baseUrl, 'url', true);
  const model = field('模型名称', 'model', existing?.model);
  const voice = field('语音名称（TTS 可填）', 'voice', existing?.voice);
  const apiKey = field('API Key（留空表示不修改）', 'apiKey', '', 'password', true);
  grid.append(name, kind, baseUrl, protocol, model, voice, apiKey);
  modal.append(grid);
  const headersField = document.createElement('div');
  headersField.className = 'form-field full';
  const headersLabel = document.createElement('label');
  headersLabel.textContent = '额外请求头（可选）';
  headersField.append(headersLabel);
  const headerRows = document.createElement('div');
  const addHeaderRow = (key = '', value = '') => {
    const row = document.createElement('div');
    row.className = 'headers-row';
    const keyInput = document.createElement('input');
    keyInput.placeholder = '请求头名称';
    keyInput.value = key;
    const valueInput = document.createElement('input');
    valueInput.placeholder = '请求头值';
    valueInput.value = value;
    const remove = button('删除', 'button button-danger button-small');
    remove.addEventListener('click', () => row.remove());
    row.append(keyInput, valueInput, remove);
    headerRows.append(row);
  };
  Object.entries(existing?.extraHeaders || {}).forEach(([key, value]) => addHeaderRow(key, value));
  const addHeader = button('添加请求头', 'button button-quiet button-small');
  addHeader.addEventListener('click', () => addHeaderRow());
  headersField.append(headerRows, addHeader);
  modal.append(headersField);
  const timeout = field('超时时间（毫秒）', 'timeoutMs', existing?.timeoutMs || 8000, 'number', false);
  modal.append(timeout);
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const cancel = button('取消', 'button button-quiet');
  cancel.addEventListener('click', () => backdrop.remove());
  const save = button('保存', 'button');
  save.type = 'submit';
  actions.append(cancel, save);
  modal.append(actions);
  form.append(grid, headersField, timeout, actions);
  modal.replaceChildren(title, form);
  backdrop.append(modal);
  document.body.append(backdrop);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    document.querySelectorAll('.field-error').forEach(item => { item.textContent = ''; });
    const values = Object.fromEntries(new FormData(form).entries());
    let valid = true;
    const errorFor = (nameValue, message) => {
      const target = form.querySelector(`[name="${nameValue}"]`)?.parentElement?.querySelector('.field-error');
      if (target) target.textContent = message;
      valid = false;
    };
    if (!String(values.name).trim()) errorFor('name', '请填写名称');
    if (!['llm', 'stt', 'tts'].includes(values.kind)) errorFor('kind', '请选择类型');
    if (!/^https?:\/\//i.test(String(values.baseUrl).trim())) errorFor('baseUrl', 'Base URL 必须以 http:// 或 https:// 开头');
    if (!Number(values.timeoutMs) || Number(values.timeoutMs) < 100) errorFor('timeoutMs', '超时时间至少为 100 毫秒');
    if (!valid) return;
    const extraHeaders = {};
    headerRows.querySelectorAll('.headers-row').forEach(row => {
      const inputs = row.querySelectorAll('input');
      if (inputs[0].value.trim()) extraHeaders[inputs[0].value.trim()] = inputs[1].value;
    });
    const value = {
      ...(existing || { id: `custom-${values.kind}-${Date.now()}`, builtin: false, enabled: true }),
      name: String(values.name).trim(),
      kind: values.kind,
      protocol: values.protocol,
      baseUrl: String(values.baseUrl).trim(),
      model: String(values.model).trim(),
      voice: String(values.voice).trim(),
      timeoutMs: Number(values.timeoutMs),
      extraHeaders,
    };
    if (String(values.apiKey).trim()) value.apiKey = String(values.apiKey).trim();
    if (value.apiKey) state.testedProviders.delete(value.id);
    save.disabled = true;
    try {
      await window.desktop.providers.save(value);
      backdrop.remove();
      await refresh();
    } catch (error) {
      showError(error.message);
      save.disabled = false;
    }
  });
}

async function refresh() {
  const [providerData, meta, service] = await Promise.all([
    window.desktop.providers.list(),
    window.desktop.app.getMeta(),
    window.desktop.getStatus(),
  ]);
  state.providers = providerData.providers || [];
  state.profiles = providerData.profiles || [];
  state.activeProfileId = providerData.activeProfileId || '';
  state.onboardingDismissed = providerData.onboardingDismissed === true;
  state.meta = meta;
  state.service = service;
  renderTop();
  renderRoute();
}

function renderRoute() {
  const route = location.hash || '#/home';
  const pathName = route.split('?')[0].replace(/^#/, '') || '/home';
  if ((state.recording || state.recordingPending) && pathName !== '/conversation') {
    location.hash = '#/conversation';
    showError('请等待语音发送完成再离开聊天');
    return;
  }
  disposeFeatureHub();
  disposeWorkspace();
  closeMessageMenu();
  document.body.classList.toggle('hub-route', pathName === '/home');
  window.desktop.app.setWindowSurface?.(pathName === '/home' ? 'hub' : document.documentElement.dataset.theme)?.catch(() => {});
  content.classList.toggle('chat-content', pathName === '/conversation');
  // 供应商已并入设置，侧边只保留聊天 / 通话 / 收藏 / 设置。
  setActiveNav(pathName === '/providers' ? '/settings' : pathName);
  if (pathName === '/home') renderFeatureHub();
  else if (pathName === '/conversation') renderConversation();
  else if (pathName === '/call') renderCall();
  else if (pathName === '/favorites') renderFavorites();
  else if (pathName === '/providers') renderProviders();
  else renderSettings();
}

// 外观以主进程配置为准（默认浅色），避免旧版 localStorage 里的深色值覆盖默认值。
document.documentElement.dataset.theme = 'deep-space';

// 侧边栏收起/展开，状态记在本地，下次打开保持。
const SIDEBAR_KEY = 'earshot:sidebar-collapsed';
function applySidebarCollapsed(collapsed) {
  const shell = document.querySelector('.shell');
  const toggle = $('#sidebar-toggle');
  if (shell) shell.classList.toggle('sidebar-collapsed', collapsed);
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.title = collapsed ? '展开侧边栏' : '收起侧边栏';
    toggle.setAttribute('aria-label', toggle.title);
  }
  try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : ''); } catch (_) { /* 存不下不影响使用 */ }
}

(() => {
  let collapsed = false;
  try { collapsed = localStorage.getItem(SIDEBAR_KEY) === '1'; } catch (_) { collapsed = false; }
  applySidebarCollapsed(collapsed);
  $('#sidebar-toggle')?.addEventListener('click', () => {
    applySidebarCollapsed(!document.querySelector('.shell')?.classList.contains('sidebar-collapsed'));
  });
})();

$('#open-logs')?.addEventListener('click', () => window.desktop.app.openPath('logs'));
window.addEventListener('hashchange', renderRoute);
window.addEventListener('resize', () => {
  const active = $('.nav a.active');
  if (active) setActiveNav(active.dataset.route);
});
window.desktop.agent.onEvent(handleAgentEvent);
window.desktop.onState(async service => {
  state.service = service;
  renderTop();
  if (location.hash === '#/call') renderRoute();
  try { state.meta = await window.desktop.app.getMeta(); } catch (_) { /* keep last status */ }
});

async function bootstrapUi() {
  try {
    const settings = await window.desktop.app.settings.get();
    if (PHONE_THEME.includes(settings?.theme)) {
      document.documentElement.dataset.theme = settings.theme;
    }
    state.avatars = {
      ai: settings?.avatar || 'preset-1',
      user: settings?.userAvatar || 'preset-4',
    };
    state.chat = {
      waveform: settings?.waveform !== false,
    };
    state.aiVoiceReply = settings?.aiVoiceReply === true;
    state.visionEnabled = settings?.visionEnabled === true;
    state.chatBackground = settings?.chatBackground || '';
    state.callBackground = settings?.callBackground || '';
    state.callBackdropHue = settings?.callBackdropHue ?? '';
    state.fluidCursor = settings?.fluidCursor !== false;
    state.backdropDensity = settings?.backdropDensity ?? '';
    state.backdropPattern = settings?.backdropPattern || '';
    state.backdropShape = settings?.backdropShape || '';
    state.fogColors = settings?.fogColors || '';
    state.themeHue = settings?.themeHue ?? '';
    state.appBackground = settings?.appBackground || '';
    applyThemeHue(state.themeHue);
    applyAppBackground(state.appBackground);
    if (settings?.toneId) state.activeToneId = settings.toneId;
  } catch (_) {
    // 设置读不到时用默认值继续渲染。
  }
  // 收藏和通话记录读不到也不拦截启动。
  try {
    const [favorites, callLog] = await Promise.all([
      window.desktop.favorites.list(),
      window.desktop.calls.list(),
    ]);
    state.favorites = favorites || [];
    state.callLog = callLog || [];
  } catch (_) {
    state.favorites = [];
    state.callLog = [];
  }
  await refresh();
  await loadAgentState();
}

bootstrapUi().catch(error => showError(`无法读取桌面状态：${error.message}`));
