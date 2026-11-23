const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scrollTarget, matchesConversation, timeLabel, startsTimeGroup } = require('../desktop/app/chat-ui.js');

test('incoming tokens keep a reader at their position while they read history', () => {
  assert.equal(scrollTarget({ top: 120, height: 1200, viewport: 500 }, 1400), 120);
});
test('a reader at the bottom follows new messages; switching contacts starts at the latest message', () => {
  assert.equal(scrollTarget({ top: 690, height: 1200, viewport: 500 }, 1400), 1400);
  assert.equal(scrollTarget({ top: 0, height: 1200, viewport: 500 }, 1400, true), 1400);
});
test('contact search handles Chinese, mixed case, phone numbers and empty searches', () => {
  const contact = { title: '项目 Alice', settings: { number: '13800138000' } };
  for (const query of [' 项目 ', 'ALICE', '13800', '']) assert.equal(matchesConversation(contact, query), true);
  assert.equal(matchesConversation(contact, '不存在'), false);
});
test('time separators appear after five minutes and ignore invalid timestamps', () => {
  assert.equal(startsTimeGroup('2026-11-23T08:06:00Z', '2026-11-23T08:00:00Z'), true);
  assert.equal(startsTimeGroup('2026-11-23T08:01:00Z', '2026-11-23T08:00:00Z'), false);
  assert.equal(startsTimeGroup('invalid', ''), false);
  assert.equal(startsTimeGroup('2026-11-23T08:00:00Z', ''), true);
  assert.equal(timeLabel('invalid'), '');
});
