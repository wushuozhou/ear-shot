const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.join(__dirname, '../desktop/app/archive/assets/js');

function runtime() {
  const scripts = [];
  const document = {
    baseURI: 'tingyu-ui://archive/',
    head: { appendChild: script => scripts.push(script) },
    createElement(tag) {
      if (tag === 'script') return { remove() {} };
      const rects = [];
      const context = { fillRect(...bounds) { rects.push({ bounds, color: this.fillStyle }); } };
      return { rects, getContext: () => context };
    },
  };
  const context = vm.createContext({ document, URL });
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(base, 'tingyu-qr.js'), 'utf8'), context);
  const load = () => {
    vm.runInContext(fs.readFileSync(path.join(base, 'lib/qrcode-generator.js'), 'utf8'), context);
    scripts.at(-1).onload();
  };
  return { context, scripts, load, create: (...args) => context.TingyuQR.create(...args) };
}

test('concurrent QR requests share one encoder load and render with a four-module quiet zone', async () => {
  const app = runtime();
  const first = app.create('https://example.com', 256);
  const second = app.create('hello', 110, { foreground: '#123456' });
  assert.equal(app.scripts.length, 1);
  assert.equal(app.scripts[0].src, 'tingyu-ui://archive/assets/js/lib/qrcode-generator.js');
  app.load();
  for (const canvas of await Promise.all([first, second])) {
    const dark = canvas.rects.slice(1);
    assert.ok(dark.length > 100);
    assert.equal(canvas.rects[0].bounds[2], canvas.width);
    const cell = dark[0].bounds[2];
    for (const { bounds: [x, y, w, h] } of dark) {
      assert.equal(w, cell);
      assert.equal(h, cell);
      assert.ok(x >= cell * 4 && y >= cell * 4);
      assert.ok(x + cell <= canvas.width - cell * 4);
      assert.ok(y + cell <= canvas.height - cell * 4);
    }
  }
});

test('a failed encoder load rejects cleanly and the next QR request retries', async () => {
  const app = runtime();
  const failed = app.create('hello');
  const rejected = assert.rejects(failed, /failed to load/);
  app.scripts[0].onerror();
  await rejected;
  const retry = app.create('hello');
  assert.equal(app.scripts.length, 2);
  app.load();
  assert.ok((await retry).rects.length > 100);
});

test('Chinese payloads use UTF-8 and small canvases grow to fit every module and margin', async () => {
  const app = runtime();
  const pending = app.create('听屿 / 你好 🌊', 1);
  app.load();
  const canvas = await pending;
  assert.deepEqual(Array.from(app.context.qrcode.stringToBytes('听屿 / 你好 🌊')), Array.from(Buffer.from('听屿 / 你好 🌊')));
  const dark = canvas.rects.slice(1);
  assert.ok(canvas.width >= 29);
  assert.ok(dark.every(({ bounds: [x, y, w, h] }) => w === 1 && h === 1 && x >= 4 && y >= 4 && x < canvas.width - 4 && y < canvas.height - 4));
});
