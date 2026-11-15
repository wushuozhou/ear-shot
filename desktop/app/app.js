const state = {
  providers: [],
  profiles: [],
  activeProfileId: '',
  onboardingDismissed: false,
  testedProviders: new Set(),
  initialRouteHandled: false,
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
  aiVoiceReply: false,
  chatBackground: '',
  callBackground: '',
  favorites: [],
  callLog: [],
  callTab: 'recents',
  dialNumber: '',
};

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
  const conversation = await window.desktop.agent.conversationLoad(id);
  state.currentConversation = conversation;
  state.agentBusy = false;
  state.agentTicketId = '';
  state.streamingText = '';
  state.draft = '';
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
  document.querySelectorAll('.nav a').forEach(link => link.classList.toggle('active', link.dataset.route === route));
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

function renderConversationMessages() {
  const stream = $('#message-stream');
  if (!stream) return;
  stream.replaceChildren();
  const messages = state.currentConversation?.messages || [];
  if (onboardingNeeded()) {
    const empty = document.createElement('div');
    empty.className = 'message-empty';
    empty.innerHTML = '<div><strong>先完成首次设置</strong>请先到「设置 → 供应商」选择套餐、填写 Key 并测试连接，完成后就可以开始聊天。</div>';
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
      bubble.innerHTML = renderMarkdown(stripStageDirections(message.content));
    } else {
      bubble.append(attachmentBubble(message));
    }
    const avatar = avatarNode(role === 'user' ? state.avatars.user : assistantAvatar, 'message-avatar');
    if (role === 'user') row.append(bubble, avatar);
    else row.append(avatar, bubble);
    // 多选模式下，整行可勾选用来批量收藏。
    if (state.selectMode && !streaming && message.id) {
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
    } else if (!streaming && message.id) {
      // 右键单条收藏，和微信的长按菜单对应。
      row.addEventListener('contextmenu', event => {
        event.preventDefault();
        favoriteMessages([message]);
      });
    }
    return row;
  };
  if (!messages.length && !state.streamingText) {
    const empty = document.createElement('div');
    empty.className = 'message-empty';
    empty.innerHTML = state.currentConversation
      ? '<div><strong>先聊点什么吧</strong>这个联系人还没有聊天记录，在下面输入第一句话。</div>'
      : '<div><strong>还没有联系人</strong>点击左侧「新建」创建一个联系人后开始聊天。</div>';
    stream.append(empty);
  } else {
    messages.forEach(message => stream.append(rowFor(message)));
    if (state.streamingText) stream.append(rowFor({ role: 'assistant', kind: 'text', content: state.streamingText }, true));
  }
  stream.scrollTop = stream.scrollHeight;
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
    state.selectMode = false;
    state.selected.clear();
    renderConversation();
    showMessage(list.length > 1 ? `已收藏 ${list.length} 条` : '已收藏');
  } catch (error) {
    showError(error.message);
  }
}

