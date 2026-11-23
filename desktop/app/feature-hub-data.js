(function(root){
 'use strict';
 const FEATURES=Object.freeze([
 ['chat','Chat','聊天','/conversation'],['call','Voice','语音通话','/call'],['contacts','Contacts','联系人','/conversation'],['favorites','Saved','我的收藏','/favorites'],['models','Models','对话模型','/providers'],['settings','Settings','偏好设置','/settings'],['new-contact','New Contact','新建联系人','/conversation'],['recents','Recents','通话记录','/call'],['dialpad','Dialpad','拨号键盘','/call'],['transcription','Transcription','语音识别','/providers'],['speech','Speech','语音合成','/providers'],['persona','Persona','联系人设','/conversation'],['background','Background','背景外观','/settings'],['memory','Memory','对话记忆','/settings']
 ].map(([id,title,label,route])=>Object.freeze({id,title,label,route})));
 function getFeature(id){return FEATURES.find(f=>f.id===id);}
 function acceptsArchiveMessage(event,frame){return event.source===frame&&event.origin==='tingyu-ui://archive'&&event.data?.type==='tingyu:open'&&!!getFeature(event.data.feature);}
 const api={FEATURES,getFeature,acceptsArchiveMessage};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.featureHubData=api;
})(typeof window==='object'?window:globalThis);
