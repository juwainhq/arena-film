const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const vm = require('node:vm');

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];
const styles = html.split('<style>')[1].split('</style>')[0];

test('the existing upload landing routes image and video files without a reload', () => {
  assert.match(html, /id="dropZone"/);
  assert.match(html, /READY FOR AN IMAGE/);
  assert.match(html, /id="fileInput" accept="image\/\*[^\"]*video\/\*" multiple hidden/);
  assert.match(script, /function handleFiles\(fileList/);
  assert.match(script, /const images=files\.filter\(isPhotoFile\), videos=files\.filter\(isVideoFile\)/);
  assert.match(script, /isVideo=false; hasContent=true; currentPhoto=item/);
  assert.match(script, /isVideo=true; hasContent=true; videoCrop=/);
  assert.doesNotMatch(script, /location\.reload\(/);
});

test('workspace state shows subtle top-bar mode and only exposes video controls in video mode', () => {
  const fn = script.match(/function updateWorkspaceUI\(\)\{[\s\S]*?\n\}/)[0];
  const ids=['app','workspacePill','videoPlaybackControls','editorTimeline','grainSpeedRow','backToDropBtn','exportPanelTitle','frameFormatLabel','frameQualityLabel'];
  const elements = Object.fromEntries(ids.map(id => [id, {dataset:{},hidden:false,disabled:false,textContent:''}]));
  const state = vm.createContext({hasContent:true,isVideo:false,mediaBusy:false,exportBusy:false,$:id=>elements[id],updateCaptionOverlay(){}});
  vm.runInContext(`${fn}\nthis.update=updateWorkspaceUI;`,state);
  state.update();
  assert.equal(elements.app.dataset.workspace,'photo');
  assert.equal(elements.workspacePill.hidden,false);
  assert.equal(elements.workspacePill.textContent,'Photo mode');
  assert.equal(elements.videoPlaybackControls.hidden,true);
  assert.equal(elements.editorTimeline.hidden,true);
  assert.equal(elements.grainSpeedRow.hidden,true);
  state.isVideo=true; state.update();
  assert.equal(elements.workspacePill.textContent,'Video mode');
  assert.equal(elements.videoPlaybackControls.hidden,false);
  assert.equal(elements.editorTimeline.hidden,false);
  assert.equal(elements.grainSpeedRow.hidden,false);
  assert.equal(elements.backToDropBtn.disabled,false);
  state.hasContent=false; state.update();
  assert.equal(elements.app.dataset.workspace,'empty');
  assert.equal(elements.workspacePill.hidden,true);
  assert.equal(elements.videoPlaybackControls.hidden,true);
  assert.equal(elements.editorTimeline.hidden,true);
  assert.equal(elements.grainSpeedRow.hidden,true);
  assert.equal(elements.backToDropBtn.disabled,true);
});

test('video workspace uses a left effects rail, centered preview and bottom filmstrip timeline', () => {
  assert.match(styles, /#app\[data-workspace="video"\] #content \{ display: grid; grid-template-columns: minmax\(265px,315px\) minmax\(0,1fr\); grid-template-rows: minmax\(0,1fr\) 148px;/);
  assert.match(styles, /#app\[data-workspace="video"\] #sidebar \{ grid-column: 1; grid-row: 1 \/ 3;/);
  assert.match(styles, /#app\[data-workspace="video"\] #editorTimeline \{ grid-column: 2; grid-row: 2;/);
  assert.match(html, /id="videoPlaybackControls" hidden/);
  for(const id of ['videoPlayBtn','videoTime','videoSeek','videoVolume','videoMuteBtn','videoLoopToggle','videoSpeed']) assert.match(html,new RegExp(`id="${id}"`));
  for(const speed of ['0.25','0.5','1','1.5','2']) assert.match(html,new RegExp(`<option value="${speed}"`));
  assert.match(html, /id="timelineFilmstrip"/);
  assert.match(html, /id="timelineSelection"/);
  assert.match(html, /id="trimStartHandle"[\s\S]*?id="trimEndHandle"/);
  assert.match(html, /id="timelinePlayhead"/);
  assert.match(html, /id="trimRangeReadout">Trimmed:/);
  assert.match(script, /function renderVideoFilmstrip\(token\)/);
  assert.match(script, /function updateTimelineVisuals\(\)/);
  assert.match(script, /function timeAtTimelinePointer\(e\)/);
  assert.match(script, /timelineTrack'\)\.addEventListener\('pointermove'/);
  assert.match(script, /if\(e\.code==='Space'\)[\s\S]*?isVideo\?toggleVideoPlayback\(\):toggleBeforeAfter\(\)/);
});

test('video sidebar filters to the requested effects and provides basic per-clip captions', () => {
  assert.match(html, /id="sidebarCollapseToggle"/);
  assert.match(script, /sidebarCollapseToggle'\)\.addEventListener\('click'/);
  for(const group of ['color','bloom','hallation','grain','sharpen']) assert.match(html,new RegExp(`data-group="${group}"`));
  assert.match(styles, /#app\[data-workspace="video"\] #effectsWrap \.effectGroup\[data-group="dither"\] \{ display: none !important; \}/);
  assert.match(styles, /#app\[data-workspace="video"\] #sidebarControls > #videoCaptionPanel,[\s\S]*?#videoExportPanel \{ display: flex !important; \}/);
  assert.match(html, /Text &amp; Captions/);
  for(const id of ['captionText','captionFont','captionSize','captionColor','captionEnabled','captionOverlay','captionKeyframeBtn','captionKeyframeMarkers']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(script, /function drawVideoCaption\(ctx,output/);
  assert.match(script, /if\(isVideo\) drawVideoCaption\(ctx,output,o,position\)/);
  assert.match(script, /captionOverlay'\)\.addEventListener\('pointermove'/);
  assert.match(script, /function captionPositionAt\(time\)/);
  assert.match(script, /function renderCaptionKeyframeMarkers\(\)/);
  assert.match(html, /Show on this clip/);
});

test('video export settings include size, container, quality, range, warning, ETA and ffmpeg progress', () => {
  for(const id of ['videoResolution','videoContainer','videoQuality','videoExportRange','processVideoBtn','longVideoWarning','progressEta']) assert.match(html,new RegExp(`id="${id}"`));
  for(const value of ['original','1080','720','480']) assert.match(html,new RegExp(`<option value="${value}"`));
  assert.match(html, /For best performance, trim to under 60s before exporting/);
  assert.match(script, /range==='full'\?\{start:0,end:videoEl\.duration\}:social\.trimRange/);
  assert.match(script, /function videoOutputSize\(options,position,resolution\)/);
  assert.match(script, /social\.videoArgs\(\{fps,duration:count\/fps,container,quality,audio:false,output:segment\}\)/);
  assert.match(script, /ff\.on\('progress'/);
  assert.match(script, /setInterval\(updateExportEta,1000\)/);
  assert.match(script, /downloadBlob\(out,/);
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
