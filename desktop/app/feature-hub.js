let archiveFrame = null;
let featureEntryGeneration = 0;
function disposeFeatureHub() {
 if (!archiveFrame) return;
 archiveFrame.classList.add('archive-hidden');
 archiveFrame.inert = true;
 archiveFrame.contentWindow?.postMessage({type:'tingyu:visibility',visible:false}, 'tingyu-ui://archive');
}
function renderFeatureHub() {
 content.replaceChildren();
 if(!archiveFrame){
  archiveFrame=document.createElement('iframe');
  archiveFrame.className='archive-frame';
  archiveFrame.title='听屿 · 功能空间';
  archiveFrame.src='tingyu-ui://archive/';
  archiveFrame.setAttribute('sandbox','allow-scripts allow-same-origin');
  archiveFrame.addEventListener('load',()=>syncWorkspaceTheme());
  document.querySelector('.main').append(archiveFrame);
 }
 archiveFrame.classList.remove('archive-hidden'); archiveFrame.inert=false;
 syncWorkspaceTheme();
 archiveFrame.contentWindow?.postMessage({type:'tingyu:visibility',visible:true}, 'tingyu-ui://archive');
}
async function openArchiveFeature(id){
 const feature=window.featureHubData.getFeature(id); if(!feature)return;
 const entryGeneration = ++featureEntryGeneration;
 if(state.recording||state.recordingPending){showError('请等待语音发送完成再离开聊天');return;}
 if(id==='contacts'||id==='new-contact')state.mobileChat=false;
 if(id==='call')state.callTab='contacts';
 if(id==='recents')state.callTab='recents';
 if(id==='dialpad')state.callTab='keypad';
 const targetHash = '#'+feature.route;
 if(location.hash === targetHash) renderRoute();
 else await new Promise(resolve => {
  const routed = () => { window.removeEventListener('hashchange',routed); resolve(); };
  window.addEventListener('hashchange',routed);
  location.hash=targetHash;
 });
 const expectedGeneration = routeGeneration;
 await window.pendingWorkspaceRender;
 if(entryGeneration !== featureEntryGeneration || location.hash !== targetHash || expectedGeneration !== routeGeneration)return;
 if(id==='persona'){
  if(state.currentConversation)openConversationEditor(state.currentConversation);
  else showMessage('先新建一位联系人');
 }
 if(id==='new-contact')document.querySelector('[aria-label="新建联系人"]')?.click();
 if(id==='memory'||id==='background'){
  // Settings render waits for local preferences before its fields exist.
  const focusSection=()=>{
   if(location.hash!=='#/settings')return true;
   const title=[...content.querySelectorAll('h2')].find(el=>el.textContent===(id==='memory'?'记忆':'背景'));
   if(!title)return false;
   title.closest('section').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
   return true;
  };
  if(!focusSection()){const observer=new MutationObserver(()=>{if(focusSection())observer.disconnect();});observer.observe(content,{childList:true,subtree:true});setTimeout(()=>observer.disconnect(),3000);}
 }
 if(['transcription','speech','models'].includes(id)){
  const kind=id==='transcription'?'stt':id==='speech'?'tts':'llm';
  const focusProvider=()=>{
   if(location.hash!=='#/providers')return true;
   const card=content.querySelector(`[data-kind="${kind}"]`);
   if(!card)return false;card.scrollIntoView({block:'start'});return true;
  };
  if(!focusProvider()){const observer=new MutationObserver(()=>{if(focusProvider())observer.disconnect();});observer.observe(content,{childList:true,subtree:true});setTimeout(()=>observer.disconnect(),3000);}
 }
}
window.addEventListener('message',event=>{
 if(!window.featureHubData.acceptsArchiveMessage(event,archiveFrame?.contentWindow))return;
 openArchiveFeature(event.data.feature).catch(error=>showError(error.message));
});