function renderConversation() {
  content.replaceChildren();
  const layout = document.createElement('div');
  layout.className = 'conversation-layout';
  const list = document.createElement('aside');
  list.className = 'conversation-list';
  const listHead = document.createElement('div');
  listHead.className = 'conversation-list-head';
  const listTitle = document.createElement('strong');
  listTitle.textContent = '联系人';
  const newConversation = button('新建', 'button button-quiet button-small');
  newConversation.addEventListener('click', async () => {
    try {
      const created = await window.desktop.agent.conversationNew('新对话');
      await reloadConversations();
      await selectConversation(created.id);
      renderConversation();
      openConversationEditor(state.currentConversation);
    } catch (error) {
      showError(error.message);
    }
  });
  listHead.append(listTitle, newConversation);
  list.append(listHead);
  const items = document.createElement('div');
  items.className = 'conversation-items';
  if (!state.conversations.length) {
    const empty = document.createElement('div');
    empty.className = 'conversation-empty';
    empty.textContent = '还没有联系人。点击“新建”设置名字、头像和号码。';
    items.append(empty);
  }
  state.conversations.forEach(item => {
    const itemRow = document.createElement('div');
    itemRow.className = 'conversation-item-row';
    const active = item.id === state.currentConversation?.id;
    const row = button('', `conversation-item${active ? ' active' : ''}`);
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
    body.append(name, sub);
    row.append(body);
    row.addEventListener('click', async () => {
      if (itemRow.classList.contains('expanded')) {
        itemRow.classList.remove('expanded');
        return;
      }
      if (item.id === state.currentConversation?.id) return;
      try {
        await selectConversation(item.id);
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
    items.append(itemRow);
  });
  list.append(items);

  const main = document.createElement('section');
  main.className = 'conversation-main';
  const toolbar = document.createElement('div');
  toolbar.className = 'conversation-toolbar';
  const identity = document.createElement('div');
  identity.className = 'conversation-identity';
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
      const pick = button('多选收藏', 'button button-quiet button-small');
      pick.disabled = !(state.currentConversation.messages || []).length;
      pick.addEventListener('click', () => {
        state.selectMode = true;
        state.selected.clear();
        renderConversation();
      });
      const edit = button('联系人设置', 'button button-quiet button-small');
      edit.addEventListener('click', () => openConversationEditor(state.currentConversation));
      const clearCurrent = button('清空记录', 'button button-quiet button-small');
      clearCurrent.disabled = !(state.currentConversation.messages || []).length;
      clearCurrent.addEventListener('click', () => openClearConfirm(state.currentConversation));
      tools.append(pick, edit, clearCurrent);
    }
  }
  toolbar.append(identity, tools);
  main.append(toolbar);
  const stream = document.createElement('div');
  stream.id = 'message-stream';
  stream.className = 'message-stream';
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
  const disabled = state.agentBusy || onboardingNeeded() || !state.currentConversation;

  // 左侧工具：语音、图片/视频、文件，以及 AI 语音回复开关。
  const actionsBar = document.createElement('div');
  actionsBar.className = 'compose-actions';
  const micButton = button('', `compose-icon${state.recording ? ' recording' : ''}`);
  micButton.title = state.recording ? '松开结束，点击发送语音' : '按住或点击录语音';
  micButton.disabled = disabled;
  micButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  micButton.addEventListener('click', () => toggleRecording());
  const mediaInput = document.createElement('input');
  mediaInput.type = 'file';
  mediaInput.accept = 'image/*,video/*';
  mediaInput.hidden = true;
  mediaInput.addEventListener('change', () => {
    const file = mediaInput.files?.[0];
    mediaInput.value = '';
    if (file) sendAttachment(file);
  });
  const mediaButton = button('', 'compose-icon');
  mediaButton.title = '发送图片或视频';
  mediaButton.disabled = disabled;
  mediaButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m5 17 5-5 4 4 2-2 3 3"/></svg>';
  mediaButton.addEventListener('click', () => mediaInput.click());
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
  fileButton.disabled = disabled;
  fileButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 3v5h5"/><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z"/></svg>';
  fileButton.addEventListener('click', () => fileInput.click());
  const voiceToggle = document.createElement('label');
  voiceToggle.className = `compose-voice-toggle${state.aiVoiceReply ? ' on' : ''}`;
  voiceToggle.title = 'AI 用语音回复';
  const voiceCheck = document.createElement('input');
  voiceCheck.type = 'checkbox';
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
  voiceLabel.textContent = 'AI 语音';
  voiceToggle.append(voiceCheck, voiceLabel);
  actionsBar.append(micButton, mediaButton, fileButton, mediaInput, fileInput, voiceToggle);
  if (state.recording) {
    const tip = document.createElement('span');
    tip.className = 'recording-tip';
    tip.textContent = '正在录音，再点一次麦克风结束并发送';
    actionsBar.append(tip);
  }

  const inputRow = document.createElement('div');
  inputRow.className = 'compose-row';
  const input = document.createElement('textarea');
  input.disabled = disabled;
  input.placeholder = state.currentConversation ? '说点什么，Enter 发送，Shift+Enter 换行' : '先在左侧选一个联系人';
  input.value = state.draft || '';
  input.addEventListener('input', () => { state.draft = input.value; });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  const send = button('发送', 'button');
  send.type = 'submit';
  send.disabled = disabled;
  inputRow.append(input, send);
  form.append(actionsBar, inputRow);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const value = input.value;
    input.value = '';
    state.draft = '';
    startAgentChat(value);
  });
  main.append(form);
  layout.append(list, main);
  content.append(layout);
  renderConversationMessages();
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
  if (state.recording) {
    const recorder = state.recording;
    state.recording = null;
    recorder.stop();
    return;
  }
  if (!state.currentConversation) {
    showError('请先选择一个联系人');
    return;
  }
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
      renderConversation();
      if (!chunks.length) return;
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      const durationMs = Date.now() - startedAt;
      try {
        const dataUrl = await readFileAsDataUrl(blob);
        let text = '';
        // 转写失败不拦截发送，语音条照样留在记录里。
        try {
          const result = await window.desktop.agent.transcribe(dataUrl);
          text = result?.text || '';
        } catch (error) {
          showError(`语音转文字失败：${error.message}`);
        }
        await sendMessage(text, {
          kind: 'voice',
          content: text,
          attachment: { name: '语音', mime: blob.type || 'audio/webm', size: blob.size, durationMs, dataUrl },
        });
      } catch (error) {
        showError(error.message);
      }
    });
    recorder.start();
    state.recording = recorder;
    renderConversation();
  } catch (_) {
    showError('打不开麦克风，请检查系统录音权限');
  }
}

