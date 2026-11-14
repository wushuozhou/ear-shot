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
};

const $ = selector => document.querySelector(selector);
const content = $('#content');

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
  if (!messages.length && !state.streamingText) {
    const empty = document.createElement('div');
    empty.className = 'message-empty';
    empty.innerHTML = '<div><strong>先聊点什么吧</strong>去供应商页配好模型，然后在这里输入你的问题。</div>';
    stream.append(empty);
  } else {
    messages.forEach(message => {
      const row = document.createElement('div');
      row.className = `message-row ${message.role === 'user' ? 'user' : 'assistant'}`;
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';
      bubble.innerHTML = renderMarkdown(message.content);
      row.append(bubble);
      stream.append(row);
    });
    if (state.streamingText) {
      const row = document.createElement('div');
      row.className = 'message-row assistant';
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';
      bubble.innerHTML = renderMarkdown(state.streamingText);
      row.append(bubble);
      stream.append(row);
    }
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
  listTitle.textContent = '会话';
  const newConversation = button('新建', 'button button-quiet button-small');
  newConversation.addEventListener('click', async () => {
    try {
      state.currentConversation = await window.desktop.agent.conversationNew('新对话');
      state.conversations = await window.desktop.agent.conversationList();
      state.agentBusy = false;
      state.streamingText = '';
      renderConversation();
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
    empty.textContent = '还没有会话。点击“新建”开始聊天。';
    items.append(empty);
  }
  state.conversations.forEach(item => {
    const itemRow = document.createElement('div');
    itemRow.className = 'conversation-item-row';
    const row = button(item.title || '新对话', `conversation-item${item.id === state.currentConversation?.id ? ' active' : ''}`);
    row.title = item.title;
    row.addEventListener('click', async () => {
      try {
        state.currentConversation = await window.desktop.agent.conversationLoad(item.id);
        state.agentBusy = false;
        state.streamingText = '';
        renderConversation();
      } catch (error) {
        showError(error.message);
      }
    });
    row.addEventListener('contextmenu', async event => {
      event.preventDefault();
      const title = window.prompt('输入新的会话名称', item.title);
      if (title === null) return;
      try {
        state.currentConversation = await window.desktop.agent.conversationRename(item.id, title);
        state.conversations = await window.desktop.agent.conversationList();
        renderConversation();
      } catch (error) {
        showError(error.message);
      }
    });
    const rename = button('✎', 'conversation-item-delete');
    rename.title = '重命名会话';
    rename.addEventListener('click', async event => {
      event.stopPropagation();
      const title = window.prompt('输入新的会话名称', item.title);
      if (title === null) return;
      try {
        state.currentConversation = await window.desktop.agent.conversationRename(item.id, title);
        state.conversations = await window.desktop.agent.conversationList();
        renderConversation();
      } catch (error) {
        showError(error.message);
      }
    });
    const remove = button('×', 'conversation-item-delete');
    remove.title = '删除会话';
    remove.addEventListener('click', async event => {
      event.stopPropagation();
      if (!window.confirm(`确定删除“${item.title}”吗？`)) return;
      try {
        await window.desktop.agent.conversationDelete(item.id);
        state.conversations = await window.desktop.agent.conversationList();
        if (state.currentConversation?.id === item.id) {
          state.currentConversation = state.conversations.length
            ? await window.desktop.agent.conversationLoad(state.conversations[0].id)
            : await window.desktop.agent.conversationNew('新对话');
          state.conversations = await window.desktop.agent.conversationList();
        }
        renderConversation();
      } catch (error) {
        showError(error.message);
      }
    });
    itemRow.append(row, rename, remove);
    items.append(itemRow);
  });
  list.append(items);

  const main = document.createElement('section');
  main.className = 'conversation-main';
  const toolbar = document.createElement('div');
  toolbar.className = 'conversation-toolbar';
  const heading = document.createElement('h1');
  heading.textContent = state.currentConversation?.title || '对话';
  const tools = document.createElement('div');
  tools.className = 'conversation-tools';
  const toneLabel = document.createElement('label');
  toneLabel.textContent = '语气';
  const toneSelect = document.createElement('select');
  state.tones.forEach(tone => {
    const option = document.createElement('option');
    option.value = tone.id;
    option.textContent = tone.name;
    option.selected = tone.id === state.activeToneId;
    toneSelect.append(option);
  });
  toneSelect.addEventListener('change', async () => {
    try {
      await window.desktop.agent.setTone(toneSelect.value);
      state.activeToneId = toneSelect.value;
    } catch (error) {
      showError(error.message);
    }
  });
  toneLabel.append(toneSelect);
  const memoryLabel = document.createElement('label');
  memoryLabel.className = 'memory-toggle';
  const memory = document.createElement('input');
  memory.type = 'checkbox';
  memory.checked = state.memoryEnabled;
  memory.addEventListener('change', async () => {
    try {
      await window.desktop.agent.memorySet(state.memoryBaseUrl, memory.checked);
      state.memoryEnabled = memory.checked;
    } catch (error) {
      memory.checked = state.memoryEnabled;
      showError(error.message);
    }
  });
  memoryLabel.append(memory, document.createTextNode('记忆'));
  const model = document.createElement('span');
  model.className = 'model-label';
  model.title = currentModel();
  model.textContent = `模型：${currentModel()}`;
  tools.append(toneLabel, memoryLabel, model);
  toolbar.append(heading, tools);
  main.append(toolbar);
  const stream = document.createElement('div');
  stream.id = 'message-stream';
  stream.className = 'message-stream';
  main.append(stream);
  const form = document.createElement('form');
  form.className = 'message-form';
  const input = document.createElement('textarea');
  input.placeholder = '输入消息，按 Ctrl+Enter 发送';
  input.disabled = state.agentBusy || onboardingNeeded();
  input.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  const send = button(state.agentBusy ? '生成中…' : '发送', 'button');
  send.disabled = state.agentBusy || onboardingNeeded();
  form.append(input, send);
  if (state.agentBusy) {
    const stop = button('停止', 'button stop-button');
    stop.addEventListener('click', async () => {
      if (state.agentTicketId) await window.desktop.agent.chatAbort(state.agentTicketId);
    });
    form.append(stop);
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    startAgentChat(input.value);
  });
  main.append(form);
  const hint = document.createElement('div');
  hint.className = 'conversation-hint';
  hint.textContent = '提示：模型输出会按最小 Markdown 规则显示；语气规则会自动加入每轮对话。';
  main.append(hint);
  layout.append(list, main);
  content.append(layout);
  renderConversationMessages();
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
    state.providers.filter(provider => provider.kind === kind).forEach(provider => grid.append(providerCard(provider)));
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
  heading.innerHTML = '<div><h1>通话</h1></div>';
  shell.append(heading);
  if (state.service.status === 'ready' && state.meta?.port) {
    const empty = document.createElement('div');
    empty.className = 'settings-card call-empty';
    const start = button('开始通话', 'button');
    start.addEventListener('click', () => {
      empty.remove();
      const view = document.createElement('webview');
      view.id = 'call-view';
      view.setAttribute('partition', 'persist:earshot-call');
      view.src = `http://127.0.0.1:${state.meta.port}`;
      shell.append(view);
    });
    empty.append(start);
    shell.append(empty);
  } else {
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
  }
  content.append(shell);
}

async function renderSettings() {
  const settings = await window.desktop.app.settings.get();
  const persona = { ...(settings.persona || {}) };
  const savedAvatar = settings.avatar || 'preset-1';
  const defaultPersona = {
    name: 'Earshot',
    self: '我',
    user: '你',
    personality: '认真、温和、可靠',
    style: '清楚、自然、简洁',
    taboo: '',
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

  const personaCard = document.createElement('section');
  personaCard.className = 'settings-card settings-section';
  personaCard.innerHTML = '<h2>人设</h2>';
  const personaForm = document.createElement('form');
  personaForm.className = 'persona-form';
  [['name', '名字'], ['self', '自称'], ['user', '怎么称呼你'], ['personality', '性格'], ['style', '说话风格'], ['taboo', '禁忌话题']].forEach(([name, label]) => {
    const row = document.createElement('label');
    row.className = 'persona-row';
    row.innerHTML = `<span>${label}</span><input name="${name}" value="${String(persona[name] || '').replace(/"/g, '&quot;')}">`;
    personaForm.append(row);
  });
  const personaActions = document.createElement('div');
  personaActions.className = 'settings-actions';
  const personaSave = button('保存');
  const personaReset = button('恢复默认', 'button button-quiet');
  personaReset.addEventListener('click', () => {
    Object.assign(persona, defaultPersona);
    personaForm.querySelectorAll('input').forEach(input => { input.value = persona[input.name] || ''; });
  });
  personaSave.addEventListener('click', async event => {
    event.preventDefault();
    const nextPersona = Object.fromEntries(new FormData(personaForm));
    await window.desktop.app.settings.save({ persona: nextPersona });
    personaSave.textContent = '已保存';
    setTimeout(() => { personaSave.textContent = '保存'; }, 1200);
  });
  personaActions.append(personaSave, personaReset);
  personaForm.append(personaActions);
  personaCard.append(personaForm);
  content.append(personaCard);

  const avatarCard = document.createElement('section');
  avatarCard.className = 'settings-card settings-section';
  avatarCard.innerHTML = '<h2>形象</h2>';
  const avatarLayout = document.createElement('div');
  avatarLayout.className = 'avatar-layout';
  const avatarMain = document.createElement('div');
  avatarMain.className = 'avatar-main';
  const avatarTabs = document.createElement('div');
  avatarTabs.className = 'avatar-tabs';
  const presetTab = button('预设', 'button button-quiet selected');
  const uploadTab = button('上传', 'button button-quiet');
  avatarTabs.append(presetTab, uploadTab);
  const avatarPreview = document.createElement('div');
  avatarPreview.className = 'avatar-preview';
  const setAvatarPreview = value => {
    avatarPreview.className = 'avatar-preview';
    if (value.startsWith('data:image/')) avatarPreview.style.backgroundImage = `url("${value}")`;
    else avatarPreview.classList.add(value);
  };
  setAvatarPreview(savedAvatar);
  const presetPanel = document.createElement('div');
  presetPanel.className = 'avatar-panel avatar-presets';
  let pendingAvatar = savedAvatar;
  for (let index = 1; index <= 6; index += 1) {
    const preset = button('', `avatar-preset preset-${index}${savedAvatar === `preset-${index}` ? ' selected' : ''}`);
    preset.title = `预设 ${index}`;
    preset.addEventListener('click', () => {
      pendingAvatar = `preset-${index}`;
      presetPanel.querySelectorAll('.avatar-preset').forEach(item => item.classList.remove('selected'));
      preset.classList.add('selected');
      setAvatarPreview(pendingAvatar);
    });
    presetPanel.append(preset);
  }
  const uploadPanel = document.createElement('div');
  uploadPanel.className = 'avatar-panel avatar-upload hidden';
  const uploadInput = document.createElement('input');
  uploadInput.type = 'file';
  uploadInput.accept = 'image/*';
  const uploadDrop = document.createElement('label');
  uploadDrop.className = 'avatar-drop';
  uploadDrop.textContent = '选择图片或拖入';
  uploadDrop.append(uploadInput);
  const readImage = file => {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 2 * 1024 * 1024) {
      showError('图片超过 2MB，请先压缩');
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      pendingAvatar = String(reader.result);
      setAvatarPreview(pendingAvatar);
    });
    reader.readAsDataURL(file);
  };
  uploadInput.addEventListener('change', () => readImage(uploadInput.files?.[0]));
  uploadDrop.addEventListener('dragover', event => { event.preventDefault(); uploadDrop.classList.add('dragging'); });
  uploadDrop.addEventListener('dragleave', () => uploadDrop.classList.remove('dragging'));
  uploadDrop.addEventListener('drop', event => {
    event.preventDefault();
    uploadDrop.classList.remove('dragging');
    readImage(event.dataTransfer.files?.[0]);
  });
  uploadPanel.append(uploadDrop);
  const setAvatarPanel = upload => {
    presetPanel.classList.toggle('hidden', upload);
    uploadPanel.classList.toggle('hidden', !upload);
    presetTab.classList.toggle('selected', !upload);
    uploadTab.classList.toggle('selected', upload);
  };
  presetTab.addEventListener('click', () => setAvatarPanel(false));
  uploadTab.addEventListener('click', () => setAvatarPanel(true));
  avatarMain.append(avatarTabs, presetPanel, uploadPanel);
  const avatarSide = document.createElement('div');
  avatarSide.className = 'avatar-side';
  avatarSide.append(avatarPreview);
  const avatarSave = button('保存');
  const avatarReset = button('恢复默认', 'button button-quiet');
  avatarSave.addEventListener('click', async () => {
    await window.desktop.app.settings.save({ avatar: pendingAvatar });
    avatarSave.textContent = '已保存';
    setTimeout(() => { avatarSave.textContent = '保存'; }, 1200);
  });
  avatarReset.addEventListener('click', () => {
    pendingAvatar = 'preset-1';
    setAvatarPreview(pendingAvatar);
    presetPanel.querySelectorAll('.avatar-preset').forEach(item => item.classList.toggle('selected', item.classList.contains('preset-1')));
  });
  avatarSide.append(avatarSave, avatarReset);
  avatarLayout.append(avatarMain, avatarSide);
  avatarCard.append(avatarLayout);
  content.append(avatarCard);

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

const theme = localStorage.getItem('earshot:theme') || 'deep-space';
document.documentElement.dataset.theme = ['deep-space', 'mono-light', 'warm-night', 'contrast'].includes(theme)
  ? theme
  : 'deep-space';

$('#open-logs').addEventListener('click', () => window.desktop.app.openPath('logs'));
window.addEventListener('hashchange', renderRoute);
window.desktop.agent.onEvent(handleAgentEvent);
window.desktop.onState(async service => {
  state.service = service;
  renderTop();
  if (location.hash === '#/call') renderRoute();
  try { state.meta = await window.desktop.app.getMeta(); } catch (_) { /* keep last status */ }
});
refresh().then(loadAgentState).catch(error => showError(`无法读取桌面状态：${error.message}`));
