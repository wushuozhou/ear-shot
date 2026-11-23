(function () {
  'use strict'; window.__sceneErrors=[];addEventListener('error',e=>window.__sceneErrors.push(e.error?.stack||e.message));addEventListener('unhandledrejection',e=>window.__sceneErrors.push(e.reason?.stack||String(e.reason)));
  const features = new Set(window.TINGYU_FEATURES.map(feature => feature.id));
  let active = true;
  let ready = false;
  let contactView = null;
  let contactNotes = null;
  const emit = data => { if (window.parent !== window) window.parent.postMessage(data, '*'); };
  function openFeature(id) {
    if (!features.has(id)) return false;
    emit({ type: 'tingyu:open', feature: id });
    return true;
  }
  function applyVisibility() {
    if (!window.Render || !ready) return;
    if (active && !document.hidden) window.Render.resume();
    else window.Render.pause();
    document.querySelectorAll('video,audio').forEach(media => {
      if (!active || document.hidden) media.pause();
      else if (media.tagName === 'VIDEO') media.play().catch(() => {});
    });
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent || !['null', 'file://', 'http://127.0.0.1:4173'].includes(event.origin)) return;
    if (event.data?.type === 'tingyu:visibility' && typeof event.data.visible === 'boolean') {
      active = event.data.visible;
      applyVisibility();
    }
  });
  document.addEventListener('visibilitychange', applyVisibility);
  document.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (href.startsWith('tingyu:')) { event.preventDefault(); openFeature(href.slice(7)); }
    else if (/^(https?:|mailto:)/.test(href)) event.preventDefault();
  }, true);
  window.open = value => { if (String(value).startsWith('tingyu:')) openFeature(String(value).slice(7)); return null; };
  window.TingyuArchive = {
    openFeature,
    setContact(value, view) {
      document.body.classList.toggle('tingyu-contact-open', !!value);
      contactView = value ? view : null;
      if (!contactNotes) {
        contactNotes = document.createElement('div');
        contactNotes.className = 'tingyu-contact-notes';
        contactNotes.setAttribute('aria-hidden', 'true');
        [['lax','聊天'],['nyc','语音通话'],['ams','联系人'],['email','打开聊天'],['subscribe','模型连接'],['privacy','偏好设置'],['careers','新建联系人']].forEach(([key,text]) => {
          const note = document.createElement('span'); note.dataset.ref = key; note.textContent = text; contactNotes.append(note);
        });
        document.body.append(contactNotes);
      }
    }
  };
  if(window.TINGYU_STATIC){ready=true;emit({type:'tingyu:ready'});return;}
  const watchRuntime = window.setInterval(() => {
    if (!window.AppState || !window.Events) return;
    if (!window.AppState.map.has('ViewController/contact')) window.AppState.set('ViewController/contact', false);
    window.clearInterval(watchRuntime);
    const timer = window.setInterval(() => {
      const nav = document.querySelector('.nav-en-overlay.is-visible');
      if (!nav) return;
      window.clearInterval(timer);
      ready = true;
      emit({ type: 'tingyu:ready' });
      applyVisibility();
      const annotation = document.createElement('div');
      annotation.className = 'tingyu-scene-annotation';
      document.body.append(annotation);
      const labels = { home: '向下滚动', about: '倾听 · 连接 · 记住', contact: '对话模型 · 语音识别 · 语音合成' };
      window.setInterval(() => {
        if (!active || document.hidden) return;
        if (contactView?.ui && contactNotes) {
          const { ui } = contactView;
          contactNotes.childNodes.forEach(note => {
            const key = note.dataset.ref, item = contactView[key];
            if (!item) return;
            const hero = ['lax','nyc','ams'].includes(key), center = hero || key === 'email';
            const x = ui.x + (item.x + (center ? 0 : (item.dimensions?.width || 0) + 14)) * ui.scale;
            const y = ui.y + (item.y + (hero ? 120 : center ? 25 : 1)) * ui.scale;
            note.style.transform = `translate(${x}px,${y}px) translate(${center ? '-50%' : '0'},0)`;
          });
        }
        const route = window.AppState.get('Router/state');
        const text = document.body.classList.contains('tingyu-contact-open') ? '' : labels[route] || '';
        if (annotation.textContent !== text) annotation.textContent = text;
      }, 200);
    }, 120);
  }, 100);
})();
