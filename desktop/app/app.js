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
  chat: { waveform: true },
  avatars: { ai: 'preset-1', user: 'preset-4' },
};

const AVATAR_PRESETS = ['preset-1', 'preset-2', 'preset-3', 'preset-4', 'preset-5', 'preset-6'];
const PHONE_THEME = ['deep-space', 'mono-light', 'warm-night', 'contrast'];

const $ = selector => document.querySelector(selector);
const content = $('#content');

document.addEventListener('pointerdown', event => {
  if (event.target.closest('.conversation-item-row')) return;
  document.querySelectorAll('.conversation-item-row.expanded').forEach(item => item.classList.remove('expanded'));
});

function escapeText(value) {
  return String(value ?? '');
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
  $('#top-status').textContent = status;
  $('#top-status').className = `status-pill status-${state.service.status === 'ready' ? 'ready' : state.service.status === 'failed' ? 'failed' : 'starting'}`;
  $('#sidebar-status').textContent = status;
  $('#sidebar-dot').className = state.service.status === 'ready' ? 'ready' : state.service.status === 'failed' ? 'failed' : '';
  const notice = $('#notice');
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

function renderConversationMessages() {
  const stream = $('#message-stream');
  if (!stream) return;
  stream.replaceChildren();
  const messages = state.currentConversation?.messages || [];
  if (onboardingNeeded()) {
    const empty = document.createElement('div');
    empty.className = 'message-empty';
    empty.innerHTML = '<div><strong>先完成首次设置</strong>请先到「供应商」页选择套餐、填写 Key 并测试连接，完成后就可以开始聊天。</div>';
    stream.append(empty);
    return;
  }
  const assistantAvatar = conversationAvatar(state.currentConversation);
  const rowFor = (role, content) => {
    const row = document.createElement('div');
    row.className = `message-row ${role === 'user' ? 'user' : 'assistant'}`;
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerHTML = renderMarkdown(stripStageDirections(content));
    const avatar = avatarNode(role === 'user' ? state.avatars.user : assistantAvatar, 'message-avatar');
    if (role === 'user') row.append(bubble, avatar);
    else row.append(avatar, bubble);
    return row;
  };
  if (!messages.length && !state.streamingText) {
    const empty = document.createElement('div');
    empty.className = 'message-empty';
    empty.innerHTML = '<div><strong>先聊点什么吧</strong>去供应商页配好模型，然后在这里输入你的问题。</div>';
    stream.append(empty);
  } else {
    messages.forEach(message => stream.append(rowFor(message.role, message.content)));
    if (state.streamingText) stream.append(rowFor('assistant', state.streamingText));
  }
  stream.scrollTop = stream.scrollHeight;
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
      state.currentConversation = await window.desktop.agent.conversationNew('新对话');
      state.conversations = await window.desktop.agent.conversationList();
      state.agentBusy = false;
      state.streamingText = '';
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
    row.title = item.title;
    row.append(avatarNode(item.avatar || conversationSettings(item).avatar || state.avatars.ai, 'conversation-avatar'));
    const body = document.createElement('span');
    body.className = 'conversation-item-body';
    const name = document.createElement('span');
    name.className = 'conversation-item-name';
    name.textContent = item.title || '新对话';
    const sub = document.createElement('span');
    sub.className = 'conversation-item-sub';
    sub.textContent = '点击开始聊天';
    body.append(name, sub);
    row.append(body);
    row.addEventListener('click', async () => {
      if (itemRow.classList.contains('expanded')) {
        itemRow.classList.remove('expanded');
        return;
      }
      try {
        state.currentConversation = await window.desktop.agent.conversationLoad(item.id);
        state.agentBusy = false;
        state.streamingText = '';
        renderConversation();
      } catch (error) {
        showError(error.message);
      }
    });
    const remove = button('删除', 'conversation-item-delete');
    remove.addEventListener('click', async event => {
      event.stopPropagation();
      openDeleteConfirm(item);
    });
    itemRow.append(row, remove);
    let startX = 0;
    let offsetX = 0;
    let dragging = false;
    let swiped = false;
    let wasExpanded = false;
    itemRow.addEventListener('pointerdown', event => {
      wasExpanded = itemRow.classList.contains('expanded');
      items.querySelectorAll('.conversation-item-row.expanded').forEach(other => {
        if (other !== itemRow) other.classList.remove('expanded');
      });
      startX = event.clientX;
      offsetX = 0;
      dragging = true;
      itemRow.setPointerCapture(event.pointerId);
    });
    itemRow.addEventListener('pointermove', event => {
      if (!dragging) return;
      offsetX = Math.max(-86, Math.min(0, event.clientX - startX));
      swiped = Math.abs(offsetX) > 5;
      itemRow.style.setProperty('--swipe-x', `${offsetX}px`);
    });
    itemRow.addEventListener('pointerup', event => {
      if (!dragging) return;
      dragging = false;
      itemRow.releasePointerCapture(event.pointerId);
      if (offsetX < -35) itemRow.classList.add('expanded');
      else if (!wasExpanded) itemRow.classList.remove('expanded');
      itemRow.style.removeProperty('--swipe-x');
      if (itemRow.classList.contains('expanded')) {
        items.querySelectorAll('.conversation-item-row.expanded').forEach(other => {
          if (other !== itemRow) other.classList.remove('expanded');
        });
      }
    });
    itemRow.addEventListener('click', event => {
      if (!swiped) return;
      swiped = false;
      event.stopPropagation();
      event.preventDefault();
    }, true);
    itemRow.addEventListener('click', event => {
      if (itemRow.classList.contains('expanded') && !event.target.closest('.conversation-item-delete')) {
        event.stopPropagation();
        itemRow.classList.remove('expanded');
      }
    });
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
  identity.append(identityText);
  const tools = document.createElement('div');
  tools.className = 'conversation-tools';
  toolbar.append(identity);
  main.append(toolbar);
  const stream = document.createElement('div');
  stream.id = 'message-stream';
  stream.className = 'message-stream';
  main.append(stream);
  const form = document.createElement('form');
  form.className = 'message-form';
  const input = document.createElement('textarea');
  input.disabled = state.agentBusy || onboardingNeeded();
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  const send = button('发送', 'button');
  send.disabled = state.agentBusy || onboardingNeeded();
  form.append(input, send);
  form.addEventListener('submit', event => {
    event.preventDefault();
    startAgentChat(input.value);
  });
  main.append(form);
  layout.append(list, main);
  content.append(layout);
  renderConversationMessages();
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
      if (state.currentConversation?.id === item.id) state.currentConversation = updated;
      state.conversations = await window.desktop.agent.conversationList();
      backdrop.remove();
      renderRoute();
      showMessage('联系人设置已保存');
    } catch (error) {
      save.disabled = false;
      showError(error.message);
    }

  });
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
          state.conversations = await window.desktop.agent.conversationList();
          if (state.currentConversation?.id === item.id) {
            state.currentConversation = state.conversations.length
              ? await window.desktop.agent.conversationLoad(state.conversations[0].id)
              : await window.desktop.agent.conversationNew('新联系人');
            state.conversations = await window.desktop.agent.conversationList();
          }
          backdrop.remove();
          renderConversation();
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

