const test = require('node:test');
const assert = require('node:assert/strict');
const { FEATURES, getFeature, acceptsArchiveMessage } = require('../desktop/app/feature-hub-data.js');
test('fourteen gallery panels have Chinese labels and implemented destinations', () => {
 assert.equal(FEATURES.length,14); assert.equal(new Set(FEATURES.map(f=>f.id)).size,14);
 for(const f of FEATURES){ assert.ok(['/conversation','/call','/favorites','/providers','/settings'].includes(f.route)); assert.match(f.label,/[\u4e00-\u9fff]/); assert.equal(getFeature(f.id),f); }
 assert.equal(getFeature('__proto__'),undefined);
});
test('archive messages require the mounted frame, trusted origin and known function',()=>{
 const frame={}; const event={source:frame,origin:'tingyu-ui://archive',data:{type:'tingyu:open',feature:'chat'}};
 assert.equal(acceptsArchiveMessage(event,frame),true);
 assert.equal(acceptsArchiveMessage({...event,source:{}},frame),false);
 assert.equal(acceptsArchiveMessage({...event,origin:'https://evil.example'},frame),false);
 assert.equal(acceptsArchiveMessage({...event,data:{type:'tingyu:open',feature:'delete-all'}},frame),false);
 assert.equal(acceptsArchiveMessage({...event,data:null},frame),false);
});
test('every original gallery replacement ships local media and a known native destination',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const archive=path.join(__dirname,'../desktop/app/archive'),context={window:{}};
 vm.runInNewContext(fs.readFileSync(path.join(archive,'assets/data/cms.tingyu.js'),'utf8'),context);
 assert.equal(context.window.CMS_DATA.projects.length,14);
 for(const project of context.window.CMS_DATA.projects){
  const feature=getFeature(project.perma);assert.ok(feature);
  assert.equal(project.projectURL,`tingyu:${feature.id}`);
  for(const resource of [project.videoURL,project.thumbnailURL]){
   assert.ok(!resource.includes('://'));
   assert.ok(fs.statSync(path.join(archive,resource)).size>1000,resource);
  }
 }
});
