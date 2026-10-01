const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync, statSync} = require('node:fs');
const {resolve} = require('node:path');
const vm = require('node:vm');

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];
const fileHandlers = script.slice(script.indexOf('function isHeicFile('), script.indexOf("dropZone.addEventListener('click'"));
function makeContext(overrides = {}) {
  const toasts = [], errors = [], revoked = [];
  const context = vm.createContext({
    Blob, window: {},
    document: {createElement: () => ({}), head: {appendChild: () => {}}},
    URL: {createObjectURL: () => 'blob:sample', revokeObjectURL: url => revoked.push(url)},
    showToast: text => toasts.push(text),
    console: {error: (...args) => errors.push(args)},
    ...overrides,
  });
  vm.runInContext(fileHandlers, context);
  return {context, toasts, errors, revoked};
}
function makeImportContext() {
  const result = makeContext({
    social: {MAX_PHOTOS:10}, exportBusy:false, mediaBusy:false, photos:[], activePhotoIndex:-1,
    currentPhoto:null, nextPhotoId:1, isVideo:false, hasContent:false, maskRequestId:0, maskDetectionPending:false,
    dropZone:{style:{}}, canvasWrap:{style:{}},
  });
  const {context:c} = result;
  c.saveActivePhotoMask = c.unloadVideo = c.updateSocialUI = c.renderPhotoStrip = c.startLoop = () => {};
  c.clearPhotos = () => {c.photos=[];c.currentPhoto=null;c.activePhotoIndex=-1;};
  c.createThumbnail = async () => 'blob:thumbnail';
  c.uploadPhoto = item => {c.currentPhoto=item;c.hasContent=true;};
  return result;
}
test('picker and both drop targets accept HEIC/HEIF even without a MIME type', () => {
  assert.match(html, /id="fileInput" accept="[^"]*\.heic,\.heif,image\/heic,image\/heif[^"]*" multiple/);
  assert.match(html, /JPG · PNG · HEIC · HEIF/);
  assert.match(script, /return isHeicFile\(file\) \|\| file\.type\.startsWith\('image\/'\)/);
  assert.match(script, /dropZone\.addEventListener\('drop',[^\n]*e\.stopPropagation\(\)/);
  assert.match(script, /handleFiles\(e\.dataTransfer\.files\)/);
  const {context} = makeContext();
  for (const file of [
    {name:'IMG_0001.HEIC',type:''}, {name:'IMG_0002.heif',type:'application/octet-stream'},
    {name:'mystery',type:'image/heic'}, {name:'burst',type:'image/heif-sequence'},
  ]) {
    assert.equal(context.isHeicFile(file),true,file.name);
    assert.equal(context.isPhotoFile(file),true,file.name);
    assert.equal(context.isVideoFile(file),false,file.name);
  }
  for (const file of [{name:'image.jpg',type:'image/jpeg'},{name:'fake.heic.jpg',type:'image/jpeg'}]) assert.equal(context.isHeicFile(file),false,file.name);
});
test('the decoder is bundled locally, lazy loaded, and has a CDN fallback', async () => {
  assert.ok(statSync(resolve(__dirname,'../vendor/heic2any.min.js')).size>100000);
  assert.match(readFileSync(resolve(__dirname,'../vendor/LICENSE.heic2any.md'),'utf8'),/MIT License/);
  const sources=[], decoder=async()=>new Blob(['image'],{type:'image/png'});
  const {context}=makeContext({document:{
    createElement:()=>({remove(){}}),
    head:{appendChild(element){
      sources.push(element.src);
      queueMicrotask(()=>{ if(sources.length===1) element.onerror(); else{context.window.heic2any=decoder;element.onload();} });
    }},
  }});
  assert.equal(await context.loadHeicDecoder(),decoder);
  assert.deepEqual(sources,['vendor/heic2any.min.js','https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js']);
  assert.equal(await context.loadHeicDecoder(),decoder); assert.equal(sources.length,2);
});
test('native image decoding releases its temporary object URL on both success and failure', async () => {
  const {context,revoked}=makeContext({Image:class{set src(_){this.onload();}}});
  const image=await context.loadImage(new Blob(['image'])); assert.ok(image); assert.deepEqual(revoked,['blob:sample']);
  context.Image=class{set src(_){this.onerror();}};
  await assert.rejects(context.loadImage(new Blob(['broken'])),/Could not decode/);
  assert.deepEqual(revoked,['blob:sample','blob:sample']);
});
test('a failed native HEIC decode converts to its first PNG frame and reuses the converted blob', async () => {
  const original={name:'portrait.HEIC',type:''}, png=new Blob(['PNG content'],{type:'image/png'}), shown=[];
  let conversions=0;
  const {context,toasts}=makeContext({window:{heic2any:async({blob,toType})=>{
    conversions++;assert.equal(blob,original);assert.equal(toType,'image/png');return [png];
  }}});
  context.loadImage=async blob=>{shown.push(blob);if(blob===original)throw new Error('Native unsupported');return {naturalWidth:1080,naturalHeight:1350};};
  const item={file:original,blob:original,converted:false};
  assert.equal((await context.decodePhoto(item)).naturalWidth,1080);
  assert.equal(item.blob,png); assert.equal(item.converted,true); assert.deepEqual(shown,[original,png]);
  await context.decodePhoto(item); assert.equal(conversions,1); assert.equal(shown.at(-1),png);
  assert.ok(toasts.some(t=>t.includes('Decoding HEIC')));
});
test('a stale photo / HEIC conversion cannot replace a newer import', async () => {
  const {context:c}=makeImportContext();
  let resolveOld;
  c.decodePhoto=item=>item.file.name==='old.heic'?new Promise(resolve=>{resolveOld=resolve;}):Promise.resolve({});
  const old=c.handleFiles([{name:'old.heic',type:''}]);
  await c.handleFiles([{name:'new.png',type:'image/png'}]);
  resolveOld({}); await old;
  assert.deepEqual(c.photos.map(p=>p.file.name),['new.png']); assert.equal(c.currentPhoto.file.name,'new.png'); assert.equal(c.mediaBusy,false);
});
test('corrupt HEIC photos reject cleanly, do not endlessly retry, and leave imports recoverable', async () => {
  const {context}=makeContext({window:{heic2any:async()=>{throw new Error('Invalid HEIC data');}}});
  context.loadImage=async()=>{throw new Error('Native unsupported');};
  await assert.rejects(context.decodePhoto({file:{name:'bad.heic',type:''},converted:false}),/Invalid HEIC data/);
  const {context:c,toasts}=makeImportContext(); c.decodePhoto=async()=>{throw new Error('Bad image');};
  await c.handleFiles([{name:'bad.heic',type:''}]);
  assert.equal(c.photos.length,0); assert.equal(c.mediaBusy,false); assert.match(toasts.at(-1),/Could not open/);
});
test('carousel imports enforce ten photos, append within capacity, and keep one shared edit', async () => {
  const {context:c,toasts}=makeImportContext(); c.decodePhoto=async()=>({});
  await c.handleFiles(Array.from({length:12},(_,i)=>({name:`photo-${i}.png`,type:'image/png'})));
  assert.equal(c.photos.length,10); assert.match(toasts.at(-1),/first 10 kept/);
  assert.ok(c.photos.every(p=>p.crop.x===0.5&&p.crop.y===0.5));
  await c.handleFiles([{name:'eleven.png',type:'image/png'}],{append:true}); assert.equal(c.photos.length,10);
  await c.handleFiles([{name:'one.png',type:'image/png'}]);
  const first=c.currentPhoto;
  await c.handleFiles([{name:'two.heic',type:''}],{append:true});
  assert.equal(c.photos.length,2); assert.equal(c.currentPhoto,first);
});
test('mixed photo/video selections and busy exports cannot destroy the current carousel', async () => {
  const {context:c,toasts}=makeImportContext(); c.decodePhoto=async()=>({});
  await c.handleFiles([{name:'existing.png',type:'image/png'}]); const first=c.currentPhoto;
  await c.handleFiles([{name:'photo.png',type:'image/png'},{name:'reel.mp4',type:'video/mp4'}]);
  assert.equal(c.currentPhoto,first); assert.match(toasts.at(-1),/one video at a time/);
  c.exportBusy=true; await c.handleFiles([{name:'other.png',type:'image/png'}]); assert.equal(c.currentPhoto,first);
});

test('an entirely failed replacement import preserves the existing carousel and selected photo', async () => {
  const {context:c,toasts}=makeImportContext(); c.decodePhoto=async()=>({});
  await c.handleFiles([{name:'keep.png',type:'image/png'}]); const selected=c.currentPhoto;
  c.decodePhoto=async()=>{throw new Error('Corrupt replacement');};
  await c.handleFiles([{name:'bad.heic',type:''}]);
  assert.equal(c.currentPhoto,selected); assert.equal(c.photos.length,1); assert.equal(c.hasContent,true);
  assert.equal(c.mediaBusy,false); assert.match(toasts.at(-1),/current media is unchanged/);
});