async function startAgentChat(text) {
  const value = String(text || '').trim();
  if (!value || state.agentBusy) return;
  try {
    if (!state.currentConversation) {
      state.currentConversation = await window.desktop.agent.conversationNew('新对话');
      state.conversations = await window.desktop.agent.conversationList();
    }
    state.currentConversation.messages.push({ role: 'user', content: value });
    state.agentBusy = true;
    state.streamingText = '';
    renderConversation();
    const result = await window.desktop.agent.chatStart(state.currentConversation.id, value);
    state.agentTicketId = result.ticketId;
    renderConversation();
  } catch (error) {
    state.agentBusy = false;
    showError(error.message);
    renderConversation();
  }
}

async function handleAgentEvent(event) {
  if (!event || event.conversationId !== state.currentConversation?.id) return;
  if (event.type === 'delta') {
    state.streamingText += event.delta || '';
    renderConversationMessages();
  } else if (event.type === 'done') {
    state.currentConversation = await window.desktop.agent.conversationLoad(event.conversationId);
    state.conversations = await window.desktop.agent.conversationList();
    state.agentBusy = false;
    state.agentTicketId = '';
    state.streamingText = '';
    renderConversation();
  } else if (event.type === 'error') {
    state.agentBusy = false;
    state.agentTicketId = '';
    state.streamingText = '';
    showError(event.message || '对话请求失败');
    state.currentConversation = await window.desktop.agent.conversationLoad(event.conversationId);
    renderConversation();
  }
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
  if (state.conversations.length) {
    state.currentConversation = await window.desktop.agent.conversationLoad(state.conversations[0].id);
  } else {
    state.currentConversation = await window.desktop.agent.conversationNew('新对话');
    state.conversations = await window.desktop.agent.conversationList();
  }
  renderRoute();
}

