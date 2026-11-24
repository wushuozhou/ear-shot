let workspaceCleanup = null;
const workspacePositions = new Map();
function disposeWorkspace() { workspaceCleanup?.(); workspaceCleanup = null; content.classList.remove('workspace-content'); }
function buildSectionWorkspace(kind) {
  workspaceCleanup?.();
  const previousScroll = workspacePositions.get(kind) || 0;
  const sections = [...content.querySelectorAll(':scope > section.provider-group, :scope > section.settings-section')];
  const names = { settings: ['设置', '设置'], providers: ['模型', '模型连接'], favorites: ['收藏', '我的收藏'] };
  const [title, chinese] = names[kind];
  const workspace = document.createElement('div'); workspace.className = 'glass-workspace';
  const aside = document.createElement('aside'); aside.className = 'workspace-index glass-surface';
  const heading = document.createElement('h1'); heading.textContent = title;
  const nav = document.createElement('nav'); nav.setAttribute('aria-label', chinese + '分类');
  aside.append(heading,nav);
  const body = document.createElement('div'); body.className = 'workspace-body glass-surface'; body.tabIndex = -1;
  body.append(...content.childNodes);
  const pageHeading = body.querySelector(':scope > .page-heading');
  if (pageHeading?.querySelector('.page-heading-actions')) {
    const title = pageHeading.querySelector('h1');
    if (title?.parentElement.children.length === 1 && title.parentElement !== pageHeading) title.parentElement.remove();
    else title?.remove();
    pageHeading.classList.add('workspace-actions');
  } else pageHeading?.remove();
  const buttons=[];
  sections.forEach((section,index)=>{
    const label = section.querySelector('h2')?.childNodes[0]?.textContent?.trim();
    if(!label)return;
    const entry=document.createElement('button');entry.type='button';entry.className='workspace-section-link';entry.textContent=label;
    entry.addEventListener('click',()=>{section.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});
    buttons.push({entry,section});nav.append(entry);
  });
  if(!buttons.length){const empty=document.createElement('span');empty.className='workspace-empty-label';empty.textContent=kind==='favorites'?'全部收藏':'全部';nav.append(empty);}
  const select=()=>{
    const top=body.getBoundingClientRect().top+96;
    let selected=buttons[0];
    for(const item of buttons)if(item.section.getBoundingClientRect().top<=top)selected=item;
    buttons.forEach(item=>{item.entry.classList.toggle('active',item===selected);if(item===selected)item.entry.setAttribute('aria-current','location');else item.entry.removeAttribute('aria-current');});
  };
  const onScroll = () => { workspacePositions.set(kind,body.scrollTop);select(); };
  body.addEventListener('scroll',onScroll,{passive:true});
  workspace.append(aside,body);content.replaceChildren(workspace);content.classList.add('workspace-content');select();
  body.scrollTop = previousScroll;
  select();
  workspaceCleanup=()=>body.removeEventListener('scroll',onScroll);
}
function mountCallPreview(shell) {
  const preview=document.createElement('section');preview.className='call-preview glass-surface';preview.setAttribute('aria-label','通话背景预览');
  const iframe=document.createElement('iframe');iframe.title='通话背景预览';iframe.className='call-preview-frame';
  iframe.src='http://127.0.0.1:'+state.meta.port+'/?preview=1';
  iframe.setAttribute('sandbox','allow-scripts allow-same-origin');
  const send=()=>iframe.contentWindow?.postMessage({type:'tingyu:call-preview',background:state.callBackground||'scene:spring-garden',backdropHue:state.callBackdropHue,fluidCursor:state.fluidCursor,backdropDensity:state.backdropDensity,backdropPattern:state.backdropPattern,backdropShape:state.backdropShape,fogColors:state.fogColors},'http://127.0.0.1:'+state.meta.port);
  iframe.addEventListener('load',send);
  const identity=document.createElement('div');identity.className='call-preview-identity';
  const selected=state.currentConversation||state.conversations[0];
  identity.append(avatarNode(conversationAvatar(selected),'call-preview-avatar'));
  const name=document.createElement('h2');name.textContent=selected?.title||'语音通话';identity.append(name);
  const action=button(selected?'发起通话':'添加联系人','button call-preview-start');
  action.addEventListener('click',()=>{
    if(selected)openCallView(shell,selected);else openArchiveFeature('new-contact');
  });
  const controls=document.createElement('div');controls.className='call-preview-controls';
  const background=button('更换背景','button button-quiet');
  background.addEventListener('click',()=>openArchiveFeature('background'));
  controls.append(action,background);identity.append(controls);preview.append(iframe,identity);
  return preview;
}

