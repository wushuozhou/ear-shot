(function () {
  'use strict'; window.__sceneErrors=[];addEventListener('error',e=>window.__sceneErrors.push(e.error?.stack||e.message));addEventListener('unhandledrejection',e=>window.__sceneErrors.push(e.reason?.stack||String(e.reason)));
  const features = new Set(window.TINGYU_FEATURES.map(feature => feature.id));
  let active = true;
  let ready = false;
  let contactView = null;
  let contactNotes = null;
  let pendingTheme = null;
  let themeRetry = 0;
  let enteringFeature = null;
  let detailFeature = null;
  let detailActions = null;
  const emit = data => { if (window.parent !== window) window.parent.postMessage(data, '*'); };
  function applyTheme() {
    if (!pendingTheme) return false;
    if (!window.AppState?.map?.has('ViewController/uniforms')) return false;
    const uniforms = window.AppState.get('ViewController/uniforms');
    if (!uniforms?.uThemeHue || !uniforms?.uThemeSaturation) return false;
    uniforms.uThemeHue.value = (pendingTheme.hue - 163) / 360;
    uniforms.uThemeSaturation.value = pendingTheme.saturation;
    if (themeRetry) { window.clearInterval(themeRetry); themeRetry = 0; }
    return true;
  }
  function queueTheme(theme) {
    if (typeof theme.hue !== 'number' || !Number.isFinite(theme.hue) || typeof theme.saturation !== 'number' || !Number.isFinite(theme.saturation)) return;
    pendingTheme = { hue: Math.max(0, Math.min(360, theme.hue)), saturation: Math.max(0.5, Math.min(1.5, theme.saturation)) };
    if (window.TINGYU_STATIC || applyTheme()) return;
    if (!themeRetry) themeRetry = window.setInterval(applyTheme, 100);
  }
  function openFeature(id) {
    if (!features.has(id)) return false;
    // Reuse Work/WorkDetail's original camera, particle and refraction transition.
    // Other entry points open immediately and use the workspace transition.
    const item = window.AppState?.get('WorkItems/items')?.find(item => item.perma === id);
    const progress = window.AppState?.get('Work/scrollProgress');
    const inGallery = (window.AppState?.get('Router/state') === 'work'
      || (progress > 0.05 && progress < 0.95))
      && !window.AppState?.get('ViewController/contact');
    if (item && inGallery) {
      if (enteringFeature === id) return true;
      if (detailFeature === id) return true;
      cancelFeatureEntry();
      enteringFeature = id;
      document.body.classList.add('tingyu-entering-feature');
      window.AppState.set('WorkItems/videoURL', item.videoURL);
      window.AppState.set('Work/project', item);
      return true;
    }
    emit({ type: 'tingyu:open', feature: id });
    return true;
  }
  function cancelFeatureEntry() {
    enteringFeature = null;
    detailFeature = null;
    if (detailActions) detailActions.hidden = true;
    document.body.classList.remove('tingyu-entering-feature');
    document.body.classList.remove('tingyu-feature-detail');
  }
  function completeFeatureEntry(id) {
    if (enteringFeature !== id) return;
    if (window.AppState?.get('Work/project')?.perma !== id) return;
    enteringFeature = null;
    detailFeature = id;
    document.body.classList.remove('tingyu-entering-feature');
    document.body.classList.add('tingyu-feature-detail');
    if (!detailActions) {
      detailActions = document.createElement('div');
      detailActions.className = 'tingyu-detail-actions';
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'tingyu-detail-back';
      back.textContent = '返回';
      back.addEventListener('click', () => {
        cancelFeatureEntry();
        window.AppState.set('Work/project', null);
      });
      const enter = document.createElement('button');
      enter.type = 'button';
      enter.className = 'tingyu-detail-enter';
      enter.innerHTML = '<span>进入</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
      enter.addEventListener('click', () => enterFeature(detailFeature));
      detailActions.append(back, enter);
      document.body.append(detailActions);
    }
    const feature = window.TINGYU_FEATURES.find(feature => feature.id === id);
    detailActions.querySelector('.tingyu-detail-enter').setAttribute('aria-label', `进入${feature.label}`);
    detailActions.hidden = false;
  }
  function enterFeature(id) {
    if (!features.has(id) || detailFeature !== id || window.AppState?.get('Work/project')?.perma !== id) return false;
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
      if (!active && window.AppState?.get('Work/project')) {
        cancelFeatureEntry();
        window.AppState.set('Work/project', null);
      }
      applyVisibility();
    }
    else if (event.data?.type === 'tingyu:theme') queueTheme(event.data);
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
    enterFeature,
    completeFeatureEntry,
    cancelFeatureEntry,
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
      }, 200);
    }, 120);
  }, 100);
})();
