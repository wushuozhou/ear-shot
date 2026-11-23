(function (root) {
  'use strict';
  function scrollTarget(previous, nextHeight, force = false) {
    const atBottom = previous.height - previous.viewport - previous.top < 80;
    return force || atBottom ? nextHeight : previous.top;
  }
  function matchesConversation(contact, query) {
    const text = `${contact.title || ''} ${contact.settings?.number || ''}`;
    return text.toLocaleLowerCase().includes(String(query || '').trim().toLocaleLowerCase());
  }
  function timeLabel(value, now = new Date()) {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) return '';
    const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (date.toDateString() === now.toDateString()) return time;
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
    return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  }
  function startsTimeGroup(current, previous) {
    const stamp = Date.parse(current);
    return Number.isFinite(stamp) && (!Number.isFinite(Date.parse(previous)) || stamp - Date.parse(previous) >= 300000);
  }
  const api = { scrollTarget, matchesConversation, timeLabel, startsTimeGroup };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.chatUi = api;
})(typeof window === 'object' ? window : globalThis);
