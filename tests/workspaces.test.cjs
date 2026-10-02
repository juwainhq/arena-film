const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const vm = require('node:vm');

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];
const styles = html.split('<style>')[1].split('</style>')[0];
const timeline = readFileSync(resolve(__dirname, '../timeline-module.js'), 'utf8');

test('the existing upload landing routes image and video files without a reload', () => {
  assert.match(html, /id="dropZone"/);
  assert.match(html, /READY FOR AN IMAGE/);
  assert.match(html, /id="fileInput" accept="image\/\*[^\"]*video\/\*" multiple hidden/);
  assert.match(script, /function handleFiles\(fileList/);
  assert.match(script, /if\(document\.readyState==='loading'\)document\.addEventListener\('DOMContentLoaded',startFilmLab,\{once:true\}\)/);
  assert.ok(html.indexOf('<canvas id="glCanvas"')<html.indexOf("const canvas = document.getElementById('glCanvas')"), 'the persistent canvas exists before WebGL initialization');
  assert.match(script, /fileInput\.addEventListener\('change'/);
  assert.match(script, /dropZone\.addEventListener\('drop'/);
  assert.match(script, /const images=files\.filter\(isPhotoFile\), videos=files\.filter\(isVideoFile\)/);
  assert.match(script, /isVideo=false; hasContent=true; currentPhoto=item/);
  assert.match(script, /isVideo=true; hasContent=true; setWorkspaceMode\('video'\); videoCrop=/);
  const replacement=script.match(/if\(replacing\)\{([\s\S]*?)\n        \}/)[1];
  assert.doesNotMatch(replacement, /isVideo=false/); // uploadPhoto must see Video Mode to restore the saved photo-export options
  assert.match(script, /hasContent=false; if\(animId!==null\)[\s\S]*?setWorkspaceMode\('empty'\)/);
  assert.doesNotMatch(script, /location\.reload\(/);
});

test('workspace state shows subtle top-bar mode and only exposes video controls in video mode', () => {
  const fn = script.match(/function updateWorkspaceUI\(\)\{[\s\S]*?\n\}/)[0];
  const ids=['app','workspacePill','videoPlaybackControls','editorTimeline','grainSpeedRow','backToDropBtn','exportPanelTitle','frameFormatLabel','frameQualityLabel'];
  const elements = Object.fromEntries(ids.map(id => [id, {dataset:{},hidden:false,disabled:false,textContent:''}]));
  const state = vm.createContext({appState:{mode:'empty'},document:{body:{dataset:{}}},hasContent:true,isVideo:false,mediaBusy:false,exportBusy:false,$:id=>elements[id],updateCaptionOverlay(){}});
  vm.runInContext(`${fn}\nthis.update=updateWorkspaceUI;`,state);
  state.update();
  assert.equal(elements.app.dataset.workspace,'photo');
  assert.equal(state.appState.mode,'photo');
  assert.equal(state.document.body.dataset.mode,'photo');
  assert.equal(elements.workspacePill.hidden,false);
  assert.equal(elements.workspacePill.textContent,'Photo mode');
  assert.equal(elements.videoPlaybackControls.hidden,true);
  assert.equal(elements.editorTimeline.hidden,true);
  assert.equal(elements.grainSpeedRow.hidden,true);
  state.isVideo=true; state.update();
  assert.equal(elements.workspacePill.textContent,'Video mode');
  assert.equal(state.appState.mode,'video');
  assert.equal(state.document.body.dataset.mode,'video');
  assert.equal(elements.videoPlaybackControls.hidden,false);
  assert.equal(elements.editorTimeline.hidden,false);
  assert.equal(elements.grainSpeedRow.hidden,false);
  assert.equal(elements.backToDropBtn.disabled,false);
  state.hasContent=false; state.update();
  assert.equal(elements.app.dataset.workspace,'empty');
  assert.equal(state.appState.mode,'empty');
  assert.equal(state.document.body.dataset.mode,'empty');
  assert.equal(elements.workspacePill.hidden,true);
  assert.equal(elements.videoPlaybackControls.hidden,true);
  assert.equal(elements.editorTimeline.hidden,true);
  assert.equal(elements.grainSpeedRow.hidden,true);
  assert.equal(elements.backToDropBtn.disabled,true);
});

test('video workspace places the canvas and playback above a full-width timeline with the sidebar on the right', () => {
  assert.match(styles, /#app\[data-workspace="video"\] #content \{ display: grid; grid-template-columns: minmax\(0,1fr\) 390px; grid-template-rows: minmax\(0,1fr\) 120px;/);
  assert.match(styles, /#app\[data-workspace="video"\] #sidebar \{ grid-column: 2; grid-row: 1 \/ 3;/);
  assert.match(styles, /#app\[data-workspace="video"\] #editorTimeline \{ grid-column: 1; grid-row: 2;/);
  assert.match(styles, /\.timelineHeader \{ display: flex; align-items: center; \}/);
  assert.match(styles, /#timelineTrack \{ position: relative; display: block; flex: 1 1 auto;/);
  assert.match(styles, /#timelineFilmstrip img \{ flex: 1 1 0;[^}]*object-fit: cover/);
  assert.match(styles, /\.timelineKeyframeMarker \{ position: absolute/);
  assert.match(styles, /#app\[data-workspace="video"\] #sidebarViews > \.sidebarPanel\.active #videoExportPanel \{ display: flex; \}/);
  assert.match(html, /id="videoPlaybackControls" class="video-only" hidden/);
  for(const id of ['videoSkipStart','videoPlayBtn','videoSkipEnd','videoTime','videoSeek','videoVolume','videoMuteBtn','videoLoopToggle','videoSpeed']) assert.match(html,new RegExp(`id="${id}"`));
  for(const speed of ['0.5','1','1.5','2']) assert.match(html,new RegExp(`data-playback-rate="${speed}"`));
  assert.match(html, /id="timelineFilmstrip"/);
  assert.match(html, /id="audioWaveform"/);
  assert.match(html, /id="timelineSelection"/);
  assert.match(html, /id="trimStartHandle"[\s\S]*?id="trimEndHandle"/);
  assert.match(html, /id="timelinePlayhead"/);
  assert.match(html, /id="timelineInTime"[\s\S]*?id="timelinePlayheadTime"[\s\S]*?id="timelineOutTime"/);
  assert.match(script, /function renderVideoFilmstrip\(token\)/);
  assert.match(script, /async function renderAudioWaveform\(file,token\)/);
  assert.match(script, /function updateTimelineVisuals\(\)/);
  assert.match(script, /function timeAtTimelinePointer\(e\)/);
  assert.match(script, /timelineTrack'\)\.addEventListener\('pointermove'/);
  assert.match(script, /if\(e\.code==='Space'\)[\s\S]*?isVideo\?toggleVideoPlayback\(\):toggleBeforeAfter\(\)/);
  assert.match(script, /if\(videoEl\.currentTime>=videoTrim\.end\)\{[\s\S]*?videoLoopToggle'\)\.getAttribute\('aria-pressed'\)==='true'[\s\S]*?videoEl\.pause\(\);videoEl\.currentTime=videoTrim\.end/);
});

test('photo and video panels switch with appState.mode while the existing DOM stays mounted', () => {
  assert.match(script, /const \$ = id => document\.getElementById\(id\)/);
  assert.match(script, /const appState=\{mode:'empty'\}/);
  assert.match(script, /function setWorkspaceMode\(mode\)[\s\S]*?appState\.mode=mode;[\s\S]*?document\.body\.dataset\.mode=mode/);
  assert.match(script, /function updateWorkspaceUI\(\)[\s\S]*?document\.body\.dataset\.mode=workspace/);
  assert.match(html, /<body data-mode="empty">/);
  assert.match(styles, /body\[data-mode="photo"\] \.video-only \{ display: none !important; \}/);
  assert.match(styles, /body\[data-mode="video"\] \.photo-only \{ display: none !important; \}/);
  assert.match(styles, /body\[data-mode="empty"\] \.photo-only,body\[data-mode="empty"\] \.video-only \{ display: none !important; \}/);
  for(const [id,modeClass] of [['exportPanel','photo-only'],['actions','photo-only'],['carouselStrip','photo-only'],['videoPlaybackControls','video-only'],['videoCaptionPanel','video-only'],['videoTrimPanel','video-only'],['videoExportPanel','video-only'],['editorTimeline','video-only'],['grainSpeedRow','video-only'],['captionOverlay','video-only']]){
    const root=html.match(new RegExp(`<[^>]+id="${id}"[^>]*>`))[0];
    assert.match(root,new RegExp(`class="[^"]*${modeClass}`),id);
  }
  for(const text of ['id="glCanvas"','id="videoEl"','id="fileInput"','id="editorTimeline"']) assert.ok(html.includes(text),`${text} remains in the source DOM`);
  assert.doesNotMatch(script, /DocumentFragment|parkWorkspaceNode|detachedWorkspaceElements/);
  assert.match(script, /const slider=row\.querySelector\('input\[type="range"\]'\);\s*if\(!slider\)return/);
  assert.match(script, /const group=groupRoot\?\.querySelector\('\.effectTitle'\)\?\.textContent/);
  assert.match(script, /function initializeWorkspaceModes\(\)\{ setWorkspaceMode\('empty'\); \}/);
  assert.match(script, /uploadPhoto\(item,img,resetView=true\)[\s\S]*?setWorkspaceMode\('photo'\)/);
  assert.match(script, /isVideo=true; hasContent=true; setWorkspaceMode\('video'\)/);
  assert.match(script, /if\(typeof isVideo!==\x27undefined\x27&&isVideo\)strength=0/);
  assert.doesNotMatch(styles, /#effectsWrap \.effectGroup\[data-group="dither"\] \{ display: none !important;/);
  assert.match(html, /Text &amp; Captions/);
  for(const id of ['captionText','captionFont','captionSize','captionColor','captionEnabled','captionOverlay','captionKeyframeBtn','captionKeyframeMarkers']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(script, /function drawVideoCaption\(ctx,output/);
  assert.match(script, /if\(isVideo\) drawVideoCaption\(ctx,output,o,position\)/);
  assert.match(script, /captionOverlay'\)\.addEventListener\('pointermove'/);
  assert.match(script, /function captionPositionAt\(time\)/);
  assert.match(script, /function renderCaptionKeyframeMarkers\(\)/);
  assert.match(html, /Show on this clip/);
});

test('video timeline is an additive module with trim, cut, history, zoom, waveform and transition controls', () => {
  assert.match(html, /<section id="timeline-module" class="video-only"/);
  for(const id of ['timeline-skip-start','timeline-play','timeline-skip-end','timeline-timecode','timeline-cut','timeline-delete','timeline-undo','timeline-redo','timeline-zoom-minus','timeline-zoom-plus','timeline-ruler','timeline-clips','timeline-audio','timeline-playhead']) assert.match(html,new RegExp(`id="${id}"`));
  for(const transition of ['none','dissolve','fade-to-black','fade-from-black']) assert.match(html,new RegExp(`data-transition="${transition}"`));
  assert.match(html, /src="\.\/timeline-module\.js"/);
  assert.match(timeline, /function splitAt\(time\)/);
  assert.match(timeline, /No clip loaded/);
  assert.match(styles, /body\[data-mode="empty"\] #app #content #timeline-module:not\(\[hidden\]\)/);
  assert.match(timeline, /function getExportPlan\(\)/);
  assert.match(timeline, /function mapOutputTime\(time, plan = getExportPlan\(\)\)/);
  assert.match(timeline, /addEventListener\('timeupdate', onPlaybackTime\)/);
  assert.match(timeline, /video\(\)\.currentTime\s*=/);
  assert.doesNotMatch(timeline, /video\(\)\.(?:play|pause|volume|muted|playbackRate)\s*=/);
  assert.match(script, /window\.filmLabTimelineBridge=/);
  assert.equal((html.match(/id="glCanvas"/g)||[]).length,1,'the existing WebGL canvas remains mounted exactly once');
  assert.match(styles, /#app\[data-workspace="video"\] #timeline-module \{ grid-column: 1; grid-row: 2/);
  assert.match(styles, /body\[data-mode="photo"\] #app #mainArea \.video-only/);
  assert.match(styles, /#exportProgress\.show \{ position: fixed; top: 50%/);
});

test('timeline output mapping covers concatenated cuts, dissolves, and black fades', () => {
  const mapper=timeline.match(/function mapOutputTime\(time, plan = getExportPlan\(\)\) \{[\s\S]*?\n  \}/)[0];
  const state=vm.createContext({getExportPlan:()=>({}),clamp:(n,min,max)=>Math.max(min,Math.min(max,n))});
  vm.runInContext(`${mapper}\nthis.map=mapOutputTime;`,state);
  const dissolve={transitionSeconds:.5,segments:[{start:0,end:2,transition:'dissolve'},{start:5,end:7,transition:'none'}]};
  assert.deepEqual(JSON.parse(JSON.stringify(state.map(1.75,dissolve))),{sourceTime:1.75,blendTime:5.25,blend:.5});
  const fadeOut={transitionSeconds:.5,segments:[{start:0,end:2,transition:'fade-to-black'},{start:4,end:5,transition:'none'}]};
  assert.deepEqual(JSON.parse(JSON.stringify(state.map(1.75,fadeOut))),{sourceTime:1.75,blackAlpha:.5});
  const fadeIn={transitionSeconds:.5,segments:[{start:0,end:2,transition:'fade-from-black'},{start:3,end:5,transition:'none'}]};
  assert.deepEqual(JSON.parse(JSON.stringify(state.map(2.25,fadeIn))),{sourceTime:3.25,blackAlpha:.5});
});

test('FFmpeg stays dormant until video upload and export progress opens only on export', () => {
  const upload=script.match(/async function handleVideoFile\(file\)\{[\s\S]*?\n\}/)[0];
  assert.match(upload, /loadFFmpeg\(\)\.catch/);
  assert.match(script, /ff=await loadFFmpeg\(\)/);
  assert.doesNotMatch(script, /loadFFmpeg\(\)\.catch\(error=>console\.warn\('Video encoder preload failed/);
  assert.match(script, /progressWrap\.classList\.add\('show'\)/);
  assert.match(html, /id="exportProgress" role="dialog" aria-modal="true"/);
});

test('video export UI exposes only trimmed output, requested sizes, formats and quality with live encoding status', () => {
  for(const id of ['videoResolution','videoContainer','videoQuality','videoExportRange','processVideoBtn','longVideoWarning','progressEta']) assert.match(html,new RegExp(`id="${id}"`));
  for(const value of ['original','1080','720']) assert.match(html,new RegExp(`<option value="${value}"`));
  assert.doesNotMatch(html, /<option value="480">480p/);
  assert.doesNotMatch(html, /<option value="full">Full video/);
  assert.match(html, /id="videoExportRange" value="trimmed"/);
  const exportPanel=html.match(/<section id="videoExportPanel"[\s\S]*?<\/section>/)[0];
  assert.ok(exportPanel.indexOf('id="videoResolution"')<exportPanel.indexOf('<details'), 'resolution stays visible without expanding More video options');
  assert.match(exportPanel, /data-video-format="mp4"[\s\S]*?data-video-quality="high"[\s\S]*?id="videoResolution"/);
  assert.match(html, /id="processVideoBtn"[^>]*>⤓ Export Video/);
  assert.match(html, /Download ready/);
  assert.match(script, /const range='trimmed';[\s\S]*?social\.trimRange\(videoEl\.duration,videoTrim\.start,videoTrim\.end\)/);
  assert.match(script, /function videoOutputSize\(options,position,resolution\)/);
  assert.match(script, /social\.videoArgs\(\{fps,duration:count\/fps,container,quality,audio:false,output:segment\}\)/);
  assert.match(script, /ff\.on\('progress'/);
  assert.match(script, /setInterval\(updateExportEta,1000\)/);
  assert.match(script, /progressText\.textContent=`Encoding… \$\{pct\}%`/);
  assert.match(script, /downloadBlob\(out,filename\)/);
  assert.match(script, /Download started automatically/);
});

test('caption position keyframes interpolate across the clip and video output presets retain aspect ratio', () => {
  const caption=script.match(/function captionPositionAt\(time\)\{[\s\S]*?\n\}/)[0];
  const size=script.match(/function videoOutputSize\(options,position,resolution\)\{[\s\S]*?\n\}/)[0];
  const state=vm.createContext({captionKeyframes:[{time:0,position:{x:.2,y:.4}},{time:10,position:{x:.8,y:.6}}],captionPosition:{x:.5,y:.82}});
  vm.runInContext(`${caption}\nthis.at=captionPositionAt;`,state);
  assert.deepEqual(JSON.parse(JSON.stringify(state.at(5))),{x:.5,y:.5});
  const dimensions=vm.createContext({canvas:{width:1920,height:1080},social:{cropRatio:()=>16/9,cropRect:(w,h)=>({width:w,height:h})}});
  vm.runInContext(`${size}\nthis.size=videoOutputSize;`,dimensions);
  assert.deepEqual(JSON.parse(JSON.stringify(dimensions.size({}, {}, '720'))),{width:1280,height:720});
  assert.deepEqual(JSON.parse(JSON.stringify(dimensions.size({}, {}, 'original'))),{width:1920,height:1080});
});

test('a video can be dropped directly on the canvas and Back still returns to the existing drop zone', () => {
  assert.match(script, /canvasWrap\.addEventListener\('drop',e=>\{[\s\S]*?handleFiles\(e\.dataTransfer\.files\)/);
  const fn = script.match(/function backToDropZone\(\)\{[\s\S]*?\n\}/)[0];
  const calls=[];
  const elements={captionEnabled:{checked:true},captionText:{value:'A title'},processVideoBtn:{style:{display:'flex'}}};
  const state=vm.createContext({
    mediaBusy:false,exportBusy:false,fileLoadId:8,animId:12,isVideo:true,hasContent:true,
    currentPhoto:{},activePhotoIndex:0,showOriginal:true,splitPreview:true,cropEditing:true,maskPaintMode:'protect',captionPosition:{x:.2,y:.2},
    cancelAnimationFrame:id=>calls.push(['cancel',id]),unloadVideo:()=>calls.push(['unload']),clearPhotos:()=>calls.push(['clearPhotos']),
    beforeLabel:{classList:{remove:name=>calls.push(['label',name])}},clearSubjectMask:flag=>calls.push(['clearMask',flag]),renderCaptionKeyframeMarkers:()=>calls.push(['keyframes']),
    dropZone:{style:{}},canvasWrap:{style:{}},$:id=>elements[id],renderPhotoStrip:()=>calls.push(['strip']),updateSocialUI:()=>calls.push(['ui']),
  });
  vm.runInContext(`${fn}\nthis.back=backToDropZone;`,state); state.back();
  assert.equal(state.fileLoadId,9); assert.equal(state.animId,null); assert.equal(state.isVideo,false); assert.equal(state.hasContent,false);
  assert.equal(state.showOriginal,false); assert.equal(state.splitPreview,false); assert.equal(state.cropEditing,false);
  assert.equal(elements.captionEnabled.checked,false); assert.equal(elements.captionText.value,'');
  assert.equal(state.dropZone.style.display,'flex'); assert.equal(state.canvasWrap.style.display,'none');
  assert.equal(elements.processVideoBtn.style.display,'none');
  assert.ok(calls.some(c=>c[0]==='unload')); assert.ok(calls.some(c=>c[0]==='clearMask'&&c[1]===true));
});
