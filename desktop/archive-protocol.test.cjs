const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveArchivePath } = require('./archive-protocol.cjs');
const root = path.resolve('archive-test');
test('archive root and detail navigation use the original entry', () => {
  for (const url of ['tingyu-ui://archive/', 'tingyu-ui://archive/work/chat']) {
    assert.equal(resolveArchivePath(url, root), path.join(root, 'index.html'));
  }
});
test('archive assets resolve inside the archive only', () => {
  assert.equal(resolveArchivePath('tingyu-ui://archive/assets/js/app.js?v=1', root), path.join(root, 'assets/js/app.js'));
  for (const url of ['tingyu-ui://other/assets/a.js', 'https://archive/a.js', 'tingyu-ui://archive/%2e%2e%2fsecret', 'tingyu-ui://archive/assets%5c..%5c..%5csecret', 'tingyu-ui://archive/%00']) {
    assert.equal(resolveArchivePath(url, root), null, url);
  }
});
