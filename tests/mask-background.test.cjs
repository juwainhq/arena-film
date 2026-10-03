const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];
const styles = html.split('<style>')[1].split('</style>')[0];
const composite = script.match(/const fsComposite=`([\s\S]*?)`;/)[1];

test('Mask & Background is a collapsible photo-only sidebar tab between Adjust and Export', () => {
  const adjust = html.indexOf('id="adjustTab"');
  const mask = html.indexOf('id="maskTab"');
  const exportTab = html.indexOf('id="exportTab"');
  assert.ok(adjust < mask && mask < exportTab);
  assert.match(html, /class="sidebarTab photo-only" id="maskTab"[^>]*data-tab="mask"/);
  assert.match(html, /class="sidebarPanel photo-only" id="maskPanel" data-panel="mask"/);
  assert.match(html, /<details class="maskBackgroundDetails" id="maskBackgroundDetails" open>/);
  assert.match(html, /body\[data-mode="video"\] \.photo-only \{ display: none !important; \}/);
  assert.match(script, /if\(name==='mask'&&appState\.mode!=='photo'\)return/);
  assert.match(script, /if\(name==='mask'\)loadMaskBgModelOnOpen\(\)/);
  assert.match(styles, /\.maskBackgroundDetails > summary/);
});

test('the feature exposes automatic removal, magic select, paint/erase, refinement, and five background types', () => {
  for (const id of ['autoRemoveBackgroundBtn','magicSelectBtn','maskBgPaintBtn','maskBgEraseBtn','maskBgFeather','maskBgExpand','maskBgInvert','applyMaskBackgroundBtn']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  for (const mode of ['transparent','color','blur','image','gradient']) {
    assert.match(html, new RegExp(`name="maskBgMode" value="${mode}"`), mode);
  }
  assert.match(script, /function magicSelectMask\(point\)/);
  assert.match(script, /function beginMaskBgStroke\(event\)/);
  assert.match(script, /function autoRemoveMaskBackground\(\)/);
});

test('masking composes after the existing color grade and preserves alpha for transparent PNG output', () => {
  for (const uniform of ['u_maskBackground','u_backgroundImage','u_maskEnabled','u_backgroundMode','u_maskFeatherPixels','u_maskExpandPixels','u_maskInvert']) {
    assert.match(composite, new RegExp(`\\b${uniform}\\b`), uniform);
  }
  assert.match(composite, /if\(u_maskEnabled==1\)/);
  assert.match(composite, /u_backgroundMode==1\)\{ outColor=vec4\(clamp\(col,0\.0,1\.0\),base\.a\*keepAlpha\); return; \}/);
  assert.match(composite, /outColor=vec4\(mix\(background,clamp\(col,0\.0,1\.0\),keepAlpha\),1\.0\)/);
  assert.match(script, /const maskBgEnabled=appState\.mode==='photo' && !isVideo && !!maskBgActive/);
  assert.match(script, /if\(!needsTransparentMaskPng\(\)\|\|exportOptions\.type==='png'\)return false/);
  assert.match(script, /hasTransparentMask\?\'png\':exportOptions\.type/);
});

test('portrait segmentation remains local, lazy, shared with MediaPipe, and photo-scoped', () => {
  assert.match(script, /script\.src='vendor\/mediapipe-selfie\/selfie_segmentation\.js'/);
  assert.match(script, /function loadMaskBgModelOnOpen\(\)[\s\S]*?activeSidebarTab!=='mask'/);
  assert.match(script, /if\(maskBgSegmentationHandler\)\{ maskBgSegmentationHandler\(results\); return; \}/);
  assert.match(script, /if\(!maskBgPhotoReady\(\)\|\|!photoForMask\|\|!maskBgCanvas\)return/);
  assert.doesNotMatch(script.match(/async function autoRemoveMaskBackground\(\)[\s\S]*?\n\}/)[0], /https?:\/\//);
});

test('photo mask state is saved per carousel item and Mask & Background settings round-trip with presets', () => {
  assert.match(script, /currentPhoto\.maskBackground=maskBgCanvas[\s\S]*?active:maskBgActive/);
  assert.match(script, /function restoreMaskBackgroundForPhoto\(item\)/);
  assert.match(script, /restoreMaskBackgroundForPhoto\(item\)/);
  assert.match(script, /values\.MaskBackground=getMaskBackgroundPresetSettings\(true\)/);
  assert.match(script, /if\(values\.MaskBackground&&appState\.mode==='photo'\) applyMaskBackgroundPresetSettings\(values\.MaskBackground\)/);
  assert.match(script, /restoreMaskBgPresetSnapshot\(maskSnapshot\)/);
});
