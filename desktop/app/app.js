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
  const profileSelect = $('#profile-select');
  const selected = state.activeProfileId;
  profileSelect.replaceChildren();
  state.profiles.forEach(profile => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    option.selected = profile.id === selected;
    profileSelect.append(option);
  });
  const profile = currentProfile();
  $('#sidebar-profile').textContent = profile?.name || '未选择';
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
  head.append(title, tag);
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
  heading.append(add);
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
  heading.innerHTML = '<div><h1>通话</h1><p>按住说话，Earshot 会边听边回应。</p></div>';
  shell.append(heading);
  if (state.service.status === 'ready' && state.meta?.port) {
    const view = document.createElement('webview');
    view.id = 'call-view';
    view.setAttribute('partition', 'persist:earshot-call');
    view.src = `http://127.0.0.1:${state.meta.port}`;
    shell.append(view);
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

function renderSettings() {
  content.replaceChildren();
  const heading = document.createElement('div');
  heading.className = 'page-heading';
  heading.innerHTML = '<div><h1>设置</h1><p>这里可以查看路径、服务状态和本机存储方式。</p></div>';
  content.append(heading);
  const card = document.createElement('section');
  card.className = 'settings-card settings-grid';
  const rows = [
    ['配置文件路径', state.meta?.configPath || ''],
    ['日志目录', state.meta?.logPath || ''],
    ['当前端口', state.meta?.port || '未启动'],
  ];
  rows.forEach(([label, value]) => card.append(settingRow(label, value)));
  const dataRow = document.createElement('div');
  dataRow.className = 'setting-row';
  const dataLabel = document.createElement('div');
  dataLabel.className = 'setting-label';
  dataLabel.textContent = '数据目录';
  const dataInput = document.createElement('input');
  dataInput.value = state.meta?.dataDir || '';
  dataInput.placeholder = '留空使用默认目录';
  const save = button('保存', 'button button-quiet button-small');
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await window.desktop.app.setDataDir(dataInput.value);
      showMessage('数据目录已保存。');
      await refresh();
    } catch (error) {
      showError(error.message);
    } finally {
      save.disabled = false;
    }
  });
  dataRow.append(dataLabel, dataInput, save);
  card.append(dataRow);
  card.append(settingRow('密钥存储方式', state.meta?.storage || ''));
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const config = button('打开配置目录', 'button button-quiet');
  config.addEventListener('click', () => window.desktop.app.openPath('config'));
  const restart = button('重启服务', 'button');
  restart.addEventListener('click', async () => {
    restart.disabled = true;
    try { await window.desktop.app.restartService(); } catch (error) { showError(error.message); }
    finally { restart.disabled = false; }
  });
  actions.append(config, restart);
  card.append(actions);
  const help = document.createElement('div');
  help.className = 'setting-help';
  help.textContent = '安装目录由安装程序选择。数据目录可以改到你方便备份的位置；修改供应商或路径后，请重启服务使设置生效。';
  card.append(help);
  content.append(card);

  const memoryCard = document.createElement('section');
  memoryCard.className = 'settings-card settings-grid';
  const memoryTitle = document.createElement('h2');
  memoryTitle.textContent = '外部记忆服务';
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
  const memoryHelp = document.createElement('div');
  memoryHelp.className = 'setting-help';
  memoryHelp.textContent = '关闭时不会请求记忆服务。开启后，每轮对话前召回相关内容，结束后保存本轮摘要；记忆服务默认使用本机 8765 端口。';
  memoryCard.append(memoryHelp);
  content.append(memoryCard);
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

$('#profile-select').addEventListener('change', async event => {
  try {
    await window.desktop.profiles.setActive(event.target.value);
    await window.desktop.app.restartService();
    await refresh();
  } catch (error) {
    showError(error.message);
  }
});
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
