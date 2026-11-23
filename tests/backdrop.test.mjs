import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../web/backdrop.js',import.meta.url),'utf8');
const {CallBackdrop,CALL_BACKDROP_SCENES,createGardenGeometry,decodeForestGeometry}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function environment(reduced=false){
 const events=new Map(),frames=new Map();let frame=0,draws=0;
 const listen=(name,fn)=>events.set(name,fn),unlisten=name=>events.delete(name);
 const media={matches:reduced,addEventListener:listen,removeEventListener:unlisten};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hardwareConcurrency:8,userAgent:'test'}});
 Object.assign(globalThis,{window:globalThis,innerWidth:1200,innerHeight:800,devicePixelRatio:2,matchMedia:()=>media,addEventListener:listen,removeEventListener:unlisten,requestAnimationFrame:fn=>{frames.set(++frame,fn);return frame;},cancelAnimationFrame:id=>frames.delete(id)});
 const gradient={addColorStop(){}};const ctx=new Proxy({fillRect(){draws++;},createRadialGradient:()=>gradient,createLinearGradient:()=>gradient},{get:(o,k)=>o[k]??(()=>{})});
 const canvas={clientWidth:1200,clientHeight:800,width:0,height:0,getContext:type=>type==='2d'?ctx:null,addEventListener:listen,removeEventListener:unlisten,getBoundingClientRect:()=>({left:0,top:0,width:1200,height:800})};
 globalThis.document={hidden:false,addEventListener:listen,removeEventListener:unlisten};
 return {canvas,media,events,frames,get draws(){return draws;}};
}
test('garden is reproducible and has three-dimensional bounded organic forms',()=>{
 const a=createGardenGeometry(2000,'spring-garden'),b=createGardenGeometry(2000,'spring-garden');
 assert.deepEqual(a,b);assert.equal(a.positions.length,6000);assert.equal(a.colors.length,6000);
 assert.ok([...a.positions,...a.colors,...a.data].every(Number.isFinite));
 assert.ok(Math.max(...a.positions.filter((_,i)=>i%3===1))>.65);
 assert.ok(Math.max(...a.positions.filter((_,i)=>i%3===2))>.5);
});
test('saved cloud patterns do not replace rain or fog scene geometry',()=>{
 const pattern=[{x:0,y:.5,lum:1,color:[1,1,1]}];
 for(const scene of ['particle-rain','aurora-fog']){
  const plain=createGardenGeometry(600,scene);
  const patterned=createGardenGeometry(600,scene,'',undefined,pattern);
  assert.ok(patterned.positions.every((v,i)=>v===plain.positions[i]),scene);
 }
});
test('all existing scene IDs remain supported, and settings produce finite geometry',()=>{
 const env=environment();const bg=new CallBackdrop(env.canvas);bg.mount();
 for(const scene of ['particle-rain','point-cloud','aurora-fog','spring-garden']){assert.ok(CALL_BACKDROP_SCENES.some(x=>x.id===scene));bg.setScene(scene);assert.equal(bg.scene,scene);}
 bg.setHue(210);bg.setDensity(2.2);bg.setShape('tree');bg.setFogColors(['#123456','invalid']);bg.setFluid(false);
 assert.ok(bg.geometry.positions.length<=65536*3);assert.ok([...bg.geometry.colors].every(Number.isFinite));
 bg.setScene('invalid');assert.equal(bg.scene,'spring-garden');bg.destroy();
 assert.equal(env.frames.size,0);assert.equal(env.events.size,0);
});
test('packed original forest has finite positions and preserved natural RGB colors',async()=>{
 const bytes=await readFile(new URL('../web/assets/spring-forest.bin',import.meta.url));const forest=decodeForestGeometry(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 assert.ok(forest.count>=65536 && forest.count<=262144);assert.ok([...forest.positions,...forest.colors].every(Number.isFinite));assert.ok(forest.colors.every(c=>c>=0&&c<=1));
 assert.throws(()=>decodeForestGeometry(new ArrayBuffer(40)),/Invalid forest/);
 const env=environment(),bg=new CallBackdrop(env.canvas);bg.forest=forest;bg.mount();assert.equal(bg.geometry.forest,true);bg.setHue(170);assert.ok(bg.geometry.colors.every(Number.isFinite));bg.destroy();
});
test('reduced motion renders immediately and settings redraw without scheduling motion',()=>{
 const env=environment(true);const bg=new CallBackdrop(env.canvas);bg.mount();const first=env.draws;
 bg.setHue(100);bg.setScene('aurora-fog');bg.setFogColors('#AABBCC');
 assert.ok(env.draws>first);assert.equal(env.frames.size,0);
 env.media.matches=false;env.events.get('change')({matches:false});assert.equal(env.frames.size,1);
 document.hidden=true;env.events.get('visibilitychange')();assert.equal(env.frames.size,0);
 document.hidden=false;env.events.get('visibilitychange')();assert.equal(env.frames.size,1);
 bg.destroy();assert.equal(env.events.size,0);
});
test('first pointer event seeds position without a velocity burst and fluid-off clears impulse',()=>{
 const env=environment();const bg=new CallBackdrop(env.canvas);bg.mount();bg.handlePointer({clientX:600,clientY:400});
 assert.equal(bg.pointer.vx,0);assert.equal(bg.pointer.vy,0);
 bg.handlePointer({clientX:660,clientY:430});assert.ok(bg.pointer.vx>0);bg.setFluid(false);assert.equal(bg.pointer.vx,0);
 bg.destroy();
});
test('an older pattern load cannot overwrite clearing the pattern or resurrect a destroyed scene',async()=>{
 const env=environment(),pending=[];globalThis.Image=class{set src(value){pending.push(this);}};
 const bg=new CallBackdrop(env.canvas);bg.mount();bg.mount();assert.equal(env.frames.size,1);
 const first=bg.setPattern('data:image/png;base64,old');await bg.setPattern('');pending[0].onload();await first;
 assert.equal(bg.pattern,'');assert.equal(bg.patternPoints,null);
 const second=bg.setPattern('data:image/png;base64,later');bg.destroy();pending[1].onload();await second;
 assert.equal(bg.geometry,null);assert.equal(bg.patternPoints,null);assert.equal(env.frames.size,0);
});
test('a shader compilation failure switches the visible canvas to the 2D renderer',()=>{
 const env=environment(),old=env.canvas,originalGet=old.getContext;let replaced=false;
 const replacement={...old,getContext:originalGet};old.cloneNode=()=>replacement;old.replaceWith=()=>{replaced=true;};
 const gl={createProgram:()=>({}),createShader:()=>({}),shaderSource(){},compileShader(){},getShaderParameter:()=>false,getShaderInfoLog:()=> 'test unsupported shader',deleteProgram(){},deleteShader(){}};
 old.getContext=type=>type==='webgl'?gl:originalGet(type);
 const bg=new CallBackdrop(old);bg.mount();assert.equal(bg.gl,null);assert.equal(bg.canvas,replacement);assert.equal(replaced,true);assert.ok(env.draws>0);assert.match(bg.gpuError,/unsupported shader/);bg.destroy();
});
