const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function pickerRuntime(onChange) {
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.style = {}; this.attributes = {}; this.listeners = {};
      this.isConnected = true;
      this.classList = {
        add: (...values) => this.className = [...new Set([...this.className.split(' '), ...values])].join(' '),
        remove: (...values) => this.className = this.className.split(' ').filter(value => !values.includes(value)).join(' '),
        toggle: (value, enabled) => enabled ? this.classList.add(value) : this.classList.remove(value),
      };
    }
    className = '';
    append(...items) { this.children.push(...items); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    getContext() { return { drawImage() {} }; }
    toDataURL() { return 'data:image/png;base64,fixture'; }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [...(child.className.split(' ').includes(selector.slice(1)) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
  }
  const presets = Array.from({ length: 6 }, (_, index) => `preset-${index + 1}`);
  const context = {
    AVATAR_PRESETS: presets, document: { createElement: tag => new Element(tag) },
    button: (text, className) => { const el = new Element('button'); el.className = className; el.textContent = text; return el; },
    showError() {},
  };
  const source = fs.readFileSync(require.resolve('../desktop/app/app.js'), 'utf8');
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function isImageAvatar('), source.indexOf('function formatNumber(')), context);
  return { picker: context.avatarPicker('preset-4', onChange, 'preset-4'), context };
}

test('multiple failed avatar changes return to the last saved avatar', async () => {
  const pending = [];
  const { picker } = pickerRuntime(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  const options = picker.querySelectorAll('.avatar-preset');
  const first = options[1].listeners.click();
  const second = options[2].listeners.click();
  pending[0].reject(Error('failed')); await first;
  pending[1].reject(Error('failed')); await second;
  assert.ok(picker.querySelectorAll('.avatar-picker-preview')[0].className.includes('preset-4'));
  assert.equal(options[3].attributes['aria-pressed'], 'true');
});

test('a failed latest choice retains the preceding successful avatar', async () => {
  const pending = [];
  const { picker } = pickerRuntime(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  const options = picker.querySelectorAll('.avatar-preset');
  const first = options[1].listeners.click();
  const second = options[2].listeners.click();
  pending[0].resolve(); await first;
  pending[1].reject(Error('failed')); await second;
  assert.ok(picker.querySelectorAll('.avatar-picker-preview')[0].className.includes('preset-2'));
});

test('My Avatar uses its own fallback, and upload is keyboard reachable', () => {
  const { picker, context } = pickerRuntime(() => {});
  const avatar = context.avatarNode('invalid', 'message-avatar', 'preset-4');
  assert.ok(avatar.className.includes('preset-4'));
  assert.ok(!avatar.className.includes('preset-1'));
  const upload = picker.querySelectorAll('.avatar-upload-mini')[0];
  assert.equal(upload.tagName, 'BUTTON');
  assert.equal(upload.attributes['aria-label'], '上传头像');
});

test('reset or removal invalidates an upload that is still decoding', async () => {
  for (const removal of [false, true]) {
    const saved = [];
    const { picker, context } = pickerRuntime(value => saved.push(value));
    let finishRead;
    context.readFileAsDataUrl = () => new Promise(resolve => finishRead = resolve);
    context.Image = class { width = 600; height = 300; decode() { return Promise.resolve(); } };
    const input = picker.children.find(child => child.tagName === 'INPUT');
    input.files = [{ type: 'image/png', size: 100 }];
    const pending = input.listeners.change();
    if (removal) picker.isConnected = false;
    else picker.cancelPending();
    finishRead('data:image/png;base64,fixture');
    await pending;
    assert.deepEqual(saved, []);
  }
});
