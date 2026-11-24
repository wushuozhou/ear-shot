const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function runtime() {
  class Node {
    constructor() {
      this.children = [];
      this.listeners = {};
      this.attributes = {};
      this.hidden = false;
      const classes = new Set();
      this.classList = {
        add: name => classes.add(name), remove: name => classes.delete(name),
        contains: name => classes.has(name), toggle: (name, value) => value ? classes.add(name) : classes.delete(name),
      };
    }
    append(...nodes) { this.children.push(...nodes); }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    setAttribute(key, value) { this.attributes[key] = value; }
    querySelector(selector) { return this.children.find(node => '.' + node.className === selector) || null; }
  }
  const events = {}, messages = [], body = new Node();
  const items = ['chat', 'call'].map(id => ({ perma: id, videoURL: `assets/video/features/${id}.mp4` }));
  const values = new Map([['WorkItems/items', items], ['Router/state', 'work']]);
  const uniforms = { uThemeHue: { value: 0 }, uThemeSaturation: { value: 1 } };
  values.set('ViewController/uniforms', uniforms);
  const window = {
    TINGYU_FEATURES: [{ id: 'chat', label: '聊天' }, { id: 'call', label: '通话' }],
    AppState: { map: values, get: key => values.get(key), set: (key, value) => values.set(key, value) },
    parent: { postMessage: value => messages.push(value) },
    addEventListener: (name, listener) => events[name] = listener,
    clearInterval() {}, setInterval() { return 1; },
  };
  const document = {
    body, hidden: false, createElement: () => new Node(), addEventListener() {}, querySelectorAll: () => [],
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../desktop/app/archive/assets/js/tingyu-bridge.js'), 'utf8'), {
    window, document, addEventListener() {}, matchMedia: () => ({ matches: false }),
  });
  return { bridge: window.TingyuArchive, values, messages, body, uniforms,
    message: data => events.message({ source: window.parent, origin: 'file://', data }),
  };
}

test('gallery transition stops on detail and only Enter opens the selected native function', () => {
  const { bridge, values, messages, body } = runtime();
  values.set('WorkItems/videoURL', 'assets/video/features/call.mp4');
  assert.equal(bridge.openFeature('chat'), true);
  assert.equal(values.get('Work/project').perma, 'chat');
  assert.equal(values.get('WorkItems/videoURL'), 'assets/video/features/chat.mp4');
  assert.equal(messages.length, 0);
  assert.equal(bridge.enterFeature('chat'), false);
  bridge.completeFeatureEntry('chat');
  assert.equal(messages.length, 0, 'Completing the animation must not open the native page');
  const actions = body.querySelector('.tingyu-detail-actions');
  assert.equal(actions.hidden, false);
  assert.equal(actions.querySelector('.tingyu-detail-enter').attributes['aria-label'], '进入聊天');
  actions.querySelector('.tingyu-detail-enter').listeners.click();
  assert.equal(messages[0].type, 'tingyu:open');
  assert.equal(messages[0].feature, 'chat');
});

test('a visible gallery enters detail even when scrolling has not changed the router state', () => {
  const { bridge, values, messages } = runtime();
  values.set('Router/state', 'home');
  values.set('Work/scrollProgress', 0.56);
  bridge.openFeature('chat');
  assert.equal(values.get('Work/project').perma, 'chat');
  assert.equal(messages.length, 0);
});

test('stale transition completions cannot reopen a cancelled or different detail', () => {
  const { bridge, values, messages, body } = runtime();
  bridge.openFeature('chat');
  bridge.openFeature('call');
  bridge.completeFeatureEntry('chat');
  assert.equal(body.querySelector('.tingyu-detail-actions'), null);
  bridge.completeFeatureEntry('call');
  assert.equal(body.querySelector('.tingyu-detail-actions').hidden, false);
  body.querySelector('.tingyu-detail-actions').querySelector('.tingyu-detail-back').listeners.click();
  assert.equal(values.get('Work/project'), null);
  bridge.completeFeatureEntry('call');
  assert.equal(body.querySelector('.tingyu-detail-actions').hidden, true);
  assert.equal(bridge.enterFeature('call'), false);
  assert.equal(messages.length, 0);
});

test('leaving the scene clears its detail and applies finite theme changes', () => {
  const { bridge, values, body, message, uniforms } = runtime();
  bridge.openFeature('chat'); bridge.completeFeatureEntry('chat');
  message({ type: 'tingyu:visibility', visible: false });
  assert.equal(values.get('Work/project'), null);
  assert.equal(body.querySelector('.tingyu-detail-actions').hidden, true);
  message({ type: 'tingyu:theme', hue: 290, saturation: 1.1 });
  assert.equal(uniforms.uThemeHue.value, (290 - 163) / 360);
  assert.equal(uniforms.uThemeSaturation.value, 1.1);
  message({ type: 'tingyu:theme', hue: NaN, saturation: 0 });
  assert.equal(uniforms.uThemeHue.value, (290 - 163) / 360);
});

test('a delayed persona entry cannot open its editor over a newer route', async () => {
  let finishRender;
  const rendered = new Promise(resolve => finishRender = resolve);
  const editors = [];
  const context = {
    window: { featureHubData: { getFeature: () => ({ route: '/conversation' }) }, addEventListener() {} },
    location: { hash: '#/conversation' }, state: { currentConversation: { id: 'one' } },
    routeGeneration: 0,
    renderRoute() { context.routeGeneration++; context.window.pendingWorkspaceRender = rendered; },
    openConversationEditor: contact => editors.push(contact), showMessage() {}, showError() {},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../desktop/app/feature-hub.js'), 'utf8'), context);
  const opening = context.openArchiveFeature('persona');
  context.location.hash = '#/settings';
  context.routeGeneration++;
  finishRender();
  await opening;
  assert.equal(editors.length, 0);
});