async function sendMessage(text, message = null) {
  const value = String(text || '').trim();
  if (!value && !message) return;
  if (state.agentBusy) return;
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
        message ? { ...message, role: 'user', id: `pending-${Date.now()}` } : { role: 'user', kind: 'text', content: value, id: `pending-${Date.now()}` },
      ],
    };
    state.agentBusy = true;
    state.streamingText = '';
    renderConversation();
    const result = await window.desktop.agent.chatStart(conversationId, value, message || undefined);
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
  if (event.type === 'delta') {
    state.streamingText += event.delta || '';
    renderConversationMessages();
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
  renderConversation();
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
}

function callServiceBlocked(shell) {
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
  content.replaceChildren();
  const shell = document.createElement('div');
  shell.className = 'call-shell';
  if (callServiceBlocked(shell)) return;

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
  shell.append(tabs);

  const body = document.createElement('div');
  body.className = 'call-body';
  if (state.callTab === 'recents') renderCallRecents(body, shell);
  else if (state.callTab === 'keypad') renderCallKeypad(body, shell);
  else renderCallContacts(body, shell);
  shell.append(body);
  content.append(shell);
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

// iOS 拨号盘：3×4 键位，底部一个绿色拨号键。
function renderCallKeypad(body, shell) {
  const pad = document.createElement('div');
  pad.className = 'keypad';
  const display = document.createElement('div');
  display.className = 'keypad-display';
  display.textContent = state.dialNumber ? formatNumber(state.dialNumber) : '';
  pad.append(display);
  const matched = state.conversations.find(item => (item.number || conversationSettings(item).number) === state.dialNumber);
  const hint = document.createElement('div');
  hint.className = 'keypad-hint';
  hint.textContent = state.dialNumber ? (matched ? matched.title : '没有匹配的联系人') : '输入号码呼叫联系人';
  pad.append(hint);
  const grid = document.createElement('div');
  grid.className = 'keypad-grid';
  [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
    ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']].forEach(([digit, letters]) => {
    const key = button('', 'keypad-key');
    key.innerHTML = `<strong>${digit}</strong>${letters ? `<span>${letters}</span>` : ''}`;
    key.addEventListener('click', () => {
      if (!/\d/.test(digit)) return;
      state.dialNumber = `${state.dialNumber}${digit}`.slice(0, 12);
      renderCall();
    });
    grid.append(key);
  });
  pad.append(grid);
  const actions = document.createElement('div');
  actions.className = 'keypad-actions';
  const dial = button('', 'keypad-dial');
  dial.title = '呼叫';
  dial.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z"/></svg>';
  dial.disabled = !matched;
  dial.addEventListener('click', () => {
    if (matched) openCallView(shell, matched);
  });
  const back = button('', 'keypad-back');
  back.title = '删除';
  back.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 6h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9L4 12z"/><path d="m13 10 4 4m0-4-4 4"/></svg>';
  back.disabled = !state.dialNumber;
  back.addEventListener('click', () => {
    state.dialNumber = state.dialNumber.slice(0, -1);
    renderCall();
  });
  actions.append(document.createElement('span'), dial, back);
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
  };
  const startedAt = Date.now();
  shell.replaceChildren();
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
  heading.innerHTML = '<div><h1>收藏</h1><p>聊天里右键一条消息，或用「多选收藏」一次收几条。</p></div>';
  if (state.favorites.length) {
    const clear = button('清空收藏', 'button button-danger');
    clear.addEventListener('click', async () => {
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
}

// 背景选择：纯色预设 + 自定义图片，通话背景默认纯黑。
function backgroundPicker(label, current, onChange) {
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
    if (value && value.startsWith('data:image/')) {
      preview.style.backgroundImage = `url("${value}")`;
      preview.style.background = '';
      preview.style.backgroundSize = 'cover';
      preview.style.backgroundPosition = 'center';
      preview.textContent = '';
    } else {
      preview.style.backgroundImage = '';
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
  file.accept = 'image/*';
  file.hidden = true;
  file.addEventListener('change', async () => {
    const image = file.files?.[0];
    file.value = '';
    if (!image) return;
    if (image.size > 4 * 1024 * 1024) {
      showError('背景图片超过 4MB，请先压缩');
      return;
    }
    try {
      apply(await readFileAsDataUrl(image));
    } catch (error) {
      showError(error.message);
    }
  });
  const upload = button('选图片…', 'button button-quiet button-small');
  upload.addEventListener('click', () => file.click());
  row.append(preview, swatches, upload, file);
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
  const settings = await window.desktop.app.settings.get();
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
    const note = document.createElement('p');
    note.textContent = hint;
    text.append(title, note);
    const toggle = document.createElement('label');
    toggle.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
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
      localStorage.setItem('earshot:theme', theme);
      await window.desktop.app.settings.save({ theme });
      renderSettings();
    });
    themeOptions.append(option);
  });
  appearance.append(themeOptions);
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
  callCard.append(callNote, callAdvanced);
  content.append(callCard);

  // 聊天背景与通话背景。
  const backgroundCard = document.createElement('section');
  backgroundCard.className = 'settings-card settings-section';
  backgroundCard.innerHTML = '<h2>背景</h2>';
  const backgroundNote = document.createElement('p');
  backgroundNote.className = 'settings-note';
  backgroundNote.textContent = '可以给聊天和通话各挑一张背景图，通话背景默认是纯黑。';
  backgroundCard.append(backgroundNote);
  backgroundCard.append(
    backgroundPicker('聊天背景', state.chatBackground, value => {
      state.chatBackground = value;
      return window.desktop.app.settings.save({ chatBackground: value });
    }),
    backgroundPicker('通话背景', state.callBackground, value => {
      state.callBackground = value;
      return window.desktop.app.settings.save({ callBackground: value });
    }),
  );
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
  if (!state.initialRouteHandled) {
    state.initialRouteHandled = true;
    if (!state.onboardingDismissed && onboardingNeeded()) location.hash = '#/providers';
  }
  state.meta = meta;
  state.service = service;
  renderTop();
  renderRoute();
}

function renderRoute() {
  const route = location.hash || '#/conversation';
  const pathName = route.split('?')[0].replace(/^#/, '') || '/conversation';
  // 供应商已并入设置，侧边只保留聊天 / 通话 / 收藏 / 设置。
  setActiveNav(pathName === '/providers' ? '/settings' : pathName);
  if (pathName === '/conversation') renderConversation();
  else if (pathName === '/call') renderCall();
  else if (pathName === '/favorites') renderFavorites();
  else if (pathName === '/providers') renderProviders();
  else renderSettings();
}

// 外观以主进程配置为准（默认浅色），避免旧版 localStorage 里的深色值覆盖默认值。
document.documentElement.dataset.theme = 'mono-light';

$('#open-logs')?.addEventListener('click', () => window.desktop.app.openPath('logs'));
window.addEventListener('hashchange', renderRoute);
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
    state.chatBackground = settings?.chatBackground || '';
    state.callBackground = settings?.callBackground || '';
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