function renderProviders() {
  content.replaceChildren();
  const heading = document.createElement('div');
  heading.className = 'page-heading';
  heading.innerHTML = '<div><h1>供应商</h1><p>管理模型、转文字和声音服务。密钥只保存在你的电脑上。</p></div>';
  const add = button('添加供应商', 'button');
  add.addEventListener('click', () => openProviderForm());
  const quickConnect = button('快速连接', 'button button-quiet');
  quickConnect.addEventListener('click', openQuickConnectForm);
  const headingActions = document.createElement('div');
  headingActions.className = 'page-heading-actions';
  headingActions.append(add, quickConnect);
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

function renderCall() {
  content.replaceChildren();
  const shell = document.createElement('div');
  shell.className = 'call-shell';
  const heading = document.createElement('div');
  heading.className = 'page-heading';
  heading.innerHTML = '<div><h1>通话</h1><p>选一个联系人，用打电话的方式聊一会儿。</p></div>';
  shell.append(heading);
  if (state.service.status !== 'ready' || !state.meta?.port) {
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
    return;
  }
  if (!state.conversations.length) {
    const empty = document.createElement('div');
    empty.className = 'settings-card call-empty';
    const inner = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = '还没有联系人';
    const message = document.createElement('p');
    message.textContent = '先在「对话」里新建一个联系人，设置头像和号码后会出现在这里。';
    const go = button('去新建联系人', 'button');
    go.addEventListener('click', () => { location.hash = '#/conversation'; });
    inner.append(title, message, go);
    empty.append(inner);
    shell.append(empty);
    content.append(shell);
    return;
  }
  const dialer = document.createElement('div');
  dialer.className = 'dialer';
  const contacts = document.createElement('div');
  contacts.className = 'call-contacts';
  state.conversations.forEach(item => {
    const contact = button('', 'call-contact');
    contact.append(avatarNode(item.avatar || conversationSettings(item).avatar || state.avatars.ai, 'call-avatar'));
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
  dialer.append(contacts);
  shell.append(dialer);
  content.append(shell);
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
  };
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
    // 把联系人信息交给通话页：名字、号码、头像、模型、说话风格、波形开关。
    const literal = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    view.executeJavaScript(`window.dispatchEvent(new CustomEvent('earshot:contact', { detail: ${literal} }))`).catch(() => {});
  };
  view.addEventListener('dom-ready', inject);
  view.addEventListener('did-finish-load', inject);
  back.addEventListener('click', () => {
    view.executeJavaScript('window.earshotHangup && window.earshotHangup()').catch(() => {});
    setTimeout(() => { renderCall(); }, 120);
  });
  shell.append(bar, view);
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
  );
  callCard.append(callPrefs);
  content.append(callCard);

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
    row.append(avatarNode(item.avatar || conversationSettings(item).avatar || state.avatars.ai, 'conversation-avatar'));
    const text = document.createElement('div');
    text.className = 'settings-contact-text';
    const name = document.createElement('strong');
    name.textContent = item.title || '新对话';
    const sub = document.createElement('span');
    const itemNumber = item.number || conversationSettings(item).number;
    sub.textContent = itemNumber ? formatNumber(itemNumber) : conversationModelName(item);
    text.append(name, sub);
    const edit = button('编辑', 'button button-quiet button-small');
    edit.addEventListener('click', () => openConversationEditor(item));
    row.append(text, edit);
    contactList.append(row);
  });
  contactCard.append(contactNote, contactList);
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
  const restart = button('重启服务', 'button');
  restart.title = '重启服务会中断当前通话';
  restart.addEventListener('click', async () => {
    if (!window.confirm('重启服务会中断当前通话，是否继续？')) return;
    restart.disabled = true;
    try { await window.desktop.app.restartService(); } catch (error) { showError(error.message); }
    finally { restart.disabled = false; }
  });
  storageActions.append(config, restart);
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
  const pathName = route.split('?')[0].replace(/^#/, '') || '/providers';
  setActiveNav(pathName);
  if (pathName === '/conversation') renderConversation();
  else if (pathName === '/call') renderCall();
  else if (pathName === '/settings') renderSettings();
  else renderProviders();
}

// 外观以主进程配置为准（默认浅色），避免旧版 localStorage 里的深色值覆盖默认值。
document.documentElement.dataset.theme = 'mono-light';

$('#open-logs').addEventListener('click', () => window.desktop.app.openPath('logs'));
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
    if (settings?.toneId) state.activeToneId = settings.toneId;
  } catch (_) {
    // 设置读不到时用默认值继续渲染。
  }
  await refresh();
  await loadAgentState();
}

bootstrapUi().catch(error => showError(`无法读取桌面状态：${error.message}`));
